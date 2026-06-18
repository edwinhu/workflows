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
    wanted: dict = {}
    for fam in fams:
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
        for name, target in wanted.items():
            try:
                shutil.copyfile(target, out / name)
            except Exception:
                pass
    return out if any(out.iterdir()) else None


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
        subprocess.run(
            [soffice, "--headless", "--convert-to", fmt,
             "--outdir", tmp, str(src)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )
        produced = Path(tmp) / (src.stem + dst.suffix)
        if produced.exists():
            shutil.move(str(produced), str(dst))


def find_soffice(explicit: str | None = None) -> str | None:
    for cand in (
        explicit,
        shutil.which("soffice"),
        shutil.which("libreoffice"),
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
    ):
        if cand and Path(cand).exists():
            return cand
    return None


def convert(
    src: Path | str,
    dst: Path | str,
    *,
    timeout: int = 300,
    soffice: str | None = None,
) -> Path:
    """Convert src to dst (format inferred from dst extension). Returns dst.

    Tries x2t from PATH first; falls back to soffice if x2t is absent.
    Raises RuntimeError if no converter is available or the output was not
    produced (both tools can exit 0 without writing output).
    """
    src, dst = Path(src), Path(dst)
    if not src.exists():
        raise FileNotFoundError(src)
    if dst.suffix.lower() not in _X2T_OUTPUT_EXTS:
        raise ValueError(f"unsupported output format: {dst.suffix}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.unlink(missing_ok=True)

    x2t = shutil.which("x2t")
    tool = "x2t" if x2t else "soffice"
    if x2t:
        _run_x2t(src, dst, timeout)
    else:
        sof = find_soffice(soffice)
        if not sof:
            raise RuntimeError(
                "no converter found: install onlyoffice-x2t (preferred; "
                "`nix build ~/nix#onlyoffice-x2t`) or LibreOffice"
            )
        _run_soffice(sof, src, dst, timeout)

    if not dst.exists() or dst.stat().st_size == 0:
        raise RuntimeError(f"{tool} exited 0 but did not produce {dst}")
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
    args = ap.parse_args()
    try:
        if args.recalc:
            out = recalc_xlsx(args.src, args.dst, timeout=args.timeout)
        else:
            if args.dst is None:
                ap.error("dst is required unless --recalc")
            out = convert(args.src, args.dst, timeout=args.timeout)
    except Exception as e:
        sys.exit(f"ERROR: {e}")
    print(out)


if __name__ == "__main__":
    main()
