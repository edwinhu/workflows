#!/usr/bin/env python3
"""Decide whether one applied review mark's deck slide or notes entry changed in the new build: review-ledger
verify's --check-cmd for Typst decks (teaching lectures, workshop talks).

    review_check_deck.py --deck NEW_SLIDES.pdf [--pages A-B] [--notes NEW_NOTES.pdf] --copies-dir DIR

Launched by bin/review-check-deck, which supplies pymupdf. stdin is review-ledger's check-cmd payload

    {"mark": <review-ledger row: "copy", "page", "heading", "rect", ...>, "outcome": <outcome value>}

`copy` is a file name resolved under --copies-dir only (a path separator or ".." in it could not run);
`page`, `heading` and `rect` locate the mark. A copy named `<name> slides review <YYYYMMDD><letter>.pdf`
pairs with `<name> notes review <YYYYMMDD><letter>.pdf` in the same directory, so a notes-copy mark finds
its slide and a slides-copy mark finds its notes entry. `outcome.target` is slides|notes|both, default
notes for a mark on a ` notes review ` copy and slides otherwise; `outcome.at` names where the edit landed
instead (a slide's text, or a notes heading).

The new build is the --deck pages (--pages, default all) reduced to the last page of each "n / N" counter
run, and the --notes PDF's outline entries: an entry is its title's text block up to the next title's,
a section is an entry plus the deeper entries after it. Page text is compared with the running header,
the footer and numbering ("6 of 9", a list item's "6.") masked.

slides: FAIL when a new-build page has the marked page's text, renders the same at 50 dpi in the content
band (over 0.02% of pixels differing is a change, so a colour-only edit passes) and has not moved past
another slide; a marked slide with no page at 0.5 word-sequence similarity or above is gone. A notes-copy
mark is checked against the same round's slides page whose outline title best matches its entry.
With `at`: PASS when a new-build slide carrying it is not in the marked copy unchanged, or is the marked
slide itself (matched by whole text, since titles recur) and it moved.
notes: FAIL when the new notes carry unchanged the entry holding the mark (a notes copy) or the entry
titled like the marked slide (a slides copy). With `at`: PASS when a new-build section whose heading
carries it is not in the marked round's notes copy unchanged.

stdout is one reason line naming the matched new-build page as `page N` when there is one (target both:
the slides and notes reasons joined by "; "). MuPDF's diagnostics go to stderr, never into the reason.

Exit: 0 PASS · 1 FAIL · 2 could not run (bad arguments or stdin, a copy or its needed sibling not found,
--notes needed but not given or missing, a page range outside the deck).
"""

from __future__ import annotations

import argparse
import functools
import json
import re
import sys
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

PROG = "review-check-deck"
COUNTER = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*$", re.MULTILINE)
HEADER_BAND, FOOTER_BAND = 0.08, 0.95  # page-height fractions holding the running section header and the footer
TITLE_CHARS = 90
UNTITLED = "untitled slide"
TARGETS = ("slides", "notes", "both")
GONE_BELOW = 0.5  # best text similarity under this: the marked slide (or notes entry) is not in the new build
VERIFY_DPI = 50
PIXEL_DELTA = 40  # a channel difference above this changes the pixel; anti-aliasing noise sits far below
PIXEL_SHARE = 0.0002  # changed-pixel share of the content band above which two renders differ
NOTES_FOOTER = re.compile(r"^\s*\d+\s+of\s+\d+\s*$")


class CouldNotRun(Exception):
    """Exit 2."""


@functools.cache
def pymupdf():
    try:
        import pymupdf as m
    except ImportError as e:
        raise CouldNotRun("pymupdf is not importable; launch through bin/review-check-deck") from e
    m.set_messages(stream=sys.stderr)  # MuPDF reports a damaged PDF's errors on stdout by default; stdout is the reason
    return m


# ── text helpers ──────────────────────────────────────────────────────────────

