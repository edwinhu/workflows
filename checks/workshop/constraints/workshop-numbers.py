#!/usr/bin/env -S uv run --with pypdf python3
"""FID's numeric half, computed: every number a deck states must occur in the paper or the Source Inventory.

A number on a slide that appears nowhere in the source paper or in a `## Source Inventory` Source cell is
fabricated or transposed (0.37 for 0.73). Whether the claim beside a number is what the paper says stays
the workshop-reviewer lens's judgement (workshop-checks.md, FID); that the number exists at all is decided here.

CONTRACT (checks/ds/constraints/_contract.py, run by bin/workflow-check -- membership is this directory)
    workshop-numbers.py --project-dir P --plan X [--files ...]
    stdout line 1: `workshop-numbers: N number(s) examined` (`0 ... nothing in scope (no --plan given)` with no plan)
    then `path:line: workshop-numbers <token> ...` per unmatched token. Exit 0 pass, 1 findings,
    2 could not check: unreadable plan, unparseable `## Outputs and Verification`, `## Source Paper` or
    `## Source Inventory`, a declared deck, notes or paper that is missing or unreadable, or no way to read a PDF paper.
    A plan reader: --files decides nothing; the deck and notes are the plan's declared artifacts.

WHAT COUNTS (a "number" is examined only when it is unambiguously a quantity)
    a decimal (0.37, .5), an integer of two or more digits (45, 1994, 1,234), any percentage (5%, 12.0%),
    any amount led by a $ € £ symbol ($5). A bare one-digit integer is prose
    ("three", "2 groups", "Table 3"), so it is not examined; a spelled-out number ("four points") is the lens's.
    Read from the deck's MARKUP-STRIPPED text: `//` and `/* */` comments, `\\u{...}` escapes, `#set/#show/#let/#import` statements and `#{...}` blocks, and
    every `#call(...)` argument list are dropped, keeping only the `[content]` blocks inside them -- so
    `#image(width: 80%)`, `#inv("R1")` and `#slide(...)` layout carry no numbers, while `#table(..., [0.37])` does.
    Identifier-like digits (R1, F10, COVID-19, H2O, x2) are not quantities.

NORMALISATION (both sides): thousands commas out, $ € £ and % out, trailing decimal zeros out (12.0% = 12,
1,234 = 1234, 0.50 = 0.5), a bare ".37" is "0.37". The comparison is the number's value as written, so
"12%" matches a paper's "12 percent" and "12", but not "0.12" or "1.2 million" for "1,200,000": a re-expressed
number is declared in a Source Inventory cell (which is searched) or flagged for the author -- never guessed.
A year-range tail ("2019-20", "2019–20") is checked as the full year 2020.

EXEMPT (documented, deliberately small)
    1. Slide, page and section references: a number right after slide(s), page(s), p., pp., §, section(s),
       part, step, appendix, footnote, fn, note(s), lecture, week. Typst prints slide
       numbers itself; the deck text only names them when speaking ("back to slide 12").
    2. Section numbers: a leading label on a heading line (`== 2. Data`, `=== 3.1 Identification`) and a
       numbered-list marker (`1. `, `12) `) at the start of a line.
    3. Dates in the title block -- every line before the first `==` heading (the title page; in notes, the
       `= Speaker notes` preamble): a 19xx/20xx year, an ISO date, a day beside a month name. After the first
       section divider a year is data and is examined like any number.
    Nothing else is exempt. A number the paper lacks that is legitimately the author's own (a sample the
    speaker computed) is put in a Source Inventory Source cell, where the plan states where it came from.

PAPER TEXT: `.pdf` through pypdf (or pdftotext when pypdf is not importable); any other extension is read as text.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import shutil
import subprocess
import sys
from pathlib import Path

NAME = "workshop-numbers"
HERE = Path(__file__).resolve().parent


class CouldNot(Exception):
    """An input is missing or unreadable: exit 2, never a clean line."""


def _deck_module():
    """workshop-deck.py owns the plan grammar and the comment stripper; reading them beats a second copy."""
    spec = importlib.util.spec_from_file_location("workshop_deck_grammar", HERE / "workshop-deck.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---- number grammar -------------------------------------------------------------------------------

CURRENCY = "$€£"
# A number token: optional currency, then 1,234 / 1234 / 12.5 / .5, optional percent. Not glued to a letter,
# digit, `_` or `.` on the left, nor `letter-` (COVID-19), and not followed by another digit or `.digit`.
NUM_RE = re.compile(
    r"(?<![A-Za-z_\d.,])(?<![A-Za-z]-)"
    r"(?P<cur>[$€£]\s?)?"
    r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)"
    r"(?P<pct>\s?%)?"
    r"(?![\d]|[A-Za-z]\d|\.\d)"
)
REF_BEFORE_RE = re.compile(
    r"(?:\b(?:slides?|pages?|pp?\.|sections?|parts?|steps?|appendix|footnotes?|fn|notes?|lectures?|weeks?)|§+)\s*$",
    re.IGNORECASE,
)
MONTH = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?"
DATE_RES = [
    re.compile(r"\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b"),
    re.compile(rf"\b{MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+(?:19|20)\d{{2}})?\b", re.IGNORECASE),
    re.compile(rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+{MONTH}(?:,?\s+(?:19|20)\d{{2}})?\b", re.IGNORECASE),
    re.compile(rf"\b{MONTH}\s+(?:19|20)\d{{2}}\b", re.IGNORECASE),
    re.compile(r"\b(?:19|20)\d{2}\b"),
]
HEADING_LABEL_RE = re.compile(r"^([ \t]*=+[ \t]+)(\d+(?:\.\d+)*\.?)(?=[ \t])")
LIST_MARKER_RE = re.compile(r"^([ \t]*)\d+[.)](?=[ \t])")
CODE_START_RE = re.compile(r"^[ \t]*#(?:set|show|let|import|include)\b|#\{", re.MULTILINE)
ESCAPE_RE = re.compile(r"\\u\{[0-9A-Fa-f]+\}")


def canon(num: str) -> str:
    """The value as written: commas out, trailing decimal zeros out, a bare `.37` as `0.37`."""
    s = num.replace(",", "")
    if s.startswith("."):
        s = "0" + s
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def paper_numbers(text: str) -> set[str]:
    """Every numeric value in the paper or inventory text, any length: a slide's `45` may be the paper's `45`."""
    found = {canon(m.group("num")) for m in NUM_RE.finditer(text)}
    # A re-spaced table cell or a hyphen-compound ("N=1,234") is still a value; sweep the glued forms too.
    found |= {canon(m.group(0)) for m in re.finditer(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+", text)}
    found |= {m.group(1)[:2] + m.group(2) for m in re.finditer(r"(\d{4})[-–—](\d{2})(?!\d)", text)}
    return found


# ---- typst markup ---------------------------------------------------------------------------------

def _blank(s: str) -> str:
    return re.sub(r"[^\n]", " ", s)


def _call_end(s: str, i: int) -> int:
    """Index after the `)` closing the `(` at s[i], respecting strings, brackets and nesting; -1 if unbalanced."""
    depth, j, n = 0, i, len(s)
    while j < n:
        c = s[j]
        if c == '"':
            j += 1
            while j < n and s[j] != '"':
                j += 2 if s[j] == "\\" else 1
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return -1


def _content_blocks(args: str) -> list[tuple[int, int]]:
    """Spans (start, end) of the top-level `[...]` content blocks inside a call's argument text."""
    out, depth, j, n, start = [], 0, 0, len(args), -1
    while j < n:
        c = args[j]
        if c == '"' and depth == 0:
            j += 1
            while j < n and args[j] != '"':
                j += 2 if args[j] == "\\" else 1
        elif c == "[":
            if depth == 0:
                start = j
            depth += 1
        elif c == "]" and depth:
            depth -= 1
            if depth == 0:
                out.append((start, j + 1))
        j += 1
    return out


