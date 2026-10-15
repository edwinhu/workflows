"""Contract tests for style_metrics.py: pure functions plus the CLI."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import style_metrics as sm  # noqa: E402

SCRIPT = Path(__file__).parent / "style_metrics.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          capture_output=True, text=True)


def test_normalize_joins_hyphenated_wraps_and_drops_page_numbers():
    assert sm.normalize_text("Califor-\nnia is big\n12\nfoo") == "California is big foo"


def test_split_sentences_guards_legal_abbreviations():
    got = sm.split_sentences("See Smith v. Jones, 5 U.S. 1 (1990). The court held. It ruled.")
    assert got == ["See Smith v. Jones, 5 U.S. 1 (1990).", "The court held.", "It ruled."]


def test_words_keeps_apostrophes_and_hyphens_drops_digits():
    assert sm.words("Don't re-enter 42 rooms") == ["Don't", "re-enter", "rooms"]


def test_false_precision_flags_percent_with_two_decimals():
    hits = sm.false_precision_hits("The share of firms rose to 12.34 percent in the sample today.\n")
    assert hits == [(27, "12.34 percent")]


def test_false_precision_bare_numeral_needs_three_decimals():
    assert sm.false_precision_hits("The share rose to 0.12 in the sample of firms studied.\n") == []
    assert [t for _, t in sm.false_precision_hits(
        "The share rose to 0.1234 in the sample of firms studied.\n")] == ["0.1234"]


def test_false_precision_ignores_tables_quotes_and_citation_leads():
    assert sm.false_precision_hits("| the share rose to 12.3456 percent in the sample today |\n") == []
    assert sm.false_precision_hits("> the share rose to 12.3456 percent in the sample today\n") == []
    assert sm.false_precision_hits("The version 1.2345 was released for the sample today\n") == []


def test_mask_non_prose_preserves_length_and_blanks_footnotes_and_fences():
    raw = "a ^[note 12.34%] b\n```\nx 1.2\n```\n"
    masked = sm.mask_non_prose(raw)
    assert len(masked) == len(raw)
    assert masked.count("\n") == raw.count("\n")
    assert "12.34" not in masked and "1.2" not in masked
    assert masked.startswith("a ") and " b\n" in masked


def test_lint_reports_em_dash_and_opener_transition_with_lines():
    raw = ("Moreover, the court held that the statute applies. It was a long day for everyone "
           "involved in the case today.\n\nThe result — a surprise — was clear.\n")
    r = sm.lint_text(raw)
    assert r["counts"] == {"em_dash": 2, "opener_transition": 1}
    by = {(f["type"], f["line"]) for f in r["findings"]}
    assert ("opener_transition", 1) in by and ("em_dash", 3) in by
    assert any("'Moreover'" in f["message"] for f in r["findings"])
    assert r["n_findings"] == 3


def test_lint_caps_findings_per_type():
    raw = "Plain words here. " + "A — b. " * 30
    r = sm.lint_text(raw, max_per_type=5)
    assert r["counts"]["em_dash"] == 5


def test_score_text_on_empty_input_reports_error():
    assert sm.score_text("") == {"error": "draft too short / no prose extracted"}


def test_cli_no_args_prints_docstring_and_exits_1():
    p = run()
    assert p.returncode == 1
    assert "Stylometric feature extraction" in p.stdout


def test_cli_lint_json(tmp_path):
    f = tmp_path / "d.txt"
    f.write_text("The result — a surprise — was clear. Short one.\n", encoding="utf-8")
    p = run("--lint", "--json", str(f))
    assert p.returncode == 0
    data = json.loads(p.stdout)
    assert data["counts"]["em_dash"] == 2
    assert {"composite_human_likeness", "n_findings", "findings", "advisories"} <= set(data)


def test_cli_lint_text_format(tmp_path):
    f = tmp_path / "d.txt"
    f.write_text("The result — a surprise — was clear. Short one.\n", encoding="utf-8")
    p = run("--lint", str(f))
    assert p.returncode == 0
    assert "L1" in p.stdout and "[high] em_dash" in p.stdout


def test_cli_features_json_has_core_keys(tmp_path):
    f = tmp_path / "d.txt"
    f.write_text("The court held. It ruled quickly on the matter before it.\n", encoding="utf-8")
    p = run("--features", str(f))
    assert p.returncode == 0
    feats = json.loads(p.stdout)
    assert {"sent_len_mean", "sent_len_cv", "frac_short_sent"} <= set(feats)


def test_cli_default_scores_short_draft_as_error(tmp_path):
    f = tmp_path / "d.txt"
    f.write_text("", encoding="utf-8")
    p = run(str(f))
    assert p.returncode == 0
    assert json.loads(p.stdout) == {"error": "draft too short / no prose extracted"}
