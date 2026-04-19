"""Volkova blockholder replication: pull, parse, and aggregate 13D/G filings.

Pipeline:
    1. Query wrdssec_all.forms for SC 13D/G* filings in date range
    2. Write rclone files-from list (unique accessions only)
    3. Invoke rclone to pull raw SGML from /wrds/sec/archives/
    4. ProcessPoolExecutor parse
    5. Join to 13F index for files_13F flag
    6. Aggregate via src.blockholders.aggregate
    7. Write parquet

Usage::

    pixi run python scripts/pull_blockholders.py \
        --start 2020-01-01 --end 2020-12-31 \
        --work-dir data/raw/blockholders/2020 \
        --out data/processed/blockholders_python_2020.parquet

If --work-dir already has filings/ populated, re-runs skip the rclone stage.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd

# Make src importable when invoked as a script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import wrds_pull
from src.blockholders import aggregate as agg
from src.blockholders.parser import parse_filing


FORM_TYPES = ("SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A")


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


def query_forms_metadata(start: str, end: str) -> pd.DataFrame:
    conn = wrds_pull.connect(user="eddyhu")
    forms_csv = "'" + "','".join(FORM_TYPES) + "'"
    # Use wrdssec_all.forms (raw, all CIK roles) rather than wrds_forms
    # (primary filer only). Equivalent accession set here because we filter by
    # form+date, but forms is the safer default — see
    # skills/wrds/references/wrds-forms-tables.md. DISTINCT collapses the
    # multi-CIK-per-accession rows back to one row per (cik, accession).
    sql = f"""
        SELECT DISTINCT fdate, cik, coname, form, accession, fname
        FROM wrdssec_all.forms
        WHERE form IN ({forms_csv})
          AND fdate BETWEEN %s AND %s
        ORDER BY fdate
    """
    df = pd.read_sql(sql, conn, params=(start, end))
    conn.close()
    return df


def query_13f_flags(start_year: int, end_year: int) -> pd.DataFrame:
    conn = wrds_pull.connect(user="eddyhu")
    sql = """
        SELECT DISTINCT cik, EXTRACT(YEAR FROM fdate)::int AS year
        FROM wrdssec_all.forms
        WHERE form ILIKE '%%13F%%'
          AND fdate BETWEEN %s AND %s
    """
    df = pd.read_sql(sql, conn, params=(f"{start_year}-01-01", f"{end_year}-12-31"))
    conn.close()
    df["cik_int"] = pd.to_numeric(df["cik"].str.lstrip("0").replace("", "0"),
                                   errors="coerce").astype("Int64")
    return df.dropna(subset=["cik_int"])


# ---------------------------------------------------------------------------
# rclone wrappers
# ---------------------------------------------------------------------------


def fname_to_relative(fname: str) -> str:
    """'edgar/data/1234567/0000123-45-678.txt' → '001234/1234567/0000123-45-678.txt'."""
    parts = fname.split("/")
    cik_int, filename = parts[2], parts[3]
    parent = cik_int.zfill(10)[:6]
    return f"{parent}/{cik_int}/{filename}"


def write_files_from(fnames: list[str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    with path.open("w") as f:
        for fn in fnames:
            rel = fname_to_relative(fn)
            if rel in seen:
                continue
            seen.add(rel)
            f.write(rel + "\n")


def rclone_pull(files_from: Path, out_dir: Path, transfers: int = 16,
                source: str = "wrds:/wrds/sec/wrds_clean_filings/") -> None:
    """Default to wrds_clean_filings — 5x smaller, preserves SEC-HEADER + plain body."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "rclone", "copy", source, str(out_dir),
        "--files-from", str(files_from),
        "--transfers", str(transfers),
        "--no-traverse",
        "--stats", "30s",
        "--stats-one-line",
        "--retries", "2",
        "--low-level-retries", "5",
    ]
    print("[rclone]", " ".join(cmd))
    subprocess.run(cmd, check=False)


# ---------------------------------------------------------------------------
# Parallel parsing
# ---------------------------------------------------------------------------


def _parse_one(path: str) -> list[dict]:
    try:
        return parse_filing(path)
    except Exception as exc:
        return [{"filename": path, "error": str(exc)}]


def parse_all(paths: list[Path], workers: int | None = None) -> pd.DataFrame:
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    print(f"[parse] {len(paths)} files across {workers} workers")
    t0 = time.time()
    all_rows: list[dict] = []
    with cf.ProcessPoolExecutor(max_workers=workers) as ex:
        for i, rows in enumerate(ex.map(_parse_one, [str(p) for p in paths], chunksize=256)):
            all_rows.extend(rows)
            if (i + 1) % 5000 == 0:
                rate = (i + 1) / (time.time() - t0)
                print(f"  {i+1}/{len(paths)} ({rate:.0f}/s)")
    print(f"[parse] done in {time.time()-t0:.1f}s, {len(all_rows)} rows")
    return pd.DataFrame(all_rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True, help="YYYY-MM-DD")
    ap.add_argument("--end", required=True, help="YYYY-MM-DD")
    ap.add_argument("--work-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--skip-rclone", action="store_true")
    ap.add_argument("--skip-parse", action="store_true")
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--transfers", type=int, default=16)
    ap.add_argument("--skip-gap-fill", action="store_true",
                    help="Skip 2/3/4 year gap-fill (useful for single-year runs)")
    args = ap.parse_args()

    wd = args.work_dir
    wd.mkdir(parents=True, exist_ok=True)

    meta_path = wd / "metadata.parquet"
    if meta_path.exists():
        meta = pd.read_parquet(meta_path)
        print(f"[meta] loaded cached {len(meta)} filings")
    else:
        print(f"[meta] querying {args.start} to {args.end}...")
        meta = query_forms_metadata(args.start, args.end)
        meta.to_parquet(meta_path)
        print(f"[meta] {len(meta)} filings")

    # Unique accessions only — one SGML contains info for both filer+subject CIKs
    accessions = meta.drop_duplicates(subset=["accession"])
    print(f"[meta] {len(accessions)} unique accessions")

    files_from = wd / "files_from.txt"
    write_files_from(accessions["fname"].tolist(), files_from)
    filings_dir = wd / "filings"

    if not args.skip_rclone:
        rclone_pull(files_from, filings_dir, transfers=args.transfers)

    # List downloaded files
    paths = list(filings_dir.rglob("*.txt"))
    print(f"[fs] {len(paths)} filings on disk")

    parsed_path = wd / "parsed.parquet"
    if args.skip_parse and parsed_path.exists():
        parsed = pd.read_parquet(parsed_path)
        print(f"[parse] loaded cached {len(parsed)} rows")
    else:
        parsed = parse_all(paths, workers=args.workers)
        parsed.to_parquet(parsed_path, index=False)

    # Filter out error rows
    parsed = parsed[parsed.get("accession").notna()].copy()
    print(f"[parse] {len(parsed)} valid rows after error filter")

    # 13F flags
    start_y = pd.Timestamp(args.start).year
    end_y = pd.Timestamp(args.end).year
    t13f = query_13f_flags(start_y, end_y)
    print(f"[13f] {len(t13f)} (cik, year) pairs")

    # Aggregate
    panel = agg.build_panel(parsed, t13f, skip_gap_fill=args.skip_gap_fill)
    print(f"[panel] {len(panel)} rows, years {panel.year.min()}-{panel.year.max()}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    panel.to_parquet(args.out, index=False)
    print(f"[out] wrote {args.out}")


if __name__ == "__main__":
    main()
