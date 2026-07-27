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
import os
import sys
import time
from pathlib import Path

# DETERMINISM: pin polars to one thread BEFORE importing it.
#
# Multi-threaded float summation reduces partial sums in whatever order the
# threads finish, so io_total lands within ~1 ULP of a different value run to
# run. That is not a rounding curiosity you can hash your way around: measured
# on two runs of this leg, canonical_hash.py disagreed (49ef9268 vs e7dcd716)
# with 101 cells still differing at 12 significant digits — and at 8 digits it
# was WORSE, 311 cells, because coarser rounding puts MORE values exactly on a
# half-way boundary where a 1-ULP nudge flips which way they go. Reducing
# precision makes this worse, not better.
#
# Single-threaded, the digest is identical across runs. It costs ~2.1x on this
# leg, which is off the critical path (the DAG is bounded by tfn_holdings x9
# and the N-PX array), so reproducibility is the better trade.
#
# It is set HERE rather than in the job script because polars reads the value
# at import: an env var exported by a wrapper is one forgotten line away from a
# panel whose digest silently stops reproducing. Override deliberately with
# POLARS_MAX_THREADS if you want the speed and do not need a frozen digest.
os.environ.setdefault("POLARS_MAX_THREADS", "1")

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
# crsp.msenames and crsp.msf freeze on the same date; keep it in one place.
LEGACY_NAMES_END = "2024-12-31"

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

# DATE-BOUNDED. The undated form of this query -- SELECT DISTINCT ncusip, permno
# -- maps EVERY historical CUSIP a permno ever carried to it, for all time. A
# 2020 holding tagged with the 1985 ALLIED SIGNAL cusip (01951210) then resolves
# to Honeywell's permno 10145, because CRSP records both under it:
#
#   permno 10145  01951210  ALLIED SIGNAL INC          1985-09-19 .. 1999-12-01
#   permno 10145  43851610  HONEYWELL INTERNATIONAL    1999-12-02 ..
#   permno 10401  00195710  A T & T CORP               1994-04-21 .. 2002-11-18
#   permno 10401  00195750  A T & T CORP               2002-11-19 .. 2005-11-18
#
# Those are SUCCESSIONS, never concurrent. The undated join manufactured a
# second row per (permno, rdate, cik), which the downstream
# unique(subset=[permno,rdate,cik], keep="first") then resolved BY COIN FLIP --
# sorting on exactly the dedup key leaves ties in arbitrary order. Measured on
# 2018-2022: 8,804 such groups, 44.5% with a second position over half the size
# of the first. So io_total for those cells was one draw, not an answer.
#
# Same shape as every other defect in this file: a join that silently
# over-matches and returns plausible numbers. Note the CRSP monthly query above
# ALREADY does the dated join correctly -- it was simply never propagated here.
CUSIP8_PERMNO_QUERY = """
SELECT DISTINCT ncusip, permno, namedt, nameendt
FROM crsp.msenames
WHERE ncusip IS NOT NULL AND ncusip != ''
"""

# THE NAMES TABLE IS FROZEN TOO, AND DATING THE JOIN IS WHAT EXPOSED IT.
#
# crsp.msenames stops with the legacy product: max(nameendt) = 2024-12-31 and
# NOT ONE of its 83,815 common-stock rows has a NULL nameendt. So the
# `nameendt IS NULL -> 29991231` branch above never fires, every validity window
# closes on or before 2024-12-31, and `rdate_int <= nameendt_int` drops every
# 2025 holding. Measured before this splice: 2025 got 0 cusip8 matches and all
# 15,546 of its panel rows carried io_total = NULL.
#
# That is the SAME hole the msf/msf_v2 splice above exists to close, one table
# over — and it is invisible without the date bound, because the undated join
# matched 2025 rows on a stale window and returned plausible numbers. Fixing the
# over-match uncovered an under-match.
#
# crsp.stocknames_v2 is the CIZ successor and runs to 2025-12-31. Spliced on the
# same terms as the monthly: EXTEND, never replace. Only windows reaching past
# the legacy boundary are taken and their start is clamped to it, so every
# historical quarter keeps its legacy window and the difference is confined to
# dates that had no window at all. Share-class filter is byte-identical to
# CRSP_MONTHLY_V2_QUERY so the names and the prices admit the same universe.
CUSIP8_PERMNO_V2_QUERY = """
SELECT DISTINCT cusip AS ncusip, permno, namedt, nameenddt AS nameendt
FROM crsp.stocknames_v2
WHERE cusip IS NOT NULL AND cusip != ''
  AND sharetype = 'NS'
  AND securitytype = 'EQTY'
  AND securitysubtype = 'COM'
  AND usincflg = 'Y'
  AND COALESCE(nameenddt, '2099-12-31') >= %(v2_start)s
"""

