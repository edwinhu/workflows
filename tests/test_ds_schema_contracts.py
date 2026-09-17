# /// script
# dependencies = ["pytest"]
# ///
"""The ds-schema-contracts rule: what counts as a contract, and what does not."""
import importlib.util
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "ds_schema_contracts",
    Path(__file__).resolve().parents[1] / "constraints" / "ds-schema-contracts.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
check = _mod.check


def run(tmp_path, source):
    (tmp_path / "s.py").write_text(source)
    return check({"cwd": str(tmp_path)})


def test_a_bare_read_is_a_finding(tmp_path):
    assert run(tmp_path, "df = pl.read_parquet(p)\nprint(df)\n")


def test_a_literal_columns_list_is_itself_the_contract(tmp_path):
    assert not run(tmp_path, 'df = pl.read_parquet(p, columns=["a", "b"])\nprint(df)\n')


def test_a_columns_list_spanning_lines_still_counts(tmp_path):
    assert not run(tmp_path, 'df = pl.read_parquet(\n    p,\n    columns=["a", "b"],\n)\n')


def test_a_columns_VARIABLE_asserts_nothing(tmp_path):
    assert run(tmp_path, "def f(columns=None):\n    return pl.read_parquet(p, columns=columns)\n")


def test_an_empty_columns_list_asserts_nothing(tmp_path):
    assert run(tmp_path, "df = pl.read_parquet(p, columns=[])\nprint(df)\n")


def test_a_later_columns_kwarg_on_another_call_does_not_excuse_the_read(tmp_path):
    src = 'df = pl.read_parquet(p)\nother = f(columns=["a"])\n'
    assert run(tmp_path, src)


def test_a_post_read_check_schema_still_counts(tmp_path):
    assert not run(tmp_path, 'df = pl.read_parquet(p)\ncheck_schema(df, ["a"], name="x")\n')  # ds-schema-contracts: fixture text for the rule under test, not a load this file performs


if __name__ == "__main__":
    sys.exit(__import__("pytest").main([__file__, "-q"]))
