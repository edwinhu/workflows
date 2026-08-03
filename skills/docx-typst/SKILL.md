---
name: docx-typst
description: "Use this skill to BUILD a Word document from a TYPST source file, to CONVERT an existing Word manuscript into Typst for the first time, and to bring a returned .docx back into the repo. Triggers: 'build the docx from the typ', 'typst to Word', 'send them a Word version of this paper', 'I have a Word manuscript, give me Typst', 'convert this docx to typst', 'move my paper off Word', 'start a Typst repo from this Word draft', 'my coauthor sent back the docx', 'they returned the Word file with edits', 'reconcile their edits with my source', 'merge the docx changes back', 'what did they change in the Word file', 'pull the comments out of the docx', 'get their comments from the Google Doc', 'is this file canonical', 'the source and the docx have diverged'. NOT 'law-review-docx' or 'law-econ-docx' (those build a docx from MARKDOWN — different input format), NOT 'docx-repair' (which fixes OOXML damage from a cloud round trip), NOT 'docx-render' (which only converts an existing .docx to PDF)."
user-invocable: true
---

# DOCX ↔ Typst Bridge

Typst source is the thing the repo keeps. Word is the thing coauthors edit. This skill
moves a document across that boundary **in both directions** and reconciles what comes
back.

The load-bearing fact: `typ → docx → typ` reaches a **fixed point after one pass**. So
the pipe's output is itself valid Typst, the canonical form can be committed, and
reconciling a coauthor's returned file collapses from "read two documents side by side"
to `git merge-file`.

```
   existing.docx ──canonicalize.py --from-docx──> body.typ + media/   (bootstrap, once)
                                                     │
   main.typ ──typst compile──> PDF                   │
      │                                              │
      │ #include                                     ▼
      ▼
   body.typ ──build.py──> paper.docx ──email──> coauthor edits in Word
      ▲                                                    │
      │                                                    │ sends back
      └──── reconcile.py <── merged body.typ <── returned.docx
                                                     │
                                                     └──comments.py──> comments.json
```

## Scripts

All under `${CLAUDE_SKILL_DIR}/scripts/`. Each is self-contained and prints `--help`.

**Run them with `uv run --script`, not `uv run python3`.** Four of the five declare
`lxml` in a PEP 723 header, and `uv run python3 <path>` ignores that header and fails
with `ModuleNotFoundError: No module named 'lxml'`. `--script` (or executing the file
directly, since the shebang is `uv run`) reads the header and provisions the dependency.

| Script | Direction | Does |
|---|---|---|
| `build.py` | typ → docx | Convert with `--reference-doc` styles **and** stamp provenance, in one step |
| `canonicalize.py` | docx → typ | **Bootstrap** an existing Word manuscript (`--from-docx`); put a body file on its fixed point; `--check` gates it; `--lint` guards the body/main split |
| `reconcile.py` | docx → typ | Resolve the ancestor, three-way merge a returned file against the repo source |
| `comments.py` | docx or Drive → JSON | Extract comments with their anchor text, resolved state, and threading |
| `provenance.py` | — | Read/write the stamp directly (build.py already applies it) |
| `expand_citations.py` | typ → typ | Render live `#cite(...)` into the literal body the docx path needs |

## The `main.typ` / `body.typ` split

```
main.typ    #import / #let / #show / #set, then #include "body.typ"    ← typst compiles this
body.typ    pure markup: = headings, prose, #emph, #footnote           ← pandoc reads this
```

Both paths see the same prose and neither degrades the other. The split is not stylistic
tidiness — see the first fact row.

## Bootstrap: you already have a Word manuscript

The first thing most people need, and the only direction that starts from a document
this skill never produced. One command:

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/canonicalize.py" \
    --from-docx 'paper.docx' --output body.typ --media-dir media
```

`--media-dir` is **required for any document with figures** and the script refuses
without it — see the images fact row. Verified end to end on a 1.2M Word manuscript
(7 top-level headings, 67 footnotes, 26 tables, 7 figures): 1.3s, all 7 figures
recovered to `media/`, `--check` clean on the result.

Then write the `main.typ` that `body.typ` is included from, and gate the source:

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/canonicalize.py" body.typ --check   # exit 0
git add body.typ media/ && git commit -m "bootstrap from paper.docx"
```

