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
   comma: `columns: (100%,)`.

   Making the container PARSE is not enough, because pandoc reproduces the nesting in
   both directions and adds a level per trip — 19 containers in that manuscript became
   57 after one round trip and 133 after two. There is no fixed point until the
   containers are gone, so `flatten_container_tables` removes them. It unwraps only a
   caption-less figure whose table holds exactly ONE cell; a real one-column table has
   one cell per row and is never touched.

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

# `columns: (100%),` — one width, no comma, so Typst reads a scalar and pandoc's reader
# rejects it. `[^(),]+` is what confines this to the single-element case: a real width
# list (`(50%, 50%)`) contains a comma and never matches.
_SINGLE_COLUMN_RE = re.compile(r"(?m)^(?P<indent>[ \t]*)columns: \((?P<width>[^(),]+)\),$")

# An apostrophe that ends a word. pandoc's typst reader smartens this one to a CLOSING
# DOUBLE QUOTE; interior apostrophes (`it's`) it gets right and are left alone.
_WORD_FINAL_APOSTROPHE = re.compile(r"(?<=\w)'(?![\w'])")

# Raw blocks, raw spans and math, where pandoc does not smarten and a rewrite would be
# corruption. A literal `$` is written `\$` by the typst writer, so an unescaped one is
# always math and the pairs are balanced.
_PROTECTED_SPAN = re.compile(r"```.*?```|`[^`\n]*`|(?<!\\)\$.*?(?<!\\)\$", re.DOTALL)

# `image("path", ...)` as the typst writer emits it.
_IMAGE_RE = re.compile(r'image\("(?P<path>(?:[^"\\]|\\.)*)"')

# Pandoc downgrades an image it cannot open to its alt text and still exits 0.
_MISSING_RESOURCE = "Could not fetch resource"

# A caption-less `#figure` wrapping a one-column, one-cell `#table` — Word's layout
# container, not a table anyone wrote. Matched on pandoc's line structure rather than by
# balancing brackets, because prose balances nothing: this manuscript's cells hold
# interval notation like `(0,5\]`, where the paren never closes, and a bracket scanner
# gives up on exactly the tables that need flattening.
_FIGURE_LINE = re.compile(r"^(?P<indent>[ \t]*)#figure\($")
_COLUMNS_LINE = re.compile(r"^[ \t]*columns: \((?:100%|auto),\),$")


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
    if _MISSING_RESOURCE in (proc.stderr or ""):
        missing = [ln.strip() for ln in proc.stderr.splitlines() if _MISSING_RESOURCE in ln]
        raise PandocError(
            "pandoc could not open an image and replaced it with its alt text — it reports this "
            "as a warning and still exits 0, so the loss would otherwise be silent:\n  "
            + "\n  ".join(missing)
            + "\nPass the directory holding the extracted media (--media-dir on recovery; the "
              "body file's own directory is used automatically for a file on disk)."
        )


