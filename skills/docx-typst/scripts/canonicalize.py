#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Put a Typst body file into the canonical form that survives a Word round trip.

WHY A CANONICAL FORM EXISTS AT ALL

A coauthor edits the `.docx` and sends it back. To merge their edits with edits made
in the repo meanwhile, the two versions need a common ancestor in the SAME notation —
otherwise reconciliation is a human diffing two documents by eye, which is the failure
this whole skill exists to prevent.

Converting the returned docx back to Typst gives a second Typst file, but it is not
literally the source: pandoc normalizes as it goes (`_x_`->`#emph[x]`, `*x*`->`#strong[x]`,
straight quotes->curly, a `<label>` anchor after every heading). Diff the source against
it and every paragraph looks changed.

The fix is to define the canonical form as **the output of one full docx round trip**
and commit the source already in it. Then the returned document's Typst form and the
repo's source are directly comparable, and reconciliation collapses to `git merge-file`.

CANONICAL FORM = `typ -> docx -> typ`, NOT `-f typst -t typst`

The docx round trip is the pipe a returned document actually passes through, so it is
the only fixed point that matters. Verified empirically: one pass reaches the fixed
point and a second pass is byte-identical.

`--wrap=none` is part of the definition. With pandoc's default 72-column wrapping, a
one-word edit reflows the rest of its paragraph, and the merge sees a dozen changed
lines where one word changed. One line per paragraph keeps a merge's granularity
honest: disjoint sections merge cleanly, and two edits inside one paragraph conflict —
which is correct, not a limitation.

The reference doc is deliberately NOT used here. It changes the docx's STYLES, not its
structure, so it does not affect the recovered Typst — verified. Canonical form is
therefore template-independent, and re-templating a document never churns the source.

TWO PANDOC DEFECTS THE RECOVERY MUST NORMALIZE AROUND

Real Word output — as opposed to a docx pandoc itself wrote — trips two bugs that make
the recovered Typst either unparseable or quietly wrong. Both are fixed by rewriting the
recovered text once, in `normalize_recovered`, applied to EVERY `docx -> typ` result so
the fixed point still holds.

1. SINGLE-COLUMN TABLES DO NOT PARSE. Word wraps figures and floats in a one-cell
   container table. Pandoc's typst WRITER emits its width list as `columns: (100%)` —
   which is a parenthesized scalar in Typst, not a one-element array — and pandoc's own
   typst READER then fails with `Could not determine number of columns: VRatio (1 % 1)`.
   26 occurrences in one 1.2M manuscript, and the whole file is unrecoverable. Still
   present on pandoc `main` as of 2026-08 (`Writers/Typst.hs`: the width list is built
   with `parens (commaSep ...)` while the align list beside it appends a trailing comma
   unconditionally), so upgrading pandoc does not fix it. The normalization adds the
   comma: `columns: (100%,)`. Flattening the container table instead was rejected —
   a genuine one-column data table is indistinguishable at that line, and flattening it
   would be data loss to work around a syntax bug.

2. WORD-FINAL APOSTROPHES BECOME CLOSING DOUBLE QUOTES. The writer unsmartens `’` to a
   straight `'`; the reader then re-smartens, and reads a `'` at the end of a word as a
   closing DOUBLE quote. `Officers’ Retirement` survives one pass as `Officers'` and
   becomes `Officers” Retirement` on the second — so the pipe converges on corruption
   rather than on the input. The normalization restores `’` for word-final apostrophes,
   which the reader passes through untouched. Raw spans, raw blocks and math are exempt:
   pandoc does not smarten inside them, so rewriting there would corrupt code.

THE BODY LINT

Show rules in the file pandoc reads collapse `= Heading` into a bold paragraph — pandoc
evaluates enough Typst to apply them, and the heading's semantics are lost before the
docx is written. So styling lives in `main.typ` (`#import`/`#let`/`#show`/`#set`, then
`#include "body.typ"`) and `body.typ` stays pure markup. `--lint` enforces the split.

EMBEDDED IMAGES ARE NEVER DROPPED SILENTLY

Without `--extract-media` pandoc discards a docx's images: seven figures in that same
manuscript vanished, leaving empty container tables with orphaned captions, and the
207KB result looked entirely healthy. The recovery therefore always extracts, and a
document whose recovered Typst contains `image(` calls REFUSES to write anything unless
`--media-dir` says where the files go. Symmetrically, the round trip passes
`--resource-path` so pandoc can find them again: a missing image is only a WARNING to
pandoc and it replaces the picture with its alt text at exit status 0, so `_run` treats
that warning as an error.

Usage:
    canonicalize.py body.typ                  # canonical form to stdout
    canonicalize.py body.typ --in-place
    canonicalize.py body.typ --check          # exit 1 if not already canonical
    canonicalize.py body.typ --lint           # exit 1 on styling directives in a body file
    canonicalize.py --from-docx doc.docx --output body.typ --media-dir media
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Directives that belong in main.typ. A body file carrying any of them either styles
# itself (and loses heading semantics through pandoc) or depends on state pandoc cannot
# see. Matched at the start of a line only, so `#set` inside prose or a code block's
# body is not flagged.
BODY_LINT_RULES = [
    ("#show", "show rules collapse `= Heading` into a bold paragraph when pandoc reads the file"),
    ("#set", "document-level `#set` is styling; it belongs with the other styling in main.typ"),
    ("#let", "definitions are invisible to pandoc; the body would convert with the call site unresolved"),
    ("#import", "imports are invisible to pandoc; anything they provide vanishes in the docx"),
]

