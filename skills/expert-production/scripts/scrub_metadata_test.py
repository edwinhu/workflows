"""Contract tests for scrub_metadata.py. The PDF test needs pikepdf and skips without it."""
import struct
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent / "scrub_metadata.py"

CORE = ('<cp:coreProperties><dc:creator>Jane</dc:creator>'
        '<cp:lastModifiedBy>Bob</cp:lastModifiedBy>'
        '<dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created></cp:coreProperties>')
APP = '<Properties><Application>Word</Application><Pages>3</Pages><Company>Acme</Company></Properties>'


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)


def make_docx(path, created="2024-05-01T00:00:00Z"):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("docProps/core.xml", CORE.format(created=created))
        z.writestr("docProps/app.xml", APP)
        z.writestr("word/document.xml", "<w:document/>")
    return str(path)


def read(path, name):
    with zipfile.ZipFile(path) as z:
        return z.read(name).decode()


def test_no_args_prints_usage_and_exits_2():
    p = run()
    assert p.returncode == 2
    assert "Strip identifying metadata" in p.stdout


def test_unhandled_type(tmp_path):
    f = tmp_path / "x.txt"
    f.write_text("hi")
    p = run(str(f))
    assert p.returncode == 0
    assert p.stdout == f"{f}: unhandled type\n"


def test_docx_strips_identity_keeps_dates_and_stats(tmp_path):
    f = make_docx(tmp_path / "a.docx")
    p = run(f)
    assert p.returncode == 0
    assert p.stdout.splitlines()[0] == f"{f}: stripped 4 field(s)"
    for line in ("docProps/core.xml dc:creator = Jane", "docProps/core.xml cp:lastModifiedBy = Bob",
                 "docProps/app.xml Application = Word", "docProps/app.xml Company = Acme"):
        assert line in p.stdout
    core, app = read(f, "docProps/core.xml"), read(f, "docProps/app.xml")
    assert "<dc:creator></dc:creator>" in core and "Jane" not in core and "Bob" not in core
    assert "2024-05-01T00:00:00Z" in core
    assert "<Pages>3</Pages>" in app and "Word" not in app and "Acme" not in app
    assert read(f, "word/document.xml") == "<w:document/>"


def test_docx_dry_run_reports_but_does_not_modify(tmp_path):
    f = make_docx(tmp_path / "a.docx")
    before = Path(f).read_bytes()
    p = run("--dry-run", f)
    assert p.stdout.splitlines()[0] == f"{f}: would strip 4 field(s)"
    assert Path(f).read_bytes() == before


def test_docx_second_run_finds_nothing(tmp_path):
    f = make_docx(tmp_path / "a.docx")
    run(f)
    assert run(f).stdout == f"{f}: stripped 0 field(s)\n"


def test_docx_bogus_date_is_reported_not_stripped(tmp_path):
    f = make_docx(tmp_path / "a.docx", created="2013-12-23T00:00:00Z")
    p = run(f)
    assert "!! docProps/core.xml dcterms:created = 2013-12-23T00:00:00Z  (not a real date" in p.stdout
    assert "2013-12-23T00:00:00Z" in read(f, "docProps/core.xml")


def png(*chunks):
    out = b"\x89PNG\r\n\x1a\n"
    for typ, data in chunks:
        out += struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data))
    return out


def test_png_drops_text_chunks_keeps_time(tmp_path):
    f = tmp_path / "a.png"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    f.write_bytes(png((b"IHDR", ihdr), (b"tEXt", b"Author\x00Jane"),
                      (b"tIME", b"\x07\xe8\x05\x01\x00\x00\x00"), (b"IEND", b"")))
    p = run(str(f))
    assert p.stdout.splitlines() == [f"{f}: stripped 1 field(s)", "    PNG tEXt chunk (11 bytes)"]
    data = f.read_bytes()
    assert b"tEXt" not in data and b"Jane" not in data
    assert b"tIME" in data and data.endswith(b"IEND" + struct.pack(">I", zlib.crc32(b"IEND")))


def test_png_dry_run_leaves_file(tmp_path):
    f = tmp_path / "a.png"
    f.write_bytes(png((b"IHDR", b"\0" * 13), (b"iTXt", b"x"), (b"IEND", b"")))
    before = f.read_bytes()
    assert "would strip 1 field(s)" in run("--dry-run", str(f)).stdout
    assert f.read_bytes() == before


def test_pdf_strips_info_keeps_dates(tmp_path):
    pikepdf = pytest.importorskip("pikepdf")
    f = tmp_path / "a.pdf"
    with pikepdf.new() as pdf:
        pdf.add_blank_page()
        pdf.docinfo["/Author"] = "Jane"
        pdf.docinfo["/CreationDate"] = "D:20240501000000Z"
        pdf.save(f)
    p = run(str(f))
    assert p.stdout.splitlines()[0] == f"{f}: stripped 1 field(s)"
    assert "Info /Author = Jane" in p.stdout
    with pikepdf.open(f) as pdf:
        assert "/Author" not in pdf.docinfo
        assert str(pdf.docinfo["/CreationDate"]) == "D:20240501000000Z"