**Two manual steps the conversion cannot make for you:**

- **Delete the recovered table of contents.** Word's TOC arrives as a run of
  `#link(<...>)` lines, and the ones pointing at Word bookmarks rather than headings
  reference labels that do not exist — 13 of them in that manuscript, and `typst
  compile` stops at the first. A Typst document generates its TOC with `#outline()` in
  `main.typ`, so the recovered block is redundant as well as broken. Removing it is not
  a loss and does not affect the docx round trip, which reads those links fine.
- **Move styling into `main.typ`.** The recovery emits pure markup by construction, but
  anything you add must respect the split below; `--lint` enforces it.

## Forward: build a Word file

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/build.py" body.typ \
    -o paper.docx \
    --reference-doc "${CLAUDE_SKILL_DIR}/../writing-legal/templates/law_review_template.docx"
```

Produces real `Heading1`/`Heading2`/`FirstParagraph` Word styles, and stamps
`SourceSHA256`, `SourcePath`, `SourceGitSHA`, `StampVersion` into `docProps/custom.xml`.

**Commit the canonical form before sending.** `canonicalize.py body.typ --in-place`, then
commit. Sending from an uncommitted or non-canonical source is what strands the
reconciliation later.

## Reverse: reconcile what comes back

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/reconcile.py" returned.docx --source body.typ \
    --media-dir media
```

Writes `body.merged.typ` + `body.merged.typ.diff`, prints JSON, exits **1 on conflict**.
Ancestor resolution, in preference order:

1. **Tracked changes in the returned file** — `--track-changes=reject` reconstructs the
   pre-edit document, `accept` gives the edited one. One file yields both sides, so this
   works even for a file that was renamed or routed through a third party.
2. **`--base-docx sent.docx`** — the file that was actually sent, if it was kept.
3. **The provenance stamp** — `git cat-file` on the recorded blob sha.

If none resolves, the script **stops**. Pass `--base-docx` or `--base`.

## Live citations

Only needed for a manuscript whose citations must renumber themselves —
`supra note N` in a law review article. Skip it otherwise.

typst reads CSL, but **hayagriva 0.10.1 (linked into the typst binary) cannot
render Bluebook**. A minimal probe style emitting nothing but the contested
variables:

```
3  SUPRA-NOTE-NUM=[]  SMALLCAPS=[ The Specter of the Giant Three]
   pdffonts: LibertinusSerif-Regular       <- no small-caps face, no synthesis
```

`first-reference-note-number` is never populated, `font-variant="small-caps"` is
ignored, and BibLaTeX `shortjournal` is not mapped to `container-title-short`.
Position tracking does work — `Id.` renders correctly. `assets/bluebook.typ`
supplies the three missing pieces as a `#show cite:` rule.

That forces **two body files**, because their requirements are incompatible:

```
body-src.typ   editing surface, live #cite(<Key>)   <- main.typ compiles this
    | expand_citations.py   (typst query <bb-out>)
body.typ       canonical artifact, citations rendered
    |                                               <- build.py, reconcile.py
   .docx
```

```typst
// main.typ
#import "bluebook.typ"
#show cite: it => bluebook.rule(it, entries: entries, id-overrides: overrides)
```

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/expand_citations.py" \
    --main main.typ --src body-src.typ --out body.typ --check
```

Verified on a 59-page law review manuscript: 67 citation sites, 38 keys, every
citation byte-identical to what pandoc-citeproc produced, and the generated
`body.typ` byte-identical to the pre-existing canonical file. Inserting one
footnote shifted every reference (`supra note 1` → `2`, `16` → `17`) with no
edits.

**The cost:** `reconcile.py` merges a coauthor's edits into `body.typ`, the
literal form. Carrying them back to `body-src.typ` is manual, and a coauthor who
edits *inside* a citation string has to be reconciled by hand.

## Comments

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/comments.py" --from-docx returned.docx
uv run --script "${CLAUDE_SKILL_DIR}/scripts/comments.py" --from-drive <fileId>
```

Both backends emit one schema — `{id, author, created, modified, text, quoted, resolved,
replies[]}` — so nothing downstream branches on where the document came from. Drive is
read-only here by design; there is no write path back.

## Facts

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

