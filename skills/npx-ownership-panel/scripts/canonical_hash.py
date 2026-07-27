"""Canonical content hash — the byte-identity primitive for pipeline refactors.

WHY THIS EXISTS. When you rewrite a pipeline leg (PostgreSQL -> native SAS,
sequential -> SGE array) the requirement is that the DATA is unchanged. The naive
test -- diff the output files -- does not work: parquet and sas7bdat embed
creation timestamps, compression state and page layout, so two runs of the SAME
unmodified code produce different bytes. Chasing that burns hours proving nothing.

What IS meaningful, and what this computes:

    canonical sort  ->  fixed numeric formatting  ->  sha256

Any two datasets with the same content produce the same digest regardless of row
order, column order, file format, or which engine wrote them. That is the claim
worth making, and "the canonical dump is byte-identical" is the honest phrasing
of it -- not "the files are identical", which will not be true and does not matter.

THE FIXED FORMATTING IS THE LOAD-BEARING PART. `repr(float)` differs across
platforms and library versions, and a weighted mean computed via PostgreSQL's
numeric path can land one ULP away from the same mean computed in a SAS datastep.
Both are "the same number" and neither is wrong. So floats are emitted at a
declared precision (default 12 significant digits, ~1e-12 relative) rather than
full repr. If a refactor moves a value by more than that, you want to know; if it
moves it by less, you do not.

DIAGNOSIS, NOT JUST A VERDICT. A bare hash mismatch tells you nothing about where
the divergence is, and on a 2M-row table that is a miserable place to start. So
this also emits row count, per-group counts, and per-column sums/nulls/min/max --
compare those first and the mismatch usually localises to one column immediately.

Usage:
    python canonical_hash.py FILE [--keys k1,k2] [--group block] [--precision 12]
    python canonical_hash.py a.parquet b.parquet --keys itemonagendaid,block   # compare two

Exit code is 1 on comparison mismatch, so it works as a gate in a shell script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import polars as pl

DEFAULT_PRECISION = 12


def _load(path: Path) -> pl.DataFrame:
    p = str(path)
    if p.endswith((".parquet", ".pq")):
        return pl.read_parquet(p)
    if p.endswith((".csv", ".csv.gz", ".txt")):
        try:
            return pl.read_csv(p)
        except Exception:
            # (P) A CSV produced by canonical_dump.sas is ALREADY canonicalised —
            # every field is a stable string and "." may appear as a literal.
            # Type inference on it is both unnecessary and fragile (polars raises
            # "invalid primitive value" on the mixed column). Read it verbatim:
            # re-canonicalising an already-canonical value is a no-op, whereas
            # guessing its type can change it.
            return pl.read_csv(p, infer_schema=False)
    raise SystemExit(f"unsupported format: {path} (parquet or csv)")


def canonical_frame(d: pl.DataFrame, keys: list[str] | None, precision: int) -> pl.DataFrame:
    """Sort deterministically and render every value to a stable string."""
    cols = sorted(d.columns)                      # column ORDER must not matter
    d = d.select(cols)

    sort_by = keys or cols                        # no keys -> total order on all columns
    missing = [k for k in sort_by if k not in d.columns]
    if missing:
        raise SystemExit(f"sort keys not in data: {missing}")
    # nulls_last makes the order total even when a key is null
    d = d.sort(sort_by, nulls_last=True)

    out = {}
    for c in cols:
        s = d[c]
        if s.dtype in (pl.Float32, pl.Float64):
            # (P) fixed significant digits, NOT repr(). See module docstring: a
            # PG numeric path and a SAS datastep can differ by an ULP on the same
            # true value, and that is not a data change.
            # (P) skip_nulls=False is REQUIRED: polars' map_elements skips nulls by
            # default, so the lambda never sees them and None survives into the
            # hash, where .encode() dies. NaN and null must both render "".
            out[c] = s.map_elements(
                lambda v, _p=precision: "" if v is None or v != v else f"{v:.{_p}g}",
                return_dtype=pl.String, skip_nulls=False,
            ).fill_null("")
        elif s.dtype == pl.Boolean:
            out[c] = s.map_elements(lambda v: "" if v is None else ("1" if v else "0"),
                                    return_dtype=pl.String, skip_nulls=False).fill_null("")
        else:
            out[c] = s.cast(pl.String, strict=False).fill_null("")
    return pl.DataFrame(out)


def digest(d: pl.DataFrame, keys, precision, group: str | None) -> dict:
    canon = canonical_frame(d, keys, precision)
    h = hashlib.sha256()
    for c in canon.columns:                       # column-major: stable, no row assembly
        h.update(c.encode())
        h.update(b"\x1e")
        h.update(b"\x1f".join(v.encode() for v in canon[c]))
        h.update(b"\x1d")

    prof = {}
    for c in sorted(d.columns):
        s = d[c]
        e = {"nulls": int(s.null_count())}
        if s.dtype.is_numeric():
            e["sum"] = float(s.sum()) if s.len() else 0.0
            e["min"] = None if s.null_count() == s.len() else float(s.min())
            e["max"] = None if s.null_count() == s.len() else float(s.max())
        else:
            e["n_unique"] = int(s.n_unique())
        prof[c] = e

    res = {"rows": d.height, "cols": d.width, "sha256": h.hexdigest(),
           "precision": precision, "sort_keys": keys or "ALL", "columns": prof}
    if group and group in d.columns:
        res["groups"] = {str(r[0]): int(r[1]) for r in
                         d.group_by(group).len().sort(group).rows()}
    return res


def report_diff(a: dict, b: dict) -> None:
    """Localise a mismatch instead of just declaring one."""
    print("\n--- WHERE THEY DIVERGE ---")
    if a["rows"] != b["rows"]:
        print(f"  ROW COUNT  {a['rows']:,} vs {b['rows']:,}  (delta {b['rows']-a['rows']:+,})")
    if set(a["columns"]) != set(b["columns"]):
        print(f"  COLUMNS only in A: {sorted(set(a['columns'])-set(b['columns']))}")
        print(f"  COLUMNS only in B: {sorted(set(b['columns'])-set(a['columns']))}")
    for c in sorted(set(a["columns"]) & set(b["columns"])):
        ca, cb = a["columns"][c], b["columns"][c]
        for k in ("sum", "nulls", "min", "max", "n_unique"):
            if k in ca and k in cb and ca[k] != cb[k]:
                print(f"  {c}.{k}: {ca[k]} vs {cb[k]}")
    if "groups" in a and "groups" in b and a["groups"] != b["groups"]:
        for g in sorted(set(a["groups"]) | set(b["groups"])):
            x, y = a["groups"].get(g), b["groups"].get(g)
            if x != y:
                print(f"  group {g}: {x} vs {y}")
    print("  (if only float sums differ at the far decimals, raise --precision to see it)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("files", nargs="+", help="one file to hash, or two to compare")
    ap.add_argument("--keys", help="comma-separated canonical sort keys")
    ap.add_argument("--group", help="column to report per-group counts on")
    ap.add_argument("--precision", type=int, default=DEFAULT_PRECISION)
    ap.add_argument("--json", action="store_true", help="emit JSON only")
    a = ap.parse_args()
    keys = [k.strip() for k in a.keys.split(",")] if a.keys else None

    results = []
    for f in a.files[:2]:
        r = digest(_load(Path(f)), keys, a.precision, a.group)
        r["file"] = f
        results.append(r)
        if not a.json:
            print(f"{f}\n  rows {r['rows']:,} x {r['cols']}  sha256 {r['sha256']}")
            if "groups" in r:
                print("  groups: " + "  ".join(f"{k}={v:,}" for k, v in r["groups"].items()))

    if a.json:
        print(json.dumps(results if len(results) > 1 else results[0], indent=2, sort_keys=True))

    if len(results) == 2:
        same = results[0]["sha256"] == results[1]["sha256"]
        print(f"\n{'IDENTICAL' if same else 'DIFFERENT'} "
              f"(canonical sort + {a.precision} sig digits)")
        if not same:
            report_diff(results[0], results[1])
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
