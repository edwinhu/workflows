# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "lxml"]
# ///
"""Contract tests for provenance.py: custom-properties stamping on a hand-built docx."""

import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import provenance as pv

CT = ('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="xml" ContentType="application/xml"/></Types>')
RELS = ('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="x/officeDocument" Target="word/document.xml"/></Relationships>')


def make_docx(path, extra=None):
    parts = {"word/document.xml": "<doc/>", "_rels/.rels": RELS, "[Content_Types].xml": CT}
    parts.update(extra or {})
    with zipfile.ZipFile(path, "w") as z:
        for n in ("word/document.xml", "_rels/.rels", "[Content_Types].xml"):
            z.writestr(n, parts[n])
        for n, v in parts.items():
            if n not in ("word/document.xml", "_rels/.rels", "[Content_Types].xml"):
                z.writestr(n, v)
    return path


def test_read_without_custom_part_is_empty(tmp_path):
    assert pv.read(make_docx(tmp_path / "a.docx")) == {}


def test_stamp_then_read_roundtrip(tmp_path):
    d = make_docx(tmp_path / "a.docx")
    pv.stamp(d, {"SourcePath": "body.typ", "StampVersion": "1"})
    assert pv.read(d) == {"SourcePath": "body.typ", "StampVersion": "1"}


def test_stamp_wires_part_content_type_and_relationship(tmp_path):
    d = make_docx(tmp_path / "a.docx")
    pv.stamp(d, {"K": "v"})
    with zipfile.ZipFile(d) as z:
        names = z.namelist()
        assert names[0] == "[Content_Types].xml"
        assert "docProps/custom.xml" in names
        assert b'PartName="/docProps/custom.xml"' in z.read("[Content_Types].xml")
        rels = z.read("_rels/.rels")
        assert b'Target="docProps/custom.xml"' in rels
        assert b'Id="rId2"' in rels  # rId1 taken
        assert z.read("word/document.xml") == b"<doc/>"


def test_restamp_does_not_duplicate_wiring_and_overwrites_value(tmp_path):
    d = make_docx(tmp_path / "a.docx")
    pv.stamp(d, {"K": "one", "J": "keep"})
    pv.stamp(d, {"K": "two"})
    assert pv.read(d) == {"K": "two", "J": "keep"}
    with zipfile.ZipFile(d) as z:
        assert z.read("[Content_Types].xml").count(b"custom.xml") == 1
        assert z.read("_rels/.rels").count(b"custom-properties") == 1


def test_pids_are_renumbered_from_two_over_existing_properties():
    existing = (b'<Properties xmlns="%s" xmlns:vt="%s"><property fmtid="{X}" pid="7" name="Old">'
                b'<vt:lpwstr>o</vt:lpwstr></property></Properties>' % (pv.CP.encode(), pv.VT.encode()))
    out = pv._build_custom_xml(existing, {"New": "n"})
    pids = [p.get("pid") for p in pv.etree.fromstring(out)]
    assert pids == ["2", "3"]


def test_read_surfaces_non_lpwstr_types():
    xml = (b'<Properties xmlns="%s" xmlns:vt="%s"><property pid="2" name="N"><vt:i4>42</vt:i4></property>'
           b'<property pid="3"><vt:lpwstr>nameless</vt:lpwstr></property></Properties>'
           % (pv.CP.encode(), pv.VT.encode()))
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("docProps/custom.xml", xml)
    buf.seek(0)
    assert pv.read(buf) == {"N": "42"}


def test_stamp_output_leaves_original_untouched(tmp_path):
    d = make_docx(tmp_path / "a.docx")
    out = pv.stamp(d, {"K": "v"}, tmp_path / "b.docx")
    assert out == tmp_path / "b.docx"
    assert pv.read(d) == {} and pv.read(out) == {"K": "v"}


def test_source_properties_hash_path_and_version(tmp_path):
    src = tmp_path / "body.typ"
    src.write_bytes(b"hello\n")
    props = pv.source_properties(src)
    assert props["SourceSHA256"] == hashlib.sha256(b"hello\n").hexdigest()
    assert props["SourcePath"] == str(src)
    assert props["StampVersion"] == "1"
    assert set(props) == {"SourceSHA256", "SourcePath", "SourceGitSHA", "StampVersion"}


def test_git_sha_is_empty_when_git_missing(monkeypatch, tmp_path):
    def nogit(*a, **k):
        raise FileNotFoundError("git")
    monkeypatch.setattr(pv.subprocess, "run", nogit)
    assert pv.git_sha(tmp_path / "x") == ""


@pytest.mark.skipif(not shutil.which("git"), reason="git required")
def test_git_sha_is_blob_sha_of_content(tmp_path):
    src = tmp_path / "body.typ"
    src.write_bytes(b"hello\n")
    # git's blob id for "hello\n"
    assert pv.git_sha(src) == "ce013625030ba8dba906f756967f9e9ca394464a"


def test_cli_read_prints_sorted_json(tmp_path, capsys):
    d = make_docx(tmp_path / "a.docx")
    pv.stamp(d, {"B": "2", "A": "1"})
    assert pv.main(["read", str(d)]) == 0
    assert json.loads(capsys.readouterr().out) == {"A": "1", "B": "2"}


def test_cli_stamp_set_splits_on_first_equals(tmp_path, capsys):
    d = make_docx(tmp_path / "a.docx")
    assert pv.main(["stamp", str(d), "--set", "Url=a=b"]) == 0
    assert json.loads(capsys.readouterr().out)["properties"] == {"Url": "a=b"}
    assert pv.read(d) == {"Url": "a=b"}


def test_cli_stamp_bad_set_exits_2(tmp_path, capsys):
    d = make_docx(tmp_path / "a.docx")
    assert pv.main(["stamp", str(d), "--set", "novalue"]) == 2
    assert "--set expects KEY=VALUE, got 'novalue'" in capsys.readouterr().err
    assert pv.read(d) == {}


def test_cli_stamp_nothing_exits_2(tmp_path, capsys):
    d = make_docx(tmp_path / "a.docx")
    assert pv.main(["stamp", str(d)]) == 2
    assert "nothing to stamp; pass --source and/or --set" in capsys.readouterr().err


def test_read_non_zip_raises(tmp_path):
    bad = tmp_path / "bad.docx"
    bad.write_text("not a zip")
    with pytest.raises(zipfile.BadZipFile):
        pv.read(bad)
