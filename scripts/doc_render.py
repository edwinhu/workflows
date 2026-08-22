#!/usr/bin/env python3
"""Render office documents (docx/pptx/xlsx -> PDF/PNG/...) via three backends,
in descending fidelity — Microsoft Word, LibreOffice, ONLYOFFICE x2t — each with
its own fixes. `convert()` picks one by document properties and engine
availability, with best-effort fallback.

  * Word (gold standard): native kerning/layout AND the only engine that
    recomputes Word fields (REF/NOTEREF/PAGEREF/TOC). GUI-driven, sandboxed,
    not parallel-safe — opt-in (renderer="word" / allow_word=True). Renders from
    Word's container; strips quarantine to avoid Protected View.
  * LibreOffice: correct HarfBuzz kerning; WRONG for docs that restart footnote
    numbering per section/page.
  * x2t: OOXML-native, correct footnote-restart (numRestart eachSect), stateless/
    parallel-safe; applies NO pair kerning and mis-renders the macOS Garamond, so
    this module adds render-time GPOS/kern injection and EB-Garamond substitution.

See docs/investigations/2026-06-10_onlyoffice-vs-libreoffice.md and
docs/investigations/2026-06-19_x2t-kerning-patch.md.

Library use:
    sys.path.insert(0, str(plugin_root / "scripts"))
    from doc_render import convert
    convert(Path("in.docx"), Path("out.pdf"))                 # auto
    convert(Path("in.docx"), Path("out.pdf"), renderer="word")  # gold standard

CLI use:
    python3 scripts/doc_render.py in.docx out.pdf
    python3 scripts/doc_render.py in.docx out.pdf --renderer word
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Output formats x2t infers from the m_sFileTo extension.
_X2T_OUTPUT_EXTS = {
    ".pdf", ".png", ".jpg", ".docx", ".odt", ".rtf", ".txt", ".html",
    ".xlsx", ".ods", ".csv", ".pptx", ".odp",
}

# Sources the Word engines (local `word`, guest `word-remote`) open natively.
# `.doc` belongs here: pre-converting it to .docx with soffice corrupts every
# footnote (a literal `?` run beside the real footnoteRef) and shifts the page
# count, so legacy binaries must reach Word unconverted.
WORD_SRC_SUFFIXES = {".docx", ".doc"}

_PARAMS_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <m_sFileFrom>{src}</m_sFileFrom>
  <m_sFileTo>{dst}</m_sFileTo>
  <m_sTempDir>{tmp}</m_sTempDir>{fonts_elem}
</TaskQueueDataConvert>
"""

# Dirs whose fonts are merged wholesale (user-installed fonts, incl. any
# MS Office fonts). Linux dirs are small enough to take entirely.
_FONT_SOURCE_DIRS = (
    "~/Library/Fonts",
    "/Library/Fonts",
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "~/.local/share/fonts",
)

# From macOS /System/Library/Fonts/Supplemental, take only the classic
# document fonts (Apple ships the MS web-core set there). Taking the whole
# dir would add hundreds of MB of CJK/UI fonts.
_SUPPLEMENTAL_DIR = "/System/Library/Fonts/Supplemental"
_SUPPLEMENTAL_PREFIXES = (
    "Times New Roman", "Arial", "Georgia", "Verdana", "Tahoma",
    "Trebuchet", "Courier New", "Comic Sans", "Impact", "Book Antiqua",
    "Garamond", "Palatino",
)

# Icon/symbol fonts poison x2t's font matcher: with octicons.ttf et al. in
# m_sFontDir, small-caps Times New Roman runs render as icon glyphs
# (law_review_template TABLE OF CONTENTS -> "mommomom" + lightning-bolt icon;
# verified 2026-06-10). Exclude them from the merged cache.
_ICON_FONT_RE = re.compile(
    r"icons?|awesome|glyph|emoji|symbols?|dingbat|webdings|wingdings"
    r"|powerline|nerd|-NF-|^NFM|octicons|devicons",
    re.IGNORECASE,
)


def _x2t_tree() -> Path | None:
    """Locate the ONLYOFFICE install tree (the dir holding x2t + sdkjs).

    The nix package puts a makeWrapper *script* at bin/x2t (resolve() lands
    in bin/, not the tree), with the real tree at ../lib/onlyoffice-
    documentbuilder. A raw tarball's x2t sits directly inside the tree.
    """
    x2t = shutil.which("x2t")
    if not x2t:
        return None
    bindir = Path(x2t).resolve().parent
    for cand in (
        bindir.parent / "lib" / "onlyoffice-documentbuilder",  # nix package
        bindir,                                                # raw tarball
    ):
        if (cand / "sdkjs").is_dir():
            return cand
    return None


def _bundled_fonts_dir() -> Path | None:
    """Fonts dir shipped in the ONLYOFFICE tree.

    Includes Carlito/Caladea, the metric-compatible Calibri/Cambria stand-ins.
    """
    tree = _x2t_tree()
    if tree and (tree / "fonts").is_dir():
        return tree / "fonts"
    return None


def _nix_mode_bindir(tool: str = "x2t") -> Path | None:
    """Detect the nix source-built layout (onlyoffice-docbuilder on linux).

    nixpkgs' hermetic build is self-contained: DoctRenderer.config sits next
    to the binaries and points at store-path sdkjs + build-time AllFonts —
    no tree copy, no font index init, no m_sFontDir needed. Detected by a
    sibling DoctRenderer.config with NO sdkjs dir beside the binary.
    """
    exe = shutil.which(tool)
    if not exe:
        return None
    bindir = Path(exe).resolve().parent
    if (bindir / "DoctRenderer.config").is_file() and not (bindir / "sdkjs").is_dir():
        return bindir
    return None


# True when font_dir() rebuilt the merged cache this process — the app dir's
# font index must then be regenerated too.
_fonts_changed = False


def _app_dir() -> Path:
    """Writable copy of the ONLYOFFICE tree, with a generated font index.

    x2t resolves DoctRenderer.config/sdkjs relative to its own directory and
    REQUIRES sdkjs/common/AllFonts.js + font_selection.bin — which only
    `docbuilder` generates, and only into a writable tree (the nix store is
    read-only). Without the index x2t dies with exit 80 /
    "TypeError: ... e.length" from DoctRenderer (verified v9.4.0).

    So: copy the installed tree once per version to ~/.cache/x2t-app/<name>,
    run a trivial docbuilder script to generate the index, and run that
    copy's x2t. Re-inits when the merged font cache changes.
    """
    tree = _x2t_tree()
    if tree is None:
        raise RuntimeError("x2t not on PATH (or sdkjs not found beside it)")
    # Key the cache by the store-path/dir name so version bumps re-copy.
    app = Path.home() / ".cache" / "x2t-app" / tree.resolve().parts[-3]

    common = app / "sdkjs" / "common"
    index = common / "AllFonts.js"
    if not app.is_dir():
        app.parent.mkdir(parents=True, exist_ok=True)
        tmp_app = app.with_suffix(".partial")
        if tmp_app.exists():
            shutil.rmtree(tmp_app)
        shutil.copytree(tree, tmp_app)
        for p in [tmp_app, *tmp_app.rglob("*")]:
            p.chmod(p.stat().st_mode | 0o200)
        tmp_app.rename(app)
    elif _fonts_changed:
        # Remove ALL index artifacts — docbuilder skips regeneration if
        # fonts.log still matches its last scan.
        for stale in (index, common / "font_selection.bin", common / "fonts.log"):
            stale.unlink(missing_ok=True)

    if not index.exists():
        with tempfile.TemporaryDirectory(prefix="x2t-init-") as tmp:
            script = Path(tmp) / "init.docbuilder"
            script.write_text('builder.CreateFile("docx");\nbuilder.CloseFile();\n')
            subprocess.run(
                [str(app / "docbuilder"), str(script)],
                cwd=app, check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=120,
            )
        if not index.exists():
            raise RuntimeError(f"docbuilder init did not generate {index}")
    return app