_LINT_RE = re.compile(r"^\s*(#show|#set|#let|#import)\b")


class PandocError(RuntimeError):
    pass


def require_pandoc() -> str:
    exe = shutil.which("pandoc")
    if not exe:
        raise PandocError("pandoc not found on PATH")
    return exe


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise PandocError(f"{' '.join(cmd)} failed ({proc.returncode}):\n{proc.stderr.strip()}")


def typ_to_docx(typ: Path, docx: Path, reference_doc: Path | None = None) -> Path:
    """Convert a Typst body file to .docx. `reference_doc` supplies Word styles."""
    require_pandoc()
    cmd = ["pandoc", "-f", "typst", "-t", "docx", str(typ), "-o", str(docx)]
    if reference_doc:
        cmd.insert(-2, f"--reference-doc={reference_doc}")
    _run(cmd)
    return docx


def docx_to_typ(docx: Path, track_changes: str = "accept") -> str:
    """Convert a .docx back to Typst text.

    `track_changes` is pandoc's `--track-changes`: `accept` gives the edited document,
    `reject` gives its pre-edit ancestor, `all` marks both inline. A tracked-changes
    docx therefore yields BOTH sides of the coauthor's work from one file.
    """
    require_pandoc()
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "out.typ"
        _run([
            "pandoc", "-f", "docx", "-t", "typst", "--wrap=none",
            f"--track-changes={track_changes}", str(docx), "-o", str(out),
        ])
        return out.read_text(encoding="utf-8")


def canonicalize_text(text: str) -> str:
    """One full docx round trip. Idempotent after the first pass."""
    require_pandoc()
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        src = td / "in.typ"
        src.write_text(text, encoding="utf-8")
        typ_to_docx(src, td / "mid.docx")
        return docx_to_typ(td / "mid.docx", track_changes="accept")


def canonicalize_file(path: Path) -> str:
    return canonicalize_text(Path(path).read_text(encoding="utf-8"))


def canonical_from_docx(docx: Path, track_changes: str = "accept") -> str:
    """Canonical Typst for a .docx.

    The recovered Typst is canonicalized again rather than trusted directly: a docx
    that did not come from this pipe (Word's own save, a Google Docs export) can carry
    structure whose first round trip still moves. Idempotence makes the extra pass free
    for a document that was already canonical.
    """
    return canonicalize_text(docx_to_typ(docx, track_changes=track_changes))


def lint_body(text: str, path: str = "<body>") -> list[str]:
    """Styling directives that must not appear in a body file, as human-readable problems."""
    reasons = dict(BODY_LINT_RULES)
    problems = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        m = _LINT_RE.match(line)
        if m:
            directive = m.group(1)
            problems.append(f"{path}:{lineno}: {directive} — {reasons[directive]}")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("typ", type=Path, nargs="?", help="Typst body file")
    ap.add_argument("--from-docx", type=Path, help="recover canonical Typst from a .docx instead")
    ap.add_argument("--track-changes", default="accept", choices=["accept", "reject", "all"],
                    help="with --from-docx: which side of a tracked-changes document to take")
    ap.add_argument("--output", type=Path, help="write here instead of stdout")
    ap.add_argument("--in-place", action="store_true", help="rewrite the input file")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the file is not already at its fixed point; print the diff")
    ap.add_argument("--lint", action="store_true",
                    help="exit 1 if the body file carries styling directives")

    args = ap.parse_args(argv)

    if not args.typ and not args.from_docx:
        ap.error("pass a .typ file or --from-docx")

    try:
        if args.from_docx:
            result = canonical_from_docx(args.from_docx, track_changes=args.track_changes)
            original = None
        else:
            original = args.typ.read_text(encoding="utf-8")
            if args.lint:
                problems = lint_body(original, str(args.typ))
                if problems:
                    print("body lint failed — move these into main.typ:", file=sys.stderr)
                    for p in problems:
                        print(f"  {p}", file=sys.stderr)
                    return 1
                if not args.check:
                    print(f"body lint passed: {args.typ}", file=sys.stderr)
                    return 0
            result = canonicalize_text(original)
    except PandocError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.check:
        if original is not None and original == result:
            print(f"canonical: {args.typ}", file=sys.stderr)
            return 0
        diff = difflib.unified_diff(
            (original or "").splitlines(keepends=True), result.splitlines(keepends=True),
            fromfile=f"{args.typ} (as committed)", tofile=f"{args.typ} (canonical)",
        )
        sys.stderr.write(f"not canonical: {args.typ}\n")
        sys.stderr.writelines(diff)
        return 1

    if args.in_place:
        if not args.typ:
            print("error: --in-place needs a .typ input", file=sys.stderr)
            return 2
        args.typ.write_text(result, encoding="utf-8")
    elif args.output:
        args.output.write_text(result, encoding="utf-8")
    else:
        sys.stdout.write(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
