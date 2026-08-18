# Facts

- **Show rules in the file pandoc reads collapse `= Heading` into a bold paragraph.**
  Pandoc evaluates them before writing the docx, the build still succeeds, and the damage
  surfaces only when someone opens Word's navigation pane and finds it empty. `build.py`
  refuses a body carrying `#show`/`#set`/`#let`/`#import` for this reason. Reaching for
  `--allow-styling` to get past the error ships a headingless document to a coauthor —
  the opposite of the help that motivated skipping the split.

- **A live `#cite` can never reach the canonical fixed point.** pandoc's docx
  writer emits a Cite node as the bare text `[Key]`, so `typ → docx → typ` turns
  `#cite(<Bebchuk2019-uq>)` into `\[Bebchuk2019-uq\]`. Everything else can work
  — the PDF, the docx, the Word render — and `--check` still fails, which is how
  this surfaces: late, after the build is green. Separating the symbolic source
  from the generated literal body is the only arrangement that satisfies both
  the citation automation and `reconcile.py`.

- **A custom function name in a body file is a HARD pandoc error, not a degraded
  render.** `#cite-bb(...)` gives `"body.typ" (line 1, column 18): Identifier
  "cite-bb" not found` and NO docx is produced. pandoc does understand the
  built-in `#cite(<Key>)` and `@Key`, lowering them to real Cite nodes, so a
  custom citation renderer must be a `#show cite:` rule over the built-in rather
  than a new function. This is why the split above uses the built-in spelling in
  the body and keeps the renderer in `main.typ`.

- **Footnote numbers are a LAYOUT property, so a citation renderer cannot ask
  for them directly.** typst assigns them during layout while citation
  processing is a prepass — which is very likely why hayagriva never populates
  `first-reference-note-number`, and why patching hayagriva would not fix it.
  The way through is to defer: emit each site as `#metadata`, then resolve with
  `query()` and `counter(footnote).at(site.location())`. Non-cyclical, and it
  survives an inserted footnote because nothing is hard-coded.

- **typst GROUPS adjacent cites and swallows the separator between them.**
  `#cite(<a>); #cite(<b>)` is one citation group, and the `; ` disappears —
  a stacked footnote renders `…552 (2007) Dorothy S. Lund, …` with nothing
  between the two sources. This is invisible in the source and only shows up
  in the PDF, in the construct law review footnotes use most. Wrapping the
  separator in a content block — `#cite(<a>)#[;] #cite(<b>)` — breaks the
  grouping; `#box[]` and a bare `#h(0pt)` do not. `expand_citations.py`
  dissolves those wrappers on the way out, because `#[;]` is a layout device
  with no meaning in the literal body and the docx round trip flattens it —
  leaving it would make `canonicalize.py --check` fail on a file
  `expand_citations.py --check` calls up to date.

- **A word-final straight apostrophe in generated citation data is corrupted
  beyond recovery.** `Investors' Attention` round-trips to `Investors” Attention`,
  and canonicalize.py's restore does NOT save it — that normalization only
  protects source that was already `’`, and by the time it runs the character
  is a double quote. So `bib_to_entries.py` re-smartens at the point it
  generates the string. Scoped to word-final: `Comm'n`, `Ass'n`, `Nat'l` and
  `S'holder` — Bluebook's own abbreviations — survive the trip untouched and
  must not be rewritten. A .bib written with straight apostrophes is the normal
  case, so this is not an edge case; it is every possessive in a title.

- **`supplement` arrives as CONTENT, and typst has already smartened it.**
  `[2071--72]` is a sequence of three children, not a string: a naive `.text`
  returns nothing, a space element carries no `.text` at all (dropping it welded
  `500& tbl.3`), and reassembling yields `2071–72` with an en-dash. That last
  one renders identically but is a DIFFERENT source spelling, which
  canonicalize.py normalizes back to `--` — leaving the generated body
  permanently one step off its fixed point. Walk the tree and un-smarten.

- **`entries` values are typst SOURCE, eval'd as markup — so `short` already
  accepts `#emph`.** Reading the schema line as a plain string (`short: "Bebchuk
  & Hirst"`) invites the conclusion that Rule 4.2 disambiguation is unreachable
  without changing `bluebook.typ`, and a whole migration was once written off on
  that basis. It renders correctly today: `short: "Kahan & Rock, #emph[Hanging
  Chads]"` yields *Kahan & Rock, Hanging Chads, supra note 8*, italics included.
  Compile the one-line probe before concluding the renderer cannot express
  something — the schema comment describes the common case, not the limit.

- **A returned `.docx` has no ancestor unless one was arranged in advance.** Merging two
  versions without a common base silently drops one side's edits, and the loss is
  invisible in the output. This is why build and stamp are one invocation with no
  `--no-stamp`: provenance a caller can forget is discovered months later, when the
  document comes back and the ancestor is gone.

