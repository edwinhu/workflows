#!/usr/bin/env python3
"""One reader for a document's marks: PDF tablet annotations, docx comments, Drive comments -> one JSON schema.

    doc_marks.py FILE.pdf|FILE.docx [--drive FILE_ID] [--drive-json RECORDED.json] [--png-dir DIR]
                 [--deck PDF] [--pad PT] [--dpi N] [--brief]

Launched by bin/doc-marks, which supplies pymupdf and lxml. Every backend emits

    {"source": "pdf"|"docx"|"drive", "file", "mtime",
     "marks": [{"id", "kind", "author", "created", "text", "quoted", "resolved", "replies",
                "where": {"page", "heading", "heading_source", "rect"}, "strokes", "png"}]}

`text` is the note the author typed, verbatim ("" when none) and authoritative; `quoted` is the text
under (PDF) or anchored by (docx, Drive) the mark. A field a backend cannot know is null, never
omitted; the PDF and docx key sets are asserted equal. An agent's reading of an untyped mark is NOT a
field: it is added downstream, labelled as the agent's.

PDF: per annotation, the typed note is `info["content"]`; the heading is the outline entry for the
page, and on a page carrying several (a prose draft) the last whose destination y is at or above the
mark's top; else the --deck outline matched by page text; else the page's bold opening lines; else its
first line. Every marked page is rendered with its ink to --png-dir (default <tmpdir>/doc-marks/<stem>).
docx/Drive: skills/docx-typst/scripts/comments.py's reader, mapped onto the schema; a docx mark's
heading is the nearest preceding Heading/Title paragraph of its anchor.

Exit: 0 marks found · 1 none (`NO MARKS` on stderr; the JSON, empty, still prints) · 2 could not run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMMENTS_DIR = HERE.parent.parent / "skills" / "docx-typst" / "scripts"

INK_PAD = 20.0
TEXT_MARKUP = {"Highlight", "Underline", "StrikeOut", "Squiggly"}
COUNTER = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*$", re.MULTILINE)
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
HEADING_STYLE = re.compile(r"^(heading\s*\d|title$)", re.IGNORECASE)
PDF_DATE = re.compile(r"D:(\d{4})(\d\d)(\d\d)(\d\d)?(\d\d)?(\d\d)?(Z|[+-]\d\d'?(?:\d\d)?'?)?")

TOP_KEYS = ["source", "file", "mtime", "marks"]
MARK_KEYS = ["id", "kind", "author", "created", "text", "quoted", "resolved", "replies", "where", "strokes", "png"]
WHERE_KEYS = ["page", "heading", "heading_source", "rect"]


class CouldNotRun(Exception):
    """Exit 2."""


def pymupdf():
    try:
        import pymupdf as m
    except ImportError as e:
        raise CouldNotRun("pymupdf is not importable; launch through bin/doc-marks") from e
    return m


def comments_module():
    sys.path.insert(0, str(COMMENTS_DIR))
    try:
        import comments
    except ImportError as e:
        raise CouldNotRun(f"cannot import comments.py from {COMMENTS_DIR} ({e}); launch through bin/doc-marks") from e
    finally:
        sys.path.remove(str(COMMENTS_DIR))
    return comments


def norm(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace(" ", " ").replace("‑", "-").replace("~", " ")
    return " ".join(s.split()).lower()


def mark(id, kind, author, created, text, quoted, resolved, replies, page, heading, heading_source, rect, strokes, png) -> dict:
    return {"id": id, "kind": kind, "author": author, "created": created, "text": text, "quoted": quoted,
            "resolved": resolved, "replies": replies,
            "where": {"page": page, "heading": heading, "heading_source": heading_source, "rect": rect},
            "strokes": strokes, "png": png}


def mtime_of(path: Path) -> str:
    return dt.datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(timespec="seconds")


# ── PDF ───────────────────────────────────────────────────────────────────────

def pdf_date(raw: str | None) -> str | None:
    m = PDF_DATE.match(raw or "")
    if not m:
        return None
    y, mo, d, h, mi, s, tz = m.groups()
    out = f"{y}-{mo}-{d}T{h or '00'}:{mi or '00'}:{s or '00'}"
    if tz == "Z":
        out += "+00:00"
    elif tz:
        digits = re.sub(r"\D", "", tz)
        out += f"{tz[0]}{digits[:2]}:{digits[2:4] or '00'}"
    return out


def heuristic_title(page) -> str:
    """The slide title from page text: the bold lines opening the first content block below the header band."""
    blocks = [b for b in page.get_text("dict")["blocks"] if b.get("lines")]
    if not blocks:
        return ""
    top = max(s["size"] for b in blocks for l in b["lines"] for s in l["spans"])
    header = [b for b in blocks if any(s["size"] >= top - 0.1 for l in b["lines"] for s in l["spans"])]
    floor = max((b["bbox"][3] for b in header), default=0)
    body = sorted((b for b in blocks if b["bbox"][1] >= floor - 1 and b not in header), key=lambda b: b["bbox"][1])
    for b in body:
        out = []
        for l in b["lines"]:
            spans = [s for s in l["spans"] if s["text"].strip()]
            if not spans or not all(s["flags"] & 16 for s in spans):
                break
            out.append("".join(s["text"] for s in l["spans"]).strip())
            if re.search(r"[.?!][\"”’)]?$|\.\s*\([^)]*\)$", out[-1]) or len(out) == 3:
                break
        if out:
            return " ".join(" ".join(out).split())
    return ""


def words_under(page, box, m) -> str:
    """Every word the box touches, whole, in reading order (a clip would cut words at its edge)."""
    hit = [w for w in page.get_text("words") if m.Rect(w[:4]).intersects(box)]
    hit.sort(key=lambda w: (w[5], w[6], w[7]))
    return " ".join(w[4] for w in hit)


def body_text(page) -> str:
    """Page text minus the footer counter and date, which change on every rebuild."""
    t = COUNTER.sub("", page.get_text())
    return norm(re.sub(r"^\s*\d{4}-\d{2}-\d{2}\s*$", "", t, flags=re.MULTILINE))


def outline_titles(doc) -> dict[int, str]:
    """1-based page -> the latest outline title at or before it."""
    entries = sorted((p, n, t) for n, (_, t, p) in enumerate(doc.get_toc(simple=True)) if p > 0)
    out, cur, j = {}, "", 0
    for page in range(1, doc.page_count + 1):
        while j < len(entries) and entries[j][0] <= page:
            cur = entries[j][2]
            j += 1
        out[page] = cur
    return out


def deck_titles(deck: Path, m) -> tuple[dict[str, str], list[str]]:
    """(page body text -> outline title, every outline title), for a copy cut before cuts carried an outline."""
    doc = m.open(deck)
    titles = outline_titles(doc)
    by_text = {body_text(doc[i]): titles[i + 1] for i in range(doc.page_count) if titles.get(i + 1)}
    return by_text, [t for _, t, _ in doc.get_toc(simple=True)]


def from_outline(guess: str, outline: list[str]) -> str:
    """The outline title the page-text guess is a prefix of (the guess may be cut at a line break)."""
    g = norm(guess).rstrip(".?!")
    if len(g) < 12:
        return ""
    return next((t for t in outline if norm(t).startswith(g)), "")


def outline_entries(doc) -> list[tuple[int, str, float]]:
    """(1-based page, title, destination y in page points from the top) per outline entry, in document order."""
    out = []
    for _, title, page, dest in doc.get_toc(simple=False):
        if page <= 0:
            continue
        to = dest.get("to") if isinstance(dest, dict) else None
        out.append((page, title, float(to.y) if to is not None else 0.0))
    return out


def outline_heading(entries, page: int, top: float) -> tuple[str, str] | None:
    """The entry heading a mark at `top` on `page` sits under: the last entry on the page at or above it, else
    the last entry of an earlier page (a mark above the page's first entry still belongs to the section running in)."""
    here = [e for e in entries if e[0] == page]
    above = [e for e in here if e[2] <= top + 2.0]
    if above:
        return above[-1][1], "outline"
    if here and any(e[0] < page for e in entries):
        return [e for e in entries if e[0] < page][-1][1], "outline-prev"
    if here:
        return here[0][1], "outline"
    prev = [e for e in entries if e[0] < page]
    return (prev[-1][1], "outline-prev") if prev else None


def pdf_marks(pdf: Path, png_dir: Path, pad: float, dpi: int, deck: Path | None) -> dict:
    m = pymupdf()
    try:
        doc = m.open(pdf)
    except Exception as e:  # pymupdf raises its own FileDataError family
        raise CouldNotRun(f"{pdf}: not a readable PDF ({e})") from e
    entries = outline_entries(doc)
    by_text, deck_outline = deck_titles(deck, m) if deck and not entries else ({}, [])
    png_dir.mkdir(parents=True, exist_ok=True)
    for old in png_dir.glob("page-*.png"):  # a previous read's pages
        old.unlink()
    marks = []
    for page in doc:
        annots = list(page.annots() or [])
        if not annots:
            continue
        n = page.number + 1
        png = png_dir / f"page-{n:03d}.png"
        page.get_pixmap(dpi=dpi, annots=True).save(png)
        fallback: tuple[str, str] | None = None
        for i, a in enumerate(annots, 1):
            kind = a.type[1]
            r = a.rect
            box = r if kind in TEXT_MARKUP else m.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad)
            box = box & page.rect
            found = outline_heading(entries, n, r.y0) if entries else None
            if found is None:
                if fallback is None:
                    fallback = page_heading(page, by_text, deck_outline)
                found = fallback
            heading, source = found
            marks.append(mark(
                id=f"p{n}.{i}", kind=kind, author=(a.info.get("title") or "").strip() or None,
                created=pdf_date(a.info.get("creationDate")), text=(a.info.get("content") or "").strip(),
                quoted=words_under(page, box, m), resolved=None, replies=[], page=n,
                heading=heading, heading_source=source, rect=[round(v, 1) for v in (r.x0, r.y0, r.x1, r.y1)],
                strokes=len(a.vertices or []) if kind == "Ink" else None, png=str(png)))
    return {"source": "pdf", "file": str(pdf), "mtime": mtime_of(pdf), "marks": marks}


