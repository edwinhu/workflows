"""check_schema must fail where the assumption broke, and say what arrived.

Run: python3 -m pytest tests/test_ds_schema.py -v
"""

import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "skills", "ds", "scripts"))
from ds_schema import SchemaError, check_schema  # noqa: E402


def _df(**cols):
    return pd.DataFrame({k: [v] for k, v in cols.items()})


def test_a_frame_with_the_columns_passes_and_is_returned(capsys):
    d = _df(permno=1, date="2024-01-01", prc=9.5)
    assert check_schema(d, ["permno", "prc"], name="universe") is d
    assert "universe: 1 rows x 3 cols" in capsys.readouterr().out


def test_a_missing_column_raises_and_names_BOTH_sides():
    """Half a diagnosis is the missing name; the other half is what did arrive."""
    with pytest.raises(SchemaError) as e:
        check_schema(_df(permno=1, prc=9.5), ["permno", "date"], name="universe")
    msg = str(e.value)
    assert "missing ['date']" in msg
    assert "permno" in msg and "prc" in msg      # what arrived


def test_extra_columns_are_allowed_by_default():
    """A SELECT gaining a field breaks nothing downstream; refusing it makes every upstream
    addition a downstream outage."""
    check_schema(_df(a=1, b=2, c=3), ["a"], name="x", quiet=True)


def test_exact_refuses_an_extra_column_where_the_set_IS_the_contract():
    with pytest.raises(SchemaError) as e:
        check_schema(_df(a=1, b=2), ["a"], name="x", exact=True, quiet=True)
    assert "unexpected column(s) ['b']" in str(e.value)


def test_it_does_not_repair_its_input():
    """A contract that coerces or subsets is not a contract."""
    d = _df(a=1, b=2)
    out = check_schema(d, ["a"], name="x", quiet=True)
    assert list(out.columns) == ["a", "b"]
    assert out is d


def test_quiet_suppresses_the_shape_line_but_not_the_failure(capsys):
    check_schema(_df(a=1), ["a"], name="x", quiet=True)
    assert capsys.readouterr().out == ""
    with pytest.raises(SchemaError):
        check_schema(_df(a=1), ["b"], name="x", quiet=True)


def test_SchemaError_is_a_KeyError_so_existing_handlers_still_catch_it():
    assert issubclass(SchemaError, KeyError)
