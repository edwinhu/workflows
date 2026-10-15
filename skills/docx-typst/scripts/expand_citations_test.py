# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for expand_citations.py: positional splice, case fixing, CLI. typst is stubbed."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import expand_citations as e


def test_site_regex_finds_cites_refs_and_labels_in_order():
    src = "#cite(<A-1>) x #cite(<B>, supplement: [at 5]) y #ref(<sec>) z @sec-remedies end"
    assert e.SITE_RE.findall(src) == [
        "#cite(<A-1>)", "#cite(<B>, supplement: [at 5])", "#ref(<sec>)", "@sec-remedies",
    ]


def test_expand_splices_positionally():
    out = e.expand("see #cite(<a>) and #cite(<b>)", ["Smith, 1", "Jones, 2"])
    assert out == "see Smith, 1 and Jones, 2"


def test_expand_count_mismatch_refuses():
    with pytest.raises(SystemExit) as ei:
        e.expand("#cite(<a>) #cite(<b>)", ["only one"])
    assert "2 cite/reference sites in the source but typst rendered 1" in str(ei.value)


def test_expand_capitalizes_short_form_at_sentence_start():
    out = e.expand("[#cite(<a>)", ["#emph[id.] at 3"])
    assert out == "[#emph[Id.] at 3"


def test_expand_lowercases_short_form_mid_sentence_and_leaves_full_form():
    out = e.expand("see also #cite(<a>); #cite(<b>)", ["#emph[Supra] note 1", "Alma Cohen, Title"])
    assert out == "see also #emph[supra] note 1; Alma Cohen, Title"


def test_sentence_start_after_period_or_bracket_or_start_of_file():
    assert e._starts_citation_sentence("", 0)
    assert e._starts_citation_sentence("Foo. ", 5)
    assert e._starts_citation_sentence("#footnote[", 10)
    assert not e._starts_citation_sentence("See ", 4)


def test_apply_case_only_touches_leading_word():
    assert e._apply_case("#emph[infra] note 2", True) == "#emph[Infra] note 2"
    assert e._apply_case("Author, #emph[Id.]", True) == "Author, #emph[Id.]"


def test_expand_dissolves_ungroup_wrapper_but_not_authored_content():
    out = e.expand("x #cite(<a>)#[;] #cite(<b>) #[bold]", ["A", "B"])
    assert out == "x A; B #[bold]"


def test_expand_no_sites_is_identity():
    assert e.expand("plain text", []) == "plain text"


def test_rendered_citations_failure_exits_with_stderr(monkeypatch):
    class P:
        returncode = 1
        stdout = ""
        stderr = "error: unknown label"
    monkeypatch.setattr(e.subprocess, "run", lambda *a, **k: P())
    with pytest.raises(SystemExit, match="typst could not resolve citations:\nerror: unknown label"):
        e.rendered_citations(Path("main.typ"), Path("."))


def test_rendered_citations_parses_json(monkeypatch):
    seen = {}
    class P:
        returncode = 0
        stdout = json.dumps(["a", "b"])
        stderr = ""
    def run(cmd, **k):
        seen["cmd"] = cmd
        return P()
    monkeypatch.setattr(e.subprocess, "run", run)
    assert e.rendered_citations(Path("m.typ"), Path("/r")) == ["a", "b"]
    assert seen["cmd"][:6] == ["typst", "query", "m.typ", "<bb-out>", "--field", "value"]
    assert seen["cmd"][-4:] == ["--root", "/r", "--format", "json"]


@pytest.fixture
def files(tmp_path, monkeypatch):
    monkeypatch.setattr(e, "rendered_citations", lambda main, root: ["Full cite"])
    (tmp_path / "main.typ").write_text("")
    (tmp_path / "src.typ").write_text("see #cite(<a>)\n")
    return tmp_path


def argv(d, *extra):
    return ["--main", str(d / "main.typ"), "--src", str(d / "src.typ"), "--out", str(d / "body.typ"), *extra]


def test_main_writes_out_and_reports_count(files, capsys):
    assert e.main(argv(files)) == 0
    assert (files / "body.typ").read_text() == "see Full cite\n"
    assert capsys.readouterr().out.strip() == "expanded 1 citations: src.typ -> body.typ"


def test_main_check_up_to_date_and_stale(files, capsys):
    assert e.main(argv(files, "--check")) == 1  # --out missing counts as stale
    assert "STALE: body.typ does not match the render of src.typ" in capsys.readouterr().err
    assert not (files / "body.typ").exists()
    (files / "body.typ").write_text("see Full cite\n")
    assert e.main(argv(files, "--check")) == 0
    assert "up to date: body.typ matches src.typ (1 citations)" in capsys.readouterr().out
