#!/usr/bin/env python3
"""Verify every retained quotation in an addendum against the retrieved source text.

Usage: check-quotes.py <addendum.typ> <source.docx|source.txt> [--caption "TITLE"]
                       [--min-len 60]
       check-quotes.py --leg <addendum.typ> <docs dir> <declared file>   (check.sh's quotes leg)
       check-quotes.py --project-dir P [--plan X] [--files F ...]        (the constraint contract:
                       the quotes leg over each .typ handed in; see quotes_leg below)

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
import os
import re
import subprocess
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


# ------------------------------------------------------------ the addendum's quotes leg
# check.sh's quotes leg (`--leg`) and the constraint contract both run what follows: the caption
# list DERIVED from the .typ with check-addendum.py's own parser, so a reading added to the
# addendum is checked without anyone being told it exists, one source resolved per reading, and
# this script's verbatim check once per reading.


def noncourt(plan: str) -> list[tuple[str, str]]:
    """(caption, why) for each '## Non-court readings' bullet of a plan. Declaring a reading
    non-court text is the INSTRUCTOR's call, so it lives in the plan, keyed by caption."""
    m = re.search(r"^##+\s*Non\-court\ readings\s*$(.*?)(?=^##\s|\Z)", plan, re.I | re.M | re.S)
    out = []
    for raw in (m.group(1) if m else "").splitlines():
        b = re.match(r"\s*[-*]\s+(.+)", raw)
        if not b:
            continue
        item = b.group(1).strip()
        parts = re.split(r"\s+[—–]\s+|\s+--\s+", item, maxsplit=1)
        cap = parts[0].strip().strip("*_`")
        why = (parts[1].strip() if len(parts) > 1 else "") or "declared non-court text in the plan"
        if cap:
            out.append((cap, why))
    return out


