"""Contract tests for doc-marks' notebook backends: --lens and --molabel exports onto the one schema.

Run: uv run --with pytest --with pymupdf --with lxml python3 -m pytest tests/doc_marks_notebook_test.py -q

The exports are written by hand in the shape scripts/lib/notebook_marks_export.py writes, so the input
stays visible; one round trip goes helper -> doc-marks -> review-ledger the way a ds review does.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "scripts" / "lib"
DOC_MARKS = LIB / "doc_marks.py"
LEDGER = LIB / "review_ledger.py"
MARKED = ROOT / "tests" / "fixtures" / "doc-marks" / "marked.pdf"
sys.path.insert(0, str(LIB))
import doc_marks  # noqa: E402
import notebook_marks_export as nme  # noqa: E402


def run(*args):
    return subprocess.run([sys.executable, str(DOC_MARKS), *map(str, args)], capture_output=True, text=True, check=False)


def marks(*args):
    p = run(*args)
    return p, (json.loads(p.stdout) if p.stdout.strip() else None)


def write(path: Path, obj) -> Path:
    path.write_text(json.dumps(obj), encoding="utf-8")
    return path


S1 = {"id": "sel-a1", "label": "S1", "note": "why does this line dip in 2009?",
      "target": {"kind": "notebook", "cellIds": ["Hbol"], "documentId": "doc1", "documentPath": "analysis.py"},
      "anchor": {"kind": "rect", "x": 0.25, "y": 0.1, "width": 0.5, "height": 0.4},
      "snapshot": {"status": "available"},
      "description": {"label": "Figure 2: issuance by year", "detail": "line chart"},
      "domHint": {"tag": "svg", "text": "Issuance 2005-2015"}}
S2 = {"id": "sel-b2", "label": "S2", "note": "",
      "target": {"kind": "notebook", "cellIds": ["MJUe", "Hbol"], "documentId": "doc1", "documentPath": "analysis.py"},
      "anchor": {"kind": "point", "x": 0.6, "y": 0.3},
      "snapshot": {"status": "pending"}}
S3 = {"id": "sel-c3", "label": "S3", "note": "use the 2-digit SIC here",
      "target": {"kind": "notebook", "cellIds": ["vblA"], "documentId": "doc1", "documentPath": "analysis.py"},
      "anchor": {"kind": "rect", "x": 0.0, "y": 0.0, "width": 1.0, "height": 0.2},
      "snapshot": {"status": "available"},
      "description": {"label": "Table 1", "detail": "summary statistics"}}


def lens_export(tmp_path: Path, selections, png: str | None = None) -> Path:
    rows = [{**s, "png": png if s["label"] == "S1" else None} for s in selections]
    return write(tmp_path / "lens 20261029.json", {"tool": "marimo-lens", "exported": "2026-10-29T15:00:00+00:00",
                                                   "selections": rows})


ANNOTATIONS = [
    {"index": 2, "example": {"title": "F3 lens finding", "text": "join drops 4% of rows"},
     "_label": "no", "_notes": "this is fine, the drop is the filter", "_timestamp": "2026-10-29T15:00:02.000Z"},
    {"index": 0, "example": {"title": "F1 lens finding", "text": "SE not clustered"},
     "_label": "yes", "_notes": "", "_timestamp": "2026-10-29T15:00:00.000Z"},
    {"index": 1, "example": {"title": "F2 lens finding", "text": "winsorize before logs"},
     "_label": "skip", "_notes": "ask me tomorrow", "_timestamp": "2026-10-29T15:00:01.000Z"},
]


def molabel_export(tmp_path: Path, annotations=ANNOTATIONS, title_key="title", text_key="text") -> Path:
    return write(tmp_path / "findings.json", {"tool": "molabel", "exported": "2026-10-29T15:01:00+00:00",
                                              "title_key": title_key, "text_key": text_key, "annotations": annotations})


# ── lens ──────────────────────────────────────────────────────────────────────

def test_lens_selections_map_onto_the_schema(tmp_path):
    png = tmp_path / "S1.png"
    png.write_bytes(b"\x89PNG\r\n")
    exp = lens_export(tmp_path, [S1, S2, S3], png=str(png))
    p, s = marks("--lens", exp)
    assert p.returncode == 0, p.stderr
    assert s["source"] == "lens" and s["file"] == str(exp) and s["mtime"]
    a, b, c = s["marks"]
    assert [a["id"], b["id"], c["id"]] == ["S1", "S2", "S3"]
    assert a["kind"] == "lens-rect" and b["kind"] == "lens-point"
    assert a["text"] == "why does this line dip in 2009?" and b["text"] == ""
    assert a["quoted"] == "Issuance 2005-2015"          # domHint.text first
    assert c["quoted"] == "summary statistics"          # else description.detail
    assert b["quoted"] == ""
    assert a["where"]["heading"] == "Figure 2: issuance by year" and a["where"]["heading_source"] == "lens-description"
    assert b["where"]["heading"] == "cell MJUe" and b["where"]["heading_source"] == "lens-cell"
    assert a["where"]["rect"] == [0.25, 0.1, 0.5, 0.4]
    assert b["where"]["rect"] == [0.6, 0.3, 0, 0]
    assert a["where"]["page"] is None
    assert a["png"] == str(png) and b["png"] is None
    assert a["resolved"] is False and a["replies"] == [] and a["created"] is None


def test_lens_export_with_no_selections_is_no_marks(tmp_path):
    p, s = marks("--lens", lens_export(tmp_path, []))
    assert p.returncode == 1
    assert "NO MARKS" in p.stderr and s["marks"] == []


# ── molabel ───────────────────────────────────────────────────────────────────

def test_molabel_annotations_map_onto_the_schema_in_index_order(tmp_path):
    exp = molabel_export(tmp_path)
    p, s = marks("--molabel", exp)
    assert p.returncode == 0, p.stderr
    assert s["source"] == "molabel" and s["file"] == str(exp)
    assert [m["id"] for m in s["marks"]] == ["i0", "i1", "i2"]
    i0, i1, i2 = s["marks"]
    assert [i0["kind"], i1["kind"], i2["kind"]] == ["yes", "skip", "no"]
    assert i2["text"] == "this is fine, the drop is the filter" and i0["text"] == ""
    assert i2["quoted"] == "join drops 4% of rows"
    assert i2["where"]["heading"] == "F3 lens finding" and i2["where"]["heading_source"] == "molabel-example"
    assert i2["created"] == "2026-10-29T15:00:02.000Z"
    assert i2["where"]["page"] is None and i2["where"]["rect"] is None and i2["png"] is None


def test_molabel_without_keys_names_examples_by_index(tmp_path):
    p, s = marks("--molabel", molabel_export(tmp_path, title_key=None, text_key=None))
    assert p.returncode == 0, p.stderr
    assert s["marks"][0]["where"]["heading"] == "example 0" and s["marks"][0]["quoted"] == ""


def test_molabel_never_surfaces_rendered_html(tmp_path):
    ann = [{**ANNOTATIONS[0], "example": {**ANNOTATIONS[0]["example"], "_html": "<p>SECRET-HTML</p>"}}]
    p = run("--molabel", molabel_export(tmp_path, annotations=ann))
    assert p.returncode == 0, p.stderr
    assert "SECRET-HTML" not in p.stdout


# ── shared contract ───────────────────────────────────────────────────────────

def test_key_sets_equal_the_pdf_backend(tmp_path):
    _, pdf = marks(MARKED, "--png-dir", tmp_path / "png")
    _, lens = marks("--lens", lens_export(tmp_path, [S1, S2]))
    _, mol = marks("--molabel", molabel_export(tmp_path))
    for s in (lens, mol):
        assert list(s) == list(pdf) == doc_marks.TOP_KEYS
        for m in s["marks"]:
            assert list(m) == doc_marks.MARK_KEYS
            assert list(m["where"]) == doc_marks.WHERE_KEYS


def test_bad_exports_could_not_run(tmp_path):
    (tmp_path / "bad.json").write_text("{not json")
    assert run("--lens", tmp_path / "bad.json").returncode == 2
    assert run("--lens", tmp_path / "missing.json").returncode == 2
    wrong_tool = write(tmp_path / "wrong.json", {"tool": "molabel", "exported": "x", "selections": []})
    assert run("--lens", wrong_tool).returncode == 2
    assert run("--molabel", lens_export(tmp_path, [S1])).returncode == 2
    no_list = write(tmp_path / "nolist.json", {"tool": "molabel", "exported": "x", "title_key": None,
                                               "text_key": None, "annotations": {"0": "yes"}})
    assert run("--molabel", no_list).returncode == 2
    assert run("--lens", lens_export(tmp_path, [S1]), MARKED).returncode == 2


def test_two_sources_at_once_could_not_run(tmp_path):
    lens, mol = lens_export(tmp_path, [S1]), molabel_export(tmp_path)
    assert run("--lens", lens, "--molabel", mol).returncode == 2
    assert run("--lens", lens, "--drive", "1AbCdriveid").returncode == 2
    assert run("--molabel", mol, "--drive", "1AbCdriveid").returncode == 2


BAD_SELECTIONS = {
    "no label or id": {k: v for k, v in S1.items() if k not in ("label", "id")},
    "anchor kind": {**S1, "anchor": {**S1["anchor"], "kind": "lasso"}},
    "anchor not numeric": {**S1, "anchor": {**S1["anchor"], "x": "a"}},
    "rect without width": {**S1, "anchor": {k: v for k, v in S1["anchor"].items() if k != "width"}},
    "note not a string": {**S1, "note": 7},
    "cellIds not a list": {**S1, "target": {**S1["target"], "cellIds": "Hbol"}},
    "description not an object": {**S1, "description": "Figure 2"},
    "png not a path": {**S1, "png": 3},
}


@pytest.mark.parametrize("case", sorted(BAD_SELECTIONS))
def test_a_malformed_lens_selection_could_not_run(tmp_path, case):
    exp = write(tmp_path / "lens.json", {"tool": "marimo-lens", "exported": "x", "selections": [S3, BAD_SELECTIONS[case]]})
    p = run("--lens", exp)
    assert p.returncode == 2, (case, p.stdout, p.stderr)


BAD_ANNOTATIONS = {
    "index not an int": {**ANNOTATIONS[0], "index": "2"},
    "index a bool": {**ANNOTATIONS[0], "index": True},
    "example not an object": {**ANNOTATIONS[0], "example": "F3"},
    "empty label": {**ANNOTATIONS[0], "_label": ""},
    "notes not a string": {**ANNOTATIONS[0], "_notes": ["x"]},
}


@pytest.mark.parametrize("case", sorted(BAD_ANNOTATIONS))
def test_a_malformed_molabel_annotation_could_not_run(tmp_path, case):
    p = run("--molabel", molabel_export(tmp_path, annotations=[ANNOTATIONS[1], BAD_ANNOTATIONS[case]]))
    assert p.returncode == 2, (case, p.stdout, p.stderr)


def test_a_non_string_title_key_could_not_run(tmp_path):
    assert run("--molabel", molabel_export(tmp_path, title_key=3)).returncode == 2


# ── round trip ────────────────────────────────────────────────────────────────

class FakeContext:
    def __init__(self, selections, images):
        self.references = {"selections": selections}
        self.images = images


def test_round_trip_helper_doc_marks_review_ledger(tmp_path):
    exp = tmp_path / "Lens review 20261029a.json"
    nme.export_lens(FakeContext([S1, S3], {"sel-a1": b"\x89PNG\r\n\x1a\n"}), exp)
    p = run("--lens", exp)
    assert p.returncode == 0, p.stderr
    dm = write(tmp_path / "Lens review 20261029a.marks.json", json.loads(p.stdout))
    q = subprocess.run([sys.executable, str(LEDGER), "ledger", str(dm), "--json"], capture_output=True, text=True,
                       check=False)
    assert q.returncode == 0, q.stderr
    rows = json.loads(q.stdout)["marks"]
    assert [r["id"] for r in rows] == ["Lens review 20261029a.marks#S1", "Lens review 20261029a.marks#S3"]
    assert rows[0]["typed"] == "why does this line dip in 2009?" and rows[0]["source"] == "lens"
    assert Path(rows[0]["png"]).is_file()
