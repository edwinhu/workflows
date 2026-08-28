#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["lxml"]
# ///
"""Check every `X, supra/infra note N` against the source defined at note N.

Three failures, in increasing order of how hard they are to see by eye:

1. The target note does not exist.
2. The direction is wrong — `supra` pointing forward, `infra` pointing back.
3. The short form names a source the target note does not contain. This is the
   one that matters: `create_crossrefs.py --dry-run` proves only that note N
   exists, and a direction check proves only which way it points, so a cite
   aimed at the wrong note passes both while citing the wrong document. Found
   eight of these in a report where the other checks reported none.

Read-only; it never writes to the docx.

    uv run --script check_crossrefs.py path/to/file.docx
    uv run --script check_crossrefs.py path/to/file.docx --verbose

Exit code 1 if any problem is found, so it can gate a build.
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile

from lxml import etree

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# "supra note 42", "infra notes 209-210"
REF = re.compile(r"(supra|infra)\s+notes?\s+(\d+)(?:\s*[-–]\s*(\d+))?", re.I)
# Bluebook signals and punctuation that end the preceding citation
SIGNAL = re.compile(
    r"(?:\(citing\s|\(quoting\s|see also\s|but see\s|see\s|cf\.\s|accord\s|e\.g\.,\s)", re.I)
# A short form is a run of capitalised words, which may be joined by "&" or "and"
# ("Smith & Jones", "Doe Deposition Transcript", "Expert Report").
SHORT_FORM = re.compile(
    r"((?:[A-Z][\w’'.\-]*(?:\s+(?:&|and)\s+|\s+))*[A-Z][\w’'.\-]*)\s*,?\s*$")
# Words that are never the distinguishing part of a short form
NOISE = {"The", "In", "Of", "And", "At", "See", "Id", "No", "But", "For", "A", "An"}


def tracked(path: str) -> int:
    """Count tracked insertions/deletions. Footnote numbering is not trustworthy
    while they are pending: a deleted footnote still sits in footnotes.xml, so
    position-in-id-order stops matching what Word displays and every reference
    reads as misaimed. Accept or reject changes first."""
    z = zipfile.ZipFile(path)
    n = 0
    for part in ("word/document.xml", "word/footnotes.xml"):
        try:
            root = etree.fromstring(z.read(part))
        except KeyError:
            continue
        n += len(root.findall(f".//{W}ins")) + len(root.findall(f".//{W}del"))
    return n


def footnotes(path: str) -> dict[int, str]:
    """Displayed footnote number -> its text. Word numbers them in id order."""
    z = zipfile.ZipFile(path)
    root = etree.fromstring(z.read("word/footnotes.xml"))
    raw = {}
    for fn in root.findall(f"{W}footnote"):
        i = int(fn.get(f"{W}id"))
        if i >= 1:                       # ids 0 and -1 are separator/continuation
            raw[i] = "".join(t.text or "" for t in fn.iter(f"{W}t"))
    return {n + 1: raw[i] for n, i in enumerate(sorted(raw))}


def antecedent(text: str, at: int) -> str:
    """The short-form name immediately before `supra note N`, e.g. 'Lin'."""
    head = text[:at]
    head = re.split(r"[;.]\s|“|”", head)[-1]      # last clause
    head = SIGNAL.split(head)[-1]                            # after any signal
    m = SHORT_FORM.search(head.strip())
    return m.group(1).strip() if m else ""


def keywords(name: str) -> list[str]:
    return [w for w in re.findall(r"[A-Z][\w’'’-]+", name) if w not in NOISE]


def check(path: str, verbose: bool = False) -> int:
    marks = tracked(path)
    if marks:
        print(f"REFUSED: {marks} tracked changes pending. Footnote numbers shift when "
              f"they are accepted, so every result here would be noise.\n"
              f"Accept or reject the changes, then re-run on the clean copy.")
        return 2
    notes = footnotes(path)
    problems, checked = [], 0

    for num in sorted(notes):
        text = notes[num]
        for m in REF.finditer(text):
            kind, lo = m.group(1).lower(), int(m.group(2))
            hi = int(m.group(3)) if m.group(3) else lo
            name = antecedent(text, m.start())
            for tgt in (lo, hi) if hi != lo else (lo,):
                checked += 1
                cite = f"{name + ', ' if name else ''}{kind} note {tgt}"
                if tgt not in notes:
                    problems.append((num, cite, f"note {tgt} does not exist"))
                    continue
                if kind == "supra" and tgt >= num:
                    problems.append((num, cite, "supra points forward"))
                    continue
                if kind == "infra" and tgt <= num:
                    problems.append((num, cite, "infra points backward"))
                    continue
                words = keywords(name)
                if not words:
                    continue              # bare cross-reference, nothing to match
                if not any(re.search(rf"\b{re.escape(w)}", notes[tgt]) for w in words):
                    problems.append(
                        (num, cite, f"\"{' '.join(words)}\" does not appear in note {tgt}"))

    print(f"footnotes {len(notes)} · cross-references {checked} · problems {len(problems)}")
    if problems:
        print()
    for num, cite, why in problems:
        m = re.search(r"note (\d+)", cite)
        tgt = int(m.group(1)) if m else -1
        print(f"  FN{num}  {cite}")
        print(f"      {why}")
        if tgt in notes:
            print(f"      note {tgt}: {notes[tgt][:100].strip()}…")
        print()
    if verbose:
        print("Checked references are name-matched loosely: a reference passes if any "
              "capitalised word in the short form appears in the target note. It "
              "catches a cite aimed at the wrong source, not a wrong pincite.")
    return 1 if problems else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    ap.add_argument("docx")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()
    return check(a.docx, a.verbose)


if __name__ == "__main__":
    sys.exit(main())
