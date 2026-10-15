# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for bibman.py: pure bib parsing, PDF mapping, field rewriting, audit/link CLI.

doi, fedreg and reconcile's network paths (Crossref, govinfo, Paperpile CLI) are not exercised.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bibman as b

BIB = """\
@article{rock2008,
  author = {Rock, Edward B. and Kahan, Marcel},
  title = {Hanging Chads: A Study},
  year = {2008},
  journal = {Rev. Fin. Stud.},
  doi = {10.1/x},
  pages = {446}
}

@misc{release2020,
  title = {SEC Release},
  year = {2020},
  file = {paper/references/sources/pdf/release2020.pdf}
}
"""


def test_fields_lowercases_names_collapses_whitespace_and_keeps_last_field():
    ents = b.entries(BIB)
    f = ents[0]["f"]
    assert f["author"] == "Rock, Edward B. and Kahan, Marcel"
    assert f["pages"] == "446"  # last field has no trailing newline
    assert ents[1]["f"]["file"].endswith("release2020.pdf")
    assert b.fields("  title = {A\n     Long   Title},\n")["title"] == "A Long Title"


def test_entries_keys_types_and_spans():
    ents = b.entries(BIB)
    assert [(e["key"], e["type"]) for e in ents] == [("rock2008", "article"), ("release2020", "misc")]
    s, e = ents[0]["span"]
    assert BIB[s:e].startswith("@article{rock2008") and BIB[s:e].endswith("}")


def test_entries_empty_text():
    assert b.entries("") == []


def test_surname_forms():
    assert b.surname("Rock, Edward B. and Kahan, Marcel") == "rock"
    assert b.surname("Edward B. Rock and Marcel Kahan") == "rock"
    assert b.surname("") == "" and b.surname("   ") == ""


def test_norm_title_flattens_punctuation_and_ampersand():
    assert b.norm_title("Hanging Chads: A Study") == "hanging chads a study"
    assert b.norm_title("Hanging Chads - A Study") == "hanging chads a study"
    assert b.norm_title("Law & Economics") == "law and economics"


def test_parse_stem_paperpile_shapes():
    assert b.parse_stem("Barzuza et al. 2020 - Big Three") == ("barzuza", "2020", "Big Three")
    assert b.parse_stem("Rock - Institutional Investors") == ("rock", None, "Institutional Investors")
    assert b.parse_stem("rock2008") is None


def make_tree(tmp_path):
    pdf_dir = tmp_path / "pdf"
    pdf_dir.mkdir()
    return pdf_dir


def test_build_mapping_stem_equals_citekey_and_fuzzy_author_title(tmp_path):
    pdf_dir = make_tree(tmp_path)
    (pdf_dir / "rock2008.pdf").write_bytes(b"x")
    (pdf_dir / "Kahan 2019 - Hanging Chads A Study.pdf").write_bytes(b"x")
    (pdf_dir / "Nobody 2001 - Unrelated.pdf").write_bytes(b"x")
    (pdf_dir / "weird.pdf").write_bytes(b"x")
    ents = b.entries(BIB + """
@article{kahan2019,
  author = {Kahan, Marcel},
  title = {Hanging Chads: A Study},
  year = {2019}
}
""")
    mapping, why = b.build_mapping(ents, b.all_pdfs(pdf_dir), pdf_dir)
    assert mapping["rock2008"][1:] == ("stem==citekey", 1.0)
    assert mapping["kahan2019"][1].startswith("author+title 1.00")
    reasons = {p.name: r for p, r in why}
    assert reasons["Nobody 2001 - Unrelated.pdf"] == 'no bib entry with first author "nobody"'
    assert reasons["weird.pdf"] == "filename is not `Author Year - Title`"


def test_build_mapping_different_year_needs_near_identical_title(tmp_path):
    pdf_dir = make_tree(tmp_path)
    (pdf_dir / "Rock 2010 - Hanging Chads").with_suffix(".pdf").write_bytes(b"x")
    ents = b.entries(BIB)
    mapping, why = b.build_mapping(ents, b.all_pdfs(pdf_dir), pdf_dir)
    # same title modulo ' A Study', year differs: below 0.95
    assert "rock2008" not in mapping
    assert "below 0.95" in why[0][1] and "pdf year 2010, bib year 2008" in why[0][1]


def test_append_field_is_additive_and_adds_comma():
    chunk = b.entries(BIB)[0]
    out = b.append_field(BIB[slice(*chunk["span"])], "file", "a/b.pdf")
    assert out.endswith("  pages = {446},\n  file = {a/b.pdf}\n}")
    assert out.startswith("@article{rock2008,\n  author = {Rock")


