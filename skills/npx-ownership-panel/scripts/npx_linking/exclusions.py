#!/usr/bin/env python3
"""Step 0: classify ISS filers that can never carry a SEC series ID.

Some ISS N-PX filers are not registered investment companies, so no series ID
exists for them at any vintage, they file no N-PORT, and they have no CRSP fund
record. Measured 2026-08-28 over `risk.voteanalysis_npx`: 7 asset owners carry
1.04% of all vote rows and 170 non-US managers carry 0.99%.

**Run this BEFORE matching, not after.** These rows are otherwise live inputs to
the global fuzzy tier, which has no reason not to bind "CalPERS" to a fund whose
name shares tokens with California. Filtering the RESULTS cannot undo a
candidate that already competed.

The verdict is taken from `institutionname`, never `fundname`. "Retirement"
appears in hundreds of legitimate target-date fund names -- T. Rowe Price
Retirement 2040, Fidelity Freedom Retirement Income -- and matching the keyword
against the fund name would drop a whole product category.
"""

from __future__ import annotations

import re

import pandas as pd

#: ISS marks non-US managers with a trailing asterisk on `institutionname`.
NON_US_SUFFIX = "*"

#: Plan sponsors and asset owners. Deliberately institution-scoped -- see the
#: module docstring for why this must never be applied to a fund name.
ASSET_OWNER = re.compile(
    r"\b(pension|retirement|superannuation|provident|endowment|"
    r"investment board|teachers|employees|sovereign|state board)\b",
    re.IGNORECASE,
)

#: Names that are asset owners without carrying a keyword.
ASSET_OWNER_NAMED = re.compile(r"\b(calpers|calstrs)\b", re.IGNORECASE)


def _verdict(institution: str) -> str | None:
    inst = (institution or "").strip()
    if not inst:
        return None
    if ASSET_OWNER.search(inst) or ASSET_OWNER_NAMED.search(inst):
        return "asset_owner"
    if inst.endswith(NON_US_SUFFIX):
        return "non_us_manager"
    return None


def classify(funds: pd.DataFrame) -> pd.DataFrame:
    """Return `funds` with an `exclusion` column: asset_owner, non_us_manager, or NA.

    Idempotent: an already-classified frame reclassifies to the same verdicts,
    so the pass can run again without a guard.
    """
    out = funds.copy()
    out["exclusion"] = (
        out["institutionname"].astype(object).map(_verdict).astype("object")
    )
    return out