def _addendum_parser():
    spec = importlib.util.spec_from_file_location("check_addendum", Path(__file__).resolve().parent / "check-addendum.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def resolve(typ: Path, docs_dir: Path, plan_declared: list[tuple[str, str]]) -> list[str]:
    """One `caption \x1f source \x1f status \x1f mode \x1f shared-with` row per reading, then the
    `!SHARED`, `!BULLETNONE` and `!BULLETMANY` rows."""
    mod = _addendum_parser()
    src = typ.read_text(encoding="utf-8")
    captions = mod.parse_captions(src)

    # Offsets let a declaration attach to the caption block that follows it.
    cap_offsets = [m.end() for m in mod.CAPTION_RE.finditer(src)]
    declared: dict[int, tuple[str, str]] = {}
    for m in re.finditer(r"//\s*elide-(source|unchecked):\s*([^\n]*)", src):
        kind, value = m.group(1), m.group(2).strip()
        for i, off in enumerate(cap_offsets):
            if off > m.start():
                declared[i] = (kind, value)
                break

    # Readings the PLAN declares non-court text. The match must be DEFINITE: a bullet matches a
    # caption only when its token sequence IS the caption's or appears in it as a full contiguous
    # run. A raw substring test would let a short bullet ('blog') switch the verbatim check off
    # every caption it happened to occur inside — and that check is the first Iron Law, so a loose
    # match hands the instructor's authority to whoever writes a vague bullet.
    def toklist(s: str) -> list[str]:
        return [w for w in re.split(r"[^a-z0-9]+", s.lower()) if w]

    def run_matches(needle: list[str], hay: list[str]) -> bool:
        if not needle or len(needle) > len(hay):
            return False
        return any(hay[i : i + len(needle)] == needle for i in range(len(hay) - len(needle) + 1))

    plan_unchecked: list[tuple[str, list[str], str]] = []  # (raw bullet, tokens, why)
    for cap, why in plan_declared:
        if toklist(cap):
            plan_unchecked.append((cap.strip(), toklist(cap), why))

    # A bullet naming no reading is a typo, and a bullet naming several does not say WHICH reading
    # is not court text. Both are failures: silently ignoring either is how a reading the
    # instructor meant to exempt gets checked, or a reading he never named stops being.
    cap_tokens = [toklist(c) for c in captions]
    bullet_hits: list[tuple[str, list[int]]] = [
        (raw, [i for i, ct in enumerate(cap_tokens) if run_matches(bt, ct)])
        for raw, bt, _ in plan_unchecked
    ]
    bad_bullets = {i for i, (_, hits) in enumerate(bullet_hits) if len(hits) != 1}

    def plan_exempt(idx: int) -> str | None:
        for b, (_, hits) in enumerate(bullet_hits):
            if b not in bad_bullets and hits == [idx]:
                return plan_unchecked[b][2]
        return None

    # Tokens that name no party and so cannot discriminate between two sources.
    STOP = {
        "sec", "securities", "exchange", "commission", "opinion", "order", "court",
        "united", "states", "district", "circuit", "appeals", "supp", "f2d", "f3d",
        "cir", "and", "the", "inc", "corp", "corporation", "llc", "ltd",
    }

    def toks(s: str) -> set[str]:
        return {w for w in re.split(r"[^a-z0-9]+", s.lower()) if w}

    def file_tokens(stem: str) -> set[str]:
        return {w for w in toks(stem) if w.isalpha() and len(w) >= 4 and w not in STOP}

    # The .docx is the source of record; a .txt is still resolvable, which is what keeps an
    # addendum whose plan names one working unchanged. When a stem carries BOTH — every pair
    # retrieved before the docx became canonical does — the .docx wins, and offering both to
    # the scorer would instead make every such caption AMBIGUOUS and fail a run that passed.
    candidates: dict[str, Path] = {}
    if docs_dir.is_dir():
        for suffix in (".txt", ".docx"):  # .docx second, so it overwrites
            for p in sorted(docs_dir.glob(f"*{suffix}")):
                candidates[p.stem] = p
    sources = []
    for _stem, p in sorted(candidates.items()):
        ft = file_tokens(p.stem)
        if ft:
            sources.append((p, ft))

    rows = []  # (caption, path, status, mode)
    for i, cap in enumerate(captions):
        if i in declared and declared[i][0] == "unchecked":
            # Self-exemption: the .typ is written by the same agent as the excerpt, so honouring
            # this marker would let fabricated text switch the verbatim check off itself.
            rows.append((cap, "", f"SELFEXEMPT:{declared[i][1] or 'not court text'}", "typ-marker"))
            continue
        why = plan_exempt(i)
        if why is not None:
            rows.append((cap, "", f"UNCHECKED:{why}", "plan"))
            continue
        if i in declared:
            kind, value = declared[i]
            cand = docs_dir / value
            # A declaration naming the retired `.txt` twin resolves to the `.docx` it was
            # derived from. The declaration still names a file that must exist, so it cannot
            # fabricate a pass; what it must not do is fail an addendum whose only defect is
            # that it was written before the docx became the sole stored source.
            if not cand.is_file() and cand.suffix.lower() == ".txt":
                sibling = cand.with_suffix(".docx")
                if sibling.is_file():
                    cand = sibling
            if cand.is_file():
                rows.append((cap, str(cand), "OK", "declared"))
            else:
                rows.append((cap, "", f"DECLARED-MISSING:{value}", "declared"))
            continue
        ct = toks(cap)
        scored = []
        for p, ft in sources:
            hit = len(ft & ct)
            if hit:
                scored.append((hit / len(ft), hit, p))
        scored.sort(key=lambda r: (-r[0], -r[1], str(r[2])))
        if not scored:
            rows.append((cap, "", "NOSOURCE", "derived"))
        elif len(scored) > 1 and (scored[0][0], scored[0][1]) == (scored[1][0], scored[1][1]):
            rows.append((cap, "", f"AMBIGUOUS:{scored[0][2].name},{scored[1][2].name}", "derived"))
        else:
            rows.append((cap, str(scored[0][2]), "OK", "derived"))

    # A source answering for two readings means at least one is verified against text that is
    # not its own. That is reported as its own failure — but the quote check still RUNS for
    # both, because replacing a computed result with an unrun status is a vacuous pass.
    by_path: dict[str, list[int]] = {}
    for i, (_, path, status, _) in enumerate(rows):
        if status == "OK":
            by_path.setdefault(path, []).append(i)
    shared = {p: idxs for p, idxs in by_path.items() if len(idxs) > 1}

    out = []
    for cap, path, status, mode in rows:
        dup = ""
        if status == "OK" and path in shared:
            dup = ",".join(str(j + 1) for j in shared[path])
        out.append("\x1f".join((cap.replace("\x1f", " "), path, status, mode, dup)))

    for p, idxs in sorted(shared.items()):
        caps = " | ".join(rows[j][0][:60] for j in idxs)
        out.append("\x1f".join(("!SHARED", Path(p).name, ",".join(str(j + 1) for j in idxs), caps)))

    for b in sorted(bad_bullets):
        raw, hits = bullet_hits[b][0], bullet_hits[b][1]
        if not hits:
            out.append("\x1f".join(("!BULLETNONE", raw.replace("\x1f", " "), "", "")))
        else:
            caps = " | ".join(rows[j][0][:60] for j in hits)
            out.append("\x1f".join(("!BULLETMANY", raw.replace("\x1f", " "),
                                    ",".join(str(j + 1) for j in hits), caps)))
    return out


def gap_block(text: str) -> list[str]:
    """The gap-match block this script prints on SUCCESS as well as failure: a sentence matched
    across a source gap may have been fused across dropped holding rather than across a footnote
    block, and only a human can tell, so the leg surfaces it on a PASS too."""
    out, show = [], False
    for ln in text.split("\n"):
        if ln.startswith("matched across a source gap"):
            show = True
        if show and not ln.strip():
            break
        if show:
            out.append(ln)
    return out


def quotes_leg(typ: Path, docs_dir: Path, plan_declared: list[tuple[str, str]]) -> tuple[int, list[str], list[str]]:
    """(exit, the leg's lines ending in its `LEG quotes:` verdict, each failure's line)."""
    lines: list[str] = []
    fails: list[str] = []

    def fail(*msg: str) -> None:
        fails.append(msg[0].strip())
        lines.extend(msg)

    n_readings = n_verified = n_unchecked = n_lossy = 0
    try:
        resolved = resolve(typ, docs_dir, plan_declared)
    except Exception:  # noqa: BLE001 - the leg reports what stopped it; an unrun leg is a FAIL
        import traceback
        fail(f"could not derive the caption list from {typ.name}:", *traceback.format_exc().rstrip().split("\n"))
    else:
        all_lines = [ln for ln in resolved if ln]
        rows = [ln for ln in all_lines if not ln.startswith("!")]
        shared_lines = [ln for ln in all_lines if ln.startswith("!")]
        n_readings = len(rows)
        if n_readings == 0:
            fail(f"no reading caption blocks found in {typ.name}; there is nothing to verify")
        for idx, row in enumerate(rows, 1):
            caption, src, status, mode, dup = (row.split("\x1f") + [""] * 5)[:5]
            label = f'reading {idx}/{n_readings} "{caption[:60]}"'
            if status.startswith("UNCHECKED:"):
                n_unchecked += 1
                lines.append(f"  {label}: DECLARED-UNCHECKED [{mode}] — {status[len('UNCHECKED:'):]}")
                continue
            if status.startswith("SELFEXEMPT:"):
                fail(f"  {label}: FAIL [{mode}] — SELF-EXEMPTING '// elide-unchecked:' marker in the .typ.",
                     "    Declaring a reading non-court text is the instructor's call and belongs in the",
                     "    plan's '## Non-court readings' section, not in the file the excerpt is written into.")
                continue
            if status != "OK":
                fail(f"  {label}: FAIL [{mode}] — no source resolved in {docs_dir} ({status})")
                continue
            # --skip-editorial: an editors' note is authored commentary, never a quotation, so
            # grading it against the reporter reports the editor's own prose as missing court text.
            r = subprocess.run([sys.executable, __file__, str(typ), src, "--caption", caption, "--skip-editorial"],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
            q_out = r.stdout.rstrip("\n")
            if r.returncode == 0:
                n_verified += 1
                lines.append(f"  {label}: PASS [{mode}] — verbatim against {Path(src).name}")
                # A PASS otherwise prints only the gap block, which would swallow the one line
                # saying the source had no typography to check against. Loud, named, and not a
                # failure — the CourtListener/RECAP fallback route yields a court PDF with no
                # formatting layer at all, and that route is not going away.
                if not src.endswith(".docx"):
                    n_lossy += 1
                    lines += [f"    ITALICS NOT CHECKED — {Path(src).name} is plain text and carries no",
                              "    formatting layer, so whether this excerpt's emphasis matches the court's",
                              "    is verified by nothing. Pass the .westlaw.docx where one exists; on the",
                              "    CourtListener/RECAP fallback route no source can carry it."]
                lines += [f"    {ln}" for ln in gap_block(q_out)]
            else:
                fail(f"  {label}: FAIL [{mode}] — against {Path(src).name}", *[f"    {ln}" for ln in q_out.split("\n")])
            if dup:
                lines.append(f"    (source shared with reading(s) {dup})")
        for line in shared_lines:
            kind, a, idxs, caps = (line.split("\x1f") + [""] * 4)[:4]
            if kind == "!SHARED":
                fail(f"  AMBIGUOUS MAPPING: readings {idxs} all resolve to {a} — {caps}")
            elif kind == "!BULLETNONE":
                fail(f'  PLAN BULLET MATCHES NO READING: "{a}"',
                     "    A '## Non-court readings' bullet must name a caption exactly, or as a full",
                     "    contiguous run of its words. This one names nothing in the addendum.")
            elif kind == "!BULLETMANY":
                fail(f'  PLAN BULLET IS AMBIGUOUS: "{a}" matches readings {idxs} — {caps}',
                     "    Say which reading is not court text; a bullet this general would switch the",
                     "    verbatim check off every one of them.")
    # An addendum whose every reading carries the unchecked marker verifies nothing, and a leg
    # that verified nothing has no verdict to report. Zero verified is a FAIL.
    if not fails and n_verified == 0:
        fail(f"  NOTHING VERIFIED: 0 of {n_readings} reading(s) were checked against a source ({n_unchecked} declared unchecked)")
    if not fails:
        lossy = f"; ITALICS NOT CHECKED on {n_lossy} reading(s) with a plain-text source" if n_lossy else ""
        lines.append(f"LEG quotes: PASS — {n_verified} of {n_readings} reading(s) verified verbatim, "
                     f"{n_unchecked} declared unchecked{lossy}")
    else:
        lines.append(f"LEG quotes: FAIL — at least one of {n_readings} reading(s) is not verified")
    return (1 if fails else 0), lines, fails


def leg_main(argv: list[str]) -> int:
    """check.sh's quotes leg: `--leg <addendum.typ> <docs dir> <declared file>`, the declared file
    holding the plan's `caption \x1f why` non-court lines (empty with no plan)."""
    typ, docs_dir, declared_file = Path(argv[0]), Path(argv[1]), Path(argv[2])
    plan_declared = []
    if declared_file.is_file():
        for line in declared_file.read_text(encoding="utf-8").splitlines():
            if "\x1f" in line:
                cap, why = line.split("\x1f", 1)
                plan_declared.append((cap, why))
    rc, lines, _ = quotes_leg(typ, docs_dir, plan_declared)
    print("\n".join(lines))
    return rc


def judge(typ: Path, ctx: dict) -> tuple[int, list[str], str]:
    """The constraint contract over one addendum: the quotes leg, against the docs/ directory
    check.sh resolves by default -- beside the .typ in a self-contained fixture, beside addenda/
    in the course repo -- or, where neither exists, the directory of the sources handed in (how
    check.sh's --docs reaches it), and the plan's non-court readings."""
    docs_dir = typ.parent / "docs" if (typ.parent / "docs").is_dir() else typ.parent.parent / "docs"
    handed = [str(p.parent) for p in ctx["given"] if p.suffix.lower() in (".docx", ".txt")]
    if not docs_dir.is_dir() and handed:
        docs_dir = Path(os.path.commonpath(handed))
    plan_declared = []
    if ctx["plan"]:
        try:
            plan_declared = noncourt(Path(ctx["plan"]).read_text(encoding="utf-8"))
        except OSError as e:
            return 2, [], f"could not read the plan {ctx['plan']}: {e}"
    rc, lines, fails = quotes_leg(typ, docs_dir, plan_declared)
    if rc == 0:
        ctx.setdefault("notes", []).append(f"{typ.name}: " + lines[-1].removeprefix("LEG quotes: PASS — "))
    return rc, [f"{typ}:1: {f}" for f in fails], "\n".join(lines)


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
    if sys.argv[1:2] == ["--leg"]:
        sys.exit(leg_main(sys.argv[2:]))
    from _elide_contract import run, wanted
    if wanted():
        sys.exit(run("check-quotes", lambda p: p.suffix == ".typ", judge, "addendum(s)", ".typ addendum"))
    sys.exit(main())