- **`supplement` arrives as CONTENT, and typst has already smartened it.**
  `[2071--72]` is a sequence of three children, not a string: a naive `.text`
  returns nothing, a space element carries no `.text` at all (dropping it welded
  `500& tbl.3`), and reassembling yields `2071–72` with an en-dash. That last
  one renders identically but is a DIFFERENT source spelling, which
  canonicalize.py normalizes back to `--` — leaving the generated body
  permanently one step off its fixed point. Walk the tree and un-smarten.

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

## Red Flags — STOP

| Action | Why wrong | Do instead |
|---|---|---|
| About to point pandoc at `main.typ` | Its `#show` rules destroy heading semantics in the docx | Point it at `body.typ` |
| About to pass `--allow-styling` to clear a lint error | Ships a headingless Word file | Move the directives into `main.typ` |
| About to hand-edit the returned `.docx` and call it reconciled | The repo source still diverges; the next build overwrites the edits | Run `reconcile.py` and merge into the source |
| About to resolve `<<<<<<<` markers by deleting one side wholesale | Discards a coauthor's edit unreviewed | Read both sides; ask the user when the prose choice is theirs |
| About to commit a merge without reading `.merged.typ.diff` | The merge is a claim about someone else's edits, unverified | Read the diff, then commit |
| About to send a `.docx` built from an uncommitted source | Fallback 3 needs a committed blob; the ancestor is unrecoverable | Canonicalize, commit, then build |
| About to run `--from-docx` without `--media-dir` because the error is in the way | Every figure is dropped and the output still looks complete | Name the sidecar directory; it is one argument |
| About to invoke a script with `uv run python3 <path>` | The PEP 723 header is ignored and the lxml scripts die on import | `uv run --script <path>` |
| About to hand-fix `Officers"` in a recovered file | The converter did it, not the source; hand-fixes are re-corrupted next pass | Re-recover with current `canonicalize.py`, which restores `’` |
| About to name a custom citation function in the body file | pandoc dies with `Identifier not found` and no docx is produced | `#show cite:` over the built-in `#cite(<Key>)` |
| About to put live `#cite` in the file `reconcile.py` merges into | It can never be canonical; the merge churns on every citation | Keep the symbolic form in `body-src.typ`, generate the literal one |
| About to patch hayagriva to get `supra note N` | It is statically linked into typst, and note numbers are a layout property a patch cannot reach | Render citations in typst with a `#show cite:` rule |
| About to `typst compile` a freshly recovered body and conclude the conversion failed | Word's TOC arrives as links to bookmarks that are not labels | Delete the recovered TOC block; `#outline()` in `main.typ` replaces it |

## Verifying a change to this skill

```bash
./scripts/check-tests.sh docx_typst
```

`tests/docx_typst_test.py` pins the pandoc behaviors this skill rests on — the fixed
point, reference-doc styles, tracked-changes ancestry, comment extraction, and the three
defects above. They are properties of an external binary this repo does not pin, so they
are asserted rather than trusted.

Two of those tests pin a BUG rather than a feature: `test_pandoc_still_emits_an_
unparseable_single_column_table` and `test_pandoc_still_misreads_a_word_final_apostrophe`
fail when pandoc FIXES the defect. That is the intended signal — it is how the
normalization gets retired instead of quietly outliving its reason.

**A second model reviews this skill, and it earns its keep.** The codex and gemini passes
over the change above both independently found the figure-naming defect (an unedited
return read as having every figure edited), the unprotected `columns:` rewrite corrupting
quoted source, and the `image(` call counted from inside a code sample. All three
reproduced and are pinned in C12/C13. One reported finding — "an authored one-cell callout
box is flattened" — did NOT reproduce as written, because a single-line cell never matched
the line shape; the predicate was tightened anyway, since a multi-line one would have.
Verify a third-party finding before acting on it, and pin the ones that survive.

**Test against real Word output, not only the fabricated fixtures.** Every defect in the
list above survived a green suite, because a docx pandoc wrote does not contain the
structures Word writes. A change to the conversion path is not verified until it has run
over an actual Word manuscript with tables and figures in it.

## Scope

Owns **typst → docx**. `law-review-docx` and `law-econ-docx` own **markdown → docx**;
different input format, no overlap. `docx-repair` fixes OOXML damage from a cloud round
trip and composes cleanly before `reconcile.py` when a returned file is also damaged.
