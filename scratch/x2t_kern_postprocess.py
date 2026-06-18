#!/usr/bin/env python3
"""Inject font kerning into an x2t-produced PDF as a post-process step (GPOS-aware).

WHY: ONLYOFFICE x2t's docx->PDF path lays text out in the sdkjs JavaScript word
engine (run in V8 by the doctrenderer), which positions glyphs by their nominal
per-glyph advance only -- it applies NO pair kerning, neither the legacy `kern`
table NOR GPOS. Verified cache-proof (distinct family names -> distinct embedded
subsets -> identical widths with/without kern data). See
docs/investigations/2026-06-19_x2t-kerning-patch.md.

This uses HarfBuzz (the same shaper Word/LibreOffice use), so it covers GPOS pair
adjustments -- which is what modern body fonts (EB Garamond, Minion, most Google/
Adobe fonts) use, including their LOWERCASE kerning. The earlier legacy-`kern`-only
version did nothing for GPOS-only fonts.

How: x2t already emits each run as a PDF `TJ` array of GIDs with sub-unit position
corrections on top of the font's nominal /Widths. For each run we recover the text
via the font's /ToUnicode CMap, shape it with HarfBuzz twice (kern on / kern off),
and inject the per-glyph advance difference as additional `TJ` adjustments.

LIMITATIONS (read before deploying):
  * Needs the ORIGINAL font files (subset-embedded fonts usually drop GPOS), passed
    on the command line; matched to runs by PostScript/family name.
  * Render-time only: sdkjs reserved each line at UNKERNED width, so kerned glyphs
    render tighter than the box. Invisible for left/center text; for JUSTIFIED text
    the last glyph stops short of the right margin by the line's kern sum.
  * Assumes 1 glyph per character (fine for Latin; complex scripts/ligatures need
    cluster mapping, deliberately disabled here via liga=False).

USAGE:
    python3 x2t_kern_postprocess.py in.pdf out.pdf Font-Regular.ttf [More.ttf ...]
"""
from __future__ import annotations
import re
import sys

import pikepdf
import uharfbuzz as hb
from fontTools.ttLib import TTFont


def load_shapers(ttf_paths):
    """Return {psname_or_family: (hbfont, upm)} for each reference font."""
    shapers = {}
    for p in ttf_paths:
        blob = hb.Blob.from_file_path(p)
        face = hb.Face(blob)
        hbfont = hb.Font(face)
        upm = face.upem
        ft = TTFont(p)
        keys = set()
        for nid in (6, 1, 16, 4):  # PS name, family, typo family, full name
            n = ft["name"].getDebugName(nid)
            if n:
                keys.add(n)
                keys.add(n.replace(" ", ""))
        for k in keys:
            shapers[k] = (hbfont, upm)
    return shapers


def kern_shifts(text, hbfont, upm):
    """Per-glyph leftward shift (1000 text-space) to turn x2t's nominal layout
    into a kerned one. Index i = cumulative shift to apply before glyph i.
    Assumes one glyph per character."""
    def advances(do_kern):
        b = hb.Buffer()
        b.add_str(text)
        b.guess_segment_properties()
        hb.shape(hbfont, b, {"kern": do_kern, "liga": False})
        return [pos.x_advance for pos in b.glyph_positions]

    kon, koff = advances(True), advances(False)
    if len(kon) != len(text) or len(koff) != len(text):
        return None  # glyph count != char count (ligature/cluster): skip this run
    shifts, cum = [], 0.0
    for i in range(len(kon)):
        shifts.append(cum * 1000.0 / upm)
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
    bf = str(font.get("/BaseFont", ""))
    return bf.split("+")[-1].lstrip("/")  # strip subset tag "BAAAAA+"


def inject(pdf_path, out_path, shapers):
    pdf = pikepdf.open(pdf_path)
    for pg in pdf.pages:
        # map each /Font resource to (code2uni, shaper) once
        fonts = {}
        for key, fn in pg.Resources.get("/Font", {}).items():
            c2u = parse_tounicode(fn) if "/ToUnicode" in fn else {}
            shaper = shapers.get(base_name(fn))
            fonts[str(key).lstrip("/")] = (c2u, shaper)

        c = pg.Contents
        data = (b"".join(bytes(s.read_bytes()) for s in c)
                if isinstance(c, pikepdf.Array) else bytes(c.read_bytes()))
        txt = data.decode("latin-1")

        # track the current font set by `/Name Tf`
        state = {"cur": None}

        def fix(m):
            ctx = fonts.get(state["cur"])
            if not ctx or not ctx[1]:
                return m.group(0)
            c2u, (hbfont, upm) = ctx
            toks = re.findall(r"<([0-9A-Fa-f]+)>|(-?\d+\.?\d*)", m.group(1))
            seq = []
            for hx, num in toks:
                if hx:
                    for i in range(0, len(hx), 4):
                        seq.append(("g", int(hx[i:i + 4], 16)))
                elif num:
                    seq.append(("n", float(num)))
            text = "".join(c2u.get(v, "") for k, v in seq if k == "g")
            if not text.strip():
                return m.group(0)
            shifts = kern_shifts(text, hbfont, upm)
            if shifts is None:
                return m.group(0)
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

        # walk the stream, tracking font selections and rewriting TJ/Tj
        def repl(m):
            if m.group("tf"):
                state["cur"] = m.group("name")
                return m.group(0)
            return fix(m)

        pat = re.compile(
            r"/(?P<name>[A-Za-z0-9_.]+)\s+[-\d.]+\s+(?P<tf>Tf)"
            r"|\[(?P<arr>[^\]]*)\]TJ"
        )

        def repl2(m):
            if m.group("tf"):
                state["cur"] = m.group("name")
                return m.group(0)
            # reuse fix() on the TJ body
            return fix(re.match(r"\[([^\]]*)\]TJ", m.group(0)))

        new = pat.sub(repl2, txt)
        pg.Contents = pdf.make_stream(new.encode("latin-1"))
    pdf.save(out_path)


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    inp, outp, ttfs = argv[1], argv[2], argv[3:]
    shapers = load_shapers(ttfs)
    inject(inp, outp, shapers)
    print(f"wrote {outp}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