# First date the CIZ names table owns. The legacy table's windows CLOSE on
# LEGACY_NAMES_END, and 2024-12-31 is itself a 13F quarter-end, so a v2 window
# clamped to the boundary rather than the day after would double-match Q4 2024
# and reintroduce exactly the duplicate this file now asserts against.
V2_NAMES_START = "2025-01-01"


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

    # Keep last observation per (permno, qdate) — end-of-quarter snapshot.
    #
    # The tie-break is stated INSIDE the aggregation, not implied by a preceding
    # sort. This used to be `.sort([..., "date_int"]).group_by([...]).last()`,
    # which relies on group_by preserving a prior sort — something polars does not
    # promise. `.last()` then means "whichever row the reduction saw last", and on
    # a multithreaded run that is not necessarily the latest `date_int`; the
    # quarter's snapshot could come from any month in it.
    #
    # This is the same defect class as the leg-5 `group_by().last()` and the F7
    # accession dedup, and it is NOT fixed by POLARS_MAX_THREADS=1: pinning
    # threads fixes a *sum*, whose answer is well defined and only reduction order
    # varies. A row *selection* among ties has no defined answer at all, so a pin
    # merely freezes one arbitrary pick and puts a stable digest on top of it.
    # This site needs a rule, and `sort_by("date_int").last()` is that rule.
    #
    # It matters more than most: this collapse produces TSO, P, ME and cfacshr for
    # every (permno, quarter) — the ownership denominator, and the cfacshr the
    # split-basis correction depends on.
    crsp = crsp.group_by(["permno", "qdate_int"]).agg(
        pl.exclude(["permno", "qdate_int"]).sort_by("date_int").last()
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
    df2 = pd.read_sql(CUSIP8_PERMNO_V2_QUERY, conn,
                      params={"v2_start": V2_NAMES_START})
    conn.close()
    if len(df2):
        # COLLAPSE TO ONE WINDOW PER (cusip, permno), THEN clamp. stocknames_v2
        # carries a separate row per name segment, so clamping first and
        # concatenating would hand the join several windows for the same pair,
        # all starting on the same day — overlapping windows that fan a single
        # holding into several rows. Collapsing to [min(namedt), max(nameenddt)]
        # is safe because every segment resolves to the SAME permno, so widening
        # within the pair cannot change which permno a cusip maps to.
        df2["namedt"] = pd.to_datetime(df2["namedt"])
        df2["nameendt"] = pd.to_datetime(df2["nameendt"])
        df2 = (df2.groupby(["ncusip", "permno"], as_index=False)
                  .agg(namedt=("namedt", "min"), nameendt=("nameendt", "max")))
        df2["namedt"] = df2["namedt"].clip(lower=pd.Timestamp(V2_NAMES_START))
        df = pd.concat([df, df2], ignore_index=True)
    print(f"[cusip] {len(df2):,} CIZ name windows from {V2_NAMES_START} "
          f"(crsp.msenames ends {LEGACY_NAMES_END})")

    cmap = pl.from_pandas(df).with_columns(
        pl.col("ncusip").cast(pl.Utf8),
        pl.col("permno").cast(pl.Int64),
        # YYYYMMDD ints so the validity window compares directly against
        # rdate_int without a date cast on 97M rows.
        (pl.col("namedt").cast(pl.Date).dt.year().cast(pl.Int64) * 10000
         + pl.col("namedt").cast(pl.Date).dt.month().cast(pl.Int64) * 100
         + pl.col("namedt").cast(pl.Date).dt.day().cast(pl.Int64)
         ).cast(pl.Int32).alias("namedt_int"),
        pl.when(pl.col("nameendt").is_null())
        .then(pl.lit(29991231, dtype=pl.Int32))
        .otherwise(
            (pl.col("nameendt").cast(pl.Date).dt.year().cast(pl.Int64) * 10000
             + pl.col("nameendt").cast(pl.Date).dt.month().cast(pl.Int64) * 100
             + pl.col("nameendt").cast(pl.Date).dt.day().cast(pl.Int64)
             ).cast(pl.Int32)
        ).alias("nameendt_int"),
    )
    # A cusip8 may map to multiple permnos ACROSS TIME; the window is what
    # separates them, so it is part of the key.
    cmap = cmap.select(["ncusip", "permno", "namedt_int", "nameendt_int"]).unique()
    cmap.write_parquet(CUSIP_MAP_CACHE)
    print(f"[cusip] {len(cmap):,} unique (ncusip, permno) pairs "
          f"(max window end {cmap['nameendt_int'].max()}) ({time.time() - t0:.1f}s)")
    return cmap


# ---------------------------------------------------------------------------
# Step 1: Load and clean 13F holdings
# ---------------------------------------------------------------------------

def _assert_holdings_present(pattern: str, min_files: int = 100) -> None:
    """Fail with the RIGHT diagnosis if the holdings input has been purged.

    WRDS /scratch purges by mtime on roughly a 7-day window, and it removes FILES
    while leaving the directory shells — so a glob still resolves, the scan still
    plans, and the failure surfaces downstream as "0 rows" or "year N resolved 0
    matches". Every guard in this file would fire correctly and blame the DATA.

    The trap that caused it is worth naming: `tar` preserves mtimes by default, so
    a 3.3 GB holdings tree shipped from a workstation arrives carrying its ORIGINAL
    dates. Ours landed ~80 days old and was purged at ~00:01 the same night,
    untouched by anything in the pipeline. Ship with `tar -m` so extraction time
    becomes the mtime.

    This can also strike MID-RUN, which is the case that most needs naming: legs
    that already read the input succeed, later legs see nothing, and the panel
    looks internally inconsistent rather than truncated.

    So check the input before planning any work, and say "purge" rather than
    letting a data guard take the blame.
    """
    import glob as _glob

    files = _glob.glob(pattern)
    if len(files) >= min_files:
        oldest = min(Path(f).stat().st_mtime for f in files)
        age_days = (time.time() - oldest) / 86400
        print(f"[13f] {len(files)} partition files, oldest mtime {age_days:.1f}d old")
        if age_days > 5:
            print(
                f"[13f] WARNING: oldest input file is {age_days:.1f} days old. WRDS "
                f"/scratch purges around 7 days BY MTIME — re-ship with `tar -m`, or "
                f"touch the tree, before this run or a later one loses its input "
                f"mid-flight."
            )
        return

    raise FileNotFoundError(
        f"holdings input has {len(files)} files at {pattern}, expected >= {min_files}. "
        "The directory shells surviving with no parquet inside them is the signature "
        "of the WRDS /scratch mtime purge (~7 days), NOT a data defect — check "
        "`ls -la` and the mtimes before treating this as a pipeline bug. Re-ship the "
        "tree with `tar -m` so extraction time becomes the mtime; without -m tar "
        "preserves the ORIGINAL dates and a freshly shipped tree can be purged the "
        "same night."
    )


def load_13f_holdings(
    start_int: int, end_int: int, zero_value_shares_threshold: int | None = 100_000
) -> pl.DataFrame:
    """Load 13F parser output, apply F1 (rdate snap) and F2/F7 (amendment dedup).

    LAZY END TO END, collected once with the streaming engine. This is a memory
    constraint, not a style choice: the WRDS grid caps a job at 48 GB (cgroups),
    and the eager version peaked at 106.5 GB maxrss and was killed there — it
    only ever fit on a 251 GB workstation. Column projection alone (24 -> 8) took
    it from 198.8 GB to 106.5 GB, which was enough locally and not enough on the
    grid.

    What made it eager was the DIAGNOSTICS, not the arithmetic. Every
    `len(holdings)` between steps forced the full 153M-row frame to materialise
    just to print a row count. They are now separate cheap `select(pl.len())`
    collects against the lazy plan, so the counts still print and nothing is
    held.

    Deliberately NOT chunked by year. build_manager_markers uses
    shift(1).over(cik_int) ACROSS quarters, so a year-chunked run would reset
    every manager's first_report each January and silently corrupt DBREADTH —
    a wrong number rather than a crash.
    """
    print(f"[13f] loading holdings ({start_int} to {end_int})...")
    t0 = time.time()

    NEEDED = [
        "cik", "period_of_report", "filed_date",
        "form_type", "accession", "cusip8", "shares", "value",
    ]
    _pattern = str(PROC / "holdings_13f" / "year=*" / "Q*.parquet")
    _assert_holdings_present(_pattern)
    lf = (
        pl.scan_parquet(_pattern)
        .select(NEEDED)
        .with_columns(
            pl.col("period_of_report").cast(pl.Int64).alias("rdate_raw"),
            pl.col("filed_date").cast(pl.Int64).alias("fdate_int"),
            pl.col("cik").cast(pl.Int64).alias("cik_int"),
        )
        .filter(
            (pl.col("rdate_raw") >= start_int) & (pl.col("rdate_raw") <= end_int)
        )
        # F1: snap rdate to quarter-end
        .with_columns(snap_to_quarter_end(pl.col("rdate_raw")).alias("rdate_int"))
        .with_columns(
            pl.col("form_type")
            .replace_strict(FORM_PRIORITY, default=0)
            .alias("form_priority")
        )
    )

    def _n(frame: pl.LazyFrame) -> int:
        """Row count without materialising the frame."""
        return int(frame.select(pl.len()).collect(engine="streaming").item())

    n_raw = _n(lf)
    print(f"[13f] {n_raw:,} raw rows ({time.time() - t0:.1f}s)")

    # Exclude filings >365 days after the reporting period.
    lf = lf.filter((pl.col("fdate_int") - pl.col("rdate_int")) <= 10000)
    n_recent = _n(lf)
    print(f"[13f]   dropped {n_raw - n_recent:,} rows filed >~1yr after period")

    # F2+F7: one accession per (cik, rdate) — the latest filing supersedes all
    # earlier ones for that quarter. Resolves ~130K share-mismatch rows from
    # multi-accession double counting.
    #
    # `sort_by(...).last()` INSIDE the aggregation rather than a global sort
    # followed by group_by().last(). The old form relied on group_by preserving
    # a prior sort, which polars does not guarantee and the streaming engine
    # certainly does not — it happened to hold, which is not the same as being
    # correct. This states the tie-break where it is applied:
    # latest fdate -> highest form_priority -> latest accession string.
    print("[13f] deduplicating filings (F7: one accession per cik×rdate)...")
    best_filing = (
        lf.select(["cik_int", "rdate_int", "fdate_int", "form_priority", "accession"])
        .unique(subset=["cik_int", "rdate_int", "accession"])
        .group_by(["cik_int", "rdate_int"])
        .agg(
            pl.col("accession")
            .sort_by(["fdate_int", "form_priority", "accession"])
            .last()
            .alias("best_acc")
        )
    )

    n_multi = _n(
        best_filing.join(
            lf.select(["cik_int", "rdate_int", "accession"]).unique(),
            on=["cik_int", "rdate_int"],
        )
        .filter(pl.col("accession") != pl.col("best_acc"))
        .select(["cik_int", "rdate_int"])
        .unique()
    )
    print(f"[13f]   {n_multi:,} (cik, rdate) pairs had multiple accessions → kept latest")

    lf = (
        lf.join(best_filing, on=["cik_int", "rdate_int"])
        .filter(pl.col("accession") == pl.col("best_acc"))
        .drop(["best_acc", "form_priority"])
    )
    n_dedup = _n(lf)
    print(f"[13f]   after dedup: {n_dedup:,} rows")

    # D9: drop text-parser rows carrying value = 0 with a large share count.
    # `value` is reported in $1000s, so a genuine holding worth under $1,000
    # cannot also carry 100,000 shares at any plausible price. These are parse
    # failures, not holdings: AAPL 2003-09-30 was ONE such row (cik 728100,
    # 719,257,141 shares, value 0) against a next-largest holder of 19.8M, and
    # the same filer reports 3,038,253,827 shares of Exxon Mobil — more than
    # Exxon's entire float.
    #
    # The threshold is load-bearing. At T = 0 the rule removes 2,820,455 rows
    # for the SAME 13.9% of share mass — 33x the rows for no extra benefit —
    # because a legitimate sub-$1,000 holding rounds to value = 0 (median such
    # row: 479 shares). T = 100,000 captures 99.9% of the bad mass at 3% of the
    # row cost.
    #
    # NOT WRDS's rule. Their May 2017 note prescribes `if pct > 0.5 then
    # pct = 0.5` — a cap, not a repair, scoped to 2013+ and explicitly
    # provisional. Capping leaves a fabricated 50% holding standing, which is
    # the clipping that makes this defect invisible in vendor panels.
    if zero_value_shares_threshold is not None:
        lf = lf.filter(
            ~((pl.col("value") == 0) & (pl.col("shares") > zero_value_shares_threshold))
        )
        n_d9 = _n(lf)
        print(
            f"[13f]   D9: dropped {n_dedup - n_d9:,} rows with value=0 and "
            f"shares>{zero_value_shares_threshold:,}"
        )

    # Aggregate sub-managers to (cik, cusip8, rdate). This is the one collect
    # that produces the working frame, and it is the point of the whole lazy
    # chain: ~97M aggregated rows instead of ~153M raw ones, with the wide
    # string columns already dropped.
    agg = (
        lf.group_by(["cik_int", "cusip8", "rdate_int"])
        .agg(pl.col("shares").sum().alias("shares"))
        .filter(pl.col("shares") > 0)
        # F6 safety net: drop concatenated value+shares (parser bug residual)
        .filter(pl.col("shares") < 10_000_000_000)
        .with_columns(pl.col("cusip8").str.slice(0, 6).alias("cusip6"))
        .collect(engine="streaming")
    )
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
    stats: dict | None = None,
) -> pl.DataFrame:
    """Map cusip8→permno (with cusip6 fallback), adjust shares by cfacshr, dedup.

    Primary match: cusip8 = ncusip (exact 8-char).
    Fallback: cusip6 = ncusip[:6] for unmatched holdings (matches SAS
    build_meetings.sas line 236: substr(cusip,1,6)=substr(ncusip,1,6)).
    """
    # LAZY from here. The eager form peaked at 79.4 GB against the WRDS grid's
    # 48 GB cgroup cap, and the RSS trace put the spike HERE, not in the load:
    # the frame roughly doubles across the permno join and the cfacshr join.
    h = holdings.lazy().join(mgr_markers.lazy(), on=["cik_int", "rdate_int"], how="left")

    def _n(frame: pl.LazyFrame) -> int:
        return int(frame.select(pl.len()).collect(engine="streaming").item())

    # Primary: CUSIP8 → PERMNO
    matched8 = (
        h.join(cusip_map.lazy(), left_on="cusip8", right_on="ncusip", how="inner")
        # The date window is the whole point of the dated map: keep only the
        # permno this cusip belonged to AT the reporting date.
        .filter(
            (pl.col("rdate_int") >= pl.col("namedt_int"))
            & (pl.col("rdate_int") <= pl.col("nameendt_int"))
        )
        .drop(["namedt_int", "nameendt_int"])
    )

    # The anti-join is only needed to FEED the fallback. Computing it
    # unconditionally meant a second full pass over ~97M rows purely to print a
    # number that, with the fallback off (the default since D9 cause 2), nothing
    # then consumed.
    if use_cusip6_fallback:
        unmatched = h.join(
            matched8.select(["cik_int", "rdate_int", "cusip8"]).unique(),
            on=["cik_int", "rdate_int", "cusip8"], how="anti",
        )
        print(f"[join] cusip8 match: {_n(matched8):,}, unmatched: {_n(unmatched):,}")
    else:
        unmatched = None
        print(f"[join] cusip8 match: {_n(matched8):,}")

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
        matched6 = unmatched.join(cusip6_map.lazy(), on="cusip6", how="inner")
        _c6 = _n(matched6)
        if stats is None:
            print(f"[join] cusip6 fallback: {_c6:,} recovered")
        else:
            stats["m6"] = stats.get("m6", 0) + _c6
        h = pl.concat([matched8, matched6])
    else:
        if stats is None:
            print(
                "[join] cusip6 fallback DISABLED (D9 cause 2: cusip6 maps other share "
                "classes/preferreds onto the common permno)"
            )
        h = matched8
    _cus = _n(h)
    if stats is None:
        print(f"[join] after cusip→permno: {_cus:,} rows")
    else:
        stats["after_cusip"] = stats.get("after_cusip", 0) + _cus

    # Join with CRSP for cfacshr at rdate (LEFT — keep holdings without CRSP;
    # default cfacshr=1 for permnos not in CRSP monthly panel, since the
    # canonical IOR is recomputed in merge_panel using ISS tso anyway)
    h = h.join(
        crsp_m.lazy().select(["permno", "qdate_int", "cfacshr", "P"]),
        left_on=["permno", "rdate_int"],
        right_on=["permno", "qdate_int"],
        how="left",
    )
    # Both counts in ONE streaming pass. Two separate scans (a filtered .shape[0]
    # then a len()) meant materialising the widest frame in the pipeline twice,
    # which is where the 79.4 GB peak came from.
    _stats = (
        h.select(
            pl.len().alias("n_rows"),
            pl.col("cfacshr").is_null().sum().alias("n_no_crsp"),
        )
        .collect(engine="streaming")
    )
    n_rows, n_no_crsp = int(_stats["n_rows"][0]), int(_stats["n_no_crsp"][0])
    h = h.with_columns(
        pl.col("cfacshr").fill_null(1.0),
        pl.col("P").fill_null(0.0),
    )
    if stats is None:
        print(f"[join] after crsp join: {n_rows:,} rows ({n_no_crsp:,} without CRSP, cfacshr=1)")
    else:
        stats["after_crsp"] = stats.get("after_crsp", 0) + n_rows
        stats["no_crsp"] = stats.get("no_crsp", 0) + n_no_crsp

    # Share adjustment (SAS line 117)
    h = h.with_columns(
        (pl.col("shares").cast(pl.Float64) * pl.col("cfacshr")).alias("shares_adj")
    )

    # (permno, rdate, cik) must already be unique — ASSERT it, do not dedup it.
    #
    # This used to be `.sort([...]).unique(subset=[...], keep="first")`, sorting
    # on EXACTLY the dedup key, which leaves ties in arbitrary order and picked
    # a survivor by coin flip. It had ties to resolve only because the undated
    # cusip->permno map manufactured them: 8,804 groups in 2018-2022, 44.5% with
    # a second position over half the size of the first. With the dated join the
    # duplicates are gone at source and this removes zero rows.
    #
    # So keeping a silent dedup here would only hide the NEXT thing that
    # reintroduces duplicates. Assert instead: cheap (a group-by count rather
    # than a full sort of 86M rows, which was the memory peak), and a future
    # regression fails loudly instead of resolving itself at random.
    h = h.collect(engine="streaming")
    n_dup = (
        h.group_by(["permno", "rdate_int", "cik_int"])
        .len()
        .filter(pl.col("len") > 1)
        .height
    )
    if n_dup:
        raise ValueError(
            f"{n_dup:,} (permno, rdate, cik) groups carry multiple rows. That key "
            "must be unique before aggregation. The historical cause was an "
            "undated cusip->permno join mapping a superseded CUSIP onto the "
            "successor's permno; check the namedt/nameendt window before "
            "reaching for a dedup, because a dedup here picks a survivor at "
            "random."
        )
    if stats is None:
        print(f"[join] {len(h):,} rows, (permno, rdate, cik) unique — asserted, not deduped")
    else:
        stats["final"] = stats.get("final", 0) + len(h)
    return h


