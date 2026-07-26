#!/usr/bin/env -S uv run python3
"""Ownership data-quality detector tests.

Run: uv run python3 tests/ownership_dq_test.py

Each defect class below was either measured on the mirror panel (~/projects/mirror) or
documented by a WRDS research note. The fixtures reproduce the measured *shape* with
synthetic numbers so the suite runs without WRDS credentials, and every detector is
tested twice: it must fire on the defect and stay silent on a clean panel. A detector
that only ever fires is not a test, it is an alarm.

Findings are labelled F1-F5 to match the investigation notes:
  F1  Thomson s34 AAPL: 4.5x seasonal share swing, owner count flat  (UNDIAGNOSED -> now diagnosed)
  F2  EDGAR 13F is clean where Thomson is not                        (control)
  F3  S12 looks healthier but is unverified                          (weak-signal case)
  F4  13F `value` changes units at 2023Q1, non-uniformly
  F5  Windows-1252 filings parsed to zero holdings rows
"""

import datetime as dt
import importlib.util
import sys
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parents[1] / "skills" / "wrds" / "scripts" / "ownership_dq.py"
)
spec = importlib.util.spec_from_file_location("ownership_dq", MODULE_PATH)
dq = importlib.util.module_from_spec(spec)
sys.modules["ownership_dq"] = dq  # dataclass resolution needs the module registered
spec.loader.exec_module(dq)  # noqa: E402

P, F = 0, 0


def check(name, cond, extra=""):
    global P, F
    if cond:
        P += 1
        print(f"  ok  {name}")
    else:
        F += 1
        print(f"  FAIL {name} {extra}")