def _collect_fonts() -> dict[str, Path]:
    font_files: dict[str, Path] = {}

    def add(f: Path) -> None:
        if (
            f.is_file()
            and f.suffix.lower() in (".ttf", ".otf", ".ttc")
            and not _ICON_FONT_RE.search(f.name)
        ):
            font_files.setdefault(f.name, f)

    for d in _FONT_SOURCE_DIRS:
        p = Path(d).expanduser()
        if p.is_dir():
            for f in p.rglob("*"):
                add(f)
    supp = Path(_SUPPLEMENTAL_DIR)
    if supp.is_dir():
        for f in supp.iterdir():
            if f.name.startswith(_SUPPLEMENTAL_PREFIXES):
                add(f)
    bundled = _bundled_fonts_dir()
    if bundled:
        for f in bundled.rglob("*"):
            add(f)
    return font_files


def font_dir() -> Path | None:
    """Resolve the single fonts directory x2t accepts (m_sFontDir).

    Precedence: $X2T_FONT_DIR override, else a cached merged dir under
    ~/.cache/x2t-fonts combining user fonts, the classic document fonts from
    macOS Supplemental (Times New Roman etc.), and the ONLYOFFICE bundled
    fonts. Fonts are COPIED, not symlinked — x2t segfaults on symlinked
    fonts (verified v9.4.0 macos-arm64, 2026-06-10). Rebuilt when the font
    set changes.
    """
    override = os.environ.get("X2T_FONT_DIR")
    if override:
        return Path(override).expanduser()

    font_files = _collect_fonts()
    if not font_files:
        return _bundled_fonts_dir()

    merged = Path.home() / ".cache" / "x2t-fonts"
    existing = {p.name for p in merged.iterdir()} if merged.is_dir() else set()
    if existing != set(font_files):
        global _fonts_changed
        _fonts_changed = True
        if merged.is_dir():
            shutil.rmtree(merged)
        merged.mkdir(parents=True)
        for name, target in font_files.items():
            # copyfile (data only): copy2's xattr copy hits EPERM on
            # SIP-protected macOS font files. Symlinks segfault x2t.
            shutil.copyfile(target, merged / name)
    return merged


def _docx_font_families(src: Path) -> set:
    """Font family names a .docx actually references.

    Covers literal run/style fonts (w:rFonts ascii/hAnsi/cs) and the theme's
    Latin major/minor typefaces (which run-level asciiTheme/hAnsiTheme resolve
    to). Returns lowercased names; empty set on anything unreadable.
    """
    import zipfile, re
    if src.suffix.lower() != ".docx":
        return set()
    fams = set()
    try:
        with zipfile.ZipFile(src) as z:
            names = set(z.namelist())
            # Only the fonts an unstyled run actually resolves to: the
            # docDefaults rFonts and explicit run-level rFonts in the content.
            # Per-style rFonts in styles.xml (Consolas for code, Arial Unicode
            # as a cs fallback, etc.) are mostly unused and, if added to the
            # render pool, re-poison the bold/italic match — so they are
            # excluded here. Theme major/minor Latin faces are added below.
            if "word/styles.xml" in names:
                st = z.read("word/styles.xml").decode("utf-8", "ignore")
                dd = re.search(r'<w:docDefaults>.*?</w:docDefaults>', st, re.S)
                if dd:
                    for m in re.findall(r'w:(?:ascii|hAnsi)="([^"]+)"', dd.group(0)):
                        fams.add(m.strip())
            for n in ("word/document.xml", "word/footnotes.xml",
                      "word/endnotes.xml", "word/header1.xml",
                      "word/header2.xml", "word/footer1.xml", "word/footer2.xml"):
                if n in names:
                    t = z.read(n).decode("utf-8", "ignore")
                    for m in re.findall(r'w:(?:ascii|hAnsi)="([^"]+)"', t):
                        fams.add(m.strip())
            if "word/theme/theme1.xml" in names:
                th = z.read("word/theme/theme1.xml").decode("utf-8", "ignore")
                major = re.search(r'<a:majorFont>.*?<a:latin typeface="([^"]*)"', th, re.S)
                minor = re.search(r'<a:minorFont>.*?<a:latin typeface="([^"]*)"', th, re.S)
                if major and major.group(1):
                    fams.add(major.group(1)); fams.add("majorhansi")
                if minor and minor.group(1):
                    fams.add(minor.group(1)); fams.add("minorhansi")
                # map the theme sentinels to the resolved names
                if major and major.group(1):
                    fams = {major.group(1) if f.lower() == "majorhansi" else f for f in fams}
                if minor and minor.group(1):
                    fams = {minor.group(1) if f.lower() == "minorhansi" else f for f in fams}
    except Exception:
        return set()
    return {f.lower() for f in fams if f and not f.startswith("+")
            and f.lower() not in ("majorhansi", "minorhansi", "majorbidi", "minorbidi")}


def _font_family_index(merged: Path) -> dict:
    """Map lowercased family name -> list of font file Paths in `merged`.

    Built with fontTools (reads name IDs 1 and 16). Cached to
    ~/.cache/x2t-family-index.json keyed by the dir's file signature so the
    ~800-font scan runs once. Returns {} if fontTools is unavailable.
    """
    import json
    try:
        from fontTools.ttLib import TTFont, TTCollection
    except Exception:
        return {}
    cache = Path.home() / ".cache" / "x2t-family-index.json"
    files = sorted(p for p in merged.iterdir()
                   if p.suffix.lower() in (".ttf", ".otf", ".ttc"))
    sig = str([(p.name, p.stat().st_size) for p in files])
    if cache.exists():
        try:
            blob = json.loads(cache.read_text())
            if blob.get("sig") == sig:
                return {k: [merged / n for n in v] for k, v in blob["idx"].items()}
        except Exception:
            pass
    idx: dict = {}

    def add(fam, name):
        if fam:
            idx.setdefault(fam.lower(), [])
            if name not in idx[fam.lower()]:
                idx[fam.lower()].append(name)

    for p in files:
        try:
            faces = TTCollection(p).fonts if p.suffix.lower() == ".ttc" else [TTFont(p, fontNumber=0, lazy=True)]
            for f in faces:
                nm = f["name"]
                add(nm.getDebugName(1), p.name)
                add(nm.getDebugName(16), p.name)
        except Exception:
            continue
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"sig": sig, "idx": idx}))
    except Exception:
        pass
    return {k: [merged / n for n in v] for k, v in idx.items()}


# Built-in render substitutions: families x2t mis-renders, mapped to a clean
# drop-in. The macOS (Monotype) Garamond *italic* face poisons x2t's measurement
# so upright text renders with overlapping glyphs; EB Garamond renders correctly
# AND is GPOS-kerned. Substitution is render-only (m_sFontDir) — the .docx/Word
# still resolve the real font. Disable with $X2T_NO_FONT_SUBST=1. See
# docs/investigations/2026-06-19_x2t-kerning-patch.md.
_RENDER_SUBSTITUTE = {"garamond": "EB Garamond"}

