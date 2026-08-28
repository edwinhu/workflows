// Terminal block for a runbook step: the command on a `>` prompt line, the run's
// real output below the rule. Output is a trimmed transcript, wrapped by hand to
// the block width — Typst soft-wraps raw lines, and a log line broken mid-column
// reads as corruption. At 9pt in a 6.3in text block that width is 66 characters.
//
// The `lang: "term"` tag is load-bearing: a document-level
// `show raw.where(block: true)` rule would otherwise draw its own filled box
// INSIDE this panel. Guard that rule with the lang, as below.
//
//   #show raw.where(block: true): it => if it.lang == "term" { text(9pt, it) } else {
//     block(fill: luma(96%), stroke: 0.5pt + luma(80%), radius: 2pt,
//           inset: 10pt, width: 100%, text(9pt, it))
//   }
//
// Usage:
//   #term("pixi run python -m src.build_census", out: "
//   INFO  transform census: 3,027 advisers, 2,849 coded (94.1%)
//   SUCCESS  census built
//   ")
//   #term("pixi run python -m src.check --verify")   // no captured output

#let term(cmd, out: none) = block(
  width: 100%,
  fill: luma(96%),
  stroke: 0.5pt + luma(80%),
  radius: 2pt,
  inset: 10pt,
  breakable: true,
)[
  #set text(9pt)
  #raw("> " + cmd, block: true, lang: "term")
  #if out != none [
    #v(0.5em)
    #line(length: 100%, stroke: 0.4pt + luma(84%))
    #v(0.5em)
    #text(fill: luma(25%))[#raw(out.trim("\n"), block: true, lang: "term")]
  ]
]
