#!/usr/bin/env python3
"""One reader for a document's marks: PDF tablet annotations, docx comments, Drive comments, marimo Lens
selections, molabel annotations, GitHub pull request reviews and Claude Docs comment threads -> one JSON schema.

    doc_marks.py FILE.pdf|FILE.docx [--drive FILE_ID] [--drive-json RECORDED.json] [--png-dir DIR]
                 [--deck PDF] [--pad PT] [--dpi N] [--brief]
    doc_marks.py --lens EXPORT.json | --molabel EXPORT.json | --claude-docs EXPORT.json [--brief]
    doc_marks.py --github-pr OWNER/REPO#N [--github-json RECORDED.json] [--include-bots] [--brief]

Launched by bin/doc-marks, which supplies pymupdf and lxml. Every backend emits

    {"source": "pdf"|"docx"|"drive"|"lens"|"molabel"|"github-pr"|"claude-docs", "file", "mtime",
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
Lens/molabel: the JSON scripts/lib/notebook_marks_export.py writes from the live kernel. A Lens mark is
one open selection (id its label, kind `lens-point`/`lens-rect`, rect its normalized [x, y, width,
height]); a molabel mark is one SimpleLabel annotation in example order (id `i<index>`, kind the
yes/no/skip label, heading and quoted the export's title_key/text_key fields). An example's `_html` is
never read.
GitHub PR: `gh api --paginate` of pulls/N/comments and pulls/N/reviews (or --github-json, the two responses
recorded as {"comments": [...], "reviews": [...]}). A top-level inline comment is a mark (id `c<id>`, quoted its
diff hunk, page its line, heading its path, replies its thread oldest first); a submitted review with a body is a
mark (id `r<id>`, kind `review-<state>`). Marks run in time order; a Bot's comment, review or reply is dropped
unless --include-bots.
Claude Docs: an export the agent records from the MCP connector, {"tool": "claude-docs", "doc", "tab", "rows": [the
query(utterance) rows], "anchors": {thread root id: its read(utterance).anchor}}. A create row whose parent is a node
is a mark (id the utterance id, quoted its anchor's quote, "" for a whole-tab note, heading the tab); create rows whose
parent is that utterance are its replies and a resolve row on it sets resolved. Marks and replies run in `seq` order.

Exit: 0 marks found · 1 none (`NO MARKS` on stderr; the JSON, empty, still prints) · 2 could not run
(an unreadable or malformed export, or one from the other tool, included).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
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


# ── marimo Lens / molabel exports ─────────────────────────────────────────────

class Malformed(Exception):
    """An export record the schema cannot be built from; CouldNotRun names it."""


def export_records(path: Path, tool: str, key: str) -> tuple[dict, list[dict]]:
    """The export and its `key` records, once it is readable JSON written for `tool`."""
    try:
        s = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as e:
        raise CouldNotRun(f"{path}: not a readable export ({e})") from None
    got = s.get("tool") if isinstance(s, dict) else None
    if got != tool:
        raise CouldNotRun(f"{path}: not a {tool} export (tool {got!r})")
    records = s.get(key)
    if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
        raise CouldNotRun(f"{path}: `{key}` is not a list of records")
    return s, records


def opt_str(d: dict, key: str) -> str:
    """d[key] when a string, "" when absent or null; Malformed for any other type."""
    v = d.get(key)
    if v is None:
        return ""
    if not isinstance(v, str):
        raise Malformed(f"`{key}` is not a string")
    return v


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def lens_mark(sel: dict) -> dict:
    ident = sel.get("label") or sel.get("id")
    if not isinstance(ident, str):
        raise Malformed("no string `label` or `id`")
    anchor = sel.get("anchor")
    if not isinstance(anchor, dict) or anchor.get("kind") not in ("point", "rect"):
        raise Malformed("`anchor` is not a point or rect")
    dims = ("x", "y", "width", "height") if anchor["kind"] == "rect" else ("x", "y")
    if not all(is_num(anchor.get(k)) for k in dims):
        raise Malformed(f"a {anchor['kind']} `anchor` needs numeric {', '.join(dims)}")
    target, desc, hint = sel.get("target") or {}, sel.get("description") or {}, sel.get("domHint") or {}
    if not all(isinstance(d, dict) for d in (target, desc, hint)):
        raise Malformed("`target`, `description` or `domHint` is not an object")
    cells = target.get("cellIds") or []
    if not isinstance(cells, list) or not all(isinstance(c, str) for c in cells):
        raise Malformed("`target.cellIds` is not a list of strings")
    png = sel.get("png")
    if png is not None and not isinstance(png, str):
        raise Malformed("`png` is not a path or null")
    if opt_str(desc, "label"):
        heading, source = desc["label"], "lens-description"
    elif cells:
        heading, source = f"cell {cells[0]}", "lens-cell"
    else:  # a DOM target may name no cell
        heading, source = None, None
    x, y = anchor["x"], anchor["y"]
    return mark(
        id=ident, kind=f"lens-{anchor['kind']}", author=None, created=None, text=opt_str(sel, "note"),
        quoted=opt_str(hint, "text") or opt_str(desc, "detail"), resolved=False, replies=[], page=None,
        heading=heading, heading_source=source,
        rect=[x, y, anchor["width"], anchor["height"]] if anchor["kind"] == "rect" else [x, y, 0, 0],
        strokes=None, png=png)


def molabel_mark(rec: dict, title_key: str | None, text_key: str | None) -> dict:
    index, example, label = rec.get("index"), rec.get("example"), rec.get("_label")
    if not isinstance(index, int) or isinstance(index, bool):
        raise Malformed("`index` is not an integer")
    if not isinstance(example, dict):
        raise Malformed("`example` is not an object")
    if not isinstance(label, str) or not label:
        raise Malformed("`_label` is not a label")
    example = {k: v for k, v in example.items() if k != "_html"}  # rendered HTML is never a field
    title = example.get(title_key) if title_key else None
    quoted = example.get(text_key) if text_key else None
    return mark(
        id=f"i{index}", kind=label, author=None, created=opt_str(rec, "_timestamp") or None,
        text=opt_str(rec, "_notes"), quoted="" if quoted is None else str(quoted), resolved=None, replies=[],
        page=None, heading=f"example {index}" if title in (None, "") else str(title),
        heading_source="molabel-example", rect=None, strokes=None, png=None)


def notebook_marks(path: Path, source: str) -> dict:
    """A --lens or --molabel export mapped onto the schema; a malformed record is CouldNotRun, naming it."""
    tool, key = ("marimo-lens", "selections") if source == "lens" else ("molabel", "annotations")
    s, records = export_records(path, tool, key)
    keys = s.get("title_key"), s.get("text_key")
    if not all(k is None or isinstance(k, str) for k in keys):
        raise CouldNotRun(f"{path}: `title_key`/`text_key` is not a string or null")
    marks = []
    for n, r in enumerate(records):
        try:
            marks.append(lens_mark(r) if source == "lens" else molabel_mark(r, *keys))
        except Malformed as e:
            raise CouldNotRun(f"{path}: {key}[{n}] is malformed: {e}") from None
    if source == "molabel":  # get_annotations() lists in labelling order, not example order
        marks = [mk for _, mk in sorted(zip((r["index"] for r in records), marks), key=lambda p: p[0])]
    return {"source": source, "file": str(path), "mtime": mtime_of(path), "marks": marks}


# ── Claude Docs comment export ────────────────────────────────────────────────

def claude_docs_row(r: dict) -> tuple[dict, str, str]:
    """(payload.value, parent object, parent id) of one query row; Malformed for a missing `id`/`seq`/`payload.value`
    or a field of the wrong type (an uncaught TypeError would exit 1, which reads as NO MARKS)."""
    payload = r.get("payload")
    value = payload.get("value") if isinstance(payload, dict) else None
    if not isinstance(r.get("id"), str) or not r["id"] or not is_int(r.get("seq")) or not isinstance(value, dict):
        raise Malformed("no string `id`, integer `seq` or object `payload.value`")
    parent, actor = value.get("parent") or {}, r.get("actor") or {}
    if not isinstance(parent, dict) or not isinstance(actor, dict):
        raise Malformed("`payload.value.parent` or `actor` is not an object")
    for d, k in ((r, "at"), (r, "verb"), (value, "body"), (value, "kind"), (actor, "name")):
        opt_str(d, k)
    return value, opt_str(parent, "object"), opt_str(parent, "id")


def claude_docs_marks(path: Path) -> dict:
    """A --claude-docs export onto the schema: a create row whose parent is a node is a thread root and a mark; create
    rows whose parent is that utterance are its replies; a resolve row on it sets resolved. All in `seq` order."""
    s, records = export_records(path, "claude-docs", "rows")
    doc, anchors = s.get("doc"), s.get("anchors") or {}
    if not isinstance(doc, str) or not doc:
        raise CouldNotRun(f"{path}: `doc` is not the doc's URL or id")
    if s.get("tab") is not None and not isinstance(s["tab"], str):
        raise CouldNotRun(f"{path}: `tab` is not a string")
    if not isinstance(anchors, dict) or not all(
            isinstance(a, dict) and (a.get("quote") is None or isinstance(a["quote"], str)) for a in anchors.values()):
        raise CouldNotRun(f"{path}: `anchors` is not an object of read() anchors, each quote a string")
    rows = []
    for n, r in enumerate(records):
        try:
            rows.append((r, *claude_docs_row(r)))
        except Malformed as e:
            raise CouldNotRun(f"{path}: rows[{n}] is malformed: {e}") from None
    rows.sort(key=lambda row: row[0]["seq"])
    tab = s.get("tab") or None
    roots, replies, resolved = [], {}, set()
    for r, value, on, parent_id in rows:
        if value.get("kind") == "resolve":
            if on == "utterance":
                resolved.add(parent_id)
        elif r.get("verb") != "create":
            continue
        elif on == "node":
            roots.append((r, value))
        elif on == "utterance":
            replies.setdefault(parent_id, []).append({"author": opt_str(r.get("actor") or {}, "name") or None,
                                                      "created": opt_str(r, "at") or None,
                                                      "text": opt_str(value, "body")})
    marks = [mark(
        id=r["id"], kind="comment", author=opt_str(r.get("actor") or {}, "name") or None,
        created=opt_str(r, "at") or None, text=opt_str(value, "body"),
        quoted=opt_str(anchors.get(r["id"]) or {}, "quote"), resolved=r["id"] in resolved,
        replies=replies.get(r["id"], []), page=None, heading=tab,
        heading_source="claude-docs-tab" if tab else None, rect=None, strokes=None, png=None)
        for r, value in roots]
    times = [opt_str(r, "at") for r, *_ in rows if opt_str(r, "at")]
    return {"source": "claude-docs", "file": doc, "mtime": max(times, default=None), "marks": marks}


# ── GitHub pull request ───────────────────────────────────────────────────────

# GitHub's own name rules, ASCII only; matched whole before any part reaches gh's argv or the API path.
GITHUB_PR = re.compile(r"([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9._-]{1,100})#([1-9][0-9]{0,9})")


def github_pr_ref(ref: str) -> tuple[str, str, str]:
    m = GITHUB_PR.fullmatch(ref)
    if not m or m.group(2) in (".", ".."):
        raise CouldNotRun(f"--github-pr {ref!r}: not OWNER/REPO#N")
    return m.group(1), m.group(2), m.group(3)


def gh_api(endpoint: str) -> list:
    """Every item of a paginated list endpoint, through `gh api --paginate` run without a shell."""
    gh = shutil.which("gh")
    if gh is None:
        raise CouldNotRun("gh is not on PATH: install the GitHub CLI, or give --github-json RECORDED.json")
    cmd = [gh, "api", "--paginate", endpoint]
    shown = f"gh api --paginate {endpoint}"
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except OSError as e:
        raise CouldNotRun(f"`{shown}` could not start ({e})") from None
    if p.returncode:
        raise CouldNotRun(f"`{shown}` exited {p.returncode}: {p.stderr.strip()}")
    items, dec, i, out = [], json.JSONDecoder(), 0, p.stdout
    while True:  # without --slurp, --paginate prints one JSON array per page
        while i < len(out) and out[i].isspace():
            i += 1
        if i == len(out):
            return items
        try:
            page, i = dec.raw_decode(out, i)
        except ValueError as e:
            raise CouldNotRun(f"`{shown}` printed no JSON array ({e})") from None
        if not isinstance(page, list):
            raise CouldNotRun(f"`{shown}` printed a {type(page).__name__}, not a list")
        items += page


def github_marks(ref: str, comments: list[dict], reviews: list[dict], include_bots: bool) -> dict:
    """pulls/N/comments and pulls/N/reviews items onto the schema. A top-level inline comment (its replies attached,
    oldest first) and a submitted review with a body are marks, in time order; a Bot's comment, review or reply is
    dropped unless include_bots. A record without an integer `id`, a `body` or a `user` is Malformed."""
    def kept(records: list[dict], name: str, strs: tuple, ints: tuple) -> list[tuple[dict, str | None]]:
        """(record, author login) of each record not dropped as a Bot's, every record checked first."""
        out = []
        for n, r in enumerate(records):
            user = r.get("user")
            try:
                if not is_int(r.get("id")) or "body" not in r or "user" not in r:
                    raise Malformed("no integer `id`, `body` or `user`")
                if user is not None and not (isinstance(user, dict) and isinstance(user.get("login"), str)):
                    raise Malformed("`user` has no string `login`")  # null is GitHub's deleted account
                for k in strs:
                    opt_str(r, k)
                bad = [k for k in ints if r.get(k) is not None and not is_int(r[k])]
                if bad:
                    raise Malformed(f"`{bad[0]}` is not an integer")
            except Malformed as e:
                raise Malformed(f"{name}[{n}]: {e}") from None
            if include_bots or user is None or user.get("type") != "Bot":
                out.append((r, user["login"] if user else None))
        return out

    comments = kept(comments, "comments", ("body", "created_at", "path", "diff_hunk"),
                    ("in_reply_to_id", "line", "original_line"))
    reviews = kept(reviews, "reviews", ("body", "submitted_at", "state"), ())
    replies: dict[int, list[dict]] = {}
    for r, author in comments:
        if r.get("in_reply_to_id") is not None:
            replies.setdefault(r["in_reply_to_id"], []).append(
                {"author": author, "created": opt_str(r, "created_at") or None, "text": opt_str(r, "body")})
    marks = []
    for r, author in comments:
        if r.get("in_reply_to_id") is not None:
            continue
        path = opt_str(r, "path") or None
        marks.append(mark(
            id=f"c{r['id']}", kind="review-comment", author=author, created=opt_str(r, "created_at") or None,
            text=opt_str(r, "body"), quoted=opt_str(r, "diff_hunk"), resolved=None,
            replies=sorted(replies.get(r["id"], []), key=lambda x: x["created"] or ""),
            page=r["line"] if r.get("line") is not None else r.get("original_line"),
            heading=path, heading_source="github-path" if path else None, rect=None, strokes=None, png=None))
    for r, author in reviews:
        state = opt_str(r, "state")
        if not state:
            raise Malformed(f"review {r['id']} has no `state`")
        if state == "PENDING" or not opt_str(r, "body").strip():
            continue
        marks.append(mark(
            id=f"r{r['id']}", kind=f"review-{state.lower()}", author=author,
            created=opt_str(r, "submitted_at") or None, text=opt_str(r, "body"), quoted="", resolved=None, replies=[],
            page=None, heading="(review summary)", heading_source="github-review", rect=None, strokes=None, png=None))
    marks.sort(key=lambda mk: mk["created"] or "")
    times = [t for mk in marks for t in (mk["created"], *(x["created"] for x in mk["replies"])) if t]
    return {"source": "github-pr", "file": ref, "mtime": max(times, default=None), "marks": marks}


