# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "requests", "html2text"]
# ///
"""Contract tests for readwise_to_nlm.py: token/nlm resolution, doc field extraction, conversion."""

import importlib.util
import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent / "readwise_to_nlm.py"


def load(monkeypatch, tmp_path, with_nlm=True):
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    if with_nlm:
        nlm = bindir / "nlm"
        nlm.write_text("#!/bin/sh\n/usr/bin/cat > " + str(tmp_path / "nlm.in") + "\n")
        nlm.chmod(0o755)
    monkeypatch.setenv("PATH", str(bindir))
    monkeypatch.setenv("READWISE_TOKEN_FILE", str(tmp_path / "tok"))
    spec = importlib.util.spec_from_file_location("rw_nlm_under_test", SRC)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def m(monkeypatch, tmp_path):
    return load(monkeypatch, tmp_path)


def test_import_without_nlm_exits_2(monkeypatch, tmp_path, capsys):
    with pytest.raises(SystemExit) as e:
        load(monkeypatch, tmp_path, with_nlm=False)
    assert e.value.code == 2
    assert "nlm not found on PATH" in capsys.readouterr().err


def test_token_path_env_then_tmpdir_default(m, monkeypatch, tmp_path):
    assert m._token_path() == tmp_path / "tok"
    monkeypatch.delenv("READWISE_TOKEN_FILE")
    monkeypatch.setenv("TMPDIR", "/x")
    assert m._token_path() == Path("/x/agenix/readwise-token")


def test_get_token_reads_strips_and_fails(m, tmp_path, capsys):
    (tmp_path / "tok").write_text("  abc\n")
    assert m.get_token() == "abc"
    (tmp_path / "tok").write_text("\n")
    with pytest.raises(SystemExit) as e:
        m.get_token()
    assert e.value.code == 2 and "Token file is empty:" in capsys.readouterr().err
    (tmp_path / "tok").unlink()
    with pytest.raises(SystemExit) as e:
        m.get_token()
    assert e.value.code == 2 and "Token file not found:" in capsys.readouterr().err


def test_extract_tags_variants(m):
    assert m.extract_tags({"tags": ["A", "b", 3]}) == ["a", "b"]
    assert m.extract_tags({"tags": {"Corps": {}, "X": {}}}) == ["corps", "x"]
    assert m.extract_tags({"document_tags": ["Q"]}) == ["q"]
    assert m.extract_tags({}) == []


def test_extract_title_fallbacks(m):
    assert m.extract_title({"title": "T", "document_title": "D"}) == "T"
    assert m.extract_title({"document_title": "D"}) == "D"
    assert m.extract_title({}) == "Untitled"


def test_find_html_requires_markup_string(m):
    assert m.find_html({"html": "<p>x</p>"}) == "<p>x</p>"
    assert m.find_html({"html": "plain", "content": "<b>c</b>"}) == "<b>c</b>"
    assert m.find_html({"html": 5}) is None
    assert m.find_html({}) is None


def test_html_to_markdown_keeps_links_no_wrap(m):
    md = m.html_to_markdown('<h1>Hi</h1><p>see <a href="http://x.y">here</a></p>')
    assert md.startswith("# Hi")
    assert "[here](http://x.y)" in md


def test_add_to_notebook_pipes_markdown_to_nlm(m, tmp_path, capsys):
    assert m.add_to_notebook("nb1", "# T\n\nbody", "T") is True
    assert (tmp_path / "nlm.in").read_text() == "# T\n\nbody"
    assert "Added 'T' to notebook nb1" in capsys.readouterr().out


def test_add_to_notebook_failure(m, tmp_path, capsys):
    (tmp_path / "bin" / "nlm").write_text("#!/bin/sh\n/usr/bin/echo oops >&2\nexit 4\n")
    assert m.add_to_notebook("nb1", "x", "T") is False
    assert "Failed to add 'T': oops" in capsys.readouterr().err
