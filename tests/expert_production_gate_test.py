from __future__ import annotations

import importlib.util
from pathlib import Path
import re
import shutil
import sys
from types import ModuleType
import zipfile

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
ROUND1_TEST_PATH = REPO_ROOT / "tests" / "expert_production_test.py"
SPEC_DOC_PATH = REPO_ROOT / "skills" / "expert-production" / "references" / "production-spec.md"

FORMULA_ROW_XML = (
    '    <row r="4">\n'
    '      <c r="B4"><f>SUM(B2:B3)</f><v>63.0</v></c>\n'
    "    </row>\n"
)


def _rewrite_sheet1_xml(xlsx_path: Path, transform) -> None:
    with zipfile.ZipFile(xlsx_path, "r") as zin:
        entries = [(info.filename, zin.read(info.filename)) for info in zin.infolist()]
    updated: list[tuple[str, bytes]] = []
    replaced = False
    for name, data in entries:
        if name == "xl/worksheets/sheet1.xml":
            text = data.decode("utf-8")
            new_text = transform(text)
            assert new_text != text, "sheet1.xml transform made no change"
            updated.append((name, new_text.encode("utf-8")))
            replaced = True
        else:
            updated.append((name, data))
    assert replaced, f"xl/worksheets/sheet1.xml not found in {xlsx_path}"
    with zipfile.ZipFile(xlsx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in updated:
            zout.writestr(name, data)


def _add_formula_row(sheet1_xml: str) -> str:
    marker = "  </sheetData>"
    assert marker in sheet1_xml, "unexpected sheet1.xml without </sheetData>"
    return sheet1_xml.replace(marker, FORMULA_ROW_XML + marker, 1)


def _plant_ref_error(sheet1_xml: str) -> str:
    target = '<c r="B2"><v>21.0</v></c>'
    assert target in sheet1_xml, f"expected cell {target!r} in sheet1.xml"
    return sheet1_xml.replace(target, '<c r="B2" t="e"><v>#REF!</v></c>', 1)


def _strip_formulas(xml: str) -> str:
    return re.sub(r"<f>.*?</f>", "", xml, flags=re.S)


@pytest.fixture(scope="module")
def round1_mod() -> ModuleType:
    mod_name = "_round1_expert_production_test"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    spec = importlib.util.spec_from_file_location(mod_name, ROUND1_TEST_PATH)
    assert spec is not None and spec.loader is not None, f"cannot load {ROUND1_TEST_PATH}"
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def _gate2_good_template(round1_mod: ModuleType, tmp_path_factory: pytest.TempPathFactory):
    base_dir = tmp_path_factory.mktemp("gate2_good_production_template")
    template = round1_mod._build_good_fixture(base_dir)
    workbook_path = template.stage_dir / "tables" / "workpaper_summary.xlsx"
    with zipfile.ZipFile(workbook_path, "r") as zf:
        has_formula = any(
            "<f>" in zf.read(name).decode("utf-8", errors="ignore")
            for name in zf.namelist()
            if name.startswith("xl/worksheets/") and name.endswith(".xml")
        )
    if not has_formula:
        _rewrite_sheet1_xml(workbook_path, _add_formula_row)
        round1_mod._write_manifest(template.stage_dir)
    return template


@pytest.fixture
def make_gate2_fixture(round1_mod: ModuleType, _gate2_good_template, tmp_path: Path):
    def _factory():
        dest = tmp_path / "case"
        shutil.copytree(_gate2_good_template.root, dest, copy_function=shutil.copy2)
        fx = round1_mod.ProductionFixture(
            root=dest,
            src_dir=dest / "src",
            stage_dir=dest / "stage" / round1_mod.STAGE_NAME,
            archive_path=dest / "dist" / f"{round1_mod.STAGE_NAME}.7z",
            runbook_md=dest / "internal" / "RUNBOOK.md",
            ref_output=dest / "internal" / "reference_summary.csv",
            spec_path=dest / "internal" / "production-spec.json",
        )
        round1_mod._write_spec(fx)
        return fx

    return _factory


def test_gate2_unreached_py_fails_code_leg(round1_mod: ModuleType, make_gate2_fixture) -> None:
    fx = make_gate2_fixture()
    orphan = fx.stage_dir / "code" / "orphan_step.py"
    orphan.write_text("def compute_offset(val: int) -> int:\n    return val + 1\n", encoding="utf-8")
    round1_mod._write_manifest(fx.stage_dir)

    proc, legs = round1_mod._run_package_check(fx.spec_path)
    assert proc.returncode == 1, f"expected exit 1, got {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    round1_mod._assert_all_four_legs_printed(legs, proc)
    assert legs["code"] == 1


def test_gate2_runbook_named_py_exits_zero(round1_mod: ModuleType, make_gate2_fixture) -> None:
    fx = make_gate2_fixture()
    orphan = fx.stage_dir / "code" / "orphan_step.py"
    orphan.write_text("def compute_offset(val: int) -> int:\n    return val + 1\n", encoding="utf-8")

    extra_cmd = "python3 code/orphan_step.py"
    fx.runbook_md.write_text(
        "# Production Runbook\n\n"
        "Run the summary script from the archive root:\n\n"
        "```command\n"
        f"{round1_mod.DEFAULT_RUNBOOK_CMD}\n"
        "```\n\n"
        "Run the secondary step:\n\n"
        "```command\n"
        f"{extra_cmd}\n"
        "```\n",
        encoding="utf-8",
    )
    round1_mod._compile_and_scrub_runbook_pdf(
        [round1_mod.DEFAULT_RUNBOOK_CMD, extra_cmd],
        fx.stage_dir / "RUNBOOK.pdf",
        fx.root / "internal" / "typst_scratch",
    )
    round1_mod._write_manifest(fx.stage_dir)

    proc, legs = round1_mod._run_package_check(fx.spec_path)
    assert proc.returncode == 0, f"expected exit 0, got {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    round1_mod._assert_all_four_legs_printed(legs, proc)
    assert all(code == 0 for code in legs.values()), f"expected all legs exit=0, got {legs}"


def test_gate2_workbook_error_cell_fails_leak_leg(round1_mod: ModuleType, make_gate2_fixture) -> None:
    fx = make_gate2_fixture()
    workbook_path = fx.stage_dir / "tables" / "workpaper_summary.xlsx"
    _rewrite_sheet1_xml(workbook_path, _plant_ref_error)
    round1_mod._write_manifest(fx.stage_dir)

    proc, legs = round1_mod._run_package_check(fx.spec_path)
    assert proc.returncode == 1, f"expected exit 1, got {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    round1_mod._assert_all_four_legs_printed(legs, proc)
    assert legs["leak"] == 1


def test_gate2_workbook_without_formulas_fails_leak_leg(round1_mod: ModuleType, make_gate2_fixture) -> None:
    fx = make_gate2_fixture()
    workbook_path = fx.stage_dir / "tables" / "workpaper_summary.xlsx"
    round1_mod._build_ooxml_workbook(workbook_path)
    _rewrite_sheet1_xml(workbook_path, _strip_formulas)
    with zipfile.ZipFile(workbook_path, "r") as zf:
        assert not any(
            "<f>" in zf.read(name).decode("utf-8", errors="ignore")
            for name in zf.namelist()
            if name.startswith("xl/worksheets/") and name.endswith(".xml")
        ), "workbook still contains a formula element"
    round1_mod._write_manifest(fx.stage_dir)

    proc, legs = round1_mod._run_package_check(fx.spec_path)
    assert proc.returncode == 1, f"expected exit 1, got {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    round1_mod._assert_all_four_legs_printed(legs, proc)
    assert legs["leak"] == 1


def test_gate2_workbook_without_formulas_allowed_by_spec(round1_mod: ModuleType, make_gate2_fixture) -> None:
    fx = make_gate2_fixture()
    workbook_path = fx.stage_dir / "tables" / "workpaper_summary.xlsx"
    round1_mod._build_ooxml_workbook(workbook_path)
    _rewrite_sheet1_xml(workbook_path, _strip_formulas)
    with zipfile.ZipFile(workbook_path, "r") as zf:
        assert not any(
            "<f>" in zf.read(name).decode("utf-8", errors="ignore")
            for name in zf.namelist()
            if name.startswith("xl/worksheets/") and name.endswith(".xml")
        ), "workbook still contains a formula element"
    round1_mod._write_manifest(fx.stage_dir)
    round1_mod._write_spec(fx, overrides={"workbook_formulas": False})

    proc, legs = round1_mod._run_package_check(fx.spec_path)
    assert proc.returncode == 0, f"expected exit 0, got {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    round1_mod._assert_all_four_legs_printed(legs, proc)
    assert all(code == 0 for code in legs.values()), f"expected all legs exit=0, got {legs}"


def test_gate2_duplicate_table_formats_fails_archive_leg(round1_mod: ModuleType, make_gate2_fixture) -> None:
    fx = make_gate2_fixture()
    (fx.stage_dir / "data" / "x.csv").write_text("entity_id,val\nE001,1\n", encoding="utf-8")
    (fx.stage_dir / "data" / "x.parquet").write_bytes(b"PAR1synthetic-table-bytesPAR1")
    round1_mod._write_spec(
        fx,
        overrides={"extra_files": ["data/processed_input.csv", "data/x.csv", "data/x.parquet"]},
    )
    round1_mod._write_manifest(fx.stage_dir)

    proc, legs = round1_mod._run_package_check(fx.spec_path)
    assert proc.returncode == 1, f"expected exit 1, got {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    round1_mod._assert_all_four_legs_printed(legs, proc)
    assert legs["archive"] == 1


def test_gate2_production_spec_doc_anchored_leak_term_and_workbook_formulas() -> None:
    assert SPEC_DOC_PATH.is_file(), f"missing {SPEC_DOC_PATH}"
    text = SPEC_DOC_PATH.read_text(encoding="utf-8")
    assert r"\bb\d{2,3}\b" in text, "production-spec.md missing anchored leak term \\bb\\d{2,3}\\b"
    assert "workbook_formulas" in text, "production-spec.md missing workbook_formulas"
    assert '"b\\\\d{2,3}"' not in text, 'production-spec.md still contains unanchored JSON example "b\\\\d{2,3}"'


def test_gate2_good_fixture_with_formula_exits_zero(round1_mod: ModuleType, make_gate2_fixture) -> None:
    fx = make_gate2_fixture()
    proc, legs = round1_mod._run_package_check(fx.spec_path)
    assert proc.returncode == 0, f"expected exit 0, got {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    round1_mod._assert_all_four_legs_printed(legs, proc)
    assert all(code == 0 for code in legs.values()), f"expected all legs exit=0, got {legs}"
