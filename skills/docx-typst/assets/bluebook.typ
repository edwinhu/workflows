// Bluebook citation renderer for a typst law review manuscript.
//
// Copy this beside your main.typ and install it:
//
//     #import "bluebook.typ"
//     #show cite: bluebook.rule.with(entries: entries, id-overrides: overrides)
//
// `entries` is a dict keyed by cite key:
//
//     (full: "<typst source of the FULL first reference>",
//      short: "<author-short used in `X, supra note N`>" or none)
//
// Values are typst SOURCE STRINGS, not content, so the same data serves both
// outputs: main.typ eval()s them, and expand_citations.py reads them back out
// with `typst query <bb-out>` to generate the literal body file.
//
// WHY THIS EXISTS RATHER THAN #bibliography(..., style: "bluebook.csl")
//
// typst reads CSL, but hayagriva (0.10.1, statically linked into the typst
// binary) cannot render Bluebook. Three gaps, isolated with a minimal probe
// style that emits nothing but the contested variables:
//
//     3  SUPRA-NOTE-NUM=[]  SMALLCAPS=[ The Specter of the Giant Three]
//        pdffonts: LibertinusSerif-Regular      <- no small-caps face
//
//   * `first-reference-note-number` is never populated, so `supra note N` is
//     unreachable;
//   * `font-variant="small-caps"` is ignored;
//   * BibLaTeX `shortjournal` is not mapped to `container-title-short`, so
//     `form="short"` silently yields "Boston University Law Review" where
//     Bluebook wants B.U. L. REV.
//
// Position tracking DOES work -- `Id.` renders correctly through CSL.
//
// Patching hayagriva does not help: it is statically linked, so it would mean
// shipping a custom typst and making the manuscript unbuildable on a stock
// toolchain. And the gap that actually forces a custom renderer -- the note
// number -- is the one a patch cannot reach, because footnote numbers are
// assigned during LAYOUT while citation processing is a prepass. That is why
// `resolve` below defers to `query()` and `counter(footnote).at(...)` instead
// of asking for a number that does not exist yet.
//
// WHY IT HOOKS THE BUILT-IN `cite`
//
// A custom function name in a body file is not a degraded render on the Word
// path, it is a hard stop:
//
//     $ pandoc -f typst -t docx body.typ
//     "body.typ" (line 1, column 18): Identifier "cite-bb" not found
//
// No docx is produced at all. pandoc DOES understand the built-in spelling and
// lowers `#cite(<Key>)` to a real Cite node, so the body keeps the built-in
// form -- pandoc-readable, and free of the #show/#set/#let that
// `canonicalize.py --lint` forbids there -- and this module is installed from
// main.typ as a show rule over it.

#let site-tag = <bb-site>
#let out-tag = <bb-out>

#let _id-form(pin) = "#emph[Id.]" + if pin != none { " at " + pin } else { "" }

#let _short-form(entries, key, note, pin) = {
  let e = entries.at(key, default: none)
  let short = if e == none { none } else { e.short }
  if short == none {
    // A key cited exactly once never needed a short form, so this branch should
    // be unreachable for it. Fail loudly rather than inventing an author-short.
    panic("bluebook: no short form for repeated key " + key)
  }
  short + ", #emph[supra] note " + str(note) + if pin != none { " at " + pin } else { "" }
}

#let _full-form(entries, key) = {
  let e = entries.at(key, default: none)
  if e == none { panic("bluebook: unknown cite key " + key) }
  e.full
}

// typst smartens `--` to an en-dash while PARSING `[2071--72]`, so reassembling
// the pin yields `2071–72`. That renders identically but is a different source
// spelling, and canonicalize.py's round trip normalizes it back to `--` --
// leaving the generated body permanently one step off its fixed point. Undo it.
#let _unsmart(s) = s.replace("—", "---").replace("–", "--")

// `supplement` arrives as CONTENT. A naive `.text` returns nothing for anything
// but a single word: `[2071--72]` is a sequence of three children, and a space
// element carries no `.text` at all (dropping it welded `500& tbl.3`).
#let _text-of(c) = {
  if c == none { "" }
  else if type(c) == str { c }
  else if c.has("text") { c.text }
  else if c.func() == [ ].func() { " " }
  else if c.has("children") { c.children.map(_text-of).join("") }
  else if c.has("body") { _text-of(c.body) }
  else { "" }
}

// Resolve one site against document order. Returns the typst SOURCE string.
#let resolve(key, pin, entries: (:), id-overrides: ()) = context {
  let sites = query(site-tag)
  let me = here().position()
  let i = sites.position(s => s.location().position() == me)
  let prior = sites.slice(0, i).map(s => s.value)

  // Which occurrence of this key is this? Stable when footnotes are inserted
  // elsewhere, which is what makes it usable as an override handle.
  let nth = prior.filter(k => k == key).len() + 1
  let forced = id-overrides.contains((key, nth))

  // Bluebook allows `Id.` for the immediately preceding authority in the SAME
  // footnote; across footnotes it requires the preceding note to hold only that
  // one authority. Same-footnote-only is therefore the default. On a real
  // manuscript it agreed with pandoc-citeproc on 69 of 71 sites; the two it did
  // not are places citeproc emitted `Id.` across a footnote carrying two
  // authorities. No mechanical rule reproduced all 71, so the exceptions belong
  // in `id-overrides` as (key, nth) rather than being silently rewritten --
  // changing them alters citation text a coauthor has already read.
  let same-note = prior.len() > 0 and prior.last() == key and (
    counter(footnote).at(sites.at(i - 1).location()).first()
      == counter(footnote).at(here()).first())

  let src = if (same-note or forced) and prior.contains(key) {
    _id-form(pin)
  } else if prior.contains(key) {
    let j = prior.position(k => k == key)
    // Read AT the first site's location. Nothing is hard-coded, which is what
    // makes the reference survive an inserted footnote.
    let n = counter(footnote).at(sites.at(j).location()).first()
    _short-form(entries, key, n, pin)
  } else {
    _full-form(entries, key)
  }

  // Carried for the docx build, which reads these back with `typst query`.
  [#metadata(src)#out-tag]
  eval(src, mode: "markup")
}

// Install from main.typ. The body only ever writes `#cite(<Key>)`, optionally
// with `supplement: [pin]`.
#let rule(it, entries: (:), id-overrides: ()) = {
  let key = str(it.key)
  let pin = if it.supplement == none { none } else {
    _unsmart(_text-of(it.supplement))
  }
  [#metadata(key)#site-tag#resolve(key, pin, entries: entries, id-overrides: id-overrides)]
}
