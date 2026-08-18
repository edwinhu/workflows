# C. Document content cleanup (boxes + headings + cruft)

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
