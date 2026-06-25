#!/usr/bin/env python3
"""Repair Google Docs-exported .docx packages that Word/LibreOffice reject.

Google Docs' .docx export emits OOXML that strict consumers (Microsoft Word,
LibreOffice) treat as corrupt — Word pops a "recover unreadable content?" modal,
LibreOffice refuses to load — while lenient engines (ONLYOFFICE/x2t) render it
fine. The recurring, concrete defects:

  1. Case-mismatched OPC part references. The export spells the customXml folder
     ``customXML`` (capital) in ``word/_rels/document.xml.rels`` Target AND in
     ``[Content_Types].xml`` Override PartName, but stores the part as
     ``customXml`` (lowercase). OPC part names are CASE-SENSITIVE, so the part is
     unreferenced and untyped -> "document appears corrupt." Confirmed by the
     docx skill's OOXML validator: ``CRITICAL: Unreferenced file:
     customXml/item1.xml``.
  2. ``<w:evenAndOddHeaders/>`` left in settings.xml -> Word renders phantom
     blank pages (the same residue the docx-repair skill strips).

This is a STANDALONE, general-docx utility. It is deliberately decoupled from
the two adjacent concerns:
  * Footnote repair (GDocs separator/mark/ID damage) -> the ``docx-repair``
    skill's ``fix_footnotes.py``.
  * PDF export (Word / x2t / LibreOffice) -> ``doc_render.py``.
The ``law-review-docx`` build chains all three; ``doc_render``'s Word preflight
composes THIS one so a Google export "just renders." Each is independently
usable on any .docx.

Repair strategy, cheapest first:
  * Case-normalize part references to the real part's casing — fidelity-
    preserving; touches only package wiring, never content.
  * Drop OOXML directives known to break Word (``evenAndOddHeaders``).
  * If the package is still structurally broken, reserialize via docbuilder
    (ONLYOFFICE, watermark-free) — guaranteed clean OOXML, at the cost of a
    re-layout. Opt out with ``reserialize_fallback=False``.

Library use:
    from docx_repair import repair_docx, opc_integrity_issues
    res = repair_docx("in.docx", "out.docx")          # -> RepairResult
    issues = opc_integrity_issues(Path("in.docx"))    # detect only ([] = clean)

CLI:
    python3 scripts/docx_repair.py in.docx                # in-place if dirty
    python3 scripts/docx_repair.py in.docx out.docx
    python3 scripts/docx_repair.py in.docx --dry-run      # report only
    python3 scripts/docx_repair.py in.docx --no-reserialize

See docs/investigations/2026-06-23_gdocs-customxml-case.md.
"""

from __future__ import annotations

import argparse
import posixpath
import re
import shutil
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

_RELATIONSHIP_RE = re.compile(r"<Relationship\b[^>]*?/?>")
_OVERRIDE_RE = re.compile(r"<Override\b[^>]*?/?>")
_EVEN_ODD_RE = re.compile(r"<w:evenAndOddHeaders\s*/>")


@dataclass
class RepairResult:
    """Outcome of :func:`repair_docx`."""

    src: Path
    dst: Path
    changed: bool
    method: str  # "none" | "normalize" | "reserialize"
    fixes: list[str] = field(default_factory=list)
    remaining_issues: list[str] = field(default_factory=list)


def _resolve_target(rels_name: str, target: str) -> str | None:
    """Resolve an internal relationship Target to a package part name.

    Returns None for external/non-part targets (http, mailto, ...). The base is
    the folder of the part that OWNS this .rels file: dir(dir(rels)) — e.g.
    ``word/_rels/document.xml.rels`` -> ``word``; ``_rels/.rels`` -> ``""``.
    """
    low = target.lower()
    if low.startswith(("http://", "https://", "mailto:", "file:", "ftp:")):
        return None
    base = posixpath.dirname(posixpath.dirname(rels_name))
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(base, target))