def github_pr_marks(ref: str, recorded: Path | None, include_bots: bool) -> dict:
    owner, repo, number = github_pr_ref(ref)
    if recorded:
        origin = str(recorded)
        try:
            data = json.loads(recorded.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError) as e:
            raise CouldNotRun(f"{recorded}: not a readable recording ({e})") from None
        if not isinstance(data, dict):
            raise CouldNotRun(f"{recorded}: not a {{\"comments\": [...], \"reviews\": [...]}} recording")
        comments, reviews = data.get("comments"), data.get("reviews")
    else:
        origin = ref
        base = f"repos/{owner}/{repo}/pulls/{number}"
        comments, reviews = gh_api(f"{base}/comments"), gh_api(f"{base}/reviews")
    for name, records in (("comments", comments), ("reviews", reviews)):
        if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
            raise CouldNotRun(f"{origin}: `{name}` is not a list of records")
    try:
        return github_marks(ref, comments, reviews, include_bots)
    except Malformed as e:
        raise CouldNotRun(f"{origin}: {e}") from None


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
    ap.add_argument("file", nargs="?",
                    help="a .pdf or .docx (omit with --drive, --lens, --molabel, --github-pr or --claude-docs)")
    ap.add_argument("--drive", metavar="FILE_ID", help="read the comments of a Google Drive file instead")
    ap.add_argument("--drive-json", type=Path, metavar="JSON", help="with --drive: map a recorded comments.list response")
    ap.add_argument("--lens", metavar="EXPORT.json", help="read a marimo Lens export (notebook_marks_export.export_lens)")
    ap.add_argument("--molabel", metavar="EXPORT.json",
                    help="read a molabel SimpleLabel export (notebook_marks_export.export_molabel)")
    ap.add_argument("--github-pr", metavar="OWNER/REPO#N",
                    help="read a GitHub pull request's inline review comments and review summaries, through gh")
    ap.add_argument("--github-json", type=Path, metavar="JSON",
                    help='with --github-pr: map a recording {"comments": [...], "reviews": [...]} instead of calling gh')
    ap.add_argument("--include-bots", action="store_true", help="with --github-pr: keep Bot authors' comments and reviews")
    ap.add_argument("--claude-docs", metavar="EXPORT.json",
                    help="read a recorded Claude Docs comment export (query rows plus read anchors)")
    ap.add_argument("--png-dir", help="where the PDF page PNGs go (default: <tmpdir>/doc-marks/<stem>)")
    ap.add_argument("--deck", help="the deck a PDF copy was cut from; names slides on a copy that carries no outline")
    ap.add_argument("--pad", type=float, default=INK_PAD, help=f"points of padding around a non-text mark (default {INK_PAD:g})")
    ap.add_argument("--dpi", type=int, default=110)
    ap.add_argument("--brief", action="store_true", help="print the markdown transcription instead of JSON")
    return ap


