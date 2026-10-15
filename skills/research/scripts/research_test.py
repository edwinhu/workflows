# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for research.py: parsing, dedupe, bib and CLI-wrapper mapping (no network)."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import research as rs


def paper(title="T", doi=None, journal="J", citations=0, source="a", takeaway=""):
    return {"title": title, "doi": doi, "journal": journal, "citations": citations,
            "source": source, "takeaway": takeaway}


def test_scholar_authors_field_splits_journal_and_year():
    got = rs._parse_scholar_authors_field("FH Easterbrook, DR Fischel\xa0- Virginia Law Review, 1984")
    assert got == (["FH Easterbrook", "DR Fischel"], "Virginia Law Review", 1984)


def test_scholar_authors_field_edges():
    assert rs._parse_scholar_authors_field("") == ([], "", None)
    assert rs._parse_scholar_authors_field("A Smith, B Jones") == (["A Smith", "B Jones"], "", None)
    assert rs._parse_scholar_authors_field("A Smith - Some Journal") == (["A Smith"], "Some Journal", None)


def test_parse_year_and_split_authors():
    assert rs._parse_year("2019-05-01") == 2019
    assert rs._parse_year(None) is None
    assert rs._parse_year("n.d.") is None
    assert rs._split_authors("A B; C D, E F") == ["A B", "C D", "E F"]


def test_normalize_title():
    assert rs._normalize_title("The  Law: & Econ!") == "thelawecon"


def test_dedup_by_doi_case_insensitive_merges_best_fields():
    a = paper("One", doi="10.1/ABC", journal="SSRN Electronic Journal", citations=3, source="x")
    b = paper("Other title", doi="10.1/abc", journal="Real Journal", citations=9, source="y",
              takeaway="tk")
    out = rs.deduplicate([a, b])
    assert len(out) == 1
    assert out[0]["journal"] == "Real Journal"
    assert out[0]["citations"] == 9
    assert out[0]["sources"] == ["x", "y"]
    assert out[0]["takeaway"] == "tk"


def test_dedup_by_title_fills_missing_doi_then_matches_on_it():
    out = rs.deduplicate([
        paper("Same Title", source="x"),
        paper("same title!", doi="10.2/z", source="y"),
        paper("Different", doi="10.2/z", source="z"),
    ])
    assert [p["title"] for p in out] == ["Same Title"]
    assert out[0]["doi"] == "10.2/z" and out[0]["sources"] == ["x", "y", "z"]


def test_dedup_keeps_distinct_and_does_not_repeat_source():
    out = rs.deduplicate([paper("A", source="x"), paper("B", source="x"), paper("a", source="x")])
    assert [p["title"] for p in out] == ["A", "B"]
    assert out[0]["sources"] == ["x"]


BIB = """@article{k1,
  title = {A {Study} of
    Mergers},
  author = {Doe, Jane and Roe, Rick},
  journaltitle = {Journal of Law},
  date = {2019-05-01},
  doi = {10.5/xyz},
}
@book{k2,
  title = {Unrelated Topic},
  year = {2001},
  doi = {not-a-doi},
}
@misc{k3,
  note = {no title here},
}
"""


def test_parse_bib_entry_biblatex():
    p = rs._parse_bib_entry(BIB.split("\n@")[0])
    assert p["title"] == "A Study of Mergers"
    assert p["authors"] == ["Doe, Jane", "Roe, Rick"]
    assert (p["journal"], p["year"], p["doi"]) == ("Journal of Law", 2019, "10.5/xyz")
    assert p["url"] == "https://doi.org/10.5/xyz" and p["source"] == "bib"


def test_parse_bib_entry_rejects_non_doi_and_untitled():
    k2 = "@" + BIB.split("\n@")[1]
    assert rs._parse_bib_entry(k2)["doi"] is None
    assert rs._parse_bib_entry("@misc{k3,\n  note = {x},\n}") is None
    assert rs._parse_bib_entry("garbage") is None


def test_search_bib_requires_all_words(tmp_path, monkeypatch):
    bib = tmp_path / "lib.bib"
    bib.write_text(BIB)
    monkeypatch.setattr(rs, "BIB_PATH", bib)
    assert [p["title"] for p in rs.search_bib("mergers law")] == ["A Study of Mergers"]
    assert rs.search_bib("mergers topic") == []
    assert rs.search_bib("a of") == []  # words of <=2 chars dropped -> empty query


