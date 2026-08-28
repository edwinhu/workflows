#!/usr/bin/env python3
"""Per-tier coverage report.

The ladder's headline has always been one number -- "80.8% of vote rows linked"
-- which mixes exact identifiers with global fuzzy matches. That number cannot
answer the question a precision-first build exists to answer: how much of the
panel rests on an identifier and how much on a guess.

So this report states every tier separately and publishes NO blended total. A
caller wanting a sum can add `exact` and `fuzzy`, having been shown both.

Two denominators matter and only one is right. Structurally unlinkable filers --
asset owners and non-US managers, ~2% of ISS vote rows -- are not matching
failures: no series ID exists for them at any vintage. Counting them in the
denominator makes 100% unreachable and understates precision by a fixed ~2
points forever. They are reported in their own bucket instead.
"""

from __future__ import annotations

import pandas as pd

#: Tiers resting on an identifier rather than a name comparison.
EXACT_TIERS = frozenset({"exact_seriesid", "cik_single_portfolio",
                         "via_seriesid", "via_sec_ticker"})


def _bucket(rows: pd.DataFrame, weight: str, denom: int) -> dict:
    n = int(rows[weight].sum())
    return {
        "vote_rows": n,
        "pct": (100.0 * n / denom) if denom else 0.0,
        "fundids": int(rows["fundid"].nunique()) if len(rows) else 0,
    }


def build(linked: pd.DataFrame, weight: str = "n") -> dict:
    """Report coverage by tier, with exact and fuzzy never summed."""
    excluded_mask = linked["exclusion"].notna()
    excluded = linked[excluded_mask]
    linkable = linked[~excluded_mask]
    denom = int(linkable[weight].sum())

    resolved = linkable[linkable["tier"].notna()]
    tiers = []
    for tier, grp in resolved.groupby("tier", sort=False):
        tiers.append({
            "tier": str(tier),
            "kind": "exact" if str(tier) in EXACT_TIERS else "fuzzy",
            **_bucket(grp, weight, denom),
        })
    tiers.sort(key=lambda r: -r["vote_rows"])

    is_exact = resolved["tier"].isin(EXACT_TIERS)
    return {
        "vote_rows_total": int(linked[weight].sum()),
        "vote_rows_linkable": denom,
        "tiers": tiers,
        "exact": _bucket(resolved[is_exact], weight, denom),
        "fuzzy": _bucket(resolved[~is_exact], weight, denom),
        "unlinked": _bucket(linkable[linkable["tier"].isna()], weight, denom),
        "excluded": _bucket(excluded, weight, denom),
    }
