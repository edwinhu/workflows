"""Contract tests for scripts/lib/notebook_marks_export.py: Lens and molabel marks out of a live kernel.

Run: uv run --with pytest --with pymupdf python3 -m pytest tests/notebook_marks_export_test.py -q

The helper runs inside the notebook's own environment, so it is driven here with fakes of the packages'
public API as read from their source (marimo-lens LensContext.references/.images, molabel
SimpleLabel.get_annotations()), not with the packages themselves.
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "scripts" / "lib" / "notebook_marks_export.py"
sys.path.insert(0, str(MODULE.parent))
import notebook_marks_export as nme  # noqa: E402


def png_bytes() -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
    pix.clear_with(200)
    return pix.tobytes("png")


S1 = {"id": "sel-a1", "label": "S1", "note": "why does this line dip in 2009?",
      "target": {"kind": "notebook", "cellIds": ["Hbol"], "documentId": "doc1", "documentPath": "analysis.py"},
      "cells": [{"id": "Hbol", "status": "available", "codeHash": "abc"}],
      "anchor": {"kind": "rect", "x": 0.25, "y": 0.1, "width": 0.5, "height": 0.4},
      "snapshot": {"status": "available"},
      "description": {"label": "Figure 2: issuance by year", "detail": "line chart"},
      "domHint": {"tag": "svg", "text": "Issuance 2005-2015"}}
S2 = {"id": "sel-b2", "label": "S2", "note": "",
      "target": {"kind": "notebook", "cellIds": ["MJUe"], "documentId": "doc1", "documentPath": "analysis.py"},
      "cells": [{"id": "MJUe", "status": "available", "codeHash": "def"}],
      "anchor": {"kind": "point", "x": 0.6, "y": 0.3},
      "snapshot": {"status": "pending"}}


class FakeContext:
    def __init__(self, selections, images):
        self.references = {"revision": 3, "currentSelectionId": selections[0]["id"] if selections else None,
                           "selections": selections}
        self.images = images


class FakeLens:
    def __init__(self, ctx):
        self._ctx = ctx

    def context(self):
        return self._ctx


class FakeLabel:
    def __init__(self, annotations):
        self._annotations = annotations

    def get_annotations(self):
        return self._annotations


ANNOTATIONS = [
    {"index": 2, "example": {"title": "F3 lens finding", "text": "join drops 4% of rows", "_html": "<p>F3</p>"},
     "_label": "no", "_notes": "this is fine, the drop is the filter", "_timestamp": "2026-10-29T15:00:02.000Z"},
    {"index": 0, "example": {"title": "F1 lens finding", "text": "SE not clustered", "_html": "<p>F1</p>"},
     "_label": "yes", "_notes": "", "_timestamp": "2026-10-29T15:00:00.000Z"},
]


def test_export_lens_writes_selections_verbatim_and_their_png(tmp_path):
    out = tmp_path / "exports" / "lens 20261029.json"
    ret = nme.export_lens(FakeLens(FakeContext([S1, S2], {"sel-a1": png_bytes()})), out)
    assert Path(ret) == out
    s = json.loads(out.read_text(encoding="utf-8"))
    assert s["tool"] == "marimo-lens" and isinstance(s["exported"], str) and s["exported"]
    a, b = s["selections"]
    assert {k: v for k, v in a.items() if k != "png"} == S1
    assert {k: v for k, v in b.items() if k != "png"} == S2
    png = Path(a["png"])
    assert png == tmp_path / "exports" / "lens 20261029-png" / "S1.png"
    assert png.read_bytes() == png_bytes()
    assert b["png"] is None


def test_export_lens_accepts_a_context_directly(tmp_path):
    out = tmp_path / "lens.json"
    nme.export_lens(FakeContext([S2], {}), out)
    assert [x["label"] for x in json.loads(out.read_text())["selections"]] == ["S2"]


def test_export_lens_with_no_selections_writes_an_empty_list(tmp_path):
    out = tmp_path / "lens.json"
    nme.export_lens(FakeLens(FakeContext([], {})), out)
    assert json.loads(out.read_text())["selections"] == []


def test_export_lens_keeps_a_hostile_label_inside_the_png_dir(tmp_path):
    out = tmp_path / "exports" / "lens.json"
    hostile = [{**S1, "id": "sel-x", "label": "../../escape"}, {**S1, "id": "/abs/evil", "label": None}]
    nme.export_lens(FakeContext(hostile, {"sel-x": png_bytes(), "/abs/evil": png_bytes()}), out)
    png_dir = tmp_path / "exports" / "lens-png"
    pngs = [Path(x["png"]) for x in json.loads(out.read_text())["selections"]]
    assert len(pngs) == 2 and len(set(pngs)) == 2
    for p in pngs:
        assert p.resolve().parent == png_dir.resolve(), p
        assert p.read_bytes() == png_bytes()
    written = sorted(x for x in tmp_path.rglob("*") if x.is_file())
    assert written == sorted([out, *pngs]), written


def test_export_molabel_keeps_annotations_and_drops_the_rendered_html(tmp_path):
    out = tmp_path / "triage" / "findings.json"
    ret = nme.export_molabel(FakeLabel(ANNOTATIONS), out, title_key="title", text_key="text")
    assert Path(ret) == out
    s = json.loads(out.read_text(encoding="utf-8"))
    assert s["tool"] == "molabel" and s["title_key"] == "title" and s["text_key"] == "text"
    assert isinstance(s["exported"], str) and s["exported"]
    assert len(s["annotations"]) == 2
    for got, want in zip(s["annotations"], ANNOTATIONS):
        assert "_html" not in got["example"]
        assert got["example"] == {k: v for k, v in want["example"].items() if k != "_html"}
        assert {k: got[k] for k in ("index", "_label", "_notes", "_timestamp")} == \
               {k: want[k] for k in ("index", "_label", "_notes", "_timestamp")}
    assert "_html" in ANNOTATIONS[0]["example"]  # the widget's own records are not mutated


def test_export_molabel_keys_default_to_null(tmp_path):
    out = tmp_path / "f.json"
    nme.export_molabel(FakeLabel(ANNOTATIONS[:1]), out)
    s = json.loads(out.read_text())
    assert s["title_key"] is None and s["text_key"] is None


def test_helper_imports_only_the_standard_library():
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    names = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    names |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module and n.level == 0}
    assert names <= set(sys.stdlib_module_names) | {"__future__"}, names