_EB_GARAMOND_GLOBS = (
    "~/Library/Fonts/EBGaramond*.ttf",
    "~/Library/Fonts/EBGaramond*.otf",
    "/Library/Fonts/EBGaramond*.ttf",
    "~/.local/share/fonts/EBGaramond*.ttf",
    "/nix/store/*-eb-garamond-*/share/fonts/truetype/EBGaramond*.ttf",
    "/nix/store/*-eb-garamond-*/share/fonts/opentype/EBGaramond*.otf",
    "/usr/share/fonts/**/EBGaramond*.tt[fc]",
)
# Decorative/optical cuts that must never be used as the text faces.
_EB_EXCLUDE = ("SC", "Initials", "AllSC", "Caps")


def _find_eb_garamond() -> dict:
    """Locate EB Garamond text faces -> {(bold, italic): Path}. Prefers the 12pt
    optical master; excludes small-caps/initials. {} if not all four present."""
    import glob
    try:
        from fontTools.ttLib import TTFont
    except Exception:
        return {}
    best: dict = {}  # (bold,italic) -> (priority, Path)
    for pat in _EB_GARAMOND_GLOBS:
        for sp in glob.glob(os.path.expanduser(pat), recursive=True):
            p = Path(sp)
            if any(x in p.stem for x in _EB_EXCLUDE):
                continue
            try:
                f = TTFont(sp, fontNumber=0, lazy=True)
                fam = (f["name"].getDebugName(16) or f["name"].getDebugName(1) or "")
                if "garamond" not in fam.lower():
                    continue
                o = f.get("OS/2")
                mac = f["head"].macStyle
                italic = bool(mac & 0x02) or bool(o and o.fsSelection & 0x01)
                bold = bool(mac & 0x01) or bool(o and o.fsSelection & 0x20) \
                    or bool(o and o.usWeightClass >= 600)
            except Exception:
                continue
            # priority: 12pt optical > unsuffixed > 08pt; shorter stem wins ties
            pr = (0 if "12" in p.stem else (1 if not any(c.isdigit() for c in p.stem)
                  else 2), len(p.stem))
            k = (bold, italic)
            if k not in best or pr < best[k][0]:
                best[k] = (pr, p)
    faces = {k: v[1] for k, v in best.items()}
    return faces if len(faces) == 4 else {}


def _substitute_render_dir(fam: str) -> "Path | None":
    """For a substituted family, return a cache dir of the replacement faces
    renamed to that family (correct subfamily/style bits), or None."""
    if os.environ.get("X2T_NO_FONT_SUBST"):
        return None
    if fam not in _RENDER_SUBSTITUTE:
        return None
    faces = _find_eb_garamond() if _RENDER_SUBSTITUTE[fam] == "EB Garamond" else {}
    if not faces:
        return None
    try:
        from fontTools.ttLib import TTFont
    except Exception:
        return None
    import hashlib
    sig = sorted((str(b), str(i), str(p), str(p.stat().st_mtime))
                 for (b, i), p in faces.items())
    key = hashlib.sha1((fam + str(sig)).encode()).hexdigest()[:12]
    out = Path.home() / ".cache" / "x2t-render-subst" / f"{fam}-{key}"
    if out.is_dir() and any(out.iterdir()):
        return out
    out.mkdir(parents=True, exist_ok=True)
    target = fam.title()  # "garamond" -> "Garamond"
    plan = {(False, False): ("Regular", f"{target}.ttf"),
            (True, False): ("Bold", f"{target}Bold.ttf"),
            (False, True): ("Italic", f"{target}Italic.ttf"),
            (True, True): ("Bold Italic", f"{target}BoldItalic.ttf")}
    for k, src in faces.items():
        subfamily, outname = plan[k]
        full = target if subfamily == "Regular" else f"{target} {subfamily}"
        ps = target if subfamily == "Regular" else f"{target}-{subfamily.replace(' ', '')}"
        try:
            f = TTFont(str(src))
            for rec in f["name"].names:
                if rec.nameID in (1, 16):
                    rec.string = target
                elif rec.nameID in (2, 17):
                    rec.string = subfamily
                elif rec.nameID == 4:
                    rec.string = full
                elif rec.nameID == 6:
                    rec.string = ps
            f.save(str(out / outname))
        except Exception:
            return None
    return out if any(out.iterdir()) else None


def _doc_focused_dir(src: Path) -> "Path | None":
    """Build an m_sFontDir containing only the fonts the document references.

    x2t selects render faces from m_sFontDir; with the full ~800-font system
    pool its matcher mis-resolves bold/italic of a serif family to Arial.
    Restricting the pool to the document's own font families makes it pick the
    correct bold/italic faces. Returns None (caller falls back to the full
    merged dir) if extraction or indexing is unavailable.
    """
    fams = _docx_font_families(src)
    if not fams:
        return None
    merged = font_dir()
    if not merged or not Path(merged).is_dir():
        return None
    index = _font_family_index(Path(merged))
    if not index:
        return None
    # Render-face resolution per family, highest priority first:
    #   1. User override ~/.config/x2t-render-fonts/<family>/ — explicit control,
    #      for x2t rendering only (not the system/Word).
    #   2. Built-in substitution (_RENDER_SUBSTITUTE) — families x2t mis-renders,
    #      e.g. macOS Garamond -> EB Garamond. Auto, no per-machine setup.
    #   3. The document's own system faces.
    override_root = Path.home() / ".config" / "x2t-render-fonts"
    wanted: dict = {}
    for fam in fams:
        ov = override_root / fam
        sub = None if ov.is_dir() else _substitute_render_dir(fam)
        if ov.is_dir():
            files = [p for p in ov.iterdir()
                     if p.suffix.lower() in (".ttf", ".otf", ".ttc")]
        elif sub:
            files = [p for p in sub.iterdir()
                     if p.suffix.lower() in (".ttf", ".otf", ".ttc")]
        else:
            files = index.get(fam, [])
        # A .ttc collection registers only its first face to x2t, so a family
        # that also has individual .ttf/.otf faces (the bold/italic variants)
        # must NOT also carry the .ttc — the duplicate regular re-poisons the
        # bold/italic match. Prefer the individual faces; keep .ttc only when
        # it is the family's sole source.
        non_ttc = [f for f in files if f.suffix.lower() != ".ttc"]
        for f in (non_ttc or files):
            wanted[f.name] = f
    if not wanted:
        return None
    import hashlib
    key = hashlib.sha1((str(sorted(fams)) + str(sorted(wanted))).encode()).hexdigest()[:12]
    out = Path.home() / ".cache" / "x2t-docfonts" / key
    if not out.is_dir():
        out.mkdir(parents=True, exist_ok=True)
        try:
            from fontTools.ttLib import TTFont  # noqa: F401
            _have_ft = True
        except Exception:
            _have_ft = False
        # Two fixes when staging a font into the render pool, both invisible to
        # other apps:
        #   1. Drop device-metrics tables (hdmx/LTSH/VDMX/gasp). x2t mis-reads
        #      them as glyph advances, cramming the text; they only matter for
        #      screen rasterization, never for PDF vector output.
        #   2. Normalize the font to 1000 units-per-em. x2t mis-scales kerning
        #      and positioning for fonts whose upm is not 1000 (the macOS
        #      Garamond is 2048), over-applying the kern table so letters
        #      collide ("shareh olders", "251(h)" blobs). Rescaling preserves
        #      the font's real kerning (kern + GPOS) and makes x2t apply it
        #      correctly, matching how Word renders the same file.
        for name, target in wanted.items():
            dest = out / name
            staged = False
            if _have_ft and target.suffix.lower() in (".ttf", ".otf"):
                try:
                    from fontTools.ttLib import TTFont
                    f = TTFont(str(target))
                    for tag in ("hdmx", "LTSH", "VDMX", "gasp"):
                        if tag in f:
                            del f[tag]
                    if f["head"].unitsPerEm != 1000:
                        from fontTools.ttLib.scaleUpem import scale_upem
                        scale_upem(f, 1000)
                    f.save(str(dest))
                    staged = True
                except Exception:
                    staged = False
            if not staged:
                try:
                    shutil.copyfile(target, dest)
                except Exception:
                    pass
    return out if any(out.iterdir()) else None


