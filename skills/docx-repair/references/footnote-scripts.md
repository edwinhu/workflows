# B. Footnote & cross-reference repair — scripts in detail


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
  `references/templates/law_review_template.docx` that `law-review-docx`'s
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

**Document content cleanup (see §[C](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/content-cleanup.md)):**
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
- `--template PATH`: Reference template (.docx) to restore missing footnote style definitions from (default: bundled `references/templates/law_review_template.docx`)

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

See [`footnotes-reference.md`](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/footnotes-reference.md) for detailed technical reference covering:
1. Run-level editing gotchas (NBSP, cross-run matching, xml:space)
2. Cloud editor damage patterns (what gets destroyed and why)
3. Direct ZIP surgery patterns (bypassing Document libraries)

#### Footnote Numbering Offset Fix

When author bio footnotes use `customMarkFollows` (*, †, ‡), they consume auto-numbers 1–3, causing body footnotes to start at 4. Fix by adding `numRestart=eachSect` to `settings.xml` and updating NOTEREF cached values.

**Requires:** A section break between title page and body. Render PDF with **Word** or **x2t** (`scripts/doc_render.py` at plugin root) — both honor numRestart; **LibreOffice does not** (renders restart numbering wrong; verified 2026-06-10, x2t restarts at 1 per section where soffice numbers continuously).

See [`footnotes-reference.md`](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/footnotes-reference.md) § 4 for details, code patterns, and the critical rule: numRestart goes in `settings.xml` ONLY (not in sectPr — causes all-zeros).
