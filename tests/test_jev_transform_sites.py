"""DQ4/DQ6 transform sites: a groupby is row-changing only when the chain aggregates it.

`df.groupby(k).col.transform(f)` and `.cumsum()`, `.shift()`, `.rank()` return one value per input row, so the
assignment changes no row count and owes no count line. `.agg()`, `.size()`, `.sum()` collapse the groups.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "checks" / "_jev"))
from _ds import transform_sites  # noqa: E402


def _lines(src):
    return [s["line"] for s in transform_sites("x.py", src.strip("\n").split("\n"))]


def test_length_preserving_groupby_is_not_a_transform_site():
    src = """
keep = d.groupby("event_id").mover.transform(lambda s: s.sum() == 1)
cum = d.groupby("g")["x"].cumsum()
prev = d.groupby(["g", "h"]).x.shift(1)
n = d.groupby("g").cumcount()
"""
    assert _lines(src) == []


def test_aggregating_groupby_is_still_a_transform_site():
    src = """
per = d.groupby("g").agg(n=("x", "size"))
tot = d.groupby("g").x.sum()
sz = d.groupby("g").size()
pl_per = df.group_by("g").agg(pl.len())
"""
    assert _lines(src) == [1, 2, 3, 4]


def test_other_row_methods_in_a_preserving_chain_still_count():
    src = """
d2 = d.dropna(subset=["x"]).groupby("g").x.transform("mean")
"""
    assert _lines(src) == [1]
