"""build_inst_own.py — 13F institutional ownership panel (replaces SAS build_inst_own.sas).

Sources 13F holdings from the Go-based EDGAR parser output at
data/processed/holdings_13f/year=*/Q*.parquet, joins with CRSP monthly
for CUSIP→PERMNO mapping and cfacshr share adjustment, then computes
IO metrics (NumOwners, IO_TOTAL, IOC_HHI, DBREADTH, IOR).

Output: data/processed/inst_own.parquet (+ optional .sas7bdat)

Downstream consumer: merge_panel.sas reads inst_own and does MERGE_ASOF
with ISS meetings. The canonical IOR is recomputed there as
io_total / ISS_tso; the CRSP-based IOR/TSO here are diagnostic only.

Deviation from SAS: cfacshr is looked up at the reporting-period quarter
(rdate), not the filing-date quarter (fdate). The difference is nil
except when a stock split occurs in the ~45-day window between rdate
and fdate.

Usage:
    pixi run python scripts/build_inst_own.py
    pixi run python scripts/build_inst_own.py --quarter 2020Q1
    pixi run python scripts/build_inst_own.py --no-pull  # use cached CRSP
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import polars as pl
import pyreadstat

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src import wrds_pull

PROJ = Path(__file__).resolve().parent.parent
PROC = PROJ / "data" / "processed"
CRSP_CACHE = PROC / "crsp_monthly_13f.parquet"
CUSIP_MAP_CACHE = PROC / "cusip8_permno_map.parquet"

# Form-type priority for amendment dedup (higher = preferred)
FORM_PRIORITY = {"13F-HR/A": 4, "13F-NT/A": 3, "13F-HR": 2, "13F-NT": 1}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def snap_to_quarter_end(rdate_int: pl.Expr) -> pl.Expr:
    """Snap YYYYMMDD integer to its quarter-end date.

    Replicates bench_13f_bcs_v2.py logic: maps any date to the last day
    of its calendar quarter (0331, 0630, 0930, 1231).
    """
    year = rdate_int // 10000
    month = (rdate_int % 10000) // 100
    qe_month = (
        pl.when(month <= 3).then(3)
        .when(month <= 6).then(6)
        .when(month <= 9).then(9)
        .otherwise(12)
    )
    qe_day = pl.when(qe_month.eq(6) | qe_month.eq(9)).then(30).otherwise(31)
    return year * 10000 + qe_month * 100 + qe_day


def quarter_index(rdate_int: pl.Expr) -> pl.Expr:
    """Convert YYYYMMDD int to a monotonic quarter index (year*4 + q)."""
    year = rdate_int // 10000
    month = (rdate_int % 10000) // 100
    q = (month - 1) // 3
    return year * 4 + q


# ---------------------------------------------------------------------------
# Step 0: CRSP data from WRDS
# ---------------------------------------------------------------------------

CRSP_MONTHLY_QUERY = """
SELECT a.permno, a.date, a.prc, a.shrout, a.cfacpr, a.cfacshr,
       b.ncusip
FROM crsp.msf a
INNER JOIN crsp.msenames b
  ON a.permno = b.permno
  AND b.namedt <= a.date
  AND a.date <= COALESCE(b.nameendt, '2099-12-31')
WHERE b.shrcd IN (10, 11)
  AND a.date BETWEEN %(start)s AND %(end)s
  AND a.shrout IS NOT NULL
"""

# CRSP 2.0 (CIZ) monthly. crsp.msf is the FROZEN legacy table and stops at
# 2024-12-31; crsp.msf_v2 runs to 2025-12-31. Without this the panel silently
# carried tso = NULL and ior = 0 for all four 2025 quarters — the same shape as
# the Int8 overflow, and _assert_all_quarters did NOT catch it because the
# months [3,6,9,12] all still existed; only the RANGE was short.
#
# Used to extend, not to replace. The CIZ share-class filter admits ~5% more
# permnos than legacy shrcd IN (10,11) (4,229 vs 4,018 in 2015), so switching
# wholesale would move the universe under results already validated against
# Thomson. Splicing at the legacy boundary keeps every historical quarter on its
# original source and confines the difference to quarters that had NO data.
#
# The adjustment bases agree, which is what makes the splice safe at all:
# AAPL 2014-06-30 is shrout 5,989,171 / factor 4.0 in BOTH tables, and
# 2020-09-30 is 16,976,763 / 1.0 / 115.81 in both. Verified before adopting.
# shrout at the boundary differs ~0.5% (15,040,731 vs 15,115,823) — a vintage
# revision between products, which is why crsp_src is stamped on every row.
CRSP_MONTHLY_V2_QUERY = """
SELECT permno, mthcaldt AS date, mthprc AS prc, shrout,
       mthcumfacpr AS cfacpr, mthcumfacshr AS cfacshr, cusip AS ncusip
FROM crsp.msf_v2
WHERE sharetype = 'NS'
  AND securitytype = 'EQTY'
  AND securitysubtype = 'COM'
  AND usincflg = 'Y'
  AND mthcaldt BETWEEN %(start)s AND %(end)s
  AND shrout IS NOT NULL