def opc_integrity_issues(src: Path) -> list[str]:
    """Human-readable OPC package integrity problems; ``[]`` means clean.

    Detects the concrete Google-export corruption that makes Word/LibreOffice
    reject a .docx:
      * relationship Targets that don't resolve (case-sensitively) to a part,
      * ``[Content_Types].xml`` Override PartNames that point at no part,
      * (informational) ``evenAndOddHeaders`` residue.
    Each entry is prefixed with a tag (``rel:`` / ``ct:`` / ``settings:``) so a
    caller can branch on severity. Non-docx or unreadable input -> ``[]``.
    """
    src = Path(src)
    if src.suffix.lower() != ".docx":
        return []
    issues: list[str] = []
    try:
        with zipfile.ZipFile(src) as z:
            names = set(z.namelist())
            for rels in (n for n in names if n.endswith(".rels")):
                blob = z.read(rels).decode("utf-8", "ignore")
                for tag in _RELATIONSHIP_RE.findall(blob):
                    if 'TargetMode="External"' in tag:
                        continue
                    tm = re.search(r'Target="([^"]+)"', tag)
                    if not tm:
                        continue
                    resolved = _resolve_target(rels, tm.group(1))
                    if resolved is None or resolved in names:
                        continue
                    issues.append(
                        f"rel: {rels} -> Target {tm.group(1)!r} does not resolve "
                        f"to a part (looked for {resolved!r})"
                    )
            if "[Content_Types].xml" in names:
                ct = z.read("[Content_Types].xml").decode("utf-8", "ignore")
                for tag in _OVERRIDE_RE.findall(ct):
                    pm = re.search(r'PartName="([^"]+)"', tag)
                    if pm and pm.group(1).lstrip("/") not in names:
                        issues.append(
                            f"ct: Override PartName {pm.group(1)!r} has no part"
                        )
            if "word/settings.xml" in names:
                st = z.read("word/settings.xml").decode("utf-8", "ignore")
                if _EVEN_ODD_RE.search(st):
                    issues.append(
                        "settings: <w:evenAndOddHeaders/> present (Word phantom "
                        "blank pages)"
                    )
    except Exception:
        return []
    return issues


def _corrected_target(rels_name: str, target: str, namemap: dict[str, str]) -> str | None:
    """If ``target`` is unresolvable only because of letter-case, return the
    corrected relative Target string; else None.

    ``namemap`` maps lowercased part name -> real part name.
    """
    resolved = _resolve_target(rels_name, target)
    if resolved is None:
        return None
    real = namemap.get(resolved.lower())
    if not real or real == resolved:
        return None
    base = posixpath.dirname(posixpath.dirname(rels_name))
    if target.startswith("/"):
        return "/" + real
    return posixpath.relpath(real, base) if base else real


def _rewrite_package(src: Path, dst: Path) -> list[str]:
    """Write ``dst`` from ``src`` with case-normalized part references and the
    ``evenAndOddHeaders`` directive removed. Returns the list of fixes applied.
    Every other part is copied byte-for-byte (content untouched).
    """
    fixes: list[str] = []
    with zipfile.ZipFile(src) as zin:
        infos = zin.infolist()
        data = {i.filename: zin.read(i.filename) for i in infos}
    namemap = {n.lower(): n for n in data}

    for name in list(data):
        if name.endswith(".rels"):
            text = data[name].decode("utf-8")

            def _fix(m: re.Match) -> str:
                tag = m.group(0)
                if 'TargetMode="External"' in tag:
                    return tag
                tm = re.search(r'Target="([^"]+)"', tag)
                if not tm:
                    return tag
                corrected = _corrected_target(name, tm.group(1), namemap)
                if corrected is None:
                    return tag
                fixes.append(
                    f"rel case: {name}: {tm.group(1)} -> {corrected}"
                )
                return tag.replace(
                    f'Target="{tm.group(1)}"', f'Target="{corrected}"'
                )

            new = _RELATIONSHIP_RE.sub(_fix, text)
            if new != text:
                data[name] = new.encode("utf-8")

    if "[Content_Types].xml" in data:
        text = data["[Content_Types].xml"].decode("utf-8")

        def _fix_ct(m: re.Match) -> str:
            tag = m.group(0)
            pm = re.search(r'PartName="([^"]+)"', tag)
            if not pm:
                return tag
            part = pm.group(1).lstrip("/")
            if part in data:
                return tag
            real = namemap.get(part.lower())
            if not real:
                return tag
            fixes.append(f"ct case: {pm.group(1)} -> /{real}")
            return tag.replace(f'PartName="{pm.group(1)}"', f'PartName="/{real}"')

        new = _OVERRIDE_RE.sub(_fix_ct, text)
        if new != text:
            data["[Content_Types].xml"] = new.encode("utf-8")

    if "word/settings.xml" in data:
        text = data["word/settings.xml"].decode("utf-8")
        new = _EVEN_ODD_RE.sub("", text)
        if new != text:
            fixes.append("settings: removed <w:evenAndOddHeaders/>")
            data["word/settings.xml"] = new.encode("utf-8")

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, blob in data.items():
            zi = zipfile.ZipInfo(name)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            zout.writestr(zi, blob)
    return fixes


