#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["lxml"]
# ///
"""Build a styled, provenance-stamped .docx from a Typst body file.

BUILD AND STAMP ARE ONE STEP, ON PURPOSE

The stamp is what makes a returned document reconcilable: it records which source
revision the coauthor was editing, so their edits and the repo's edits have a common
ancestor. A stamp the caller can forget to apply is worse than no stamp, because the
gap is only discovered months later when the document comes back and the ancestor is
gone. So there is no `--no-stamp`: one invocation produces a stamped docx or fails.

WHY THE BODY LINT IS A HARD ERROR

Pandoc evaluates show rules in the file it reads, so a `#show heading: ...` in the body
turns `= Introduction` into a bold paragraph BEFORE the docx is written. The build
still succeeds; the docx just has no headings, and nobody notices until Word's
navigation pane is empty. That is a silent-corruption failure mode, so it stops the
build. `--allow-styling` exists for the rare deliberate case and says so in the output.

THE main.typ / body.typ SPLIT

    main.typ    #import / #let / #show / #set, then #include "body.typ"   <- typst compile
    body.typ    pure markup, no directives                                <- pandoc reads this

Typst compiles `main.typ` for the PDF; pandoc reads `body.typ` for Word. Both see the
same prose, and neither path degrades the other.

Usage:
    build.py body.typ --output paper.docx
    build.py body.typ --output paper.docx --reference-doc ../writing-legal/templates/law_review_template.docx
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import provenance
from canonicalize import (
    PandocError,
    canonicalize_text,
    lint_body,
    typ_to_docx,
)


def build(
    typ: Path,
    output: Path,
    reference_doc: Path | None = None,
    allow_styling: bool = False,
) -> dict:
    """Convert `typ` to `output` and stamp its provenance. Returns the stamped properties."""
    typ = Path(typ)
    output = Path(output)
    text = typ.read_text(encoding="utf-8")

    if not allow_styling:
        problems = lint_body(text, str(typ))
        if problems:
            raise ValueError(
                "styling directives in the body file would silently destroy headings:\n  "
                + "\n  ".join(problems)
                + "\nMove them into main.typ, or pass --allow-styling if this is deliberate."
            )

    output.parent.mkdir(parents=True, exist_ok=True)
    typ_to_docx(typ, output, reference_doc=reference_doc)

    props = provenance.source_properties(typ)
    # `resource_path` is the body file's own directory: the canonical-form check runs the
    # round trip in a temp dir, where a relative `image(...)` would otherwise resolve to
    # nothing and pandoc would report the file non-canonical because its figures vanished.
    props["Canonical"] = (
        "yes" if text == canonicalize_text(text, resource_path=typ.resolve().parent) else "no"
    )
    provenance.stamp(output, props)
    return props


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("typ", type=Path, help="Typst body file (pure markup)")
    ap.add_argument("--output", "-o", type=Path, required=True, help="output .docx")
    ap.add_argument("--reference-doc", type=Path,
                    help="a .docx whose styles the output adopts (Heading1, FirstParagraph, ...)")
    ap.add_argument("--allow-styling", action="store_true",
                    help="build even though the body carries #show/#set/#let/#import")

    args = ap.parse_args(argv)

    if args.reference_doc and not args.reference_doc.exists():
        print(f"error: reference doc not found: {args.reference_doc}", file=sys.stderr)
        return 2

    try:
        props = build(args.typ, args.output, args.reference_doc, args.allow_styling)
    except (ValueError, PandocError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    if props.get("Canonical") == "no":
        print(
            f"note: {args.typ} is not at its canonical fixed point. The docx is correct, but "
            f"reconciling the returned file will show cosmetic churn. Run "
            f"`canonicalize.py {args.typ} --in-place` and commit before sending.",
            file=sys.stderr,
        )

    print(json.dumps({"output": str(args.output), "provenance": props}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