"""

CUSIP8_PERMNO_QUERY = """
SELECT DISTINCT ncusip, permno
FROM crsp.msenames
WHERE ncusip IS NOT NULL AND ncusip != ''
"""


def pull_crsp_monthly(user: str, start: str, end: str) -> pl.DataFrame:
    """Pull CRSP monthly panel from WRDS and compute adjusted fields."""
    print(f"[crsp] pulling crsp.msf + msenames ({start} to {end})...")
    t0 = time.time()
    conn = wrds_pull.connect(user=user)
    df = pd.read_sql(CRSP_MONTHLY_QUERY, conn, params={"start": start, "end": end})
    df["crsp_src"] = "msf"
    legacy_max = pd.to_datetime(df["date"]).max()
    print(f"[crsp] {len(df):,} legacy rows to {legacy_max.date()} ({time.time() - t0:.1f}s)")

    # Extend past the frozen legacy table with CIZ, if the request runs past it.
    if pd.Timestamp(end) > legacy_max:
        v2_start = (legacy_max + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        df2 = pd.read_sql(
            CRSP_MONTHLY_V2_QUERY, conn, params={"start": v2_start, "end": end}
        )
        df2["crsp_src"] = "msf_v2"
        print(f"[crsp] {len(df2):,} CIZ rows for {v2_start}..{end} (legacy ends {legacy_max.date()})")
        df = pd.concat([df, df2], ignore_index=True)
    conn.close()
    print(f"[crsp] {len(df):,} raw rows total")

    crsp = pl.from_pandas(df)

    # Cast types
    crsp = crsp.with_columns(
        pl.col("permno").cast(pl.Int64),
        pl.col("date").cast(pl.Date),
        pl.col("prc").cast(pl.Float64),
        pl.col("shrout").cast(pl.Float64),
        pl.col("cfacpr").cast(pl.Float64),
        pl.col("cfacshr").cast(pl.Float64),
        pl.col("ncusip").cast(pl.Utf8),
    )

    # Compute quarter-end date as YYYYMMDD integer.
    # Cast to i64 BEFORE the multiply: dt.month() is Int8, so month * 100
    # overflows for every month >= 2 (2*100 = 200 > 127) and wraps negative,
    # silently. Only January survived. The wreckage was not a crash but a
    # plausible-looking date_int: 2020-02-29 -> 20199973, 2020-12-31 ->
    # 20199951, which snap_to_quarter_end then read as month 99 / month 0 and
    # bucketed into Q4-of-the-prior-year and Q1. Net effect: qdate_int only
    # ever took March and December values, so every June and September 13F
    # quarter missed the CRSP join, defaulted to cfacshr = 1 and null TSO, and
    # produced ior = 0 for 49% of the panel. Same fix already present in
    # bench_wrds_xv.py; it was never propagated here.
    crsp = crsp.with_columns(
        (
            pl.col("date").dt.year().cast(pl.Int64) * 10000
            + pl.col("date").dt.month().cast(pl.Int64) * 100
            + pl.col("date").dt.day().cast(pl.Int64)
        )
        # Back to Int32 once the arithmetic is done. YYYYMMDD maxes out around
        # 20991231, far inside Int32 — only the intermediate needed the
        # headroom. Keeping the original dtype matters: qdate_int is derived
        # from this and is vstacked against an Int32 branch in
        # build_final_panel, which raises SchemaError on a widened type.
        .cast(pl.Int32)
        .alias("date_int")
    ).with_columns(
        snap_to_quarter_end(pl.col("date_int")).alias("qdate_int")
    )

    # Adjusted price and TSO (matching SAS build_inst_own.sas lines 40-44)
    crsp = crsp.with_columns(
        pl.when(pl.col("cfacpr") > 0)
        .then(pl.col("prc").abs() / pl.col("cfacpr"))
        .otherwise(pl.col("prc").abs())
        .alias("P"),
        pl.when(pl.col("cfacshr") > 0)
        .then(pl.col("shrout") * 1000.0 * pl.col("cfacshr"))
        .otherwise(pl.lit(None, dtype=pl.Float64))
        .alias("TSO"),
    )
    crsp = crsp.with_columns(
        (pl.col("P") * pl.col("TSO") / 1_000_000.0).alias("ME")
    )

    # Keep last observation per (permno, qdate) — end-of-quarter snapshot
    crsp = (
        crsp.sort(["permno", "qdate_int", "date_int"])
        .group_by(["permno", "qdate_int"])
        .last()
    )

    # Keep only columns needed downstream
    crsp = crsp.select([
        "permno", "qdate_int", "ncusip", "cfacshr", "P", "TSO", "ME", "crsp_src",
    ]).filter(pl.col("TSO").is_not_null() & (pl.col("TSO") > 0))

    _assert_all_quarters(crsp)
    _assert_covers_range(crsp, end)

    # Cache
    CRSP_CACHE.parent.mkdir(parents=True, exist_ok=True)
    crsp.write_parquet(CRSP_CACHE)
    print(f"[crsp] {len(crsp):,} permno-quarter rows → {CRSP_CACHE}")
    return crsp


def _assert_covers_range(crsp: pl.DataFrame, end: str) -> None:
    """Fail if the CRSP panel stops well short of the requested end date.

    _assert_all_quarters checks that months [3,6,9,12] are PRESENT; it says
    nothing about the range. That gap let crsp.msf's 2024-12-31 freeze through
    unnoticed: all four quarter-end months still existed, so the months check
    passed, while every 2025 quarter in the holdings panel joined to nothing and
    carried tso = NULL and ior = 0 for 100% of its rows. Identical shape to the
    Int8 overflow, caught by neither the months assertion nor
    detect_join_gap_clustering — the latter keys on spread ACROSS calendar
    buckets, and a tail truncation fails all four buckets equally.
    """
    want = int(end.replace("-", ""))
    got = int(crsp.select(pl.col("qdate_int").max()).item())
    # One quarter of slack: a request ending mid-quarter legitimately lands on
    # the prior quarter-end.
    if got < want - 300:
        raise ValueError(
            f"CRSP panel ends {got}, requested through {want}. Every holdings "
            f"quarter after {got} would join to nothing and silently carry "
            f"tso = NULL and ior = 0. Extend the source (crsp.msf is frozen at "
            f"2024-12-31; crsp.msf_v2 continues) or lower --end deliberately."
        )
    print(f"[crsp] range check ok: covers through {got} (requested {want})")


def _assert_all_quarters(crsp: pl.DataFrame) -> None:
    """Fail loudly if qdate_int does not cover all four quarter-ends.

    This exists because the Int8 overflow above did NOT fail — it produced a
    CRSP panel holding only March and December, which then silently lost the
    join for every June and September 13F quarter. Downstream that surfaced as
    cfacshr = 1 and ior = 0 for 49% of the panel: a complete-looking table with
    half its ownership adjustment missing, which read as a Thomson data-quality
    defect for months. A missing quarter must stop the build, not be inferred
    later from a seasonal pattern in the output.
    """
    months = sorted(
        crsp.select((pl.col("qdate_int") % 10000 // 100).alias("m"))
        .unique()
        .to_series()
        .to_list()
    )
    if months != [3, 6, 9, 12]:
        raise ValueError(
            f"CRSP panel covers quarter-end months {months}, expected [3, 6, 9, 12]. "
            "Refusing to write the cache. A missing quarter here becomes a silent "
            "cfacshr=1 / null-TSO hole for every 13F quarter that maps to it."
        )


def pull_cusip8_permno_map(user: str) -> pl.DataFrame:
    """Pull CUSIP8 → PERMNO mapping from WRDS."""
    print("[cusip] pulling cusip8→permno from crsp.msenames...")
    t0 = time.time()
    conn = wrds_pull.connect(user=user)
    df = pd.read_sql(CUSIP8_PERMNO_QUERY, conn)
    conn.close()

    cmap = pl.from_pandas(df).with_columns(
        pl.col("ncusip").cast(pl.Utf8),
        pl.col("permno").cast(pl.Int64),
    )
    # A cusip8 may map to multiple permnos; keep all (dedup after join)
    cmap = cmap.unique(subset=["ncusip", "permno"])
    cmap.write_parquet(CUSIP_MAP_CACHE)
    print(f"[cusip] {len(cmap):,} unique (ncusip, permno) pairs ({time.time() - t0:.1f}s)")
    return cmap


# ---------------------------------------------------------------------------
# Step 1: Load and clean 13F holdings
# ---------------------------------------------------------------------------

def load_13f_holdings(
    start_int: int, end_int: int, zero_value_shares_threshold: int | None = 100_000
) -> pl.DataFrame:
    """Load 13F parser output, apply F1 (rdate snap) and F2 (amendment dedup)."""
    print(f"[13f] loading holdings ({start_int} to {end_int})...")
    t0 = time.time()

    # Project to the seven columns this function actually uses BEFORE collecting.
    # The parquet has 24, including filepath and name_of_issuer — long strings
    # that are never read here but dominate the in-memory footprint. Collecting
    # all of them over the full 2003-2025 range peaked at 198.8 GB RSS and was
    # OOM-killed (SIGKILL/137); the projection is what makes the full-range
    # build fit. Deliberately NOT chunked by year: build_manager_markers uses
    # shift(1).over(cik_int) across quarters, so a year-chunked run would reset
    # every manager's first_report each January and silently corrupt DBREADTH.
    NEEDED = [
        "cik", "period_of_report", "filed_date",
        "form_type", "accession", "cusip8", "shares", "value",
    ]
    holdings = (
        pl.scan_parquet(str(PROC / "holdings_13f" / "year=*" / "Q*.parquet"))
        .select(NEEDED)
        .with_columns(
            pl.col("period_of_report").cast(pl.Int64).alias("rdate_raw"),
            pl.col("filed_date").cast(pl.Int64).alias("fdate_int"),
            pl.col("cik").cast(pl.Int64).alias("cik_int"),
        )
        .filter(
            (pl.col("rdate_raw") >= start_int) & (pl.col("rdate_raw") <= end_int)
        )
        .collect()
    )
    print(f"[13f] {len(holdings):,} raw rows ({time.time() - t0:.1f}s)")

    # F1: snap rdate to quarter-end
    holdings = holdings.with_columns(
        snap_to_quarter_end(pl.col("rdate_raw")).alias("rdate_int")
    )

    # F2+F7: filing-level dedup — one accession per (cik, rdate).
    # F2 (v1) deduped at the (cik, cusip8, rdate) level, which could mix
    # holdings from different accessions for the same manager-quarter.
    # F7 selects the single best accession per (cik, rdate) — the latest
    # filing supersedes all prior filings for that quarter.  This resolves
    # ~130K share-mismatch rows from multi-accession double/triple-counting.
    print("[13f] deduplicating filings (F7: one accession per cik×rdate)...")
    holdings = holdings.with_columns(
        pl.col("form_type")
        .replace_strict(FORM_PRIORITY, default=0)
        .alias("form_priority")
    )

    # Exclude filings >365 days after reporting period
    before = len(holdings)
    holdings = holdings.filter(
        (pl.col("fdate_int") - pl.col("rdate_int")) <= 10000
    )
    print(f"[13f]   dropped {before - len(holdings):,} rows filed >~1yr after period")

    # Select best accession per (cik, rdate): latest fdate → highest
    # form_priority (HR/A > HR) → latest accession string.
    best_filing = (
        holdings
        .select(["cik_int", "rdate_int", "fdate_int", "form_priority", "accession"])
        .unique(subset=["cik_int", "rdate_int", "accession"])
        .sort(["cik_int", "rdate_int", "fdate_int", "form_priority", "accession"])
        .group_by(["cik_int", "rdate_int"])
        .last()
        .select(["cik_int", "rdate_int", pl.col("accession").alias("best_acc")])
    )
    n_multi = best_filing.join(
        holdings.select(["cik_int", "rdate_int", "accession"]).unique(),
        on=["cik_int", "rdate_int"],
    ).filter(pl.col("accession") != pl.col("best_acc")).select(
        ["cik_int", "rdate_int"]
    ).unique().height
    print(f"[13f]   {n_multi:,} (cik, rdate) pairs had multiple accessions → kept latest")

    holdings = holdings.join(
        best_filing, on=["cik_int", "rdate_int"]
    ).filter(
        pl.col("accession") == pl.col("best_acc")
    ).drop(["best_acc", "form_priority"])

    print(f"[13f]   after dedup: {len(holdings):,} rows")

    # D9: drop text-parser rows carrying value = 0 with a large share count.
    # `value` is reported in $1000s, so a genuine holding worth under $1,000
    # cannot also carry 100,000 shares at any plausible price. These rows are
    # parse failures, not holdings: AAPL 2003-09-30 was ONE such row (cik
    # 728100, 719,257,141 shares, value 0) against a next-largest holder of
    # 19.8M, and the same filer reports 3,038,253,827 shares of Exxon Mobil --
    # more than Exxon's entire float.
    #
    # The threshold is load-bearing, not cosmetic. At T = 0 the rule removes
    # 2,820,455 rows for the SAME 13.9% of share mass -- 33x the rows for no
    # additional benefit -- because a legitimate sub-$1,000 holding rounds to
    # value = 0 (median such row: 479 shares). T = 100,000 captures 99.9% of
    # the bad mass at 3% of the row cost.
    #
    # NOT WRDS's rule. The May 2017 note prescribes `if pct > 0.5 then pct =
    # 0.5` -- a cap, not a repair, scoped to 2013+ and explicitly provisional
    # ("further investigation is warranted"). Capping leaves a fabricated 50%
    # holding standing, which is exactly the clipping that makes this defect
    # invisible in vendor panels.
    if zero_value_shares_threshold is not None:
        before = len(holdings)
        holdings = holdings.filter(
            ~((pl.col("value") == 0) & (pl.col("shares") > zero_value_shares_threshold))
        )
        print(
            f"[13f]   D9: dropped {before - len(holdings):,} rows with value=0 and "
            f"shares>{zero_value_shares_threshold:,}"
        )

    # Aggregate sub-managers to (cik, cusip8, rdate) level
    agg = (
        holdings
        .group_by(["cik_int", "cusip8", "rdate_int"])
        .agg(pl.col("shares").sum().alias("shares"))
        .filter(pl.col("shares") > 0)
        # F6 safety net: drop concatenated value+shares (parser bug residual)
        .filter(pl.col("shares") < 10_000_000_000)
    )
    # Derive cusip6 for fallback matching
    agg = agg.with_columns(pl.col("cusip8").str.slice(0, 6).alias("cusip6"))
    print(f"[13f]   after aggregation: {len(agg):,} unique (cik, cusip, rdate)")
    return agg


# ---------------------------------------------------------------------------
# Step 2: Manager entry/exit markers for DBREADTH
# ---------------------------------------------------------------------------

def build_manager_markers(holdings: pl.DataFrame) -> pl.DataFrame:
    """Compute First_Report, Last_Report, NumInst per (cik_int, rdate_int).

    Matches SAS build_inst_own.sas lines 61-93.
    """
    # Distinct manager-quarters
    mgr_q = holdings.select(["cik_int", "rdate_int"]).unique()

    # Quarter index for gap detection
    mgr_q = mgr_q.with_columns(quarter_index(pl.col("rdate_int")).alias("qi"))

    # First_Report: first appearance or gap > 1 quarter
    mgr_q = mgr_q.sort(["cik_int", "rdate_int"]).with_columns(
        pl.col("qi").shift(1).over("cik_int").alias("prev_qi")
    ).with_columns(
        (pl.col("prev_qi").is_null() | ((pl.col("qi") - pl.col("prev_qi")) > 1))
        .cast(pl.Int32)
        .alias("first_report")
    )

    # Last_Report: sort descending, same gap logic
    mgr_q = mgr_q.sort(["cik_int", "rdate_int"], descending=[False, True]).with_columns(
        pl.col("qi").shift(1).over("cik_int").alias("next_qi")
    ).with_columns(
        (pl.col("next_qi").is_null() | ((pl.col("next_qi") - pl.col("qi")) > 1))
        .cast(pl.Int32)
        .alias("last_report")
    )

    # NumInst: distinct managers per rdate
    num_inst = mgr_q.group_by("rdate_int").agg(
        pl.col("cik_int").n_unique().alias("NumInst")
    )
    mgr_q = mgr_q.join(num_inst, on="rdate_int")

    return mgr_q.select(["cik_int", "rdate_int", "first_report", "last_report", "NumInst"])


# ---------------------------------------------------------------------------
# Step 3: CUSIP→PERMNO + cfacshr adjustment
# ---------------------------------------------------------------------------

def join_and_adjust(
    holdings: pl.DataFrame,
    mgr_markers: pl.DataFrame,
    cusip_map: pl.DataFrame,
    cusip6_map: pl.DataFrame,
    crsp_m: pl.DataFrame,
    use_cusip6_fallback: bool = True,
) -> pl.DataFrame:
    """Map cusip8→permno (with cusip6 fallback), adjust shares by cfacshr, dedup.

    Primary match: cusip8 = ncusip (exact 8-char).
    Fallback: cusip6 = ncusip[:6] for unmatched holdings (matches SAS
    build_meetings.sas line 236: substr(cusip,1,6)=substr(ncusip,1,6)).
    """
    # Attach manager markers
    h = holdings.join(mgr_markers, on=["cik_int", "rdate_int"], how="left")

    # Primary: CUSIP8 → PERMNO
    matched8 = h.join(cusip_map, left_on="cusip8", right_on="ncusip", how="inner")
    unmatched = h.join(cusip_map, left_on="cusip8", right_on="ncusip", how="anti")
    print(f"[join] cusip8 match: {len(matched8):,}, unmatched: {len(unmatched):,}")

    # Fallback: CUSIP6 → PERMNO for unmatched.
    #
    # D9 cause 2. A cusip8 that fails to match is usually not a formatting
    # variant of a security we hold — it is a DIFFERENT security: another share
    # class, a preferred, a warrant. Truncating to cusip6 maps it onto the
    # common-stock permno anyway, so its shares are summed against the common
    # share count and inflate ownership past 100%.
    #
    # Measured on violating vs clean permno-quarter cells:
    #   >1 distinct cusip8 per permno   55.6% of violators vs 18.8% of clean
    #   used the fallback at all        53.7%              vs 13.8%
    #   share of cell io FROM fallback  16.5%              vs  0.8%   (21x)
    # The third is the discriminating one, which is why the detector keys on
    # contributed MASS rather than on whether the fallback was used.
    #
    # Dropping only "ambiguous" cusip6 keys does NOT work (tested: fixes 3.5%
    # of violators) precisely because the bad matches are to genuinely distinct
    # securities, not to ambiguous permnos. It is drop-all or keep-all.
    #
    # This is a real correctness-vs-coverage trade, so it is a flag, not a
    # silent default: dropping the fallback costs 1.67% of clean-cell mass.
    #
    # RESIDUAL — RESOLVED, AND IT IS NOT A DEFECT. DO NOT "FIX" IT.
    #
    # 3.02% of permno-quarter cells exceed 100% ownership after both repairs
    # above. That residual is CORRECT. WRDS's support article "Institutional
    # Ownership Exceeding 100%" (S34 knowledge base) gives the reason first:
    # Form 13F reports LONG positions only and has no short side, so a lent
    # share is reported twice — once by the lender, who still holds it on the
    # books, and once by whoever bought it from the short seller. For a heavily
    # shorted stock, summed 13F ownership above 100% is the arithmetically
    # right answer.
    #
    # Confirmed against Compustat sec_shortint via CCM, with a clean
    # dose-response rather than a single contrast:
    #
    #   violation rate by short interest / TSO
    #     0-2%     0.51%
    #     2-5%     2.16%
    #     5-10%    6.99%
    #     >10%    22.95%      <- 45x across the range
    #   median SI/TSO   violators 12.44%  vs clean 1.57%
    #   corr(excess, SI) = 0.355
    #
    # Two earlier guesses of mine were tested and REJECTED; do not revive them.
    # (a) dual-class / rdate-timing: 1.5x and 1.3x, ~5pp excess over a 14.5%
    #     clean baseline, 80.7% of violators show neither, and severity does
    #     not track them (median 1.069 "explained" vs 1.054 not).
    # (b) a second row-level parse pathology like the value=0 case: the
    #     row-level decomposition came back NEGATIVE and in the OPPOSITE
    #     direction. Violating cells are LESS concentrated, not more —
    #     top-filer mass share 12.33% vs 18.11% clean, >50% concentration in
    #     5.3% vs 12.4%, median 172 contributing filers vs 85. value=0 was one
    #     row dominating a cell; this is excess spread across MORE filers,
    #     which is what economy-wide lending looks like and what a parse bug
    #     does not.
    #
    # CLIPPING AT 100% WOULD DESTROY REAL INFORMATION — it is the same clipping
    # that hid the value=0 defect in vendor panels. Leave the ratio uncapped.
    #
    # CONSEQUENCE FOR ANY VOTING ANALYSIS, which is the part that matters here
    # and is NOT a data-quality issue: a lent share carries NO VOTE for the
    # lender. Voting rights pass to the borrower unless the loan is recalled
    # before the record date. So 13F double-counting inflates OWNERSHIP but not
    # VOTABLE SHARES, and `ior` therefore overstates the institutional voting
    # block by roughly the lending rate — about 1.6pp typically (clean-cell
    # median SI/TSO), but over 12pp in the ~3% of heavily shorted firm-quarters.
    #
    # This is worse than a level bias for `log_ior` as a regressor: short
    # interest is not random with respect to governance conflict, and borrowing
    # spikes around record dates specifically to acquire votes. A covariate
    # built partly from lending activity is then endogenous to the outcome it
    # is meant to condition on. Anything using `ior` as a voting weight should
    # net out securities lending or report robustness excluding high-SI
    # firm-quarters. Tracked, not solved here.
    if use_cusip6_fallback:
        matched6 = unmatched.join(cusip6_map, on="cusip6", how="inner")
        print(f"[join] cusip6 fallback: {len(matched6):,} recovered")
        h = pl.concat([matched8, matched6])
    else:
        print(
            f"[join] cusip6 fallback DISABLED — {len(unmatched):,} unmatched rows dropped "
            f"(D9 cause 2: cusip6 maps other share classes/preferreds onto the common permno)"
        )
        h = matched8
    print(f"[join] after cusip→permno: {len(h):,} rows")

    # Join with CRSP for cfacshr at rdate (LEFT — keep holdings without CRSP;
    # default cfacshr=1 for permnos not in CRSP monthly panel, since the
    # canonical IOR is recomputed in merge_panel using ISS tso anyway)
    h = h.join(
        crsp_m.select(["permno", "qdate_int", "cfacshr", "P"]),
        left_on=["permno", "rdate_int"],
        right_on=["permno", "qdate_int"],
        how="left",
    )
    n_no_crsp = h.filter(pl.col("cfacshr").is_null()).shape[0]
    h = h.with_columns(
        pl.col("cfacshr").fill_null(1.0),
        pl.col("P").fill_null(0.0),
    )
    print(f"[join] after crsp join: {len(h):,} rows ({n_no_crsp:,} without CRSP, cfacshr=1)")

    # Share adjustment (SAS line 117)
    h = h.with_columns(
        (pl.col("shares").cast(pl.Float64) * pl.col("cfacshr")).alias("shares_adj")
    )

    # Dedup (permno, rdate, cik) — matches SAS sort nodupkey
    h = h.sort(["permno", "rdate_int", "cik_int"]).unique(
        subset=["permno", "rdate_int", "cik_int"], keep="first"
    )
    print(f"[join] after dedup: {len(h):,} rows")
    return h


# ---------------------------------------------------------------------------
# Step 4: IO metrics
# ---------------------------------------------------------------------------

def compute_io_metrics(holdings: pl.DataFrame) -> pl.DataFrame:
    """Aggregate to permno-quarter level: NumOwners, IO_TOTAL, HHI, DBREADTH.

    Matches SAS build_inst_own.sas lines 126-148.
    """
    h = holdings.filter(pl.col("shares_adj") > 0)

    io = h.group_by(["permno", "rdate_int"]).agg(
        pl.col("cik_int").n_unique().alias("numowners"),
        pl.col("NumInst").max().alias("NumInst"),
        pl.col("first_report").sum().alias("NewInst"),
        pl.col("last_report").sum().alias("OldInst"),
        pl.col("shares_adj").sum().alias("io_total"),
        (pl.col("shares_adj") ** 2).sum().alias("io_ss"),
    )

    # HHI
    io = io.with_columns(
        (pl.col("io_ss") / (pl.col("io_total") ** 2)).alias("ioc_hhi")
    )

    # DBREADTH: ((NumOwners - NewInst) - lag(NumOwners - OldInst)) / lag(NumInst)
    io = io.sort(["permno", "rdate_int"]).with_columns(
        (pl.col("numowners") - pl.col("OldInst")).alias("_continuing")
    ).with_columns(
        pl.col("_continuing").shift(1).over("permno").alias("_prev_continuing"),
        pl.col("NumInst").shift(1).over("permno").alias("_prev_numinst"),
    ).with_columns(
        pl.when(pl.col("_prev_continuing").is_null())
        .then(pl.lit(None, dtype=pl.Float64))
        .otherwise(
            (
                (pl.col("numowners") - pl.col("NewInst")) - pl.col("_prev_continuing")
            )
            / pl.col("_prev_numinst")
        )
        .alias("dbreadth")
    )

    return io.select([
        "permno", "rdate_int", "numowners", "io_total", "ioc_hhi", "dbreadth",
    ])


# ---------------------------------------------------------------------------
# Step 5: Final panel
# ---------------------------------------------------------------------------

def build_final_panel(
    io_metrics: pl.DataFrame, crsp_m: pl.DataFrame
) -> pl.DataFrame:
    """Join IO metrics with CRSP market data. Compute IOR and flags.

    Matches SAS build_inst_own.sas lines 151-166, extended to include
    permnos with IO data but no CRSP panel coverage (cfacshr=1 fallback).
    """
    # Part A: CRSP permnos (left join from crsp_m — preserves full CRSP panel)
    panel_crsp = crsp_m.select([
        "permno", "qdate_int", "P", "TSO", "ME", "cfacshr",
    ]).join(
        io_metrics,
        left_on=["permno", "qdate_int"],
        right_on=["permno", "rdate_int"],
        how="left",
    )

    # Part B: non-CRSP permnos that have IO data (cusip6 fallback recoveries)
    crsp_keys = crsp_m.select(["permno", "qdate_int"]).unique()
    io_only = io_metrics.join(
        crsp_keys,
        left_on=["permno", "rdate_int"],
        right_on=["permno", "qdate_int"],
        how="anti",
    ).with_columns(
        pl.col("rdate_int").cast(pl.Int32),
    ).with_columns(
        pl.lit(0.0).alias("P"),
        pl.lit(None, dtype=pl.Float64).alias("TSO"),
        pl.lit(None, dtype=pl.Float64).alias("ME"),
        pl.lit(1.0).alias("cfacshr"),
    ).rename({"rdate_int": "qdate_int"})

    if len(io_only) > 0:
        print(f"[panel] {len(io_only):,} IO observations for non-CRSP permnos added")

    panel = pl.concat([panel_crsp, io_only], how="diagonal")

    # IOR = IO_TOTAL / TSO (SAS line 156); null if no TSO
    panel = panel.with_columns(
        pl.when(pl.col("io_total").is_not_null() & pl.col("TSO").is_not_null() & (pl.col("TSO") > 0))
        .then(pl.col("io_total") / pl.col("TSO"))
        .otherwise(0.0)
        .alias("ior"),
        pl.col("io_total").is_null().alias("io_missing"),
    ).with_columns(
        (pl.col("ior") > 1.0).alias("io_g1"),
    )

    # Rename qdate_int → rdate for output (matches merge_panel expectation)
    panel = panel.rename({"qdate_int": "rdate", "P": "p", "TSO": "tso", "ME": "me"})

    # Sort and dedup
    panel = panel.sort(["rdate", "permno"]).unique(
        subset=["rdate", "permno"], keep="first"
    )

    return panel.select([
        "permno", "rdate", "numowners", "io_total", "ioc_hhi", "dbreadth",
        "ior", "tso", "me", "p", "cfacshr", "io_missing", "io_g1",
    ])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SHORTINT_CACHE = PROC / "short_interest.parquet"


def add_split_flags(panel: pl.DataFrame, crsp_m: pl.DataFrame) -> pl.DataFrame:
    """Flag split-adjacent quarters — the documented D1 mitigation, made usable.

    WRDS's splits note (March 2017) shows Thomson applying split adjustments twice
    and at the wrong date, and states plainly there is NO CLEAN SYSTEMIC FIX. Their
    own mitigation is to trim or winsorize Qtr(-1), Qtr(0), Qtr(+1) around each
    split. Outlier rates around split quarters run 13.8% at Qtr(0) and 14.1% at
    Qtr(-1) against a 5% null, rising to 40.7% for mutual funds at splits above 4:1.

    You cannot apply that mitigation without knowing which quarters are split
    adjacent, so this computes it. CRSP cfacshr is the source: it is constant for a
    permno until a split, so a change between consecutive quarters IS a split. No
    extra pull, and it is exact rather than a distribution-based guess.

    Flags rather than drops, deliberately. Dropping here would silently shrink every
    downstream sample and bury the choice inside a build script; the trade between
    coverage and split contamination belongs to the analysis, stated in its own
    methods section. `split_adjacent` is the winsorize-or-exclude switch.

    Note this matters MORE for anything S12-derived than for 13F: funds fare worse
    than 13Fs at large splits (40.7% vs 34.5% at >4:1).
    """
    q = (
        crsp_m.select(["permno", "qdate_int", "cfacshr"])
        .sort(["permno", "qdate_int"])
        .with_columns(
            (pl.col("cfacshr") != pl.col("cfacshr").shift(1).over("permno")).alias("chg"),
            pl.col("cfacshr").shift(1).over("permno").is_null().alias("first_obs"),
        )
        # The first observation for a permno has no predecessor, so `chg` is
        # meaningless there — treating it as a split would flag every firm's entry
        # into the panel.
        .with_columns((pl.col("chg") & ~pl.col("first_obs")).alias("split_quarter"))
    )
    q = q.with_columns(
        (
            pl.col("split_quarter")
            | pl.col("split_quarter").shift(-1).over("permno").fill_null(False)
            | pl.col("split_quarter").shift(1).over("permno").fill_null(False)
        ).alias("split_adjacent")
    ).select(["permno", "qdate_int", "split_quarter", "split_adjacent"])

    panel = panel.join(
        q, left_on=["permno", "rdate"], right_on=["permno", "qdate_int"], how="left"
    ).with_columns(
        pl.col("split_quarter").fill_null(False),
        pl.col("split_adjacent").fill_null(False),
    )
    n_s = int(panel.select(pl.col("split_quarter").sum()).item())
    n_a = int(panel.select(pl.col("split_adjacent").sum()).item())
    print(
        f"[split] {n_s:,} split quarters, {n_a:,} split-adjacent rows "
        f"({n_a / max(len(panel), 1):.2%} of panel) — flagged, not dropped"
    )
    return panel


def add_net_of_lending(panel: pl.DataFrame) -> pl.DataFrame:
    """Add ownership net of securities lending, for use as a VOTING weight.

    `ior` is the right measure of institutional OWNERSHIP and must not be capped: 13F
    is long-only, so a lent share is legitimately reported twice (lender plus the buyer
    who bought from the short seller), and above 100% is correct for a heavily shorted
    stock. WRDS's own support article leads with this cause; the violation rate rises
    0.51% -> 2.16% -> 6.99% -> 22.95% across short-interest buckets of 0-2 / 2-5 / 5-10
    / >10% of TSO.

    It is the WRONG measure of institutional VOTING POWER. A lent share carries no vote
    for the lender — the vote passes to the borrower unless the loan is recalled before
    the record date — so the double count inflates ownership but not votable shares.

        io_total_net = io_total - (shortint * cfacshr)

    cfacshr is applied here, not in the short-interest pull, because io_total is CRSP
    cfacshr-adjusted to a current-share basis while Compustat `shortint` is
    as-reported. Subtracting them unadjusted silently mixes bases across every split.

    BOUNDS, both directions, because no single number is defensible on its own:
      - SI understates shares on loan (borrowing also happens for hedging, tax and
        record-date vote acquisition), so this under-corrects.
      - It credits all lending to 13F institutions, though retail street-name shares are
        lent too, so it over-corrects.
      - It ignores recall before the record date, so it over-corrects again.
    Treat `ior` as an upper bound on institutional voting power and `ior_net` as a lower
    bound, and report both. Do not quietly swap one for the other.

    Rows with no short-interest match keep io_total_net = io_total and are flagged via
    si_missing, so a missing merge can never masquerade as zero lending.
    """
    if not SHORTINT_CACHE.exists():
        print(f"[net] {SHORTINT_CACHE} absent — skipping lending netting")
        return panel

    si = pl.read_parquet(SHORTINT_CACHE).select(["permno", "rdate", "shortint"])
    panel = panel.join(si, on=["permno", "rdate"], how="left")
    panel = panel.with_columns(
        pl.col("shortint").is_null().alias("si_missing"),
        (pl.col("shortint") * pl.col("cfacshr")).alias("shortint_adj"),
    ).with_columns(
        # Clamp at zero. A negative net means short interest exceeds REPORTED
        # institutional holdings, which happens when a large share of the lendable
        # supply is retail or non-13F. That is informative about the assumption, not
        # about the firm, so it is flagged rather than propagated as a negative block.
        pl.max_horizontal(
            pl.col("io_total") - pl.col("shortint_adj").fill_null(0.0),
            pl.lit(0.0),
        ).alias("io_total_net"),
        pl.when(pl.col("tso") > 0)
        .then(pl.col("shortint_adj") / pl.col("tso"))
        .otherwise(None)
        .alias("si_frac"),
    ).with_columns(
        pl.when(pl.col("tso") > 0)
        .then(pl.col("io_total_net") / pl.col("tso"))
        .otherwise(None)
        .alias("ior_net"),
        (
            (pl.col("io_total") - pl.col("shortint_adj")) < 0
        ).fill_null(False).alias("net_clamped"),
    )

    matched = panel.filter(~pl.col("si_missing"))
    n_clamp = int(panel.select(pl.col("net_clamped").sum()).item())
    print(
        f"[net] short interest matched on {len(matched):,} of {len(panel):,} rows "
        f"({len(matched) / max(len(panel), 1):.1%}); {n_clamp:,} clamped at zero"
    )
    return panel


def main():
    ap = argparse.ArgumentParser(description="Build 13F institutional ownership panel")
    ap.add_argument("--start", default="2003-01-01", help="Start date (YYYY-MM-DD)")
    ap.add_argument("--end", default="2025-12-31", help="End date (YYYY-MM-DD)")
    ap.add_argument("--user", default="eddyhu", help="WRDS username")
    ap.add_argument("--quarter", default=None, help="Single quarter for testing (e.g., 2020Q1)")
    ap.add_argument("--out", default=str(PROC / "inst_own.parquet"), help="Output path")
    ap.add_argument("--no-sas", action="store_true", help="Skip SAS .sas7bdat output")
    ap.add_argument("--no-pull", action="store_true", help="Use cached CRSP data")
    ap.add_argument("--d9-threshold", type=int, default=100_000,
                    help="Drop value=0 rows above this share count (D9 parser fix)")
    ap.add_argument("--cusip6-fallback", action=argparse.BooleanOptionalAction,
                    default=False,
                    help="Recover cusip8-unmatched holdings via cusip6. OFF by default: "
                         "D9 cause 2 -- cusip6 maps other share classes, preferreds and "
                         "warrants onto the common permno, inflating ownership past 100 pct. "
                         "Enabling it raises the impossible-ratio rate 3.0 pct -> 5.2 pct.")
    ap.add_argument("--no-d9-filter", action="store_true",
                    help="Disable the D9 value=0 filter (for measuring its effect)")
    args = ap.parse_args()

    t_start = time.time()

    # Resolve date range
    if args.quarter:
        year = int(args.quarter[:4])
        q = int(args.quarter[-1])
        qe_month = {1: 3, 2: 6, 3: 9, 4: 12}[q]
        qe_day = 30 if qe_month in (6, 9) else 31
        start_int = year * 10000 + (qe_month - 2) * 100 + 1
        end_int = year * 10000 + qe_month * 100 + qe_day
        crsp_start = f"{year}-01-01"
        crsp_end = f"{year}-12-31"
    else:
        start_int = int(args.start.replace("-", ""))
        end_int = int(args.end.replace("-", ""))
        crsp_start = args.start
        crsp_end = args.end

    # Step 0: CRSP data
    if args.no_pull and CRSP_CACHE.exists() and CUSIP_MAP_CACHE.exists():
        print(f"[crsp] loading cached {CRSP_CACHE}")
        crsp_m = pl.read_parquet(CRSP_CACHE)
        # --no-pull accepted whatever cache happened to be on disk, with no
        # check that it covered all four quarters or the requested date range.
        # That is how a March/December-only cache survived into the panel.
        _assert_all_quarters(crsp_m)
        cusip_map = pl.read_parquet(CUSIP_MAP_CACHE)
    else:
        crsp_m = pull_crsp_monthly(args.user, crsp_start, crsp_end)
        cusip_map = pull_cusip8_permno_map(args.user)

    # Load cusip6→permno fallback map
    cusip6_map_path = PROC / "cusip_map.parquet"
    if cusip6_map_path.exists():
        cusip6_map = pl.read_parquet(cusip6_map_path)
        print(f"[cusip6] loaded {len(cusip6_map):,} cusip6→permno fallback mappings")
    else:
        # Derive from cusip8 map: take first permno per cusip6
        cusip6_map = (
            cusip_map.with_columns(pl.col("ncusip").str.slice(0, 6).alias("cusip6"))
            .group_by("cusip6")
            .agg(pl.col("permno").first())
        )
        print(f"[cusip6] derived {len(cusip6_map):,} cusip6→permno from cusip8 map")

    # Step 1: 13F holdings
    holdings = load_13f_holdings(
        start_int, end_int,
        zero_value_shares_threshold=(None if args.no_d9_filter else args.d9_threshold),
    )

    # Step 2: manager entry/exit markers
    mgr_markers = build_manager_markers(holdings)

    # Step 3: join and adjust
    adjusted = join_and_adjust(
        holdings, mgr_markers, cusip_map, cusip6_map, crsp_m,
        use_cusip6_fallback=args.cusip6_fallback,
    )

    # Step 4: IO metrics
    io_metrics = compute_io_metrics(adjusted)
    print(f"[io] {len(io_metrics):,} permno-quarter IO observations")

    # Step 5: final panel
    panel = build_final_panel(io_metrics, crsp_m)
    print(f"[panel] {len(panel):,} rows in final panel")

    # Step 5b: D1 split-adjacent flags, then net securities lending out
    panel = add_split_flags(panel, crsp_m)
    panel = add_net_of_lending(panel)

    # Diagnostics
    has_io = panel.filter(~pl.col("io_missing"))
    print(f"[panel] {len(has_io):,} with IO data, {len(panel) - len(has_io):,} missing")
    if len(has_io) > 0:
        ior_stats = has_io.select(pl.col("ior")).describe()
        print(f"[panel] IOR stats:\n{ior_stats}")
        numown_stats = has_io.select(pl.col("numowners")).describe()
        print(f"[panel] NumOwners stats:\n{numown_stats}")

    # Step 6: output
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    panel.write_parquet(out_path)
    print(f"[out] wrote {out_path} ({len(panel):,} rows)")

    if not args.no_sas:
        sas_path = out_path.with_suffix(".xpt")
        # pyreadstat writes SAS transport (xport) format; no sas7bdat writer
        pdf = panel.to_pandas()
        pdf["rdate"] = pd.to_datetime(pdf["rdate"].astype(str), format="%Y%m%d")
        # xport has 8-char column name limit — truncate
        col_map = {
            "numowners": "NUMOWN", "io_total": "IO_TOT", "ioc_hhi": "IOC_HHI",
            "dbreadth": "DBREADTH", "io_missing": "IO_MISS", "io_g1": "IO_G1",
            "cfacshr": "CFACSHR", "permno": "PERMNO", "rdate": "RDATE",
            "ior": "IOR", "tso": "TSO", "me": "ME", "p": "P",
        }
        pdf = pdf.rename(columns=col_map)
        pyreadstat.write_xport(pdf, str(sas_path))
        print(f"[out] wrote {sas_path}")

    print(f"[done] total time: {time.time() - t_start:.1f}s")


if __name__ == "__main__":
    main()
