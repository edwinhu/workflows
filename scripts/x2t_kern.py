#!/usr/bin/env python3
"""Inject GPOS/`kern` pair kerning into an x2t-produced PDF, in place.

x2t's docx->PDF path (sdkjs in V8) applies NO pair kerning -- it positions
glyphs by their nominal advance only (verified cache-proof: stripping a font's
GPOS or `kern` table leaves x2t's output width unchanged). It already emits each
run as a PDF ``TJ`` array, so we recover the run text via /ToUnicode, shape it
with HarfBuzz (the shaper Word/LibreOffice use, so GPOS is covered), and fold the
per-glyph advance difference into the ``TJ`` adjustments.

Run via uv so the deps need not be in the ambient python:
    uv run --with uharfbuzz --with pikepdf --with fonttools \
        python3 x2t_kern.py <in.pdf> <font-or-dir> [<font-or-dir> ...]

Edits <in.pdf> in place. Font args may be .ttf/.otf files or directories
(scanned non-recursively). Pass the *staged render faces* x2t actually embedded
(GPOS intact); they are matched to PDF runs by PostScript/family name.

LIMITATIONS: render-time only -- sdkjs reserved each line at UNKERNED width, so
kerned glyphs render tighter than the box (invisible for left/center text; on
JUSTIFIED text the last glyph stops short of the right margin). Caller gates on
justification. One glyph per char assumed (ligatures skipped). See
docs/investigations/2026-06-19_x2t-kerning-patch.md.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pikepdf
import uharfbuzz as hb
from fontTools.ttLib import TTFont


def load_shapers(paths):
    """Map PostScript/family name -> (hb.Font, upem) for every face found."""
    files = []
    for p in paths:
        p = Path(p)
        if p.is_dir():
            files += [q for q in p.iterdir()
                      if q.suffix.lower() in (".ttf", ".otf")]
        elif p.suffix.lower() in (".ttf", ".otf"):
            files.append(p)
    shapers: dict = {}
    for p in files:
        try:
            face = hb.Face(hb.Blob.from_file_path(str(p)))
            hbfont = hb.Font(face)
            upem = face.upem
            ft = TTFont(str(p))
            for nid in (6, 1, 16, 4):  # PS name, family, typo family, full
                n = ft["name"].getDebugName(nid)
                if n:
                    shapers.setdefault(n, (hbfont, upem))
                    shapers.setdefault(n.replace(" ", ""), (hbfont, upem))
        except Exception:
            continue
    return shapers


def kern_shifts(text, hbfont, upem):
    """Per-glyph cumulative leftward shift (1000 text-space) to turn x2t's
    nominal layout into a kerned one. None if glyph count != char count."""
    def adv(do_kern):
        b = hb.Buffer()
        b.add_str(text)
        b.guess_segment_properties()
        hb.shape(hbfont, b, {"kern": do_kern, "liga": False})
        return [p.x_advance for p in b.glyph_positions]

    kon, koff = adv(True), adv(False)
    if len(kon) != len(text) or len(koff) != len(text):
        return None
    shifts, cum = [], 0.0
    for i in range(len(kon)):
        shifts.append(cum * 1000.0 / upem)
        cum += (koff[i] - kon[i])  # positive => kerned tighter
    return shifts


def parse_tounicode(font):
    tu = bytes(font.ToUnicode.read_bytes()).decode("latin-1")
    m = {}
    for x in re.finditer(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", tu):
        try:
            m[int(x.group(1), 16)] = chr(int(x.group(2), 16))
        except ValueError:
            pass
    return m


def base_name(font):
    return str(font.get("/BaseFont", "")).split("+")[-1].lstrip("/")


def inject(pdf_path, shapers):
    changed = False
    pdf = pikepdf.open(str(pdf_path), allow_overwriting_input=True)
    for pg in pdf.pages:
        fonts = {}
        for key, fn in pg.Resources.get("/Font", {}).items():
            c2u = parse_tounicode(fn) if "/ToUnicode" in fn else {}
            fonts[str(key).lstrip("/")] = (c2u, shapers.get(base_name(fn)))
        c = pg.Contents
        try:
            data = (b"".join(bytes(s.read_bytes()) for s in c)
                    if isinstance(c, pikepdf.Array) else bytes(c.read_bytes()))
        except Exception:
            continue
        txt = data.decode("latin-1")
        state = {"cur": None}

        def fix_tj(body):
            ctx = fonts.get(state["cur"])
            if not ctx or not ctx[1]:
                return None
            c2u, (hbfont, upem) = ctx
            toks = re.findall(r"<([0-9A-Fa-f]+)>|(-?\d+\.?\d*)", body)
            seq = []
            for hx, num in toks:
                if hx:
                    for i in range(0, len(hx), 4):
                        seq.append(("g", int(hx[i:i + 4], 16)))
                elif num:
                    seq.append(("n", float(num)))
            text = "".join(c2u.get(v, "") for k, v in seq if k == "g")
            if not text.strip():
                return None
            shifts = kern_shifts(text, hbfont, upem)
            if shifts is None:
                return None
            out, gi = [], 0
            for kind, val in seq:
                if kind == "g":
                    if 0 < gi < len(shifts):
                        d = shifts[gi] - shifts[gi - 1]
                        if abs(d) > 0.01:
                            out.append(("n", d))
                    out.append(("g", val))
                    gi += 1
                else:
                    out.append(("n", val))
            parts, buf = [], ""
            for kind, val in out:
                if kind == "g":
                    buf += "%04X" % val
                else:
                    if buf:
                        parts.append("<%s>" % buf)
                        buf = ""
                    parts.append("%.3f" % val)
            if buf:
                parts.append("<%s>" % buf)
            return "[" + " ".join(parts) + "]TJ"

        def repl(m):
            nonlocal changed
            if m.group("tf"):
                state["cur"] = m.group("name")
                return m.group(0)
            new = fix_tj(m.group("arr"))
            if new is None:
                return m.group(0)
            changed = True
            return new

        pat = re.compile(
            r"/(?P<name>[A-Za-z0-9_.]+)\s+[-\d.]+\s+(?P<tf>Tf)"
            r"|\[(?P<arr>[^\]]*)\]TJ"
        )
        new_txt = pat.sub(repl, txt)
        if new_txt != txt:
            pg.Contents = pdf.make_stream(new_txt.encode("latin-1"))
    if changed:
        pdf.save(str(pdf_path))
    return changed


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    pdf_path, font_args = argv[1], argv[2:]
    shapers = load_shapers(font_args)
    if not shapers:
        return 0  # no usable faces; leave the PDF untouched
    inject(pdf_path, shapers)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
