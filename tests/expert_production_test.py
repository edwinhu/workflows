from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from xml.sax.saxutils import escape as xml_escape
import zipfile

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
OLD_SKILL_NAME = "replication" + "-package"
SKILL_DIR = REPO_ROOT / "skills" / "expert-production"
PACKAGE_CHECK = SKILL_DIR / "scripts" / "package-check.sh"
BUILD_RUNBOOK = SKILL_DIR / "scripts" / "build-runbook.sh"
SCRUB_METADATA = SKILL_DIR / "scripts" / "scrub_metadata.py"

EXPECTED_LEGS = ("archive", "code", "leak", "rerun")
SPEC_KEYS = (
    "name",
    "stage",
    "archive",
    "entry_scripts",
    "python_paths",
    "third_party",
    "sources",
    "extra_files",
    "workbook",
    "runbook_pdf",
    "runbook_source",
    "runbook_cwd",
    "leak_terms",
    "usernames",
    "reruns",
)

STAGE_NAME = "acme-production-2030-01-01"
DEFAULT_RUNBOOK_CMD = (
    "python3 code/build_summary.py"
    " --input data/processed_input.csv"
    " --output out/summary.csv"
)


@dataclass
class ProductionFixture:
    root: Path
    src_dir: Path
    stage_dir: Path
    archive_path: Path
    runbook_md: Path
    ref_output: Path
    spec_path: Path


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_frontmatter(text: str) -> tuple[str, str]:
    match = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", text, re.DOTALL)
    assert match is not None, "SKILL.md missing YAML frontmatter"
    return match.group(1), match.group(2)


def _extract_description(frontmatter: str) -> str:
    lines = frontmatter.splitlines()
    for idx, line in enumerate(lines):
        if line.startswith("description:"):
            rest = line[len("description:") :].strip()
            if rest in ("|", ">", "|-", ">-"):
                collected: list[str] = []
                for sub in lines[idx + 1 :]:
                    if sub.startswith((" ", "\t")) or sub == "":
                        collected.append(sub.strip())
                    else:
                        break
                return " ".join(collected)
            return rest.strip("\"'")
    raise AssertionError("description field missing from SKILL.md frontmatter")


def _build_ooxml_workbook(
    dest: Path,
    cell_strings: list[str] | None = None,
    extra_core_xml: str = "",
) -> None:
    if cell_strings is None:
        cell_strings = ["Entity", "Metric", "E001", "E002"]
    dest.parent.mkdir(parents=True, exist_ok=True)

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        '  <Default Extension="xml" ContentType="application/xml"/>\n'
        '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n'
        '  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n'
        '  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>\n'
        '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n'
        '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n'
        "</Types>\n"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n'
        '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n'
        '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>\n'
        "</Relationships>\n"
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"\n'
        '          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n'
        "  <sheets>\n"
        '    <sheet name="Summary" sheetId="1" r:id="rId1"/>\n'
        "  </sheets>\n"
        "</workbook>\n"
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n'
        '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>\n'
        "</Relationships>\n"
    )
    si_items = "".join(f"  <si><t>{xml_escape(s)}</t></si>\n" for s in cell_strings)
    shared_strings = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(cell_strings)}" uniqueCount="{len(cell_strings)}">\n'
        f"{si_items}"
        "</sst>\n"
    )
    sheet1 = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n'
        "  <sheetData>\n"
        '    <row r="1">\n'
        '      <c r="A1" t="s"><v>0</v></c>\n'
        '      <c r="B1" t="s"><v>1</v></c>\n'
        "    </row>\n"
        '    <row r="2">\n'
        '      <c r="A2" t="s"><v>2</v></c>\n'
        '      <c r="B2"><v>21.0</v></c>\n'
        "    </row>\n"
        '    <row r="3">\n'
        '      <c r="A3" t="s"><v>3</v></c>\n'
        '      <c r="B3"><v>42.0</v></c>\n'
        "    </row>\n"
        '    <row r="4">\n'
        '      <c r="B4"><f>SUM(B2:B3)</f><v>63.0</v></c>\n'
        "    </row>\n"
        "  </sheetData>\n"
        "</worksheet>\n"
    )
    extra_line = f"  {extra_core_xml}\n" if extra_core_xml else ""
    core_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"\n'
        '                   xmlns:dc="http://purl.org/dc/elements/1.1/"\n'
        '                   xmlns:dcterms="http://purl.org/dc/terms/"\n'
        '                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
        f"{extra_line}"
        '  <dcterms:created xsi:type="dcterms:W3CDTF">2030-01-02T12:00:00Z</dcterms:created>\n'
        '  <dcterms:modified xsi:type="dcterms:W3CDTF">2030-01-02T12:00:00Z</dcterms:modified>\n'
        "</cp:coreProperties>\n"
    )
    app_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">\n'
        "  <Application></Application>\n"
        "  <AppVersion></AppVersion>\n"
        "  <Company></Company>\n"
        "  <Manager></Manager>\n"
        "  <Template></Template>\n"
        "  <LastModifiedBy></LastModifiedBy>\n"
        "  <HyperlinkBase></HyperlinkBase>\n"
        "</Properties>\n"
    )

    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/worksheets/sheet1.xml", sheet1)
        zf.writestr("xl/sharedStrings.xml", shared_strings)
        zf.writestr("docProps/core.xml", core_xml)
        zf.writestr("docProps/app.xml", app_xml)


