#!/usr/bin/env python3
"""Tier 1: the exact seriesid pass, run before any fuzzy tier.

ISS populates `seriesid` only from 2023 -- 15.0% of 2023 vote rows, 95.2% of
2024, 97.7% of 2025 -- but `fundid` is stable across a fund's life, so an id
observed once carries back over every year that fundid appears. Measured
2026-08-28: 63.5% of all 238,445,215 ISS vote rows across 8,645 fundids, and
every one of them exact.

Run it as its own pass, ahead of the name tiers. A fuzzy match on a fund whose
identifier was already available is a risk taken for nothing, and the exact
share has to be reportable alone: a precision claim that adds exact and fuzzy
coverage into one number is not a precision claim.
"""

from __future__ import annotations

import pandas as pd

TIER = "exact_seriesid"


def _modal(s: pd.Series) -> str | None:
    """The id a fundid reports most often.

    ISS occasionally carries two ids for one fundid. `max()` would pick the
    lexically larger one -- a single stray 2025 row outvoting two 2024 rows --
    so the majority decides and the disagreement is recorded rather than hidden.
    """
    vals = s.dropna()
    if vals.empty:
        return None
    return vals.value_counts().idxmax()


def resolve(npx: pd.DataFrame) -> pd.DataFrame:
    """Attach `resolved_seriesid`, `tier` and `seriesid_ambiguous` per fundid.

    Every input row is preserved; the residue is what the next tier consumes.
    """
    out = npx.copy()
    per_fund = out.groupby("fundid")["seriesid"]
    modal = per_fund.apply(_modal)
    n_distinct = per_fund.nunique(dropna=True)

    out["resolved_seriesid"] = out["fundid"].map(modal)
    out["seriesid_ambiguous"] = out["fundid"].map(n_distinct > 1).fillna(False)
    out["tier"] = pd.Series(
        [TIER if pd.notna(v) else pd.NA for v in out["resolved_seriesid"]],
        index=out.index, dtype="object",
    )
    return out


def coverage(resolved: pd.DataFrame, weight: str = "n") -> dict:
    """Vote-row-weighted coverage of THIS tier alone.

    Weighted, because a fund that voted twice must not count like Vanguard.
    """
    total = int(resolved[weight].sum())
    exact = int(resolved.loc[resolved["tier"].eq(TIER), weight].sum())
    ambiguous = int(
        resolved.loc[resolved["tier"].eq(TIER) & resolved["seriesid_ambiguous"],
                     weight].sum()
    )
    return {
        "tier": TIER,
        "vote_rows_total": total,
        "vote_rows_exact": exact,
        "pct_exact": (100.0 * exact / total) if total else 0.0,
        "vote_rows_ambiguous": ambiguous,
        "fundids_exact": int(resolved.loc[resolved["tier"].eq(TIER),
                                          "fundid"].nunique()),
    }
