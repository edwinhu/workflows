#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pypdf", "pytest"]
# ///
"""Contract suite for ${CLAUDE_PLUGIN_ROOT}/checks/workshop/constraints/workshop-numbers.py (FID's numeric half).

Each test stages fixtures/clean/ into tmp_path, applies one mutation beside its assertion, and asserts on the
emitted count line, the `path:line:` finding and the exit code.

    uv run --with pypdf --with pytest python3 -m pytest ${CLAUDE_PLUGIN_ROOT}/skills/workshop/scripts/workshop_numbers_test.py -q
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).resolve().parent.parent
RUNNER = SKILL_ROOT.parent.parent / "checks" / "workshop" / "constraints" / "workshop-numbers.py"
CLEAN = SKILL_ROOT / "fixtures" / "clean"

PAPER_EXTRA = """
The coefficient is 0.37 (standard error 0.12) on 1,234 firms, a 12.0% rise, from $1,500 to $2,100.
The sample runs 2019-20. Firms in the top decile (45% of the sample) pay more.
"""


@pytest.fixture
def proj(tmp_path):
    d = tmp_path / "proj"
    shutil.copytree(CLEAN, d)
    (d / "paper.md").write_text((d / "paper.md").read_text() + PAPER_EXTRA)
    return d


def run(d: Path, *extra: str):
    r = subprocess.run(
        [sys.executable, str(RUNNER), "--project-dir", str(d), "--plan", str(d / "plan.md"), *extra],
        capture_output=True, text=True, check=False,
    )
    return r.returncode, r.stdout.splitlines(), r.stderr


def slides(d: Path, extra: str, notes: str = ""):
    p = d / "presentation" / "slides.typ"
    p.write_text(p.read_text() + "\n" + extra + "\n")
    if notes:
        n = d / "presentation" / "notes.typ"
        n.write_text(n.read_text() + "\n" + notes + "\n")


def findings(out):
    return [ln for ln in out[1:] if ":" in ln]


def test_clean_fixture_passes_with_count_line(proj):
    rc, out, _ = run(proj)
    assert rc == 0, out
    assert out[0].startswith("workshop-numbers: ") and out[0].endswith("number(s) examined")
    assert int(out[0].split()[1]) > 0


def test_paper_number_passes(proj):
    slides(proj, "- The coefficient is 0.37 on 1234 firms, 45% of the sample.")
    rc, out, _ = run(proj)
    assert rc == 0, out


def test_fabricated_number_fails_with_path_line(proj):
    slides(proj, "- Elasticity of 0.73 across firms.")
    rc, out, _ = run(proj)
    f = findings(out)
    assert rc == 1 and len(f) == 1, out
    assert f[0].startswith("presentation/slides.typ:") and "'0.73'" in f[0]
    line = int(f[0].split(":")[1])
    assert "0.73" in (proj / "presentation" / "slides.typ").read_text().splitlines()[line - 1]


def test_fabricated_number_in_notes_fails(proj):
    slides(proj, "", notes="- About 4,321 firms.")
    rc, out, _ = run(proj)
    assert rc == 1 and findings(out)[0].startswith("presentation/notes.typ:"), out


@pytest.mark.parametrize("text", [
    "1234 firms", "1,234 firms", "12% rise", "12.0% rise", "12.00% rise", "a rise of 12.0", ".37 coefficient",
    "0.370 coefficient", "$1500 to $2,100", "1,500.00 dollars", "sample 2019-20", "sample 2019–20",
])
def test_formatted_variants_pass(proj, text):
    slides(proj, f"- {text}")
    rc, out, _ = run(proj)
    assert rc == 0, (text, out)


def test_formatted_variant_of_a_missing_number_still_fails(proj):
    slides(proj, "- 99.0% rise")
    rc, out, _ = run(proj)
    assert rc == 1 and "'99.0%'" in findings(out)[0], out


def test_inventory_source_cell_supplies_a_number(proj):
    plan = proj / "plan.md"
    plan.write_text(plan.read_text().replace("The four-point payout coefficient", "The four-point payout coefficient, 6.7 percent of assets"))
    slides(proj, "- Assets fall 6.7% in the placebo window")
    rc, out, _ = run(proj)
    assert rc == 0, out


@pytest.mark.parametrize("text", [
    "Back to slide 12", "see page 18 and pp. 20", "Section 14 covers it", "§ 77 applies", "Step 10 next",
])
def test_slide_page_section_references_are_exempt(proj, text):
    slides(proj, "", notes=f"- {text}.")
    rc, out, _ = run(proj)
    assert rc == 0, (text, out)


def test_section_numbers_and_list_markers_are_exempt(proj):
    slides(proj, "== 12. Robustness\n\n=== 13.2 Placebo tests\n\n10. A numbered item\n11) Another")
    rc, out, _ = run(proj)
    assert rc == 0, out


def test_title_block_date_exempt_but_same_year_in_body_is_checked(proj):
    p = proj / "presentation" / "slides.typ"
    s = p.read_text().replace("a fixture deck\n", "a fixture deck\n\nOctober 14, 2026\n", 1)
    p.write_text(s + "\n- Revenue changed in 2026\n")
    rc, out, _ = run(proj)
    f = findings(out)
    assert rc == 1 and len(f) == 1 and "'2026'" in f[0], out


def test_layout_arguments_and_comments_are_not_numbers(proj):
    slides(proj, '#image("fig99.png", width: 85%)\n// 7777 in a comment\n#set text(size: 24pt)\n'
                 '#inv("R1", "F10")\n/* 8888 */')
    rc, out, _ = run(proj)
    assert rc == 0, out


def test_numbers_in_content_blocks_inside_calls_are_examined(proj):
    slides(proj, "#table(columns: 2, [Estimate], [0.88])")
    rc, out, _ = run(proj)
    assert rc == 1 and "'0.88'" in findings(out)[0], out


def test_identifier_digits_are_not_quantities(proj):
    slides(proj, "- COVID-19 and H2O and R12 and F10 and x25")
    rc, out, _ = run(proj)
    assert rc == 0, out


def test_single_digit_integers_are_not_examined_but_percent_and_currency_are(proj):
    slides(proj, "- 7 groups")
    assert run(proj)[0] == 0
    slides(proj, "- 7% of firms")
    rc, out, _ = run(proj)
    assert rc == 1 and "'7%'" in findings(out)[0]


def test_missing_paper_is_exit_2(proj):
    (proj / "paper.md").unlink()
    rc, out, err = run(proj)
    assert rc == 2 and "COULD-NOT-CHECK" in err, (out, err)
    assert out[0].startswith("workshop-numbers: 0 number(s) examined")


def test_missing_deck_is_exit_2(proj):
    (proj / "presentation" / "slides.typ").unlink()
    rc, _, err = run(proj)
    assert rc == 2 and "slides.typ" in err


def test_unparseable_inventory_is_exit_2(proj):
    plan = proj / "plan.md"
    plan.write_text(plan.read_text().replace("## Source Inventory", "## Source Inventory Gone"))
    assert run(proj)[0] == 2


def test_no_plan_is_nothing_in_scope(proj):
    r = subprocess.run([sys.executable, str(RUNNER), "--project-dir", str(proj)], capture_output=True, text=True, check=False)
    assert r.returncode == 0 and "nothing in scope (no --plan given)" in r.stdout


def test_pdf_paper_is_read(proj):
    pytest.importorskip("pypdf")
    plan = proj / "plan.md"  # the fixture's slides.pdf is a real PDF carrying "1994 through 2019"
    plan.write_text(plan.read_text().replace("| path | paper.md |", "| path | presentation/slides.pdf |"))
    slides(proj, "- A 1994 start")
    assert run(proj)[0] == 0
    slides(proj, "- A 7777 start")
    rc, out, _ = run(proj)
    assert rc == 1 and "'7777'" in findings(out)[0], out


def test_unicode_escapes_and_multiline_code_are_not_numbers(proj):
    slides(proj, "#let f(x) = {\n  x + 99.5\n}\n#{ let a = 7777 }\nHe said \\u{201C}hi\\u{201D}.")
    rc, out, _ = run(proj)
    assert rc == 0, out
