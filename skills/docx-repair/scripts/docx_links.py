#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["lxml"]
# ///
"""Hyperlink hygiene for a .docx: tracking params, SSRN forms, stray wrappers.

    docx_links.py FILE [--strip-tracking] [--canonical-ssrn] [--unwrap-footnotes]
                       [--all] [--in-place | --output OUT] [--check]

THE ONE THING TO KNOW

A hyperlink in OOXML is *two* facts stored in different parts: the run text a
reader sees (`word/*.xml`) and the relationship `Target` the click follows
(`word/_rels/*.rels`). Nothing keeps them in sync. Fix only the run text and
you leave a footnote that PRINTS one URL and NAVIGATES to another — invisible
on the page and invisible in any text diff, including a prose diff of the
manuscript. Every rewrite here touches both places or neither.

THE PASSES

`--strip-tracking`   Remove analytics parameters (utm_*, fbclid, gclid, …).
                     Only known analytics keys go. Query strings are frequently
                     load-bearing in legal citation — `?abstract_id=` on SSRN,
                     `?doc=` on court sites — so a blanket "drop everything
                     after ?" silently breaks the cites it was meant to tidy.

`--canonical-ssrn`   Rewrite `papers.ssrn.com` / `http://` SSRN URLs to the bare
                     `https://ssrn.com/abstract=N`. Both still resolve, but a
                     manuscript spelling one source two ways in two footnotes
                     reads as carelessness to a cite-checker. The abstract id is
                     carried through untouched.

`--unwrap-footnotes` Delete `w:hyperlink` wrappers in `word/footnotes.xml`,
                     leaving the run text. For templates where a URL is plain
                     text. These wrappers are invisible in Word when the runs
                     carry no colour/underline/Hyperlink style of their own —
                     but LibreOffice renders ANY hyperlink with its own
                     "Internet Link" styling, so they surface as blue
                     underlined text in a LibreOffice-produced PDF that the
                     .docx never asked for. Worse, a pasted wrapper's anchor
                     often spans the WRONG text, so visible words point at a URL
                     that is not theirs.

                     Footnotes only. A body `w:hyperlink` is usually an internal
                     TOC or cross-reference link and is load-bearing.

WHY lxml AND NOT ElementTree

ElementTree re-emits only the namespaces it sees in use, silently dropping the
two dozen w14/w15/w16* declarations a real Word file carries and leaving
`mc:Ignorable` pointing at undeclared prefixes — invalid OOXML that Word
rejects. lxml preserves the full nsmap (verified: 35 declarations in, 35 out).
The structural `--unwrap-footnotes` pass edits bytes directly and touches
nothing else.
"""

from __future__ import annotations

import argparse
import re
import shutil
import zipfile
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
TEXT_PARTS = ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml",
              "word/header1.xml", "word/header2.xml", "word/header3.xml",
              "word/footer1.xml", "word/footer2.xml", "word/footer3.xml")

TRACKING = re.compile(
    r"^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|ncid"
    r"|cmpid|s_cid|spm|ref_src|ref_url|src|source|campaign|at_medium"
    r"|at_campaign|guccounter|__twitter_impression|wt\.mc_id)$", re.IGNORECASE)

SSRN = re.compile(
    r"https?://(?:www\.)?papers\.ssrn\.com/(?:sol3/papers\.cfm\?)?abstract(?:_id)?=(\d+)")

URL_RE = re.compile(r"https?://[^\s<>\"')\],;]+")


def strip_tracking(url: str) -> str:
    parts = urlsplit(url)
    if not parts.query:
        return url
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    keep = [(k, v) for k, v in pairs if not TRACKING.match(k)]
    if len(keep) == len(pairs):
        return url
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(keep), parts.fragment))


def canonical_ssrn(url: str) -> str:
    return SSRN.sub(lambda m: f"https://ssrn.com/abstract={m.group(1)}", url)


