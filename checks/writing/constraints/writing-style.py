#!/usr/bin/env -S uv run python3
"""Constraint: writing-style — the style rules a regex settles, on the CLI contract (_writing.main).

This file runs SHIP-DICTION and ALL-CAPS, which hold in every register; checks/writing/<register>/
constraints/register-crossing.py (legal, econ, general) loads it and runs REGISTER-CROSSING (and INLINE-CITE
for legal) for the register its directory names. Each rule is a pattern with no judgement left in it (the judged register
rules are Jev's, under checks/writing/rules, and the reviewer's):

  SHIP-DICTION       a phrase from the writing-general Ship table ("utilize", "due to the fact
                     that", ...). The table names the replacement, so a hit is never a matter
                     of taste.
  ALL-CAPS           a common word set in capitals for emphasis ("this is NOT the rule").
  REGISTER-CROSSING  a marker that belongs to another domain's register: Bluebook short forms
                     or `This Article` outside a law review, `Part II.B` outside one, a
                     directional `Section 2 above` or `This paper` inside one.
  INLINE-CITE        (legal) a full citation — volume, reporter or journal, page — in the body
                     text of a law review draft. Footnotes carry the citations.

Quoted text is skipped — a quotation reproduces someone else's diction. Frontmatter, code,
tables and headings are not prose and are skipped too. Every .md, .typ and .tex file handed in is read.

The general register (comment letters, memos, briefs) is its own level, checks/writing/general/: a check in
checks/writing/constraints/ is inherited by every register, so it could not hold general's crossing rules.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _writing

PROSE_EXT = (".md", ".typ", ".tex")

SHIP = {
    r"\bat this point in time\b": "now",
    r"\bsky-?rocket(?:s|ed|ing)?\b": "give the number",
    r"\bdifferent than\b": "different from",
    r"\btime ?frames?\b": "period / window / the dates",
    r"\bdue to the fact that\b": "because",
    r"\bin the event that\b": "if",
    r"\butili[sz](?:e|es|ed|ing|ation)\b": "use",
    r"\b(?:is|are|was|were) able to\b": "can / could",
    r"\ba large number of\b": "many, or the count",
    r"\bpast history\b": "history",
    r"\bwith regards? to\b": "about / on / under",
}

CAPS_WORDS = ("NOT", "NEVER", "ALWAYS", "ONLY", "MUST", "ALL", "NO", "EVERY", "NONE",
              "VERY", "REALLY", "CRUCIAL", "CRITICAL", "IMPORTANT", "KEY", "HUGE", "BEFORE",
              "AFTER", "SHOULD", "CANNOT", "WILL", "DOES", "IS", "ARE")
CAPS_RX = re.compile(r"(?<![\w-])(?:{})(?![\w-])".format("|".join(CAPS_WORDS)))

BLUEBOOK = r"\b(?:supra|infra)\b|(?<![\w.])[Ii]d\.(?=[\s,]|$)"
ROMAN_PART = r"\bParts? [IVX]+(?:\.[A-Z](?:\.\d+)?)?\b"
REGISTER = {
    "general": [(BLUEBOOK, "a Bluebook short form — give the full cite or a short name"),
                (r"\bThis (?:Article|[Pp]aper)\b", "say `This letter`, `This memorandum`, or name the thing"),
                (ROMAN_PART, "number the sections; do not import `Part II.B`")],
    "econ": [(BLUEBOOK, "Bluebook short forms are absent in finance journals"),
             (r"\bThis Article\b", "the law review self-reference; write `This paper`"),
             (ROMAN_PART, "cross-reference by Section, numerically")],
    "legal": [(r"\b(?:[Ss]ections? \d+(?:\.\d+)*,? (?:above|below)|(?:above|below) in [Ss]ection \d+)\b",
               "cross-reference by Part, not by section number"),
              (r"\bThis (?:[Pp]aper|[Ss]tudy)\b", "the law review self-reference is `This Article` (`This Note`)")],
}

# volume + reporter, code or journal + page: a full citation, not a case name or "Section 10(b)"
FULL_CITE = re.compile(
    r"\b\d+\s+(?:U\.S\.|S\.\s?Ct\.|L\.\s?Ed\.(?:\s?2d)?|F\.(?:\s?Supp\.)?(?:\s?(?:2d|3d|4th))?|"
    r"A\.(?:2d|3d)|N\.[EW]\.(?:2d|3d)?|S\.[EW]\.(?:2d|3d)?|So\.(?:\s?[23]d)?|P\.(?:2d|3d)|Cal\.\s?Rptr\.|"
    r"WL|U\.S\.C\.|C\.F\.R\.|Fed\.\s?Reg\.|Stat\.|(?:[A-Z][\w.&']*\s){0,5}?L\.\s?(?:Rev|J)\.)\s+(?:§+\s*)?\d")
NOTE_OPEN = re.compile(r"#footnote\[|\\footnote\{|\^\[")


def body_only(line: str) -> str:
    """The line with its inline footnotes cut out; a footnote left open runs to the line's end."""
    out, i = "", 0
    for m in NOTE_OPEN.finditer(line):
        if m.start() < i:
            continue
        out += line[i:m.start()]
        opener, close = m.group(0)[-1], "}" if m.group(0).endswith("{") else "]"
        depth, j = 1, m.end()
        while j < len(line) and depth:
            depth += {opener: 1, close: -1}.get(line[j], 0)
            j += 1
        i = j
    return out + line[i:]

