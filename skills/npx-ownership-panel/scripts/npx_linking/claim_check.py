#!/usr/bin/env python3
"""Claim check: one fundid per crsp_portno per period.

Resolving a fund is not the same as being allowed to add it. Measured on the
MFLINKS rebuild, 27.4% of newly-resolved funds land on a `crsp_portno` another
bridged fund already claims -- a live double-count, from either a wrong
resolution or a vendor carrying one portfolio twice. A bridge that raises
coverage while quietly doubling portfolios is worse than no bridge at all.

A collision is never settled by admitting both. The higher-confidence link keeps
the portfolio and the loser is CEDED -- pushed back to unresolved, not dropped,
because a later tier or the unlinked report still needs the row. Confidence is
the tier in ladder order: an exact identifier beats a name match, always. Where
two claims are of equal confidence there is no tiebreak, so both yield; picking
one would be a coin flip presented as data.

The grain is (crsp_portno, period), not crsp_portno. One portfolio may legitimately
pass between funds across periods -- a merger, a re-org -- and collapsing the
period would refuse those.
"""

from __future__ import annotations

import pandas as pd

#: Ladder order, most trustworthy first. Anything unlisted ranks last.
TIER_RANK = {
    "exact_seriesid": 0,
    "cik_single_portfolio": 1,
    "via_seriesid": 2,
    "via_sec_ticker": 3,
    "sec_name": 4,
    "crsp_name_scoped": 5,
    "crsp_name_global": 6,
}
UNRANKED = len(TIER_RANK) + 1


def _rank(tier) -> int:
    if tier is None or (isinstance(tier, float) and pd.isna(tier)):
        return UNRANKED
    return TIER_RANK.get(str(tier), UNRANKED)


def enforce(links: pd.DataFrame) -> pd.DataFrame:
    """Return `links` with `claim` set to kept/ceded, ceding losers' crsp_portno."""
    out = links.copy()
    out["claim"] = pd.Series([pd.NA] * len(out), index=out.index, dtype="object")

    resolved = out["crsp_portno"].notna()
    if not resolved.any():
        return out

    work = out.loc[resolved].copy()
    work["_rank"] = work["tier"].map(_rank)

    for (_portno, _period), grp in work.groupby(["crsp_portno", "period"], sort=False):
        if len(grp) == 1:
            out.loc[grp.index, "claim"] = "kept"
            continue
        best = grp["_rank"].min()
        winners = grp.index[grp["_rank"] == best]
        # A unique best rank wins the portfolio; a tie means nobody does.
        if len(winners) == 1:
            out.loc[winners, "claim"] = "kept"
            losers = grp.index.difference(winners)
        else:
            losers = grp.index
        out.loc[losers, "claim"] = "ceded"
        out.loc[losers, "crsp_portno"] = pd.NA

    return out
