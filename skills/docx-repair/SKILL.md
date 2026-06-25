---
name: docx-repair
description: "Use to REPAIR a .docx damaged by a Google Docs or Word Online round-trip — both the package/XML wiring and the footnote markup. Triggers: 'Word won't open the docx / says it's corrupt', 'Google Docs export broken', 'fix the customXML error', 'recover unreadable content', 'phantom blank page', 'repair this docx'; AND 'footnotes broken after Google Docs', 'supra notes wrong after coauthor edits', 'cross-references point to the wrong footnote', 'bio footnotes show numbers instead of symbols (*, †, ‡)', 'author note shows 1 2 3 not star dagger', 'footnote numbering starts at the wrong number', 'separator line missing', 'doubled footnote marks (**, ††)' — or converting hardcoded 'supra note N' cross-references to auto-updating NOTEREF fields. Any OOXML-level repair on a .docx edited in a cloud editor, even if the user never says 'OOXML'. NOT for building a docx from markdown (law-review-docx) or exporting to PDF (docx-render)."
user-invocable: false
---

# DOCX Repair (Google Docs / Word Online damage)

Cloud editors damage a `.docx` in **two independent ways**. This skill is the front door for both; run only the track(s) you need.

| Damage class | Symptom | Fix |
|---|---|---|
| **A. Package / OOXML wiring** | Word pops "recover unreadable content?" or refuses to open; LibreOffice won't load; phantom blank page | `scripts/docx_repair.py` (plugin root) — §[Package repair](#a-package--ooxml-wiring-repair) |
| **B. Footnote & cross-reference markup** | Bios show `1,2,3` not `*,†,‡`; numbering starts wrong; "supra note N" points to the wrong footnote; missing separator line | the footnote scripts — §[Footnote repair](#b-footnote--cross-reference-repair) |

They are decoupled: package repair fixes the **part wiring** (never touches content); footnote repair fixes the **footnote markup**. A file can need either, both, or neither. If you don't know which, run the package check first (it's a no-op on a clean package), then the footnote pass.

> Heads-up: `docx-render`'s Word path already composes `docx_repair.py` as a preflight, so a Google export "just renders" without a manual Track A. Run Track A manually when you need the *repaired file itself* (to hand back, edit, or footnote-fix), not just a PDF.

---

## A. Package / OOXML wiring repair

Google Docs' `.docx` export emits OOXML that strict consumers reject while lenient ones (x2t) accept. Two recurring, concrete defects:

1. **Case-mismatched OPC part references** — the export spells the folder `customXML` (capital) in `document.xml.rels` and `[Content_Types].xml` but stores the part as `customXml` (lowercase). OPC part names are **case-sensitive**, so the part is unreferenced/untyped → Word says the document is corrupt.
2. **`<w:evenAndOddHeaders/>` left in `settings.xml`** → Word renders phantom blank pages.

`scripts/docx_repair.py` (at plugin root — it's a shared library `doc_render.py` composes, so it lives there, not in this skill's `scripts/`) fixes both, cheapest-first: case-normalize part references → drop the Word-breaking directive → if still structurally broken, reserialize via ONLYOFFICE docbuilder (clean OOXML, watermark-free, at the cost of a re-layout; opt out with `--no-reserialize`).

```bash
# CLI — detect + repair (in-place if dirty)
python3 "$SKILL_DIR/../../scripts/docx_repair.py" returned.docx fixed.docx
python3 "$SKILL_DIR/../../scripts/docx_repair.py" returned.docx --dry-run   # report only
```
```python
import sys; sys.path.insert(0, "<plugin>/scripts")
from docx_repair import repair_docx, opc_integrity_issues
issues = opc_integrity_issues("returned.docx")   # [] = clean
repair_docx("returned.docx", "fixed.docx")        # -> RepairResult
```

Detail and the root-cause investigation: `docs/investigations/2026-06-23_gdocs-customxml-case.md`.

---

## B. Footnote & cross-reference repair

Fix footnote formatting damage and convert hardcoded supra-note references to NOTEREF field codes.

### Canonical Procedure — Google Docs round-trip

A law-review draft that round-trips through **Google Docs** every editing round (the OPV/Nadya case) comes back with both formatting damage AND stale cross-reference numbers. Run these **in this exact order** on the returned `.docx`. Use `$SKILL_DIR` for the absolute path to this skill's directory and keep the last-known-good draft as `OLD.docx`.