QUOTED = re.compile(r"“[^”]*”|\"[^\"\n]*\"")


def prose_lines(path: Path):
    """(line_no, text) for each prose line: no frontmatter, code, table, heading or comment."""
    ext = path.suffix.lower()
    fence = front = False
    for i, raw in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines()):
        st = raw.strip()
        if i == 0 and st == "---" and ext == ".md":
            front = True
            continue
        if front:
            front = st not in ("---", "...")
            continue
        if st.startswith(("```", "~~~")):
            fence = not fence
            continue
        if fence or not st or st.startswith(("|", "<!--")):
            continue
        if (ext == ".md" and st.startswith("#")) \
                or (ext == ".typ" and st.startswith(("=", "#", "//", "<", "@"))) \
                or (ext == ".tex" and st.startswith(("%", "\\section", "\\subsection", "\\label"))):
            continue
        text = re.sub(r"`[^`]*`", " ", raw)
        yield i + 1, QUOTED.sub(" ", text)


def _findings(path: Path, rules, inline_cite: bool):
    for n, text in prose_lines(path):
        for rx, rule, msg in rules:
            for m in rx.finditer(text):
                yield n, rule, msg.format(m=m.group(0))
        if inline_cite and not re.match(r"\s*\[\^[^\]]+\]:", text):
            for m in FULL_CITE.finditer(body_only(text)):
                yield n, "INLINE-CITE", f"`{m.group(0)}…` in body text: put the citation in a footnote"


def style(path: Path):
    """SHIP-DICTION and ALL-CAPS: (line, rule, message) for the rules every register shares."""
    rules = [(re.compile(p, re.IGNORECASE), "SHIP-DICTION", f"`{{m}}` → {w}") for p, w in SHIP.items()]
    rules.append((CAPS_RX, "ALL-CAPS", "`{m}` set in capitals for emphasis — let the sentence carry it"))
    return _findings(path, rules, inline_cite=False)


def crossing(path: Path, register: str):
    """REGISTER-CROSSING for `register`, and INLINE-CITE when it is legal."""
    rules = [(re.compile(p), "REGISTER-CROSSING", f"`{{m}}`: {w}") for p, w in REGISTER[register]]
    return _findings(path, rules, inline_cite=register == "legal")


def main(name: str, findings_of) -> int:
    """`findings_of(path)` over every .md, .typ and .tex file handed in, on the contract (_writing.main)."""
    def check(context):
        cwd = Path(context["cwd"])
        return [f"{_writing.rel(p, cwd)}:{n}: {rule}: {msg}" for p in context["files"] for n, rule, msg in findings_of(p)]
    return _writing.main(name, check, lambda p: p.suffix.lower() in PROSE_EXT, kind="prose file (.md, .typ, .tex)")


if __name__ == "__main__":
    raise SystemExit(main("writing-style", style))