def page_heading(page, by_text: dict[str, str], deck_outline: list[str]) -> tuple[str, str]:
    """A page with no outline entry: the --deck page of the same text, else its bold opening lines, else its first line."""
    if body_text(page) in by_text:
        title, source = by_text[body_text(page)], "deck-outline"
    else:
        title, source = heuristic_title(page), "page-text"
        if from_outline(title, deck_outline):
            title, source = from_outline(title, deck_outline), "deck-outline"
    title = " ".join(title.replace("\xa0", " ").split())
    if not title:
        title, source = next((ln.strip() for ln in page.get_text().splitlines() if ln.strip()), ""), "first-line"
    return title, source


# ── docx / Drive ──────────────────────────────────────────────────────────────

def docx_headings(path: Path) -> dict[str, str]:
    """Comment id -> the nearest Heading/Title paragraph at or before the start of its range."""
    from lxml import etree
    with zipfile.ZipFile(path) as z:
        if "word/document.xml" not in z.namelist():
            return {}
        root = etree.fromstring(z.read("word/document.xml"))
    out, current = {}, ""
    for el in root.iter():
        if not isinstance(el.tag, str) or etree.QName(el).namespace != W:
            continue
        tag = etree.QName(el).localname
        if tag == "p":
            style = el.find(f"{{{W}}}pPr/{{{W}}}pStyle")
            if style is not None and HEADING_STYLE.match(style.get(f"{{{W}}}val") or ""):
                current = " ".join("".join(t.text or "" for t in el.iter(f"{{{W}}}t")).split())
        elif tag == "commentRangeStart" and el.get(f"{{{W}}}id") is not None:
            out[el.get(f"{{{W}}}id")] = current
    return out