def strip_calls(s: str) -> str:
    """Blank every `#name(args)` argument list, keeping its `[content]` blocks (scanned in turn). Offsets and
    newlines are preserved, so a number's line is its line in the source."""
    out = list(s)
    i, n = 0, len(s)
    call = re.compile(r"#[A-Za-z_][\w.-]*\(")
    while i < n:
        m = call.search(s, i)
        if not m:
            break
        op = m.end() - 1
        end = _call_end(s, op)
        if end < 0:
            i = m.end()
            continue
        inner = s[op + 1:end - 1]
        keep = _content_blocks(inner)
        stripped = list(_blank(s[m.start():end]))
        for a, b in keep:
            lo = op + 1 + a - m.start()
            for k in range(lo, lo + (b - a)):
                stripped[k] = s[m.start() + k]
        out[m.start():end] = stripped
        # re-scan inside the kept blocks (nested calls); arguments outside them are already blank
        i = op + 1
    return "".join(out)


def _code_end(s: str, i: int) -> int:
    """End of the code statement starting at s[i]: the first newline (or the close of a `#{...}`) with every
    ( [ { opened since closed, so a multi-line `#let f() = { ... }` goes whole."""
    depth, j, n = 0, i, len(s)
    while j < n:
        c = s[j]
        if c == '"':
            j += 1
            while j < n and s[j] != '"':
                j += 2 if s[j] == "\\" else 1
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth <= 0 and s.startswith("#{", i):
                return j + 1
        elif c == "\n" and depth <= 0:
            return j
        j += 1
    return n


def strip_code(s: str) -> str:
    out, i = [], 0
    for m in CODE_START_RE.finditer(s):
        if m.start() < i:
            continue
        end = _code_end(s, m.start())
        out += [s[i:m.start()], _blank(s[m.start():end])]
        i = end
    return "".join(out) + s[i:]


def clean(src: str, strip_comments) -> str:
    text = ESCAPE_RE.sub(lambda m: _blank(m.group(0)), strip_comments(src))
    return strip_calls(strip_code(text))


# ---- examination ----------------------------------------------------------------------------------

