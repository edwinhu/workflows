#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""Render every `#cite(...)` in a typst source body into a literal body file.

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

CITE_RE = re.compile(r"#cite\(<[^>]+>(?:\s*,\s*supplement:\s*\[[^\]]*\])?\s*\)")


def rendered_citations(main: Path, root: Path) -> list[str]:
    out = subprocess.run(
        ["typst", "eval", "query(<bb-out>).map(it => it.value)",
         "--in", str(main), "--root", str(root), "--format", "json"],
        capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise SystemExit(f"error: typst could not resolve citations:\n{out.stderr[:1500]}")
    return json.loads(out.stdout)


def expand(src: str, rendered: list[str]) -> str:
    calls = CITE_RE.findall(src)
    if len(calls) != len(rendered):
        raise SystemExit(f"error: {len(calls)} #cite calls in the source but typst "
                         f"rendered {len(rendered)}; refusing to splice positionally")
    it = iter(rendered)
    return CITE_RE.sub(lambda _m: next(it), src)


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