def _docx_is_justified(src: Path) -> bool:
    """True if the docx justifies any paragraph (``<w:jc w:val="both"/>`` in
    content or in styles defaults).

    Render-time kern injection (see ``_inject_kerning``) tightens glyphs after
    sdkjs already laid out the line at its UNKERNED width, so on justified text
    the last glyph stops short of the right margin by the line's kern sum.
    Detect justification and skip injection for those documents.
    """
    import zipfile

    try:
        with zipfile.ZipFile(src) as z:
            members = [m for m in z.namelist()
                       if m in ("word/document.xml", "word/styles.xml")]
            for m in members:
                blob = z.read(m).decode("utf-8", "replace")
                if 'w:jc w:val="both"' in blob or "w:jc w:val='both'" in blob:
                    return True
    except Exception:
        # If we cannot tell, be conservative and assume justified (skip kern)
        # only when the file is unreadable as a zip; a non-docx source (e.g.
        # pptx/xlsx) never reaches the prose-kern path anyway.
        return False
    return False


def _docx_restarts_footnotes(src: Path) -> bool:
    """True if the docx restarts footnote numbering per section or per page
    (``<w:numRestart w:val="eachSect"/>`` or ``"eachPage"`` in settings.xml or a
    section's ``<w:footnotePr>``).

    This is the ONE case where LibreOffice mis-renders (it numbers continuously
    regardless), so such documents must go through x2t (or Word). Continuous-
    footnote documents -- the ordinary law-review essay -- render correctly in
    LibreOffice, which (unlike x2t) applies proper HarfBuzz kerning and glyph
    positioning. See docs/investigations/2026-06-10_onlyoffice-vs-libreoffice.md.
    """
    import zipfile

    try:
        with zipfile.ZipFile(src) as z:
            names = set(z.namelist())
            for m in ("word/settings.xml", "word/document.xml"):
                if m not in names:
                    continue
                blob = z.read(m).decode("utf-8", "replace")
                if "numRestart" not in blob:
                    continue
                for val in ("eachSect", "eachPage"):
                    if f'w:numRestart w:val="{val}"' in blob \
                            or f"w:numRestart w:val='{val}'" in blob:
                        return True
    except Exception:
        return False
    return False


def _inject_kerning(pdf_path: Path, font_dir: "Path | None") -> bool:
    """Add GPOS/`kern` pair kerning to an x2t-produced PDF in place.

    x2t's docx->PDF path (sdkjs in V8) applies NO pair kerning -- it positions
    glyphs by their nominal advance only (verified cache-proof: stripping a
    font's GPOS or `kern` table leaves x2t's output width unchanged). The actual
    shaping is done by ``scripts/x2t_kern.py``, run via ``uv`` so its deps
    (uharfbuzz/pikepdf/fontTools) need not be in the ambient python. It is fed
    the staged render faces (the exact files x2t embedded, GPOS intact).

    Best-effort: returns False and leaves the PDF untouched if ``uv`` or the
    staged faces are unavailable. See
    docs/investigations/2026-06-19_x2t-kerning-patch.md.
    """
    if not font_dir or not Path(font_dir).is_dir():
        return False
    uv = shutil.which("uv")
    if not uv:
        return False
    helper = Path(__file__).resolve().parent / "x2t_kern.py"
    if not helper.is_file():
        return False
    try:
        subprocess.run(
            [uv, "run", "--with", "uharfbuzz", "--with", "pikepdf",
             "--with", "fonttools", "python3", str(helper),
             str(pdf_path), str(font_dir)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=120,
        )
        return True
    except Exception:
        return False


def _run_x2t(src: Path, dst: Path, timeout: int) -> None:
    with tempfile.TemporaryDirectory(prefix="x2t-") as tmp:
        nix_bin = _nix_mode_bindir("x2t")
        if nix_bin is not None:
            exe, cwd = nix_bin / "x2t", Path(tmp)
            # Prefer a pool restricted to the document's own font families:
            # x2t selects render faces from m_sFontDir, and the full ~800-font
            # system pool makes its matcher mis-resolve bold/italic of a serif
            # family to Arial. Fall back to the full merged dir otherwise.
            fonts = _doc_focused_dir(src) or font_dir()
            fonts_elem = f"\n  <m_sFontDir>{fonts}</m_sFontDir>" if fonts else ""
        else:
            fonts = _doc_focused_dir(src) or font_dir() or _bundled_fonts_dir()
            app = _app_dir()  # after font_dir() so a rebuild re-inits the index
            exe, cwd = app / "x2t", app
            fonts_elem = f"\n  <m_sFontDir>{fonts}</m_sFontDir>"
        params = Path(tmp) / "params.xml"
        params.write_text(
            _PARAMS_TEMPLATE.format(
                src=src.resolve(), dst=dst.resolve(),
                tmp=Path(tmp) / "work", fonts_elem=fonts_elem,
            )
        )
        (Path(tmp) / "work").mkdir()
        subprocess.run(
            [str(exe), str(params)],
            cwd=cwd,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )


def _run_docbuilder(script_text: str, timeout: int) -> None:
    """Run a .docbuilder script with the source-built (watermark-free)
    docbuilder. Official prebuilt binaries watermark output — only use a
    source build (nix onlyoffice-docbuilder package on both platforms)."""
    nix_bin = _nix_mode_bindir("docbuilder")
    if nix_bin is not None:
        exe, cwd = nix_bin / "docbuilder", None
    else:
        if not shutil.which("docbuilder"):
            raise RuntimeError(
                "docbuilder not on PATH: install the onlyoffice-docbuilder "
                "nix package (~/nix, source-built, watermark-free)"
            )
        font_dir()  # refresh merged cache so _app_dir can re-init the index
        app = _app_dir()
        exe, cwd = app / "docbuilder", app
    with tempfile.TemporaryDirectory(prefix="docbuilder-") as tmp:
        script = Path(tmp) / "script.docbuilder"
        script.write_text(script_text)
        subprocess.run(
            [str(exe), str(script)],
            cwd=cwd,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )


def recalc_xlsx(
    src: Path | str,
    dst: Path | str | None = None,
    *,
    timeout: int = 300,
) -> Path:
    """Recalculate all formulas in an xlsx and write cached values back.

    Replaces the LibreOffice-macro approach (skills/xlsx/recalc.py upstream):
    docbuilder's Api.RecalculateAllFormulas() computes the formula graph and
    the saved workbook carries cached values readable via
    openpyxl load_workbook(data_only=True). Verified watermark-free with the
    source-built docbuilder (2026-06-10). Defaults to in-place.
    """
    src = Path(src)
    if not src.exists():
        raise FileNotFoundError(src)
    out = Path(dst) if dst else src
    with tempfile.TemporaryDirectory(prefix="recalc-") as tmp:
        tmp_out = Path(tmp) / ("recalc_" + src.name)
        _run_docbuilder(
            f'builder.OpenFile("{src.resolve()}");\n'
            "Api.RecalculateAllFormulas();\n"
            f'builder.SaveFile("xlsx", "{tmp_out}");\n'
            "builder.CloseFile();\n",
            timeout,
        )
        if not tmp_out.exists() or tmp_out.stat().st_size == 0:
            raise RuntimeError("docbuilder exited 0 but produced no output")
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(tmp_out), str(out))
    return out