def from_comments(res: dict, headings: dict[str, str]) -> dict:
    mtime = None
    if res["source"] == "docx":
        mtime = mtime_of(Path(res["file"]))
    marks = []
    for c in res["comments"]:
        h = headings.get(c["id"]) or None
        marks.append(mark(
            id=c["id"], kind="comment", author=c["author"] or None, created=c["created"], text=c["text"],
            quoted=c["quoted"], resolved=c["resolved"], replies=c["replies"], page=None, heading=h,
            heading_source="paragraph-style" if h else None, rect=None, strokes=None, png=None))
    return {"source": res["source"], "file": res["file"], "mtime": mtime, "marks": marks}


def docx_marks(path: Path) -> dict:
    c = comments_module()
    try:
        res = c.from_docx(path)
        headings = docx_headings(path) if res["comments"] else {}
    except (zipfile.BadZipFile, OSError) as e:
        raise CouldNotRun(f"{path}: not a readable docx ({e})") from e
    return from_comments(res, headings)


def drive_marks(file_id: str, recorded: Path | None) -> dict:
    c = comments_module()
    try:
        if recorded:
            res = c.from_drive_payload(json.loads(recorded.read_text(encoding="utf-8")), file_id)
        else:
            res = c.from_drive(file_id)
    except (RuntimeError, OSError, ValueError) as e:
        raise CouldNotRun(str(e)) from e
    return from_comments(res, {})


# ── brief ─────────────────────────────────────────────────────────────────────

