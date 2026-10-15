"""Contract tests for bluebook_signal_linter.py."""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bluebook_signal_linter as bl  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "bluebook_signal_linter.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                          capture_output=True, text=True)


def test_inside_bracket_signal_italicized():
    assert bl.lint("[see @smith2020, at 5]") == "[*see* @smith2020, at 5]"


def test_semicolon_separated_signal():
    assert bl.lint("[@a2020; see also @b2021]") == "[@a2020; *see also* @b2021]"


def test_prose_signal_before_bracketed_cite_preserves_case():
    assert bl.lint("See [@smith2020].") == "*See* [@smith2020]."
    assert bl.lint("But cf. [@x1]") == "*But cf.* [@x1]"


def test_see_eg_tail_is_one_signal():
    assert bl.lint("[see, e.g., @a1]") == "[*see, e.g.,* @a1]"


def test_longest_signal_wins():
    assert bl.lint("[see generally @a1]") == "[*see generally* @a1]"
    assert bl.lint("[but see @a1]") == "[*but see* @a1]"


def test_no_midword_match():
    assert bl.lint("We oversee [@a1].") == "We oversee [@a1]."


def test_signal_without_citation_untouched():
    text = "You should see the doctor."
    assert bl.lint(text) == text


def test_idempotent():
    once = bl.lint("[see @a1; cf. @b2]")
    assert once == "[*see* @a1; *cf.* @b2]"
    assert bl.lint(once) == once


def test_find_stacked_footnotes_reports_line_and_text():
    text = "ok.[^1]\nbad.[^2][^3] here\nfine[^4] text[^5]"
    assert bl.find_stacked_footnotes(text) == [(2, "bad.[^2][^3] here")]


def test_stacked_ignores_definitions():
    assert bl.find_stacked_footnotes("[^1]: body\n[^2]: body") == []
    # a definition whose body opens with another reference is not stacking
    assert bl.find_stacked_footnotes("[^1]: [^2] body") == []


def test_stacked_allows_punctuation_between():
    assert len(bl.find_stacked_footnotes("x.[^1], [^2]")) == 1


def test_subpart_refs_with_part_prefix():
    hits = bl.find_subpart_refs("intro\nSee Part II §B.3 below")
    assert hits == [(2, "Part II §B.3", "Part II.B.3")]


def test_bare_subpart_gets_prefix_hint():
    [(line, raw, sug)] = bl.find_subpart_refs("as in §A.")
    assert (line, raw) == (1, "§A")
    assert sug == ".A  (prefix with current Part)"


def test_statute_sections_not_flagged():
    assert bl.find_subpart_refs("15 U.S.C. § 78m(d) and § 216(1)") == []


def test_cli_rewrites_in_place(tmp_path):
    f = tmp_path / "d.md"
    f.write_text("See [@a1].\n")
    p = run(f)
    assert p.returncode == 0
    assert p.stdout == f"modified: {f}\n"
    assert f.read_text() == "*See* [@a1].\n"


def test_cli_check_reports_and_does_not_write(tmp_path):
    f = tmp_path / "d.md"
    f.write_text("a\nSee [@a1].\n")
    p = run("--check", f)
    assert p.returncode == 1
    assert f"would modify: {f}" in p.stderr
    assert "  - See [@a1]." in p.stderr and "  + *See* [@a1]." in p.stderr
    assert f.read_text() == "a\nSee [@a1].\n"


def test_cli_check_clean_file_exit_zero(tmp_path):
    f = tmp_path / "d.md"
    f.write_text("Nothing to fix.\n")
    p = run("--check", f)
    assert (p.returncode, p.stderr) == (0, "")


def test_cli_check_fails_on_detect_only_hits(tmp_path):
    f = tmp_path / "d.md"
    f.write_text("x.[^1][^2]\nPart II §B\n")
    p = run("--check", f)
    assert p.returncode == 1
    assert f"stacked footnote: {f}:1:" in p.stderr
    assert f"subpart ref: {f}:2: 'Part II §B'" in p.stderr


def test_cli_without_check_reports_detect_only_but_exits_zero(tmp_path):
    f = tmp_path / "d.md"
    f.write_text("x.[^1][^2]\n")
    p = run(f)
    assert p.returncode == 0
    assert "stacked footnote:" in p.stderr


def test_cli_missing_file_raises(tmp_path):
    p = run(tmp_path / "nope.md")
    assert p.returncode != 0
    assert "FileNotFoundError" in p.stderr
