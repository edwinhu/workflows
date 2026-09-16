#!/usr/bin/env python3
"""One column contract per data load, stated once and checked at the boundary.

WHY A HELPER RATHER THAN AN ASSERT PER SITE. This repo had 118 loads with no contract at all,
and writing 118 bespoke asserts produces 118 different failure messages — the one thing you
need to be uniform when a schema moves under you at 3am. It also makes the cheap half free: a
load that states its columns can state its SHAPE in the same line, which is the fact every
later "why is my panel small" question starts from.

    from ds_schema import check_schema

    u = pd.read_sql(UNIV_SQL, conn)
    check_schema(u, ["permno", "date", "prc"], name="universe")

WHAT IT REFUSES TO DO. It does not coerce, rename, or subset. A contract that repairs its input
is not a contract; the point is to fail where the assumption broke rather than three transforms
later, with a message naming what was missing AND what arrived, because "missing permno" is
half a diagnosis and the other half is the eleven columns that did come.

Extra columns are allowed by default: a SELECT gaining a field breaks nothing downstream, and
refusing it would make every upstream addition a downstream outage. Pass `exact=True` where the
column set itself is the contract — a file written and read by this pipeline alone.
"""

from __future__ import annotations

from typing import Iterable


class SchemaError(KeyError):
    """A data load did not carry the columns the next step depends on."""


def check_schema(df, expected: Iterable[str], *, name: str, exact: bool = False,
                 quiet: bool = False):
    """Verify `df` carries `expected`; return `df` so it can wrap a load in place."""
    have = list(df.columns)
    missing = [c for c in expected if c not in have]
    if missing:
        raise SchemaError(
            f"{name}: missing {missing}. Got {len(have)} column(s): {have}"
        )
    if exact:
        extra = [c for c in have if c not in set(expected)]
        if extra:
            raise SchemaError(
                f"{name}: unexpected column(s) {extra}. The contract is exact: {list(expected)}"
            )
    if not quiet:
        print(f"  {name}: {len(df):,} rows x {len(have)} cols")
    return df
