#!/usr/bin/env python3
"""dq_panel.py — run the ownership detectors against the panel this DAG just built.

WHY THIS IS A DAG JOB AND NOT A THING YOU REMEMBER TO DO.
SKILL.md says a timed run should include the detector sweep "so the number means
'a panel you can use'". Until now nothing in run_pipeline.sh referenced
ownership_dq.py at all, so every timing quoted for this pipeline was the time to
build a panel of unmeasured quality. The sweep costs seconds against a ~35 minute
DAG; leaving it out bought nothing and cost the one number that says the output is
usable.

IT REPORTS, IT DOES NOT GATE. No detector count fails this job. The thresholds in
ownership_dq.py belong to whoever set them and are not this script's to enforce,
and a panel with a known 3.1% impossible-ratio rate is still the panel you meant
to build. What would be wrong is not knowing.

The summary prints in the same shape as the PREREQ / UNIVERSE / OPTIONAL gate
lines, so one grep covers the lot:

    grep -E 'PREREQ|UNIVERSE|OPTIONAL|DQ|ERROR' logs/*.log

ownership_dq.py IS NOT DUPLICATED HERE. It lives in the `wrds` skill and
SKILL.md says, in as many words, "Deliberately not duplicated here." So this
resolves it rather than carrying a third copy that can drift. Resolution order:

    $OWNERSHIP_DQ                                  explicit wins
    ../../wrds/scripts/ownership_dq.py             the repo layout
    ./ownership_dq.py                              deployed alongside

If none resolve the job fails LOUDLY with the remedy. It is the last job in the
DAG and holds nothing, so failing here costs a message, not a panel.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import os
import sys
from pathlib import Path

import polars as pl

HERE = Path(__file__).resolve().parent
PROJ = HERE.parent
PROC = PROJ / "data" / "processed"


def load_odq():
    """Import ownership_dq.py from wherever it actually is."""
    candidates = []
    env = os.environ.get("OWNERSHIP_DQ")
    if env:
        candidates.append(Path(env))
    # repo layout: skills/npx-ownership-panel/scripts -> skills/wrds/scripts
    candidates.append(HERE.parent.parent / "wrds" / "scripts" / "ownership_dq.py")
    candidates.append(HERE / "ownership_dq.py")

    for p in candidates:
        if p.is_file():
            spec = importlib.util.spec_from_file_location("odq", p)
            mod = importlib.util.module_from_spec(spec)
            # MUST be registered before exec_module: ownership_dq.py uses
            # @dataclass, and dataclasses resolves the module out of sys.modules
            # to inspect annotations. Absent, it dies with an unhelpful
            # AttributeError: 'NoneType' object has no attribute '__dict__'.
            sys.modules["odq"] = mod
            spec.loader.exec_module(mod)
            print(f"[dq] detectors from {p}", flush=True)
            return mod

    sys.stderr.write(
        "ERROR: cannot find ownership_dq.py. Tried:\n"
        + "".join(f"  {c}\n" for c in candidates)
        + "  It lives in the `wrds` skill and is deliberately not duplicated into\n"
        "  this one. Either set OWNERSHIP_DQ=/path/to/ownership_dq.py, or scp it\n"
        "  next to these scripts.\n"
    )
    raise SystemExit(2)


def main() -> int:
    odq = load_odq()

    src = Path(os.environ.get("INST_OWN_PARQUET", PROC / "inst_own.parquet"))
    if not src.is_file():
        sys.stderr.write(f"ERROR: leg 2 output not found at {src}\n")
        return 2

    d = pl.read_parquet(src)
    # Report the panel's OWN shape, before the working column is added — `rd` is
    # ours, and printing 23 where the panel has 22 puts a wrong number in a log
    # that exists to be trusted.
    print(f"[dq] {src.name}: {d.height:,} rows x {d.width} cols", flush=True)
    # Detectors that group by entity need a real date, not an int YYYYMMDD.
    d = d.with_columns(
        pl.col("rdate").cast(pl.Utf8).str.strptime(pl.Date, "%Y%m%d").alias("rd")
    )

    counts: dict[str, int] = {}

    def run(name, det, frame, **kw):
        f = odq.from_dataframe(frame, det, **kw)
        counts[name] = len(f)
        print(f"[dq] {name:28s} {len(f):>8,}", flush=True)
        for x in f[:3]:
            print(f"       {str(x)[:150]}", flush=True)
        return f

    # --- structural: does the panel exist over the range it claims? -----------
    per_period = d.group_by("rd").agg(pl.len().alias("n_rows")).sort("rd")
    year2 = int(os.environ.get("YEAR2", "2025"))
    run("coverage_end", odq.detect_coverage_end, per_period,
        period_col="rd", expected_through=dt.date(year2, 12, 31))
    run("duplicate_grain", odq.detect_duplicate_grain,
        d.select(["permno", "rdate"]), grain=["permno", "rdate"])
    run("join_coverage_tail", odq.detect_join_coverage_tail,
        d.select(["rd", "tso"]), period_col="rd", joined_col="tso")

    # --- units / adjustment --------------------------------------------------
    sp = (d.filter(pl.col("io_total").is_not_null() & (pl.col("io_total") > 0))
            .select(["permno", "rd", "io_total", "numowners"])
            .sort(["permno", "rd"]))
    run("split_factor_ratio", odq.detect_split_factor_ratio, sp, period_col="rd")
    run("owner_dropout", odq.detect_owner_dropout,
        d.select(["permno", "rd", "numowners"]).sort(["permno", "rd"]), period_col="rd")
    run("unit_discontinuity", odq.detect_unit_discontinuity,
        d.select(["rd", "io_total"]).rename({"io_total": "value"}), period_col="rd")

    # --- feed shape over time ------------------------------------------------
    # These take a PER-PERIOD frame, not the row-level panel: they ask whether the
    # feed's coverage steps, alternates, or clusters its join failures. The first
    # version of this script ran seven detectors — the seven I happened to have
    # used by hand — and never asked what else was in the library. Ten were
    # sitting unused, including the one that would have found the 2025 regime
    # break automatically instead of by inspection.
    per_period = (
        d.group_by("rd")
        .agg(
            n_rows=pl.len(),
            n_funds=pl.col("permno").n_unique(),
            n_cusips=pl.col("permno").n_unique(),
            n_linked=pl.col("tso").is_not_null().sum(),
            n_total=pl.len(),
            tso=pl.col("tso").is_not_null().sum(),  # join_gap_clustering reads nullity
        )
        .sort("rd")
    )
    run("coverage_step", odq.detect_coverage_step, per_period, period_col="rd")
    run("bridge_rate_regression", odq.detect_bridge_rate_regression,
        per_period, period_col="rd")
    run("calendar_bucket_gap", odq.detect_calendar_bucket_gap,
        d.select(["rd"]), period_col="rd")
    run("join_gap_clustering", odq.detect_join_gap_clustering,
        d.select(["rd", "tso"]), period_col="rd", joined_col="tso")

    # --- entity-level shape --------------------------------------------------
    # The complement of owner_dropout. Together they CLASSIFY a break: shares move
    # but owners do not -> adjustment bug; owners move too -> the feed. We were
    # running only half the pair, so every break was landing in one bucket by
    # default rather than by evidence.
    run("flat_owner_share_swing", odq.detect_flat_owner_share_swing,
        d.select(["permno", "rd", "io_total", "numowners"]).sort(["permno", "rd"]),
        period_col="rd")
    run("seasonal_alternation", odq.detect_seasonal_alternation,
        d.select(["permno", "rd", "io_total"]).sort(["permno", "rd"]),
        period_col="rd")

    # Implied price from market equity and shares outstanding. `me` is in $M and
    # `tso` in shares, so a row whose me/tso implies a price outside [0.01, 10000]
    # cannot have both fields right. This is the check that speaks to the
    # default-fill rows where p is exactly 0.0.
    pr = d.filter(pl.col("me").is_not_null() & pl.col("tso").is_not_null() & (pl.col("tso") > 0))
    run("implied_price_outlier", odq.detect_implied_price_outlier,
        pr.select(["me", "tso"]).rename({"me": "value", "tso": "shares"}),
        value_scale=1_000_000.0)

    # --- NOT APPLICABLE, said out loud ---------------------------------------
    # Silence here would be indistinguishable from a pass. Two detectors have no
    # input in this panel, and saying so is the result:
    #
    #   fallback_join_contamination — needs an io_fallback column measuring how
    #     much of a cell came from the degraded cusip6 path. Leg 2 DISABLES that
    #     fallback (D9 cause 2), so the column does not exist and cannot. Note
    #     legs 1 and A still match on cusip6, where this WOULD apply if their
    #     output carried the split.
    #   zero_row_cohort — document-level (a cohort of filings parsing to zero
    #     rows). Leg 2's grain is permno-quarter; the filing-level cohort is
    #     upstream in the 13F parser, not here.
    print("[dq] NOT APPLICABLE: fallback_join_contamination (no io_fallback column "
          "— leg 2 disables the cusip6 path), zero_row_cohort (document-grain, "
          "upstream of this panel)", flush=True)

    # --- the headline ratio --------------------------------------------------
    # ITS DENOMINATOR IS NOT d.height AND MUST NOT BE PRINTED AS IF IT WERE.
    # Only rows carrying both io_total and a positive tso can trip this at all;
    # on the current panel that is 378,129 of 675,639 (56%). Quoting "3.1%"
    # against the full row count reads as "the panel is 96.9% clean" and is
    # wrong about the 44% the check cannot see.
    ir = d.filter(
        pl.col("io_total").is_not_null()
        & pl.col("tso").is_not_null()
        & (pl.col("tso") > 0)
    )
    run("impossible_ratio", odq.detect_impossible_ratio,
        ir.select(["permno", "rd", "io_total", "tso"]), period_col="rd")

    n_testable = ir.height
    n_imp = counts["impossible_ratio"]
    pct = (100.0 * n_imp / n_testable) if n_testable else 0.0
    cov = (100.0 * n_testable / d.height) if d.height else 0.0

    # NET OF LENDING, because most of the gross exceedance is not a defect.
    # A lent share sits in the borrower's account and STILL appears in the
    # lender's 13F, so gross institutional holdings legitimately exceed shares
    # outstanding. detect_impossible_ratio's own docstring says to "triage
    # against short interest ... before treating as" a defect — leg 2 already
    # computes io_total_net, so the sweep was reporting the untriaged number.
    #
    # Measured on the CIZ panel: gross 12,950/392,393 = 3.300%, net
    # 4,266/392,393 = 1.087%. Lending accounts for 8,684 of the 12,950 — 67.1%.
    # p99 falls from 1.134 to 1.026. The gross figure is a triage signal that is
    # two-thirds false alarm; the net figure is the one worth acting on.
    net = ir.filter(pl.col("io_total_net").is_not_null())
    n_net_imp = int(
        (net["io_total_net"] / net["tso"] > 1.02).sum()
    ) if net.height else 0
    net_pct = (100.0 * n_net_imp / net.height) if net.height else 0.0
    n_si_missing = int(d.select(pl.col("si_missing").sum()).item()) if "si_missing" in d.columns else 0

    print(flush=True)
    print(
        "NOTE: DQ rows={:,} coverage_end={} duplicate_grain={} join_coverage_tail={} "
        "unit_discontinuity={} split_factor_ratio={} owner_dropout={}".format(
            d.height, counts["coverage_end"], counts["duplicate_grain"],
            counts["join_coverage_tail"], counts["unit_discontinuity"],
            counts["split_factor_ratio"], counts["owner_dropout"],
        ),
        flush=True,
    )
    print(
        "NOTE: DQ impossible_ratio={:,}/{:,}={:.3f}% testable={:.1f}%_of_panel".format(
            n_imp, n_testable, pct, cov
        ),
        flush=True,
    )
    print(
        "NOTE: DQ the impossible_ratio denominator is rows with BOTH io_total and "
        "tso>0, not the panel; {:,} rows ({:.1f}%) are invisible to it".format(
            d.height - n_testable, 100.0 - cov
        ),
        flush=True,
    )
    print(
        "NOTE: DQ impossible_ratio_NET={:,}/{:,}={:.3f}% (io_total_net/tso) — a lent "
        "share is in the borrower's account AND the lender's 13F, so gross "
        "exceedance is expected; lending explains {:,} of the {:,} gross flags".format(
            n_net_imp, net.height, net_pct, max(n_imp - n_net_imp, 0), n_imp
        ),
        flush=True,
    )
    print(
        "NOTE: DQ si_missing={:,} of {:,} ({:.1f}%) — no lending figure there, so the "
        "NET ratio cannot be formed and those rows fall back to gross".format(
            n_si_missing, d.height, 100.0 * n_si_missing / d.height if d.height else 0.0
        ),
        flush=True,
    )
    # WHAT THE UNTESTABLE ROWS ACTUALLY ARE. Classified 2026-07-27 against
    # crsp.stksecurityinfohist: of the 16,675 (permno, class) rows behind the
    # unlinked population, ZERO are absent from the names table and only 278
    # (1.7%) are in NS/EQTY/COM/Y — 98.3% are OUTSIDE the universe this panel
    # measures. The top classes are ETFs (6,827 permnos), foreign-incorporated
    # common (2,420), ADRs (1,029) and closed-end funds (1,039).
    #
    # So the missing denominators are overwhelmingly 13F filers holding things
    # that are NOT US common stock, not CRSP failing to match. The bridge rate
    # falls monotonically 74.1% (2005) -> 38.0% (2025), which is the secular rise
    # of ETFs in institutional portfolios, not a degrading join.
    #
    # This matters for how the number is read: "43.7% invisible" sounds like a
    # data defect and is mostly a universe boundary. The ~1.7% residual is the
    # part that would be a real gap.
    print(
        "NOTE: DQ untestable rows are OUT-OF-UNIVERSE holdings (ETF, ADR, foreign, "
        "CEF), not failed matches. 98.3% of unlinked permnos are outside "
        "NS/EQTY/COM/Y outright; of the 1.7% that look in-universe, 99.3% were in "
        "it at a DIFFERENT DATE (share class is interval-based, the filter is "
        "per-date). True residual: 47 rows, ONE permno, 0.0012% of panel 13F "
        "shares. Bridge rate falls 74.1% (2005) to 38.0% (2025) as institutions "
        "shift into ETFs. Classified 2026-07-27; re-derive against "
        "crsp.stksecurityinfohist if the panel window moves.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
