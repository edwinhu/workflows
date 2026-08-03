#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""Freeze every computed reference in a typst body into a literal body file.

Citations and cross-references are ONE problem, not two. pandoc lowers
`#cite(<Key>)` to `[Key]` and `@sec-remedies` to `[sec-remedies]`, discarding in
both cases the number typst assigned during layout. So both are frozen here, in
one query and one positional splice, and `supra note 8` / `Section IV.B` /
`infra note 195` are never typed by a human.

    expand_citations.py --main main.typ --src body-src.typ --out body.typ
    expand_citations.py --main main.typ --src body-src.typ --out body.typ --check

WHY A MANUSCRIPT WITH LIVE CITATIONS NEEDS TWO BODY FILES

They have incompatible requirements and both are load-bearing.

    body-src.typ   the editing surface. Carries live `#cite(<Key>)`, so
                   `supra note N` renumbers itself when a footnote is inserted.
    body.typ       the canonical artifact. Every citation already rendered, so
                   it survives the docx round trip.

A live cite CANNOT be canonical. pandoc's docx writer emits a Cite node as the
bare text `[Key]`, so `typ -> docx -> typ` turns `#cite(<Bebchuk2019-uq>)` into
`\\[Bebchuk2019-uq\\]` and the file is no longer its own fixed point.
`canonicalize.py --check` gates exactly that, and `reconcile.py`'s three-way
merge of a coauthor's returned .docx depends on the gate holding. Keeping the
symbolic form in a separate file preserves both: coauthor edits still merge into
the canonical file, and the citation automation still runs upstream of it.

HOW

typst resolves `supra note N` against real footnote numbers, which only exist
after layout, so this asks the compiled document for its answers rather than
reimplementing the rule. `query(<bb-out>)` returns the rendered source of every
citation site in document order and they are spliced positionally -- the same
technique canonicalize.py uses to restore image paths across the round trip.

Because every call is finished markup by the time pandoc reads the body, the
docx build never needs `--citeproc`, and the Word file's citation text is by
construction the text typst laid out. One renderer, two outputs, no drift.

AFTER A RECONCILE

`reconcile.py` merges a coauthor's edits into the LITERAL file. Carrying those
edits back to the source file is a manual step -- a coauthor who edits inside a
citation string has to be reconciled by hand.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# Every construct pandoc cannot carry across the docx boundary, in one pattern.
# A cite and a cross-reference are the same problem -- pandoc lowers `#cite(<K>)`
# to `[K]` and `@sec-x` to `[sec-x]`, discarding the number typst computed during
# layout -- so they take the same fix and ride the same `<bb-out>` stream. Adding
# a construct here means adding a `#show` rule that tags it, and nothing else.
SITE_RE = re.compile(
    r"#cite\(<[^>]+>(?:\s*,\s*supplement:\s*\[[^\]]*\])?\s*\)"   # #cite(<Key>)
    r"|#ref\(<[^>]+>\)"                                          # #ref(<label>)
    r"|@[A-Za-z0-9_][A-Za-z0-9_:.-]*[A-Za-z0-9_]"                # @label
)


# The only words the renderer emits whose case depends on position. A full form
# starts with an author name and must never be touched, which is why this matches
# a leading word rather than just upper/lowercasing the first letter.
LEAD_RE = re.compile(r"^#emph\[(Id\.|id\.|Supra|supra|Infra|infra)\]")


def _starts_citation_sentence(src: str, pos: int) -> bool:
    """Does the site at `pos` begin a citation SENTENCE (rather than a clause)?

    Bluebook capitalizes at the start of a citation sentence and lowercases
    inside a citation clause, after a signal, or mid-textual-sentence
    (short-forms.md:48-60, signals-parentheticals.md:171/181).

    Only the source knows this. typst cannot: `text` is not locatable, so a show
    rule can query the footnote it sits in but never the character before it.
    Here the character is simply there.
    """
    prev = src[:pos].rstrip()
    return (not prev) or prev[-1] in "[."


def _apply_case(rendered: str, sentence_initial: bool) -> str:
    m = LEAD_RE.match(rendered)
    if not m:
        return rendered
    word = m.group(1)
    fixed = (word[0].upper() if sentence_initial else word[0].lower()) + word[1:]
    return rendered[: m.start(1)] + fixed + rendered[m.end(1) :]


def rendered_citations(main: Path, root: Path) -> list[str]:
    out = subprocess.run(
        ["typst", "eval", "query(<bb-out>).map(it => it.value)",
         "--in", str(main), "--root", str(root), "--format", "json"],
        capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise SystemExit(f"error: typst could not resolve citations:\n{out.stderr[:1500]}")
    return json.loads(out.stdout)


# typst GROUPS adjacent cites: `#cite(<a>); #cite(<b>)` is one citation group and
# the `; ` between them is swallowed, so a stacked footnote renders as
# `...(2007) Dorothy S. Lund...` with the separator gone. Wrapping the separator in
# a content block -- `#cite(<a>)#[;] #cite(<b>)` -- breaks the grouping and is the
# only spelling found that renders correctly.
#
# That wrapper is a typst-layout device with no meaning in the LITERAL body, and
# leaving it there puts the generated file permanently one step off its canonical
# fixed point: the docx round trip flattens `#[;]` back to `;`, so
# `canonicalize.py --check` fails on a file `--check` here calls up to date. The two
# gates have to agree, so the wrapper is dissolved on the way out. Bounded to
# punctuation and space, because that is the whole idiom and anything else in a
# `#[...]` is authored content.
_UNGROUP_RE = re.compile(r"#\[([;,:.\s]*)\]")


def expand(src: str, rendered: list[str]) -> str:
    calls = SITE_RE.findall(src)
    if len(calls) != len(rendered):
        raise SystemExit(f"error: {len(calls)} cite/reference sites in the source but "
                         f"typst rendered {len(rendered)}; refusing to splice positionally")
    it = iter(rendered)
    out = SITE_RE.sub(
        lambda m: _apply_case(next(it), _starts_citation_sentence(src, m.start())), src
    )
    return _UNGROUP_RE.sub(lambda m: m.group(1), out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--main", type=Path, required=True,
                    help="the file typst compiles (installs the #show cite rule)")
    ap.add_argument("--src", type=Path, required=True,
                    help="body file carrying live #cite(<Key>) calls")
    ap.add_argument("--out", type=Path, required=True,
                    help="literal body file to generate (the canonical artifact)")
    ap.add_argument("--root", type=Path, default=None,
                    help="typst project root (default: the main file's parent)")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if --out is stale relative to --src")
    args = ap.parse_args(argv)

    root = args.root or args.main.resolve().parent
    rendered = rendered_citations(args.main, root)
    new = expand(args.src.read_text(), rendered)

    if args.check:
        cur = args.out.read_text() if args.out.exists() else ""
        if cur == new:
            print(f"up to date: {args.out.name} matches {args.src.name} "
                  f"({len(rendered)} citations)")
            return 0
        print(f"STALE: {args.out.name} does not match the render of {args.src.name}",
              file=sys.stderr)
        return 1

    args.out.write_text(new)
    print(f"expanded {len(rendered)} citations: {args.src.name} -> {args.out.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