def test_replace_and_set_field():
    chunk = "@article{k,\n  doi = {old},\n  year = {1}\n}"
    assert b.replace_field(chunk, "doi", "new") == "@article{k,\n  doi = {new},\n  year = {1}\n}"
    assert b.replace_field(chunk, "pages", "9") == chunk
    assert b.set_field(chunk, "pages", "9").endswith("year = {1},\n  pages = {9}\n}")
    assert "doi = {new}" in b.set_field(chunk, "doi", "new")


def test_insert_file_touches_only_one_entry():
    ents = b.entries(BIB)
    out = b.insert_file(BIB, ents[0], "p/rock.pdf")
    assert out.count("file = {") == 2 and "p/rock.pdf" in out
    assert out.endswith(BIB[ents[1]["span"][0]:])


def test_page_helpers():
    assert b.page_range("446--486") == (446, 486) and b.page_range("446-486") == (446, 486)
    assert b.page_range("446-446") is None and b.page_range("446-86") is None
    assert b.page_range("446") is None and b.page_range(None) is None
    assert b.start_page("446-486") == 446 and b.start_page("n/a") is None
    assert b.end_page("10--20") == 20 and b.end_page("10") is None


def test_has_masthead_ignores_zeroed_volume():
    assert b.has_masthead("Journal of Finance Vol. 77")
    assert b.has_masthead("v 12 n 3 2021")
    assert not b.has_masthead("v 00 n 0 2021")
    assert not b.has_masthead("no designation here")


def test_range_blocked_reasons():
    def ent(t, pages):
        return {"type": t, "f": {"pages": pages} if pages is not None else {}}
    assert b.range_blocked(ent("book", "5")) == "@book, not @article"
    assert b.range_blocked(ent("article", "103810")) == "Elsevier article number, not a page"
    assert b.range_blocked(ent("article", None)) == "entry has no pages field to extend"
    assert b.range_blocked(ent("article", "66-67")) == "pages is already a range or a pincite"
    assert b.range_blocked(ent("article", "446")) is None


def test_range_from_matches_start_and_rejects_others():
    ent = {"type": "article", "f": {"pages": "446"}}
    assert b.range_from(ent, {"page": "446-486"}) == ("446--486", "")
    assert b.range_from(ent, {"page": "450-486"}) == (None, "Crossref range starts at 450, bib says 446")
    assert b.range_from(ent, {}) == (None, "Crossref page '-' is not a range")


def test_caps_and_initials_detectors():
    assert b.caps_only("VICENTE CUÑAT and OTHER PERSON")
    assert not b.caps_only("Vicente Cuñat")
    assert not b.caps_only("")
    assert b.initials_only("J Fisch and A. Smith")
    assert not b.initials_only("Jill E. Fisch")
    assert not b.initials_only("")


def test_pp_fields_and_cr_fields_drop_blanks():
    rec = {"author": [{"first": "Jill E.", "last": "Fisch"}, {"first": "", "last": "Rock"}],
           "title": " T ", "published": {"year": 2019}, "doi": "10.1/y"}
    assert b.pp_fields(rec) == {"author": "Jill E. Fisch and Rock", "title": "T", "year": "2019", "doi": "10.1/y"}
    item = {"author": [{"given": "Ann", "family": "Lee"}], "title": ["Hi"],
            "short-container-title": [], "container-title": ["Full Journal"],
            "issued": {"date-parts": [[2021, 3]]}, "page": "1-9", "DOI": "10.2/z"}
    assert b.cr_fields(item) == {"author": "Ann Lee", "title": "Hi", "journal": "Full Journal",
                                 "pages": "1-9", "year": "2021", "doi": "10.2/z"}
    item["short-container-title"] = ["J. Full"]
    assert b.cr_fields(item)["journal"] == "J. Full"


def test_pp_match_confident_ambiguous_and_none():
    ent = {"type": "article", "f": {"title": "Hanging Chads", "author": "Rock, Edward", "year": "2008"}}
    rec = lambda i, t, y=2008, last="Rock": {"_id": i, "title": t, "citekey": f"ck{i}",
                                             "author": [{"first": "E", "last": last}],
                                             "published": {"year": y}}
    by_id = {"1": rec("1", "Hanging Chads"), "2": rec("2", "Hanging Chads!", last="Other")}
    got, score, note = b.pp_match(ent, [{"_id": "1"}, {"_id": "2"}], by_id)
    assert got is by_id["1"] and score == 1.0 and note == "ck1 title 1.00 (>= 0.90)"

    by_id["3"] = rec("3", "Hanging Chads")
    got, _s, note = b.pp_match(ent, [{"_id": "1"}, {"_id": "3"}], by_id)
    assert got is None and note.startswith("AMBIGUOUS: ck1 1.00 vs ck3 1.00")

    got, _s, note = b.pp_match(ent, [{"_id": "2"}], by_id)
    assert got is None and note.startswith("no confident match")

    assert b.pp_match({"type": "misc", "f": {}}, [], {}) == (None, 0.0, "entry has no title to match on")