def norm(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace(" ", " ").replace("‑", "-").replace("~", " ")
    return " ".join(s.split()).lower()


def squash(s: str) -> str:
    return re.sub(r"\W+", "", norm(s))


def clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + " …"


# ── slides ────────────────────────────────────────────────────────────────────

def slide_runs(doc, first: int, last: int) -> list[tuple[int, int]]:
    """(first, last) 0-based page indexes of each counter run within 1-based pages first..last."""
    runs, prev = [], None
    for i in range(first - 1, last):
        m = COUNTER.findall(doc[i].get_text())
        k = m[-1] if m else ("page", i)
        if k == prev:
            runs[-1] = (runs[-1][0], i)
        else:
            runs.append((i, i))
        prev = k
    return runs


def final_builds(doc, first: int, last: int) -> list[int]:
    """0-based indexes of the last page of each counter run within 1-based pages first..last."""
    return [e for _, e in slide_runs(doc, first, last)]


def outline_titles(doc) -> dict[int, str]:
    """1-based page -> the latest outline title at or before it."""
    toc = doc.get_toc(simple=True)
    out, cur, j = {}, "", 0
    entries = sorted(((p, n, t) for n, (_, t, p) in enumerate(toc) if p > 0))
    for page in range(1, doc.page_count + 1):
        while j < len(entries) and entries[j][0] <= page:
            cur = entries[j][2]
            j += 1
        out[page] = cur
    return out


def own_lines(page) -> list[tuple[float, bool, str]]:
    """(font size, all bold, text) per line of the page's own content, the running header band at the top and the
    footer band (author, date, "n / N") skipped."""
    h = page.rect.height
    out = []
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            y0, y1 = ln["bbox"][1], ln["bbox"][3]
            if y1 <= h * HEADER_BAND or y0 >= h * FOOTER_BAND:
                continue
            spans = [sp for sp in ln["spans"] if sp["text"].strip()]
            if spans:
                text = " ".join("".join(sp["text"] for sp in spans).replace("\xa0", " ").split())
                out.append((max(sp["size"] for sp in spans), all(sp["flags"] & 16 for sp in spans), text))
    return out


def own_title(page) -> str:
    """The page's first run of largest-font lines in one weight: a headline card's headline, an untitled slide's
    title (body text can share the title's size, never its run)."""
    lines = own_lines(page)
    if not lines:
        return ""
    top = max(sz for sz, _, _ in lines)
    at = next(i for i, (sz, _, _) in enumerate(lines) if sz >= top - 0.5)
    run = [lines[at]]
    for sz, bold, t in lines[at + 1:]:
        if sz < top - 0.5 or bold != run[0][1]:
            break
        run.append((sz, bold, t))
    return clip(" ".join(t for _, _, t in run), TITLE_CHARS)


def untitled_name(page, after: str) -> str:
    own = own_title(page) or "[no text on the page]"
    return f"{own} ({UNTITLED} after: {clip(after, 60)})" if after else f"{own} ({UNTITLED})"


def slide_name(page, heading: str) -> str:
    """The marked slide's name from the row's heading. doc-marks names a page from the copy's outline, which carries
    the previous slide's title onto a headline card or image slide; such a page is named from its own text."""
    if heading and f"({UNTITLED}" not in heading and \
            squash(heading)[:40] not in squash(" ".join(t for *_, t in own_lines(page))):
        return untitled_name(page, "" if re.fullmatch(r"Page \d+", heading) else heading)
    return heading


def page_text(page) -> str:
    """The page's own text, normalized: no running header, no footer (author, date, "n / N"), and numbering
    ("Discussion Questions 6 of 9", a list item's "6.") masked, so a renumbered slide is not a changed one."""
    return mask_numbering(norm(" ".join(t for *_, t in own_lines(page))))


def mask_numbering(t: str) -> str:
    return re.sub(r"(?<!\S)\d{1,2}\.(?!\d)", "#.", re.sub(r"\b\d+ of \d+\b", "# of #", t))


def similarity(a: str, b: str, floor: float = 0.0) -> float:
    """Word-sequence similarity in [0, 1]; 0 when it cannot beat `floor`."""
    if a == b:
        return 1.0
    sm = SequenceMatcher(None, a.split(), b.split(), autojunk=False)
    if sm.real_quick_ratio() <= floor or sm.quick_ratio() <= floor:
        return 0.0
    return sm.ratio()


def numbering_rects(page) -> list[tuple[float, float, float, float]]:
    """Where the numbering page_text masks is drawn: both numbers of "n of N", a list item's "6."."""
    words = page.get_text("words")
    out = []
    for k, w in enumerate(words):
        if re.fullmatch(r"\d{1,2}\.\D*", w[4]):
            out.append(w[:4])
        if w[4] == "of" and 0 < k < len(words) - 1 and words[k - 1][4].isdigit() and re.match(r"\d", words[k + 1][4]):
            out += [words[k - 1][:4], words[k + 1][:4]]
    return out


def render_share(p1, p2, dpi: int = VERIFY_DPI) -> float:
    """Share of the content band's pixels (header and footer bands cut, ink not drawn, numbering masked) that differ
    between two pages."""
    m = pymupdf()

    def band(p):
        r = p.rect
        clip = m.Rect(0, r.height * HEADER_BAND, r.width, r.height * FOOTER_BAND)
        return p.get_pixmap(dpi=dpi, clip=clip, annots=False, alpha=False, colorspace=m.csRGB)

    a, b = band(p1), band(p2)
    w, h = a.width, a.height
    if (w, h) != (b.width, b.height):
        return 1.0
    sa, sb = a.samples, b.samples
    if sa == sb:
        return 0.0
    mask = bytearray(w * h)
    zoom, top = dpi / 72, p1.rect.height * HEADER_BAND
    for x0, y0, x1, y1 in numbering_rects(p1) + numbering_rects(p2):
        c0, c1 = max(0, int(x0 * zoom) - 1), min(w, int(x1 * zoom) + 2)
        for y in range(max(0, int((y0 - top) * zoom) - 1), min(h, int((y1 - top) * zoom) + 2)):
            mask[y * w + c0: y * w + c1] = b"\1" * (c1 - c0)
    changed = sum(1 for px in range(w * h) if not mask[px] and
                  max(abs(sa[3 * px] - sb[3 * px]), abs(sa[3 * px + 1] - sb[3 * px + 1]),
                      abs(sa[3 * px + 2] - sb[3 * px + 2])) > PIXEL_DELTA)
    return changed / (w * h)


def crossed(old: list[str], i: int, new: list[str], j: int) -> int | None:
    """Index in `new` of a slide (unique, identical text in both) that sits on the other side of old[i] = new[j]:
    the marked slide moved past it. Insertions, cuts and edits elsewhere never cross."""
    co, cn = Counter(old), Counter(new)
    pos = {t: k for k, t in enumerate(new) if cn[t] == 1}
    for k, t in enumerate(old):
        if t and t != old[i] and co[t] == 1 and t in pos and (k < i) != (pos[t] < j):
            return pos[t]
    return None


def check_slide(old_doc, old_texts: list[str], i: int, new: list[tuple[int, object, str]]) -> dict:
    """FAIL iff some page of the new build has the marked page's text, renders the same and has not moved past
    another slide; else how it changed."""
    old_page, old = old_doc[i], old_texts[i]
    new_texts = [t for *_, t in new]
    same = [(j, n, p) for j, (n, p, t) in enumerate(new) if t == old]
    shares, moves = [], []
    for j, n, p in same:
        share = render_share(old_page, p)
        if share > PIXEL_SHARE:
            shares.append((share, n))
            continue
        k = crossed(old_texts, i, new_texts, j)
        if k is None:
            return {"status": "FAIL", "reason": "unchanged: same text, same rendering, same place", "matched_page": n}
        moves.append((n, new[k][0]))
    if moves:
        n, past = moves[0]
        return {"status": "PASS", "reason": f"moved: unchanged, now on the other side of p.{past}", "matched_page": n}
    if shares:
        share, n = min(shares)
        return {"status": "PASS", "reason": f"rendering changed, text the same ({share:.2%} of pixels differ)", "matched_page": n}
    best, at = 0.0, None
    for n, _, t in new:
        sim = similarity(old, t, best)
        if sim > best:
            best, at = sim, n
    if best < GONE_BELOW:
        return {"status": "PASS", "reason": f"slide gone from the new build (best similarity {best:.2f})", "matched_page": at}
    return {"status": "PASS", "reason": f"text changed (similarity {best:.2f})", "matched_page": at}


def check_at(old_doc, old_texts: list[str], i: int, at: str, new: list[tuple[int, object, str]]) -> dict:
    """The edit landed on another slide (a slide added elsewhere, or the marked slide moved): PASS iff a new-build slide
    carrying `at` is not in the marked copy unchanged (same text, same rendering), or it is the marked slide itself
    (matched by its whole text, since titles like "Discussion Questions # of #" recur) and it moved."""
    want = mask_numbering(norm(at))
    new_texts = [t for *_, t in new]
    hits = [(j, n, p, t) for j, (n, p, t) in enumerate(new) if want in t]
    if not hits:
        return {"status": "FAIL", "reason": f"no slide in the new build carries {at!r}", "matched_page": None}
    for j, n, p, t in hits:
        twins = [k for k, ot in enumerate(old_texts) if ot == t and render_share(old_doc[k], p) <= PIXEL_SHARE]
        if not twins:
            return {"status": "PASS", "reason": f"new or changed slide carries {at!r}", "matched_page": n}
        if t == old_texts[i] and i in twins and (k := crossed(old_texts, i, new_texts, j)) is not None:
            return {"status": "PASS", "reason": f"moved: the marked slide carries {at!r}, unchanged, now on the other side "
                                                f"of p.{new[k][0]}", "matched_page": n}
    return {"status": "FAIL", "reason": f"every slide carrying {at!r} is in the marked copy unchanged", "matched_page": hits[0][1]}


# ── notes ─────────────────────────────────────────────────────────────────────

def entry_key(title: str) -> str:
    t = norm(title)
    m = re.fullmatch(r"next slide \((.*)\)", t)
    return m.group(1) if m else t


def slide_key(name: str) -> str:
    return norm(name.split(f" ({UNTITLED}")[0])


def notes_entries(doc) -> list[dict]:
    """One entry per outline title the page text carries, in order: the title's block up to the next title's block,
    the running header band and "n of N" page footers left out. Notes reflow, so an entry, not a page, is the unit."""
    blocks = []
    for i, page in enumerate(doc):
        h = page.rect.height
        for b in page.get_text("blocks"):
            if b[6] != 0 or b[3] <= h * HEADER_BAND:
                continue
            t = norm(" ".join(ln for ln in b[4].splitlines() if not NOTES_FOOTER.match(ln)))
            if t:
                blocks.append((i + 1, b[1], t))
    starts, j = [], 0
    for lvl, title, p in doc.get_toc(simple=True):
        k = norm(title)[:40]
        if p <= 0 or not k:
            continue
        hit = next((n for n in range(j, len(blocks)) if blocks[n][2].startswith(k)), None)
        if hit is not None:
            starts.append((lvl, title, hit))
            j = hit + 1
    return [{"title": title, "level": lvl, "page": blocks[n][0], "y": blocks[n][1],
             "text": " ".join(b[2] for b in blocks[n: starts[m + 1][2] if m + 1 < len(starts) else len(blocks)])}
            for m, (lvl, title, n) in enumerate(starts)]


def notes_sections(entries: list[dict]) -> list[dict]:
    """Per entry, its section: the entry and every deeper entry after it, up to the next at its level or above
    (a `== October 29, 2026` heading and the NEXT SLIDE entries an `#include` put under it)."""
    out = []
    for m, e in enumerate(entries):
        end = next((q for q in range(m + 1, len(entries)) if entries[q]["level"] <= e["level"]), len(entries))
        out.append({**e, "text": " ".join(x["text"] for x in entries[m:end])})
    return out


def entry_for_slide(entries: list[dict], name: str, text: str) -> dict | None:
    """The notes entry whose title best matches the slide's name; equal titles (Discussion Questions 1 of 4 recurs)
    go to the entry whose text is most like the slide's."""
    key = slide_key(name)
    scored = [(similarity(key, entry_key(e["title"])), e) for e in entries]
    top = max((s for s, _ in scored), default=0.0)
    if top < GONE_BELOW:
        return None
    tied = [e for s, e in scored if s == top]
    return max(tied, key=lambda e: similarity(text, e["text"]))


def entry_at(entries: list[dict], page: int, y: float) -> dict | None:
    """The entry holding a mark at (page, y): the last one starting at or before it."""
    before = [e for e in entries if (e["page"], e["y"]) <= (page, y)]
    return before[-1] if before else None


def check_notes(old: dict, new: list[dict]) -> dict:
    """FAIL iff the new notes carry the old entry's text unchanged; else how it changed."""
    if any(e["text"] == old["text"] for e in new):
        hit = next(e for e in new if e["text"] == old["text"])
        return {"status": "FAIL", "reason": f"notes entry unchanged: {clip(old['title'], 70)}", "matched_page": hit["page"]}
    key = entry_key(old["title"])
    scored = [(similarity(key, entry_key(e["title"])), similarity(old["text"], e["text"]), e) for e in new]
    if not scored or max(s for s, _, _ in scored) < GONE_BELOW:
        return {"status": "PASS", "reason": f"notes entry gone: {clip(old['title'], 70)}", "matched_page": None}
    _, xs, e = max(scored, key=lambda x: (x[0], x[1]))
    return {"status": "PASS", "reason": f"notes entry changed (similarity {xs:.2f}): {clip(old['title'], 70)}",
            "matched_page": e["page"]}


def check_notes_at(old: list[dict], at: str, new: list[dict]) -> dict:
    """The notes edit landed in another entry or section, named by its heading text `at`: PASS iff a new-build section
    whose heading carries `at` is not in the marked notes copy unchanged (numbering masked)."""
    want = norm(at)
    hits = [x for x in notes_sections(new) if want in norm(x["title"])]
    if not hits:
        return {"status": "FAIL", "reason": f"no notes entry in the new build is headed {at!r}", "matched_page": None}
    before = {mask_numbering(x["text"]) for x in notes_sections(old)}
    for x in hits:
        if mask_numbering(x["text"]) not in before:
            return {"status": "PASS", "reason": f"new or changed notes section headed {clip(x['title'], 70)!r}",
                    "matched_page": x["page"]}
    return {"status": "FAIL", "reason": f"every notes section headed {at!r} is in the marked notes copy unchanged",
            "matched_page": hits[0]["page"]}


# ── one mark ──────────────────────────────────────────────────────────────────

def sibling(copy: Path, kind: str) -> Path:
    return copy.with_name(re.sub(r" (slides|notes) review ", f" {kind} review ", copy.name, count=1))


def parse_pages(spec: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d+)-(\d+)", spec or "")
    if not m:
        raise CouldNotRun(f"--pages {spec!r}: expected A-B")
    return int(m.group(1)), int(m.group(2))


def read_payload(raw: str) -> tuple[dict, dict]:
    try:
        payload = json.loads(raw)
    except ValueError as e:
        raise CouldNotRun(f"stdin is not JSON ({e})") from None
    if not isinstance(payload, dict) or not isinstance(payload.get("mark"), dict) \
            or not isinstance(payload.get("outcome"), dict):
        raise CouldNotRun('stdin: expected {"mark": <ledger row>, "outcome": <outcome value>}')
    row, o = payload["mark"], payload["outcome"]
    page = row.get("page")
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise CouldNotRun(f"mark page {page!r}: expected a 1-based page number")
    if o.get("target") is not None and o["target"] not in TARGETS:
        raise CouldNotRun(f"outcome target {o['target']!r}: expected one of {', '.join(TARGETS)}")
    if o.get("at") is not None and not isinstance(o["at"], str):
        raise CouldNotRun(f"outcome at {o['at']!r}: expected text")
    return row, o


def copy_path(copies: Path, name) -> Path:
    if not isinstance(name, str) or not name or "/" in name or "\\" in name or ".." in name:
        raise CouldNotRun(f"mark copy {name!r}: expected a file name under --copies-dir")
    return copies / name


def open_pdf(path: Path, what: str):
    if not path.is_file():
        raise CouldNotRun(f"{what} {path} does not exist")
    try:
        return pymupdf().open(path)
    except Exception as e:  # noqa: BLE001 -- pymupdf raises its own FileDataError family
        raise CouldNotRun(f"{what} {path}: not a readable PDF ({e})") from None


def check_mark(a, row: dict, o: dict) -> list[dict]:
    """teaching's cmd_verify for one applied mark: the slides and/or notes checks its target names."""
    copies = Path(a.copies_dir).expanduser()
    if not copies.is_dir():
        raise CouldNotRun(f"--copies-dir {copies}: no such directory")
    copy = copy_path(copies, row.get("copy"))
    on_notes = " notes review " in copy.name
    target = o.get("target") or ("notes" if on_notes else "slides")
    at = o.get("at")
    ddoc = open_pdf(Path(a.deck).expanduser(), "deck")
    first, last = parse_pages(a.pages) if a.pages else (1, ddoc.page_count)
    if not (1 <= first <= last <= ddoc.page_count):
        raise CouldNotRun(f"page range {first}-{last} is outside {Path(a.deck).name} (1-{ddoc.page_count})")
    notes_pdf = None
    if target != "slides":
        if not a.notes:
            raise CouldNotRun(f"target {target} needs the new notes build; pass --notes")
        notes_pdf = Path(a.notes).expanduser()
        if not notes_pdf.is_file():
            raise CouldNotRun(f"notes build {notes_pdf} does not exist")
    marked = open_pdf(copy, "review copy")
    if row["page"] > marked.page_count:
        raise CouldNotRun(f"mark page {row['page']} is outside {copy.name} (1-{marked.page_count})")
    y = (row.get("rect") or [0, 0])[1]
    docs: dict[Path, object] = {copy: marked}

    def opened(p: Path):
        if p not in docs:
            docs[p] = open_pdf(p, "review copy")
        return docs[p]

    def old_slide():
        """(copy, 0-based page) of the marked slide: its page on a slides copy; on a notes copy, the same round's
        slides page named like the entry holding the mark."""
        if not on_notes:
            return marked, row["page"] - 1
        e = entry_at(notes_entries(marked), row["page"], y)
        sdoc = opened(sibling(copy, "slides"))
        names = outline_titles(sdoc)
        key = entry_key(e["title"]) if e else ""
        n = max(range(1, sdoc.page_count + 1), key=lambda p: similarity(key, slide_key(names.get(p, ""))))
        return sdoc, n - 1

    def old_notes() -> list[dict]:
        """The marked round's notes entries: the copy itself, or the same round's notes copy for a slides mark."""
        return notes_entries(marked if on_notes else opened(sibling(copy, "notes")))

    def old_entry():
        if on_notes:
            return entry_at(old_notes(), row["page"], y)
        page = marked[row["page"] - 1]
        return entry_for_slide(old_notes(), slide_name(page, row.get("heading") or ""), page_text(page))

    checks = []
    if target in ("slides", "both"):
        new_slides = [(i + 1, ddoc[i], page_text(ddoc[i])) for i in final_builds(ddoc, first, last)]
        odoc, i = old_slide()
        ot = [page_text(p) for p in odoc]
        checks.append({"on": "slides", **(check_at(odoc, ot, i, at, new_slides) if at else
                                          check_slide(odoc, ot, i, new_slides))})
    if target in ("notes", "both"):
        new_entries = notes_entries(open_pdf(notes_pdf, "notes build"))
        if at:
            checks.append({"on": "notes", **check_notes_at(old_notes(), at, new_entries)})
        else:
            e = old_entry()
            checks.append({"on": "notes", **(check_notes(e, new_entries) if e else
                                             {"status": "FAIL", "matched_page": None, "reason":
                                              "no notes entry for the marked slide in the marked round's notes copy"})})
    return checks


def reason_line(checks: list[dict]) -> str:
    parts = [f"{c['reason']} (new {'deck' if c['on'] == 'slides' else 'notes'} page {c['matched_page']})"
             if c.get("matched_page") else c["reason"] for c in checks]
    return " ".join("; ".join(parts).split("\n"))


# ── CLI ───────────────────────────────────────────────────────────────────────

def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog=PROG, description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--deck", required=True, help="the new slides build")
    ap.add_argument("--pages", help="the deck page range A-B to check against (default: every page)")
    ap.add_argument("--notes", help="the new notes build; needed for target notes or both")
    ap.add_argument("--copies-dir", required=True, help="the directory holding the review copies the ledger names")
    return ap


def main(argv=None) -> int:
    a = parser().parse_args(argv)  # a bad or missing argument exits 2 itself
    try:
        row, o = read_payload(sys.stdin.read())
        checks = check_mark(a, row, o)
    except CouldNotRun as e:
        print(f"{PROG}: COULD-NOT-RUN: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001 -- an uncaught crash exits 1, which review-ledger reads as a verdict
        print(f"{PROG}: COULD-NOT-RUN: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    print(reason_line(checks))
    return 1 if any(c["status"] == "FAIL" for c in checks) else 0


if __name__ == "__main__":
    sys.exit(main())
