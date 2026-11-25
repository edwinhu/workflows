// Pandoc template for a production runbook: pandoc -t typst --template runbook.typ.
// build-runbook.sh renders it with only the embedded fonts, so the column geometry below holds
// on every machine.
//
// Every raw block is set at the size where `cols` monospace characters fill the block's width,
// so a line wrap_commands.py kept within its --width never soft-wraps mid-token in the PDF.
//
// A ```command fence is drawn as a terminal block. The prompt is a drawn triangle, never text:
// the PDF text then holds exactly the command, which is what a reader copies and what
// package-check.sh compares against the runbook source.
//
// Guard, as in term.typ: the raw-block rule passes lang "term" through untouched, so a term.typ
// block included as raw Typst never gets a second box drawn inside its own.

#let cols = 90
#let mono = "DejaVu Sans Mono"
#let inset = 8pt
#let gutter = 0.6em
#let prompt-col = 0.7em

#let horizontalrule = line(start: (25%, 0%), end: (75%, 0%), stroke: 0.5pt + luma(60%))

// `body` is the raw element a show rule received, which renders at exactly the size set around
// it, so plain monospace text is the right probe. One column of slack keeps float rounding at
// the right edge from wrapping a full-width line.
#let fit(body) = layout(size => {
  let probe = measure(text(font: mono, size: 10pt, "0" * (cols + 1))).width
  text(size: 10pt * (size.width / probe), body)
})

#let panel(body, prompt: false) = block(
  width: 100%,
  fill: luma(96%),
  stroke: 0.5pt + luma(80%),
  radius: 2pt,
  inset: inset,
  breakable: true,
  grid(
    columns: (prompt-col, 1fr),
    column-gutter: gutter,
    if prompt { pad(top: 0.05em, polygon(fill: luma(35%), (0em, 0em), (0.5em, 0.3em), (0em, 0.6em))) },
    fit(body),
  ),
)

#set page(paper: "us-letter", margin: 1in, numbering: "1")
#set text(font: "Libertinus Serif", size: 11pt, lang: "en", region: "US")
#set par(justify: false)
#set heading(numbering: none)
#show heading: set block(above: 1.4em, below: 0.8em)
#show raw: set text(font: mono)

#show raw.where(block: true): it => {
  if it.lang == "term" {
    it
  } else if it.lang == "command" {
    panel(it, prompt: true)
  } else {
    panel(it)
  }
}

#show terms: it => {
  it.children
    .map(child => [
      #strong[#child.term]
      #block(inset: (left: 1.5em, top: -0.4em))[#child.description]
    ])
    .join()
}

#set table(inset: 10pt, stroke: (x, y) => if y == 0 { (bottom: 0.5pt + luma(60%)) })

#show figure.where(kind: table): set figure.caption(position: top)
#show figure.where(kind: image): set figure.caption(position: bottom)

$if(smart)$
$else$
#set smartquote(enabled: false)

$endif$
$for(header-includes)$
$header-includes$

$endfor$
$if(title)$
#align(center, block(below: 1.5em, text(size: 1.5em, weight: "bold")[$title$]))

$endif$
$for(include-before)$
$include-before$

$endfor$
$body$
$for(include-after)$

$include-after$
$endfor$