def _compile_and_scrub_runbook_pdf(commands: list[str], out_pdf: Path, scratch_dir: Path) -> None:
    assert SCRUB_METADATA.is_file(), f"missing metadata scrubber: {SCRUB_METADATA}"
    scratch_dir.mkdir(parents=True, exist_ok=True)
    typ_file = scratch_dir / "runbook_fixture.typ"
    blocks = []
    for cmd in commands:
        escaped = cmd.replace("\\", "\\\\").replace('"', '\\"')
        blocks.append(f'#raw("{escaped}")')
    typ_content = (
        "#set page(width: 11in, height: 8.5in, margin: 0.75in)\n"
        "#set text(size: 10pt)\n"
        "= Production Runbook\n\n"
        + "\n\n".join(blocks)
        + "\n"
    )
    typ_file.write_text(typ_content, encoding="utf-8")
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    res = subprocess.run(
        [
            "typst",
            "compile",
            "--creation-timestamp",
            "1893542400",
            str(typ_file),
            str(out_pdf),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert res.returncode == 0, f"typst compile failed: {res.stderr}"
    scrub = subprocess.run(
        ["uv", "run", str(SCRUB_METADATA), str(out_pdf)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert scrub.returncode == 0, f"scrub_metadata.py failed: {scrub.stderr}"


def _write_manifest(stage_dir: Path) -> Path:
    manifest_path = stage_dir / "MANIFEST.csv"
    rows: list[tuple[str, int, str, str]] = []
    for path in sorted(p for p in stage_dir.rglob("*") if p.is_file()):
        rel = path.relative_to(stage_dir).as_posix()
        if rel == "MANIFEST.csv":
            continue
        st = path.stat()
        whole_sec = int(st.st_mtime)
        os.utime(path, (whole_sec, whole_sec))
        mod_utc = datetime.fromtimestamp(whole_sec, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        rows.append((rel, st.st_size, _sha256_file(path), mod_utc))
    with manifest_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(["path", "bytes", "sha256", "modified_utc"])
        for row in rows:
            writer.writerow(row)
    return manifest_path


def _write_spec(fx: ProductionFixture, overrides: dict | None = None) -> dict:
    spec: dict = {
        "name": STAGE_NAME,
        "stage": str(fx.stage_dir),
        "archive": str(fx.archive_path),
        "entry_scripts": ["code/build_summary.py"],
        "python_paths": ["code"],
        "third_party": [],
        "sources": {
            "code/build_summary.py": str(fx.src_dir / "code" / "build_summary.py"),
            "code/helpers.py": str(fx.src_dir / "code" / "helpers.py"),
        },
        "extra_files": ["data/processed_input.csv"],
        "workbook": "tables/workpaper_summary.xlsx",
        "runbook_pdf": "RUNBOOK.pdf",
        "runbook_source": str(fx.runbook_md),
        "runbook_cwd": ".",
        "leak_terms": [r"b\d{2,3}", r"decisions\.csv", "¶", r"n\.\d+"],
        "usernames": ["synthuser"],
        "reruns": [
            {
                "name": "summary",
                "cwd": ".",
                "cmd": DEFAULT_RUNBOOK_CMD,
                "output": "out/summary.csv",
                "reference": str(fx.ref_output),
                "compare": "bytes",
            }
        ],
    }
    if overrides:
        spec.update(overrides)
    fx.spec_path.parent.mkdir(parents=True, exist_ok=True)
    fx.spec_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    return spec


def _build_good_fixture(root: Path) -> ProductionFixture:
    src_dir = root / "src"
    stage_dir = root / "stage" / STAGE_NAME
    archive_path = root / "dist" / f"{STAGE_NAME}.7z"
    internal_dir = root / "internal"
    runbook_md = internal_dir / "RUNBOOK.md"
    ref_output = internal_dir / "reference_summary.csv"
    spec_path = internal_dir / "production-spec.json"

    (src_dir / "code").mkdir(parents=True, exist_ok=True)
    (stage_dir / "code").mkdir(parents=True, exist_ok=True)
    (stage_dir / "data").mkdir(parents=True, exist_ok=True)
    (stage_dir / "tables").mkdir(parents=True, exist_ok=True)
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    internal_dir.mkdir(parents=True, exist_ok=True)

    helpers_src = (
        '"""Synthetic metric helper module."""\n\n\n'
        "def compute_metric(val: float) -> float:\n"
        "    # Double the synthetic input value.\n"
        "    return round(val * 2.0, 2)\n"
    )
    helpers_stripped = (
        "def compute_metric(val: float) -> float:\n"
        "    return round(val * 2.0, 2)\n"
    )
    entry_src = (
        '"""Synthetic pipeline entry script."""\n'
        "import argparse\n"
        "import csv\n"
        "from pathlib import Path\n\n"
        "from helpers import compute_metric\n\n\n"
        "def main() -> None:\n"
        "    # Parse CLI paths and emit summary CSV.\n"
        "    parser = argparse.ArgumentParser()\n"
        '    parser.add_argument("--input", required=True)\n'
        '    parser.add_argument("--output", required=True)\n'
        "    args = parser.parse_args()\n"
        "    out_path = Path(args.output)\n"
        "    out_path.parent.mkdir(parents=True, exist_ok=True)\n"
        '    with Path(args.input).open("r", encoding="utf-8", newline="") as fin:\n'
        "        rows = list(csv.DictReader(fin))\n"
        '    with out_path.open("w", encoding="utf-8", newline="") as fout:\n'
        '        writer = csv.writer(fout, lineterminator="\\n")\n'
        '        writer.writerow(["entity_id", "metric", "run_tag"])\n'
        "        for row in rows:\n"
        '            val = compute_metric(float(row["raw_val"]))\n'
        '            writer.writerow([row["entity_id"], f"{val:.2f}", "v1"])\n\n\n'
        'if __name__ == "__main__":\n'
        "    main()\n"
    )
    entry_stripped = (
        "import argparse\n"
        "import csv\n"
        "from pathlib import Path\n\n"
        "from helpers import compute_metric\n\n\n"
        "def main() -> None:\n"
        "    parser = argparse.ArgumentParser()\n"
        '    parser.add_argument("--input", required=True)\n'
        '    parser.add_argument("--output", required=True)\n'
        "    args = parser.parse_args()\n"
        "    out_path = Path(args.output)\n"
        "    out_path.parent.mkdir(parents=True, exist_ok=True)\n"
        '    with Path(args.input).open("r", encoding="utf-8", newline="") as fin:\n'
        "        rows = list(csv.DictReader(fin))\n"
        '    with out_path.open("w", encoding="utf-8", newline="") as fout:\n'
        '        writer = csv.writer(fout, lineterminator="\\n")\n'
        '        writer.writerow(["entity_id", "metric", "run_tag"])\n'
        "        for row in rows:\n"
        '            val = compute_metric(float(row["raw_val"]))\n'
        '            writer.writerow([row["entity_id"], f"{val:.2f}", "v1"])\n\n\n'
        'if __name__ == "__main__":\n'
        "    main()\n"
    )

    (src_dir / "code" / "helpers.py").write_text(helpers_src, encoding="utf-8")
    (src_dir / "code" / "build_summary.py").write_text(entry_src, encoding="utf-8")
    (stage_dir / "code" / "helpers.py").write_text(helpers_stripped, encoding="utf-8")
    (stage_dir / "code" / "build_summary.py").write_text(entry_stripped, encoding="utf-8")
    (stage_dir / "code" / "run_all.sh").write_text(
        f"#!/usr/bin/env bash\nset -euo pipefail\n{DEFAULT_RUNBOOK_CMD}\n",
        encoding="utf-8",
    )
    (stage_dir / "data" / "processed_input.csv").write_text(
        "entity_id,raw_val\nE001,10.5\nE002,21.0\n",
        encoding="utf-8",
    )
    _build_ooxml_workbook(stage_dir / "tables" / "workpaper_summary.xlsx")
    _compile_and_scrub_runbook_pdf(
        [DEFAULT_RUNBOOK_CMD],
        stage_dir / "RUNBOOK.pdf",
        internal_dir / "typst_scratch",
    )
    (stage_dir / "README.md").write_text(
        "# Acme Production Package\n\n"
        "This archive holds the pipeline code, processed inputs, and summary workbook.\n",
        encoding="utf-8",
    )
    _write_manifest(stage_dir)

    runbook_md.write_text(
        "# Production Runbook\n\n"
        "Run the summary script from the archive root:\n\n"
        "```command\n"
        f"{DEFAULT_RUNBOOK_CMD}\n"
        "```\n",
        encoding="utf-8",
    )
    ref_output.write_text(
        "entity_id,metric,run_tag\nE001,21.00,v1\nE002,42.00,v1\n",
        encoding="utf-8",
    )

    fx = ProductionFixture(
        root=root,
        src_dir=src_dir,
        stage_dir=stage_dir,
        archive_path=archive_path,
        runbook_md=runbook_md,
        ref_output=ref_output,
        spec_path=spec_path,
    )
    _write_spec(fx)
    return fx


@pytest.fixture(scope="module")
def _good_fixture_cache(tmp_path_factory: pytest.TempPathFactory) -> dict[str, ProductionFixture]:
    cache: dict[str, ProductionFixture] = {}
    cache["_base_dir"] = tmp_path_factory.mktemp("good_production_template")  # type: ignore[assignment]
    return cache


@pytest.fixture
def make_good_fixture(
    _good_fixture_cache: dict[str, object],
    tmp_path: Path,
):
    def _factory() -> ProductionFixture:
        assert PACKAGE_CHECK.is_file(), f"missing {PACKAGE_CHECK}"
        template = _good_fixture_cache.get("template")
        if not isinstance(template, ProductionFixture):
            base_dir = _good_fixture_cache["_base_dir"]
            assert isinstance(base_dir, Path)
            template = _build_good_fixture(base_dir)
            _good_fixture_cache["template"] = template
        dest = tmp_path / "case"
        shutil.copytree(template.root, dest, copy_function=shutil.copy2)
        fx = ProductionFixture(
            root=dest,
            src_dir=dest / "src",
            stage_dir=dest / "stage" / STAGE_NAME,
            archive_path=dest / "dist" / f"{STAGE_NAME}.7z",
            runbook_md=dest / "internal" / "RUNBOOK.md",
            ref_output=dest / "internal" / "reference_summary.csv",
            spec_path=dest / "internal" / "production-spec.json",
        )
        _write_spec(fx)
        return fx

    return _factory


def _run_package_check(
    spec_path: Path | None,
    spec_sha256: str | None = None,
    extra_args: list[str] | None = None,
) -> tuple[subprocess.CompletedProcess[str], dict[str, int]]:
    assert PACKAGE_CHECK.is_file(), f"missing {PACKAGE_CHECK}"
    cmd = ["bash", str(PACKAGE_CHECK)]
    if spec_path is not None:
        cmd += ["--spec", str(spec_path)]
        sha = spec_sha256 if spec_sha256 is not None else _sha256_file(spec_path)
        cmd += ["--spec-sha256", sha]
    if extra_args:
        cmd += extra_args
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    legs: dict[str, int] = {}
    for line in proc.stdout.splitlines():
        m = re.match(r"^leg\s+(\S+)\s+exit=(\d+)\b", line.strip())
        if m:
            legs[m.group(1)] = int(m.group(2))
    return proc, legs


def _assert_all_four_legs_printed(legs: dict[str, int], proc: subprocess.CompletedProcess[str]) -> None:
    assert tuple(legs.keys()) == EXPECTED_LEGS, (
        f"expected legs {EXPECTED_LEGS}, got {tuple(legs.keys())}\n"
        f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )


def _extract_mechanical_checks_entries(block: str) -> list[str]:
    """Extract top-level `{...}` object texts from a `mechanicalChecks: [ ... ]` JS/JSON field."""
    m = re.search(r"""["']?mechanicalChecks["']?\s*:\s*\[""", block)
    assert m is not None, "mechanicalChecks array not found in fenced block"
    i = m.end()
    n = len(block)
    entries: list[str] = []
    bracket_depth = 1
    brace_depth = 0
    obj_start: int | None = None
    in_quote: str | None = None
    template_expr_depths: list[int] = []

    while i < n and bracket_depth > 0:
        ch = block[i]
        nxt = block[i + 1] if i + 1 < n else ""

        if in_quote is not None:
            if ch == "\\":
                i += 2
                continue
            if in_quote == "`" and ch == "$" and nxt == "{":
                template_expr_depths.append(brace_depth)
                brace_depth += 1
                in_quote = None
                i += 2
                continue
            if ch == in_quote:
                in_quote = None
            i += 1
            continue

        if ch == "/" and nxt == "/":
            nl = block.find("\n", i)
            i = n if nl == -1 else nl + 1
            continue
        if ch == "/" and nxt == "*":
            end = block.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch in ("'", '"', "`"):
            in_quote = ch
            i += 1
            continue

        if ch == "[":
            bracket_depth += 1
        elif ch == "]":
            bracket_depth -= 1
            if bracket_depth == 0:
                break
        elif ch == "{":
            if bracket_depth == 1 and brace_depth == 0:
                obj_start = i
            brace_depth += 1
        elif ch == "}":
            brace_depth -= 1
            if template_expr_depths and brace_depth == template_expr_depths[-1]:
                template_expr_depths.pop()
                in_quote = "`"
            elif bracket_depth == 1 and brace_depth == 0 and obj_start is not None:
                entries.append(block[obj_start : i + 1])
                obj_start = None
        i += 1

    return entries


# ---------------------------------------------------------------------------
# test_rename_*
# ---------------------------------------------------------------------------


def test_rename_skill_md_frontmatter() -> None:
    skill_md = SKILL_DIR / "SKILL.md"
    assert skill_md.is_file(), f"missing {skill_md}"
    fm, _ = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
    assert re.search(r"^name:\s*expert-production\s*$", fm, re.M), (
        f"frontmatter missing 'name: expert-production':\n{fm}"
    )
    desc = _extract_description(fm).lower()
    for phrase in (
        "court production",
        "data production",
        "production package",
        "7z the production",
    ):
        assert phrase in desc, f"description missing trigger phrase {phrase!r}: {desc!r}"


def test_rename_old_dir_removed() -> None:
    old_dir = REPO_ROOT / "skills" / OLD_SKILL_NAME
    assert not old_dir.exists(), f"old skill directory still exists: {old_dir}"


def test_rename_no_tracked_references() -> None:
    proc = subprocess.run(
        ["git", "grep", "-n", OLD_SKILL_NAME, "--", ".", ":!.planning/"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 1 and proc.stdout.strip() == "", (
        f"old skill name still found in tracked files outside .planning/:\n{proc.stdout}"
    )


def test_rename_ds_checks_replay_ref() -> None:
    ds_checks = REPO_ROOT / "skills" / "ds" / "references" / "ds-checks.md"
    replay_md = SKILL_DIR / "references" / "replay.md"
    assert ds_checks.is_file(), f"missing {ds_checks}"
    assert "skills/expert-production/references/replay.md" in ds_checks.read_text(encoding="utf-8")
    assert replay_md.is_file(), f"missing {replay_md}"


# ---------------------------------------------------------------------------
# test_package_check_*
# ---------------------------------------------------------------------------


def test_package_check_good_exits_zero(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 0, f"expected exit 0, got {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert all(code == 0 for code in legs.values()), f"expected all legs exit=0, got {legs}"


def test_package_check_stage_unchanged_after_pass(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    before = sorted(p.relative_to(good_fixture.stage_dir).as_posix() for p in good_fixture.stage_dir.rglob("*"))
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    after = sorted(p.relative_to(good_fixture.stage_dir).as_posix() for p in good_fixture.stage_dir.rglob("*"))
    assert after == before


def test_package_check_missing_spec_exits_two() -> None:
    proc, _ = _run_package_check(None, extra_args=["--no-spec-sha256"])
    assert proc.returncode == 2, f"expected exit 2 on missing --spec, got {proc.returncode}\nstderr:\n{proc.stderr}"


def test_package_check_wrong_spec_sha256_exits_two(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    proc, _ = _run_package_check(good_fixture.spec_path, spec_sha256="0" * 64)
    assert proc.returncode == 2, f"expected exit 2 on wrong --spec-sha256, got {proc.returncode}\nstderr:\n{proc.stderr}"


def test_package_check_pycache_in_stage(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    pyc = good_fixture.stage_dir / "code" / "__pycache__" / "x.pyc"
    pyc.parent.mkdir(parents=True, exist_ok=True)
    pyc.write_bytes(b"\x00\x01\x02\x03")
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["archive"] == 1


def test_package_check_file_edited_after_manifest(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    readme = good_fixture.stage_dir / "README.md"
    readme.write_text(readme.read_text(encoding="utf-8") + "\nExtra post-manifest line.\n", encoding="utf-8")
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["archive"] == 1


def test_package_check_unlisted_file(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    (good_fixture.stage_dir / "unlisted_notes.txt").write_text("Unlisted content.\n", encoding="utf-8")
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["archive"] == 1


def test_package_check_comment_left_in_code(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    helpers = good_fixture.stage_dir / "code" / "helpers.py"
    helpers.write_text("# leftover comment\n" + helpers.read_text(encoding="utf-8"), encoding="utf-8")
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["code"] == 1


def test_package_check_docstring_left_in_code(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    helpers = good_fixture.stage_dir / "code" / "helpers.py"
    helpers.write_text('"""Leftover docstring."""\n' + helpers.read_text(encoding="utf-8"), encoding="utf-8")
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["code"] == 1


def test_package_check_dunder_doc_without_assignment(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    helpers = good_fixture.stage_dir / "code" / "helpers.py"
    helpers.write_text(
        helpers.read_text(encoding="utf-8") + "\nDOC_TEXT = __doc__\n",
        encoding="utf-8",
    )
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["code"] == 1


def test_package_check_missing_local_import(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    entry = good_fixture.stage_dir / "code" / "build_summary.py"
    entry.write_text(
        "import missing_local_mod\n"
        + entry.read_text(encoding="utf-8")
        + "\n_ = missing_local_mod\n",
        encoding="utf-8",
    )
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["code"] == 1


def test_package_check_py_syntax_error(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    (good_fixture.stage_dir / "code" / "broken.py").write_text("def broken(:\n    pass\n", encoding="utf-8")
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["code"] == 1


def test_package_check_sh_syntax_error(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    (good_fixture.stage_dir / "code" / "run_all.sh").write_text(
        "#!/usr/bin/env bash\nif true; then\n  echo missing_fi\n",
        encoding="utf-8",
    )
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["code"] == 1


def test_package_check_new_ruff_f401(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    helpers = good_fixture.stage_dir / "code" / "helpers.py"
    helpers.write_text("import os\n" + helpers.read_text(encoding="utf-8"), encoding="utf-8")
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["code"] == 1


def test_package_check_home_path_in_readme(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    readme = good_fixture.stage_dir / "README.md"
    readme.write_text(
        readme.read_text(encoding="utf-8") + "\nBuilt from /home/someone/workspace.\n",
        encoding="utf-8",
    )
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["leak"] == 1


def test_package_check_leak_term_in_code(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    helpers = good_fixture.stage_dir / "code" / "helpers.py"
    helpers.write_text(
        helpers.read_text(encoding="utf-8") + '\nBATCH_TAG = "b12"\n',
        encoding="utf-8",
    )
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["leak"] == 1


def test_package_check_decisions_csv_in_workbook(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    _build_ooxml_workbook(
        good_fixture.stage_dir / "tables" / "workpaper_summary.xlsx",
        cell_strings=["Entity", "Metric", "decisions.csv", "E002"],
    )
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["leak"] == 1


def test_package_check_dc_creator_in_core_xml(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    _build_ooxml_workbook(
        good_fixture.stage_dir / "tables" / "workpaper_summary.xlsx",
        extra_core_xml="<dc:creator>Pat Smith</dc:creator>",
    )
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["leak"] == 1


def test_package_check_rerun_output_differs(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    good_fixture.ref_output.write_text(
        "entity_id,metric,run_tag\nE001,99.00,v1\nE002,42.00,v1\n",
        encoding="utf-8",
    )
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["rerun"] == 1


def test_package_check_empty_reruns_fails(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    _write_spec(good_fixture, overrides={"reruns": []})
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["rerun"] == 1


def test_package_check_runbook_command_absent_from_pdf(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    good_fixture.runbook_md.write_text(
        good_fixture.runbook_md.read_text(encoding="utf-8")
        + "\n```command\nbash code/run_all.sh\n```\n",
        encoding="utf-8",
    )
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["rerun"] == 1


def test_package_check_runbook_names_missing_script(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    missing_cmd = "python3 code/nonexistent_step.py --input data/processed_input.csv"
    good_fixture.runbook_md.write_text(
        "# Production Runbook\n\n"
        "```command\n"
        f"{DEFAULT_RUNBOOK_CMD}\n"
        "```\n\n"
        "```command\n"
        f"{missing_cmd}\n"
        "```\n",
        encoding="utf-8",
    )
    _compile_and_scrub_runbook_pdf(
        [DEFAULT_RUNBOOK_CMD, missing_cmd],
        good_fixture.stage_dir / "RUNBOOK.pdf",
        good_fixture.root / "internal" / "typst_scratch",
    )
    _write_manifest(good_fixture.stage_dir)
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 1, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert legs["rerun"] == 1


def test_package_check_columns_drop_exits_zero(make_good_fixture) -> None:
    good_fixture = make_good_fixture()
    good_fixture.ref_output.write_text(
        "entity_id,metric,run_tag\nE001,21.00,v2\nE002,42.00,v2\n",
        encoding="utf-8",
    )
    _write_spec(
        good_fixture,
        overrides={
            "reruns": [
                {
                    "name": "summary",
                    "cwd": ".",
                    "cmd": DEFAULT_RUNBOOK_CMD,
                    "output": "out/summary.csv",
                    "reference": str(good_fixture.ref_output),
                    "compare": {"columns_drop": ["run_tag"]},
                }
            ]
        },
    )
    proc, legs = _run_package_check(good_fixture.spec_path)
    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    _assert_all_four_legs_printed(legs, proc)
    assert all(code == 0 for code in legs.values())


# ---------------------------------------------------------------------------
# test_runbook_*
# ---------------------------------------------------------------------------


def test_runbook_builds_clean_pdf_and_wraps_long_command(tmp_path: Path) -> None:
    assert BUILD_RUNBOOK.is_file(), f"missing {BUILD_RUNBOOK}"
    long_cmd = (
        "python3 code/build_summary.py"
        " --input data/processed_input.csv"
        " --output out/summary_report.csv"
        " --panel-start 2028-01-01"
        " --panel-end 2029-12-31"
        " --precision 4"
    )
    assert len(long_cmd) >= 150

    src_md = tmp_path / "RUNBOOK.md"
    out_pdf = tmp_path / "RUNBOOK.pdf"
    src_md.write_text(
        "# Acme Production Runbook\n\n"
        "Run the pipeline from the archive root:\n\n"
        "```command\n"
        f"{long_cmd}\n"
        "```\n",
        encoding="utf-8",
    )

    proc = subprocess.run(
        ["bash", str(BUILD_RUNBOOK), "--source", str(src_md), "--out", str(out_pdf), "--date", "2030-01-02"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"build-runbook.sh failed: {proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    assert out_pdf.is_file()

    info = subprocess.run(["pdfinfo", str(out_pdf)], capture_output=True, text=True, check=True)
    info_lines = info.stdout.splitlines()
    creation_lines = [ln for ln in info_lines if ln.startswith("CreationDate:")]
    assert creation_lines and "2030" in creation_lines[0], f"CreationDate not in 2030:\n{info.stdout}"
    for forbidden in ("Title:", "Author:", "Creator:", "Producer:"):
        assert not any(ln.startswith(forbidden) for ln in info_lines), (
            f"unexpected {forbidden} in pdfinfo:\n{info.stdout}"
        )

    meta = subprocess.run(["pdfinfo", "-meta", str(out_pdf)], capture_output=True, text=True, check=True)
    assert meta.stdout.strip() == "", f"expected empty XMP metadata, got:\n{meta.stdout}"

    txt = subprocess.run(["pdftotext", "-layout", str(out_pdf), "-"], capture_output=True, text=True, check=True)
    raw_lines = [ln.strip() for ln in txt.stdout.splitlines()]
    start_idx = next(
        (idx for idx, ln in enumerate(raw_lines) if "python3 code/build_summary.py" in ln),
        None,
    )
    assert start_idx is not None, f"command start not found in pdftotext output:\n{txt.stdout}"

    cmd_lines = [raw_lines[start_idx]]
    idx = start_idx
    while cmd_lines[-1].endswith("\\") and idx + 1 < len(raw_lines):
        idx += 1
        if raw_lines[idx]:
            cmd_lines.append(raw_lines[idx])

    assert len(cmd_lines) >= 2, f"expected wrapped multi-line command, got: {cmd_lines}"
    for ln in cmd_lines:
        assert len(ln) <= 90, f"command line exceeds 90 chars ({len(ln)}): {ln!r}"
    for ln in cmd_lines[:-1]:
        assert ln.endswith("\\"), f"non-final command line missing trailing backslash: {ln!r}"
    assert not cmd_lines[-1].endswith("\\"), f"final command line ends with backslash: {cmd_lines[-1]!r}"

    for token in long_cmd.split():
        if token.startswith("--"):
            assert any(token in ln for ln in cmd_lines), f"flag {token!r} was split across lines: {cmd_lines}"

    joined = " ".join(ln[:-1].rstrip() if ln.endswith("\\") else ln for ln in cmd_lines)
    joined = " ".join(joined.split())
    assert joined == long_cmd, f"joined command mismatch:\n  got:  {joined!r}\n  want: {long_cmd!r}"


def test_runbook_missing_source_exits_two(tmp_path: Path) -> None:
    assert BUILD_RUNBOOK.is_file(), f"missing {BUILD_RUNBOOK}"
    out_pdf = tmp_path / "RUNBOOK.pdf"
    proc = subprocess.run(
        ["bash", str(BUILD_RUNBOOK), "--out", str(out_pdf)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 2, f"expected exit 2 on missing --source, got {proc.returncode}\nstderr:\n{proc.stderr}"


# ---------------------------------------------------------------------------
# test_skill_*
# ---------------------------------------------------------------------------


def test_skill_frontmatter_rule_skills_none() -> None:
    skill_md = SKILL_DIR / "SKILL.md"
    assert skill_md.is_file(), f"missing {skill_md}"
    fm, _ = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
    assert re.search(r"^metadata:\s*$", fm, re.M), f"frontmatter missing metadata block:\n{fm}"
    assert re.search(r"^\s+rule-skills:\s*none\s*$", fm, re.M), (
        f"frontmatter metadata missing 'rule-skills: none':\n{fm}"
    )


def test_skill_body_workflow_contract() -> None:
    skill_md = SKILL_DIR / "SKILL.md"
    assert skill_md.is_file(), f"missing {skill_md}"
    _, body = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
    assert "work-dispatch.sh" in body
    assert "package-check.sh" in body

    fenced_blocks = re.findall(r"```[^\n]*\n(.*?)```", body, re.DOTALL)
    mech_blocks = [blk for blk in fenced_blocks if "mechanicalChecks" in blk]
    assert len(mech_blocks) == 1, f"expected exactly 1 fenced block with mechanicalChecks, found {len(mech_blocks)}"

    entries = _extract_mechanical_checks_entries(mech_blocks[0])
    assert len(entries) == 1, f"expected exactly 1 mechanicalChecks entry, found {len(entries)}: {entries}"
    assert re.search(r"""["']?cmd["']?\s*:""", entries[0]), f"mechanicalChecks entry missing cmd: {entries[0]}"
    assert "package-check.sh" in entries[0], f"mechanicalChecks cmd does not name package-check.sh: {entries[0]}"


def test_skill_hand_check_phrases() -> None:
    skill_md = SKILL_DIR / "SKILL.md"
    assert skill_md.is_file(), f"missing {skill_md}"
    _, body = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
    for phrase in (
        "Hand-checked against the filing",
        "Filing quote (hand check)",
        "Not counted (hand-checked)",
    ):
        assert phrase in body, f"SKILL.md body missing phrase {phrase!r}"


def test_skill_production_spec_reference() -> None:
    spec_doc = SKILL_DIR / "references" / "production-spec.md"
    assert spec_doc.is_file(), f"missing {spec_doc}"
    text = spec_doc.read_text(encoding="utf-8")
    for key in SPEC_KEYS:
        assert re.search(rf"\b{re.escape(key)}\b", text), (
            f"references/production-spec.md missing SPEC key {key!r}"
        )


def test_skill_no_academic_word() -> None:
    assert SKILL_DIR.is_dir(), f"missing {SKILL_DIR}"
    hits: list[str] = []
    for path in sorted(p for p in SKILL_DIR.rglob("*") if p.is_file()):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"\bacademic\b", text, re.IGNORECASE):
            hits.append(path.relative_to(SKILL_DIR).as_posix())
    assert not hits, f"word 'academic' found in skill directory: {hits}"