def _run_soffice(soffice: str, src: Path, dst: Path, timeout: int) -> None:
    fmt = dst.suffix.lstrip(".")
    with tempfile.TemporaryDirectory(prefix="soffice-") as tmp:
        # Isolate the LibreOffice profile per call. Without a dedicated
        # UserInstallation (and a clean HOME) soffice silently no-ops on a
        # locked/shared profile -- exits 0, writes nothing. The file:// URL form
        # of -env:UserInstallation is required.
        profile = Path(tmp) / "profile"
        env = dict(os.environ, HOME=str(Path(tmp) / "home"))
        (Path(tmp) / "home").mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [soffice, f"-env:UserInstallation=file://{profile}",
             "--headless", "--norestore", "--convert-to", fmt,
             "--outdir", tmp, str(src)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            env=env,
        )
        produced = Path(tmp) / (src.stem + dst.suffix)
        if produced.exists():
            shutil.move(str(produced), str(dst))


def _unwrap_soffice(cand: str) -> str | None:
    """Resolve a soffice candidate to a usable executable.

    On macOS, nixpkgs' ``bin/soffice`` is a one-line bash launcher that runs
    ``open -na LibreOffice.app`` -- that detaches the GUI app, returns 0
    immediately, and never performs (or waits for) a headless conversion. The
    actual synchronous CLI binary lives at ``.../LibreOffice.app/Contents/
    MacOS/soffice``. Detect the launcher and redirect to the bundle binary.
    """
    p = Path(cand)
    if not p.exists():
        return None
    try:
        head = p.read_bytes()[:512]
    except Exception:
        head = b""
    if head[:2] == b"#!" and b"open -na" in head:
        m = re.search(rb"(/\S+?\.app)", head)
        if m:
            bundle = Path(m.group(1).decode()) / "Contents/MacOS/soffice"
            if bundle.exists():
                return str(bundle)
        return None  # launcher we cannot unwrap is useless headless
    return cand


def find_soffice(explicit: str | None = None) -> str | None:
    import glob as _glob

    cands = [
        explicit,
        os.environ.get("SOFFICE_BIN"),
        shutil.which("soffice"),
        shutil.which("libreoffice"),
        str(Path.home() / ".nix-profile/bin/soffice"),
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
    ]
    # nix-built LibreOffice not on PATH: the real CLI binary is inside the .app
    # bundle (bin/soffice there is the open-launcher). Prefer the bundle path.
    cands += sorted(_glob.glob(
        "/nix/store/*-libreoffice-*/Applications/LibreOffice.app"
        "/Contents/MacOS/soffice"))
    cands += sorted(_glob.glob("/nix/store/*-libreoffice-*/bin/soffice"))
    for cand in cands:
        if cand:
            resolved = _unwrap_soffice(cand)
            if resolved:
                return resolved
    return None


_WORD_APP = Path("/Applications/Microsoft Word.app")
_WORD_CONTAINER = Path.home() / "Library/Containers/com.microsoft.Word/Data"

# Render via Word: activate, open, wait for the doc (large docs open async),
# optionally update all fields (REF/NOTEREF/PAGEREF/TOC/SEQ -> live values),
# save as PDF, close defensively. Reference the doc BY NAME (item 4 = the staged
# doc's name, e.g. "in.docx") so we never grab a different document the user
# already has open; fall back to `active document` if the name lookup misses.
#
# Two timeout/diagnostic details that matter for big or awkward docs:
#   * `save as` is wrapped in `with timeout of 1800 seconds`. The PDF export of a
#     long doc (e.g. a 73-page brief with embedded fonts) takes well over the
#     default ~120s AppleEvent reply window; unwrapped it dies with -1712
#     "AppleEvent timed out" even though Word is still exporting. (Verified
#     2026-06-23.)
#   * A doc that fails to enter the `documents` collection gets a SPECIFIC error
#     (`WORDRENDER_NO_DOCUMENT`) so the caller can report the real cause — a
#     modal "recover unreadable content?" repair / Protected-View prompt that
#     blocks the open — instead of a generic failure. Do NOT add
#     `set display alerts to none` to silence that modal: with alerts off Word
#     resolves the repair prompt by SILENTLY DECLINING to open the doc (0
#     documents), which is worse than surfacing the blocked-open. (Verified
#     2026-06-23.)
_WORD_RENDER_SCPT = r'''
on run argv
  set docName to item 4 of argv
  tell application "Microsoft Word" to activate
  tell application "Microsoft Word"
    open (POSIX file (item 1 of argv))
    set d to missing value
    repeat 240 times
      try
        set d to document docName
        exit repeat
      end try
      delay 0.5
    end repeat
    if d is missing value then
      set ndocs to 0
      try
        set ndocs to count of documents
      end try
      if ndocs > 0 then
        set d to active document
      else
        error "WORDRENDER_NO_DOCUMENT: Word opened no document (a modal repair / Protected-View prompt likely blocked the open)"
      end if
    end if
    if (item 3 of argv) is "fields" then
      with timeout of 1800 seconds
        try
          update fields of d
        end try
      end timeout
    end if
    with timeout of 1800 seconds
      save as d file name (item 2 of argv) file format format PDF
    end timeout
    try
      close d saving no
    on error
      try
        close document docName saving no
      end try
    end try
  end tell
end run
'''


def find_word() -> bool:
    """True if Microsoft Word is installed with its sandbox container present."""
    return _WORD_APP.is_dir() and _WORD_CONTAINER.is_dir()


# word-remote: the real Word engine running in a QEMU Windows guest, driven over
# SSH. Provisioned by the `programs.wordRender` nix module (see
# ~/nix/modules/shared/word-render/README.md); the transport is
# word_render_remote.sh, which scp's the docx in, renders via COM in the guest's
# autologon desktop session, and scp's the PDF back.
#
# This is the ONLY faithful path on Linux, where `renderer="word"` cannot work
# at all (it drives Word.app through AppleEvents). It is equally usable from
# macOS against a guest on that host.
_WORD_REMOTE_SCRIPT = (
    Path.home() / ".local/share/word-render/word_render_remote.sh")


def find_word_remote() -> str | None:
    """Path to the word-remote transport, or None if the kit isn't installed.

    Deliberately does NOT probe the guest over SSH: that costs a network
    round-trip (and can hang on a suspended VM) on every ``convert()`` call,
    including the many that will never use this engine. A down or unprovisioned
    guest surfaces as a render error instead — which for an explicit
    ``renderer="word-remote"`` is exactly right, since explicit engines raise
    rather than fall back.
    """
    env = os.environ.get("WORD_RENDER_REMOTE")
    if env and Path(env).is_file():
        return env
    if _WORD_REMOTE_SCRIPT.is_file():
        return str(_WORD_REMOTE_SCRIPT)
    return shutil.which("word-render")


