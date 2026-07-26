#!/usr/bin/env -S uv run python3
"""
Data-quality detectors for holdings panels (Thomson/Refinitiv S12 & S34, SEC 13F, N-PX).

Stdlib only. Every detector takes a sequence of record dicts -- exactly what
`df.to_dict("records")` gives you -- so it runs in CI with no dependencies and on a
real parquet panel through a one-line adapter.

Each detector answers a question a *reviewer* would ask of an ownership panel, and each
is grounded in a defect that was either measured on the mirror panel or documented by
WRDS Research. See `references/tfn-ownership.md` -> "Known Data Defects" for the
citations and for what WRDS says the fix is (in several cases: there is no clean fix).

The detectors are firm-agnostic by construction. AAPL (permno 14593) is where these
defects were found -- and, not coincidentally, the running example in WRDS's own splits
note -- but nothing here is specialized to it.

Conventions
-----------
Every detector returns a list of `Finding`. An empty list means "clean". Callers assert
on the list, so a detector never raises on ordinary bad data -- only on malformed input.

Periods are `datetime.date` (quarter-end) or ISO "YYYY-MM-DD" strings; both are accepted
and normalized. Records with a None metric are skipped, not treated as zero -- a missing
quarter and a zero quarter are different defects and conflating them hides both.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Sequence

__all__ = [
    "Finding",
    "detect_flat_owner_share_swing",
    "detect_seasonal_alternation",
    "detect_split_factor_ratio",
    "detect_unit_discontinuity",
    "detect_coverage_end",
    "detect_coverage_step",
    "detect_owner_dropout",
    "detect_zero_row_cohort",
    "detect_bridge_rate_regression",
    "detect_duplicate_grain",
    "detect_unresolved_overlap",
    "detect_calendar_bucket_gap",
    "detect_join_gap_clustering",
    "detect_impossible_ratio",
    "COMMON_SPLIT_FACTORS",
]

# Split factors common enough in US equities that a holdings ratio landing on one is
# evidence of a mis-applied adjustment rather than real trading. Squares are included
# because double-adjustment is a documented Thomson failure mode: WRDS's splits note
# shows AAPL shares adjusted 7x twice for an erroneous "1-to-49 split".
COMMON_SPLIT_FACTORS = (2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 10.0, 20.0, 28.0)


@dataclass
class Finding:
    """One flagged observation. `kind` is stable and machine-matchable."""

    kind: str
    entity: Any
    period: Any
    detail: str
    metrics: dict = field(default_factory=dict)

    def __str__(self) -> str:  # pragma: no cover - display only
        return f"[{self.kind}] entity={self.entity} period={self.period}: {self.detail}"


# --------------------------------------------------------------------------- helpers


def _as_date(value: Any) -> _dt.date:
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    if isinstance(value, str):
        return _dt.date.fromisoformat(value[:10])
    raise TypeError(f"cannot interpret {value!r} as a date")


def _grouped(
    records: Iterable[dict], entity_col: str, period_col: str
) -> dict[Any, list[dict]]:
    """Group by entity, each group sorted by period. Later duplicates win."""
    out: dict[Any, dict[_dt.date, dict]] = {}
    for rec in records:
        entity = rec.get(entity_col)
        period = _as_date(rec[period_col])
        out.setdefault(entity, {})[period] = rec
    return {
        entity: [by_period[p] for p in sorted(by_period)]
        for entity, by_period in out.items()
    }


def _ratio(current: float, previous: float) -> float | None:
    """Fold-change, orientation-free: always >= 1.0, or None if undefined."""
    if previous is None or current is None:
        return None
    if previous == 0 or current == 0:
        return None
    lo, hi = sorted((abs(previous), abs(current)))
    return hi / lo


def _pct_change(current: float, previous: float) -> float | None:
    if previous in (None, 0) or current is None:
        return None
    return (current - previous) / abs(previous)


def _quantile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolated quantile. `sorted_values` must be sorted and non-empty."""
    if not sorted_values:
        raise ValueError("empty sequence")
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    pos = q * (len(sorted_values) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = pos - lo
    return float(sorted_values[lo] * (1 - frac) + sorted_values[hi] * frac)


# ------------------------------------------------------------------- the detectors


def detect_flat_owner_share_swing(
    records: Sequence[dict],
    *,
    entity_col: str = "permno",
    period_col: str = "rdate",
    shares_col: str = "io_total",
    owners_col: str = "numowners",
    share_swing: float = 0.20,
    owner_tolerance: float = 0.05,
) -> list[Finding]:
    """Shares move violently while the owner count barely moves.

    THE signature of a units/adjustment defect rather than a coverage defect. If
    institutions actually left, the owner count would fall with the shares. When 2,200
    managers keep reporting and the aggregate share count collapses 4.5x, the shares are
    being *rescaled*, not sold.

    This is the detector for the undiagnosed AAPL defect (mirror `inst_own.parquet`,
    permno 14593): io_total means of 1.41e10 (Mar) / 3.11e9 (Jun) / 3.31e9 (Sep) /
    1.41e10 (Dec) against numowners flat at 2,195-2,427.

    A holding that legitimately doubles usually brings new holders with it, so the
    tolerance on the owner side is deliberately tight (5%) while the share side is loose
    (20%) -- we want to catch rescaling, not trading.
    """
    findings: list[Finding] = []
    for entity, rows in _grouped(records, entity_col, period_col).items():
        for prev, cur in zip(rows, rows[1:]):
            s_prev, s_cur = prev.get(shares_col), cur.get(shares_col)
            o_prev, o_cur = prev.get(owners_col), cur.get(owners_col)
            if None in (s_prev, s_cur, o_prev, o_cur):
                continue
            s_change = _pct_change(s_cur, s_prev)
            o_change = _pct_change(o_cur, o_prev)
            if s_change is None or o_change is None:
                continue
            if abs(s_change) >= share_swing and abs(o_change) <= owner_tolerance:
                findings.append(
                    Finding(
                        kind="flat_owner_share_swing",
                        entity=entity,
                        period=_as_date(cur[period_col]),
                        detail=(
                            f"{shares_col} moved {s_change:+.1%} while {owners_col} "
                            f"moved only {o_change:+.1%} -- shares rescaled, not traded"
                        ),
                        metrics={
                            "shares_pct_change": s_change,
                            "owners_pct_change": o_change,
                            "shares_prev": s_prev,
                            "shares_cur": s_cur,
                            "owners_prev": o_prev,
                            "owners_cur": o_cur,
                            "fold_change": _ratio(s_cur, s_prev),
                        },
                    )
                )
    return findings


def detect_seasonal_alternation(
    records: Sequence[dict],
    *,
    entity_col: str = "permno",
    period_col: str = "rdate",
    metric_col: str = "io_total",
    min_quarters: int = 8,
    ratio_threshold: float = 1.5,
) -> list[Finding]:
    """A metric whose level depends on which calendar quarter-end it is.

    Real ownership has no reason to care whether the quarter ends in June or December.
    When it does, a vintage/adjustment artifact is keyed to the quarter-end month.

    Compares the mean of each quarter-end month against the pooled mean of the others and
    flags the entity when the highest-month/lowest-month ratio clears `ratio_threshold`.
    Reported once per entity, not per quarter -- seasonality is a property of the series.
    """
    findings: list[Finding] = []
    for entity, rows in _grouped(records, entity_col, period_col).items():
        by_month: dict[int, list[float]] = {}
        for rec in rows:
            value = rec.get(metric_col)
            if value is None:
                continue
            by_month.setdefault(_as_date(rec[period_col]).month, []).append(float(value))
        usable = {m: v for m, v in by_month.items() if v}
        if len(usable) < 2 or sum(len(v) for v in usable.values()) < min_quarters:
            continue
        means = {m: sum(v) / len(v) for m, v in usable.items()}
        hi_month = max(means, key=lambda m: means[m])
        lo_month = min(means, key=lambda m: means[m])
        if means[lo_month] <= 0:
            continue
        ratio = means[hi_month] / means[lo_month]
        if ratio >= ratio_threshold:
            findings.append(
                Finding(
                    kind="seasonal_alternation",
                    entity=entity,
                    period=None,
                    detail=(
                        f"{metric_col} mean varies {ratio:.2f}x by quarter-end month "
                        f"(month {hi_month}={means[hi_month]:.3g} vs "
                        f"month {lo_month}={means[lo_month]:.3g}); "
                        f"ownership has no calendar seasonality this large"
                    ),
                    metrics={
                        "ratio": ratio,
                        "means_by_month": means,
                        "high_month": hi_month,
                        "low_month": lo_month,
                        "n_quarters": sum(len(v) for v in usable.values()),
                    },
                )
            )
    return findings


def detect_split_factor_ratio(
    records: Sequence[dict],
    *,
    entity_col: str = "permno",
    period_col: str = "rdate",
    shares_col: str = "io_total",
    owners_col: str | None = "numowners",
    factors: Sequence[float] = COMMON_SPLIT_FACTORS,
    tolerance: float = 0.03,
    include_squares: bool = True,
) -> list[Finding]:
    """A quarter-over-quarter share ratio that lands on a split factor -- or its square.

    Distinguishes a mis-applied adjustment from ordinary trading: real flows do not
    produce a clean 7.00x. Squares are checked because double-adjustment is documented:
    WRDS's splits note shows S12 reporting 226,331 shares where 32,333 was correct --
    4,619 x 7 x 7, "an erroneous 1-to-49 split".

    When `owners_col` is given, the owner count must be roughly flat for the ratio to
    count as evidence -- a 2x share jump accompanied by 2x the holders is a real event.
    Pass `owners_col=None` to check the ratio alone.
    """
    targets: list[tuple[float, str]] = [(float(f), "split") for f in factors]
    if include_squares:
        targets += [(float(f) ** 2, "double-adjusted") for f in factors]

    findings: list[Finding] = []
    for entity, rows in _grouped(records, entity_col, period_col).items():
        for prev, cur in zip(rows, rows[1:]):
            ratio = _ratio(cur.get(shares_col), prev.get(shares_col))
            if ratio is None or ratio < 1.5:
                continue
            if owners_col is not None:
                o_change = _pct_change(cur.get(owners_col), prev.get(owners_col))
                if o_change is None or abs(o_change) > 0.10:
                    continue
            for target, label in targets:
                if abs(ratio - target) / target <= tolerance:
                    findings.append(
                        Finding(
                            kind="split_factor_ratio",
                            entity=entity,
                            period=_as_date(cur[period_col]),
                            detail=(
                                f"{shares_col} changed by {ratio:.3f}x, within "
                                f"{tolerance:.0%} of {target:g}x ({label}) -- "
                                f"consistent with a mis-applied share adjustment"
                            ),
                            metrics={
                                "ratio": ratio,
                                "matched_factor": target,
                                "match_kind": label,
                                "shares_prev": prev.get(shares_col),
                                "shares_cur": cur.get(shares_col),
                            },
                        )
                    )
                    break
    return findings


def detect_unit_discontinuity(
    records: Sequence[dict],
    *,
    period_col: str = "rdate",
    value_col: str = "value",
    min_median_ratio: float = 10.0,
    dispersion_ratio: float = 3.0,
    min_obs_per_period: int = 20,
) -> list[Finding]:
    """A period boundary where a value column changes *units*.

    Works on the cross-section, not one entity: compares the distribution of `value_col`
    in each period against the previous period. A units change moves the whole
    distribution at once, which a real economic shock does not.

    Also reports whether the break is *clean*. The measured Form 13F break at 2023Q1
    (thousands -> whole dollars) is not: median 442x, p90 494x, but p10 only 38x. That
    spread means filers converted at different times, so the post-break population is
    mixed and **no scalar repairs it**. When p90/p10 of the per-decile shift exceeds
    `dispersion_ratio`, the finding is marked `clean_break=False`, which is the signal
    that any sum or mean of `value_col` spanning the boundary is meaningless rather than
    merely rescaled.
    """
    by_period: dict[_dt.date, list[float]] = {}
    for rec in records:
        value = rec.get(value_col)
        if value is None:
            continue
        by_period.setdefault(_as_date(rec[period_col]), []).append(float(value))

    findings: list[Finding] = []
    periods = sorted(by_period)
    for prev_p, cur_p in zip(periods, periods[1:]):
        prev_v = sorted(v for v in by_period[prev_p] if v > 0)
        cur_v = sorted(v for v in by_period[cur_p] if v > 0)
        if len(prev_v) < min_obs_per_period or len(cur_v) < min_obs_per_period:
            continue
        q = {
            name: (_quantile(cur_v, p) / _quantile(prev_v, p))
            for name, p in (("p10", 0.10), ("median", 0.50), ("p90", 0.90))
            if _quantile(prev_v, p) > 0
        }
        median_ratio = q.get("median")
        if median_ratio is None or median_ratio < min_median_ratio:
            continue
        spread = (
            max(q.values()) / min(q.values()) if min(q.values(), default=0) > 0 else None
        )
        clean = spread is not None and spread <= dispersion_ratio
        findings.append(
            Finding(
                kind="unit_discontinuity",
                entity=None,
                period=cur_p,
                detail=(
                    f"{value_col} median shifted {median_ratio:.0f}x at {cur_p} "
                    f"(p10={q.get('p10', float('nan')):.0f}x, "
                    f"p90={q.get('p90', float('nan')):.0f}x); "
                    + (
                        "uniform shift -- a scalar rescale may be defensible"
                        if clean
                        else "NON-UNIFORM: population is mixed, no scalar repairs it; "
                        "do not sum or average across this boundary"
                    )
                ),
                metrics={
                    "quantile_ratios": q,
                    "median_ratio": median_ratio,
                    "dispersion": spread,
                    "clean_break": clean,
                    "prev_period": prev_p,
                    "n_prev": len(prev_v),
                    "n_cur": len(cur_v),
                },
            )
        )
    return findings


def detect_coverage_end(
    records: Sequence[dict],
    *,
    period_col: str = "rdate",
    expected_through: Any,
    entity_col: str | None = None,
    max_gap_days: int = 100,
) -> list[Finding]:
    """The panel stops before it should.

    A silently truncated series is the most dangerous defect in this file, because every
    downstream statistic still computes. S12 in the mirror ends 2024-12-31 with no 2025
    coverage; WRDS separately froze the S34 web query at 2019Q2 during the 2022 feed
    outage. Both are invisible unless asserted.

    With `entity_col` set, checks each entity's last period; otherwise checks the panel.
    """
    expected = _as_date(expected_through)
    findings: list[Finding] = []

    def _check(entity: Any, periods: list[_dt.date]) -> None:
        if not periods:
            return
        last = max(periods)
        gap = (expected - last).days
        if gap > max_gap_days:
            findings.append(
                Finding(
                    kind="coverage_end",
                    entity=entity,
                    period=last,
                    detail=(
                        f"coverage ends {last}, {gap} days short of the expected "
                        f"{expected}; downstream statistics will still compute"
                    ),
                    metrics={
                        "last_period": last,
                        "expected_through": expected,
                        "gap_days": gap,
                    },
                )
            )

    if entity_col is None:
        _check(None, [_as_date(r[period_col]) for r in records])
    else:
        for entity, rows in _grouped(records, entity_col, period_col).items():
            _check(entity, [_as_date(r[period_col]) for r in rows])
    return findings


def detect_owner_dropout(
    records: Sequence[dict],
    *,
    entity_col: str = "permno",
    period_col: str = "rdate",
    owners_col: str = "numowners",
    drop_threshold: float = 0.50,
) -> list[Finding]:
    """The owner count itself collapses -- a coverage/feed defect, not a units defect.

    The complement of `detect_flat_owner_share_swing`, and the two together classify a
    break: shares move but owners do not -> adjustment bug; owners move too -> the feed
    dropped filers.

    WRDS documented exactly this in Feb 2022: institutions reporting AAPL, IBM and MSFT
    fell from 1,500+ to under 500 in 2019Q3-Q4, and 1,386 of 12,224 stocks lost >10% of
    institutional ownership (median -48%). Refinitiv patched it in April 2022 -- so this
    detector should be run against *current* extracts, since an unpatched local mirror
    keeps the defect.
    """
    findings: list[Finding] = []
    for entity, rows in _grouped(records, entity_col, period_col).items():
        for prev, cur in zip(rows, rows[1:]):
            change = _pct_change(cur.get(owners_col), prev.get(owners_col))
            if change is not None and change <= -drop_threshold:
                findings.append(
                    Finding(
                        kind="owner_dropout",
                        entity=entity,
                        period=_as_date(cur[period_col]),
                        detail=(
                            f"{owners_col} fell {change:.1%} "
                            f"({prev.get(owners_col)} -> {cur.get(owners_col)}) -- "
                            f"filers missing from the feed"
                        ),
                        metrics={
                            "owners_pct_change": change,
                            "owners_prev": prev.get(owners_col),
                            "owners_cur": cur.get(owners_col),
                        },
                    )
                )
    return findings


def detect_zero_row_cohort(
    records: Sequence[dict],
    *,
    cohort_col: str,
    rows_col: str = "n_rows",
    period_col: str | None = None,
    min_docs: int = 10,
    zero_rate_threshold: float = 0.90,
) -> list[Finding]:
    """A whole cohort of documents that parsed to zero rows.

    A parser that silently yields nothing looks identical to a filer holding nothing.
    The Windows-1252 encoding bug did exactly this: 7,023 filings / 2,628,463 rows / 768
    institutions dropped to zero across all 38 quarters, concentrated by filing agent and
    stepping 3.47x at 2023Q3 (5.54% of holdings lost after, 1.60% before).

    Group by whatever cohort could carry an encoding or vendor quirk -- filing agent,
    declared charset, parser version -- and flag any cohort that is almost entirely
    empty. With `period_col`, also reports the per-period zero rate so a *time-varying*
    step (the 2023Q3 jump) is visible rather than averaged away.
    """
    cohorts: dict[Any, list[dict]] = {}
    for rec in records:
        cohorts.setdefault(rec.get(cohort_col), []).append(rec)

    findings: list[Finding] = []
    for cohort, rows in sorted(cohorts.items(), key=lambda kv: str(kv[0])):
        if len(rows) < min_docs:
            continue
        zeros = [r for r in rows if not r.get(rows_col)]
        rate = len(zeros) / len(rows)
        if rate < zero_rate_threshold:
            continue
        metrics: dict[str, Any] = {
            "zero_rate": rate,
            "n_docs": len(rows),
            "n_zero": len(zeros),
        }
        if period_col is not None:
            per_period: dict[Any, list[dict]] = {}
            for r in rows:
                per_period.setdefault(_as_date(r[period_col]), []).append(r)
            metrics["zero_rate_by_period"] = {
                p: sum(1 for r in rs if not r.get(rows_col)) / len(rs)
                for p, rs in sorted(per_period.items())
            }
        findings.append(
            Finding(
                kind="zero_row_cohort",
                entity=cohort,
                period=None,
                detail=(
                    f"cohort {cohort_col}={cohort!r}: {len(zeros)}/{len(rows)} "
                    f"documents parsed to zero rows ({rate:.1%}) -- "
                    f"indistinguishable from 'held nothing' unless asserted"
                ),
                metrics=metrics,
            )
        )
    return findings


def detect_coverage_step(
    records: Sequence[dict],
    *,
    period_col: str = "rdate",
    count_cols: Sequence[str] = ("n_funds", "n_cusips", "n_rows"),
    step_threshold: float = 0.50,
) -> list[Finding]:
    """A step change in how much the feed *covers*, in counts rather than values.

    Distinct from `detect_unit_discontinuity`, which watches a value column. Here the
    counts themselves jump, which is what a feed migration looks like: nothing is
    rescaled, there is simply more (or less) of it.

    The S12 legacy-SP -> strategic-collection switch at 2017Q4 is the reference case:
    CUSIPs in fund holdings **+613%**, unique funds **+113%**, fund-CUSIP observations
    +265%. WRDS confirms this is a genuine coverage expansion, not corruption -- overseas
    holdings, ADRs and preferreds finally received CUSIPs. It is still fatal to any
    level comparison spanning the boundary, and it is invisible in per-firm statistics.

    Fires in both directions on purpose: the same detector catches the 2019Q3-Q4 S34
    outage (a step *down*) and the 2017Q4 S12 expansion (a step *up*).

    Expects one record per period holding the counts -- i.e. an already-aggregated
    coverage summary, not the raw holdings panel.
    """
    by_period: dict[_dt.date, dict] = {}
    for rec in records:
        by_period[_as_date(rec[period_col])] = rec

    findings: list[Finding] = []
    periods = sorted(by_period)
    for prev_p, cur_p in zip(periods, periods[1:]):
        for col in count_cols:
            prev_v, cur_v = by_period[prev_p].get(col), by_period[cur_p].get(col)
            if prev_v in (None, 0) or cur_v is None:
                continue
            change = _pct_change(cur_v, prev_v)
            if change is None or abs(change) < step_threshold:
                continue
            findings.append(
                Finding(
                    kind="coverage_step",
                    entity=col,
                    period=cur_p,
                    detail=(
                        f"{col} stepped {change:+.0%} ({prev_v:,} -> {cur_v:,}) at "
                        f"{cur_p} -- feed composition changed; level comparisons "
                        f"spanning this boundary are invalid"
                    ),
                    metrics={
                        "pct_change": change,
                        "prev": prev_v,
                        "cur": cur_v,
                        "direction": "expansion" if change > 0 else "contraction",
                        "prev_period": prev_p,
                    },
                )
            )
    return findings


def detect_bridge_rate_regression(
    records: Sequence[dict],
    *,
    period_col: str = "rdate",
    linked_col: str = "n_linked",
    total_col: str = "n_total",
    min_rate: float = 0.70,
    max_drop: float = 0.10,
) -> list[Finding]:
    """An identifier bridge that silently stops matching.

    A join that quietly drops rows is the most under-tested failure in this file: the
    result still looks like a panel, just a smaller one, and nothing raises.

    MFLINKS is the reference case. It was **not backfilled** for the 2017Q4-2020Q2 S12
    feed change, so `wficn` coverage regresses precisely where the feed expanded -- and
    the measured bridge rate falls from ~77% pre-2017 to ~58-66% after. WRDS's own advice
    for that window is to identify US equity funds through Factset or CRSP instead.

    Flags two things: an absolute rate below `min_rate`, and a quarter-over-quarter drop
    exceeding `max_drop` (which catches a cliff that starts above the floor).
    """
    by_period: dict[_dt.date, dict] = {}
    for rec in records:
        by_period[_as_date(rec[period_col])] = rec

    rates: dict[_dt.date, float] = {}
    for period, rec in by_period.items():
        total = rec.get(total_col)
        linked = rec.get(linked_col)
        if not total or linked is None:
            continue
        rates[period] = linked / total

    findings: list[Finding] = []
    for period in sorted(rates):
        rate = rates[period]
        if rate < min_rate:
            findings.append(
                Finding(
                    kind="bridge_rate_low",
                    entity=linked_col,
                    period=period,
                    detail=(
                        f"only {rate:.1%} of rows bridged at {period} "
                        f"(floor {min_rate:.0%}) -- unbridged rows vanish silently"
                    ),
                    metrics={"rate": rate, "floor": min_rate},
                )
            )
    ordered = sorted(rates)
    for prev_p, cur_p in zip(ordered, ordered[1:]):
        drop = rates[prev_p] - rates[cur_p]
        if drop > max_drop:
            findings.append(
                Finding(
                    kind="bridge_rate_regression",
                    entity=linked_col,
                    period=cur_p,
                    detail=(
                        f"bridge rate fell {rates[prev_p]:.1%} -> {rates[cur_p]:.1%} "
                        f"at {cur_p} ({drop:.1%} drop) -- the link table did not grow "
                        f"with the feed"
                    ),
                    metrics={
                        "rate_prev": rates[prev_p],
                        "rate_cur": rates[cur_p],
                        "drop": drop,
                        "prev_period": prev_p,
                    },
                )
            )
    return findings


def detect_duplicate_grain(
    records: Sequence[dict],
    *,
    grain: Sequence[str],
    value_col: str | None = None,
    max_duplicate_rate: float = 0.0,
) -> list[Finding]:
    """Records that repeat at the grain they are supposed to be unique on.

    Duplicates inflate every sum downstream and are invisible in a spot check. Two
    documented cases in this data:

    - The 2014 S12 blip -- mutual-fund ownership 29% -> 35% -> 30% -- which WRDS
      attributes to funds being listed twice.
    - The `fundno`-vs-`wficn` dedup bug, which inflated MF_TOTAL by **~3.95x** because
      one `wficn` maps to a mean ~3.5 `crsp_fundno` share classes. Dedup on the wrong
      key and you multiply the panel.

    Pass the grain you believe is unique -- e.g. `("wficn", "rdate", "cusip8")`. With
    `value_col`, also reports the inflation the duplicates cause, which is the number
    that actually matters: a duplicate carrying the same value doubles your total.
    """
    seen: dict[tuple, list[dict]] = {}
    for rec in records:
        key = tuple(rec.get(col) for col in grain)
        seen.setdefault(key, []).append(rec)

    dupes = {k: v for k, v in seen.items() if len(v) > 1}
    if not dupes:
        return []
    rate = len(dupes) / len(seen)
    if rate <= max_duplicate_rate:
        return []

    metrics: dict[str, Any] = {
        "duplicate_key_rate": rate,
        "n_duplicate_keys": len(dupes),
        "n_keys": len(seen),
        "n_excess_rows": sum(len(v) - 1 for v in dupes.values()),
        "worst_key": max(dupes, key=lambda k: len(dupes[k])),
        "max_multiplicity": max(len(v) for v in dupes.values()),
    }
    detail = (
        f"{len(dupes):,} of {len(seen):,} keys duplicated on "
        f"{'+'.join(grain)} ({rate:.1%}); {metrics['n_excess_rows']:,} excess rows"
    )
    if value_col is not None:
        total = sum(
            float(r[value_col]) for v in seen.values() for r in v if r.get(value_col) is not None
        )
        deduped = sum(
            float(v[0][value_col]) for v in seen.values() if v[0].get(value_col) is not None
        )
        if deduped:
            metrics["inflation_factor"] = total / deduped
            detail += f" -- inflates {value_col} by {total / deduped:.2f}x"
    return [
        Finding(
            kind="duplicate_grain",
            entity="+".join(grain),
            period=None,
            detail=detail,
            metrics=metrics,
        )
    ]


def detect_unresolved_overlap(
    records: Sequence[dict],
    *,
    source_col: str = "source",
    resolved_col: str = "bridged",
    secondary_source: Any = "s12",
    period_col: str | None = None,
    max_unresolved_rate: float = 0.05,
) -> list[Finding]:
    """Union of two sources where membership overlap was never resolved.

    When you merge a primary and a secondary source at the record level, every secondary
    record must be classifiable as either *genuinely absent* from the primary (safe to
    add) or *present but unlinked* (adding it double-counts). Records that are neither
    are the union's silent error term, and no downstream statistic exposes them.

    Reference case: coalescing Thomson S12 into `crsp.holdings`. Measured at 2022-12-31 --
    non-US funds bridge at 0.3%, which sounds catastrophic but simply means CRSP never
    covered them, so they are safe additions. The real exposure is **US-domiciled funds
    that fail to bridge: 4,649 of 60,184 (~7.7%)**. Those could be new funds or duplicates
    of funds CRSP already carries, and nothing in the data distinguishes them.

    So the headline bridge rate is the wrong number to watch -- 12.2% globally versus a
    ~7.7% true ambiguity. This detector wants the *classified* population: records
    already tagged with which source they came from and whether they resolved against the
    other. It reports the unresolved secondary mass, per period when `period_col` is set.

    Default threshold is deliberately tight (5%). An unresolved union is not a rounding
    error; it is an unbounded bias whose sign you do not know.
    """

    def _rate(rows: Sequence[dict]) -> tuple[int, int]:
        secondary = [r for r in rows if r.get(source_col) == secondary_source]
        unresolved = [r for r in secondary if not r.get(resolved_col)]
        return len(unresolved), len(rows)

    findings: list[Finding] = []

    def _emit(period: Any, rows: Sequence[dict]) -> None:
        n_unresolved, n_total = _rate(rows)
        if not n_total:
            return
        rate = n_unresolved / n_total
        if rate <= max_unresolved_rate:
            return
        findings.append(
            Finding(
                kind="unresolved_overlap",
                entity=secondary_source,
                period=period,
                detail=(
                    f"{n_unresolved:,} of {n_total:,} records ({rate:.1%}) come from "
                    f"{secondary_source!r} without resolving against the primary source "
                    f"-- each is either new coverage or a duplicate, and the data does "
                    f"not say which"
                ),
                metrics={
                    "unresolved_rate": rate,
                    "n_unresolved": n_unresolved,
                    "n_total": n_total,
                    "threshold": max_unresolved_rate,
                },
            )
        )

    if period_col is None:
        _emit(None, list(records))
    else:
        by_period: dict[_dt.date, list[dict]] = {}
        for rec in records:
            by_period.setdefault(_as_date(rec[period_col]), []).append(rec)
        for period in sorted(by_period):
            _emit(period, by_period[period])
    return findings


def detect_calendar_bucket_gap(
    records: Sequence[dict],
    *,
    period_col: str = "rdate",
    expected_months: Sequence[int] = (3, 6, 9, 12),
    thin_share: float = 0.5,
) -> list[Finding]:
    """A periodic panel missing an entire calendar bucket (e.g. no June, no September).

    THE ROOT-CAUSE DETECTOR. Every other detector in this module catches a *symptom*
    downstream of a broken source table; this one catches the source table itself, and
    it is cheap enough to run on every reference panel at build time.

    Grounded in a real incident (mirror `build_inst_own.py`, 2026-07). polars'
    `dt.month()` returns Int8, so the common idiom

        dt.year() * 10000 + dt.month() * 100 + dt.day()

    overflows for every month >= 2 (2 * 100 = 200 > 127) and wraps NEGATIVE, silently.
    February 2020 became 20199973 and March became 20200075 instead of 20200229 /
    20200331. A quarter-snap then read those as "month 99" and "month 0" and bucketed
    them into Q4-of-the-prior-year and Q1, so the CRSP reference panel held ONLY March
    and December quarter-ends -- 193,335 rows where 370,630 were correct.

    Nothing raised. The output was a full-looking table of plausible eight-digit
    integers. Downstream, every June and September holdings quarter missed the join,
    fell back to an unadjusted split factor and a null denominator, and produced an
    ownership ratio of exactly 0 for 49% of the panel. That surfaced as a 4.5x seasonal
    swing with a flat owner count -- which reads as a *vendor* defect, and was attributed
    to one for weeks before being traced back here.

    The lesson generalizes past polars: any date arithmetic on a narrow integer type can
    silently produce a valid-looking key. Assert the buckets, do not eyeball the head.

    `thin_share` also catches the softer version -- a bucket present but far smaller than
    its peers, which is a partial join failure rather than a total one.
    """
    findings: list[Finding] = []
    counts: dict[int, int] = {m: 0 for m in expected_months}
    unexpected: dict[int, int] = {}
    for rec in records:
        value = rec.get(period_col)
        if value is None:
            continue
        month = _as_date(value).month
        if month in counts:
            counts[month] += 1
        else:
            unexpected[month] = unexpected.get(month, 0) + 1

    present = {m: n for m, n in counts.items() if n > 0}
    for month in expected_months:
        if counts[month] == 0:
            findings.append(
                Finding(
                    kind="calendar_bucket_gap",
                    entity=period_col,
                    period=month,
                    detail=(
                        f"no rows in calendar month {month}; expected months "
                        f"{list(expected_months)}. A whole bucket is missing, so every "
                        f"downstream join keyed on it silently falls back to a default"
                    ),
                    metrics={"month": month, "rows": 0, "present_months": sorted(present)},
                )
            )

    if present:
        mean_present = sum(present.values()) / len(present)
        for month, n in sorted(present.items()):
            if n < mean_present * thin_share:
                findings.append(
                    Finding(
                        kind="calendar_bucket_thin",
                        entity=period_col,
                        period=month,
                        detail=(
                            f"month {month} has {n:,} rows against a {mean_present:,.0f} "
                            f"average across present months -- partial join failure"
                        ),
                        metrics={"month": month, "rows": n, "mean_rows": mean_present},
                    )
                )

    for month, n in sorted(unexpected.items()):
        findings.append(
            Finding(
                kind="calendar_bucket_unexpected",
                entity=period_col,
                period=month,
                detail=(
                    f"{n:,} rows in month {month}, which is not in the expected set "
                    f"{list(expected_months)} -- a corrupted date key can land anywhere"
                ),
                metrics={"month": month, "rows": n},
            )
        )
    return findings


def detect_join_gap_clustering(
    records: Sequence[dict],
    *,
    period_col: str = "rdate",
    joined_col: str = "tso",
    max_spread: float = 0.25,
) -> list[Finding]:
    """A join whose failure rate is wildly uneven across calendar buckets.

    A left join that misses is not an error -- 13F holds ADRs and closed-end funds that
    legitimately have no CRSP common-stock match, so a flat ~54% null rate is expected
    and fine. What is NOT fine is that rate differing by bucket: real non-matches do not
    know what month it is.

    On the broken mirror panel the null rate for `tso` was 1.00 in June and September
    against 0.53 in March and December -- a spread of 0.47. After the fix it was 0.537 to
    0.546, a spread of 0.009. The absolute level moved barely at all; the *spread* is the
    signal, which is why this is a separate detector from a null-rate threshold.

    Use this wherever a reference table is joined in: a silent default is much harder to
    notice than a missing column, because the arithmetic downstream still succeeds.
    """
    by_month: dict[int, list[int]] = {}
    for rec in records:
        value = rec.get(period_col)
        if value is None:
            continue
        month = _as_date(value).month
        bucket = by_month.setdefault(month, [0, 0])
        bucket[1] += 1
        if rec.get(joined_col) is None:
            bucket[0] += 1

    rates = {m: miss / total for m, (miss, total) in by_month.items() if total}
    if len(rates) < 2:
        return []
    lo_month, lo = min(rates.items(), key=lambda kv: kv[1])
    hi_month, hi = max(rates.items(), key=lambda kv: kv[1])
    if hi - lo < max_spread:
        return []
    return [
        Finding(
            kind="join_gap_clustering",
            entity=joined_col,
            period=hi_month,
            detail=(
                f"{joined_col} is null for {hi:.1%} of rows in month {hi_month} but only "
                f"{lo:.1%} in month {lo_month} (spread {hi - lo:.1%}) -- the join is "
                f"failing for a calendar subset, not for genuinely unmatched entities"
            ),
            metrics={
                "max_null_rate": hi,
                "min_null_rate": lo,
                "spread": hi - lo,
                "worst_month": hi_month,
                "best_month": lo_month,
                "null_rate_by_month": dict(sorted(rates.items())),
            },
        )
    ]


def detect_impossible_ratio(
    records: Sequence[dict],
    *,
    entity_col: str = "permno",
    period_col: str = "rdate",
    numerator_col: str = "io_total",
    denominator_col: str = "tso",
    max_ratio: float = 1.0,
    tolerance: float = 0.02,
) -> list[Finding]:
    """Held shares exceed shares outstanding -- an arithmetic impossibility, not an outlier.

    Institutions cannot own 239% of a company. When they appear to, the shares are being
    double-counted or mis-scaled, and no amount of winsorizing makes the number mean
    something.

    This is the check that survives a source swap. Vendor panels often clip the ratio at
    100% so the defect is invisible in them; a panel built from raw filings does not clip,
    so the violations are visible and countable. On the rebuilt mirror 13F panel this
    fires on 7.0% of non-zero observations (2.9% above 120%), concentrated in the
    pre-XML text-parse era -- e.g. AAPL 2003-09-30 with 4.90e10 shares held against
    2.05e10 outstanding, bracketed by quarters at a sane 45% and 60%.

    `tolerance` allows a small band for genuine timing mismatch: holdings are reported at
    quarter-end while shares outstanding come from a monthly file, so a real 100.5% is
    a stale denominator rather than a defect.
    """
    findings: list[Finding] = []
    limit = max_ratio * (1.0 + tolerance)
    for rec in records:
        numer = rec.get(numerator_col)
        denom = rec.get(denominator_col)
        if numer is None or denom is None or denom <= 0:
            continue
        ratio = numer / denom
        if ratio > limit:
            findings.append(
                Finding(
                    kind="impossible_ratio",
                    entity=rec.get(entity_col),
                    period=_as_date(rec[period_col]) if rec.get(period_col) else None,
                    detail=(
                        f"{numerator_col} / {denominator_col} = {ratio:.1%}, above the "
                        f"{max_ratio:.0%} bound -- shares double-counted or mis-scaled"
                    ),
                    metrics={
                        "ratio": ratio,
                        "numerator": numer,
                        "denominator": denom,
                    },
                )
            )
    return findings


def from_dataframe(df: Any, detector: Callable[..., list[Finding]], **kwargs: Any):
    """Adapter: run any detector against a pandas/polars frame.

    Kept trivial on purpose -- the detectors take records so the test suite needs no
    dataframe library, and real callers pay one conversion.
    """
    records = (
        df.to_dicts() if hasattr(df, "to_dicts") else df.to_dict("records")
    )
    return detector(records, **kwargs)
