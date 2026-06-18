#!/usr/bin/env python3
"""Inject font kerning into an x2t-produced PDF as a post-process step.

WHY: ONLYOFFICE x2t's docx->PDF path lays text out in the sdkjs JavaScript
word engine (run inside V8 by the doctrenderer). That engine positions glyphs
by their per-glyph advance only -- it never applies pair kerning (neither the
legacy `kern` table nor GPOS). See docs/investigations/2026-06-19_x2t-kerning-patch.md.

x2t already emits each text run as a PDF `TJ` array with per-glyph position
adjustments (sub-unit grid corrections). This script walks those TJ arrays,
maps each glyph code -> unicode via the font's /ToUnicode CMap, looks up the
pairwise kerning from a reference TTF's `kern` table, and adds the kern value
(in 1000-unit text space) between adjacent glyphs.

LIMITATIONS (read before deploying):
  * Legacy `kern` table only. FreeType's kern lookup (FT_Get_Kerning) and this
    script both ignore GPOS pair adjustments. GPOS-only fonts get nothing.
  * Render-time only: the line was laid out by sdkjs at UNKERNED width, so
    kerned glyphs render tighter than the reserved box. Fine for left-aligned
    text (lines just end a hair shorter); for JUSTIFIED text the last glyph
    falls short of the right margin by the per-line kern sum.
  * Needs a reference TTF with the same glyph repertoire as the embedded subset.

USAGE:
    python3 x2t_kern_postprocess.py in.pdf out.pdf font1.ttf [font2.ttf ...]
"""
from __future__ import annotations
import re
import sys

import pikepdf
from fontTools.ttLib import TTFont


def build_kern_index(ttf_paths):
    """Return {(char1, char2): kern_in_1000_text_space} merged across fonts."""
    index = {}
    for p in ttf_paths:
        f = TTFont(p)
        if "kern" not in f:
            continue
        upm = f["head"].unitsPerEm
        cmap = f.getBestCmap()
        gname2char = {gn: chr(cp) for cp, gn in cmap.items()}
        for st in f["kern"].kernTables:
            for (g1, g2), val in st.kernTable.items():
                c1, c2 = gname2char.get(g1), gname2char.get(g2)
                if c1 and c2:
                    index.setdefault((c1, c2), val * 1000.0 / upm)
    return index


def parse_tounicode(font):
    tu = bytes(font.ToUnicode.read_bytes()).decode("latin-1")
    code2uni = {}
    for m in re.finditer(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", tu):
        try:
            code2uni[int(m.group(1), 16)] = chr(int(m.group(2), 16))
        except ValueError:
            pass
    return code2uni


def inject_kern_into_stream(txt, code2uni, kern_index):
    def fix_tj(arrbody):
        toks = re.findall(r"<([0-9A-Fa-f]+)>|(-?\d+\.?\d*)", arrbody)
        seq = []
        for hx, num in toks:
            if hx:
                for i in range(0, len(hx), 4):
                    seq.append(("g", int(hx[i:i + 4], 16)))
            elif num:
                seq.append(("n", float(num)))
        out, prev = [], None
        for kind, val in seq:
            if kind == "g":
                ch = code2uni.get(val)
                if prev is not None and ch:
                    k = kern_index.get((prev, ch), 0.0)
                    if k:
                        # kern is negative (tighter); a positive TJ number moves
                        # the next glyph left, so emit -k to tighten.
                        out.append(("n", -k))
                out.append(("g", val))
                prev = ch
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

    return re.sub(r"\[([^\]]*)\]TJ", lambda m: fix_tj(m.group(1)), txt)


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    inp, outp = argv[1], argv[2]
    ttfs = argv[3:]
    kern_index = build_kern_index(ttfs)
    pdf = pikepdf.open(inp)
    for pg in pdf.pages:
        fonts = pg.Resources.get("/Font", {})
        code2uni = {}
        for fn in fonts.values():
            if "/ToUnicode" in fn:
                code2uni.update(parse_tounicode(fn))
        c = pg.Contents
        data = (b"".join(bytes(s.read_bytes()) for s in c)
                if isinstance(c, pikepdf.Array) else bytes(c.read_bytes()))
        txt = data.decode("latin-1")
        new = inject_kern_into_stream(txt, code2uni, kern_index)
        pg.Contents = pdf.make_stream(new.encode("latin-1"))
    pdf.save(outp)
    print(f"wrote {outp}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
