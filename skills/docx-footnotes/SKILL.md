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

# Refresh stale NOTEREF cross-ref numbers after a coauthor inserted/moved
# footnotes in Word (render-based, ground-truth; needs x2t or LibreOffice)
"$SKILL_DIR/scripts/refresh_noteref_caches.py" path/to/file.docx --verify
```

**Which script do I want?**
- Footnotes look broken after a **Google Docs / Word Online** round-trip (missing separators, wrong styles, mark/number mix-ups) → **`fix_footnotes.py`**.
- The doc still has **hardcoded** "supra note 42" **text** that should become auto-updating fields → **`create_crossrefs.py`**.
- The doc **already uses NOTEREF fields** but a coauthor **inserted/moved/deleted footnotes in Word** and the cross-reference **numbers are now wrong** → **`refresh_noteref_caches.py`** (this is the common "Nadya emailed back tracked edits and the numbering is off" case).

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

### refresh_noteref_caches.py

Refreshes the cached numbers on existing `NOTEREF` cross-reference fields after
footnotes were inserted/moved/deleted in Word. Use when cross-references already
ARE fields (not hardcoded text) but their numbers went stale.

**Why the naive approaches fail (and this script's method):**
- The offset is **not uniform** — `+N to everything` is wrong.
- Computing numbering from `document.xml` order is wrong: the 3 `customMarkFollows`
  author-bio footnotes are **not** counted in the numeric sequence, and a tracked
  footnote **move** makes XML order diverge from rendered order.
- LibreOffice's **inline cross-ref render lies** — it always recomputes NOTEREF on
  load and **excludes unaccepted tracked-inserted footnotes**, so it shows xrefs
  ~2 low even though it numbers the page-bottom markers correctly.

So the script uses the **rendered page-bottom footnote markers as ground truth**:
render → extract markers → fingerprint-match each footnote to its true marker
(longest-common-prefix, one-to-one, most-distinctive first) → set every NOTEREF
cache to its target's marker. It also repairs NOTEREF field codes left dangling by
Word's **40-char bookmark-name truncation** (`_RefBib_...2024` → the real
`_RefBib_...20`). It deliberately does **not** add `updateFields` (that re-triggers
the buggy recompute). Verify with a **changes-accepted** render — once inserts are
accepted every engine agrees and the inline xrefs render correctly.

**Requires:** ONLYOFFICE `x2t` (preferred; `onlyoffice-x2t` nix package) or
LibreOffice (`soffice`) as fallback, plus `pymupdf` (auto-installed via the inline
script deps; run the file directly, e.g. `./refresh_noteref_caches.py file.docx`).

**Flags:**
- `-o` / `--output`: Output path (default: overwrite input)
- `--dry-run`: Report the cache changes without writing
- `--verify`: Also emit a changes-accepted `*_ACCEPTED_preview.pdf` proof
- `--soffice PATH`: Path to the LibreOffice binary, used only when `x2t` is not on PATH (auto-discovered if omitted)

**Scope (intentional):** refreshes numbers only. It does **not** do editorial
retargeting (e.g. "this xref should point to notes 210–212 instead of its current
target"). That is a human decision — move the bookmark / change the NOTEREF target
first, then re-run this to refresh.

## Reference

See [`footnotes-reference.md`](footnotes-reference.md) for detailed technical reference covering:
1. Run-level editing gotchas (NBSP, cross-run matching, xml:space)
2. Cloud editor damage patterns (what gets destroyed and why)
3. Direct ZIP surgery patterns (bypassing Document libraries)

### Footnote Numbering Offset Fix

When author bio footnotes use `customMarkFollows` (*, †, ‡), they consume auto-numbers 1–3, causing body footnotes to start at 4. Fix by adding `numRestart=eachSect` to `settings.xml` and updating NOTEREF cached values.

**Requires:** A section break between title page and body. Render PDF with **Word** or **x2t** (`scripts/doc_render.py` at plugin root) — both honor numRestart; **LibreOffice does not** (renders restart numbering wrong; verified 2026-06-10, x2t restarts at 1 per section where soffice numbers continuously).

See [`footnotes-reference.md`](footnotes-reference.md) § 4 for details, code patterns, and the critical rule: numRestart goes in `settings.xml` ONLY (not in sectPr — causes all-zeros).

## Related (document skill group)

This skill repairs footnote **markup**. It is a separate concern from **OOXML
package repair** (`scripts/docx_repair.py` — fixes the case-broken `customXML`
part paths a Google Docs export emits, which make Word refuse to open the file)
and from **PDF export** (`scripts/doc_render.py`). See the full
[document skill group](../../references/document-skills.md).
