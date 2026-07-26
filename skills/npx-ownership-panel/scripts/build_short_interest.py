"""build_short_interest.py — quarter-end short interest at permno, for netting lent
shares out of institutional ownership.

WHY THIS EXISTS. Form 13F reports LONG positions only. A lent share is reported twice:
once by the lender, who still carries it, and once by whoever bought it from the short
seller. That is why summed 13F ownership legitimately exceeds 100% for heavily shorted
stocks (WRDS support article "Institutional Ownership Exceeding 100%"; violation rate
rises 0.51% -> 22.95% across short-interest buckets of 0-2% to >10% of TSO).

For OWNERSHIP that double count is correct and must not be repaired. For VOTING it is
not: a lent share carries no vote for the lender — the vote passes to the borrower
unless the loan is recalled before the record date. So any use of institutional
ownership as a voting weight overstates the block by roughly the lending rate.

    votable institutional shares  ~=  reported institutional shares  -  shares on loan

Short interest is the observable proxy for shares on loan. Every shorted share was
borrowed from a long holder who thereby lost the vote.

WHAT THIS IS NOT. This is an upper-bound correction, and the direction of every
assumption is stated so it can be argued with:

  - Shares on loan >= short interest. Borrowing also happens for hedging, tax, and
    record-date vote acquisition. So SI UNDERSTATES lending and the correction is
    CONSERVATIVE — netted ownership is still an upper bound on votable shares.
  - It assumes the lender is a 13F institution. Institutions dominate lendable supply,
    but retail shares in street name are lent too, so this OVERSTATES the institutional
    share of lending and cuts the other way.
  - It assumes loans are not recalled before the record date. Recall for voting does
    happen, which again means the true vote loss is smaller than SI implies.

Net: treat `ior_net` as a lower bound on institutional voting power and `ior` as an
upper bound. Report both rather than picking one.

UNITS. `shortint` is as-reported at `datadate`; `io_total` in inst_own is CRSP
cfacshr-adjusted to a current-share basis. The two are NOT comparable until the same
factor is applied, so this script deliberately does NOT use Compustat's own
`shortintadj` (which is adjusted to Compustat's `splitadjdate`, a different basis).
The cfacshr multiply happens downstream in build_inst_own, where the matching factor
already lives on the row.

Usage:
    python scripts/build_short_interest.py
    python scripts/build_short_interest.py --start 2003-01-01 --end 2025-12-31
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src import wrds_pull

PROJ = Path(__file__).resolve().parent.parent
PROC = PROJ / "data" / "processed"
OUT = PROC / "short_interest.parquet"

# linktype LU/LC and linkprim P/C is the standard CCM "primary, research-grade link"
# filter. Without linkprim the same gvkey can attach to several permnos and the
# semi-monthly panel silently multiplies.
SHORTINT_QUERY = """
SELECT b.lpermno AS permno, a.datadate, a.shortint
FROM comp.sec_shortint a
JOIN crsp.ccmxpf_lnkhist b
  ON a.gvkey = b.gvkey
 AND a.iid = b.liid
 AND b.linktype IN ('LU', 'LC')
 AND b.linkprim IN ('P', 'C')
 AND b.linkdt <= a.datadate
 AND a.datadate <= COALESCE(b.linkenddt, '2099-12-31')
WHERE a.datadate BETWEEN %(start)s AND %(end)s
  AND a.shortint IS NOT NULL
"""


def snap_to_quarter_end(d: pl.Expr) -> pl.Expr:
    """Quarter-end YYYYMMDD int for a date column.

    Cast to Int64 BEFORE multiplying: dt.month() and dt.quarter() are Int8, so
    `month * 100` overflows for every month >= 2 and wraps negative, silently
    producing a plausible-looking wrong key. That exact bug put a March/December-only
    CRSP panel into production here once already.
    """
    q = d.dt.quarter().cast(pl.Int64)
    return (
        d.dt.year().cast(pl.Int64) * 10000
        + q * 300
        + pl.when(q.is_in([2, 3])).then(30).otherwise(31)
    ).cast(pl.Int32)


def main() -> None:
    ap = argparse.ArgumentParser(description="Quarter-end short interest by permno")
    ap.add_argument("--start", default="2003-01-01")
    ap.add_argument("--end", default="2025-12-31")
    ap.add_argument("--user", default="eddyhu")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    t0 = time.time()
    print(f"[si] pulling comp.sec_shortint x CCM ({args.start} to {args.end})...")
    conn = wrds_pull.connect(user=args.user)
    df = pd.read_sql(
        SHORTINT_QUERY, conn, params={"start": args.start, "end": args.end}
    )
    conn.close()
    print(f"[si] {len(df):,} raw semi-monthly rows ({time.time() - t0:.1f}s)")

    si = pl.from_pandas(df).with_columns(
        pl.col("permno").cast(pl.Int64),
        pl.col("datadate").cast(pl.Date),
        pl.col("shortint").cast(pl.Float64),
    )

    # Short interest is reported semi-monthly (mid-month and end-month settlement).
    # Keep the observation CLOSEST TO but not after quarter-end, so the measure is
    # contemporaneous with the 13F reporting date and never uses future information.
    si = si.with_columns(snap_to_quarter_end(pl.col("datadate")).alias("rdate"))
    si = (
        si.sort(["permno", "rdate", "datadate"])
        .group_by(["permno", "rdate"])
        .last()
        .rename({"datadate": "si_datadate"})
    )

    n_q = si.select(pl.col("rdate").n_unique()).item()
    print(f"[si] {len(si):,} permno-quarter rows across {n_q} quarters")

    months = sorted(
        si.select((pl.col("rdate") % 10000 // 100).alias("m")).unique().to_series().to_list()
    )
    if months != [3, 6, 9, 12]:
        raise ValueError(
            f"short interest covers quarter-end months {months}, expected [3, 6, 9, 12]"
        )

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    si.select(["permno", "rdate", "si_datadate", "shortint"]).write_parquet(args.out)
    print(f"[si] wrote {args.out}")

    # Units sanity check. `shortint` must be in SHARES to be subtractable from
    # io_total. If Compustat ever reported it in thousands, median SI/TSO would come
    # out near 0.00x% rather than the ~1-2% every published short-interest study finds,
    # and the netting would quietly do nothing. Fail loudly rather than silently
    # subtract a rounding error.
    crsp_cache = PROC / "crsp_monthly_13f.parquet"
    if crsp_cache.exists():
        crsp = pl.read_parquet(crsp_cache).select(
            ["permno", "qdate_int", "TSO", "cfacshr"]
        )
        chk = (
            si.join(crsp, left_on=["permno", "rdate"], right_on=["permno", "qdate_int"])
            .filter(pl.col("TSO") > 0)
            .with_columns(
                (pl.col("shortint") * pl.col("cfacshr") / pl.col("TSO")).alias("si_frac")
            )
        )
        med = chk.select(pl.col("si_frac").median()).item()
        p99 = chk.select(pl.col("si_frac").quantile(0.99)).item()
        print(f"[si] units check: median SI/TSO = {med:.4%}, p99 = {p99:.2%}, n={len(chk):,}")
        if not (0.001 < med < 0.15):
            raise ValueError(
                f"median SI/TSO = {med:.6%} is outside the plausible 0.1%-15% band. "
                "`shortint` is probably not in shares, or the cfacshr basis is wrong. "
                "Refusing to publish a netting input that would silently do nothing."
            )

    print(f"[done] {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
