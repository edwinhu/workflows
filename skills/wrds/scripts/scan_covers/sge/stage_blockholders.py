"""Stage a per-year blockholders run on WRDS SGE.

Steps (all runnable independently via --step):
    1. metadata  — query wrdssec_all.wrds_forms for SC 13D/G rows, split by year
    2. upload    — scp per-year filelists + worker scripts + binary to WRDS
    3. submit    — qsub the SGE array (optional --dry-run prints command)
    4. fetch     — rclone per-year TSV.gz back to --local-out

Usage::

    pixi run python stage_blockholders.py \
        --start 1994 --end 2024 \
        --remote-root /scratch/nyu/eddyhu/blockholders_13dg \
        --local-out ~/projects/mirror/data/raw/blockholders_go \
        --step metadata,upload,submit,fetch
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import pandas as pd

_MIRROR = Path.home() / "projects" / "mirror"
if _MIRROR.exists():
    sys.path.insert(0, str(_MIRROR))
from src import wrds_pull  # noqa: E402


FORM_TYPES = ("SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A")
REMOTE_HOST = "wrds"
BIN_NAME = "scan_covers"


def sh(cmd: list[str], check: bool = True) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=check)


def fname_to_wrds_path(fname: str, source: str) -> str:
    """`edgar/data/1234567/0000123-45-678.txt` → `<source>/001234/1234567/0000123-45-678.txt`."""
    parts = fname.split("/")
    cik_int, filename = parts[2], parts[3]
    parent = cik_int.zfill(10)[:6]
    return f"{source}/{parent}/{cik_int}/{filename}"


def step_metadata(start: int, end: int, filelist_dir: Path, years_file: Path,
                  source: str) -> None:
    conn = wrds_pull.connect(user="eddyhu")
    forms_csv = "'" + "','".join(FORM_TYPES) + "'"
    sql = f"""
        SELECT DISTINCT fname, EXTRACT(YEAR FROM fdate)::int AS year
        FROM wrdssec_all.wrds_forms
        WHERE form IN ({forms_csv})
          AND fdate BETWEEN %s AND %s
    """
    print(f"[sql] querying {start}..{end}")
    df = pd.read_sql(sql, conn, params=(f"{start}-01-01", f"{end}-12-31"))
    conn.close()
    df = df.dropna(subset=["fname", "year"])
    df["year"] = df["year"].astype(int)
    df["accession"] = df["fname"].str.rsplit("/", n=1).str[-1]
    # Same accession is mirrored under filer CIK dir AND subject CIK dir in the
    # archive — keep one path per accession.
    df = df.drop_duplicates("accession")
    df["path"] = df["fname"].map(lambda f: fname_to_wrds_path(f, source))
    print(f"[sql] {len(df):,} unique accessions across {df['year'].nunique()} years")

    filelist_dir.mkdir(parents=True, exist_ok=True)
    years: list[int] = []
    for y, sub in df.sort_values("path").groupby("year"):
        out = filelist_dir / f"{y}.txt"
        out.write_text("\n".join(sub["path"].tolist()) + "\n")
        print(f"  {y}: {len(sub):,} → {out}")
        years.append(y)

    years_file.write_text("\n".join(str(y) for y in sorted(years)) + "\n")
    print(f"[sql] wrote years list: {years_file}")


def step_upload(filelist_dir: Path, years_file: Path, remote_root: str,
                scripts_dir: Path, bin_path: Path) -> None:
    """scp filelists + scripts + binary to WRDS."""
    sh(["ssh", REMOTE_HOST, f"mkdir -p {remote_root}/filelists {remote_root}/out /scratch/nyu/eddyhu/bin"])
    sh(["scp", "-q", "-C", str(years_file), f"{REMOTE_HOST}:{remote_root}/"])
    sh(["scp", "-q", "-C", str(scripts_dir / "scan_year.sh"),
        str(scripts_dir / "submit_array.sh"),
        f"{REMOTE_HOST}:{remote_root}/"])
    sh(["ssh", REMOTE_HOST, f"chmod +x {remote_root}/scan_year.sh {remote_root}/submit_array.sh"])
    # Binary — only re-upload if newer
    sh(["scp", "-q", "-C", str(bin_path),
        f"{REMOTE_HOST}:/scratch/nyu/eddyhu/bin/{BIN_NAME}"])
    sh(["ssh", REMOTE_HOST, f"chmod +x /scratch/nyu/eddyhu/bin/{BIN_NAME}"])
    # Filelists (rsync is more efficient for many small files)
    sh(["rsync", "-az", f"{filelist_dir}/",
        f"{REMOTE_HOST}:{remote_root}/filelists/"])
    print(f"[upload] done → {REMOTE_HOST}:{remote_root}")


def step_submit(remote_root: str, dry_run: bool = False) -> None:
    n = int(subprocess.check_output(
        ["ssh", REMOTE_HOST, f"wc -l < {remote_root}/years.txt"]
    ).strip())
    qsub = f"cd {remote_root} && qsub -t 1-{n} submit_array.sh"
    if dry_run:
        print(f"[submit] DRY RUN — would run:\n  {qsub}")
        return
    sh(["ssh", REMOTE_HOST, qsub])


def step_fetch(remote_root: str, local_out: Path) -> None:
    local_out.mkdir(parents=True, exist_ok=True)
    sh(["rsync", "-az", "--progress",
        f"{REMOTE_HOST}:{remote_root}/out/",
        f"{local_out}/"])
    print(f"[fetch] done → {local_out}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=1994)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--remote-root", default="/scratch/nyu/eddyhu/blockholders_13dg")
    ap.add_argument("--wrds-source", default="/wrds/sec/wrds_clean_filings",
                    help="Root path on WRDS where filings live (parser needs clean_filings).")
    ap.add_argument("--staging", type=Path,
                    default=Path(__file__).resolve().parent / ".staging")
    ap.add_argument("--bin", type=Path,
                    default=Path(__file__).resolve().parent.parent / BIN_NAME,
                    help="Path to Linux amd64 scan_covers binary (run build.sh first).")
    ap.add_argument("--local-out", type=Path,
                    default=Path.home() / "projects/mirror/data/raw/blockholders_go")
    ap.add_argument("--step", default="metadata,upload,submit,fetch",
                    help="Comma-separated subset of steps to run.")
    ap.add_argument("--dry-run", action="store_true",
                    help="For --step submit: print the qsub command, don't execute.")
    args = ap.parse_args()

    steps = [s.strip() for s in args.step.split(",") if s.strip()]
    staging = args.staging
    filelist_dir = staging / "filelists"
    years_file = staging / "years.txt"

    if "metadata" in steps:
        step_metadata(args.start, args.end, filelist_dir, years_file, args.wrds_source)
    if "upload" in steps:
        if not args.bin.exists():
            sys.exit(f"binary not found: {args.bin}. Run build.sh first.")
        step_upload(filelist_dir, years_file, args.remote_root,
                    Path(__file__).resolve().parent, args.bin)
    if "submit" in steps:
        step_submit(args.remote_root, dry_run=args.dry_run)
    if "fetch" in steps:
        step_fetch(args.remote_root, args.local_out)


if __name__ == "__main__":
    main()
