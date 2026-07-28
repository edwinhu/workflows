#!/usr/bin/env -S uv run python3
"""Driver for the SGE-sharded SEC full-text index.

NOTE ON THE NAME: this was once called `sec_index_rga` after ripgrep-all.
`rga` is NOT used and never was in the shipped path — it exists to search
inside PDF/DOCX/zip/SQLite by shelling out to extractors, and EDGAR filings
are plain text, so it would add per-file adapter cost for nothing. The three
scanners are awk-per-file (baseline), rg|awk (rejected, fails parity) and a
Go helper (shipped default).

Steps:
1. Refresh shard list on WRDS.
2. Submit SGE array (default: 5 shards; --all for 1-N).
3. Poll qstat until array finishes.
4. rclone gzipped TSVs back to local.
5. Concatenate to parquet at data/processed/sec_index.parquet.

Usage:
    python scripts/sec_index/build_index.py --tasks 5              # submit+wait 5 shards
    python scripts/sec_index/build_index.py --all                   # submit all 164
    python scripts/sec_index/build_index.py --concat-only           # just concat whatever is present
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

WRDS = os.environ.get("WRDS_HOST", "wrds")

# PATHS. No user or institution is baked in. The remote scratch root is derived
# on the REMOTE side (the local account name is not necessarily the WRDS one),
# so `WRDS_SCRATCH` is resolved by asking the remote shell once rather than by
# assuming `whoami` here matches.
_WRDS_INST = os.environ.get("WRDS_INST", "nyu")


def _remote_scratch() -> str:
    """Resolve the remote scratch root, honouring $WRDS_SCRATCH if already set."""
    override = os.environ.get("WRDS_SCRATCH")
    if override:
        return override
    r = subprocess.run(
        ["ssh", WRDS, f'echo "${{WRDS_SCRATCH:-/scratch/{_WRDS_INST}/$(whoami)}}"'],
        check=True, capture_output=True, text=True,
    )
    return r.stdout.strip()


REMOTE_SCRATCH = _remote_scratch()
REMOTE_ROOT = f"{REMOTE_SCRATCH}/sec_index"
REMOTE_BIN = f"{REMOTE_ROOT}/bin"
REMOTE_OUT = f"{REMOTE_SCRATCH}/sec_index"
LOCAL_OUT = Path(os.environ.get("SEC_INDEX_LOCAL_OUT", "data/processed/sec_index"))
PARQUET_PATH = Path(os.environ.get("SEC_INDEX_PARQUET", "data/processed/sec_index.parquet"))


def ssh(cmd: str) -> str:
    r = subprocess.run(
        ["ssh", WRDS, cmd],
        check=True,
        capture_output=True,
        text=True,
    )
    return r.stdout


def refresh_shard_list() -> int:
    out = ssh(
        f"ls -d /wrds/sec/archives/*/ | sed 's|/wrds/sec/archives/||;s|/$||' | sort "
        f"> {REMOTE_ROOT}/shards.txt && wc -l < {REMOTE_ROOT}/shards.txt"
    )
    n = int(out.strip())
    print(f"[shards] {n} top-level shards")
    return n


def submit(n_tasks: int) -> str:
    """Submit qsub array job. Returns job id."""
    out = ssh(
        f"cd {REMOTE_ROOT} && qsub -t 1-{n_tasks} {REMOTE_BIN}/../submit_array.sh"
    )
    # "Your job-array 123456.1-5:1 ('sec_idx') has been submitted"
    print(out.strip())
    for tok in out.split():
        if "." in tok and tok.split(".")[0].isdigit():
            return tok.split(".")[0]
    raise RuntimeError(f"Could not parse job id from: {out}")


def wait_for(job_id: str, poll_s: int = 30) -> None:
    print(f"[qstat] waiting for job {job_id}...")
    while True:
        out = ssh(f"qstat -j {job_id} 2>&1 || true")
        if "Following jobs do not exist" in out or out.strip() == "":
            break
        # Show task state summary
        summary = ssh(f'qstat -u "$(whoami)" | grep \'{job_id}\' | head -5 || true').strip()
        print(f"  {time.strftime('%H:%M:%S')} {summary or '(no tasks in queue)'}")
        time.sleep(poll_s)
    print(f"[qstat] job {job_id} done")


def pull_outputs() -> list[Path]:
    LOCAL_OUT.mkdir(parents=True, exist_ok=True)
    print(f"[rclone] pulling {REMOTE_OUT}/ -> {LOCAL_OUT}/")
    subprocess.run(
        [
            "rclone", "copy",
            f"{WRDS}:{REMOTE_OUT}/",
            str(LOCAL_OUT),
            "--include", "shard_*.tsv.gz",
            "--stats", "15s", "--stats-one-line",
        ],
        check=True,
    )
    files = sorted(LOCAL_OUT.glob("shard_*.tsv.gz"))
    print(f"[rclone] fetched {len(files)} shard TSVs")
    return files


def concat_to_parquet(files: list[Path]) -> None:
    import polars as pl

    if not files:
        print("[concat] no files to concat", file=sys.stderr)
        return

    frames = []
    cols = ["filepath", "form_type", "filed_date", "accession", "role", "cik"]
    for f in files:
        df = pl.read_csv(
            f,
            separator="\t",
            has_header=False,
            new_columns=cols,
            schema_overrides={"filed_date": pl.Utf8, "cik": pl.Utf8},
            truncate_ragged_lines=True,
        )
        frames.append(df)
    full = pl.concat(frames, how="vertical_relaxed")
    PARQUET_PATH.parent.mkdir(parents=True, exist_ok=True)
    full.write_parquet(PARQUET_PATH)
    print(f"[parquet] wrote {len(full):,} rows -> {PARQUET_PATH}")
    print(full.group_by("role").len().sort("len", descending=True).head(10))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", type=int, default=5, help="number of shards to submit")
    ap.add_argument("--all", action="store_true", help="submit all shards")
    ap.add_argument("--concat-only", action="store_true", help="skip submit, just concat")
    ap.add_argument("--skip-submit", action="store_true", help="skip submit, do pull+concat")
    args = ap.parse_args()

    if args.concat_only:
        files = sorted(LOCAL_OUT.glob("shard_*.tsv.gz"))
        concat_to_parquet(files)
        return 0

    n = refresh_shard_list()
    if not args.skip_submit:
        n_tasks = n if args.all else min(args.tasks, n)
        job_id = submit(n_tasks)
        wait_for(job_id)

    files = pull_outputs()
    concat_to_parquet(files)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