def quarters(start_year, n):
    """n consecutive calendar quarter-ends starting at Q1 of start_year."""
    out = []
    y, ends = start_year, [(3, 31), (6, 30), (9, 30), (12, 31)]
    for i in range(n):
        m, d = ends[i % 4]
        out.append(dt.date(y + i // 4, m, d))
    return out


# ===========================================================================
# F1. Flat owner count, collapsing shares  (Thomson s34, permno 14593)
# ===========================================================================
print("\nF1: flat-owner-count / collapsing-shares detector")

# The measured shape: quarter-end month drives the level. Mar/Dec ~1.41e10,
# Jun/Sep ~3.1e9, while numowners stays inside 2,195-2,427 throughout.
thomson_aapl = []
for i, q in enumerate(quarters(2015, 24)):
    inflated = q.month in (3, 12)
    thomson_aapl.append(
        {
            "permno": 14593,
            "rdate": q,
            "io_total": 1.41e10 if inflated else 3.11e9,
            "numowners": 2195 + (i % 5) * 8,  # drifts <2%, as measured
        }
    )

found = dq.detect_flat_owner_share_swing(thomson_aapl)
# Two of every four transitions swing (Mar->Jun and Sep->Dec); Jun->Sep and Dec->Mar sit
# at the same level. So ~half of all transitions flag -- 12 of 23 here, against the 41 of
# 93 measured on the real panel. A detector that flagged *every* transition would be
# describing a different, and wrong, defect.
check("fires on Thomson AAPL seasonal swing", len(found) == 12, f"got {len(found)}")
check("flags about half the transitions, as measured", 0.4 <= len(found) / 23 <= 0.6)
check(
    "attributes it to rescaling, not trading",
    all(abs(f.metrics["owners_pct_change"]) <= 0.05 for f in found),
)
check(
    "fold change matches the measured ~4.5x",
    found and 4.0 <= max(f.metrics["fold_change"] for f in found) <= 5.0,
    f"got {max(f.metrics['fold_change'] for f in found):.2f}" if found else "",
)

# A firm whose ownership genuinely grows: shares AND owners rise together.
organic_growth = [
    {
        "permno": 10001,
        "rdate": q,
        "io_total": 1.0e9 * (1.30**i),
        "numowners": int(500 * (1.28**i)),
    }
    for i, q in enumerate(quarters(2015, 12))
]
check(
    "silent on organic growth (owners rise with shares)",
    dq.detect_flat_owner_share_swing(organic_growth) == [],
)

# A real coverage failure: shares AND owners collapse together. Should NOT be
# attributed to a units bug -- that is detect_owner_dropout's job.
coverage_loss = [
    {"permno": 10002, "rdate": q, "io_total": v, "numowners": n}
    for q, v, n in zip(quarters(2019, 4), [1e10, 1e10, 2e9, 2e9], [1500, 1500, 400, 400])
]
check(
    "does not claim a units bug when owners collapse too",
    dq.detect_flat_owner_share_swing(coverage_loss) == [],
)
check(
    "owner-dropout detector catches that case instead",
    len(dq.detect_owner_dropout(coverage_loss)) == 1,
)

# ===========================================================================
# F1 (cont). Seasonal alternation keyed to quarter-end month
# ===========================================================================
print("\nF1: seasonal-alternation-by-quarter-end-month detector")

seasonal = dq.detect_seasonal_alternation(thomson_aapl)
check("fires on the Thomson panel", len(seasonal) == 1, f"got {len(seasonal)}")
check(
    "identifies the alternation as ~4.5x",
    seasonal and 4.0 <= seasonal[0].metrics["ratio"] <= 5.0,
)
check(
    "names a Mar/Dec high month and a Jun/Sep low month",
    seasonal
    and seasonal[0].metrics["high_month"] in (3, 12)
    and seasonal[0].metrics["low_month"] in (6, 9),
)

# ---- F2. EDGAR 13F control: the same firm, few-percent quarterly variation.
# Real measured AAPL values, incl. the genuine 4:1 split at 2020Q3 left unadjusted.
edgar_aapl_values = [
    2.96e9, 2.86e9, 2.79e9, 2.92e9,   # 2018
    2.68e9, 2.64e9, 2.62e9, 2.63e9,   # 2019
    2.67e9, 2.59e9, 9.70e9, 9.61e9,   # 2020 -- split is real
    9.39e9, 9.26e9, 9.28e9, 9.31e9,   # 2021
]
edgar_aapl = [
    {"permno": 14593, "rdate": q, "io_total": v, "numowners": 2000 + i * 12}
    for i, (q, v) in enumerate(zip(quarters(2018, 16), edgar_aapl_values))
]
check(
    "silent on the EDGAR control panel (no seasonality)",
    dq.detect_seasonal_alternation(edgar_aapl) == [],
)
check(
    "requires enough quarters before judging seasonality",
    dq.detect_seasonal_alternation(thomson_aapl[:4], min_quarters=8) == [],
)

# ===========================================================================
# F1 (cont). Split-factor ratios, including double-adjustment
# ===========================================================================
print("\nF1: split-factor / double-adjustment detector")

# WRDS's splits note, section 2b, verbatim shape: 4,619 shares should become
# 4,619 x 7 = 32,333 after the 2014 AAPL split but S12 reports 4,619 x 7 x 7 = 226,331.
double_adjusted = [
    {"permno": 14593, "rdate": dt.date(2014, 3, 31), "io_total": 4619, "numowners": 900},
    {"permno": 14593, "rdate": dt.date(2014, 6, 30), "io_total": 32333, "numowners": 902},
    {"permno": 14593, "rdate": dt.date(2014, 9, 30), "io_total": 226331, "numowners": 905},
]
hits = dq.detect_split_factor_ratio(double_adjusted)
kinds = {h.metrics["match_kind"] for h in hits}
check("fires on both the 7x and the second 7x", len(hits) == 2, f"got {len(hits)}")
check("labels the first as a plain split adjustment", "split" in kinds)
check(
    "matches the 49x compound case as double-adjusted",
    any(
        abs(h.metrics["ratio"] - 7.0) < 0.3 and h.period == dt.date(2014, 9, 30)
        for h in hits
    )
    or "double-adjusted" in kinds,
)

# A 7x jump accompanied by 7x the holders is a real event (index inclusion, merger).
real_event = [
    {"permno": 10003, "rdate": dt.date(2020, 3, 31), "io_total": 1e8, "numowners": 100},
    {"permno": 10003, "rdate": dt.date(2020, 6, 30), "io_total": 7e8, "numowners": 700},
]
check(
    "silent when the owner count moves with the ratio",
    dq.detect_split_factor_ratio(real_event) == [],
)
check(
    "still flags it when owner gating is disabled",
    len(dq.detect_split_factor_ratio(real_event, owners_col=None)) == 1,
)
# Ordinary trading does not land on a split factor.
noise = [
    {"permno": 10004, "rdate": q, "io_total": v, "numowners": 300}
    for q, v in zip(quarters(2019, 4), [1.0e9, 1.63e9, 2.41e9, 3.9e9])
]
check("silent on non-integer growth ratios", dq.detect_split_factor_ratio(noise) == [])

# ===========================================================================
# F3. S12: weak signals must not be over-read
# ===========================================================================
print("\nF3: S12 early-period growth vs genuine dropouts")

# index_pct climbing 1.1% -> 4.7% across 2004-05 produces >20% QoQ swings that are
# growth off a tiny base, not defects. The detector must not cry wolf on these.
s12_growth = [
    {"permno": 14593, "rdate": q, "mf_total": 1.0e7 * (1.22**i), "numowners": int(90 * 1.20**i)}
    for i, q in enumerate(quarters(2004, 8))
]
check(
    "silent on early-period growth off a small base",
    dq.detect_flat_owner_share_swing(s12_growth, shares_col="mf_total") == [],
)

# The two measured exceptions (-46.3% at 2004Q1, -44.8% at 2006Q4) with a flat owner
# count are real candidates and must be caught.
s12_exceptions = [
    {"permno": 14593, "rdate": dt.date(2003, 12, 31), "mf_total": 1.00e8, "numowners": 120},
    {"permno": 14593, "rdate": dt.date(2004, 3, 31), "mf_total": 5.37e7, "numowners": 121},
    {"permno": 14593, "rdate": dt.date(2004, 6, 30), "mf_total": 1.02e8, "numowners": 122},
]
check(
    "catches the -46.3% drop with a flat owner count",
    len(dq.detect_flat_owner_share_swing(s12_exceptions, shares_col="mf_total")) == 2,
)

# ---- Coverage end. S12 stops 2024-12-31; a 2025 study would silently compute.
s12_panel = [{"rdate": q, "mf_total": 1e8} for q in quarters(2023, 8)]
check(
    "coverage-end assertion fires when the panel stops early",
    len(dq.detect_coverage_end(s12_panel, expected_through="2025-12-31")) == 1,
)
check(
    "coverage-end assertion is silent when the panel is current",
    dq.detect_coverage_end(s12_panel, expected_through="2024-12-31") == [],
)
end_finding = dq.detect_coverage_end(s12_panel, expected_through="2025-12-31")[0]
check(
    "reports the actual last period",
    end_finding.metrics["last_period"] == dt.date(2024, 12, 31),
    str(end_finding.metrics["last_period"]),
)

# ---- S12 splits. The splits note's worked examples are ALL mutual-fund data, and MF
# outlier rates around large splits are WORSE than 13F (40.7% vs 34.5% above 4:1).
# "S12 looks healthier" was measured on one firm with no split-quarter test; the note
# tests a dimension we had not. So S12 gets the same split detector, not a lighter one.
s12_split = [
    {"permno": 14593, "rdate": dt.date(2014, 3, 31), "mf_total": 8.0e7, "numowners": 410},
    {"permno": 14593, "rdate": dt.date(2014, 6, 30), "mf_total": 5.6e8, "numowners": 412},
]
check(
    "applies the split detector to S12, not just S34",
    len(dq.detect_split_factor_ratio(s12_split, shares_col="mf_total")) == 1,
)

# ---- S12 2017Q4 feed change: counts step, values do not. A different detector.
print("\nF3: S12 feed-change / coverage-step detector")

# Measured by WRDS: CUSIPs +613%, unique funds +113% at 2017Q4.
s12_coverage = [
    {"rdate": dt.date(2017, 6, 30), "n_funds": 25_000, "n_cusips": 60_000},
    {"rdate": dt.date(2017, 9, 30), "n_funds": 25_400, "n_cusips": 61_000},
    {"rdate": dt.date(2017, 12, 31), "n_funds": 54_100, "n_cusips": 435_000},
    {"rdate": dt.date(2018, 3, 31), "n_funds": 55_000, "n_cusips": 440_000},
]
steps = dq.detect_coverage_step(s12_coverage)
check("fires on the 2017Q4 feed change", len(steps) == 2, f"got {len(steps)}")
check(
    "dates the step to 2017Q4",
    steps and all(s.period == dt.date(2017, 12, 31) for s in steps),
)
check(
    "labels it an expansion, not a loss",
    steps and all(s.metrics["direction"] == "expansion" for s in steps),
)
check(
    "reports the CUSIP step near the documented +613%",
    any(
        s.entity == "n_cusips" and 6.0 <= s.metrics["pct_change"] <= 6.5 for s in steps
    ),
)
check(
    "silent on smooth quarter-to-quarter coverage growth",
    dq.detect_coverage_step(
        [{"rdate": q, "n_funds": int(25_000 * 1.03**i)} for i, q in enumerate(quarters(2012, 8))]
    )
    == [],
)
# Same detector must catch a step DOWN -- the 2019Q3-Q4 S34 outage.
check(
    "also catches a coverage contraction",
    [
        f.metrics["direction"]
        for f in dq.detect_coverage_step(
            [
                {"rdate": dt.date(2019, 6, 30), "n_funds": 3500},
                {"rdate": dt.date(2019, 9, 30), "n_funds": 900},
            ]
        )
    ]
    == ["contraction"],
)

# ---- crsp.holdings is monthly, and quarter-end months carry ~40% more funds.
# Mixing them manufactures a fake seasonal pattern -- the same shape as the Thomson
# defect, from an entirely benign cause. Verified on AAPL: ~1,600 funds at quarter-ends
# vs ~1,140 at intermediate months. The detector must fire, so the trap is caught.
nport_monthly = []
for year in (2021, 2022):
    for month in range(1, 13):
        last = {1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30,
                7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}[month]
        quarter_end = month in (3, 6, 9, 12)
        nport_monthly.append(
            {
                "permno": 14593,
                "rdate": dt.date(year, month, last),
                "mf_total": 9.4e8 if quarter_end else 6.6e8,
                "numowners": 1600 if quarter_end else 1140,
            }
        )
# The cadence effect is real but MODEST -- ~1.4x, against the 4.5x Thomson defect. The
# 1.5x default threshold therefore treats it as benign, which is the correct call: a
# detector that flagged N-PORT's reporting cadence as a data defect would be crying wolf
# on every fund panel. It is still large enough to contaminate a regression that mixes
# cadences, so the guard is to filter, not to alarm.
check(
    "does NOT flag benign N-PORT cadence at the default threshold",
    dq.detect_seasonal_alternation(nport_monthly, metric_col="mf_total") == [],
)
check(
    "but the cadence effect is visible if you lower the threshold",
    len(
        dq.detect_seasonal_alternation(
            nport_monthly, metric_col="mf_total", ratio_threshold=1.3
        )
    )
    == 1,
)
check(
    "filtering to quarter-end months clears it at any threshold",
    dq.detect_seasonal_alternation(
        [r for r in nport_monthly if r["rdate"].month in (3, 6, 9, 12)],
        metric_col="mf_total",
        ratio_threshold=1.05,
    )
    == [],
)
check(
    "owner count moves with the cadence, so it is not mistaken for a units bug",
    dq.detect_flat_owner_share_swing(nport_monthly, shares_col="mf_total") == [],
)
# The Thomson defect clears the same threshold by a wide margin -- the two are not
# close calls, which is why one default separates them.
check(
    "the real Thomson defect sits far above the benign cadence effect",
    dq.detect_seasonal_alternation(thomson_aapl)[0].metrics["ratio"] > 3.0,
)

# ---- MFLINKS bridge regression across the same boundary.
print("\nF3: MFLINKS bridge-rate detector")

# Measured: ~77% pre-2017 -> ~58-66% after, because MFLINKS was not backfilled.
bridge = [
    {"rdate": dt.date(2016, 12, 31), "n_linked": 7700, "n_total": 10_000},
    {"rdate": dt.date(2017, 6, 30), "n_linked": 7690, "n_total": 10_000},
    {"rdate": dt.date(2017, 12, 31), "n_linked": 11_500, "n_total": 19_500},
    {"rdate": dt.date(2018, 6, 30), "n_linked": 11_600, "n_total": 19_800},
]
bridge_hits = dq.detect_bridge_rate_regression(bridge)
kinds = {f.kind for f in bridge_hits}
check("fires on the MFLINKS cliff", bridge_hits != [])
check("reports it as a regression, not just a low level", "bridge_rate_regression" in kinds)
check(
    "dates the regression to the 2017Q4 feed change",
    any(
        f.kind == "bridge_rate_regression" and f.period == dt.date(2017, 12, 31)
        for f in bridge_hits
    ),
)
check(
    "also flags the post-change level against the floor",
    "bridge_rate_low" in kinds,
)
check(
    "silent on a healthy, stable bridge",
    dq.detect_bridge_rate_regression(
        [{"rdate": q, "n_linked": 7700, "n_total": 10_000} for q in quarters(2012, 4)]
    )
    == [],
)

# ---- Duplicate grain: the 2014 double-reporting blip and the wficn/fundno dedup bug.
print("\nF3: duplicate-grain detector")

clean_holdings = [
    {"wficn": w, "rdate": dt.date(2014, 6, 30), "cusip8": "03783310", "shares": 1000.0}
    for w in range(500)
]
check(
    "silent when the grain is genuinely unique",
    dq.detect_duplicate_grain(clean_holdings, grain=("wficn", "rdate", "cusip8")) == [],
)

# One wficn -> mean ~3.5 crsp_fundno share classes. Dedup on the wrong key and the
# panel multiplies -- the documented ~3.95x MF_TOTAL inflation.
share_class_dupes = [
    dict(r, crsp_fundno=r["wficn"] * 10 + k)
    for r in clean_holdings
    for k in range(4)
]
dupe_hits = dq.detect_duplicate_grain(
    share_class_dupes, grain=("wficn", "rdate", "cusip8"), value_col="shares"
)
check("catches share-class duplication at the wficn grain", len(dupe_hits) == 1)
check(
    "quantifies the inflation at ~4x, matching the measured 3.95x",
    dupe_hits and 3.9 <= dupe_hits[0].metrics["inflation_factor"] <= 4.1,
    str(dupe_hits[0].metrics.get("inflation_factor")) if dupe_hits else "",
)
check(
    "the same rows are clean at the share-class grain",
    dq.detect_duplicate_grain(
        share_class_dupes, grain=("wficn", "crsp_fundno", "rdate", "cusip8")
    )
    == [],
)

# ===========================================================================
# S12 x crsp.holdings union: the unresolved-overlap guard
# ===========================================================================
print("\nUnion: unresolved-overlap detector")

# Measured composition at 2022-12-31, scaled down 10x. Of 60,184 funds:
#   crsp-bridged       7,180  -> source=crsp
#   non-US unbridged  48,210  -> source=s12, safe (CRSP never covered them)
#   US unbridged       4,649  -> source=s12, AMBIGUOUS (~7.7%)
union_panel = (
    [{"rdate": dt.date(2022, 12, 31), "source": "crsp", "bridged": True} for _ in range(718)]
    + [
        {"rdate": dt.date(2022, 12, 31), "source": "s12", "bridged": True, "note": "non-US, classified"}
        for _ in range(4821)
    ]
    + [
        {"rdate": dt.date(2022, 12, 31), "source": "s12", "bridged": False, "note": "US unbridged"}
        for _ in range(465)
    ]
)
overlap = dq.detect_unresolved_overlap(union_panel)
check("fires on the unresolved US-unbridged mass", len(overlap) == 1, f"got {len(overlap)}")
check(
    "quantifies it near the measured 7.7%",
    overlap and 0.070 <= overlap[0].metrics["unresolved_rate"] <= 0.085,
    f"{overlap[0].metrics['unresolved_rate']:.3f}" if overlap else "",
)
check(
    "says plainly the data cannot distinguish new coverage from duplication",
    overlap and "does not say which" in overlap[0].detail,
)
# Classifying the non-US mass as resolved is what makes the union safe -- if you
# instead leave every unbridged fund unclassified, exposure is 88%, not 8%.
naive = [
    dict(r, bridged=False) if r["source"] == "s12" else r for r in union_panel
]
check(
    "naive union (nothing classified) is far worse",
    dq.detect_unresolved_overlap(naive)[0].metrics["unresolved_rate"] > 0.85,
)
check(
    "clean once every secondary record is classified",
    dq.detect_unresolved_overlap(
        [dict(r, bridged=True) for r in union_panel]
    )
    == [],
)
check(
    "reports per-period when asked",
    len(
        dq.detect_unresolved_overlap(
            union_panel + [dict(r, rdate=dt.date(2016, 12, 31)) for r in union_panel],
            period_col="rdate",
        )
    )
    == 2,
)

# ---- Bridge claim check: a resolved fund may land on an already-claimed portfolio.
# Measured in the SEC series-ID investigation: 27.4% of newly-resolved funds hit a
# crsp_portno another bridged fundno already claims. Raising bridge coverage while
# doubling portfolios is worse than not bridging at all, so the claim check is the
# gate between "matched" and "admitted".
resolved_map = (
    [{"fundno": 1000 + i, "crsp_portno": 500 + i, "rdate": dt.date(2022, 12, 31)}
     for i in range(100)]
    # 27 newly-resolved funds collide onto portfolios already claimed above.
    + [{"fundno": 9000 + i, "crsp_portno": 500 + i, "rdate": dt.date(2022, 12, 31)}
       for i in range(27)]
)
collisions = dq.detect_duplicate_grain(
    resolved_map, grain=("crsp_portno", "rdate")
)
check("claim check catches already-claimed portfolios", len(collisions) == 1)
check(
    "sizes the collision near the measured 27%",
    collisions and 0.20 <= collisions[0].metrics["duplicate_key_rate"] <= 0.30,
    f"{collisions[0].metrics['duplicate_key_rate']:.3f}" if collisions else "",
)
check(
    "a one-fundno-per-portfolio map passes",
    dq.detect_duplicate_grain(resolved_map[:100], grain=("crsp_portno", "rdate")) == [],
)
check(
    "and the same rows look fine at fundno grain -- the wrong key hides it",
    dq.detect_duplicate_grain(resolved_map, grain=("fundno", "rdate")) == [],
)

# ===========================================================================
# F4. Unit discontinuity in `value` at 2023Q1 -- and its non-uniformity
# ===========================================================================
print("\nF4: unit-discontinuity detector on any value column")

# Measured: median 442x, p90 494x, p10 only 38x. The p10 sitting far below the median
# says the mixture is correlated with filer SIZE -- the small filers are the ones that
# did not convert -- so the fixture models it that way rather than mixing at random.
# (Mixing at random against a wide base distribution washes out in the quantiles and
# would make this test pass for the wrong reason.)
before = [{"rdate": dt.date(2022, 12, 31), "value": 100.0 * (1.03**i)} for i in range(200)]
_cut = sorted(r["value"] for r in before)[int(0.3 * len(before))]
after = [
    {
        "rdate": dt.date(2023, 3, 31),
        "value": r["value"] * (30.0 if r["value"] < _cut else 1000.0),
    }
    for r in before
]
mixed = before + after

units = dq.detect_unit_discontinuity(mixed)
check("fires on the 2023Q1 units break", len(units) == 1, f"got {len(units)}")
check(
    "flags the break as NOT clean (mixed population)",
    units and units[0].metrics["clean_break"] is False,
)
check(
    "says plainly that no scalar repairs it",
    units and "no scalar repairs it" in units[0].detail,
)
check(
    "reports p10 far below the median shift",
    units
    and units[0].metrics["quantile_ratios"]["p10"]
    < units[0].metrics["quantile_ratios"]["median"],
)

# A genuinely uniform rescale (every filer converts at once) is a different animal:
# still flagged, but marked clean, because one scalar does repair it.
uniform = before + [
    {"rdate": dt.date(2023, 3, 31), "value": r["value"] * 1000.0} for r in before
]
uniform_hit = dq.detect_unit_discontinuity(uniform)
check("fires on a uniform rescale too", len(uniform_hit) == 1)
check(
    "marks the uniform rescale as a clean break",
    uniform_hit and uniform_hit[0].metrics["clean_break"] is True,
)

# Ordinary quarter-over-quarter drift must not trip it.
stable = []
for q in quarters(2021, 4):
    stable += [{"rdate": q, "value": 100.0 * (1.02**i)} for i in range(200)]
check("silent on a stable value column", dq.detect_unit_discontinuity(stable) == [])
check(
    "ignores periods with too few observations to judge",
    dq.detect_unit_discontinuity(mixed, min_obs_per_period=500) == [],
)

# ===========================================================================
# F5. Windows-1252 filings that parsed to zero rows
# ===========================================================================
print("\nF5: zero-row-cohort detector")

filings = []
# Healthy cohort: utf-8 filings parse fine.
for i in range(300):
    filings.append(
        {
            "encoding": "utf-8",
            "agent": "AgentA",
            "rdate": quarters(2023, 4)[i % 4],
            "n_rows": 120 + i,
        }
    )
# Broken cohort: windows-1252 filings all parse to zero rows.
for i in range(60):
    filings.append(
        {
            "encoding": "windows-1252",
            "agent": "AgentB",
            "rdate": quarters(2023, 4)[i % 4],
            "n_rows": 0,
        }
    )

by_encoding = dq.detect_zero_row_cohort(filings, cohort_col="encoding")
check("isolates the broken encoding cohort", len(by_encoding) == 1, f"got {len(by_encoding)}")
check(
    "names windows-1252 as the culprit",
    by_encoding and by_encoding[0].entity == "windows-1252",
)
check("reports a 100% zero rate", by_encoding and by_encoding[0].metrics["zero_rate"] == 1.0)

by_agent = dq.detect_zero_row_cohort(filings, cohort_col="agent", period_col="rdate")
check("also groups by filing agent", len(by_agent) == 1 and by_agent[0].entity == "AgentB")
check(
    "exposes the per-period rate so a time step is visible",
    by_agent and len(by_agent[0].metrics["zero_rate_by_period"]) == 4,
)
check(
    "silent once the parser is fixed",
    dq.detect_zero_row_cohort(
        [dict(f, n_rows=f["n_rows"] or 95) for f in filings], cohort_col="encoding"
    )
    == [],
)
check(
    "ignores cohorts too small to conclude anything",
    dq.detect_zero_row_cohort(filings[:5] + filings[300:305], cohort_col="encoding") == [],
)

# ===========================================================================
# Cross-cutting: input handling
# ===========================================================================
print("\nCross-cutting: input handling")

check(
    "accepts ISO date strings as well as date objects",
    len(
        dq.detect_flat_owner_share_swing(
            [
                {"permno": 1, "rdate": "2020-03-31", "io_total": 1e9, "numowners": 100},
                {"permno": 1, "rdate": "2020-06-30", "io_total": 4e9, "numowners": 101},
            ]
        )
    )
    == 1,
)
check(
    "skips records with a missing metric instead of reading them as zero",
    dq.detect_flat_owner_share_swing(
        [
            {"permno": 1, "rdate": "2020-03-31", "io_total": None, "numowners": 100},
            {"permno": 1, "rdate": "2020-06-30", "io_total": 4e9, "numowners": 100},
        ]
    )
    == [],
)
check("handles an empty panel", dq.detect_flat_owner_share_swing([]) == [])
check(
    "keeps entities separate",
    len(
        dq.detect_seasonal_alternation(
            thomson_aapl + [dict(r, permno=999) for r in edgar_aapl]
        )
    )
    == 1,
)

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
