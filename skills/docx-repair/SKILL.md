---
name: docx-repair
description: "Use to REPAIR a .docx damaged by a Google Docs or Word Online round-trip — the package/XML wiring, the footnote markup, leftover content controls, and heading styling. Triggers: 'Word won't open the docx / says it's corrupt', 'Google Docs export broken', 'fix the customXML error', 'recover unreadable content', 'phantom blank page', 'repair this docx'; AND 'footnotes broken after Google Docs', 'supra notes wrong after coauthor edits', 'cross-references point to the wrong footnote', 'bio footnotes show numbers instead of symbols (*, †, ‡)', 'author note shows 1 2 3 not star dagger', 'footnote numbering starts at the wrong number', 'separator line missing', 'doubled footnote marks (**, ††)'; AND 'boxes around text after Google Docs', 'content controls / doubled boxes around paragraphs', 'remove the boxes Word draws around headings', 'heading text isn't styled as a heading', 'headings look different / inconsistent heading formatting', 'blank/empty heading lines'; AND 'clean up Google Docs XML cruft', 'strip redundant run formatting', 'de-bloat docx after Google Docs', 'remove rsid bloat / no-op shading / explicit black' — or converting hardcoded 'supra note N' cross-references to auto-updating NOTEREF fields. Any OOXML-level repair on a .docx edited in a cloud editor, even if the user never says 'OOXML'. NOT for building a docx from markdown (law-review-docx) or exporting to PDF (docx-render)."
user-invocable: false
---

# DOCX Repair (Google Docs / Word Online damage)

Cloud editors damage a `.docx` in **independent ways**. This skill is the front door for all of them; run only the track(s) you need.

| Damage class | Symptom | Fix |
|---|---|---|
| **A. Package / OOXML wiring** | Word pops "recover unreadable content?" or refuses to open; LibreOffice won't load; phantom blank page | `scripts/docx_repair.py` (plugin root) — §[Package repair](#a-package--ooxml-wiring-repair) |
| **B. Footnote & cross-reference markup** | Bios show `1,2,3` not `*,†,‡`; numbering starts wrong; "supra note N" points to the wrong footnote; missing separator line | the footnote scripts — §[Footnote repair](#b-footnote--cross-reference-repair) |
| **C. Document content (boxes + headings + cruft)** | Visible **boxes** around freshly-edited text; heading-looking lines not styled as headings; same-style headings rendering differently; blank heading lines; bloated XML full of all-zero rsids, no-op shading, explicit `b=0`/`i=0`/`u=none`, redundant black color & default fonts | `fix_footnotes.py`'s document.xml passes — §[Content cleanup](#c-document-content-cleanup-boxes--headings--cruft) |

They are decoupled: package repair fixes the **part wiring** (never touches content); footnote repair fixes the **footnote markup**; content cleanup strips Google-Docs leftover content controls and normalizes headings. A file can need any, all, or none. If you don't know which, run the package check first (it's a no-op on a clean package), then the footnote pass (it carries the content cleanup).

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

# 2. Repair footnote markup (separators, styles, bio custom marks, pStyles),
#    strip Google Docs content controls (the "boxes"), AND strip GDocs OOXML
#    cruft (hygiene pass, default-on). --normalize-headings restyles/cleans
#    heading paragraphs; --normalize-body-indent uniforms body indents (see §C).
uv run "$SKILL_DIR/scripts/fix_footnotes.py" returned.docx -o step2.docx \
  --normalize-headings --normalize-body-indent

# 3. Remap stale "supra note N" numbers against the known-good baseline, THEN
#    convert to NOTEREF fields. --baseline is what fixes the coauthor-shift.
uv run "$SKILL_DIR/scripts/create_crossrefs.py" \
  --docx step2.docx --output step3.docx --baseline OLD.docx

# 4. Render with WORD and eyeball it (LibreOffice numbers custom marks wrong).
uv run "$SKILL_DIR/../../scripts/doc_render.py" \
  step3.docx step3.pdf --renderer word --allow-word