def _run_word_remote(script: str, src: Path, dst: Path, timeout: int) -> None:
    """Render a Word-openable source -> PDF through Word in the Windows guest.

    The guest needs the Windows-compatible Latin Modern set installed
    (`word-render-install-fonts`) for any document using those fonts; without
    it Word silently substitutes Cambria/Calibri and still exits 0. See the
    nix module's README.

    Legacy binary `.doc` goes STRAIGHT here, never through a soffice
    `.doc -> .docx` hop first: that conversion rewrites each footnote as a real
    `<w:footnoteRef/>` followed by a literal `<w:t>?</w:t>` run, so every
    footnote renders with a stray superscript question mark and the page count
    drifts. Word opens `.doc` natively and neither defect appears.
    """
    if dst.suffix.lower() != ".pdf" or src.suffix.lower() not in WORD_SRC_SUFFIXES:
        raise RuntimeError(
            f"word-remote renders {'/'.join(sorted(WORD_SRC_SUFFIXES))} -> .pdf only")
    with tempfile.TemporaryDirectory(prefix="word-remote-") as td:
        # Stage under a stable basename: the transport derives the guest-side
        # job name from the input, and spaces/odd characters in a real
        # manuscript filename would have to survive ssh -> cmd -> powershell.
        # The SUFFIX is preserved — Word dispatches on it, and a .doc staged as
        # .docx makes Word bail with no PDF and no error.
        staged = Path(td) / f"job{src.suffix.lower()}"
        shutil.copy2(src, staged)
        out = Path(td) / "job.pdf"
        proc = subprocess.run(
            [script, str(staged), str(out)],
            capture_output=True, text=True, timeout=timeout)
        if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()
            hint = ""
            if "did not complete" in (proc.stderr or ""):
                hint = (" — is the guest booted? "
                        "(start-tpm.sh & start-winvm.sh)")
            raise RuntimeError(
                f"word-remote render failed (exit {proc.returncode}){hint}: "
                + " | ".join(tail[-3:]))
        shutil.copy2(out, dst)