def test_pp_match_year_two_apart_is_rejected():
    ent = {"type": "article", "f": {"title": "Hanging Chads", "author": "Rock, E", "year": "2008"}}
    rec = {"_id": "1", "title": "Hanging Chads", "author": [{"first": "E", "last": "Rock"}],
           "published": {"year": 2010}}
    assert b.pp_match(ent, [{"_id": "1"}], {"1": rec})[0] is None


def test_field_blocked_rules():
    art = {"type": "article", "f": {"journal": "Rev. Fin. Stud.", "pages": "446"}}
    misc = {"type": "misc", "f": {}}
    assert b.field_blocked(art, "file", "", "x") == "file belongs to `link`, not to reconcile"
    assert b.field_blocked(misc, "journal", "", "J") == "@misc may not be given a journal"
    assert b.field_blocked(art, "title", "a", "") == "source has no value"
    assert b.field_blocked(art, "doi", "", "10.2139/ssrn.1", {"doi": "10.2139/ssrn.1"}) == (
        "source record is the SSRN preprint; the entry already names Rev. Fin. Stud.")
    assert b.field_blocked(art, "author", "Jill E. Fisch", "J Fisch") == "source gives initials only"
    assert b.field_blocked(art, "author", "Jill Fisch", "JILL FISCH") == "source gives the name in full caps"
    assert b.field_blocked(art, "pages", "103810", "1-9") == "Elsevier article number, not a page"
    assert b.field_blocked(art, "pages", "66-67", "1-9") == "pages holds a Bluebook pincite, not an article span"
    assert b.field_blocked(art, "pages", "446", "450-486") == "source range starts at 450, bib says 446"
    assert b.field_blocked(art, "pages", "446", "486") == "source pages '486' is not a range"
    assert b.field_blocked(art, "pages", "446", "446-486") is None
    assert b.field_blocked(art, "title", "old", "new") is None


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "paper/references/sources/pdf").mkdir(parents=True)
    (tmp_path / "paper/references/sources.bib").write_text(BIB)
    return tmp_path


def run(monkeypatch, repo, *argv):
    monkeypatch.setattr(sys, "argv", ["bibman.py", *argv, "--root", str(repo)])
    return b.main()


def test_audit_counts_missing_files_and_unclaimed_pdfs(monkeypatch, repo, capsys):
    (repo / "paper/references/sources/pdf/stray.pdf").write_bytes(b"x")
    assert run(monkeypatch, repo, "audit") == 0
    out = capsys.readouterr().out
    assert "entries  2" in out
    assert "  with file = {...}   1" in out and "  without file         1" in out
    assert "  file missing on disk 1" in out  # release2020.pdf not on disk
    assert "release2020" in out and "FILE MISSING ON DISK" in out
    assert "  unclaimed            1" in out and "  stray.pdf" in out
    assert "  rock2008" in out  # the one entry lacking a file


def test_link_dry_run_writes_nothing_then_real_run_adds_file_field(monkeypatch, repo, capsys):
    pdf = repo / "paper/references/sources/pdf/rock2008.pdf"
    pdf.write_bytes(b"x")
    bib = repo / "paper/references/sources.bib"
    assert run(monkeypatch, repo, "link", "--dry-run") == 0
    assert bib.read_text() == BIB and "--dry-run: nothing written" in capsys.readouterr().out
    assert run(monkeypatch, repo, "link", "--backup") == 0
    assert "wrote 1 file fields" in capsys.readouterr().out
    new = bib.read_text()
    assert "file = {paper/references/sources/pdf/rock2008.pdf}" in new
    assert Path(str(bib) + ".bak").read_text() == BIB
    assert run(monkeypatch, repo, "link") == 0
    assert "nothing to write" in capsys.readouterr().out


def test_missing_bib_and_pdf_dir_exit_messages(monkeypatch, tmp_path):
    with pytest.raises(SystemExit, match="no bibliography at .*sources.bib \\(pass --bib\\)"):
        run(monkeypatch, tmp_path, "audit")
    (tmp_path / "paper/references").mkdir(parents=True)
    (tmp_path / "paper/references/sources.bib").write_text(BIB)
    with pytest.raises(SystemExit, match="no PDF directory at .*pdf \\(pass --pdf-dir\\)"):
        run(monkeypatch, tmp_path, "audit")


def test_unknown_reconcile_field_exits(monkeypatch, repo):
    with pytest.raises(SystemExit, match="--fields: not reconcilable: file"):
        run(monkeypatch, repo, "audit", "--fields", "file,doi")
