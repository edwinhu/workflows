#!/usr/bin/env -S uv run python3
"""writing_style_check.py — the style rules a regex settles, over <project>/drafts.

    writing_style_check.py --project <dir> --style legal|econ|general

Three rules, each one a pattern with no judgement left in it (the judged register rules are
Jev's, under constraints/jev/writing, and the reviewer's):

  SHIP-DICTION       a phrase from the writing-general Ship table ("utilize", "due to the fact
                     that", ...). The table names the replacement, so a hit is never a matter
                     of taste.
  ALL-CAPS           a common word set in capitals for emphasis ("this is NOT the rule").
  REGISTER-CROSSING  a marker that belongs to another domain's register: Bluebook short forms
                     or `This Article` outside a law review, `Part II.B` outside one, a
                     directional `Section 2 above` inside one.

Quoted text is skipped — a quotation reproduces someone else's diction. Frontmatter, code,
tables and headings are not prose and are skipped too.

Prints `file:line: RULE: text` per finding. Exit 0 clean · 1 findings · 2 refusal.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

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
               "cross-reference by Part, not by section number")],
}

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


def check(path: Path, style: str):
    rules = [(re.compile(p, re.IGNORECASE), "SHIP-DICTION", f"`{{m}}` → {w}") for p, w in SHIP.items()]
    rules.append((CAPS_RX, "ALL-CAPS", "`{m}` set in capitals for emphasis — let the sentence carry it"))
    rules += [(re.compile(p), "REGISTER-CROSSING", f"`{{m}}`: {w}") for p, w in REGISTER[style]]
    for n, text in prose_lines(path):
        for rx, rule, msg in rules:
            for m in rx.finditer(text):
                yield n, rule, msg.format(m=m.group(0))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="the style rules a regex settles, over <project>/drafts")
    ap.add_argument("--project", required=True)
    ap.add_argument("--style", required=True, choices=sorted(REGISTER))
    a = ap.parse_args(argv)
    drafts = Path(a.project) / "drafts"
    files = sorted(p for p in drafts.glob("*") if p.suffix.lower() in PROSE_EXT) if drafts.is_dir() else []
    if not files:
        print(f"writing_style_check: no prose under {drafts} — the check would examine nothing",
              file=sys.stderr)
        return 2
    found = 0
    for f in files:
        for n, rule, msg in check(f, a.style):
            print(f"{f.relative_to(a.project)}:{n}: {rule}: {msg}")
            found += 1
    print(f"writing_style_check: {found} finding(s) across {len(files)} file(s)", file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
