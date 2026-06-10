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
  <m_sTempDir>{tmp}</m_sTempDir>
  <m_sFontDir>{fonts}</m_sFontDir>
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

    index = app / "sdkjs" / "common" / "AllFonts.js"
    if not app.is_dir():
        app.parent.mkdir(parents=True, exist_ok=True)
        tmp_app = app.with_suffix(".partial")
        if tmp_app.exists():
            shutil.rmtree(tmp_app)
        shutil.copytree(tree, tmp_app)
        for p in [tmp_app, *tmp_app.rglob("*")]:
            p.chmod(p.stat().st_mode | 0o200)
        tmp_app.rename(app)
    elif _fonts_changed and index.exists():
        index.unlink()

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
        if f.is_file() and f.suffix.lower() in (".ttf", ".otf", ".ttc"):
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


def _run_x2t(src: Path, dst: Path, timeout: int) -> None:
    with tempfile.TemporaryDirectory(prefix="x2t-") as tmp:
        fonts = font_dir() or _bundled_fonts_dir()
        app = _app_dir()  # after font_dir() so a cache rebuild re-inits the index
        params = Path(tmp) / "params.xml"
        params.write_text(
            _PARAMS_TEMPLATE.format(
                src=src.resolve(), dst=dst.resolve(),
                tmp=Path(tmp) / "work", fonts=fonts,
            )
        )
        (Path(tmp) / "work").mkdir()
        subprocess.run(
            [str(app / "x2t"), str(params)],
            cwd=app,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )


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
    ap.add_argument("dst", type=Path)
    ap.add_argument("--timeout", type=int, default=300)
    args = ap.parse_args()
    try:
        convert(args.src, args.dst, timeout=args.timeout)
    except Exception as e:
        sys.exit(f"ERROR: {e}")
    print(args.dst)


if __name__ == "__main__":
    main()