def brief_md(s: dict) -> str:
    pages = {mk["where"]["page"] for mk in s["marks"] if mk["where"]["page"] is not None}
    where = f" on {len(pages)} page(s)" if pages else ""
    out = [f"# Marks: {Path(s['file']).name}", "",
           f"Transcription, not judgement. {len(s['marks'])} mark(s){where}; source {s['source']}"
           + (f", copy mtime {s['mtime']}." if s["mtime"] else "."),
           ("Typed text is the author's and is authoritative. An untyped mark carries no instruction until the "
            "agent's reading of its PNG is added, labeled as the agent's."), ""]
    groups: dict[tuple, list[dict]] = {}
    for mk in s["marks"]:
        w = mk["where"]
        groups.setdefault((w["page"], w["heading"]), []).append(mk)
    for (page, heading), mks in groups.items():
        label = heading or "(untitled)"
        out += [f"## {f'p{page}: ' if page is not None else ''}{label}", ""]
        png = next((mk["png"] for mk in mks if mk["png"]), None)
        if png:
            out += [f"PNG: `{png}`", ""]
        for i, mk in enumerate(mks, 1):
            typed = f"typed: \"{mk['text']}\"" if mk["text"] else "UNTYPED (agent's reading: _pending_)"
            at = f" at {mk['where']['rect']}" if mk["where"]["rect"] else ""
            under = f"; {'under' if s['source'] == 'pdf' else 'anchored on'} the mark: \"{mk['quoted'][:300]}\"" if mk["quoted"] else ""
            line = f"{i}. {mk['kind']}{at}: {typed}{under}"
            if mk["resolved"]:
                line += "; resolved"
            for r in mk["replies"]:
                line += f"; reply by {r['author']}: \"{r['text']}\""
            out.append(line)
        out.append("")
    return "\n".join(out)


# ── CLI ───────────────────────────────────────────────────────────────────────

def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="doc-marks", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?", help="a .pdf or .docx (omit with --drive)")
    ap.add_argument("--drive", metavar="FILE_ID", help="read the comments of a Google Drive file instead")
    ap.add_argument("--drive-json", type=Path, metavar="JSON", help="with --drive: map a recorded comments.list response")
    ap.add_argument("--png-dir", help="where the PDF page PNGs go (default: <tmpdir>/doc-marks/<stem>)")
    ap.add_argument("--deck", help="the deck a PDF copy was cut from; names slides on a copy that carries no outline")
    ap.add_argument("--pad", type=float, default=INK_PAD, help=f"points of padding around a non-text mark (default {INK_PAD:g})")
    ap.add_argument("--dpi", type=int, default=110)
    ap.add_argument("--brief", action="store_true", help="print the markdown transcription instead of JSON")
    return ap


def read(a) -> dict:
    if a.drive:
        return drive_marks(a.drive, a.drive_json)
    if a.drive_json:
        raise CouldNotRun("--drive-json needs --drive FILE_ID (the id recorded in `file`)")
    if not a.file:
        raise CouldNotRun("no file named: give a .pdf or .docx, or --drive FILE_ID")
    path = Path(a.file).expanduser()
    if not path.is_file():
        raise CouldNotRun(f"{path}: no such file")
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return docx_marks(path)
    if suffix != ".pdf":
        raise CouldNotRun(f"{path}: not a .pdf or .docx")
    deck = Path(a.deck).expanduser() if a.deck else None
    if deck and not deck.is_file():
        raise CouldNotRun(f"--deck {deck}: no such file")
    png_dir = Path(a.png_dir).expanduser() if a.png_dir else Path(tempfile.gettempdir()) / "doc-marks" / path.stem
    return pdf_marks(path, png_dir, a.pad, a.dpi, deck)


def main(argv=None) -> int:
    ap = parser()
    if not (argv if argv is not None else sys.argv[1:]):
        ap.print_usage(sys.stderr)
        print("doc-marks: COULD-NOT-RUN: no file named", file=sys.stderr)
        return 2
    a = ap.parse_args(argv)  # a bad argument exits 2 itself
    try:
        s = read(a)
    except CouldNotRun as e:
        print(f"doc-marks: COULD-NOT-RUN: {e}", file=sys.stderr)
        return 2
    print(brief_md(s) if a.brief else json.dumps(s, indent=2, ensure_ascii=False))
    if not s["marks"]:
        print(f"doc-marks: NO MARKS in {Path(s['file']).name}" + (f" (mtime {s['mtime']})" if s["mtime"] else ""), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
