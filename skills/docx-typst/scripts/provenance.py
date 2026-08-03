#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["lxml"]
# ///
"""Read and write build provenance in a .docx's custom document properties.

A returned .docx has no memory of where it came from. Reconciliation needs one:
without the ancestor, a coauthor's edits and your own local edits have no common
base, and merging degrades to eyeballing two documents. So `build.py` stamps four
properties into `docProps/custom.xml` at build time:

    SourceSHA256   sha256 of the canonical source bytes that produced this docx
    SourcePath     repo-relative path of that source
    SourceGitSHA   git blob/commit sha the source was at, when in a git tree
    StampVersion   this stamp format's version, so a future reader can tell

`docProps/custom.xml` is chosen over core.xml because it is a documented extension
point Word round-trips without editing: Word shows these under File > Info >
Properties > Custom and does not rewrite their values. Google Docs DROPS them on
export — which is a known limitation, not a bug in this script, and is exactly why
`reconcile.py` has two fallbacks after the stamp.

Three package-level things must be present for the part to be legal OOXML, and a
pandoc-built docx may have none of them:

    1. the part itself, docProps/custom.xml
    2. an <Override> for it in [Content_Types].xml
    3. a relationship from _rels/.rels

Write all three or Word reports the file as corrupt. This script creates whichever
are absent and leaves the rest of the package byte-identical.

Usage:
    provenance.py read  FILE.docx                 # JSON of the stamped properties
    provenance.py stamp FILE.docx --source body.typ [--output OUT.docx]
    provenance.py stamp FILE.docx --set Key=Value [--set ...]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

STAMP_VERSION = "1"

CP = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
VT = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"

CUSTOM_PART = "docProps/custom.xml"
CUSTOM_CT = "application/vnd.openxmlformats-officedocument.custom-properties+xml"
CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties"

# The one fmtid every custom-properties part uses. Not a choice; it is fixed by the spec.
FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"

EMPTY_CUSTOM = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<Properties xmlns="{CP}" xmlns:vt="{VT}"/>'
).encode()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git_sha(path: Path) -> str:
    """The git blob sha of `path`, or "" outside a git tree / for an untracked file.

    A blob sha, not HEAD: it identifies the source CONTENT, so `git show <sha>` on it
    recovers the exact ancestor even if the commit was later amended or rebased away.
    """
    path = Path(path)
    try:
        out = subprocess.run(
            ["git", "-C", str(path.parent), "hash-object", str(path)],
            capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def read(docx: Path) -> dict:
    """Every custom property in the file, as a flat {name: value} dict."""
    with zipfile.ZipFile(docx) as z:
        if CUSTOM_PART not in z.namelist():
            return {}
        root = etree.fromstring(z.read(CUSTOM_PART))
    props = {}
    for prop in root.findall(f"{{{CP}}}property"):
        name = prop.get("name")
        if not name:
            continue
        # The value is the property's single typed child; lpwstr is what we write,
        # but read whatever type is there so a Word-authored property still surfaces.
        text = "".join(child.text or "" for child in prop)
        props[name] = text
    return props


def _build_custom_xml(existing: bytes | None, updates: dict) -> bytes:
    root = etree.fromstring(existing if existing else EMPTY_CUSTOM)
    by_name = {p.get("name"): p for p in root.findall(f"{{{CP}}}property")}

    for name, value in updates.items():
        prop = by_name.get(name)
        if prop is not None:
            for child in list(prop):
                prop.remove(child)
        else:
            prop = etree.SubElement(root, f"{{{CP}}}property")
            prop.set("fmtid", FMTID)
            prop.set("name", name)
            by_name[name] = prop
        etree.SubElement(prop, f"{{{VT}}}lpwstr").text = str(value)

    # pid must be unique and start at 2 (0 and 1 are reserved). Renumber every
    # property rather than appending: a pid collision makes Word reject the part,
    # and the file we are stamping may already carry properties from a template.
    for i, prop in enumerate(root.findall(f"{{{CP}}}property"), start=2):
        prop.set("pid", str(i))

    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _ensure_content_type(data: bytes) -> bytes:
    root = etree.fromstring(data)
    for ov in root.findall(f"{{{CT}}}Override"):
        if ov.get("PartName") == f"/{CUSTOM_PART}":
            return data
    ov = etree.SubElement(root, f"{{{CT}}}Override")
    ov.set("PartName", f"/{CUSTOM_PART}")
    ov.set("ContentType", CUSTOM_CT)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _ensure_relationship(data: bytes) -> bytes:
    root = etree.fromstring(data)
    used = set()
    for rel in root.findall(f"{{{PR}}}Relationship"):
        if rel.get("Type") == CUSTOM_REL:
            return data
        used.add(rel.get("Id"))
    n = 1
    while f"rId{n}" in used:
        n += 1
    rel = etree.SubElement(root, f"{{{PR}}}Relationship")
    rel.set("Id", f"rId{n}")
    rel.set("Type", CUSTOM_REL)
    rel.set("Target", CUSTOM_PART)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def stamp(docx: Path, updates: dict, output: Path | None = None) -> Path:
    """Write `updates` into the docx's custom properties, creating package wiring as needed.

    Rewrites the whole zip because a zip member cannot be replaced in place. Every
    other part is copied through byte-for-byte.
    """
    docx = Path(docx)
    target = Path(output) if output else docx

    with zipfile.ZipFile(docx) as z:
        names = z.namelist()
        parts = {n: z.read(n) for n in names}

    parts[CUSTOM_PART] = _build_custom_xml(parts.get(CUSTOM_PART), updates)
    if "[Content_Types].xml" in parts:
        parts["[Content_Types].xml"] = _ensure_content_type(parts["[Content_Types].xml"])
    if "_rels/.rels" in parts:
        parts["_rels/.rels"] = _ensure_relationship(parts["_rels/.rels"])

    order = list(names) + [n for n in parts if n not in names]
    # [Content_Types].xml must be the first member of an OPC package.
    order.sort(key=lambda n: 0 if n == "[Content_Types].xml" else 1)

    tmp = Path(tempfile.mkdtemp()) / "out.docx"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for name in order:
            z.writestr(name, parts[name])
    shutil.move(str(tmp), str(target))
    return target


def source_properties(source: Path) -> dict:
    source = Path(source)
    return {
        "SourceSHA256": sha256_file(source),
        "SourcePath": str(source),
        "SourceGitSHA": git_sha(source),
        "StampVersion": STAMP_VERSION,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("read", help="print custom properties as JSON")
    r.add_argument("docx", type=Path)

    s = sub.add_parser("stamp", help="write provenance properties")
    s.add_argument("docx", type=Path)
    s.add_argument("--source", type=Path, help="source file whose sha/path/git-sha to record")
    s.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                   help="set an arbitrary property (repeatable)")
    s.add_argument("--output", type=Path, help="write here instead of in place")

    args = ap.parse_args(argv)

    if args.cmd == "read":
        print(json.dumps(read(args.docx), indent=2, sort_keys=True))
        return 0

    updates = {}
    if args.source:
        updates.update(source_properties(args.source))
    for pair in args.set:
        if "=" not in pair:
            print(f"error: --set expects KEY=VALUE, got {pair!r}", file=sys.stderr)
            return 2
        k, v = pair.split("=", 1)
        updates[k] = v
    if not updates:
        print("error: nothing to stamp; pass --source and/or --set", file=sys.stderr)
        return 2

    out = stamp(args.docx, updates, args.output)
    print(json.dumps({"stamped": str(out), "properties": updates}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