```bash
# 1. Accept tracked changes first (the coauthor's edits). Numbering and the
#    baseline remap both assume the FINAL accepted text. (Word: Review →
#    Accept All; or the document skill's accept-changes path.)

# 2. Repair footnote markup (separators, styles, bio custom marks, pStyles).
uv run "$SKILL_DIR/scripts/fix_footnotes.py" returned.docx -o step2.docx

# 3. Remap stale "supra note N" numbers against the known-good baseline, THEN
#    convert to NOTEREF fields. --baseline is what fixes the coauthor-shift.
uv run "$SKILL_DIR/scripts/create_crossrefs.py" \
  --docx step2.docx --output step3.docx --baseline OLD.docx

# 4. Render with WORD and eyeball it (LibreOffice numbers custom marks wrong).
uv run "$SKILL_DIR/../../scripts/doc_render.py" \
  step3.docx step3.pdf --renderer word --allow-word
```

**Verify in the render:** author bios show `*`, `†`, `‡` (not `1, 2, 3` and not doubled `**`, `††`); the first real footnote is `1`; a remapped reference (e.g. "Kahan & Rock, supra note 8") points to the correct footnote. Then in Word, **Ctrl+A, F9** to refresh the NOTEREF display numbers.

### Procedure Facts (incident-grounded)

- **Step 3 must run AFTER step 2.** `create_crossrefs --baseline` counts footnote display numbers the way Word does — skipping the `customMarkFollows` bio marks. Until `fix_footnotes` converts the bios to custom marks, the bios are still numbered `1, 2, 3`, so the alignment is off by the bio count and every remapped number is wrong. Running step 3 first silently mis-targets the cross-references it was supposed to fix.
- **`--baseline` is not optional for the Google Docs case.** Google Docs flattens every NOTEREF field back to hardcoded "supra note N" text, frozen at the prior draft's numbering. After a coauthor inserts/deletes footnotes the offset is *non-uniform*, so `create_crossrefs` without `--baseline` bookmarks by current position and mis-targets ~90% of references — the exact failure this skill exists to prevent.
- **The remap's flagged list is a human cite-check queue, not noise.** `--baseline` prints `⚠ … could NOT be remapped` for references whose footnote content did not align one-to-one (inserts, deletes, densely-similar citation clusters). These are left unchanged on purpose — guessing a target you cannot prove is how a wrong citation ships. Surface the flagged list to the user for manual verification; do not suppress it.
- **Render with Word, never LibreOffice, to verify.** LibreOffice renders `customMarkFollows` numbering wrong (verified 2026-06-10), so bios that are actually correct can look broken — leading you to "fix" something that was right. `doc_render.py --renderer word` (or `x2t`) is ground truth.

### When footnote repair applies

Common footnote symptoms in `.docx` files round-tripped through Google Docs or Word Online:

- Missing footnote separator lines
- Stripped paragraph styles (pStyle) on footnote bodies
- Stripped style *definitions* (`FNStyleBest` etc.) — the pStyle reference points at an undefined style and Word silently falls back to Normal
- Author bio custom marks (`*`, `†`, `‡`) replaced with numbers, or rendered **doubled** (`**`, `††`) when Google Docs welded the literal mark onto adjacent text
- Footnote numbering starting at the wrong number (offset from `customMarkFollows` bio footnotes)
- "supra note N" cross-references pointing to the **wrong footnote** after a coauthor inserted/deleted footnotes (numbers frozen by a Google Docs NOTEREF flatten)
- TOC separator paragraphs that inflate to fill a whole page
- Hardcoded "supra note N" / "infra note N" references that need to become auto-updating NOTEREF fields

### Footnote scripts — quick start

Scripts are in this skill's `scripts/` directory. Use `$SKILL_DIR` below as a placeholder for the absolute path to this skill (the directory containing this SKILL.md). Each script carries PEP 723 inline metadata, so `uv run script.py` auto-installs `lxml` — no `--with lxml` needed.