def _run_word_direct(src: Path, dst: Path, timeout: int,
                     update_fields: bool = True) -> None:
    """Drive Word in THIS process's GUI session via AppleEvents.

    Word is sandboxed: it freely accesses only its own container, so we stage
    src there, render, and copy the PDF out. macOS gotchas handled: strip
    com.apple.quarantine (else the file opens in Protected View, unscriptable);
    render inside the container (no powerbox "Grant File Access" prompt).

    Works only from a process that is (a) in the console GUI session (audit
    session shared with WindowServer) AND (b) granted Automation control of
    Microsoft Word in TCC. A foreground terminal (cmux/wezterm/Terminal) is
    both; a detached/launchd background job is NEITHER, so the `open`/`save as`
    AppleEvents fail with -600 "Application isn't running" — that is the signal
    for `_run_word` to retry via a cmux pane. See docs/investigations/
    2026-06-22_word-render-cmux-dispatch.md.
    """
    if dst.suffix.lower() != ".pdf" or src.suffix.lower() not in WORD_SRC_SUFFIXES:
        raise RuntimeError(
            f"Word backend only renders {'/'.join(sorted(WORD_SRC_SUFFIXES))} -> PDF")
    if not find_word():
        raise RuntimeError("Microsoft Word not installed")
    import uuid
    work = _WORD_CONTAINER / "wordrender" / uuid.uuid4().hex
    work.mkdir(parents=True, exist_ok=True)
    in_doc, out_pdf = work / "in.docx", work / "out.pdf"
    scpt = work / "render.scpt"
    try:
        shutil.copyfile(src, in_doc)
        subprocess.run(["xattr", "-c", str(in_doc)], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        scpt.write_text(_WORD_RENDER_SCPT)
        # Capture osascript's stderr (NOT DEVNULL): the AppleScript error text
        # (-600 detached session, -1712 timeout, WORDRENDER_NO_DOCUMENT modal,
        # ...) is the actual diagnosis and must reach the caller, not be
        # swallowed.
        proc = subprocess.run(
            ["osascript", str(scpt), str(in_doc), str(out_pdf),
             "fields" if update_fields else "nofields", in_doc.name],
            timeout=timeout, capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"Word (direct) failed: {proc.stderr.strip() or proc.stdout.strip()}"
            )
        if not out_pdf.exists() or out_pdf.stat().st_size == 0:
            raise RuntimeError("Word exited but produced no PDF")
        shutil.copyfile(out_pdf, dst)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# --- cmux dispatch: render Word from a detached/background job ---------------
#
# A faithful Word render needs a process in the *console* GUI session that is
# TCC-granted to control Word. A Claude background job (and any launchd-detached
# process) is in neither: it lives in a separate GUI session whose app launches
# have no WindowServer, so Word's window ops fail with AppleEvent -600. cmux is
# a GUI terminal already running in the console session and TCC-granted to
# control Word; its terminal panes are children of the cmux GUI process, so a
# shell command run *inside a cmux pane* inherits the working session+grant.
#
# So: create a non-focused helper pane via the cmux control socket, `cmux send`
# a render command into it, poll for a sentinel file, and close the pane. This
# requires cmux's socket control to be enabled (automation.socketControlMode in
# ~/.config/cmux/cmux.json set to "automation"/"password"/"allowAll", not the
# default "cmuxOnly") and Microsoft Word granted to cmux under System Settings →
# Privacy & Security → Automation. Disable this path with $DOC_RENDER_NO_CMUX=1.
# See docs/investigations/2026-06-22_word-render-cmux-dispatch.md.

_CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux"


def _cmux_cli() -> "str | None":
    if os.environ.get("DOC_RENDER_NO_CMUX"):
        return None
    cli = shutil.which("cmux") or (_CMUX_BIN if Path(_CMUX_BIN).exists() else None)
    return cli


def _cmux(cli: str, *args: str, timeout: int = 15) -> subprocess.CompletedProcess:
    return subprocess.run([cli, *args], capture_output=True, text=True,
                          timeout=timeout)


def _cmux_reachable(cli: str) -> bool:
    try:
        r = _cmux(cli, "ping", timeout=10)
        return r.returncode == 0 and "PONG" in r.stdout
    except Exception:
        return False


def _cmux_focused_workspace(cli: str) -> "str | None":
    import json
    try:
        r = _cmux(cli, "identify", timeout=10)
        if r.returncode != 0:
            return None
        return json.loads(r.stdout)["focused"]["workspace_ref"]
    except Exception:
        return None


def _cmux_new_helper_surface(cli: str, workspace: str) -> "str | None":
    """Create a non-focused right-side terminal pane; return its surface ref.

    `--focus false` keeps the user's attention where it is (the render pane
    appears but never steals focus). Output is like ``OK surface:6 pane:4 ...``.
    """
    try:
        r = _cmux(cli, "new-pane", "--workspace", workspace, "--type",
                  "terminal", "--direction", "right", "--focus", "false",
                  timeout=15)
    except Exception:
        return None
    if r.returncode != 0:
        return None
    m = re.search(r"surface:\d+", r.stdout)
    return m.group(0) if m else None


def _run_word_via_cmux(src: Path, dst: Path, timeout: int,
                       update_fields: bool = True) -> None:
    """Render docx->PDF by dispatching the Word render into a cmux pane.

    Stages the doc + an osascript runner inside Word's container, opens a
    non-focused cmux helper pane (which lives in the console GUI session with
    cmux's TCC Automation grant), `cmux send`s the runner into it, polls for a
    sentinel, copies the PDF out, and closes the pane. Raises on any failure so
    convert() can fall back to LibreOffice/x2t.
    """
    import time
    import uuid
    if dst.suffix.lower() != ".pdf" or src.suffix.lower() not in WORD_SRC_SUFFIXES:
        raise RuntimeError(
            f"Word backend only renders {'/'.join(sorted(WORD_SRC_SUFFIXES))} -> PDF")
    if not find_word():
        raise RuntimeError("Microsoft Word not installed")
    cli = _cmux_cli()
    if not cli or not _cmux_reachable(cli):
        raise RuntimeError("cmux control socket not reachable (enable "
                           "automation.socketControlMode in cmux.json)")
    workspace = _cmux_focused_workspace(cli)
    if not workspace:
        raise RuntimeError("cmux: could not resolve a target workspace")

    work = _WORD_CONTAINER / "wordrender" / uuid.uuid4().hex
    work.mkdir(parents=True, exist_ok=True)
    in_doc, out_pdf = work / "in.docx", work / "out.pdf"
    scpt, runner = work / "render.scpt", work / "run.sh"
    done, log, started = work / "done", work / "run.log", work / "started"
    surface = None
    try:
        shutil.copyfile(src, in_doc)
        subprocess.run(["xattr", "-c", str(in_doc)], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        scpt.write_text(_WORD_RENDER_SCPT)
        fields = "fields" if update_fields else "nofields"
        # `started` is written the instant the pane's shell runs the script — it
        # distinguishes "the pane never executed anything" (a cmux helper pane
        # whose shell did not spawn — see the readiness check below) from "the
        # render itself ran and failed/stalled" (we then have run.log).
        runner.write_text(
            "#!/bin/bash\n"
            f'echo started > "{started}"\n'
            f'/usr/bin/osascript "{scpt}" "{in_doc}" "{out_pdf}" '
            f'"{fields}" "in.docx" > "{log}" 2>&1\n'
            f'echo "rc=$?" >> "{log}"\n'
            f'echo done > "{done}"\n'
        )
        runner.chmod(0o755)

        surface = _cmux_new_helper_surface(cli, workspace)
        if not surface:
            raise RuntimeError("cmux: could not create a render pane")
        # Literal '\n' tells `cmux send` to press Enter in the pane.
        r = _cmux(cli, "send", "--surface", surface, "--",
                  f'bash "{runner}"\\n', timeout=15)
        if r.returncode != 0:
            raise RuntimeError(f"cmux send failed: {r.stderr.strip()}")

        # Readiness gate: a freshly-created cmux helper pane sometimes has no
        # live shell yet (cmux can defer spawning the pane's shell), so the
        # `cmux send` lands in a dead PTY and nothing runs. Wait up to 30s for
        # the `started` sentinel; if it never appears the pane shell never ran
        # and we say so explicitly instead of mislabeling it a render timeout.
        start_deadline = time.monotonic() + 30
        while time.monotonic() < start_deadline and not started.exists():
            time.sleep(1)
        if not started.exists():
            raise RuntimeError(
                "cmux helper pane shell did not start (no live shell to run the "
                "render; the pane's PTY consumed nothing). Retry, or render from "
                "a foreground terminal.")

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not done.exists():
            time.sleep(2)
        if not done.exists():
            tail = log.read_text()[-800:] if log.exists() else "(no log yet)"
            raise RuntimeError(f"Word render via cmux timed out; log: {tail}")
        if not out_pdf.exists() or out_pdf.stat().st_size == 0:
            tail = log.read_text()[-800:] if log.exists() else "(no log)"
            raise RuntimeError(f"Word via cmux produced no PDF; log: {tail}")
        shutil.copyfile(out_pdf, dst)
    finally:
        if surface:
            try:
                _cmux(cli, "close-surface", "--surface", surface, timeout=10)
            except Exception:
                pass
        shutil.rmtree(work, ignore_errors=True)


def _drive_word(src: Path, dst: Path, timeout: int, update_fields: bool) -> None:
    """Drive Word to render src->dst: direct AppleEvents, then cmux dispatch.

    Tries the direct path first (works from a foreground/granted GUI terminal);
    on failure — the tell-tale being AppleEvent -600 from a detached/launchd
    background job in a non-console GUI session without Word's TCC grant — it
    retries by dispatching into a cmux pane that has both
    (``_run_word_via_cmux``).
    """
    try:
        _run_word_direct(src, dst, timeout, update_fields)
        return
    except Exception as direct_err:
        if _cmux_cli() is None:
            raise
        try:
            _run_word_via_cmux(src, dst, timeout, update_fields)
            return
        except Exception as cmux_err:
            raise RuntimeError(
                f"Word direct render failed ({direct_err}); "
                f"cmux dispatch also failed ({cmux_err})"
            )


def _word_preflight(src: Path, timeout: int) -> "tuple[Path, str | None, Path | None, bool]":
    """Repair a Google Docs-export package so Word won't reject it on open.

    Composes the standalone ``docx_repair`` util (separate concern, not coupled
    in): if the .docx has OPC integrity problems (e.g. the case-broken
    ``customXML`` refs a Google export emits — which make Word pop a "recover
    unreadable content" modal that a background job can't dismiss), repair it to
    a temp copy. A clean docx is returned untouched (full Word fidelity).

    Returns ``(path_to_render, note, tmpdir_to_clean, did_reserialize)``.
    """
    if src.suffix.lower() != ".docx":
        return src, None, None, False
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import docx_repair
        issues = docx_repair.opc_integrity_issues(src)
    except Exception:
        return src, None, None, False
    if not issues:
        return src, None, None, False
    tmpdir = Path(tempfile.mkdtemp(prefix="wordprep-"))
    try:
        res = docx_repair.repair_docx(src, tmpdir / src.name, timeout=timeout)
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return src, None, None, False
    note = (f"repaired Google-export package via {res.method} "
            f"({len(issues)} OPC issue(s))")
    return res.dst, note, tmpdir, res.method == "reserialize"


def _run_word(src: Path, dst: Path, timeout: int,
              update_fields: bool = True) -> None:
    """Render docx->PDF via Microsoft Word — gold-standard fidelity (native
    kerning/layout) and the only engine that can recompute Word fields.

    Three stages: (1) a preflight that repairs a corrupt Google-export package
    via the standalone ``docx_repair`` util so Word doesn't pop a repair modal;
    (2) drive Word (direct AppleEvents, then cmux dispatch from a background
    job); (3) if Word STILL reports the doc unreadable
    (``WORDRENDER_NO_DOCUMENT``) and the preflight didn't already reserialize,
    reserialize via docbuilder and retry once. Needs Word in Full Disk Access.
    NOT parallel-safe. Best-effort: raises on any failure so convert() can fall
    back to LibreOffice/x2t.
    """
    prepared, note, tmpdir, did_reserialize = _word_preflight(src, timeout)
    if note:
        print(f"doc_render: Word preflight — {note}", file=sys.stderr)
    try:
        try:
            _drive_word(prepared, dst, timeout, update_fields)
            return
        except Exception as err:
            if "WORDRENDER_NO_DOCUMENT" not in str(err) or did_reserialize:
                raise
            # Word still calls the doc unreadable and we haven't reserialized —
            # apply the docbuilder big hammer and retry once.
            try:
                import docx_repair
                reb = docx_repair.reserialize_docx(prepared, timeout=timeout)
            except Exception:
                reb = None
            if reb is None:
                raise
            print("doc_render: Word rejected the doc as unreadable; reserialized "
                  "via docbuilder and retrying", file=sys.stderr)
            try:
                _drive_word(reb, dst, timeout, update_fields)
                return
            finally:
                shutil.rmtree(reb.parent, ignore_errors=True)
    finally:
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)


def convert(
    src: Path | str,
    dst: Path | str,
    *,
    timeout: int = 300,
    soffice: str | None = None,
    kern: bool | None = None,
    renderer: str = "auto",
    allow_word: bool = False,
    update_fields: bool = True,
) -> Path:
    """Convert src to dst (format inferred from dst extension). Returns dst.

    Three docx->PDF engines, in descending fidelity: **Word > LibreOffice >
    x2t**, each with its own fixes.
      * **Word** (``_run_word``): gold standard — native kerning/layout and the
        only engine that recomputes Word fields (REF/NOTEREF/PAGEREF/TOC). But
        GUI-driven: not headless, not parallel-safe, needs Word in Full Disk
        Access. So it is OPT-IN: ``renderer="word"`` or ``allow_word=True``.
      * **LibreOffice** (``_run_soffice``): correct HarfBuzz kerning; WRONG for
        docs that restart footnote numbering per section/page.
      * **x2t** (``_run_x2t``): correct footnote-restart; needs our render-time
        GPOS/kern injection (``kern``) and EB-Garamond substitution to match.

    ``renderer``: ``"auto"`` (default) uses Word if ``allow_word`` and available,
    else LibreOffice for ordinary docs and x2t for footnote-restart docs
    (``_docx_restarts_footnotes``); or force ``"word"``/``"soffice"``/``"x2t"``.
    Only ``"auto"`` falls back through the other engines if its first choice
    fails. An EXPLICIT ``renderer`` runs ONLY that engine and raises its real
    error on failure — it never silently substitutes a lower-fidelity engine
    (so ``--renderer word`` never quietly returns an x2t/LibreOffice PDF). Every
    engine failure is also logged to stderr.

    ``allow_word`` lets ``"auto"`` pick Word (default False — keeps auto
    headless/parallel-safe). ``update_fields`` (Word only) updates all fields
    before export. ``kern`` controls x2t GPOS/kern injection (None=auto: on for
    non-justified docs; ``$X2T_KERN``=1/0 overrides). Non-docx/non-PDF: the
    first available engine is used. Raises if none succeed.
    """
    src, dst = Path(src), Path(dst)
    if not src.exists():
        raise FileNotFoundError(src)
    if dst.suffix.lower() not in _X2T_OUTPUT_EXTS:
        raise ValueError(f"unsupported output format: {dst.suffix}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.unlink(missing_ok=True)

    x2t = shutil.which("x2t")
    sof = find_soffice(soffice)
    word = find_word()
    wremote = find_word_remote()
    is_docx_pdf = (dst.suffix.lower() == ".pdf"
                   and src.suffix.lower() == ".docx")
    # The Word engines also take legacy `.doc`; the x2t/soffice-specific
    # branches below stay keyed on is_docx_pdf, which reads the OOXML zip.
    is_word_pdf = (dst.suffix.lower() == ".pdf"
                   and src.suffix.lower() in WORD_SRC_SUFFIXES)
    avail = {"word": bool(word and is_word_pdf), "soffice": bool(sof),
             "x2t": bool(x2t),
             "word-remote": bool(wremote and is_word_pdf)}

    # Primary engine choice.
    use = renderer
    if use == "auto":
        restarts = is_docx_pdf and x2t and _docx_restarts_footnotes(src)
        if avail["word"] and allow_word:
            use = "word"
        # word-remote is gated behind the same allow_word opt-in as local Word:
        # it is equally not-parallel-safe (one guest, one Word) and costs a VM
        # round-trip. But when Word is wanted and unavailable locally — i.e.
        # every Linux host — it is the faithful path, so prefer it over the
        # lower-fidelity engines rather than silently downgrading.
        elif avail["word-remote"] and allow_word:
            use = "word-remote"
        elif is_docx_pdf and sof and not restarts:
            use = "soffice"
        elif x2t:
            use = "x2t"
        elif sof:
            use = "soffice"
        elif avail["word"]:
            use = "word"
        else:
            use = "x2t"  # raises below with the install hint

    # An EXPLICIT engine (renderer != "auto") is a request to use THAT engine —
    # not "try it, then silently substitute a lower-fidelity one." Falling back
    # would hand back e.g. an ONLYOFFICE/x2t PDF under `--renderer word` and hide
    # the real Word error, which is exactly the failure this path must not have.
    # So for an explicit renderer we run only that engine and surface its error;
    # only "auto" cascades through the rest (best-effort).
    explicit = renderer != "auto"
    # word-remote is NOT in the auto cascade: a fallback that boots/uses a VM is
    # not something "best effort" should reach for behind the caller's back. It
    # runs only when chosen above (allow_word) or requested explicitly.
    order = [use] if explicit else (
        [use] + [e for e in ("soffice", "x2t", "word") if e != use])
    runners = {
        "word": lambda: _run_word(src, dst, max(timeout, 600), update_fields),
        "word-remote": lambda: _run_word_remote(
            wremote, src, dst, max(timeout, 900)),
        "soffice": lambda: _run_soffice(sof, src, dst, timeout),
        "x2t": lambda: _run_x2t(src, dst, timeout),
    }
    if explicit and not avail.get(use):
        raise RuntimeError(
            f"renderer={use!r} requested but unavailable for this conversion "
            f"(src={src.suffix}, dst={dst.suffix}); availability={avail}")
    tool, last_err = None, None
    for e in order:
        if not avail.get(e):
            continue
        try:
            runners[e]()
            if not dst.exists() or dst.stat().st_size == 0:
                raise RuntimeError(f"{e} exited but did not produce {dst}")
            tool = e
            break
        except Exception as ex:
            last_err = ex
            dst.unlink(missing_ok=True)
            # Never let an engine fail invisibly: a swallowed Word error is what
            # makes `--renderer word` quietly hand back an x2t PDF.
            print(f"doc_render: {e} renderer failed: {ex}", file=sys.stderr)
            if explicit:
                raise RuntimeError(
                    f"renderer={use!r} failed and no fallback is used for an "
                    f"explicit renderer: {ex}") from ex
    if tool is None:
        raise RuntimeError(
            "no converter succeeded: install Microsoft Word, LibreOffice, or "
            f"onlyoffice-x2t (`nix build ~/nix#onlyoffice-x2t`). Last error: "
            f"{last_err}")

    if kern is None:
        env = os.environ.get("X2T_KERN", "").strip().lower()
        if env in ("1", "true", "yes", "on"):
            kern = True
        elif env in ("0", "false", "no", "off"):
            kern = False
    if (
        tool == "x2t"
        and is_docx_pdf
        and kern is not False
        and (kern is True or not _docx_is_justified(src))
    ):
        _inject_kerning(dst, _doc_focused_dir(src) or font_dir())
    return dst


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path, nargs="?")
    ap.add_argument("--recalc", action="store_true",
                    help="recalculate xlsx formulas (writes cached values; "
                         "in-place unless dst given)")
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--renderer",
                    choices=("auto", "word", "word-remote", "soffice", "x2t"),
                    default="auto",
                    help="docx->PDF engine: auto (LibreOffice for ordinary "
                         "docs, x2t for footnote-restart; Word if --allow-word) "
                         "or force word / word-remote / soffice / x2t. "
                         "'word' is macOS-only (AppleEvents to Word.app); "
                         "'word-remote' is the same engine in a Windows guest "
                         "over SSH and is the Word path on Linux")
    ap.add_argument("--allow-word", action="store_true",
                    help="let 'auto' use Microsoft Word (gold standard but "
                         "GUI-driven, not parallel-safe); falls to "
                         "'word-remote' where local Word is unavailable")
    ap.add_argument("--no-update-fields", dest="update_fields",
                    action="store_false",
                    help="Word backend: skip updating fields before export")
    kg = ap.add_mutually_exclusive_group()
    kg.add_argument("--kern", dest="kern", action="store_true", default=None,
                    help="force GPOS/kern injection into docx->PDF (x2t applies "
                         "none); default auto-on for non-justified docs")
    kg.add_argument("--no-kern", dest="kern", action="store_false",
                    help="disable kern injection")
    args = ap.parse_args()
    try:
        if args.recalc:
            out = recalc_xlsx(args.src, args.dst, timeout=args.timeout)
        else:
            if args.dst is None:
                ap.error("dst is required unless --recalc")
            out = convert(args.src, args.dst, timeout=args.timeout,
                          kern=args.kern, renderer=args.renderer,
                          allow_word=args.allow_word,
                          update_fields=args.update_fields)
    except Exception as e:
        sys.exit(f"ERROR: {e}")
    print(out)


if __name__ == "__main__":
    main()
