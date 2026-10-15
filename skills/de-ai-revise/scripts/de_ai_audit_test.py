"""Contract tests for the de_ai_audit.py CLI wrapper (output shape, exit codes, flags)."""
import json
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parent / "de_ai_audit.py"
TIC = "We trace a rich tapestry of cases.\n"


def run(*args):
    # prose-audit.py needs PyYAML, which the bare pytest env lacks; the script's own shebang declares it.
    return subprocess.run(["uv", "run", "--quiet", "--with", "pyyaml", "python3", str(SCRIPT), *args],
                          capture_output=True, text=True)


def doc(tmp_path, text, name="d.md"):
    f = tmp_path / name
    f.write_text(text, encoding="utf-8")
    return str(f)


def test_clean_text_exits_0_and_says_clean(tmp_path):
    p = run(doc(tmp_path, "The court held for the plaintiff. Costs followed the event.\n"))
    assert p.returncode == 0
    assert "spans: 0" in p.stdout
    assert "(clean — no AI-prose tells)" in p.stdout


def test_tic_exits_1_and_reports_spans(tmp_path):
    p = run(doc(tmp_path, TIC))
    assert p.returncode == 1
    assert "spans: 2" in p.stdout
    assert "diction:always_flag:1  tic:1" in p.stdout
    assert "'tapestry' -> (describe the actual complexity)" in p.stdout


def test_json_shape_and_span_fields(tmp_path):
    f = doc(tmp_path, TIC)
    p = run("--json", f)
    assert p.returncode == 1
    res = json.loads(p.stdout)[f]
    assert {"file", "words", "composite_human_likeness", "tic_density", "n_spans", "by_type",
            "spans", "advisories", "density_words", "z_report"} <= set(res)
    assert res["by_type"] == {"tic": 1, "diction:always_flag": 1}
    tic = next(s for s in res["spans"] if s["type"] == "tic")
    assert tic["text"] == "rich tapestry" and tic["line"] == 1 and tic["sev_score"] == 4
    assert {"type", "sev_score", "message", "replace_with"} <= set(tic)


def test_tier_restricts_diction(tmp_path):
    res = json.loads(run("--json", "--tier", "cluster", doc(tmp_path, TIC)).stdout)
    only = next(iter(res.values()))
    assert only["by_type"] == {"tic": 1}


def test_footnotes_masked_by_default_and_scored_with_flag(tmp_path):
    f = doc(tmp_path, "The court held for the plaintiff.^[A rich tapestry of cases.]\n")
    masked = run("--json", f)
    assert masked.returncode == 0
    assert json.loads(masked.stdout)[f]["n_spans"] == 0
    kept = run("--json", "--keep-footnotes", f)
    assert kept.returncode == 1
    assert json.loads(kept.stdout)[f]["n_spans"] == 2


def test_multiple_files_exit_1_if_any_has_tells(tmp_path):
    clean = doc(tmp_path, "The court held for the plaintiff. Costs followed the event.\n", "a.md")
    dirty = doc(tmp_path, TIC, "b.md")
    p = run("--json", clean, dirty)
    assert p.returncode == 1
    out = json.loads(p.stdout)
    assert out[clean]["n_spans"] == 0 and out[dirty]["n_spans"] == 2


def test_missing_file_fails_with_filenotfound(tmp_path):
    p = run(str(tmp_path / "nope.md"))
    assert p.returncode != 0
    assert "FileNotFoundError" in p.stderr


def test_no_files_is_usage_error():
    p = run()
    assert p.returncode == 2
    assert "files" in p.stderr
