#!/usr/bin/env python3
"""Tier 2: link a single-portfolio registrant by CIK.

A closed-end fund registers on Form N-2 as a single-portfolio registrant, so it
carries no SEC series ID and needs none -- the CIK *is* the fund. Measured
2026-08-28 over `risk.voteanalysis_npx`: 162 such fundids carry 987,107 vote
rows (0.41% of all), among them Royce Micro-Cap Trust, Calamos Strategic Total
Return and Cohen & Steers Total Return Realty. Without this tier they fall
through to fuzzy name matching, which is both wasteful and risky when an exact
identifier was available.

THE GUARD IS THE TIER. `fundcik` names a REGISTRANT, and a registrant may hold
dozens of portfolios; a Vanguard trust CIK resolves to many `crsp_portno`, and
choosing one would attribute a fund's votes to an arbitrary sibling. The tier
fires only where the CIK maps to exactly one portfolio.

Uniqueness is counted on `crsp_portno`, never `crsp_fundno`. One portfolio
carries a mean ~3.5 share classes, so counting fundno would read almost every
registrant as multi-portfolio and the tier would never fire.
"""

from __future__ import annotations

import pandas as pd

TIER = "cik_single_portfolio"


def link_by_cik(funds: pd.DataFrame, cik_map: pd.DataFrame) -> pd.DataFrame:
    """Attach `crsp_portno`/`crsp_fundno`/`tier` where the CIK is unambiguous.

    Every input row is preserved: a tier classifies what it can and leaves the
    residue for the next one. Rows already carrying a `seriesid` belong to
    Tier 1 and are not touched.
    """
    out = funds.copy()
    for col in ("crsp_fundno", "crsp_portno", "tier"):
        if col not in out.columns:
            out[col] = pd.NA

    if cik_map.empty:
        return out

    # A registrant is eligible only when it owns exactly one PORTFOLIO, and only
    # when every one of its rows is mapped.
    #
    # `nunique()` DROPS NaN, so a registrant with one real portno and one
    # unmapped row counted as single-portfolio and this tier fired on a
    # multi-portfolio registrant -- a silent mis-attribution in the guard that is
    # the whole tier. An unmapped row is an UNKNOWN portfolio, not the absence of
    # one, so it disqualifies. Found by audit 0828-npx-linking-tiers-audit.
    grp = cik_map.groupby("comp_cik")["crsp_portno"]
    n_mapped = grp.nunique()               # distinct non-null portfolios
    n_unmapped = grp.apply(lambda s: s.isna().sum())
    single = n_mapped[(n_mapped == 1) & (n_unmapped == 0)].index

    resolved = (
        cik_map[cik_map["comp_cik"].isin(single) & cik_map["crsp_portno"].notna()]
        .sort_values(["comp_cik", "crsp_fundno"])
        .drop_duplicates("comp_cik")
        .set_index("comp_cik")
    )

    eligible = out["seriesid"].isna() & out["fundcik"].notna() & out["tier"].isna()
    for idx in out.index[eligible]:
        cik = out.at[idx, "fundcik"]
        if cik not in resolved.index:
            continue
        out.at[idx, "crsp_fundno"] = resolved.at[cik, "crsp_fundno"]
        out.at[idx, "crsp_portno"] = resolved.at[cik, "crsp_portno"]
        out.at[idx, "tier"] = TIER
    return out
