#!/usr/bin/env python3
"""Build the x2t "Garamond" render override: macOS roman + EB Garamond italics.

WHY: x2t's docx->PDF layout mis-measures the macOS (Monotype) Garamond family —
specifically its *italic* face poisons the metrics x2t uses to lay out every
Garamond run, so upright text renders with overlapping glyphs ("m-e-d-i-a-n"
cramming). See docs/investigations/2026-06-19_x2t-kerning-patch.md (Part 2).

The macOS Garamond regular/bold faces themselves are fine — only the italic is
the bad input. So this override keeps macOS Garamond for the **upright** weights
(regular, bold) and substitutes **EB Garamond** (a clean, GPOS-kerned face) for
the **slanted** weights (italic, bold-italic). Result: upright body text is
pixel-correct; italics render in EB Garamond and pick up real kerning via the
--kern injector. (Bold headings keep a small ~6% residual — x2t's measurement
quirk — far better than the ~23% with all-macOS; use --all-eb for zero residual
at the cost of EB upright text.)

The wrapper (`scripts/x2t_convert.py` `_doc_focused_dir`) reads
`~/.config/x2t-render-fonts/<lowercased-family>/` and uses those files for that
family, so this writes the four faces there, each renamed so the internal family
is "Garamond" with the correct subfamily/style bits preserved per face.

Usage:
    python3 setup_garamond_render_override.py          # macOS roman + EB italics
    python3 setup_garamond_render_override.py --all-eb # all four faces EB Garamond
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

FONTS = Path.home() / "Library" / "Fonts"
OVERRIDE = Path.home() / ".config" / "x2t-render-fonts" / "garamond"

# (output filename, source path, subfamily, PostScript name)
MACOS = {
    "regular": (FONTS / "Garamond.ttf", "Regular", "Garamond-Regular"),
    "bold": (FONTS / "GaramondBold.ttf", "Bold", "Garamond-Bold"),
    "italic": (FONTS / "GaramondItalic.ttf", "Italic", "Garamond-Italic"),
    "bolditalic": (FONTS / "GaramondBoldItalic.ttf", "Bold Italic",
                   "Garamond-BoldItalic"),
}
EB = {
    "regular": (FONTS / "EBGaramond-Regular.ttf", "Regular", "Garamond-Regular"),
    "bold": (FONTS / "EBGaramond-Bold.ttf", "Bold", "Garamond-Bold"),
    "italic": (FONTS / "EBGaramond-Italic.ttf", "Italic", "Garamond-Italic"),
    "bolditalic": (FONTS / "EBGaramond-BoldItalic.ttf", "Bold Italic",
                   "Garamond-BoldItalic"),
}
OUTNAME = {
    "regular": "Garamond.ttf", "bold": "GaramondBold.ttf",
    "italic": "GaramondItalic.ttf", "bolditalic": "GaramondBoldItalic.ttf",
}


def rename(src: Path, subfamily: str, psname: str, out: Path) -> None:
    """Save src as family 'Garamond' / given subfamily; keep all style bits."""
    f = TTFont(str(src))
    full = "Garamond" if subfamily == "Regular" else f"Garamond {subfamily}"
    for rec in f["name"].names:
        if rec.nameID in (1, 16):
            rec.string = "Garamond"
        elif rec.nameID in (2, 17):
            rec.string = subfamily
        elif rec.nameID == 4:
            rec.string = full
        elif rec.nameID == 6:
            rec.string = psname
    f.save(str(out))


def main(argv) -> int:
    all_eb = "--all-eb" in argv
    plan = {style: (EB[style] if all_eb or style in ("italic", "bolditalic")
                    else MACOS[style])
            for style in ("regular", "bold", "italic", "bolditalic")}

    missing = [str(src) for (src, _, _) in plan.values() if not src.is_file()]
    if missing:
        sys.stderr.write("missing source fonts:\n  " + "\n  ".join(missing) + "\n")
        if any("EBGaramond" in m for m in missing):
            sys.stderr.write(
                "Install EB Garamond, e.g. copy from "
                "`nix build nixpkgs#eb-garamond` or fonts.google.com/specimen/EB+Garamond\n")
        return 1

    OVERRIDE.mkdir(parents=True, exist_ok=True)
    for style, (src, subfamily, psname) in plan.items():
        out = OVERRIDE / OUTNAME[style]
        rename(src, subfamily, psname, out)
        origin = "EB" if src.name.startswith("EBGaramond") else "macOS"
        print(f"  {OUTNAME[style]:24s} <- {origin} Garamond {subfamily}")
    print(f"wrote {OVERRIDE}")
    print("Clear the staging cache so it re-stages: rm -rf ~/.cache/x2t-docfonts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
