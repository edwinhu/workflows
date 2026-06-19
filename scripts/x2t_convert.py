#!/usr/bin/env python3
"""Convert office documents (docx/pptx/xlsx -> PDF/PNG/...) via ONLYOFFICE x2t,
falling back to LibreOffice (soffice) when x2t is not installed.

Why x2t first: it is OOXML-native (no ODF round-trip), so it renders Word
semantics that soffice gets wrong (verified 2026-06-10: footnote
``numRestart eachSect`` restarts at 1 per section under x2t; soffice numbers
continuously). It is also stateless — no user-profile lock, safe to run in
parallel — where soffice silently fails on macOS/nix with profile-lock issues.
See docs/investigations/2026-06-10_onlyoffice-vs-libreoffice.md.

x2t ships in the `onlyoffice-x2t` nix package (~/nix). It has no simple CLI:
it takes an XML params file and exits 0 even on some failures, so this wrapper
generates the XML, runs it, and verifies the output exists — callers get a
Path or an exception, never a silent miss.

Library use:
    sys.path.insert(0, str(plugin_root / "scripts"))
    from x2t_convert import convert
    convert(Path("in.docx"), Path("out.pdf"))

CLI use:
    python3 scripts/x2t_convert.py in.docx out.pdf
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
    # Per-family render override: ~/.config/x2t-render-fonts/<family>/ lets the
    # user substitute, for x2t rendering only (not the system/Word), a font
    # x2t lays out poorly. E.g. the macOS Garamond is a tight design whose only
    # kerning is a legacy `kern` table x2t mangles; dropping a clean GPOS-kerned
    # Garamond (EB Garamond renamed to "Garamond") there fixes the spacing
    # without touching how any other app resolves "Garamond".
    override_root = Path.home() / ".config" / "x2t-render-fonts"
    wanted: dict = {}
    for fam in fams:
        ov = override_root / fam
        if ov.is_dir():
            files = [p for p in ov.iterdir()
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


def convert(
    src: Path | str,
    dst: Path | str,
    *,
    timeout: int = 300,
    soffice: str | None = None,
    kern: bool | None = None,
    renderer: str = "auto",
) -> Path:
    """Convert src to dst (format inferred from dst extension). Returns dst.

    ``renderer`` selects the docx->PDF engine:
      * ``"auto"`` (default): **LibreOffice for ordinary (continuous-footnote)
        documents** -- it applies correct HarfBuzz kerning and glyph
        positioning -- and **x2t only when the docx restarts footnote numbering
        per section/page** (``_docx_restarts_footnotes``), the one case
        LibreOffice mis-renders. Non-docx sources, or when only one engine is
        installed, fall through to whatever is available.
      * ``"soffice"`` / ``"x2t"``: force that engine.
    For non-PDF output (or non-docx input) the renderer choice is moot and the
    first available engine is used.

    Raises RuntimeError if no converter is available or the output was not
    produced (both tools can exit 0 without writing output).

    ``kern`` controls render-time GPOS/`kern` injection for x2t docx->PDF
    output (x2t itself applies no pair kerning; see ``_inject_kerning``):
      * None (default) "auto": inject unless the docx justifies any paragraph
        (justified text would fall short of the right margin -- see
        ``_docx_is_justified``). Override with ``$X2T_KERN`` = 1/true or 0/false.
      * True / False: force on / off.
    Only applies to x2t (soffice already kerns) and .pdf output. Best-effort:
    silently skipped if uharfbuzz/pikepdf are unavailable.
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
    is_docx_pdf = (dst.suffix.lower() == ".pdf"
                   and src.suffix.lower() == ".docx")

    # Decide the engine. Default ("auto") prefers LibreOffice for ordinary
    # docx->PDF (correct kerning) and reserves x2t for footnote-restart docs.
    use = renderer
    if use == "auto":
        if is_docx_pdf and sof and not (x2t and _docx_restarts_footnotes(src)):
            use = "soffice"
        elif x2t:
            use = "x2t"
        elif sof:
            use = "soffice"
        else:
            use = "x2t"  # will raise below with the install hint
    if use == "soffice" and not sof:
        use = "x2t" if x2t else "soffice"
    if use == "x2t" and not x2t:
        use = "soffice" if sof else "x2t"

    if use == "x2t" and x2t:
        tool = "x2t"
        _run_x2t(src, dst, timeout)
    elif use == "soffice" and sof:
        tool = "soffice"
        _run_soffice(sof, src, dst, timeout)
    else:
        raise RuntimeError(
            "no converter found: install onlyoffice-x2t (`nix build "
            "~/nix#onlyoffice-x2t`) or LibreOffice"
        )

    if not dst.exists() or dst.stat().st_size == 0:
        raise RuntimeError(f"{tool} exited 0 but did not produce {dst}")

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
    ap.add_argument("--renderer", choices=("auto", "soffice", "x2t"),
                    default="auto",
                    help="docx->PDF engine: auto (LibreOffice for ordinary "
                         "docs, x2t only for footnote-restart docs), or force "
                         "soffice / x2t")
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
                          kern=args.kern, renderer=args.renderer)
    except Exception as e:
        sys.exit(f"ERROR: {e}")
    print(out)


if __name__ == "__main__":
    main()
