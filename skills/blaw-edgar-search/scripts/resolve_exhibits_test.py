# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest", "psycopg[binary]>=3.1", "polars>=1.0", "loguru>=0.7", "beautifulsoup4>=4.12"]
# ///
"""Contract tests for resolve_exhibits.py pure functions (no WRDS, no rclone)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import resolve_exhibits as rx


def hit(title="8-K; Form 8-K; EX-99: EX-99.1", **over):
    r = {
        "id": "b1",
        "title": title,
        "subtitles": [
            {"key": "normalized_form_type", "value": "Form 8-K"},
            {"key": "edgar_file_number", "value": "001-12345"},
            {"key": "filed_date", "value": "Mar 05, 2021"},
            {"key": "period_date", "value": "Mar 01, 2021"},
        ],
        "metadata": [{"key": "filer", "value": ["Acme Corp", "Beta LLC"]}],
        "extracts": ["<b>Hello</b>   <script>x()</script>world"],
    }
    r.update(over)
    return r


def test_plain_strips_tags_scripts_and_collapses_space():
    assert rx.plain("<p>a  <b>b</b></p><style>p{}</style>\n<script>x</script> c") == "a b c"


def test_alnum_and_iso():
    assert rx.alnum("Ab-1 !c") == "ab1c"
    assert rx.iso("Mar 05, 2021") == "2021-03-05"
    assert rx.iso(None) is None
    with pytest.raises(ValueError):
        rx.iso("2021-03-05")


def test_flatten_one_fields():
    f = rx.flatten_one(hit())
    assert f["exhibit"] == "EX-99.1"  # specific beats bare EX-99
    assert f["type_keys"] == ["EX-99", "EX-99.1"]
    assert f["form"] == "8-K" and f["blaw_form"] == "Form 8-K" and f["title_form"] == "8-K"
    assert f["filer"] == "Acme Corp; Beta LLC"
    assert f["filed_date"] == "2021-03-05" and f["period_date"] == "2021-03-01"
    assert f["exhibit_desc"] == "EX-99.1"
    assert f["extracts"] == ["Hello world"]


def test_flatten_one_rule_425_label_and_reg_a():
    r = hit(title="x; Form 425; EX1A-6: EX1A-6 MATERIAL")
    r["subtitles"][0]["value"] = "Rule 425 Communications"
    f = rx.flatten_one(r)
    assert f["form"] == "425" and f["exhibit"] == "EX1A-6"


def test_flatten_one_no_exhibit_token_raises():
    with pytest.raises(ValueError, match="no exhibit token in title 'plain title'"):
        rx.flatten_one(hit(title="plain title"))


def test_flatten_one_desc_drops_ellipsis():
    f = rx.flatten_one(hit(title="8-K; Form 8-K; EX-10: EX-10.23 Agreement..."))
    assert f["exhibit_desc"] == "EX-10.23 AGREEMENT"


def test_type_match_exact_or_prefix_word():
    assert rx.type_match("ex-99.1", ["EX-99.1"])
    assert rx.type_match("EX-99.1 extra", ["EX-99.1"])
    assert not rx.type_match("EX-99.10", ["EX-99.1"])


def test_extract_probes_middle_40_and_skips_short():
    assert rx.extract_probes(["short"]) == []
    s = "a" * 30 + "b" * 30
    p = rx.extract_probes([s])[0]
    assert len(p) == 40 and p == "a" * 20 + "b" * 20


def test_narrow_first_unique_wins_and_narrows():
    items = [1, 2, 3, 4]
    assert rx.narrow(items, [("odd", lambda x: x % 2), ("big", lambda x: x > 2)]) == (3, "big")
    assert rx.narrow(items, [("eq2", lambda x: x == 2)]) == (2, "eq2")
    assert rx.narrow(items, [("odd", lambda x: x % 2)]) == (None, None)
    assert rx.narrow(items, [("none", lambda x: False)]) == (None, None)


def test_phrase_regex_hyphen_whitespace_and_boundaries():
    rg = rx.phrase_regex("change-in control")
    assert rg.search("A Change - in   Control event")
    assert not rg.search("exchange-in control")
    assert not rg.search("change-in controlled")


def test_slug():
    assert rx.slug("Change-in Control!") == "change_in_control"


SGML = (
    "<SEC-DOCUMENT>\n<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<FILENAME>a.htm\n<TEXT>\nmain\n</TEXT>\n</DOCUMENT>\n"
    "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<FILENAME>ex.htm\n<DESCRIPTION>Press release\n"
    "<TEXT>\n..dotted line\n..x\n</TEXT>\n</DOCUMENT>\n"
)


def test_documents_parses_headers_and_undoubles_dots(tmp_path):
    p = tmp_path / "s.txt"
    p.write_text(SGML)
    docs = rx.documents(str(p))
    assert [d["type"] for d in docs] == ["8-K", "EX-99.1"]
    assert docs[1]["filename"] == "ex.htm" and docs[1]["description"] == "Press release"
    assert docs[1]["sequence"] == "2"
    assert docs[1]["body"].split() == [".dotted", "line", ".x"]


def test_documents_without_blocks_raises(tmp_path):
    p = tmp_path / "s.txt"
    p.write_text("nothing here")
    with pytest.raises(ValueError, match="no <DOCUMENT> blocks in"):
        rx.documents(str(p))


def test_index_file_matches_type_and_extract(tmp_path):
    p = tmp_path / "s.txt"
    p.write_text(SGML)
    probe = rx.alnum("dotted line")
    (res,) = rx.index_file((str(p), [("b1", "0001-21-000001", ["EX-99", "EX-99.1"], [probe], True)]))
    assert res["n_docs"] == 2
    assert [m["filename"] for m in res["matched"]] == ["ex.htm"]
    assert res["matched"][0]["extract_match"] is True


def test_index_file_single_match_skips_extract_check(tmp_path):
    p = tmp_path / "s.txt"
    p.write_text(SGML)
    (res,) = rx.index_file((str(p), [("b1", "acc", ["EX-99.1"], ["zzz"], False)]))
    assert res["matched"][0]["extract_match"] is None


def test_extract_file_writes_text_and_verifies_phrases(tmp_path):
    p = tmp_path / "s.txt"
    p.write_text(SGML)
    out = tmp_path / "ex"
    out.mkdir()
    (r,) = rx.extract_file((str(p), [("b1", "ACC", "ex.htm", [])], ["dotted line", "absent"], str(out)))
    assert (out / "ACC_ex.htm.txt").read_text() == ".dotted line .x"
    assert r["chars"] == len(".dotted line .x")
    assert r["phrase_verification"] == {"dotted_line": True, "absent": False, "all_phrases": False}
    assert r["extract_found"] is None


def test_fetch_all_cached_makes_no_calls(tmp_path):
    cache = tmp_path / "c"
    (cache / "d").mkdir(parents=True)
    (cache / "d/f.txt").write_text("x")
    st = rx.fetch(["d/f.txt", "d/f.txt"], cache, tmp_path, 10, "/s")
    assert st["listed"] == 1 and st["cached"] == 1 and st["fetched"] == 0 and st["route"] == "none"
    assert not (tmp_path / "rclone_files.txt").exists()
