// validation.typ — Structural metadata emission via Typst introspection
//
// Query layer only: emits raw data as labeled entries, queryable with:
//   typst query <file> '<val>' --field value --root .
//
// All detection logic (overflow, conventions) lives in scripts/checks/*.py.
//
// Emitted metadata entries (by "check" field):
//   "heading"    — level, text, page for every heading
//   "pages"      — total physical page count
//   "counts"     — heading counts by level (l1, l2, l3)
//
// Presentation mode additionally emits:
//   "touying-slide"    — page number of each touying-new-slide marker
//   "touying-subslide" — page number of each touying-new-subslide marker
//
// Two modes:
//
//   HANDOUT MODE (validation-rules):
//     Run with handout:true + #pause stripped. Each slide = 1 page.
//     Emits: heading, pages, counts.
//
//   PRESENTATION MODE (pres-validation-rules):
//     Run without handout mode. Each slide with N pauses = N+1 sub-slide pages.
//     Emits: heading, pages, counts, touying-slide, touying-subslide.
//
// Usage (handout mode):
//   #import "validation.typ": validation-rules
//   #show: university-theme.with(config-common(handout: true), ...)
//   #show: validation-rules
//   #include "slides/..."
//
// Usage (presentation mode):
//   #import "validation.typ": pres-validation-rules
//   #show: university-theme.with(...)   // NO handout: true
//   #show: pres-validation-rules
//   #include "slides/..."

#let validation-rules(body) = {
  // --- Heading capture ---
  // Intercepts every heading and records level, body text, and physical page.
  // Fires before the theme's heading rules (inner show rule), so it sees
  // raw heading content without numbering or Touying transformations.
  show heading: it => {
    it
    context [#metadata((
      check: "heading",
      level: it.level,
      text: it.body,
      page: here().page(),
    )) <val>]
  }

  body

  // --- End-of-document summary ---
  context {
    let total = here().page()

    // Total physical page count
    [#metadata((check: "pages", total: total)) <val>]

    // Heading counts by level
    let all-hdgs = query(heading)
    let by-level(n) = all-hdgs.filter(h => h.level == n).len()
    [#metadata((
      check: "counts",
      level1: by-level(1),
      level2: by-level(2),
      level3: by-level(3),
    )) <val>]
  }
}

#let pres-validation-rules(body) = {
  // --- Heading capture (same as handout mode) ---
  show heading: it => {
    it
    context [#metadata((
      check: "heading",
      level: it.level,
      text: it.body,
      page: here().page(),
    )) <val>]
  }

  body

  // --- End-of-document summary + touying markers ---
  context {
    let total = here().page()

    [#metadata((check: "pages", total: total)) <val>]

    let all-hdgs = query(heading)
    let by-level(n) = all-hdgs.filter(h => h.level == n).len()
    [#metadata((
      check: "counts",
      level1: by-level(1),
      level2: by-level(2),
      level3: by-level(3),
    )) <val>]

    // Emit raw touying marker positions for Python-side overflow detection
    let touying-all = query(<touying-metadata>)
    for m in touying-all {
      if m.value.kind == "touying-new-slide" {
        [#metadata((
          check: "touying-slide",
          page: m.location().page(),
        )) <val>]
      }
      if m.value.kind == "touying-new-subslide" {
        [#metadata((
          check: "touying-subslide",
          page: m.location().page(),
        )) <val>]
      }
    }
  }
}
