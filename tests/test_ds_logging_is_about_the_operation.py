# /// script
# dependencies = ["pytest"]
# ///
"""A log in the window must REPORT the operation — proximity is not a diagnostic.

The three rules — merge(), the coerce error mode, and dropna() — each accepted ANY
print within a few lines. `print("done, have a nice day")` closed a merge finding; a stray
`print(f"[sql] querying ...")` closed two dropna findings. Every test below pins one
direction of the tightened rule: an unrelated log does NOT satisfy it, a real count DOES.
"""
import importlib.util
import sys
from pathlib import Path

_CONSTRAINTS = Path(__file__).resolve().parents[1] / "constraints"


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, _CONSTRAINTS / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.check


join_check = _load("ds_join_audits", "ds-join-audits.py")
err_check = _load("ds_error_handling", "ds-error-handling.py")


def run(check, tmp_path, source):
    (tmp_path / "s.py").write_text(source)
    return check({"cwd": str(tmp_path)})


# ---------------------------------------------------------------- merge()

# ds-join-audits: fixture text for the rule under test, not a merge this file performs
MERGE = 'out = a.merge(b, on="k", how="left")\n'


def test_merge_unrelated_print_does_not_satisfy(tmp_path):
    # The demonstrated vacuity: merge on line 1, cheerful print four lines later.
    assert run(join_check, tmp_path, MERGE + "x = 1\ny = 2\n" + 'print("done, have a nice day")\n')


def test_merge_bare_frame_print_does_not_satisfy(tmp_path):
    # Links to the merge, states no quantity.
    assert run(join_check, tmp_path, MERGE + "print(out)\n")


def test_merge_count_of_another_frame_does_not_satisfy(tmp_path):
    # States a quantity, about something else entirely.
    assert run(join_check, tmp_path, MERGE + 'print(f"{len(unrelated):,} config entries")\n')


def test_merge_row_counts_satisfy(tmp_path):
    assert not run(join_check, tmp_path,
                   "n0 = len(a)\n" + MERGE + 'print(f"merge: {n0:,} -> {len(out):,} rows")\n')


def test_merge_match_rate_satisfies(tmp_path):
    assert not run(join_check, tmp_path,
                   MERGE + 'print(f"matched {out.k.notna().mean():.1%} of rows")\n')


def test_merge_diagnostic_through_an_intermediate_satisfies(tmp_path):
    # The real shape in wrds/examples/voting_ownership_eda.py: the count is derived from
    # the merged frame one assignment later.
    src = MERGE + "unmatched = out.permno.isna()\n" + \
        'print(f"CUSIP match: {(~unmatched).sum():,} matched, {unmatched.sum():,} unmatched")\n'
    assert not run(join_check, tmp_path, src)


def test_merge_in_a_fluent_chain_is_linked_by_its_statement(tmp_path):
    # The chained line names no frame; the LINK must read the whole statement, or every
    # fluent pipeline reads as unlogged.
    src = ("gap = (key\n"
           # ds-join-audits: fixture text for the rule under test, not a real merge
           '       .merge(H, on=["RIC", "date"], how="inner")\n'
           '       .rename(columns={"TRDPRC_1": "prc"}))\n'
           'print(f"dropped {len(key) - len(gap):,} of {len(key):,} rows")\n')
    assert not run(join_check, tmp_path, src)


def test_merge_logger_call_counts_as_a_log(tmp_path):
    assert not run(join_check, tmp_path,
                   MERGE + 'logger.info(f"merged rows: {len(out):,}")\n')


# ---------------------------------------------------------------- the coerce error mode

# ds-error-handling: fixture text for the rule under test, not a coercion this file does
COERCE = 'df["n"] = pd.to_numeric(df.n, errors="coerce")\n'


def test_coerce_unrelated_print_does_not_satisfy(tmp_path):
    # The real regression: an unrelated [sql] line three lines above went green.
    assert run(err_check, tmp_path, 'print(f"[sql] querying {table}")\nq = 1\nr = 2\n' + COERCE)


def test_coerce_count_satisfies(tmp_path):
    assert not run(err_check, tmp_path,
                   COERCE + 'print(f"{df.n.isna().sum():,} of {len(df):,} coerced to NaN")\n')


def test_coerce_single_letter_frame_still_links(tmp_path):
    # Links through `x` in the interpolations, not through prose. The format string
    # "%d-%b-%y" must not be what links it.
    src = ('x[c] = pd.to_datetime(x[c], format="%d-%b-%y", errors="coerce")\n'
           'print(f"  {c}: {x[c].isna().sum():,} of {len(x):,} unparseable")\n')
    assert not run(err_check, tmp_path, src)


# ---------------------------------------------------------------- dropna()

# ds-error-handling: fixture text for the rule under test, not a drop this file performs
DROPNA = "clean = raw.dropna(subset=[col])\n"


def test_dropna_unrelated_print_does_not_satisfy(tmp_path):
    assert run(err_check, tmp_path, 'print(f"[sql] querying {table}")\nq = 1\nr = 2\n' + DROPNA)


def test_dropna_bare_narration_does_not_satisfy(tmp_path):
    # Names the frame, states no number. "Cleaning" is not a row count.
    assert run(err_check, tmp_path, 'print(f"cleaning {raw} now")\n' + DROPNA)


def test_dropna_row_count_satisfies(tmp_path):
    assert not run(err_check, tmp_path,
                   DROPNA + 'print(f"dropped {len(raw) - len(clean):,} of {len(raw):,} rows")\n')


def test_dropna_polars_height_satisfies(tmp_path):
    assert not run(err_check, tmp_path,
                   DROPNA + 'print(f"{raw.height - clean.height} rows dropped")\n')


# --------------------------------------------- the window itself did not widen


def test_a_real_count_outside_the_window_is_still_a_finding(tmp_path):
    filler = "".join(f"z{i} = {i}\n" for i in range(9))
    assert run(join_check, tmp_path, MERGE + filler + 'print(f"rows: {len(out):,}")\n')


if __name__ == "__main__":
    sys.exit(__import__("pytest").main([__file__, "-q"]))
