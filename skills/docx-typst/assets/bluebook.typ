// Bluebook citation renderer for a typst law review manuscript.
//
// Copy this beside your main.typ and install it:
//
//     #import "bluebook.typ"
//     #show cite: bluebook.rule.with(entries: entries, id-overrides: overrides)
//
// `entries` is a dict keyed by cite key:
//
//     (full:    "<entry-level first reference, UP TO the pin insertion point>",
//      date:    "<the date parenthetical and anything trailing it>" or "",
//      pin-sep: ", " (default) or " ",
//      short:   "<author-short used in `X, supra note N`>" or none)
//
// Values are typst SOURCE STRINGS, not content, so the same data serves both
// outputs: main.typ eval()s them, and expand_citations.py reads them back out
// with `typst query <bb-out>` to generate the literal body file.
//
// WHY `full` STOPS SHORT OF THE DATE
//
// Bluebook puts a first reference's pincite INSIDE the citation, immediately
// before the date parenthetical -- `2029, tbl.1 (2019)`, not `2029 (2019),
// tbl.1`. A single flat string cannot express that, so an earlier schema baked
// the first site's pin into `full` and `_full-form` took no `pin` at all, while
// `_short-form`/`_id-form` both did. The asymmetry was invisible while the data
// was frozen and fatal the moment it came from a .bib: an entry generated from
// bibliographic fields has no pin to bake, so every first-reference pincite
// would have been silently dropped.
//
// Splitting at the date restores the seam. `full` is what the bibliography
// knows; `date` is what follows the pin; `pin-sep` is the separator the source
// type calls for -- ", " after a first page or volume (Rule 3.2; cases,
// articles, statutes), " " after a bare title (Rule 15; books, where the pin
// follows the title with no comma). Entries with no date at all carry
// `date: ""` and take the pin at the end.
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
  // Rule 4.2: the pincite is set off by a comma -- `supra note 1, at 2040`, not
  // `supra note 1 at 2040`. `Id. at 496` takes no comma, which is why _id-form
  // does not get the same treatment.
  short + ", #emph[supra] note " + str(note) + if pin != none { ", at " + pin } else { "" }
}

#let _full-form(entries, key, pin) = {
  let e = entries.at(key, default: none)
  if e == none { panic("bluebook: unknown cite key " + key) }
  if "date" not in e or "pin-sep" not in e {
    // Pre-split data, where `full` ran through the date parenthetical. Tolerating
    // it would mean rendering fine until the first site that supplies a pincite,
    // then putting it AFTER the date -- `2029 (2019), tbl.1` -- without
    // complaint. One invariant, checked once, beats a latent wrong render.
    panic("bluebook: entry " + key + " predates the (full, date, pin-sep) schema. "
      + "Regenerate the citation data with bib_to_entries.py.")
  }
  // The pincite goes where citeproc puts a locator: inside the citation, before
  // the date, with the separator the style itself used.
  e.full + if pin != none { e.pin-sep + pin } else { "" } + e.date
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
    _full-form(entries, key, pin)
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

// ---------------------------------------------------------------------------
// CROSS-REFERENCES -- the same problem as a citation, so the same answer.
//
// `@sec-remedies` and `#cite(<Key>)` fail identically on the docx path: pandoc
// lowers both to their bare label, `[sec-remedies]` and `[Key]`, never the
// number typst computed during layout. So a cross-reference is not a second
// mechanism needing a second pass -- it is another computed value that has to
// be frozen before pandoc reads the body, and it rides the SAME `<bb-out>`
// stream expand_citations.py already splices.
//
// That is what retires the last of the hand-typed numbers. `supra` vs `infra`
// is nothing but the direction from the citing site to the target, which the
// document knows and the author should not have to.
// ---------------------------------------------------------------------------

#let ref-rule(it, section: "Section", note: "note") = {
  let el = it.element
  if el == none { return it }
  context {
    let there = el.location()
    let src = if el.func() == heading {
      let n = counter(heading).at(there)
      section + " " + numbering(el.numbering, ..n).trim(".", at: end)
    } else if el.func() == footnote {
      // Direction comes from the footnote COUNTER, not from x/y. A footnote's
      // marker sits in the body text while its content is laid out at the foot
      // of the page, so comparing positions compares two different coordinate
      // spaces and calls a forward reference `supra`. The counter is monotonic
      // in document order and is the same number being cited, so it cannot
      // disagree with the text it produces.
      let n = counter(footnote).at(there).first()
      let dir = if n > counter(footnote).at(here()).first() { "infra" } else { "supra" }
      "#emph[" + dir + "] " + note + " " + str(n)
    } else {
      panic("bluebook: no cross-reference form for " + str(el.func()))
    }
    [#metadata(src)#out-tag]
    eval(src, mode: "markup")
  }
}
