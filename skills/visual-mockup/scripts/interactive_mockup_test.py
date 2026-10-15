# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for interactive_mockup.py: HTML generation and CLI I/O."""

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import interactive_mockup as im

DATA = {"title": "Cap </table>", "nodes": [{"id": "n1", "label": "Issuer", "x": 1, "y": 2}],
        "edges": [], "regions": []}


def test_generate_html_substitutes_both_placeholders():
    html = im.generate_html(DATA)
    assert "JSON_DATA_PLACEHOLDER" not in html and "TITLE_PLACEHOLDER" not in html
    assert json.dumps(DATA) in html
    assert html.startswith("<!DOCTYPE html>") and html.rstrip().endswith("</html>")


def test_generate_html_default_title_when_missing():
    html = im.generate_html({"nodes": []})
    assert "Diagram Mockup" in html.replace("Interactive Diagram Mockup", "")
    assert json.dumps({"nodes": []}) in html


def run(args, stdin=None):
    return subprocess.run([sys.executable, str(HERE / "interactive_mockup.py"), *args],
                          capture_output=True, text=True, input=stdin)


def test_cli_file_input_writes_output(tmp_path):
    src = tmp_path / "l.json"
    src.write_text(json.dumps(DATA))
    out = tmp_path / "o.html"
    r = run([str(src), "-o", str(out)])
    assert (r.returncode, r.stdout) == (0, f"Wrote {out}\n")
    assert out.read_text() == im.generate_html(DATA)


def test_cli_stdin_input(tmp_path):
    out = tmp_path / "o.html"
    r = run(["-", "--output", str(out)], stdin=json.dumps(DATA))
    assert r.returncode == 0 and json.dumps(DATA) in out.read_text()


def test_cli_invalid_json_fails_without_output(tmp_path):
    src = tmp_path / "bad.json"
    src.write_text("{not json")
    out = tmp_path / "o.html"
    r = run([str(src), "-o", str(out)])
    assert r.returncode == 1 and "JSONDecodeError" in r.stderr
    assert not out.exists()


def test_cli_missing_input_fails(tmp_path):
    r = run([str(tmp_path / "none.json"), "-o", str(tmp_path / "o.html")])
    assert r.returncode == 1 and "FileNotFoundError" in r.stderr