- **Google Docs drops custom document properties on export.** A file that went through
  Drive comes back unstamped even though it was built stamped. Ask the coauthor to track
  changes, or keep the sent `.docx` for `--base-docx`. Word itself preserves the stamp.

- **The canonical form is defined as one full docx round trip, not `-f typst -t typst`.**
  The docx trip is the pipe a returned document actually passes through, so it is the
  only fixed point that matters. `--wrap=none` is part of the definition: at pandoc's
  default 72-column wrap a one-word edit reflows its whole paragraph, and the merge
  reports a dozen changed lines where one word changed.

- **Real Word output trips three pandoc defects that synthetic fixtures never reach, and
  `canonicalize.py` normalizes around all three.** Every one was found by running the
  recovery over a genuine 1.2M manuscript after the suite was already green.
  (1) Pandoc's DOCX writer wraps every `#figure` — table or image — in a one-cell
  container table (19 `<w:tbl>` in, 38 out). This is pandoc's doing, not Word's: the
  manuscript's own docx has 19 and the first `docx → typ` pass is clean, which is why
  `--check`, not the recovery, was what exploded. Reading that docx back, the typst
  WRITER emits the container's width as `columns: (100%)` — a parenthesized scalar, not
  a one-element array — and pandoc's own READER fails with `Could not determine number
  of columns`. 26 of them here: 19 tables + 7 figures. Still present on pandoc `main` as
  of 2026-08, so upgrading does not fix it.
  (2) Making it parse is not enough: the wrapping happens on EVERY trip and the levels
  accumulate — 19 containers became 57 then 133 — so there is no fixed point until
  single-cell containers are flattened. Flattening requires the cell to OPEN with
  `#figure(` — pandoc only ever manufactures the wrapper around a figure, 19 of 19 here —
  which is what keeps an AUTHORED one-cell table (a callout box, a framed panel) from
  being dissolved into loose prose. A real one-column data table has one cell per row and
  never matches either.
  (3) The writer unsmartens `’` to `'` and the reader re-reads a word-final `'` as a
  closing DOUBLE quote, so `Officers’ Retirement` becomes `Officers” Retirement` on the
  second pass. The pipe converged on corruption rather than on its input. Raw spans, raw
  blocks and math are exempt, because pandoc does not smarten inside them either.

- **Without `--extract-media` pandoc drops every embedded image and says nothing.** Seven
  figures vanished from a manuscript into a 207KB file with zero `image(` calls, empty
  one-cell tables and orphaned captions — and exit status 0. Recovery therefore always
  extracts, and REFUSES to write a document with figures unless `--media-dir` says where
  they go. The same asymmetry runs the other way: a `image(...)` path pandoc cannot open
  is a WARNING, and it substitutes the alt text and still exits 0, so `canonicalize.py`
  treats that warning as an error. Reaching for a run without `--media-dir` to avoid the
  extra argument ships a paper with no figures to a coauthor.

- **A figure is identified by its BYTES, not by pandoc's filename.** Pandoc names extracted
  media after the docx's internal relationship ids, which are assigned per package: the
  same figure is `figure1.png` out of the repo's own `body.typ` and `rId9.png` out of a
  returned `.docx`. Naming by extraction made an UNEDITED returned document differ from
  the source on every figure line — `reconcile.py` reported figures as changed that nobody
  changed, and `media/` gained a duplicate copy of every image per run. `_adopt_media`
  matches on a sha256 and reuses the existing name; different bytes get their own file
  rather than overwriting.

- **Every rewrite runs OUTSIDE raw spans, raw blocks and math**, including the
  `columns:` repair and image discovery. A recovered document that QUOTES Typst source —
  this skill's own notes would — otherwise has its examples silently edited, and an
  `image("x.png")` inside a code sample counts as a figure and shifts the positional path
  mapping onto the wrong call. Math is bounded to a single block for the same reason: one
  unpaired `$` would otherwise protect the entire rest of the document and disable every
  later rewrite invisibly.

- **Image paths are restored positionally across the round trip, not trusted.** Pandoc
  renames media on embedding (`media/figure1.svg` in, `media/rId83.svg` out), so an image
  path can never be its own fixed point; a canonical form carrying the round trip's names
  would point at files that do not exist. The trip is trusted for the prose and the Nth
  path is put back, with a count mismatch raising.

- **The reference doc does not affect the canonical form** — it changes the docx's styles,
  not its structure. Canonical form is template-independent, so re-templating a document
  never churns the source.

- **Normalization on the first pass is cosmetic and stable**: `_x_`→`#emph[x]`,
  `*x*`→`#strong[x]`, straight→curly quotes, a `<label>` anchor after each heading. A
  first canonicalization of a hand-written file touches many lines; that diff is the
  format converging, not content changing, and it happens exactly once.

- **`reconcile.py` exits non-zero and leaves `<<<<<<<` markers when both sides edited the
  same passage.** Resolving those by picking a side is a judgment call about two people's
  prose; making it automatically would discard a coauthor's edit without anyone seeing it.