def rewrite_urls(parts: dict[str, bytes], fns) -> list[tuple[str, str, str]]:
    """Apply URL rewriters to visible text AND relationship targets."""
    def apply(u: str) -> str:
        for f in fns:
            u = f(u)
        return u

    hits: list[tuple[str, str, str]] = []
    for name in list(parts):
        if name.endswith(".rels"):
            root = etree.fromstring(parts[name])
            dirty = False
            for rel in root:
                tgt = rel.get("Target") or ""
                if not tgt.startswith("http"):
                    continue
                new = apply(tgt)
                if new != tgt:
                    rel.set("Target", new)
                    hits.append((name, tgt, new))
                    dirty = True
            if dirty:
                parts[name] = etree.tostring(root, xml_declaration=True,
                                             encoding="UTF-8", standalone=True)
        elif name in TEXT_PARTS:
            root = etree.fromstring(parts[name])
            dirty = False
            for t in root.iter(f"{{{W}}}t"):
                if not t.text or "http" not in t.text:
                    continue
                new = URL_RE.sub(lambda m: apply(m.group(0)), t.text)
                if new != t.text:
                    hits.append((name, t.text.strip()[:80], new.strip()[:80]))
                    t.text = new
                    dirty = True
            if dirty:
                parts[name] = etree.tostring(root, xml_declaration=True,
                                             encoding="UTF-8", standalone=True)
    return hits


def unwrap_footnote_links(parts: dict[str, bytes]) -> int:
    """Replace <w:hyperlink …>…</w:hyperlink> with its children, in footnotes.

    Textual so that every other byte of the part is preserved: these files
    round-trip through Word, and an incidental reserialisation is a far bigger
    diff than the edit itself.
    """
    name = "word/footnotes.xml"
    if name not in parts:
        return 0
    xml = parts[name]
    out, pos, count = [], 0, 0
    open_re = re.compile(rb"<w:hyperlink\b[^>]*?(/?)>")
    tag_re = re.compile(rb"<(/?)w:hyperlink\b[^>]*?(/?)>")
    while True:
        m = open_re.search(xml, pos)
        if not m:
            out.append(xml[pos:])
            break
        out.append(xml[pos:m.start()])
        count += 1
        if m.group(1):                       # self-closing: no children
            pos = m.end()
            continue
        depth, i = 1, m.end()
        while depth:
            nxt = tag_re.search(xml, i)
            if not nxt:
                raise SystemExit("unbalanced w:hyperlink in footnotes.xml")
            if nxt.group(1):
                depth -= 1
            elif not nxt.group(2):
                depth += 1
            i = nxt.end()
            if depth == 0:
                out.append(xml[m.end():nxt.start()])
                pos = i
    if count:
        parts[name] = b"".join(out)
    return count


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("docx", type=Path)
    ap.add_argument("--strip-tracking", action="store_true")
    ap.add_argument("--canonical-ssrn", action="store_true")
    ap.add_argument("--unwrap-footnotes", action="store_true")
    ap.add_argument("--all", action="store_true", help="every pass")
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument("--output", type=Path)
    ap.add_argument("--check", action="store_true",
                    help="report, change nothing, exit 1 if work remains")
    args = ap.parse_args()

    do_track = args.strip_tracking or args.all
    do_ssrn = args.canonical_ssrn or args.all
    do_unwrap = args.unwrap_footnotes or args.all
    if not (do_track or do_ssrn or do_unwrap):
        ap.error("choose at least one pass, or --all")

    zin = zipfile.ZipFile(args.docx)
    parts = {i.filename: zin.read(i.filename) for i in zin.infolist()}
    order = [i for i in zin.infolist()]
    zin.close()

    n_unwrapped = unwrap_footnote_links(parts) if do_unwrap else 0
    fns = ([strip_tracking] if do_track else []) + ([canonical_ssrn] if do_ssrn else [])
    hits = rewrite_urls(parts, fns) if fns else []

    for part, before, after in hits:
        print(f"  {part.split('/')[-1]}")
        print(f"    - {before}")
        print(f"    + {after}")
    if do_unwrap:
        print(f"  footnote hyperlink wrappers unwrapped: {n_unwrapped}")
    print(f"{len(hits)} URL rewrite(s), {n_unwrapped} wrapper(s) removed"
          f" in {args.docx.name}")

    work = bool(hits or n_unwrapped)
    if args.check:
        return 1 if work else 0
    if not work:
        return 0

    dest = args.docx if args.in_place else (
        args.output or args.docx.with_name(args.docx.stem + " (links cleaned).docx"))
    tmp = str(dest) + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in order:
            zout.writestr(item, parts[item.filename])
    shutil.move(tmp, dest)
    print(f"wrote {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
