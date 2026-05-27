---
name: docx-footnotes
description: "Use when DOCX footnotes are broken after Google Docs or Word Online round-trips, when converting hardcoded 'supra note N' cross-references to auto-updating NOTEREF fields, or for any OOXML-level footnote surgery on a Word document — even if the user doesn't say 'OOXML' but describes footnote formatting problems in a .docx edited in a cloud editor."
user-invocable: false
---

# DOCX Footnote Repair & Cross-References

Fix footnote formatting damage caused by Google Docs and Word Online, and convert hardcoded supra note references to NOTEREF field codes.

## When This Applies

Common symptoms in `.docx` files round-tripped through Google Docs or Word Online:

- Missing footnote separator lines
- Stripped paragraph styles (pStyle) on footnote bodies
- Stripped style *definitions* (`FNStyleBest` etc.) — the pStyle reference points at an undefined style and Word silently falls back to Normal
- Author bio custom marks (`*`, `†`, `‡`) replaced with numbers
- Footnote numbering starting at the wrong number (offset from `customMarkFollows` bio footnotes)
- TOC separator paragraphs that inflate to fill a whole page
- Hardcoded "supra note N" / "infra note N" references that need to become auto-updating NOTEREF fields

## Quick Start

Scripts are in this skill's `scripts/` directory. Use `$SKILL_DIR` below as a placeholder for the absolute path to this skill (the directory containing this SKILL.md).

```bash
# Fix all cloud editor damage + convert cross-references
uv run --with lxml python3 \
  "$SKILL_DIR/scripts/fix_footnotes.py" path/to/file.docx --crossrefs

# Dry run (show what would change)
uv run --with lxml python3 \
  "$SKILL_DIR/scripts/fix_footnotes.py" path/to/file.docx --dry-run

# Cross-references only
uv run --with lxml python3 \
  "$SKILL_DIR/scripts/create_crossrefs.py" --docx path/to/file.docx
```

## Scripts

### fix_footnotes.py

Detects and repairs OOXML footnote damage. Handles multiple sources. Idempotent.

**Google Docs / Word Online round-trip damage:**
- Missing separator/continuation footnotes (id=-1, 0)
- Custom mark restoration for author bio footnotes (*, dagger, double-dagger)
- Footnote ID renumbering (shifted by missing system footnotes)
- Missing paragraph styles (adds configurable pStyle to all footnotes)
- Wrong paragraph styles — reassigns `pStyle="FootnoteText"` (the Google Docs
  default) to `FNStyleBest` on every footnote paragraph so the whole doc
  uses the canonical law-review style.
- Missing style *definitions* — restores `FNStyleBest` (and the basedOn/link
  styles it depends on) from the canonical law-review reference template when
  a round-trip stripped them from `styles.xml`. The template is the same
  `writing-legal/templates/law_review_template.docx` that `law-review-docx`'s
  `build_docx.py` feeds to pandoc, so style definitions stay consistent.
- Mutated style *definitions* — when the `FNStyleBest` /
  `FNStyleBestChar` block survives the round-trip but picks up Google Docs
  hyperlink-renderer residue (link-blue underline color `<w:u w:color="0077CC"/>`
  or white paragraph shading), the whole block is replaced from the template.
- TOC separator paragraph inflation (shrinks to near-zero height)

**Pandoc-citeproc wrap parens:**
- Strips the `  (...)` wrapper pandoc adds around mid-footnote bracketed
  citations while preserving author-written explanatory parentheticals
  (which lack the double-whitespace XML signature).

**Flags:**
- `--output` / `-o`: Output path (default: overwrite input)
- `--dry-run`: Show what would change without modifying
- `--bio-footnotes N`: Number of author bio footnotes (default: 3)
- `--crossrefs`: Chain to create_crossrefs.py after fixing
- `--fix-numbering`: Fix numbering offset from customMarkFollows bio footnotes (adds numRestart, updates NOTEREFs and supra references)
- `--template PATH`: Reference template (.docx) to restore missing footnote style definitions from (default: bundled `writing-legal/templates/law_review_template.docx`)

### create_crossrefs.py

Converts hardcoded "supra note N" references to NOTEREF field codes that auto-update.

**What it does:**
- Finds all `supra note <number>` patterns in document body and footnotes
- Creates bookmark targets on referenced footnotes
- Replaces hardcoded numbers with `NOTEREF _RefFN<id> \h` field codes
- Preserves italic formatting on "supra"

## Reference

See [`footnotes-reference.md`](footnotes-reference.md) for detailed technical reference covering:
1. Run-level editing gotchas (NBSP, cross-run matching, xml:space)
2. Cloud editor damage patterns (what gets destroyed and why)
3. Direct ZIP surgery patterns (bypassing Document libraries)

### Footnote Numbering Offset Fix

When author bio footnotes use `customMarkFollows` (*, †, ‡), they consume auto-numbers 1–3, causing body footnotes to start at 4. Fix by adding `numRestart=eachSect` to `settings.xml` and updating NOTEREF cached values.

**Requires:** A section break between title page and body. Must use **Word** (not LibreOffice) for PDF — LibreOffice renders numRestart as zeros.

See [`footnotes-reference.md`](footnotes-reference.md) § 4 for details, code patterns, and the critical rule: numRestart goes in `settings.xml` ONLY (not in sectPr — causes all-zeros).