def _outside_protected(text: str, fn) -> str:
    """Apply `fn` to everything except raw spans, raw blocks and math."""
    out, pos = [], 0
    for m in _PROTECTED_SPAN.finditer(text):
        out.append(fn(text[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(fn(text[pos:]))
    return "".join(out)


def _flatten_lines(lines: list[str]) -> list[str]:
    """`flatten_container_tables` over an already-split list of lines."""
    out: list[str] = []
    i = 0
    while i < len(lines):
        cell = _container_at(lines, i)
        if cell is None:
            out.append(lines[i])
            i += 1
            continue
        body, resume = cell
        out.extend(_flatten_lines(body))
        i = resume
    return out


def _container_at(lines: list[str], i: int) -> tuple[list[str], int] | None:
    """If a one-cell container starts at `lines[i]`, return (its cell, index past it).

    The shape pandoc emits, at some indent I:

        I  #figure(
        I    align(center)[#table(
        I      columns: (100%,),
        I      align: (auto,),
        I      [<cell, one or more lines>
        I      ],
        I    )]
        I    , kind: table
        I    )

    The four-line tail is matched as a unit, which is what distinguishes the container's
    own closing lines from those of a container nested inside its cell.
    """
    head = _FIGURE_LINE.match(lines[i])
    if not head or i + 5 >= len(lines):
        return None
    ind = head.group("indent")
    if (lines[i + 1] != f"{ind}  align(center)[#table("
            or not _COLUMNS_LINE.match(lines[i + 2])
            or lines[i + 3] != f"{ind}    align: (auto,),"
            or not lines[i + 4].startswith(f"{ind}    [")):
        return None

    for j in range(i + 5, len(lines) - 3):
        if (lines[j] == f"{ind}    ],"
                and lines[j + 1] == f"{ind}  )]"
                and lines[j + 2] == f"{ind}  , kind: table"
                and lines[j + 3] == f"{ind}  )"):
            first = ind + lines[i + 4][len(ind) + 5:]
            rest = [ln[4:] if ln[:4].isspace() else ln for ln in lines[i + 5:j]]
            body = [first, *rest]
            while body and not body[-1].strip():
                body.pop()
            return body, j + 4
    return None


def flatten_container_tables(text: str) -> str:
    """Unwrap Word's single-cell layout tables, leaving their contents in place.

    Word wraps a real table in a one-cell container table. Pandoc reproduces the nesting
    faithfully in BOTH directions and adds a level each time it makes the trip: a
    manuscript recovered with 19 containers came back with 57 after one round trip and
    133 after two. The nesting therefore grows without bound and the canonical form has
    no fixed point at all until the containers are removed — which is why this is not a
    tidiness pass.

    Only a caption-less `#figure` whose table has exactly ONE cell is unwrapped. A
    genuine one-column data table has one cell per row, so its `]` lines do not sit where
    this expects them and it is never touched.
    """
    return "\n".join(_flatten_lines(text.split("\n")))


def normalize_recovered(text: str) -> str:
    """Repair the two pandoc defects that make real Word output unrecoverable.

    Applied to every `docx -> typ` result, so it is part of the canonical form's
    definition rather than a one-off cleanup — which is what keeps the fixed point.
    Both rewrites are no-ops on text that does not exhibit the defect, so a future
    pandoc that emits `columns: 1` needs no change here.
    """
    text = _SINGLE_COLUMN_RE.sub(
        lambda m: f"{m.group('indent')}columns: ({m.group('width')},),", text
    )
    text = flatten_container_tables(text)
    return _outside_protected(text, lambda s: _WORD_FINAL_APOSTROPHE.sub("’", s))


def image_paths(text: str) -> list[str]:
    """Every path referenced by an `image(...)` call, in order of appearance."""
    return [m.group("path") for m in _IMAGE_RE.finditer(text)]


def set_image_paths(text: str, paths: list[str]) -> str:
    """Replace the Nth `image(...)` path with `paths[N]`. Order and count must match."""
    it = iter(paths)
    return _IMAGE_RE.sub(lambda m: f'image("{next(it)}"', text)


def typ_to_docx(
    typ: Path,
    docx: Path,
    reference_doc: Path | None = None,
    resource_path: Path | None = None,
) -> Path:
    """Convert a Typst body file to .docx. `reference_doc` supplies Word styles.

    `resource_path` is where relative `image(...)` paths resolve from; it defaults to the
    input file's own directory, which is what a body file next to its media wants.
    """
    require_pandoc()
    typ = Path(typ)
    root = Path(resource_path) if resource_path is not None else typ.resolve().parent
    cmd = [
        "pandoc", "-f", "typst", "-t", "docx", f"--resource-path={root}",
        str(typ), "-o", str(docx),
    ]
    if reference_doc:
        cmd.insert(-2, f"--reference-doc={reference_doc}")
    _run(cmd)
    return docx


def docx_to_typ(
    docx: Path,
    track_changes: str = "accept",
    extract_media: Path | None = None,
) -> str:
    """Convert a .docx back to Typst text, normalized.

    `track_changes` is pandoc's `--track-changes`: `accept` gives the edited document,
    `reject` gives its pre-edit ancestor, `all` marks both inline. A tracked-changes
    docx therefore yields BOTH sides of the coauthor's work from one file.

    `extract_media` is where embedded images are written. Without it pandoc drops them.
    """
    require_pandoc()
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "out.typ"
        cmd = [
            "pandoc", "-f", "docx", "-t", "typst", "--wrap=none",
            f"--track-changes={track_changes}", str(docx), "-o", str(out),
        ]
        if extract_media is not None:
            cmd.insert(-2, f"--extract-media={extract_media}")
        _run(cmd)
        return normalize_recovered(out.read_text(encoding="utf-8"))


def canonicalize_text(text: str, resource_path: Path | None = None) -> str:
    """One full docx round trip. Idempotent after the first pass.

    `resource_path` must name the directory `image(...)` paths in `text` resolve from,
    since the round trip runs in a temporary directory where they otherwise would not.

    IMAGE PATHS ARE RESTORED POSITIONALLY, and that is not cosmetic. Pandoc renames media
    on embedding — `media/figure1.svg` goes in and `media/rId83.svg` comes back out — so
    an image path can never be its own fixed point, and a canonical form carrying the
    round trip's names would point at files that do not exist. The trip is trusted for
    the prose and the Nth path is put back, with a count mismatch raising: pandoc losing
    an image is exactly the failure this is here to make impossible.
    """
    require_pandoc()
    before = image_paths(text)
    if resource_path is None and before:
        raise PandocError(
            "this text references images but no resource_path was given, so the round trip "
            "would run in a temporary directory and silently drop every one of them. Pass the "
            "directory the image paths are relative to."
        )
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        src = td / "in.typ"
        src.write_text(text, encoding="utf-8")
        typ_to_docx(src, td / "mid.docx", resource_path=resource_path or td)
        result = docx_to_typ(td / "mid.docx", track_changes="accept")

    after = image_paths(result)
    if len(after) != len(before):
        raise PandocError(
            f"the round trip changed the image count: {len(before)} in, {len(after)} out. "
            f"Refusing to return a body file whose figures do not match its source."
        )
    return set_image_paths(result, before) if before else result


def canonicalize_file(path: Path) -> str:
    path = Path(path)
    return canonicalize_text(
        path.read_text(encoding="utf-8"), resource_path=path.resolve().parent
    )


def canonical_from_docx(
    docx: Path,
    track_changes: str = "accept",
    media_dir: Path | None = None,
    typ_dir: Path | None = None,
) -> str:
    """Canonical Typst for a .docx.

    The recovered Typst is canonicalized again rather than trusted directly: a docx
    that did not come from this pipe (Word's own save, a Google Docs export) can carry
    structure whose first round trip still moves. Idempotence makes the extra pass free
    for a document that was already canonical.

    Embedded images go to `media_dir`, and the emitted `image(...)` paths are made
    relative to `typ_dir` — where the recovered body file will live. A document that has
    images and no `media_dir` RAISES rather than returning text with the figures missing.
    """
    docx = Path(docx)
    with tempfile.TemporaryDirectory() as td:
        staging = Path(td) / "extracted"
        text = docx_to_typ(docx, track_changes=track_changes, extract_media=staging)

        found = image_paths(text)
        if not found:
            return canonicalize_text(text, resource_path=Path(td))

        if media_dir is None:
            raise PandocError(
                f"{docx} embeds {len(found)} image(s). Recovering without somewhere to put them "
                f"would drop every figure and leave the captions orphaned, in a file that looks "
                f"complete. Pass --media-dir DIR (or media_dir=) to name the sidecar directory."
            )

        media_dir = Path(media_dir)
        media_dir.mkdir(parents=True, exist_ok=True)
        anchor = Path(typ_dir).resolve() if typ_dir is not None else Path.cwd()

        rewrites: dict[str, str] = {}
        for ref in dict.fromkeys(found):
            src = (Path(td) / ref) if not Path(ref).is_absolute() else Path(ref)
            if not src.exists():
                raise PandocError(f"pandoc reported image {ref!r} but did not extract it")
            dest = media_dir / src.name
            shutil.copyfile(src, dest)
            rewrites[ref] = os.path.relpath(dest.resolve(), anchor)

        text = _IMAGE_RE.sub(
            lambda m: f'image("{rewrites.get(m.group("path"), m.group("path"))}"', text
        )
        return canonicalize_text(text, resource_path=anchor)


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
    ap.add_argument("--media-dir", type=Path,
                    help="with --from-docx: sidecar directory for embedded images. Required if "
                         "the document has any — recovering without it drops every figure")
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
            # Images are written relative to wherever the recovered body file lands.
            typ_dir = args.output.resolve().parent if args.output else Path.cwd()
            result = canonical_from_docx(
                args.from_docx, track_changes=args.track_changes,
                media_dir=args.media_dir, typ_dir=typ_dir,
            )
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
            result = canonicalize_text(original, resource_path=args.typ.resolve().parent)
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
