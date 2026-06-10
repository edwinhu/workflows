#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["lxml", "pymupdf"]
# ///
"""Refresh stale NOTEREF cross-reference caches in a law-review .docx.

THE PROBLEM THIS SOLVES
-----------------------
Cross-references in these papers ("supra/infra note N") are Word ``NOTEREF``
fields pointing to bookmarks, each carrying a *cached* number that only
refreshes when an editor recomputes fields. When a coauthor inserts, moves, or
deletes footnotes in Word (tracked changes), the footnote MARKERS auto-renumber
but the NOTEREF caches do NOT — so every downstream cross-reference silently
shows the wrong number.

WHY THE OBVIOUS APPROACHES FAIL (learned the hard way)
-----------------------------------------------------
* "+N to everything downstream" is wrong: the offset is not uniform.
* Computing numbering from ``document.xml`` order is wrong, because
    - the 3 author-bio footnotes use ``customMarkFollows`` (*, †, ‡) and are
      NOT counted in the numeric sequence, and
    - a tracked footnote *move* makes XML linear order diverge from rendered
      order in a localized block (counts reconverge by the end).
* Verifying with LibreOffice's INLINE cross-ref render is wrong: LibreOffice
  always recomputes NOTEREF on load AND excludes unaccepted tracked-inserted
  footnotes from the field computation — so it shows cross-refs ~2 low even
  though it numbers the page-bottom markers correctly.

THE RELIABLE METHOD (what this script does)
-------------------------------------------
1. Render the .docx to PDF with LibreOffice and extract the **page-bottom
   footnote markers** (sequential 1..N, smallest font) as GROUND TRUTH. These
   are always correct, including tracked insertions.
2. Map each footnote (by text fingerprint, longest-common-prefix with a
   confidence margin; globally one-to-one, highest-confidence first) to its
   true marker.
3. Set every NOTEREF cache to its target footnote's true marker.
4. Repair NOTEREF field codes that dangle because Word truncated the bookmark
   name to 40 chars (``_RefBib_...2024`` -> the actual ``_RefBib_...20``).
5. Do NOT add ``updateFields`` — that re-triggers the buggy recompute. The
   stored caches are the correct final numbers.
6. ``--verify`` renders a CHANGES-ACCEPTED copy and re-extracts markers; with
   the inserts accepted, every engine agrees and the inline cross-refs render
   correctly. That accepted PDF is the trustworthy proof.

This script does NOT do editorial retargeting (e.g. "this xref should point to
notes 210-212 instead"). That is a human decision — make it separately by
moving the bookmark / changing the NOTEREF target, then re-run this to refresh.

Usage:
    refresh_noteref_caches.py file.docx                  # overwrite in place
    refresh_noteref_caches.py file.docx -o fixed.docx    # write a copy
    refresh_noteref_caches.py file.docx --dry-run        # report only
    refresh_noteref_caches.py file.docx --verify         # + accepted-changes PDF proof
    refresh_noteref_caches.py file.docx --soffice /path/to/soffice
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def localname(el) -> str:
    return etree.QName(el).localname


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


# --------------------------------------------------------------------------- #
# PDF rendering (ONLYOFFICE x2t preferred, soffice fallback)
# x2t renders footnote numRestart correctly where soffice does not — see
# docs/investigations/2026-06-10_onlyoffice-vs-libreoffice.md
# --------------------------------------------------------------------------- #
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from x2t_convert import convert as _convert  # noqa: E402


def render_pdf(docx: Path, outdir: Path, soffice: str | None = None) -> Path:
    try:
        return _convert(docx, outdir / (docx.stem + ".pdf"), soffice=soffice)
    except RuntimeError as e:
        sys.exit(
            f"ERROR: {e}. A renderer is required to read ground-truth "
            "footnote markers (install onlyoffice-x2t or LibreOffice)."
        )


def extract_markers(pdf: Path) -> dict[int, str]:
    """Return {marker_number: leading_text} from page-bottom footnote definitions.

    Footnotes render in the smallest font at the page bottom. We walk lines in
    order and treat a line whose leading integer equals the next expected marker
    as the start of a new footnote (so in-text numbers like years/pincites that
    are NOT the expected next value are ignored).
    """
    import fitz  # pymupdf

    doc = fitz.open(pdf)
    recs: dict[int, str] = {}
    expected = 1
    buf_num = None
    buf_txt = ""
    for page in doc:
        d = page.get_text("dict")
        sizes = [
            round(s["size"], 1)
            for b in d["blocks"]
            for l in b.get("lines", [])
            for s in l["spans"]
        ]
        if not sizes:
            continue
        fn_size = min(sizes)
        for b in d["blocks"]:
            for l in b.get("lines", []):
                spans = l["spans"]
                if not spans:
                    continue
                if min(round(s["size"], 1) for s in spans) > fn_size + 0.6:
                    continue  # body text, not footnote area
                txt = "".join(s["text"] for s in spans).strip()
                m = re.match(r"^(\d{1,3})\s+(.*)", txt)
                if m and int(m.group(1)) == expected:
                    if buf_num is not None:
                        recs[buf_num] = buf_txt[:80]
                    buf_num = expected
                    buf_txt = m.group(2)
                    expected += 1
                elif buf_num is not None:
                    buf_txt = (buf_txt + " " + txt)[:80]
    if buf_num is not None:
        recs[buf_num] = buf_txt[:80]
    return recs


# --------------------------------------------------------------------------- #
# DOCX (un)packing
# --------------------------------------------------------------------------- #
def unzip(docx: Path, dest: Path) -> None:
    with zipfile.ZipFile(docx) as z:
        z.extractall(dest)


def rezip(src: Path, docx: Path) -> None:
    if docx.exists():
        docx.unlink()
    with zipfile.ZipFile(docx, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(src.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(src).as_posix())


# --------------------------------------------------------------------------- #
# Footnote text + body-order helpers
# --------------------------------------------------------------------------- #
BIO_DEFAULT = 3  # number of customMarkFollows author-bio footnotes


def footnote_texts(froot) -> dict[str, str]:
    out = {}
    for f in froot.iter(q("footnote")):
        fid = f.get(q("id"))
        if fid in ("-1", "0"):
            continue
        if f.find(".//" + q("footnoteRef")) is None:
            continue
        out[fid] = "".join(
            t.text or "" for t in f.iter() if t.tag in (q("t"), q("delText"))
        )
    return out


def in_ancestor(el, tagnames: set[str]) -> bool:
    p = el.getparent()
    while p is not None:
        if localname(p) in tagnames:
            return True
        p = p.getparent()
    return False


def bookmark_to_target_fnid(droot) -> dict[str, str]:
    """Map each `_Ref*` bookmark name -> the footnoteReference id inside its span.

    moveFrom references (the struck-out original location of a move) are skipped.
    """
    open_bm: dict[str, str] = {}
    name_fnid: dict[str, str] = {}
    for el in droot.iter():
        tag = localname(el)
        if tag == "bookmarkStart":
            open_bm[el.get(q("id"))] = el.get(q("name"))
        elif tag == "bookmarkEnd":
            open_bm.pop(el.get(q("id")), None)
        elif tag == "footnoteReference":
            if in_ancestor(el, {"moveFrom"}):
                continue
            for nm in open_bm.values():
                if nm and nm.startswith("_Ref"):
                    name_fnid[nm] = el.get(q("id"))
    return name_fnid


# --------------------------------------------------------------------------- #
# Reliable fnid -> marker matching
# --------------------------------------------------------------------------- #
def lcp(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def match_fnids_to_markers(
    fn_texts: dict[str, str], markers: dict[int, str]
) -> tuple[dict[str, int], list[str]]:
    """One-to-one assignment, highest-confidence (longest common prefix) first.

    Returns (fnid->marker, low_confidence_fnids). Assigning the most distinctive
    matches first keeps clustered, near-identical footnotes ("See id.",
    "Choi, Fisch & Kahan ...") from stealing each other's markers.
    """
    mk_norm = {m: norm(t) for m, t in markers.items()}
    # Build candidate pairs (score, fnid, marker): top few markers per fnid.
    pairs: list[tuple[int, str, int]] = []
    fn_norm = {fid: norm(t) for fid, t in fn_texts.items()}
    for fid, nt in fn_norm.items():
        if len(nt) < 6:
            continue
        scored = sorted(
            ((lcp(nt, pn), m) for m, pn in mk_norm.items()), reverse=True
        )
        for score, m in scored[:4]:
            if score >= 8:
                pairs.append((score, fid, m))
    pairs.sort(reverse=True)
    fnid_marker: dict[str, int] = {}
    used_markers: set[int] = set()
    low_conf: list[str] = []
    for score, fid, m in pairs:
        if fid in fnid_marker or m in used_markers:
            continue
        fnid_marker[fid] = m
        used_markers.add(m)
        if score < 20:
            low_conf.append(fid)
    return fnid_marker, low_conf


# --------------------------------------------------------------------------- #
# NOTEREF field walking
# --------------------------------------------------------------------------- #
def iter_noteref_fields(footnote_el):
    """Yield dicts describing each NOTEREF field inside a <w:footnote>.

    Each dict: {instr: <instrText el>, tnodes: [<t> els holding the cached number]}.
    """
    cur = None
    for el in footnote_el.iter():
        tag = localname(el)
        if tag == "instrText" and el.text and "NOTEREF" in el.text:
            cur = {"instr": el, "tnodes": [], "state": "await"}
        elif tag == "fldChar" and cur is not None:
            ft = el.get(q("fldCharType"))
            if ft == "separate" and cur["state"] == "await":
                cur["state"] = "reading"
            elif ft == "end" and cur["state"] == "reading":
                yield cur
                cur = None
        elif tag == "t" and cur is not None and cur["state"] == "reading":
            cur["tnodes"].append(el)


def bookmark_name(instr_text: str) -> str:
    return instr_text.strip().split()[1]


# --------------------------------------------------------------------------- #
# Changes-accepted transform (for --verify)
# --------------------------------------------------------------------------- #
def accept_changes_inplace(root) -> None:
    for tag in ("del", "moveFrom"):
        for el in list(root.iter(q(tag))):
            par = el.getparent()
            if par is not None:
                par.remove(el)
    for tag in ("ins", "moveTo"):
        for el in list(root.iter(q(tag))):
            par = el.getparent()
            if par is None:
                continue
            idx = list(par).index(el)
            for c in list(el):
                par.insert(idx, c)
                idx += 1
            par.remove(el)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("docx", type=Path)
    ap.add_argument("-o", "--output", type=Path, help="output path (default: overwrite input)")
    ap.add_argument("--dry-run", action="store_true", help="report changes without writing")
    ap.add_argument("--verify", action="store_true", help="render a changes-accepted PDF proof next to the output")
    ap.add_argument("--soffice", help="path to LibreOffice soffice binary")
    ap.add_argument("--bio-footnotes", type=int, default=BIO_DEFAULT, help="(informational) number of customMarkFollows bio footnotes")
    args = ap.parse_args()

    docx: Path = args.docx
    if not docx.exists():
        sys.exit(f"ERROR: {docx} not found")
    out: Path = args.output or docx
    soffice = args.soffice

    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)

        # 1. Render original -> ground-truth markers
        pdf_dir = tdp / "pdf"
        pdf_dir.mkdir()
        markers = extract_markers(render_pdf(docx, pdf_dir, soffice=soffice))
        if not markers:
            sys.exit("ERROR: no footnote markers extracted from render; cannot proceed.")
        print(f"Ground-truth markers from render: {len(markers)} (1..{max(markers)})")

        # 2. Unpack + map
        work = tdp / "unpacked"
        unzip(docx, work)
        dtree = etree.parse(str(work / "word" / "document.xml"))
        droot = dtree.getroot()
        ftree = etree.parse(str(work / "word" / "footnotes.xml"))
        froot = ftree.getroot()

        fn_texts = footnote_texts(froot)
        fnid_marker, low_conf = match_fnids_to_markers(fn_texts, markers)
        print(f"Footnotes matched to markers: {len(fnid_marker)}/{len(fn_texts)}"
              f" ({len(low_conf)} low-confidence)")

        name_fnid = bookmark_to_target_fnid(droot)
        body_bookmarks = {
            bm.get(q("name")) for bm in droot.iter(q("bookmarkStart"))
        }

        # 3. Walk NOTEREF fields; repair dangling 40-char names; refresh caches.
        changed = 0
        dangling_fixed = 0
        unresolved = []
        for f in froot.iter(q("footnote")):
            for fld in iter_noteref_fields(f):
                name = bookmark_name(fld["instr"].text)
                # Word truncates bookmark names to 40 chars; a longer field-code
                # name dangles. Retarget to the actual (truncated) bookmark.
                if name not in body_bookmarks and len(name) > 40:
                    trunc = name[:40]
                    if trunc in body_bookmarks:
                        fld["instr"].text = fld["instr"].text.replace(name, trunc)
                        name = trunc
                        dangling_fixed += 1
                tgt = name_fnid.get(name)
                mk = fnid_marker.get(tgt) if tgt else None
                if mk is None:
                    unresolved.append(name)
                    continue
                if not fld["tnodes"]:
                    continue
                old = "".join(t.text or "" for t in fld["tnodes"]).strip()
                if old != str(mk):
                    changed += 1
                    if args.dry_run and changed <= 40:
                        print(f"  {old or '∅':>5} -> {mk:<5} ({name})")
                fld["tnodes"][0].text = str(mk)
                for t in fld["tnodes"][1:]:
                    t.text = ""

        print(f"Caches needing refresh: {changed}")
        if dangling_fixed:
            print(f"Dangling 40-char bookmark field-codes repaired: {dangling_fixed}")
        if unresolved:
            uniq = sorted(set(unresolved))
            print(f"WARNING: {len(unresolved)} NOTEREF(s) ({len(uniq)} distinct) could not be "
                  f"mapped to a marker — left unchanged: {uniq[:8]}{' ...' if len(uniq) > 8 else ''}")

        if args.dry_run:
            print("\n(dry run — nothing written)")
            return 0

        # 4. Write footnotes.xml + document.xml back; DO NOT add updateFields.
        ftree.write(str(work / "word" / "footnotes.xml"),
                    xml_declaration=True, encoding="UTF-8", standalone=True)
        dtree.write(str(work / "word" / "document.xml"),
                    xml_declaration=True, encoding="UTF-8", standalone=True)
        rezip(work, out)
        print(f"\nWrote {out}")

        # 5. Verify by rendering a changes-accepted copy (inline xrefs render
        #    correctly only once inserts are accepted).
        if args.verify:
            acc_dir = tdp / "accepted"
            unzip(out, acc_dir)
            for part in ("document.xml", "footnotes.xml"):
                t = etree.parse(str(acc_dir / "word" / part))
                accept_changes_inplace(t.getroot())
                t.write(str(acc_dir / "word" / part),
                        xml_declaration=True, encoding="UTF-8", standalone=True)
            acc_docx = out.with_name(out.stem + "_ACCEPTED_preview.docx")
            rezip(acc_dir, acc_docx)
            vpdf_dir = tdp / "vpdf"
            vpdf_dir.mkdir()
            vpdf = render_pdf(acc_docx, vpdf_dir, soffice=soffice)
            final = out.with_name(out.stem + "_ACCEPTED_preview.pdf")
            shutil.copy(vpdf, final)
            acc_markers = extract_markers(vpdf)
            ok = len(acc_markers) == len(markers)
            print(f"Verify (changes-accepted render): {len(acc_markers)} markers "
                  f"{'== original count ✓' if ok else '!= original count ✗'}")
            print(f"Accepted-changes proof PDF: {final}")
            acc_docx.unlink(missing_ok=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
