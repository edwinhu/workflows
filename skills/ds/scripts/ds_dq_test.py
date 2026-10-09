#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["polars", "pytest"]
# ///
# Dependencies are declared HERE, not in whoever runs the suite: a generic gate cannot know
# what a suite imports, and guessing wrong fails cases on a missing module, which reads as
# broken contracts rather than a misconfigured runner.
"""Contract suite for ${CLAUDE_PLUGIN_ROOT}/skills/ds/scripts/ds-dq.py.

WHY THIS EXISTS
    The plan this runner comes from says it plainly: a check only ever seen green is the defect the
    runner exists to fix. So every mechanical check here is exercised against a DIRTY fixture that
    genuinely violates it, and the assertion is that the runner reports FAIL -- not merely that it
    ran. The CLEAN fixture then pins the other direction, so a runner that hard-coded FAIL would be
    caught too.

    The second contract is the one that is easy to lose: M1, UNI, DEN, DEL and R1 must come back as
    MODEL-EVALUATED and must NEVER come back as PASS. A runner that presented a judgement as a
    computation would recreate, one layer down, the self-certification the whole beat removes.

    Declared in tests/script-suites.txt, so plugin-audit's script-suites leg runs it.
        uv run --with polars,pytest python3 -m pytest ${CLAUDE_PLUGIN_ROOT}/skills/ds/scripts/ds_dq_test.py -q
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import polars as pl
import pytest

RUNNER = Path(__file__).resolve().parent / "ds-dq.py"

MODEL_EVALUATED_CHECKS = ("M1", "UNI", "DEN", "DEL", "R1")
MATRIX = ["DQ1", "DQ2", "DQ3", "DQ4", "DQ5", "DQ6", "COV", "R1", "M1", "UNI", "DEN", "DEL", "ENUM"]


def _load_module():
    spec = importlib.util.spec_from_file_location("ds_dq", RUNNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ds_dq = _load_module()


# ------------------------------------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------------------------------------


@pytest.fixture
def dirty(tmp_path: Path) -> Path:
    """A constant column (DQ1) and a 60%-null column (DQ2), plus a duplicated PK (DQ3a)."""
    path = tmp_path / "dirty.parquet"
    pl.DataFrame(
        {
            "gvkey": ["001", "001", "002", "003", "004"],  # "001" twice -> PK violation
            "fyear": [2020, 2020, 2020, 2020, 2020],
            "region": ["US", "US", "US", "US", "US"],  # constant -> DQ1
            "segment": [None, None, None, "a", "b"],  # 60% null -> DQ2
            "revenue": [1.0, 2.0, 3.0, 4.0, 5.0],
        }
    ).write_parquet(path)
    return path


@pytest.fixture
def clean(tmp_path: Path) -> Path:
    path = tmp_path / "clean.parquet"
    pl.DataFrame(
        {
            "gvkey": ["001", "002", "003", "004", "005"],
            "fyear": [2020, 2021, 2022, 2023, 2024],
            "region": ["US", "EU", "US", "EU", "US"],
            "segment": ["a", "b", "a", "b", "a"],
            "revenue": [1.0, 2.0, 3.0, 4.0, 5.0],
        }
    ).write_parquet(path)
    return path


def run(path: Path, keys: str = "gvkey", window: str = "n/a") -> dict:
    return ds_dq.check_output(path, keys, window)


# ------------------------------------------------------------------------------------------------
# RED: the dirty fixture must be reported as FAIL
# ------------------------------------------------------------------------------------------------


def test_dirty_fixture_fails_dq1_constant_column(dirty: Path):
    checks = run(dirty)
    assert checks["DQ1"]["status"] == "FAIL", checks["DQ1"]
    assert "region" in checks["DQ1"]["evidence"]


def test_dirty_fixture_fails_dq2_high_null_column(dirty: Path):
    checks = run(dirty)
    assert checks["DQ2"]["status"] == "FAIL", checks["DQ2"]
    assert "segment" in checks["DQ2"]["evidence"]


def test_dirty_fixture_fails_dq3a_on_declared_pk(dirty: Path):
    checks = run(dirty, keys="gvkey")
    assert checks["DQ3a"]["status"] == "FAIL", checks["DQ3a"]
    assert checks["DQ3"]["status"] == "FAIL", checks["DQ3"]


def test_dirty_fixture_fails_cov_when_window_is_not_covered(tmp_path: Path):
    path = tmp_path / "short.parquet"
    pl.DataFrame(
        {"id": [1, 2, 3], "datadate": pl.date_range(pl.date(2020, 1, 1), pl.date(2020, 1, 3), eager=True)}
    ).write_parquet(path)
    checks = run(path, keys="id", window="datadate: 2005-01-01..2025-12-31")
    assert checks["COV"]["status"] == "FAIL", checks["COV"]
    assert "2005-01-01..2025-12-31" in checks["COV"]["detail"]


# ------------------------------------------------------------------------------------------------
# GREEN: the clean fixture must pass the same checks
# ------------------------------------------------------------------------------------------------


def test_clean_fixture_passes_dq1_and_dq2(clean: Path):
    checks = run(clean)
    assert checks["DQ1"]["status"] == "PASS", checks["DQ1"]
    assert checks["DQ2"]["status"] == "PASS", checks["DQ2"]


def test_dq1_declared_constant_column_passes(dirty: Path):
    checks = run(dirty, keys="pk: gvkey; constant: fyear, region")
    assert checks["DQ1"]["status"] == "PASS", checks["DQ1"]
    assert "region" in checks["DQ1"]["evidence"]


def test_dq1_undeclared_constant_column_still_fails(dirty: Path):
    checks = run(dirty, keys="pk: gvkey; constant: fyear")
    assert checks["DQ1"]["status"] == "FAIL", checks["DQ1"]
    assert "region" in checks["DQ1"]["evidence"]
    assert "fyear" not in checks["DQ1"]["evidence"]


def test_dq1_declared_constant_but_all_null_still_fails(tmp_path: Path):
    path = tmp_path / "empty_col.parquet"
    pl.DataFrame(
        {"id": [1, 2, 3], "paper": ["a", "a", "a"], "dead": pl.Series([None, None, None], dtype=pl.Float64)}
    ).write_parquet(path)
    checks = run(path, keys="pk: id; constant: paper, dead")
    assert checks["DQ1"]["status"] == "FAIL", checks["DQ1"]
    assert "dead" in checks["DQ1"]["evidence"]
    assert "paper" not in checks["DQ1"]["evidence"]


def test_parse_annotations_constant_aliases():
    for label in ("constant", "constant by design", "const"):
        assert ds_dq.parse_annotations(f"pk: a; {label}: x, `y`")["constant"] == ["x", "y"]


def test_clean_fixture_passes_dq3_on_declared_pk(clean: Path):
    checks = run(clean, keys="gvkey")
    assert checks["DQ3a"]["status"] == "PASS", checks["DQ3a"]
    assert checks["DQ3b"]["status"] == "PASS", checks["DQ3b"]
    assert checks["DQ3"]["status"] == "PASS", checks["DQ3"]


def test_clean_fixture_passes_cov_when_window_is_covered(tmp_path: Path):
    path = tmp_path / "wide.parquet"
    pl.DataFrame(
        {"id": [1, 2], "datadate": [date(2004, 1, 1), date(2026, 1, 1)]}
    ).write_parquet(path)
    checks = run(path, keys="id", window="datadate: 2005-01-01..2025-12-31")
    assert checks["COV"]["status"] == "PASS", checks["COV"]


# ------------------------------------------------------------------------------------------------
# The judgement/computation boundary
# ------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("check", MODEL_EVALUATED_CHECKS)
def test_judgement_checks_are_never_pass(check: str, dirty: Path, clean: Path):
    for path in (dirty, clean):
        entry = run(path)[check]
        assert entry["status"] == "MODEL-EVALUATED", (path.name, check, entry)
        assert entry["status"] != "PASS"
        assert entry["reason_source"] == "model-required"


def test_every_na_reason_comes_from_the_runner(clean: Path):
    for check, entry in run(clean).items():
        if entry["status"] == "N/A":
            assert entry["reason_source"] == "runner", (check, entry)
            assert entry["detail"].strip(), (check, entry)


def test_cov_na_names_the_unwindowed_declaration(clean: Path):
    entry = run(clean, window="n/a")["COV"]
    assert entry["status"] == "N/A"
    assert "n/a" in entry["detail"]
    assert entry["reason_source"] == "runner"


def test_dq6_na_names_the_missing_before_after_shape(clean: Path):
    entry = run(clean)["DQ6"]
    assert entry["status"] == "N/A"
    assert "before/after" in entry["detail"]


def test_enum_is_computed_over_the_whole_matrix(clean: Path):
    checks = run(clean)
    for check in MATRIX:
        assert check in checks, f"ENUM's own premise broken: no line for {check}"
    assert checks["ENUM"]["status"] == "PASS", checks["ENUM"]
    assert checks["ENUM"]["reason_source"] == "runner"


# ------------------------------------------------------------------------------------------------
# Plan-table parsing and the CLI exit code
# ------------------------------------------------------------------------------------------------


def test_data_outputs_table_is_parsed(tmp_path: Path):
    plan = tmp_path / "plan.md"
    plan.write_text(
        "# Plan\n\n## Data Outputs\n\n"
        "| Path | Grain | Key Columns | Required Window |\n"
        "|---|---|---|---|\n"
        "| data/panel.parquet | firm-year | pk: gvkey, fyear; event: gvkey, datadate | datadate: 2005-01-01..2025-12-31 |\n"
        "| data/lookup.csv | firm | gvkey | n/a |\n\n## Next\n"
    )
    rows = ds_dq.parse_data_outputs(plan.read_text())
    assert [r["path"] for r in rows] == ["data/panel.parquet", "data/lookup.csv"]
    assert ds_dq.parse_keys(rows[0]["key columns"]) == (["gvkey", "fyear"], ["gvkey", "datadate"])
    assert ds_dq.parse_window(rows[0]["required window"]) == ("datadate", "2005-01-01", "2025-12-31")
    assert ds_dq.parse_window(rows[1]["required window"]) == (None, None, None)


def test_missing_data_outputs_section_is_an_error(tmp_path: Path):
    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n\n## Tasks\n")
    with pytest.raises(ValueError, match="no `## Data Outputs` section"):
        ds_dq.parse_data_outputs(plan.read_text())


def test_cli_exits_non_zero_on_a_dirty_output(dirty: Path):
    proc = subprocess.run(
        [sys.executable, str(RUNNER), "--output", str(dirty), "--keys", "gvkey", "--window", "n/a"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 1, proc.stderr
    report = json.loads(proc.stdout)[str(dirty)]
    assert report["DQ1"]["status"] == "FAIL"
    assert report["DQ2"]["status"] == "FAIL"


def test_cli_exits_zero_on_a_clean_output(clean: Path):
    proc = subprocess.run(
        [sys.executable, str(RUNNER), "--output", str(clean), "--keys", "gvkey", "--window", "n/a"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    report = json.loads(proc.stdout)[str(clean)]
    assert report["ENUM"]["status"] == "PASS"
    assert report["M1"]["status"] == "MODEL-EVALUATED"


def test_a_declared_output_that_does_not_exist_is_a_fail(tmp_path: Path):
    checks = run(tmp_path / "absent.parquet")
    assert checks["DQ1"]["status"] == "FAIL"
    assert "does not exist" in checks["DQ1"]["detail"]
    assert checks["M1"]["status"] == "MODEL-EVALUATED"


# ------------------------------------------------------------------------------------------------
# ENUM's own non-vacuity
#
# `test_enum_is_computed_over_the_whole_matrix` above runs the full pipeline, and `check_output()`
# assigns every MATRIX key before it calls `check_enum()`. So `missing` is empty BY CONSTRUCTION on
# that path and the assertion could not have failed whatever `check_enum` did. Third-party review
# caught it: the check written to retire ENUM's self-certification was itself passing vacuously.
#
# These exercise `check_enum` directly, on inputs the full pipeline cannot produce, so the FAIL
# branch is reached at least once.
# ------------------------------------------------------------------------------------------------


def test_enum_fails_and_names_every_missing_check():
    partial = {c: {"status": "PASS"} for c in MATRIX if c not in ("ENUM", "DQ5", "COV")}
    verdict = ds_dq.check_enum(partial)
    assert verdict["status"] == "FAIL", verdict
    assert "DQ5" in verdict["detail"] and "COV" in verdict["detail"], verdict["detail"]
    assert verdict["reason_source"] == "runner"


def test_enum_fails_when_nothing_ran_at_all():
    verdict = ds_dq.check_enum({})
    assert verdict["status"] == "FAIL", verdict
    for check in MATRIX:
        if check != "ENUM":
            assert check in verdict["detail"], f"{check} not named among the missing"


def test_the_tests_matrix_has_not_drifted_from_the_runners():
    # This file keeps its own MATRIX list. If the runner gains a check and this list does not, every
    # assertion above silently stops covering it — the same drift the checks file's Iron Law forbids.
    assert list(ds_dq.MATRIX) == MATRIX, (list(ds_dq.MATRIX), MATRIX)


def test_duplicate_data_outputs_rows_are_rejected():
    # The report is keyed by Path, so two rows for one path would collapse to whichever parsed last
    # and the exit code would follow the survivor. A FAILing declaration could vanish behind a
    # weaker duplicate. Found by third-party review; the runner must refuse rather than choose.
    plan = (
        "## Data Outputs\n\n"
        "| Path | Grain | Key Columns | Required Window |\n"
        "|---|---|---|---|\n"
        "| a.parquet | one row per id | id | n/a |\n"
        "| a.parquet | one row per id | id | n/a |\n"
    )
    with pytest.raises(ValueError, match="more than once"):
        ds_dq.parse_data_outputs(plan)


def test_a_malformed_plan_still_emits_json_on_stdout(tmp_path: Path):
    # "JSON on stdout, non-zero exit" is the contract. A bare stderr line left a gate reading empty
    # stdout, which parses as "no checks ran" rather than "could not check".
    plan = tmp_path / "plan.md"
    plan.write_text("## Data Outputs\n\nno table here at all\n", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(RUNNER), "--plan", str(plan)],
        capture_output=True, text=True, check=False,
    )
    assert proc.returncode != 0, proc
    payload = json.loads(proc.stdout)
    assert payload["_error"]["status"] == "FAIL"
    assert payload["_error"]["reason_source"] == "runner"


# ------------------------------------------------------------------------------------------------
# --declarations: the FAILs a Data Outputs declaration alone would cure, found before dispatch
# ------------------------------------------------------------------------------------------------
# nevada stage1 round 2 (2026-10-07) spent a 1-2.7 h round failing ds-dq on columns the plan never
# declared — quote text, filing URLs, numerator/denominator on median and SE rows, an event list
# held to both edges of its window — and passed on the SAME files once the declarations went in.


@pytest.fixture
def undeclared(tmp_path: Path) -> Path:
    """The four nevada shapes, each curable by a declaration and by nothing in the data."""
    out = tmp_path / "data"
    out.mkdir()
    pl.DataFrame(
        {
            "statistic": ["share", "share", "median", "median", "se", "se", "diff", "diff", "n", "n"],
            "group": ["nv", "de"] * 5,
            "value": [0.1, 0.2, 3.0, 4.0, 0.01, 0.02, 0.1, 0.2, 10.0, 20.0],
            "numerator": [1, 4, None, None, None, None, None, None, None, None],
            "denominator": [10, 20, None, None, None, None, None, None, None, None],
        }
    ).write_csv(out / "table.csv")
    pl.DataFrame(
        {
            "accession": [f"0000-{i}" for i in range(10)],
            "fdate": pl.date_range(pl.date(2026, 9, 1), pl.date(2026, 10, 2), "3d", eager=True)[:9].append(
                pl.Series([date(2026, 10, 2)])),
            "url": [f"https://sec.gov/{i}" for i in range(10)],
            "model": ["gemini-3"] * 10,
        }
    ).write_csv(out / "backfill.csv")
    pl.DataFrame(
        {
            "event_id": list(range(4)),
            "effective_date": [date(1994, 3, 11), date(2001, 1, 1), date(2015, 6, 1), date(2026, 9, 18)],
        }
    ).write_parquet(out / "events.parquet")
    return tmp_path


def declarations(root: Path, plan: str) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, str(RUNNER), "--declarations", "--plan", "-", "--project-dir", str(root)],
        input=plan, capture_output=True, text=True, check=False,
    )
    return proc.returncode, json.loads(proc.stdout)


UNDECLARED_PLAN = (
    "## Data Outputs\n\n"
    "| Path | Grain | Key Columns | Required Window |\n"
    "|---|---|---|---|\n"
    "| data/table.csv | one row per statistic x group | statistic, group | n/a |\n"
    "| data/backfill.csv | one row per filing | accession | fdate: 2026-09-01..2026-10-02 |\n"
    "| data/events.parquet | one row per event | event_id | effective_date: 1994-01-01..2026-10-02 |\n"
    "| data/not_built_yet.parquet | one row per id | id | n/a |\n"
)

DECLARED_PLAN = (
    "## Data Outputs\n\n"
    "| Path | Grain | Key Columns | Required Window |\n"
    "|---|---|---|---|\n"
    "| data/table.csv | one row per statistic x group | pk: statistic, group; sparse: numerator, denominator | n/a |\n"
    "| data/backfill.csv | one row per filing | pk: accession; freetext: url; constant: model | fdate: 2026-09-01..2026-10-02 |\n"
    "| data/events.parquet | one row per event; an event list searched over the window | pk: event_id | n/a |\n"
    "| data/not_built_yet.parquet | one row per id | id | n/a |\n"
)


def test_declarations_names_every_gap_a_declaration_would_cure(undeclared: Path):
    rc, payload = declarations(undeclared, UNDECLARED_PLAN)
    assert rc == 1, payload
    gaps = {(o["path"], g["check"], g.get("column")) for o in payload["outputs"] for g in o["gaps"]}
    assert ("data/table.csv", "DQ2", "numerator") in gaps
    assert ("data/table.csv", "DQ2", "denominator") in gaps
    assert ("data/backfill.csv", "DQ5", "url") in gaps
    assert ("data/backfill.csv", "DQ1", "model") in gaps
    assert ("data/events.parquet", "COV", "effective_date") in gaps
    by_path = {o["path"]: o for o in payload["outputs"]}
    # The suggested cell is the plan text to paste, and with it the artifact passes outright.
    assert by_path["data/table.csv"]["key_columns"] == "pk: statistic, group; sparse: numerator, denominator"
    assert by_path["data/table.csv"]["passes_once_declared"] is True
    assert by_path["data/events.parquet"]["required_window"] == "n/a"
    assert by_path["data/events.parquet"]["passes_once_declared"] is True
    # Not on disk yet: nothing to read, so nothing claimed either way.
    assert by_path["data/not_built_yet.parquet"]["exists"] is False
    assert by_path["data/not_built_yet.parquet"]["gaps"] == []


def test_declarations_is_clean_when_the_plan_declares_them(undeclared: Path):
    rc, payload = declarations(undeclared, DECLARED_PLAN)
    assert rc == 0, payload
    assert all(not o["gaps"] for o in payload["outputs"]), payload


def test_declarations_never_offers_a_declaration_for_a_real_defect(tmp_path: Path):
    # A duplicated PK and an all-null column are data defects: no annotation exempts them, so they
    # are the round's to fix and must not surface as a missing declaration.
    (tmp_path / "d").mkdir()
    pl.DataFrame({"id": [1, 1, 2], "empty": [None, None, None], "x": [1.0, 2.0, 3.0]}).write_parquet(
        tmp_path / "d" / "bad.parquet")
    plan = (
        "## Data Outputs\n\n| Path | Grain | Key Columns | Required Window |\n|---|---|---|---|\n"
        "| d/bad.parquet | one row per id | id | n/a |\n"
    )
    rc, payload = declarations(tmp_path, plan)
    assert rc == 0, payload
    assert payload["outputs"][0]["gaps"] == []


def test_declarations_reports_an_unparseable_table_as_json(tmp_path: Path):
    rc, payload = declarations(tmp_path, "## Data Outputs\n\nno table here at all\n")
    assert rc == 2, payload
    assert payload["_error"]["status"] == "FAIL"