def read(a) -> dict:
    if a.claude_docs:
        others = [flag for flag, v in (("a file", a.file), ("--drive", a.drive), ("--drive-json", a.drive_json),
                                        ("--lens", a.lens), ("--molabel", a.molabel), ("--github-pr", a.github_pr),
                                        ("--github-json", a.github_json), ("--include-bots", a.include_bots)) if v]
        if others:
            raise CouldNotRun(f"--claude-docs reads one export: give no {', '.join(others)} with it")
        return claude_docs_marks(Path(a.claude_docs).expanduser())
    if a.github_pr:
        others = [flag for flag, v in (("a file", a.file), ("--drive", a.drive), ("--drive-json", a.drive_json),
                                        ("--lens", a.lens), ("--molabel", a.molabel)) if v]
        if others:
            raise CouldNotRun(f"--github-pr reads one pull request: give no {', '.join(others)} with it")
        return github_pr_marks(a.github_pr, a.github_json, a.include_bots)
    if a.github_json or a.include_bots:
        raise CouldNotRun("--github-json and --include-bots need --github-pr OWNER/REPO#N")
    notebook = [(flag, v) for flag, v in (("lens", a.lens), ("molabel", a.molabel)) if v]
    if notebook and (len(notebook) > 1 or a.file or a.drive):
        raise CouldNotRun("--lens and --molabel each read one export: give no file, --drive or other export with it")
    if a.drive:
        return drive_marks(a.drive, a.drive_json)
    if a.drive_json:
        raise CouldNotRun("--drive-json needs --drive FILE_ID (the id recorded in `file`)")
    if notebook:
        source, export = notebook[0]
        return notebook_marks(Path(export).expanduser(), source)
    if not a.file:
        raise CouldNotRun("no file named: give a .pdf or .docx, --drive FILE_ID, --lens, --molabel or --claude-docs "
                          "EXPORT.json, or --github-pr OWNER/REPO#N")
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
