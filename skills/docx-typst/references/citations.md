# Live citations and cross-references in Typst

Only needed for a manuscript whose numbers must maintain themselves —
`supra note N`, `Section IV.B` in a law review article. Skip it otherwise.

**These are one problem, not two.** pandoc lowers `#cite(<Key>)` to `[Key]` and
`@sec-remedies` to `[sec-remedies]`, discarding in both cases the number typst
assigned during layout. So both are frozen by the same pass, through the same
`<bb-out>` stream, and nothing numbered is ever typed by hand:

```
body-src.typ    #cite(<Key>), @label, <labels>, prose      ZERO literal numbers
     │ expand_citations.py     one query, one positional splice
body.typ        supra note 8 · Id. · Section IV.B · infra note 195 — all frozen
```

`bluebook.rule` handles citations; `bluebook.ref-rule` handles cross-references.
Install both in `main.typ`. `supra` versus `infra` is not authored — it is the
direction from the citing site to the target, read off the footnote **counter**
(not x/y: a footnote's marker sits in the body while its content is laid out at
the foot of the page, so comparing positions calls a forward reference `supra`).

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

`bluebook.typ` implements the short-form rules; it does not state them. When the
question is what a citation should look like rather than how to make typst emit
it, the `bluebook` skill is the authority — `references/short-forms.md` for
`supra`/`id.`/`hereinafter`, `references/abbreviations.md` for reporter and
journal abbreviations.

### The citation data comes from the .bib

`scripts/bib_to_entries.py` generates the `entries` module `bluebook.typ` reads:

```
bib_to_entries.py --bib sources.bib --csl bluebook.csl -o cite-data.typ
bib_to_entries.py --bib sources.bib --csl bluebook.csl --diff cite-data.typ
bib_to_entries.py --bib sources.bib --csl bluebook.csl --audit
```

It **runs citeproc** rather than parsing BibTeX. That is the whole design: the
strings have to match what is already on the page, and a hand-written renderer
would have to reproduce citeproc's quirks byte for byte — `Lucian A Bebchuk`
with no period, `.;` between adjacent groups — with every normalization silently
rewording a live citation. Running the same engine over the same CSL gets the
quirks by construction. Verified on a 117-entry .bib against 36 live entries:
every entry-level string reproduced, no citation reworded.

**`--diff` never writes.** Regenerating on top of live citation data is how a
citation gets changed without anyone reading it. Diff, review every delta, apply
by hand.

**`--audit` reports the .bib defects that render as plausible output.** Every
check exists because the defect it catches produced a citation that looked
fine — nothing errored, so nothing was noticed:

- **A name field separated by `&` or `;` instead of ` and `.** BibTeX's only
  separator is ` and `, so the whole field becomes ONE name read as
  `Last, First`, which moves the first author to the end:
  `{L. Bebchuk, A. Cohen & S. Hirst}` renders `Alma Cohen & Scott Hirst Lucian
  A. Bebchuk`, short form `Lucian A. Bebchuk`. Depth-aware, so an institutional
  `{{Gibson, Dunn & Crutcher LLP}}` is not flagged.
- **Keys differing only in punctuation or case** — `execorder14366_2025` /
  `execorder143662025`, `secGuidance2019` / `secguidance2019`. One source, several
  records, and the extras are usually cited nowhere.
- **Two works sharing a short form.** The defect that silently reworks a
  citation: citeproc derives the short from the AUTHORS, so three Kahan & Rock
  articles all render `Kahan & Rock` and `supra note 8` cannot say which.
  Downstream this surfaces only as `audit_crossrefs.py`'s `OK_AMBIG`. Found 18
  such groups in a 192-entry .bib, including one short shared by five works.
  Resolve it with `--shorts` (below); the warning clears as each is resolved.

It **reports, never fixes** — a name field, a cite key and a short form are all
authorial. Always warns; `--audit` makes it a gate by exiting non-zero. It does
not change generated output.

### Hand-authored short forms

```bash
bib_to_entries.py --bib sources.bib --csl bluebook.csl \
                  --shorts short-forms.toml -o cite-data.typ
```

```toml
[shorts]
kahan2008 = "Kahan & Rock, #emph[Hanging Chads]"   # Rule 4.2(a), title
gao2016   = "GAO Report"                           # Rule 4.2(b), hereinafter
```

Two Bluebook rules need something bibliographic data cannot supply: 4.2(a)
wants a shortened **italic title** when an author has more than one work in
the piece, and 4.2(b) wants the `[hereinafter X]` form the author declared at
the first full cite. Which words of a title to keep is an authorial choice, so
it is stated once here instead of typed at every citation site.

Values are typst **source**, like every other field in the module, so `#emph`
italicizes the title as Rule 4.2 requires — no schema change was needed for
this, because `short` was already eval'd as markup.

Overrides apply **before** the audit, so a resolved collision stops being
reported. An override naming a key not in the .bib is **fatal**: a stale
override reads as though the disambiguation was handled while the citation it
was meant to fix still renders bare.

Only keys that are actually short-cited need an entry — `bluebook.typ` reaches
`_short-form` only on a repeated key, so a collision between two
cited-exactly-once keys is noise. On a 182-entry .bib, 11 overrides took the
audit from 11 problems to 8, and all 8 survivors were that kind of noise.

### `entries` schema — pincites are site-level

```
"Key": (full: "…up to the pin insertion point", date: " (2019)",
        pin-sep: ", " | " ", short: "Bebchuk & Hirst" | none)   // all required
```

Bluebook puts a first reference's pincite **inside** the citation, before the
date — `2029, tbl.1 (2019)`, never `2029 (2019), tbl.1`. A flat `full` string
cannot express that, so `full` stops at the seam and `date` carries the rest.
All four fields are required; a pre-split entry panics rather than rendering
until the first pincite and then misplacing it.

The generator does not *infer* that seam, it **asks citeproc** — one probe round
cites every key with a numeric sentinel locator, and `full`/`pin-sep`/`date` are
read off wherever the style put it. Inference was tried and was wrong three ways:
a case whose parenthetical carries a court (`123 F.3d 456 (2d Cir. 2019)`) has no
bare `(YYYY)` to split on, an entry with no date at all put the pincite after the
URL, and deriving the separator from the BibTeX entry type mislabels books —
`Berle` (no page) really does take Rule 15's bare space, but `Lund & Robertson`
(a book *with* a page) takes `", "`, and an `@BOOK` test cannot tell them apart.
The sentinel must be numeric: this style treats a non-numeric locator as an
appendage and renders it *after* the date.

An earlier schema baked the first site's pin into `full`, and `_full-form` took
no `pin` at all while `_short-form` and `_id-form` both did. That asymmetry was
invisible while the data was frozen and fatal the moment it came from a .bib: a
generated entry has no pin to bake, so every first-reference pincite would have
vanished. Supplying a pin to an entry with no `date` field now **panics** rather
than appending it after the date.

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