def examine(src: str, strip_comments) -> tuple[int, list[tuple[int, str, str]]]:
    """(numbers examined, [(line, source token, canonical value)]) over one Typst source. Pure on the text."""
    text = clean(src, strip_comments)
    lines = text.split("\n")
    first_section = next((k for k, ln in enumerate(lines) if re.match(r"^[ \t]*==(?!=)[ \t]+\S", ln)), len(lines))
    toks: list[tuple[int, str, str]] = []
    for k, ln in enumerate(lines):
        work = ln
        h = HEADING_LABEL_RE.match(work)
        if h:
            work = work[:h.start(2)] + _blank(h.group(2)) + work[h.end(2):]
        lm = LIST_MARKER_RE.match(work)
        if lm:
            work = _blank(work[:lm.end()]) + work[lm.end():]
        if k < first_section:
            for rx in DATE_RES:
                work = rx.sub(lambda m: _blank(m.group(0)), work)
        for m in NUM_RE.finditer(work):
            before = work[:m.start()]
            if REF_BEFORE_RE.search(before):
                continue
            raw, num = m.group(0).strip(), m.group("num")
            decimal = "." in num
            if not (decimal or m.group("pct") or m.group("cur") or len(num.replace(",", "")) >= 2):
                        continue
            value = canon(num)
            # 2019-20 / 2019–20: a two-digit tail after a year and a dash is that year's short form.
            tail = re.search(r"(\d{4})[-–—]$", before)
            if tail and re.fullmatch(r"\d{2}", num) and not m.group("pct") and not m.group("cur"):
                value = tail.group(1)[:2] + num
            toks.append((k + 1, raw, value))
    return len(toks), toks


def read_paper(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader
            return "\n".join((p.extract_text() or "") for p in PdfReader(str(path)).pages)
        except ImportError:
            exe = shutil.which("pdftotext")
            if not exe:
                raise CouldNot(f"paper `{path}` is a PDF and neither pypdf nor pdftotext is available")
            r = subprocess.run([exe, "-layout", str(path), "-"], capture_output=True, text=True, check=False)
            if r.returncode != 0:
                raise CouldNot(f"pdftotext could not read `{path}`: {r.stderr.strip()}")
            return r.stdout
        except Exception as exc:  # noqa: BLE001 - an unreadable PDF is not a clean paper
            raise CouldNot(f"could not read the PDF paper `{path}`: {type(exc).__name__}: {exc}")
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise CouldNot(f"could not read the paper `{path}`: {exc}")


def run(plan: Path, root: Path) -> tuple[int, list[str]]:
    deck = _deck_module()
    try:
        plan_text = plan.read_text(encoding="utf-8")
    except OSError as exc:
        raise CouldNot(f"could not read the plan `{plan}`: {exc}")
    try:
        declared = deck.parse_outputs(plan_text)
        paper_decl = deck.parse_source_paper(plan_text, root)
        inventory = deck.parse_source_inventory(plan_text)
    except deck.GrammarError as exc:
        raise CouldNot(str(exc))

    def resolve(rel: str) -> Path:
        p = Path(rel).expanduser()
        return p if p.is_absolute() else root / p

    paper_path = resolve(paper_decl["path"])
    reference = paper_numbers(read_paper(paper_path))
    for item in inventory:
        reference |= paper_numbers(item["source"])

    examined, findings = 0, []
    for key in ("deck", "notes"):
        path = resolve(declared[key])
        try:
            src = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise CouldNot(f"the declared {key} `{path}` is missing or unreadable: {exc}")
        n, toks = examine(src, deck.strip_typst_comments)
        examined += n
        try:
            shown = path.resolve().relative_to(root)
        except ValueError:
            shown = path
        for line, raw, value in toks:
            if value not in reference:
                findings.append(
                    f"{shown}:{line}: {NAME} {raw!r} (value {value}) occurs nowhere in the paper "
                    f"`{paper_decl['path']}` or a ## Source Inventory Source cell"
                )
    return examined, findings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog=f"{NAME}.py", description=__doc__.split("\n\n")[0])
    ap.add_argument("--project-dir", default=".")
    ap.add_argument("--plan")
    ap.add_argument("--files", nargs="*", default=[])
    a = ap.parse_args(argv)
    root = Path(a.project_dir).expanduser().resolve()
    if not a.plan:
        print(f"{NAME}: 0 number(s) examined — nothing in scope (no --plan given)")
        return 0
    try:
        examined, findings = run(Path(a.plan).expanduser(), root)
    except CouldNot as exc:
        print(f"{NAME}: 0 number(s) examined — COULD-NOT-CHECK ({' '.join(str(exc).split())})")
        print(f"COULD-NOT-CHECK: {exc}", file=sys.stderr)
        return 2
    if examined == 0:
        print(f"{NAME}: 0 number(s) examined — nothing in scope (the declared deck and notes state no checkable number)")
        return 0
    print(f"{NAME}: {examined} number(s) examined")
    for f in findings:
        print(f)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
