---
name: docx-footnotes
description: "This skill should be used when 'fix Google Docs footnotes', 'Word Online broke formatting', 'repair footnote styles', 'fix cloud editor OOXML damage', 'missing separator footnotes', 'stripped pStyles', 'broken custom marks', 'customMarkFollows', 'convert supra note cross-references', 'NOTEREF field codes', 'fix footnote formatting', or when repairing DOCX footnote damage caused by web-based editors."
---

# DOCX Footnote Repair & Cross-References

Fix footnote formatting damage caused by Google Docs and Word Online, and convert hardcoded supra note references to NOTEREF field codes.

## Quick Start

```bash
# Fix all cloud editor damage + convert cross-references
pixi exec --spec python=3.13 --spec lxml -- python3 \
  scripts/fix_gdocs_footnotes.py path/to/file.docx --crossrefs

# Dry run (show what would change)
pixi exec --spec python=3.13 --spec lxml -- python3 \
  scripts/fix_gdocs_footnotes.py path/to/file.docx --dry-run

# Cross-references only (requires unpacked docx)
pixi exec --spec python=3.13 --spec lxml -- python3 \
  scripts/create_crossrefs.py --docx path/to/file.docx
```

## Scripts

### fix_gdocs_footnotes.py

Detects and repairs OOXML damage from Google Docs / Word Online round-trips. Idempotent.

**What it fixes:**
- Missing separator/continuation footnotes (id=-1, 0)
- Custom mark restoration for author bio footnotes (*, dagger, double-dagger)
- Footnote ID renumbering (shifted by missing system footnotes)
- Missing paragraph styles (adds configurable pStyle to all footnotes)
- TOC separator paragraph inflation (shrinks to near-zero height)

**Flags:**
- `--output` / `-o`: Output path (default: overwrite input)
- `--dry-run`: Show what would change without modifying
- `--bio-footnotes N`: Number of author bio footnotes (default: 3)
- `--crossrefs`: Chain to create_crossrefs.py after fixing

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