# ---------------------------------------------------------------------------
# Step 4: IO metrics
# ---------------------------------------------------------------------------

def io_partial(holdings: pl.DataFrame) -> pl.DataFrame:
    """Per-(permno, rdate) aggregate half of compute_io_metrics.

    Year-safe: every key contains rdate_int and every aggregate is a within-cell
    sum/max/n_unique. The part that is NOT year-safe — the DBREADTH lag — lives
    in finalize_io_metrics and runs once over the whole panel.
    """
    h = holdings.filter(pl.col("shares_adj") > 0)
    return h.group_by(["permno", "rdate_int"]).agg(
        pl.col("cik_int").n_unique().alias("numowners"),
        pl.col("NumInst").max().alias("NumInst"),
        pl.col("first_report").sum().alias("NewInst"),
        pl.col("last_report").sum().alias("OldInst"),
        pl.col("shares_adj").sum().alias("io_total"),
        (pl.col("shares_adj") ** 2).sum().alias("io_ss"),
    )


def join_adjust_and_aggregate(
    holdings: pl.DataFrame,
    mgr_markers: pl.DataFrame,
    cusip_map: pl.DataFrame,
    cusip6_map: pl.DataFrame,
    crsp_m: pl.DataFrame,
    use_cusip6_fallback: bool = True,
) -> pl.DataFrame:
    """join_and_adjust + io_partial, ONE REPORTING YEAR AT A TIME.

    The RSS trace peaks at the end of join_and_adjust, not in the load: the 86M
    x ~12 joined frame is materialised in full and nothing downstream needs it —
    compute_io_metrics immediately reduces it to ~675K permno-quarter rows. Going
    lazy end-to-end took the leg 106.5 -> 79.4 -> ~51 GB, still over the grid's
    48 GB cgroup cap. Slicing the join by year removes the peak instead of
    shrinking it: only ~1/23 of the joined frame exists at once, and what
    accumulates is the aggregate.

    Exact, for the same reason the loader's per-year pass is: every lookup joined
    in is small and global (cusip_map, cusip6_map, crsp_m, mgr_markers — all
    built over the WHOLE panel and passed in whole), and the only grouped
    operations key on (permno, rdate_int, ...) with rdate_int in the key, so no
    group straddles a year boundary. mgr_markers in particular carries the
    cross-quarter shift(1).over(cik_int) and is computed by the CALLER before
    this runs — the chunking never sees it.
    """
    years = sorted(
        holdings.select((pl.col("rdate_int") // 10000).alias("y"))
        .unique()["y"].to_list()
    )
    stats: dict = {}
    parts: list[pl.DataFrame] = []
    for y in years:
        hy = holdings.filter((pl.col("rdate_int") // 10000) == y)
        j = join_and_adjust(
            hy, mgr_markers, cusip_map, cusip6_map, crsp_m,
            use_cusip6_fallback, stats=stats,
        )
        # A year that resolves NOTHING is the shape of a frozen reference table,
        # not of thin data: crsp.msenames ending 2024-12-31 gave 2025 exactly
        # this — 0 matches and a full year of null ownership that still looked
        # like a complete panel. Cheap to check here because the chunking
        # already gives per-year counts.
        if j.height == 0:
            raise ValueError(
                f"reporting year {y} resolved 0 rows through cusip8->permno. "
                f"A whole year matching nothing means the reference window does "
                f"not cover it — check that the cusip map extends past "
                f"{LEGACY_NAMES_END} (crsp.msenames freezes there; "
                f"crsp.stocknames_v2 continues)."
            )
        parts.append(io_partial(j))
        del hy, j

    if use_cusip6_fallback:
        print(f"[join] cusip6 fallback: {stats.get('m6', 0):,} recovered")
    else:
        print("[join] cusip6 fallback DISABLED (D9 cause 2: cusip6 maps other share "
              "classes/preferreds onto the common permno)")
    print(f"[join] after cusip→permno: {stats.get('after_cusip', 0):,} rows")
    print(f"[join] after crsp join: {stats.get('after_crsp', 0):,} rows "
          f"({stats.get('no_crsp', 0):,} without CRSP, cfacshr=1)")
    print(f"[join] {stats.get('final', 0):,} rows, (permno, rdate, cik) unique — "
          f"asserted, not deduped, over {len(years)} reporting years")

    out = pl.concat(parts, how="vertical")

    # THE PER-CHUNK UNIQUENESS ASSERTION IS ONLY AS GOOD AS THE CHUNK BOUNDARY.
    # join_and_adjust asserts (permno, rdate_int, cik_int) uniqueness inside each
    # year, which is equivalent to asserting it globally ONLY BECAUSE the chunk
    # key (rdate_int // 10000) is a function of rdate_int, which is itself part
    # of the assertion key — so two rows sharing that key necessarily share a
    # chunk and cannot slip past by straddling one.
    #
    # That is an argument, and finalize_io_metrics re-groups by
    # (permno, rdate_int), which would SILENTLY SUM a leak rather than fail. So
    # check the argument instead of trusting it: after concatenation each
    # (permno, rdate_int) must appear exactly once. Cheap — this frame is ~675K
    # rows, not 91M.
    leaked = out.height - out.select(["permno", "rdate_int"]).unique().height
    if leaked:
        raise ValueError(
            f"{leaked:,} (permno, rdate_int) keys appear in more than one year "
            f"chunk. The per-year uniqueness assertion is therefore not "
            f"equivalent to a global one, and finalize_io_metrics would sum the "
            f"duplicates silently. Chunking must partition on a function of "
            f"rdate_int for that equivalence to hold."
        )
    return out


def finalize_io_metrics(io: pl.DataFrame) -> pl.DataFrame:
    """HHI + DBREADTH over the WHOLE permno-quarter panel.

    Must not be chunked: the DBREADTH lag is shift(1).over(permno) across
    quarters, so a per-year pass would make every January look like a permno's
    first observation. Safe here because io_partial has already collapsed the
    panel to ~675K rows.
    """
    io = io.group_by(["permno", "rdate_int"]).agg(
        pl.col("numowners").sum().alias("numowners"),
        pl.col("NumInst").max().alias("NumInst"),
        pl.col("NewInst").sum().alias("NewInst"),
        pl.col("OldInst").sum().alias("OldInst"),
        pl.col("io_total").sum().alias("io_total"),
        pl.col("io_ss").sum().alias("io_ss"),
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

    io = io.select([
        "permno", "rdate_int", "numowners", "io_total", "ioc_hhi", "dbreadth",
    ])
    # The one collect for this stage: the aggregate, not the 86M-row input.
    return io.collect(engine="streaming") if isinstance(io, pl.LazyFrame) else io


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

    # Sort for a stable output order, then ASSERT the grain — do not dedup it.
    #
    # This used to be `.sort(["rdate","permno"]).unique(subset=["rdate","permno"],
    # keep="first")`: the sort key EQUALLED the dedup key, so every row in a
    # duplicate group was a tie and `keep="first"` picked one by row order. If the
    # sort key equals the dedup key there is no tie-break — the same construction
    # already removed at the (permno, rdate, cik) site above.
    #
    # It is also a no-op, and provably so: `panel_crsp` is unique because `crsp_m`
    # is one row per (permno, qdate_int) by construction (see the aggregation in
    # load_crsp_monthly), `io_only` is anti-joined against exactly those keys, and
    # io_metrics uniqueness is already asserted by the cross-chunk leak check. So
    # a silent dedup here can only ever hide the next thing that breaks one of
    # those three invariants. Assert instead: free when it holds, loud when it
    # does not.
    panel = panel.sort(["rdate", "permno"])
    n_dup = panel.height - panel.select(["rdate", "permno"]).unique().height
    if n_dup:
        raise ValueError(
            f"{n_dup:,} duplicate (rdate, permno) keys in the final panel. "
            "One of three invariants broke: crsp_m unique per (permno, qdate_int), "
            "io_only anti-joined against those keys, or io_metrics unique per "
            "(permno, rdate_int). Fix the source — do not dedup here."
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


def _assert_no_dead_tail(panel: pl.DataFrame, col: str = "io_total",
                         null_threshold: float = 0.99, min_periods: int = 1) -> None:
    """Fail if `col` is (near-)entirely null for a contiguous TAIL of quarters.

    THIS GUARD EXISTS BECAUSE I BUILT ITS DETECTOR AND THEN SHIPPED THE BUG IT
    DETECTS. crsp.msf is frozen at 2024-12-31, which silently nulled every 2025
    quarter; that was found, fixed by splicing msf_v2, and generalised into
    `detect_join_coverage_tail` in the wrds skill. Then the dated cusip->permno
    join reintroduced exactly the same failure through a DIFFERENT frozen table:
    crsp.msenames also stops at 2024-12-31 and has ZERO null nameendt, so every
    validity window closes there and `rdate <= nameendt` dropped all of 2025 —
    0 cusip8 matches, io_total null for all 15,546 rows. Fixed by splicing
    crsp.stocknames_v2.

    A detector that lives in a test suite catches nothing at build time. So the
    check runs HERE, on the output, where it is blind to which upstream table
    froze — which is the point: the next frozen reference table will be a third
    one nobody has looked at.

    Deliberately silent when the column is null in EVERY period: that is a
    reference table never joined at all, a different defect, and reporting it
    here would bury this one.
    """
    per = (
        panel.group_by("rdate")
        .agg(pl.col(col).is_null().mean().alias("null_rate"))
        .sort("rdate")
    )
    rates = list(zip(per["rdate"].to_list(), per["null_rate"].to_list()))
    tail = []
    for rdate, rate in reversed(rates):
        if rate >= null_threshold:
            tail.append(rdate)
        else:
            break
    if len(tail) >= min_periods and len(tail) < len(rates):
        tail.reverse()
        raise ValueError(
            f"{col} is null for >={null_threshold:.0%} of rows in the last "
            f"{len(tail)} quarter(s) ({tail[0]}..{tail[-1]}) but not before. A "
            f"reference table is frozen while the holdings kept going. Known "
            f"culprits, both already spliced once: crsp.msf (-> msf_v2) and "
            f"crsp.msenames (-> stocknames_v2, which also has ZERO null "
            f"nameendt, so every window closes at its last date). Extend the "
            f"source or lower --end deliberately."
        )
    print(f"[guard] no dead tail in {col} — checked {len(rates)} quarters")


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

    # Step 3 + 4a: join, adjust and aggregate to permno-quarter, one reporting
    # year at a time. mgr_markers is built above over the WHOLE panel and passed
    # in whole, so the cross-quarter window it carries is untouched by chunking.
    io_parts = join_adjust_and_aggregate(
        holdings, mgr_markers, cusip_map, cusip6_map, crsp_m,
        use_cusip6_fallback=args.cusip6_fallback,
    )
    del holdings

    # Step 4b: HHI + DBREADTH over the whole panel (the lag must see every
    # quarter in sequence).
    io_metrics = finalize_io_metrics(io_parts)
    print(f"[io] {len(io_metrics):,} permno-quarter IO observations")

    # Step 5: final panel
    panel = build_final_panel(io_metrics, crsp_m)
    print(f"[panel] {len(panel):,} rows in final panel")

    # Step 5b: D1 split-adjacent flags, then net securities lending out
    _assert_no_dead_tail(panel, "io_total")
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
        # SAS-facing handoff for import_inst_own.sas, which lands out.inst_own
        # for merge_panel. THE COLUMN ORDER BELOW IS THE INTERFACE — the SAS side
        # reads positionally and verifies this header, so change the two together.
        #
        # NOT xport, which is what this wrote before and why leg 2's output never
        # reached merge_panel at all. Two independent failures:
        #   1. SAS 9.4 rejects pyreadstat's file outright — `libname xin xport`
        #      then `set xin.dataset` gives
        #      "ERROR: File XIN.DATASET.DATA is not a SAS data set."
        #   2. xport's 8-char limit forced a rename map turning `numowners` into
        #      NUMOWN and `io_total` into IO_TOT — exactly the names
        #      merge_panel's MERGE_ASOF(num_vars=...) asks for — and it covered
        #      only 13 of the 22 columns.
        # CSV keeps full names, and polars writes shortest-roundtrip floats, so
        # SAS's best32. informat reads back bit-identical doubles.
        SAS_COLUMNS = [
            "permno", "rdate", "numowners", "io_total", "ioc_hhi", "dbreadth",
            "ior", "tso", "me", "p", "cfacshr", "io_missing", "io_g1",
            "split_quarter", "split_adjacent", "shortint", "si_missing",
            "shortint_adj", "io_total_net", "si_frac", "ior_net", "net_clamped",
        ]
        missing = [c for c in SAS_COLUMNS if c not in panel.columns]
        extra = [c for c in panel.columns if c not in SAS_COLUMNS]
        if missing or extra:
            raise ValueError(
                f"SAS_COLUMNS is out of sync with the panel — missing {missing}, "
                f"unexpected {extra}. Update it and import_inst_own.sas together."
            )
        csv_path = out_path.with_suffix(".csv")
        sas_out = panel.select(SAS_COLUMNS).with_columns(
            # SAS has no boolean; emit 0/1 not the strings "true"/"false"
            [pl.col(c).cast(pl.Int8)
             for c, t in panel.schema.items() if t == pl.Boolean]
        )
        sas_out.write_csv(csv_path)
        print(f"[out] wrote {csv_path} ({len(sas_out):,} rows) → import_inst_own.sas")

    print(f"[done] total time: {time.time() - t_start:.1f}s")


if __name__ == "__main__":
    main()
