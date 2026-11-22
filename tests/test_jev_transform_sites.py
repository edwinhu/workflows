"""DQ4/DQ6 transform sites: a groupby is row-changing only when the chain aggregates it.

`df.groupby(k).col.transform(f)` and `.cumsum()`, `.shift()`, `.rank()` return one value per input row, so the
assignment changes no row count and owes no count line. `.agg()`, `.size()`, `.sum()` collapse the groups.
"""
import sys
from pathlib import Path

# Import _ds in isolation: another suite owns a top-level `_common` (scripts/cite-fidelity), and _ds does `from _common import _read`.
_JEV = str(Path(__file__).resolve().parents[1] / "checks" / "_jev")
_saved = {m: sys.modules.pop(m) for m in ("_common", "_ds") if m in sys.modules}
sys.path.insert(0, _JEV)
try:
    from _ds import transform_sites  # noqa: E402
finally:
    sys.path.remove(_JEV)
    for _m in ("_common", "_ds"):
        sys.modules.pop(_m, None)
    sys.modules.update(_saved)


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


def _shown(src):
    sites = transform_sites("x.py", src.strip("\n").split("\n"))
    assert len(sites) == 1, sites
    return sites[0]["output_count_shown"]


def test_audit_call_with_nested_call_before_the_frame_credits_it():
    src = """
out = sc.merge(uni(d), on="cik", how="left", validate="1:1")
audit_join(f"[{label}] {p} scored x universe", sc, uni(d), out, ["cik"])
"""
    assert _shown(src) is True


def test_log_call_naming_other_frame_with_nested_call_stays_uncredited():
    src = """
out = sc.merge(uni(d), on="cik", how="left", validate="1:1")
log_rows(x, len(y))
"""
    assert _shown(src) is False


def test_fstring_nested_call_before_the_name_still_credits_it():
    src = """
out = sc.merge(uni(d), on="cik", how="left", validate="1:1")
log_rows(f"merged {len(z)}", out)
"""
    assert _shown(src) is True


def test_merge_with_no_count_stays_uncredited():
    src = """
out = sc.merge(uni(d), on="cik", how="left", validate="1:1")
print("done")
"""
    assert _shown(src) is False
