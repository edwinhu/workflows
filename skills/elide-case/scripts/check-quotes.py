#!/usr/bin/env python3
"""Verify every retained quotation in an addendum against the retrieved source text.

Usage: check-quotes.py <addendum.typ> <source.docx|source.txt> [--caption "TITLE"]
                       [--min-len 60]

The SOURCE OF RECORD IS THE `.westlaw.docx`. Passed one, this script projects it to text
IN MEMORY with the `workflows:westlaw` extractor — the same script that used to write the
`.westlaw.txt`, so there is no second implementation to drift — and preserves its italic
runs as Typst emphasis. A stored `.txt` is still accepted unchanged, and is what the
CourtListener/RECAP fallback route yields; that route has no formatting layer at all, so a
`.txt` source prints an explicit ITALICS NOT CHECKED line rather than passing silently.

Reads the source text, strips the page furniture that `pdftotext -layout` leaves
interleaved mid-sentence (ECF running headers, form feeds, standalone page numbers,
Westlaw star-pagination markers such as `*329`),
extracts the excerpt prose from the `.typ`, and reports every sentence at or above
--min-len characters that does not appear in the source.

Footnote apparatus is handled too: inline reference markers ("et al.,1") are stripped
from the source, and a sentence interrupted by a bottom-of-page footnote block is matched
across ONE bounded source gap and reported separately for a human to confirm.

A bracketed span is tried both ways: dropped (an editorial insertion, `[, for example,]`)
and kept without its brackets (a case change, `[T]he`). Each span in a sentence is decided
independently, so a sentence carrying both shapes still matches.

Sentences carrying an INTERNAL elision are additionally checked for integrity: every
fragment of >= 25 characters must be real source text, and the fragments must appear in
increasing, non-overlapping source order.

Exit 0 only when nothing is missing, no sentence fails integrity, and every reading
actually yielded a sentence to check — a reading that verified nothing is a FAIL, not a
pass. Gapped matches and the fused-half-sentence advisory print but do not fail the run.

A match here proves fidelity to the FILE, not to the reporter: an OCR-damaged `.txt`
matches its own damage. Retained passages must still be eyeballed against the `.pdf`.
"""

import argparse
import importlib.util
import re
import sys
from itertools import pairwise, product
from pathlib import Path

# ------------------------------------------------------------ source projection

# The `workflows:westlaw` extractor. Reused rather than reimplemented: Westlaw's
# XMLMIND_DOCX is FLAT OPC (document.xml at the zip ROOT, not word/document.xml), which
# python-docx cannot open, and a second copy of that knowledge is a second thing to drift.
WESTLAW_EXTRACTOR = Path(
    "/home/eh/.claude/skills/workflows/skills/westlaw/scripts/westlaw-docx-text.py"
)


