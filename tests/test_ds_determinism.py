"""ds-determinism must know every spelling of "seeded", and only those.

Run: python3 -m pytest tests/test_ds_determinism.py -v

It knew `random_state=` (pandas) alone, so on 2026-09-16 it reported four calls as
non-deterministic and all four were seeded: three polars `.sample(seed=...)` and one stdlib
`random.sample` preceded by `random.seed(7)`. A rule that calls a seeded sample unseeded is
wrong, and correcting it is not a loosening — which is what the second half of this file pins.
"""

import importlib.util
import os
import sys

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "ds_determinism",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "constraints", "ds-determinism.py"),
)
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)


def _check(tmp_path, body):
    (tmp_path / "m.py").write_text(body)
    return _MOD.check({"cwd": str(tmp_path)})


# ---- the three spellings that ARE seeded --------------------------------------------------

def test_pandas_random_state_is_seeded(tmp_path):
    assert _check(tmp_path, "d = df.sample(n=5, random_state=0)\n") == []


def test_polars_seed_is_seeded(tmp_path):
    assert _check(tmp_path, "d = df.sample(n=5, seed=7)\n") == []


def test_stdlib_random_seed_above_the_call_is_seeded(tmp_path):
    assert _check(tmp_path, "import random\nrandom.seed(7)\nx = random.sample(r, 5)\n") == []


def test_a_seed_a_few_lines_above_still_counts(tmp_path):
    assert _check(tmp_path, "random.seed(7)\na = 1\nb = 2\nx = random.sample(r, 5)\n") == []


# ---- and what must still fire --------------------------------------------------------------

def test_an_unseeded_sample_is_still_a_finding(tmp_path):
    v = _check(tmp_path, "d = df.sample(n=5)\n")
    assert len(v) == 1 and "non-deterministic" in v[0]


def test_a_seed_FAR_above_does_not_reach(tmp_path):
    """Reach is bounded, or `random.seed` anywhere in a file would excuse every sample in it."""
    body = "random.seed(7)\n" + "x = 1\n" * 10 + "d = df.sample(n=5)\n"
    assert len(_check(tmp_path, body)) == 1


def test_a_seed_BELOW_the_call_does_not_count(tmp_path):
    """Seeding after the draw does not make the draw reproducible."""
    v = _check(tmp_path, "d = df.sample(n=5)\n" + "x = 1\n" * 6 + "random.seed(7)\n")
    assert len(v) == 1