def test_search_bib_missing_file_warns(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(rs, "BIB_PATH", tmp_path / "none.bib")
    assert rs.search_bib("anything") == []
    assert "[warn] bib file not found:" in capsys.readouterr().err


class Done:
    def __init__(self, out="", err="", rc=0):
        self.stdout, self.stderr, self.returncode = out, err, rc


def test_run_scholar_maps_items(monkeypatch):
    items = [{"title": "X", "authors": "A B - Yale LJ, 2001", "year": "1999", "journal": "JSTOR",
              "doi": "", "citations": None, "snippet": "s", "url": "u"}]
    seen = {}

    def fake(cmd, **kw):
        seen["cmd"] = cmd
        return Done(json.dumps(items))

    monkeypatch.setattr(subprocess, "run", fake)
    (p,) = rs.run_scholar("lookup", "q")
    assert seen["cmd"] == ["scholar", "lookup", "q", "--json"]
    assert (p["authors"], p["journal"], p["year"]) == (["A B"], "Yale LJ", 2001)
    assert (p["doi"], p["citations"], p["takeaway"], p["source"]) == (None, 0, "s", "scholar-lookup")


def test_run_scholar_failures_return_empty(monkeypatch, capsys):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Done(err="HTTP 429", rc=1))
    assert rs.run_scholar("search", "q") == []
    assert "[warn] scholar search rate-limited (429); skipping" in capsys.readouterr().err
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Done("not json"))
    assert rs.run_scholar("search", "q") == []
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Done('{"a": 1}'))
    assert rs.run_scholar("search", "q") == []


def test_run_consensus_batch_builds_command_and_maps(monkeypatch, tmp_path):
    seen = {}
    jf = tmp_path / "j.md"
    jf.write_text("x")
    monkeypatch.setattr(rs, "TRUSTED_JOURNALS", jf)
    monkeypatch.setattr(rs, "CONSENSUS_BIN", Path("/bin/consensus"))

    def fake(cmd, **kw):
        seen["cmd"] = cmd
        return Done(json.dumps([{"title": "T", "authors": ["a"], "year": 2020, "doi": "10.1/x",
                                 "citations": 5, "takeaway": "tk"}]))

    monkeypatch.setattr(subprocess, "run", fake)
    (p,) = rs.run_consensus("q", n=7, min_citations=2, journals_only=True)
    assert seen["cmd"] == ["/bin/consensus", "search", "q", "--n", "7", "--sort", "citations",
                           "--min-citations", "2", "--journals-file", str(jf)]
    assert (p["title"], p["year"], p["citations"], p["source"]) == ("T", 2020, 5, "consensus")


def test_run_consensus_journals_only_missing_file_warns(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(rs, "TRUSTED_JOURNALS", tmp_path / "missing.md")
    seen = {}
    monkeypatch.setattr(subprocess, "run", lambda cmd, **k: seen.update(cmd=cmd) or Done("[]"))
    assert rs.run_consensus("q", journals_only=True) == []
    assert "--journals-file" not in seen["cmd"]
    assert "[warn] --journals-only ignored:" in capsys.readouterr().err


def test_run_consensus_nonzero_exit(monkeypatch, capsys):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Done(err="boom", rc=2))
    assert rs.run_consensus("q") == []
    assert "[warn] consensus failed: boom" in capsys.readouterr().err


def test_resolve_ssrn_dois_only_touches_ssrn_labelled_with_doi(monkeypatch):
    calls = []
    monkeypatch.setattr(rs, "resolve_doi", lambda d: calls.append(d) or "Real J")
    papers = [
        paper("a", doi="10.1/a", journal="SSRN Electronic Journal"),
        paper("b", doi=None, journal="SSRN Electronic Journal"),
        paper("c", doi="10.1/c", journal="Yale LJ"),
        paper("d", doi="10.1/d", journal="ERN: Corporate Governance"),
    ]
    out = rs.resolve_ssrn_dois(papers)
    assert sorted(calls) == ["10.1/a", "10.1/d"]
    assert [p.get("journal_resolved") for p in out] == ["Real J", None, None, "Real J"]


def test_effective_rate_is_one_per_second():
    assert rs.EFFECTIVE_RPS == 1.0