def load_source(path: Path) -> tuple[str, str]:
    """(text, provenance) for a source. A `.docx` is projected in memory, never to disk."""
    if path.suffix.lower() != ".docx":
        return path.read_text(encoding="utf-8", errors="replace"), "txt"
    if not WESTLAW_EXTRACTOR.is_file():
        raise SystemExit(
            f"FAIL setup: {path.name} is a .docx but the westlaw extractor is missing at "
            f"{WESTLAW_EXTRACTOR}; there is nothing to project it with"
        )
    spec = importlib.util.spec_from_file_location("westlaw_docx_text", WESTLAW_EXTRACTOR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.project(str(path), emphasis=True), "docx"


# ------------------------------------------------------------- page furniture

# ECF running header, spacing-tolerant and not tied to any one docket:
#   Case 1:19-cv-09439-PKC   Document 227   Filed 03/24/20   Page 39 of 44
ECF_HEADER = re.compile(
    r"^[ \t]*Case\s+\S+\s+Document\s+\S+\s+Filed\s+\S+\s+"
    r"Page\s+\d+\s+of\s+\d+[ \t]*$",
    re.MULTILINE | re.IGNORECASE,
)
# A line that is nothing but a page number (optionally decorated: "- 38 -", "[38]").
PAGE_NUMBER_LINE = re.compile(r"^[ \t]*[\[\(\-–—]*\s*\d{1,4}\s*[\]\)\-–—]*[ \t]*$",
                              re.MULTILINE)
# Westlaw star pagination, interleaved mid-sentence: "the vast *329 majority of". Anchored
# to one or two asterisks IMMEDIATELY followed by digits and then a non-digit, so an
# emphasis or footnote asterisk ("* * *", "see note *") keeps its meaning. One trailing
# space goes with it, since the marker sits between two words that are contiguous in the
# reporter. A case reported in two reporters carries TWO interleaved series and Westlaw
# marks the parallel one with a DOUBLE asterisk ("airman *538 **304 Brian"); matching only
# a single asterisk strands a bare "*" mid-sentence and breaks verbatim matching.
STAR_PAGE = re.compile(r"\*\*?\d+\b ?")
# Inline footnote reference marker: 1-2 digits welded to a word, a comma, a closing
# quote or a closing paren with no space before it ("et al.,1", "market speculation,5").
# A digit preceded by whitespace survives ("Securities Acts of 1933", "328 U.S. 293"), and
# so does one preceded by a PERIOD: a footnote pincite ("560 n.11", "87 F.3d at 552") is
# reporter text, and eating its digits manufactures a miss on a correct excerpt.
FOOTNOTE_MARKER = re.compile(
    r"(?<![0-9][.,])(?<=[A-Za-z”’\"'`,\)])\d{1,2}(?![\w\d])"
)


def strip_furniture(text: str) -> str:
    text = text.replace("\f", "\n")
    text = ECF_HEADER.sub("", text)
    text = PAGE_NUMBER_LINE.sub("", text)
    # Before FOOTNOTE_MARKER: that rule would otherwise eat the digits of a 1-2 digit
    # star page and leave a bare asterisk behind.
    text = STAR_PAGE.sub("", text)
    text = FOOTNOTE_MARKER.sub("", text)
    # The projection's emphasis markers, DELETED rather than left for norm() to fold to a
    # space — exactly as strip_typ_markup() deletes them on the other side. An italic run
    # that starts mid-word ("re_habilitate_") would otherwise normalise to "re habilitate"
    # on the source side and "rehabilitate" on the excerpt side, manufacturing a miss on a
    # correct excerpt. A literal underscore in reporter text is not a thing.
    text = text.replace("_", "")
    return text


# --------------------------------------------------------------- typ parsing

CAPTION_RE = re.compile(
    r"#align\(center\)\s*\[\s*#text\(13pt,\s*weight:\s*\"bold\"\)\s*\[",
    re.DOTALL,
)

ELISION = re.compile(r"\[\s*(?:\.\s*){2,}\]|\[\s*(?:…|\.\.\.)\s*\]")


def match_bracket(src: str, open_at: int, opener: str, closer: str) -> int:
    depth = 0
    i = open_at
    while i < len(src):
        c = src[i]
        if c == "\\":
            i += 2
            continue
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError(f"unbalanced {opener!r} starting at offset {open_at}")


def readings(src: str) -> list[tuple[str, str]]:
    """(caption title, body text) for each per-reading caption block."""
    out = []
    marks = list(CAPTION_RE.finditer(src))
    for i, m in enumerate(marks):
        title_open = m.end() - 1
        title_end = match_bracket(src, title_open, "[", "]")
        title = src[title_open + 1 : title_end - 1].strip()
        # The caption block is the enclosing #align(center)[ ... ]; skip past it.
        block_open = src.index("[", m.start())
        block_end = match_bracket(src, block_open, "[", "]")
        body_start = block_end
        body_end = marks[i + 1].start() if i + 1 < len(marks) else len(src)
        out.append((title, src[body_start:body_end]))
    return out


EDITORS_NOTE = re.compile(r"#emph\s*\[\s*\[\s*Editors", re.IGNORECASE)

# An editorial prose block: a `#text(10pt)[...]` whose paragraphs run from one headed
# `*[Editors' note` to the end of the block. It is the editor's commentary, not court
# text, so it always reports as missing — hence --skip-editorial, off by default.
SMALL_TEXT = re.compile(r"#text\(10pt\)\s*\[")
EDITORIAL_PARA = re.compile(r"^\s*\*\[\s*Editors['’]? note", re.IGNORECASE)


def drop_editorial_blocks(body: str) -> str:
    out: list[str] = []
    at = 0
    while True:
        m = SMALL_TEXT.search(body, at)
        if not m:
            out.append(body[at:])
            return "".join(out)
        open_at = m.end() - 1
        try:
            end = match_bracket(body, open_at, "[", "]")
        except ValueError:
            out.append(body[at:])
            return "".join(out)
        kept: list[str] = []
        for chunk in re.split(r"(\n\s*\n)", body[open_at + 1 : end - 1]):
            if EDITORIAL_PARA.match(chunk):
                break
            kept.append(chunk)
        out.append(body[at : open_at + 1])
        out.append("".join(kept))
        out.append("]")
        at = end


# A machine directive line (`// elide-source: X.westlaw.txt`, `// elide-unchecked: ...`).
# check.sh parses these out of the .typ; they are not court text, so they must not reach
# the sentence splitter. Scoped to the `elide-` namespace on purpose: a bare `//` can
# appear inside quoted text (a URL in a citation), and stripping those would silently drop
# real court text — the exact failure this gate exists to catch.
ELIDE_DIRECTIVE_LINE = re.compile(r"^[ \t]*//[ \t]*elide-.*$", re.MULTILINE)


def strip_typ_markup(body: str, skip_editorial: bool = False) -> str:
    if skip_editorial:
        body = drop_editorial_blocks(body)
    body = ELIDE_DIRECTIVE_LINE.sub("", body)
    # Drop the editors' note wholesale — it is ours, not the court's.
    m = EDITORS_NOTE.search(body)
    if m:
        open_at = body.index("[", m.start())
        end = match_bracket(body, open_at, "[", "]")
        body = body[: m.start()] + " \n\n " + body[end:]
    # Centred separators such as #align(center)[\* \* \*] are ours too.
    body = re.sub(r"#align\(center\)\s*\[[^\]]*\]", "\n\n", body)
    # Typst headings, page/space directives, escapes.
    body = re.sub(r"^\s*=+\s.*$", "\n\n", body, flags=re.MULTILINE)
    body = re.sub(r"#(pagebreak|v|h)\([^)]*\)", "\n\n", body)
    body = re.sub(r"\\u\{([0-9a-fA-F]+)\}", lambda m: chr(int(m.group(1), 16)), body)
    body = body.replace("\\$", "$").replace("\\@", "@").replace("\\#", "#")
    body = re.sub(r"\\\s*$", " ", body, flags=re.MULTILINE)
    # `~` is Typst markup for U+00A0, exactly as `---` is an em dash and `_x_` is italics:
    # the reader sees a space, so the checker must compare a space. This is not a loosening —
    # it strips no neighbouring character and matches no wildcard. (norm() also folds `~`
    # and a literal U+00A0 into a space on BOTH sides, which is where the source-side
    # guarantee lives; this rule makes the reader-visible space explicit at the markup layer,
    # so a MISS diagnostic prints the sentence as it is set rather than with a raw tilde.)
    body = body.replace("~", " ")
    body = re.sub(r"#emph\s*\[", "[", body)
    body = re.sub(r"#[a-zA-Z.]+(?:\([^)]*\))?", " ", body)
    body = body.replace("_", "").replace("*", "")
    return body


# ---------------------------------------------------------------- normalising


def norm(s: str) -> str:
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    for d in "\u2014\u2013\u2212":
        s = s.replace(d, "-")
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


# ------------------------------------------------------------ sentence split

ABBREV = {
    "inc", "co", "corp", "ltd", "llc", "llp", "no", "nos", "v", "vs", "cf",
    "supp", "f", "d", "cir", "ct", "ass'n", "mut", "prod", "univ", "dep't",
    "id", "dr", "mr", "ms", "mrs", "st", "jr", "sr", "app", "rev", "ed",
    "eds", "at", "pp", "p", "sec", "e.g", "i.e", "etc", "u.s", "s.e.c",
    "fed", "reg", "stat", "amend", "art", "para", "n", "ch",
}


def sentences(segment: str) -> list[str]:
    """Split a contiguous segment into sentences, tolerating legal abbreviations."""
    parts = re.split(r"(?<=[.!?][\"'\u201d\u2019)])\s+|(?<=[.!?])\s+", segment)
    out: list[str] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if out:
            tail = re.sub(r"[^A-Za-z.'\u2019]", "", out[-1].split()[-1]).rstrip(".")
            if tail.lower() in ABBREV or (len(tail) == 1 and tail.isalpha()):
                out[-1] = out[-1] + " " + part
                continue
        out.append(part)
    return out


def segments(prose: str) -> list[str]:
    """Contiguity-preserving chunks: elisions and blank lines break contiguity."""
    chunks = ELISION.split(prose)
    out = []
    for c in chunks:
        out.extend(re.split(r"\n\s*\n", c))
    return [c for c in out if c.strip()]


BRACKETED = re.compile(r"\[[^\[\]]*\]")

# A bracketed span is either a CASE CHANGE (`[T]he` — keep the content, drop only the
# brackets) or an editorial INSERTION (`[, for example,]` — drop both), and one sentence
# routinely carries both. Try each span's two readings independently.
MAX_BRACKET_SPANS = 8


def bracket_variants(sent: str) -> tuple[list[str], bool]:
    """Normalised candidates for a sentence; second value is True if the cap applied."""
    spans = list(BRACKETED.finditer(sent))
    if not spans:
        n = norm(sent)
        return ([n] if n else []), False
    if len(spans) > MAX_BRACKET_SPANS:
        fallback = [
            norm(sent),
            norm(BRACKETED.sub(" ", sent)),
            norm(BRACKETED.sub(lambda m: m.group(0)[1:-1], sent)),
        ]
        return [c for c in dict.fromkeys(fallback) if c], True
    out: list[str] = []
    seen: set[str] = set()
    # Per span: drop the content, keep it welded ("[T]he" -> "The"), or leave it as-is
    # (a bracket the SOURCE also carries, "embod[y]", normalises the same on both sides).
    for choice in product("dka", repeat=len(spans)):
        pieces: list[str] = []
        at = 0
        for how, m in zip(choice, spans):
            inner = m.group(0)[1:-1]
            pieces.append(sent[at : m.start()])
            pieces.append(" " if how == "d" else inner if how == "k" else f" {inner} ")
            at = m.end()
        pieces.append(sent[at:])
        cand = norm("".join(pieces))
        if cand and cand not in seen:
            seen.add(cand)
            out.append(cand)
    return out, False


# ------------------------------------------------- gapped (footnote-block) match

MAX_GAP_WORDS = 220
MIN_HALF_WORDS = 4


class Haystack:
    """Normalised source, searchable as a word sequence."""

    def __init__(self, text: str):
        self.text = text
        self.words = text.split()
        self.index: dict[str, list[int]] = {}
        for i, w in enumerate(self.words):
            self.index.setdefault(w, []).append(i)

    def __contains__(self, needle: str) -> bool:
        return needle in self.text

    def find_seq(self, words: list[str], start: int = 0) -> int:
        """First index >= start where `words` occurs contiguously, else -1."""
        if not words:
            return -1
        for i in self.index.get(words[0], ()):
            if i < start:
                continue
            if self.words[i : i + len(words)] == words:
                return i
        return -1

    def match_with_gap(self, sent_norm: str) -> tuple[int, int] | None:
        """Match as two contiguous runs separated by ONE bounded source gap.

        Returns (gap_start, gap_end) word indices into the source, or None.
        A footnote block printed at the foot of the page lands physically between
        the two halves of the sentence it annotates; nothing else is tolerated.
        """
        w = sent_norm.split()
        if len(w) < 2 * MIN_HALF_WORDS:
            return None
        for k in range(len(w) - MIN_HALF_WORDS, MIN_HALF_WORDS - 1, -1):
            i1 = self.find_seq(w[:k])
            if i1 < 0:
                continue
            end1 = i1 + k
            i2 = self.find_seq(w[k:], end1)
            if i2 >= 0 and 0 < i2 - end1 <= MAX_GAP_WORDS:
                return (end1, i2)
        return None


# ------------------------------------------- sentence integrity across elisions

ELIDE_TOKEN = "\x00ELIDE\x00"
MIN_FRAGMENT = 25


def elided_sentences(prose: str) -> list[str]:
    """Sentences with their elision marks preserved as ELIDE_TOKEN."""
    marked = ELISION.sub(ELIDE_TOKEN, prose)
    out = []
    for chunk in re.split(r"\n\s*\n", marked):
        if chunk.strip():
            out.extend(sentences(chunk))
    return out


def locate(fragment: str, hay: "Haystack") -> int:
    """Char offset of a fragment in the source, -1 if absent."""
    n = norm(fragment)
    if n:
        at = hay.text.find(n)
        if at >= 0:
            return at
    d = norm(BRACKETED.sub(" ", fragment))
    return hay.text.find(d) if d else -1


def check_integrity(title: str, prose: str, hay: "Haystack",
                    advisories: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Each side of an INTERNAL elision must be real source text, in order.

    Two half-sentences stitched from unrelated parts of the opinion are the
    signature this catches: they read as one sentence but sit out of order, or
    overlap, in the source.
    """
    fails: list[tuple[str, str]] = []
    for sent in elided_sentences(prose):
        s = sent.strip()
        if ELIDE_TOKEN not in s:
            continue
        if s.count(ELIDE_TOKEN) == 1 and (s.startswith(ELIDE_TOKEN)
                                          or s.endswith(ELIDE_TOKEN)):
            continue
        frags = [f.strip() for f in s.split(ELIDE_TOKEN)]
        shown = s.replace(ELIDE_TOKEN, " [. . .] ")
        last_end = -1
        for frag in frags:
            if len(frag) < MIN_FRAGMENT:
                continue
            at = locate(frag, hay)
            if at < 0:
                fails.append((title, shown + f"   <-- fragment not in source: {frag!r}"))
                break
            if at < last_end:
                fails.append((title, shown +
                              "   <-- fragments out of order or overlapping in the "
                              "source (stitching signature)"))
                break
            last_end = at + len(norm(frag))
        for before, after in pairwise(frags):
            if not before or not after:
                continue
            if before.rstrip().endswith((".", "!", "?", '"', "”", "'", "’")):
                continue
            first = after.split()[0] if after.split() else ""
            if first[:1].islower():
                advisories.append((title, shown))
                break
    return fails


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("typ", type=Path)
    ap.add_argument("source", type=Path)
    ap.add_argument("--caption", help="verify only the reading whose caption matches")
    ap.add_argument("--min-len", type=int, default=60)
    ap.add_argument("--skip-editorial", action="store_true",
                    help="exclude editors'-note prose inside #text(10pt)[...] blocks")
    args = ap.parse_args()

    for p in (args.typ, args.source):
        if not p.is_file():
            print(f"FAIL setup: {p} does not exist")
            return 1

    source_text, provenance = load_source(args.source)
    haystack = Haystack(norm(strip_furniture(source_text)))
    src = args.typ.read_text(encoding="utf-8")

    found = readings(src)
    if not found:
        print("FAIL parse: no reading caption blocks found in the .typ")
        return 1
    if args.caption:
        want = norm(args.caption)
        found = [r for r in found if want in norm(r[0]) or norm(r[0]) in want]
        if not found:
            print(f"FAIL setup: no caption matching {args.caption!r}")
            return 1
    elif len(found) > 1:
        print(
            f"FAIL setup: the .typ has {len(found)} readings; pass --caption to "
            "choose one. Captions found:"
        )
        for t, _ in found:
            print(f"  {t}")
        return 1

    checked = 0
    empty_readings: list[str] = []
    misses: list[tuple[str, str]] = []
    gapped: list[tuple[str, str, str]] = []
    integrity_fails: list[tuple[str, str]] = []
    advisories: list[tuple[str, str]] = []
    capped_sents: list[tuple[str, str]] = []
    for title, body in found:
        before = checked
        prose = strip_typ_markup(body, skip_editorial=args.skip_editorial)
        for seg in segments(prose):
            for sent in sentences(seg):
                if len(sent) < args.min_len:
                    continue
                checked += 1
                n = norm(sent)
                cands, capped = bracket_variants(sent)
                if capped:
                    capped_sents.append((title, sent))
                if any(c in haystack for c in cands):
                    continue
                debracketed = norm(BRACKETED.sub(" ", sent))
                unbracketed = norm(BRACKETED.sub(lambda m: m.group(0)[1:-1], sent))
                gap = None
                for cand in (n, debracketed, unbracketed):
                    if cand:
                        gap = haystack.match_with_gap(cand)
                        if gap:
                            break
                if gap:
                    a, _ = gap
                    gapped.append((title, sent,
                                   " ".join(haystack.words[a : a + 12])))
                    continue
                misses.append((title, sent))
        if checked == before:
            empty_readings.append(title)
        integrity_fails.extend(check_integrity(title, prose, haystack, advisories))

    for title, sent in misses:
        print(f"MISS in {title[:60]!r}:")
        print(f"  typ: {sent.strip()}")
        # Longest matching prefix, to point at where the divergence starts.
        words = norm(sent).split()
        lo, hi = 0, len(words)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if " ".join(words[:mid]) in haystack:
                lo = mid
            else:
                hi = mid - 1
        if lo:
            print(f"  matched source through: ...{' '.join(words[max(0, lo - 12):lo])}")
            print(f"  diverges at: {' '.join(words[lo:lo + 12])}")
        else:
            print("  no prefix of this sentence appears in the source")
        print()

    # Zero sentences checked is not a pass: the reading was selected for verification and
    # nothing was verified, which is exactly what this gate exists to forbid.
    for title in empty_readings:
        print(f"FAIL nothing checked in {title[:60]!r}:")
        print(f"  no sentence of >= {args.min_len} characters was extracted from this "
              "reading, so no quotation was verified")
        print()

    for title, sent in integrity_fails:
        print(f"FAIL sentence integrity in {title[:60]!r}:")
        print(f"  {sent}")
        print()

    if gapped:
        print("matched across a source gap (likely a footnote block) — verify:")
        for title, sent, gap_head in gapped:
            print(f"  in {title[:60]!r}: {sent.strip()}")
            print(f"    source gap begins: {gap_head} ...")
        print()

    if advisories:
        print("ADVISORY - check these read as sentences:")
        for title, sent in advisories:
            print(f"  in {title[:60]!r}: {sent.strip()}")
        print()

    ok = not misses and not integrity_fails and not empty_readings

    # Say what the source could and could not carry, on every run. `norm()` folds `_` away
    # on both sides, so emphasis never affects the verbatim verdict either way — which is
    # exactly why it has to be REPORTED: a silent pass over a formatting-free source reads
    # identical to a pass over one that carried the court's typography.
    if provenance == "docx":
        print(f"SOURCE {args.source.name}: .docx projected in memory by the westlaw "
              "extractor; italic runs preserved as Typst emphasis (`_..._`)")
    else:
        print(f"SOURCE {args.source.name}: plain text — ITALICS NOT CHECKED. A .txt carries "
              "no formatting layer (the CourtListener/RECAP fallback route has none to "
              "begin with), so whether this excerpt's emphasis matches the court's is "
              "verified by nothing here. Pass the .westlaw.docx where one exists.")

    print(f"{checked} sentences checked, {len(misses)} not found"
          + (f", {len(integrity_fails)} failed sentence integrity"
             if integrity_fails else "")
          + (f", {len(empty_readings)} reading(s) checked nothing"
             if empty_readings else ""))
    if ok and provenance == "docx":
        print(
            "NOTE: a match proves fidelity to the publisher-keyed export, which for a "
            "Westlaw source is fidelity to the reporter text."
        )
    elif ok:
        print(
            "NOTE: a match proves fidelity to the .txt, not to the reporter. "
            "Eyeball retained passages against the .pdf for OCR damage."
        )
    if capped_sents:
        print(f"NOTE: {len(capped_sents)} sentence(s) carry more than "
              f"{MAX_BRACKET_SPANS} bracketed spans; only the whole-keep and whole-drop "
              "readings were tried for those:")
        for title, sent in capped_sents:
            print(f"  in {title[:60]!r}: {sent.strip()[:100]}")
        print()
    print(
        "NOTE: a bracketed [ ] span is tried both ways — dropped (an editorial "
        "insertion) and kept without its brackets (a case change, `[T]he`); a sentence "
        "matching under either reading is counted as found."
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
