"""The ds-* waiver must be a REASON, never a suppression.

Run: python3 -m pytest tests/test_ds_waivers.py -v

Before this mechanism there was nowhere to record that a rule did not fit, so the only ways to
close such a finding were to make the code worse or to weaken the rule. scripts/doc_render.py
wraps a CACHE READ in `except Exception: pass` and ds-error-handling says "log and re-raise",
which would turn an unreadable cache into a crash.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "constraints"))
from _ds_waivers import MIN_REASON, partition  # noqa: E402


def _src(tmp_path, body):
    p = tmp_path / "m.py"
    p.write_text(body)
    return [f"m.py:2: something — a rule fired"]


def test_a_reason_on_the_cited_line_waives(tmp_path):
    v = _src(tmp_path, "x = 1\ny = 2  # ds-thing: the rule does not fit, and here is why\n")
    kept, waived = partition(v, tmp_path, "ds-thing")
    assert kept == []
    assert waived and waived[0][1].startswith("the rule does not fit")


def test_a_reason_on_the_line_ABOVE_waives(tmp_path):
    v = _src(tmp_path, "# ds-thing: stated above the line it covers, which is legal\ny = 2\n")
    kept, waived = partition(v, tmp_path, "ds-thing")
    assert kept == [] and len(waived) == 1


def test_a_waiver_with_NO_reason_waives_nothing(tmp_path):
    """The whole point: a comment with no reason is a suppression in a waiver's clothes."""
    v = _src(tmp_path, "x = 1\ny = 2  # ds-thing:\n")
    kept, waived = partition(v, tmp_path, "ds-thing")
    assert kept == v and waived == []


def test_a_reason_shorter_than_the_floor_waives_nothing(tmp_path):
    v = _src(tmp_path, "x = 1\ny = 2  # ds-thing: nope\n")
    assert len("nope") < MIN_REASON
    kept, waived = partition(v, tmp_path, "ds-thing")
    assert kept == v and waived == []


def test_a_waiver_for_a_DIFFERENT_rule_does_not_apply(tmp_path):
    """A waiver names its rule, so it cannot drift onto a finding it never meant."""
    v = _src(tmp_path, "x = 1\ny = 2  # ds-other: a perfectly good reason about another rule\n")
    kept, waived = partition(v, tmp_path, "ds-thing")
    assert kept == v and waived == []


def test_it_covers_one_line_not_the_file(tmp_path):
    """Reach is the cited line and the one above it — deliberately, since a comment usually
    sits above the code it explains. A finding further down is NOT covered."""
    p = tmp_path / "m.py"
    p.write_text("a = 1  # ds-thing: this line is genuinely exempt, for a stated reason\n"
                 "b = 2\n"
                 "c = 3\n"
                 "d = 4\n")
    kept, waived = partition(["m.py:1: x", "m.py:2: x", "m.py:4: x"], tmp_path, "ds-thing")
    # line 1 carries it; line 2 is the line below it; line 4 is out of reach.
    assert len(waived) == 2
    assert kept == ["m.py:4: x"]


def test_an_unreadable_file_is_never_treated_as_waived(tmp_path):
    kept, waived = partition(["gone.py:1: x"], tmp_path, "ds-thing")
    assert kept == ["gone.py:1: x"] and waived == []


def test_a_violation_with_no_location_is_kept(tmp_path):
    kept, waived = partition(["a sweeping statement with no file"], tmp_path, "ds-thing")
    assert len(kept) == 1 and waived == []