def _reserialize(src: Path, dst: Path, timeout: int) -> bool:
    """Round-trip src->dst through docbuilder (ONLYOFFICE), which rewrites the
    whole package as clean OOXML. Lazy-imports doc_render to avoid a circular
    import (doc_render composes this module). Returns True on success.
    """
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from doc_render import _run_docbuilder  # type: ignore
    except Exception:
        return False
    try:
        _run_docbuilder(
            f'builder.OpenFile("{src.resolve()}");\n'
            f'builder.SaveFile("docx", "{dst.resolve()}");\n'
            "builder.CloseFile();\n",
            timeout,
        )
        return dst.exists() and dst.stat().st_size > 0
    except Exception:
        return False


def reserialize_docx(
    src: Path | str, dst: Path | str | None = None, *, timeout: int = 300
) -> Path | None:
    """Force a docbuilder round-trip (clean OOXML at the cost of a re-layout).

    The "big hammer": use when a package is *structurally valid* yet a strict
    consumer (Word) still rejects it. Returns the output path on success (a
    temp file under a fresh dir if ``dst`` is None — caller removes its parent),
    else None.
    """
    src = Path(src)
    out = Path(dst) if dst else Path(tempfile.mkdtemp(prefix="reserialize-")) / src.name
    out.parent.mkdir(parents=True, exist_ok=True)
    return out if _reserialize(src, out, timeout) else None


def repair_docx(
    src: Path | str,
    dst: Path | str | None = None,
    *,
    reserialize_fallback: bool = True,
    timeout: int = 300,
) -> RepairResult:
    """Repair a corrupt Google-export .docx so strict consumers accept it.

    Cheapest fix first (case-normalize part refs + strip ``evenAndOddHeaders``);
    if the package is still structurally broken and ``reserialize_fallback`` is
    set, reserialize via docbuilder. A clean input is a no-op (returned
    unchanged, full fidelity). ``dst`` defaults to in-place (only written when a
    change is actually made).
    """
    src = Path(src)
    if not src.exists():
        raise FileNotFoundError(src)
    out = Path(dst) if dst else src

    issues = opc_integrity_issues(src)
    if not issues:
        if dst and out != src:
            shutil.copyfile(src, out)
        return RepairResult(src, out, False, "none")

    with tempfile.TemporaryDirectory(prefix="docxrepair-") as td:
        work = Path(td) / "norm.docx"
        fixes = _rewrite_package(src, work)
        method = "normalize"
        remaining = opc_integrity_issues(work)

        # Residual corruption casing can't fix (or nothing fixable) -> reserialize.
        structural = [i for i in remaining if not i.startswith("settings:")]
        if structural and reserialize_fallback:
            reb = Path(td) / "reb.docx"
            if _reserialize(src, reb, timeout):
                work = reb
                method = "reserialize"
                fixes = ["reserialized via docbuilder (residual package corruption)"]
                remaining = opc_integrity_issues(work)

        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(work), str(out))

    return RepairResult(src, out, True, method, fixes, remaining)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path, nargs="?",
                    help="output path (default: in-place if repairs are needed)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report integrity issues and exit without writing")
    ap.add_argument("--no-reserialize", dest="reserialize", action="store_false",
                    help="skip the docbuilder reserialize fallback")
    ap.add_argument("--timeout", type=int, default=300)
    args = ap.parse_args()

    issues = opc_integrity_issues(args.src)
    if args.dry_run:
        if not issues:
            print(f"{args.src}: clean (no OPC integrity issues)")
        else:
            print(f"{args.src}: {len(issues)} issue(s):")
            for i in issues:
                print(f"  - {i}")
        return

    res = repair_docx(args.src, args.dst, reserialize_fallback=args.reserialize,
                      timeout=args.timeout)
    if not res.changed:
        print(f"{res.dst}: clean — no repair needed")
    else:
        print(f"{res.dst}: repaired via {res.method}")
        for f in res.fixes:
            print(f"  + {f}")
        if res.remaining_issues:
            print(f"  ! {len(res.remaining_issues)} issue(s) remain:")
            for i in res.remaining_issues:
                print(f"    - {i}")
            sys.exit(1)


if __name__ == "__main__":
    main()
