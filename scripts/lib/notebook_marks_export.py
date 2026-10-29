"""Export a marimo notebook's review marks from the live kernel to a JSON file that doc-marks reads.

Lens selections and molabel SimpleLabel annotations exist only in the running kernel, so an agent runs
this helper there (standard library only, because it imports into the notebook's own environment) and
then reads the file with `doc-marks --lens EXPORT.json` or `doc-marks --molabel EXPORT.json`.

Lens (`export_lens(lens_or_context, path)`; a `marimo_lens.Lens` or the `LensContext` from its
`.context()`):

    {"tool": "marimo-lens", "exported": <ISO 8601 UTC>,
     "selections": [<each references["selections"] dict verbatim> + "png": <absolute path or null>]}

A selection's captured image (`ctx.images[id]`) is written to `<export stem>-png/<label>.png` beside
the export; `png` is null when no image was captured.

molabel (`export_molabel(widget, path, title_key=None, text_key=None)`; a `SimpleLabel`):

    {"tool": "molabel", "exported": <ISO 8601 UTC>, "title_key": <str|null>, "text_key": <str|null>,
     "annotations": [<each get_annotations() record verbatim, its example without "_html">]}

`title_key` and `text_key` name the example fields doc-marks shows as a mark's heading and quoted text.

Run it in the kernel through marimo-pair's execute-code.sh (scratchpad: nothing is added to the
notebook), with `lens` / `label` being the notebook's own widget variables:

    bash .../marimo-pair/scripts/execute-code.sh --url URL -c '
    import sys; sys.path.insert(0, "<workflows checkout>/scripts/lib")
    import notebook_marks_export as nme
    print(nme.export_lens(lens, "review/lens.json"))
    print(nme.export_molabel(label, "review/findings.json", title_key="title", text_key="text"))'

Both functions create the export's parent directories, write UTF-8 JSON and return the export path.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _write(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    # default=str: a user's example field (numpy scalar, Timestamp) must not abort the export.
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    return path


def _png_name(selection: dict, n: int) -> str:
    # The label names a file, so it is reduced to a bare name: no separator or ".." can leave the PNG dir.
    stem = re.sub(r"[^A-Za-z0-9_-]", "_", str(selection.get("label") or selection.get("id") or f"S{n}"))
    return f"{stem}.png"


def export_lens(lens_or_context, path):
    """Write the Lens's open selections, and their captured PNGs, to `path`; return the path."""
    ctx = lens_or_context if hasattr(lens_or_context, "references") else lens_or_context.context()
    out = Path(path).absolute()
    images = ctx.images or {}
    png_dir = out.with_name(f"{out.stem}-png")
    selections = []
    for n, sel in enumerate(ctx.references.get("selections") or [], 1):
        data = images.get(sel.get("id"))
        png = None
        if data:
            png_dir.mkdir(parents=True, exist_ok=True)
            png = png_dir / _png_name(sel, n)
            png.write_bytes(data)
            png = str(png)
        selections.append({**sel, "png": png})
    _write(out, {"tool": "marimo-lens", "exported": _now(), "selections": selections})
    return Path(path)


def export_molabel(widget, path, title_key=None, text_key=None):
    """Write the SimpleLabel's annotations, minus each example's rendered `_html`, to `path`; return the path."""
    annotations = []
    for a in widget.get_annotations():
        example = a.get("example")
        if isinstance(example, dict):
            a = {**a, "example": {k: v for k, v in example.items() if k != "_html"}}
        annotations.append(a)
    _write(Path(path), {"tool": "molabel", "exported": _now(), "title_key": title_key, "text_key": text_key,
                        "annotations": annotations})
    return Path(path)