For the full **Google Docs round-trip**, follow the [Canonical Procedure](#canonical-procedure--google-docs-round-trip) above (it chains these in the required order). Individual scripts:

```bash
# Dry run (show what would change)
uv run "$SKILL_DIR/scripts/fix_footnotes.py" path/to/file.docx --dry-run

# Fix cloud-editor footnote damage
uv run "$SKILL_DIR/scripts/fix_footnotes.py" path/to/file.docx -o fixed.docx

# Convert cross-references, remapping stale numbers against a known-good baseline
uv run "$SKILL_DIR/scripts/create_crossrefs.py" \
  --docx fixed.docx --baseline OLD.docx

# Refresh stale NOTEREF cross-ref numbers after a coauthor inserted/moved
# footnotes in Word (render-based, ground-truth; needs x2t or LibreOffice)
"$SKILL_DIR/scripts/refresh_noteref_caches.py" path/to/file.docx --verify
```

**Which script do I want?**
- Footnotes look broken after a **Google Docs / Word Online** round-trip (missing separators, wrong styles, bios numbered or doubled, mark/number mix-ups) → **`fix_footnotes.py`**.
- The doc still has **hardcoded** "supra note 42" **text** that should become auto-updating fields → **`create_crossrefs.py`** (add **`--baseline OLD.docx`** when the numbers went stale through a Google Docs round-trip).
- The doc **already uses NOTEREF fields** but a coauthor **inserted/moved/deleted footnotes in Word** and the cross-reference **numbers are now wrong** → **`refresh_noteref_caches.py`** (this is the common "Nadya emailed back tracked edits and the numbering is off" case).

### Footnote scripts (detail)

#### fix_footnotes.py

Detects and repairs OOXML footnote damage. Handles multiple sources. Idempotent.

**Google Docs / Word Online round-trip damage:**
- Missing separator/continuation footnotes (id=-1, 0)
- Custom mark restoration for author bio footnotes (`*`, `†`, `‡`). Handles
  **both** round-trip flavors: Word Online (symbol kept in a separate run) and
  Google Docs (symbol run **deleted** and the literal mark **welded** onto the
  adjacent text — e.g. `<w:t>* Nadya Malenko</w:t>`). A position-based lxml pass
  forces the first `--bio-footnotes` references and their footnote bodies into
  the canonical custom-mark shape and strips the welded literal so the mark does
  not render doubled (`**`, `††`). Idempotent.
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

#### create_crossrefs.py

Converts hardcoded "supra note N" references to NOTEREF field codes that auto-update.

**What it does:**
- Finds all `supra note <number>` patterns in document body and footnotes
- Creates bookmark targets on referenced footnotes
- Replaces hardcoded numbers with `NOTEREF _RefFN<id> \h` field codes
- Preserves italic formatting on "supra"

**`--baseline OLD.docx` — remap stale numbers before converting (the coauthor-shift fix):**

When a coauthor edited the draft in Google Docs, every NOTEREF field came back as
hardcoded "supra note N" text frozen at the *prior* draft's numbering. After
footnotes are inserted/deleted the offset is non-uniform, so converting those
numbers as-is mis-targets ~90% of references. `--baseline` aligns the baseline
and current footnote **sequences by letter-only content fingerprint** (difflib)
and rewrites each stale number to its current value **before** conversion. The
remap is cross-run aware ("supra" is its own italic run; the number lives in a
following run). References whose footnote content does not align one-to-one
(inserts, deletes, densely-similar clusters) are **flagged for human cite-check,
never guessed**. Run this *after* `fix_footnotes.py` (so bio custom marks are
already excluded from the count).

**Flags:**
- `--docx`: Input DOCX (required)
- `--output`: Output path (default: overwrite input)
- `--dry-run`: Report changes without writing
- `--baseline OLD.docx`: Known-good prior draft whose "supra note N" numbering is
  correct; remaps stale numbers to current numbering by content-identity alignment

#### refresh_noteref_caches.py

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

### Footnote reference

See [`footnotes-reference.md`](footnotes-reference.md) for detailed technical reference covering:
1. Run-level editing gotchas (NBSP, cross-run matching, xml:space)
2. Cloud editor damage patterns (what gets destroyed and why)
3. Direct ZIP surgery patterns (bypassing Document libraries)

#### Footnote Numbering Offset Fix

When author bio footnotes use `customMarkFollows` (*, †, ‡), they consume auto-numbers 1–3, causing body footnotes to start at 4. Fix by adding `numRestart=eachSect` to `settings.xml` and updating NOTEREF cached values.

**Requires:** A section break between title page and body. Render PDF with **Word** or **x2t** (`scripts/doc_render.py` at plugin root) — both honor numRestart; **LibreOffice does not** (renders restart numbering wrong; verified 2026-06-10, x2t restarts at 1 per section where soffice numbers continuously).

See [`footnotes-reference.md`](footnotes-reference.md) § 4 for details, code patterns, and the critical rule: numRestart goes in `settings.xml` ONLY (not in sectPr — causes all-zeros).

## Related (document skill group)

This skill owns the **REPAIR** stage — both package wiring (Track A) and footnote
markup (Track B) — for a `.docx` damaged by a cloud editor. Adjacent stages:

- **Build** a styled `.docx` from markdown → `law-review-docx` (its `build_docx.py`
  chains this skill's footnote repair + NOTEREF conversion after the pandoc build).
- **Render** to PDF/PNG → `docx-render` / `scripts/doc_render.py` (Word path composes
  Track A's `docx_repair.py` as a preflight automatically).
- **Footnote repair lives only here.** `fix_footnotes.py` is the single canonical
  Google-Docs / Word-Online footnote fixer; there is no second copy. (Bluebook's
  `create_crossrefs.py` + `audit_crossref_targets.py` remain a deliberate,
  actively-used *cross-reference* fork with their own retargeting strategy — a
  different concern, not a footnote-fix duplicate.)

See the full [document skill group](../../references/document-skills.md).
