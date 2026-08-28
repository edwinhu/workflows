#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow"]
# ///
"""Entry point for the EDGAR record-table parquet converter.

pyarrow is not installed in system python locally or on rjds, and rjds's
pixi.lock is version 7 against a local pixi that supports 6, so `pixi run` is
not available there. The shebang plus the PEP 723 block above is how this runs
on both. `uv run --script` is required rather than `uv run python3`: the latter
passes the file to an interpreter and never reads the inline metadata, so
pyarrow would not be installed.

    ./cli.py --parser 13f \
        --in 'data/raw/parse_13f/holdings*.tsv.gz' \
        --out data/processed/holdings_13f \
        --manifest-in 'data/raw/parse_13f/manifest*.tsv.gz' \
        --manifest-out data/processed/parse_13f_manifest.parquet \
        --quarantine data/processed/holdings_13f_quarantine
"""

from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from edgar_parquet import convert, convert_manifest
from parsers import PARSERS

SCRIPTS_ROOT = Path(__file__).resolve().parent.parent

SUFFIXES = (".tsv", ".tsv.gz")


def expand(pattern: str) -> list[Path]:
    """Resolve a shard argument that may be a file, a directory, or a glob."""
    path = Path(pattern)
    if path.is_dir():
        found = [p for p in sorted(path.rglob("*")) if p.name.endswith(SUFFIXES)]
    elif path.exists():
        found = [path]
    else:
        found = [Path(p) for p in sorted(glob.glob(pattern))]
    if not found:
        raise SystemExit(f"no TSV shards matched: {pattern}")
    return found


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Convert headerless EDGAR parser TSV(.gz) output to partitioned parquet."
    )
    ap.add_argument("--parser", required=True, choices=sorted(PARSERS),
                    help="which record-table parser produced the input")
    ap.add_argument("--in", dest="in_", required=True, metavar="GLOB-OR-DIR",
                    help="record-table TSV(.gz) shard(s)")
    ap.add_argument("--out", required=True, metavar="DATASET-DIR",
                    help="Hive-partitioned output dataset directory")
    ap.add_argument("--manifest-in", metavar="GLOB",
                    help="manifest TSV(.gz) shard(s); requires --manifest-out")
    ap.add_argument("--manifest-out", metavar="PATH",
                    help="manifest parquet path; requires --manifest-in")
    ap.add_argument("--quarantine", metavar="DIR",
                    help="where rows with an implausible partition year are kept")
    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if bool(args.manifest_in) != bool(args.manifest_out):
        ap.error("--manifest-in and --manifest-out must be given together")

    spec = PARSERS[args.parser]
    stats = convert(
        expand(args.in_),
        spec,
        Path(args.out),
        SCRIPTS_ROOT,
        quarantine=Path(args.quarantine) if args.quarantine else None,
    )
    print(f"{spec.dataset}: rows={stats['rows']} quarantined={stats['quarantined']} "
          f"shards={stats['shards']} -> {args.out}")

    if args.manifest_in:
        man = convert_manifest(
            expand(args.manifest_in), spec, Path(args.manifest_out), SCRIPTS_ROOT
        )
        print(f"{spec.manifest_dataset}: rows={man['rows']} -> {args.manifest_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