```

**Verify in the render:** author bios show `*`, `†`, `‡` (not `1, 2, 3` and not doubled `**`, `††`); the first real footnote is `1`; a remapped reference (e.g. "Kahan & Rock, supra note 8") points to the correct footnote; no boxes around freshly-edited sections; same-level headings render identically. Then in Word, **Ctrl+A, F9** to refresh the NOTEREF display numbers.

### Procedure Facts (incident-grounded)

- **Step 3 must run AFTER step 2.** `create_crossrefs --baseline` counts footnote display numbers the way Word does — skipping the `customMarkFollows` bio marks. Until `fix_footnotes` converts the bios to custom marks, the bios are still numbered `1, 2, 3`, so the alignment is off by the bio count and every remapped number is wrong. Running step 3 first silently mis-targets the cross-references it was supposed to fix.
- **`--baseline` is not optional for the Google Docs case.** Google Docs flattens every NOTEREF field back to hardcoded "supra note N" text, frozen at the prior draft's numbering. After a coauthor inserts/deletes footnotes the offset is *non-uniform*, so `create_crossrefs` without `--baseline` bookmarks by current position and mis-targets ~90% of references — the exact failure this skill exists to prevent.
- **The remap's flagged list is a human cite-check queue, not noise.** `--baseline` prints `⚠ … could NOT be remapped` for references whose footnote content did not align one-to-one (inserts, deletes, densely-similar citation clusters). These are left unchanged on purpose — guessing a target you cannot prove is how a wrong citation ships. Surface the flagged list to the user for manual verification; do not suppress it.
- **Render with Word, never LibreOffice, to verify.** LibreOffice renders `customMarkFollows` numbering wrong (verified 2026-06-10), so bios that are actually correct can look broken — leading you to "fix" something that was right. `doc_render.py --renderer word` (or `x2t`) is ground truth.
- **Bio-mark superscript depends on the `FootnoteReference` *style*, which Google Docs can strip.** Bio ref runs carry `rStyle="FootnoteReference"` but no explicit `vertAlign`; they render superscript only if that style still defines it. A round-trip can strip the superscript out of the style while leaving the reference, so the marks drop to baseline (OPV, 2026-06-28: title-page `*`/`†`/`‡` baseline; regular footnote numbers were fine because they carry *explicit* `vertAlign`). So `_run_has_superscript` only trusts a bare `rStyle="FootnoteReference"` when `_footnote_ref_style_has_superscript(styles_xml)` confirms the style actually defines it; otherwise `fix_bio_superscript` adds explicit `vertAlign`. And `fix_bio_superscript` MUST run **after** `restore_bio_custom_marks` — restore rebuilds the ref runs and would discard a superscript added before it.
- **The `goog_rdk` "boxes" are an on-screen Word artifact — they do NOT export to PDF.** Word draws boundaries around nested content controls in its editor, but neither Word's nor x2t's PDF export renders them. So a "no boxes" PDF is NOT proof the controls were stripped — verify at the XML level (`unzip -p file.docx word/document.xml | grep -c goog_rdk` → `0`). `fix_footnotes.py` reports the strip count; trust that over the render.

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

**Document content cleanup (see §[C](#c-document-content-cleanup-boxes--headings--cruft)):**
- **Content controls (the "boxes")** — unwraps every `<w:sdt>` tagged `goog_rdk*`
  (Google Docs suggestion-mode markers, often 3-deep, that Word draws as boxes),
  replacing each with its `<w:sdtContent>` children. Keeps non-`goog` sdts (real
  controls, the TOC). **Runs by default across all content parts** (document,
  footnotes, comments, headers, footers — not just `document.xml`); idempotent.
- **OOXML hygiene (de-cruft)** — strips redundant off/default run formatting,
  all-zero rsids, no-op shading, black color, and default-font residue across all
  content parts (document, footnotes, comments, headers, footers). Keeps every
  "on" property. **Runs by default** (`--no-hygiene` to skip); idempotent.
- **Heading normalization** (`--normalize-headings`, opt-in) — styles unstyled
  heading-looking paragraphs and strips direct formatting off every heading; see §C.
- **Body indent normalization** (`--normalize-body-indent`, opt-in) — uniforms
  body first-line indents; see §C.

**Flags:**
- `--output` / `-o`: Output path (default: overwrite input)
- `--dry-run`: Show what would change without modifying
- `--bio-footnotes N`: Number of author bio footnotes. Default: **auto-detected** from the document's `customMarkFollows="1"`/`"0"` refs (0 if the paper has no bios); pass N only to override the auto-detect (e.g. a doc where the marks were stripped entirely).
- `--crossrefs`: Chain to create_crossrefs.py after fixing
- `--fix-numbering`: Fix numbering offset from customMarkFollows bio footnotes (adds numRestart, updates NOTEREFs and supra references)
- `--normalize-headings`: Normalize headings (off by default) — style unstyled heading-looking paragraphs (2b) AND strip direct formatting + delete empty heading paragraphs (2a); restores Heading1–4 style defs from the template if missing. See §C.
- `--no-hygiene`: Skip the Google Docs OOXML hygiene pass. Hygiene is **on by default** — strips all-zero rsids, redundant off/default run formatting, no-op shading, black color, and default-font residue across content parts; keeps all "on" formatting. See §C Feature 3.
- `--normalize-body-indent`: Normalize body first-line indents to the document's dominant value — apply it to paragraphs that lack one, AND convert Google Docs **leading-tab indents** (a literal `<w:tab/>` jumping to a tab stop) to real `firstLine` indents (editorial; off by default). See §C.
- `--restyle-body`: Ensure the template's body styles (`Normal`/`BodyText`/…) **exist** and are **applied** — restyle direct-indented body paragraphs to `BodyText` and strip their direct `ind`/`spacing`/`pBdr` so formatting is style-driven, not per-paragraph. Implies the body-indent passes. **Reflows** the document (template spacing). Editorial; off by default. See §C.
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

## C. Document content cleanup (boxes + headings + cruft)

Three content passes carried by `fix_footnotes.py`, for damage that is neither
package wiring nor footnote markup. All are idempotent and ride along with the
canonical procedure's step 2.

### Feature 1 — strip Google Docs content controls (the "boxes") — DEFAULT ON

Google Docs wraps freshly-written / suggestion-mode content in `<w:sdt>` content
controls tagged `goog_rdk_<n>`, often **3-deep**. Word's editor draws the nested
ones as visible **boxes** around the text. The pass unwraps every `goog_rdk` sdt —
replacing it with the children of its `<w:sdtContent>`, looping until none remain —
and **keeps** non-`goog` sdts (real form controls and the TOC's `docPartObj`
wrapper). It runs automatically (no flag); a doc with no `goog_rdk` sdts is a no-op.
Text, footnotes, comments, and tracked changes are preserved verbatim.

**Runs across every content part, not just `document.xml`.** goog_rdk sdts also
live in `footnotes.xml` and `comments.xml` (and could in headers/footers), where
they render as boxes in the footnote/comment area. The strip iterates the same
content-part list as the hygiene pass (document, footnotes, comments, headers,
footers). Verified on OPV: 137 (body) + 104 (footnotes) + 28 (comments) → **0
remaining**, with footnote italics/small-caps/superscripts and footnote count
intact. (Before v5.55.1 only `document.xml` was processed — footnote-area boxes
survived.)

### Feature 2 — heading normalization — OPT-IN (`--normalize-headings`)

Two parts, run in order (2b then 2a) so a newly-styled heading is also formatting-cleaned:

- **2b — style heading-looking paragraphs that aren't headings.** Detects short
  standalone paragraphs that either lead with a section marker (`I.`→Heading1,
  `A.`→Heading2, `1.`→Heading3, `a.`→Heading4, `(a)`→Heading5) or are entirely
  **bold** (→Heading1), and are currently unstyled (pStyle None/Normal). **Guards
  (why it's safe to run on a correct doc):** skips anything already `Heading*` /
  `TOC*` / `Title`; skips Table-of-Contents entries (inside a `docPartObj` sdt, or
  a trailing-page-number row with a hyperlink/tab leader); skips `Abstract` and
  similar front-matter labels.
- **2a — strip direct formatting off every heading.** Google Docs bakes
  per-paragraph formatting into headings, so same-style headings render
  differently. For each `Heading*` paragraph this reduces `<w:pPr>` to only
  `<w:pStyle>` (+ `<w:numPr>` for a *genuine* list heading) and strips `<w:rPr>`
  from every run, then **deletes empty heading paragraphs**. Result: headings
  derive entirely from the style definition.
- **Heading style defs** — restores `Heading1`–`Heading4` definitions from the
  law-review template if a round-trip stripped them (same add-only restore used
  for `FNStyleBest`).

### Feature 3 — Google Docs OOXML hygiene (de-cruft) — DEFAULT ON (`--no-hygiene` to skip)

Google Docs bakes redundant direct formatting into every run. The hygiene pass
strips it across **all content parts** (document, footnotes, comments, headers,
footers — NOT styles.xml/numbering.xml, where an explicit "off" can intentionally
override an inherited "on"). On the raw OPV draft it removed **~33,800 nodes/attrs**
with zero visual change. Rules:

- **A. Strip unconditional no-ops** inside `<w:rPr>`: explicit-off toggles
  (`<w:b w:val="0"/>`, `i`, `bCs`, `iCs`, `strike`, `dstrike`, `smallCaps`,
  `caps`, `emboss`, `imprint`, `outline`, `vanish`), `<w:u w:val="none"/>`,
  `<w:vertAlign w:val="baseline"/>`, `<w:rtl w:val="0"/>`; no-op
  `<w:shd w:val="clear">` (auto fill/color) anywhere; all-zero rsid attributes
  (`w:rsid*="00000000"` — the GDocs signature; real Word rsids are non-zero).
- **B. Strip only when it matches the default:** `<w:color w:val="000000"/>`
  (black); `<w:rFonts>` that names **only** the default body font (read from
  `docDefaults`, e.g. Garamond). Emptied `<w:rPr>`/`<w:pPr>` are then removed.
- **CRITICAL — keep every "on" property:** bold/italic on (`<w:b/>`, `w:val="1"`),
  real underline, `smallCaps=1`, super/subscript, non-black color, non-default
  fonts (Symbol for the `*` glyph, intentional Arial/Times). Verified preserved:
  italic case names, small-caps citations, and footnote superscripts all survive
  byte-identically to a `--no-hygiene` run.

**Body indent normalization** (`--normalize-body-indent`, opt-in, editorial) —
normalizes body first-line indents to the document's dominant value (mode of
`<w:ind firstLine>` on Normal/unstyled body paras; `firstLine=360` in OPV). Two
things, both under this flag:
- **Lacking-indent paras** — apply the dominant `firstLine` to paragraphs that
  have none. Front-matter guard: only unstyled paras >60 chars **after the first
  Heading1** (title/abstract/TOC excluded).
- **Leading-tab indents** (Google Docs damage) — Google Docs sometimes drops a
  paragraph's `<w:ind firstLine>` and instead inserts a **literal leading
  `<w:tab/>`** so the first line jumps to a `docDefaults` tab stop (≈0.47" in
  OPV). Those paragraphs render **over-indented** next to neighbours that use a
  real firstLine (the "this body paragraph is indented further than the others"
  bug — found under OPV's `b.` subsection: the body under it sat at ~0.5" while
  the rest were at 0.25"). The pass strips the leading tab (the FIRST content
  child of the first run; a tab elsewhere is a real tab, left alone) and sets
  `firstLine=<dominant>`. Detected as `leading_tab_indent(N)` in `detect_issues`
  even without the flag; fixed only when `--normalize-body-indent` is passed.
  Idempotent. Same >60-char Normal/unstyled guard, AND the same front-matter
  guard (only paragraphs after the first Heading1) — title/abstract/TOC are
  never touched. If tab-led paragraphs exist but the document has no real
  firstLine indent anywhere to infer the dominant value from, this does not
  silently no-op: it emits a WARNING change entry so the unfixed issue still
  surfaces in the log.

Logged, never silent.

### Feature 4 — apply the template's body styles — OPT-IN (`--restyle-body`)

The deepest form of the body-indent problem: a Google Docs round-trip **strips the
`Normal`/`BodyText` style definitions** (Normal comes back empty) and **bakes the
body formatting into every paragraph** as direct `spacing`+`ind firstLine` (+ a
no-op `pBdr`). Headings and indents can *look* right, but nothing is style-driven —
so the moment one paragraph loses its override (or grows a leading tab), it renders
inconsistently (the OPV `b.` case: 16 paras at ~0.5" vs the rest at 0.25"). Patching
indents one-by-one treats the symptom; the cure is to put the formatting back in the
style. This pass:

1. **Restores** the template's `Normal` (replacing the stripped/empty one) plus
   `BodyText` / `BodyTextFirstIndent` / `FirstParagraph` and their linked `*Char`
   styles (via `ensure_footnote_styles`, add-only for the deps).
2. **Applies** `BodyText` to every Normal/unstyled body paragraph that carries a
   direct first-line indent (skips `left`/`hanging`-indented paras — block quotes),
   stripping the now-redundant direct `ind`/`spacing`/`pBdr`. Empty paragraphs keep
   their style but lose the stray direct indent.

Detected as `unstyled_body_indent(N)` in `detect_issues` even without the flag.
**Reflows the document** (BodyText carries the template's `line`/`after` spacing —
e.g. OPV went 63→68 pp), so it is OPT-IN and editorial. Runs *after* the indent
passes (so tab-led / indent-lacking paras already have a real firstLine to convert).
Idempotent. Verified on OPV: 250 `unstyled_body_indent` → 261 paras moved to
`BodyText`, 0 direct firstLine remaining, footnotes/comments/tracked-changes intact.

### Content-cleanup Facts (incident-grounded)

- **A heading whose text starts with a literal marker (`a. …`, `1. …`) must NOT
  keep a `numPr`.** 2a keeps `numPr` only for a *genuine* list heading (number
  auto-generated, no literal marker in the text). On the OPV baseline, `a. Pure
  Robo-Voting` carried a leftover Google Docs `numPr` while its siblings did not —
  keeping it would render a **doubled** marker ("1. a. Pure Robo-Voting") and the
  three sibling headings would not match. Dropping it makes `a.`/`b.`/`c.`
  resolve to identical `<w:pPr><w:pStyle w:val="Heading4"/></w:pPr>`.
- **2b's regression case is "no false restyling," not "no change."** On a doc
  whose body headings are already styled (the OPV deliverable), 2b must report
  zero restyles — its only unstyled "heading-looking" paragraphs are TOC entries
  and `Abstract`, all excluded. 2a still changes that doc (it normalizes the
  already-styled headings); only 2b is the no-false-positive guard. Confusing the
  two leads to "fixing" guards that were working.
- **The `goog_rdk` boxes do not export to PDF — verify removal in the XML.** See
  the Procedure Fact above: a clean PDF is not proof. Check **every content part**,
  not just the body: `for p in document footnotes comments; do unzip -p f.docx
  word/$p.xml | grep -c goog_rdk; done` → all `0`.
- **`goog_rdk` content controls live in `footnotes.xml` and `comments.xml`, not
  only `document.xml`.** The v5.54.0 strip processed the body alone, so 104
  footnote + 28 comment controls survived and rendered as boxes in the footnote
  area of the OPV regen (found in production). The strip now iterates the same
  content-part list as the hygiene pass. A part-scoped cleanup that hard-codes
  `document.xml` will silently miss footnote/comment damage — scope both passes to
  the shared `is_hygiene_part` list.
- **Hygiene never touches styles.xml or numbering.xml.** An explicit "off" toggle
  (`<w:b w:val="0"/>`) inside a *style definition* can intentionally override an
  inherited "on" from its `basedOn` parent — stripping it there changes rendering.
  In run-level direct formatting it is pure GDocs cruft. The pass is scoped to
  content parts only; the audit's count came almost entirely from there anyway.
- **Hygiene strips only explicit-off / default values, never bare or "on".** A
  bare `<w:b/>` means bold-ON; `<w:vertAlign w:val="superscript"/>` is a real
  footnote mark; `<w:rFonts w:ascii="Symbol"/>` carries the `*` glyph. Stripping
  by tag name (rather than value) would silently kill italic case names,
  small-caps citations, and superscripts — the exact content this pass must keep.
  The compressed `.docx` shrinks only modestly (cruft is repetitive, compresses
  well); the uncompressed XML shrinks dramatically — judge the win by node count.

## Related (document skill group)

This skill owns the **REPAIR** stage — package wiring (Track A), footnote
markup (Track B), and document-content cleanup (Track C) — for a `.docx` damaged
by a cloud editor. Adjacent stages:

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
