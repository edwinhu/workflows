---
name: typst
description: This skill should be used when the user asks about "typst syntax", "typst formatting", "typst templates", "typst functions", "typst packages", "typst tables", "typst math", "typst bibliography", or mentions writing documents in Typst. Provides syntax guidance and best practices for the Typst typesetting language.
version: 1.0.0
---

# Typst Language Guide

Typst is a modern typesetting language designed as an alternative to LaTeX. It combines markup syntax for common formatting with a powerful scripting language for advanced layouts.

## Core Syntax

### Text Formatting

```typst
*bold text*
_italic text_
`inline code`
```

### Headings

```typst
= Level 1 Heading
== Level 2 Heading
=== Level 3 Heading
```

### Lists

```typst
- Unordered item
- Another item
  - Nested item

+ Ordered item
+ Second item
  + Nested ordered
```

### Links and References

```typst
#link("https://typst.app")[Typst Website]
@label-name          // Reference a labeled element
#ref(<label-name>)   // Alternative reference syntax
```

## Function Calls

Typst uses `#` to call functions:

```typst
#image("photo.png", width: 50%)
#table(
  columns: 3,
  [Header 1], [Header 2], [Header 3],
  [Cell 1], [Cell 2], [Cell 3],
)
#figure(
  image("diagram.svg"),
  caption: [A diagram showing the architecture],
)
```

## Math Mode

Inline math uses `$...$`, display math uses `$ ... $` with spaces:

```typst
The equation $E = m c^2$ is famous.

Display equation:
$ integral_0^infinity e^(-x^2) dif x = sqrt(pi) / 2 $
```

Common math notation:
- Subscripts: `x_1`, `a_(n+1)`
- Superscripts: `x^2`, `e^(i pi)`
- Fractions: `a/b` or `frac(a, b)`
- Square roots: `sqrt(x)`, `root(3, x)` for cube root
- Summations: `sum_(i=0)^n`
- Greek letters: `alpha`, `beta`, `gamma`, `theta`

## Document Structure

### Page Setup

```typst
#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2.5cm),
  header: [Document Header],
  footer: context [Page #counter(page).display()],
)
```

### Text Configuration

```typst
#set text(
  font: "New Computer Modern",
  size: 11pt,
  lang: "en",
)

#set par(
  justify: true,
  leading: 0.65em,
  first-line-indent: 1em,
)
```

### Heading Styling

```typst
#set heading(numbering: "1.1")

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  text(size: 16pt, weight: "bold", it)
}
```

## Show Rules

Transform elements using show rules:

```typst
// Style all links
#show link: set text(fill: blue)

// Custom heading appearance
#show heading: it => block(
  fill: luma(230),
  inset: 8pt,
  radius: 4pt,
  it
)

// Replace text patterns
#show "TODO": text(fill: red, weight: "bold")[TODO]
```

## Tables

```typst
#table(
  columns: (auto, 1fr, 1fr),
  align: (left, center, right),
  stroke: 0.5pt,
  inset: 8pt,
  fill: (_, row) => if row == 0 { luma(230) },

  [*Name*], [*Value*], [*Unit*],
  [Length], [42], [cm],
  [Width], [10], [cm],
)
```

## Figures and Captions

```typst
#figure(
  image("chart.png", width: 80%),
  caption: [Sales data for Q1 2024],
) <fig:sales>

As shown in @fig:sales, sales increased.
```

## Bibliography

```typst
// In document
#bibliography("refs.bib", style: "ieee")

// Citation
@smith2024 shows that...
#cite(<smith2024>, form: "prose")
```

## Variables and Functions

```typst
// Variables
#let title = "My Document"
#let primary-color = rgb("#1a73e8")

// Functions
#let highlight(body) = box(
  fill: yellow.lighten(60%),
  inset: 4pt,
  radius: 2pt,
  body
)

Use like: #highlight[important text]
```

## Imports and Packages

```typst
// Import from local file
#import "template.typ": conf, author

// Import from Typst Universe package
#import "@preview/cetz:0.3.4": canvas, draw

#canvas({
  draw.circle((0, 0), radius: 1)
})
```

Packages are available at [Typst Universe](https://typst.app/universe).

## Common Templates

### Academic Paper

```typst
#set document(
  title: "Paper Title",
  author: "Author Name",
)

#set page(paper: "us-letter", margin: 1in)
#set text(font: "Times New Roman", size: 12pt)
#set par(justify: true, first-line-indent: 0.5in)
#set heading(numbering: "1.1")

#align(center)[
  #text(size: 14pt, weight: "bold")[Paper Title]

  Author Name \
  Institution \
  #link("mailto:email@example.com")
]

#outline()

= Introduction
...
```

### Letter

```typst
#set page(paper: "us-letter", margin: 1in)
#set text(size: 11pt)

#align(right)[
  Your Name \
  Your Address \
  #datetime.today().display()
]

#v(1cm)

Dear Recipient,

#lorem(50)

Sincerely,

#v(1cm)

Your Name
```

## Control Flow and Scripting

### Conditionals

```typst
#if condition [
  Content when true
] else [
  Content when false
]

// Inline conditional
#text(fill: if important { red } else { black })[Text]
```

### Loops

```typst
// For loop over array
#for item in (1, 2, 3) [
  Item: #item \
]

// For loop with index
#for (i, item) in items.enumerate() [
  #(i + 1). #item \
]

// While loop (rare, usually use for)
#let i = 0
#while i < 3 {
  [Item #i]
  i += 1
}
```

### Context and State

```typst
// Access page/document context
#context {
  let current-page = counter(page).get().first()
  [Page #current-page of #counter(page).final().first()]
}

// State management
#let note-counter = counter("notes")

#let note(body) = {
  note-counter.step()
  super(context note-counter.display())
  // Store note for later
}
```

## Common Patterns

### Two-Column Layout

```typst
#set page(columns: 2, margin: (x: 1.5cm, y: 2cm))

// Or manual columns
#columns(2, gutter: 1em)[
  Left column content.
  #colbreak()
  Right column content.
]
```

### Boxed Content

```typst
#box(
  fill: luma(240),
  inset: 1em,
  radius: 4pt,
  width: 100%,
)[
  Important note or callout.
]

// Reusable callout
#let callout(title, body) = block(
  fill: rgb("#e8f4f8"),
  inset: 1em,
  radius: 4pt,
  width: 100%,
)[
  #text(weight: "bold")[#title] \
  #body
]
```

### Custom Numbering

```typst
// Roman numerals for front matter
#set page(numbering: "i")

// Switch to arabic for main content
#counter(page).update(1)
#set page(numbering: "1")

// Custom format
#set heading(numbering: (..nums) => {
  nums.pos().map(str).join(".") + " "
})
```

### Include External Files

```typst
// Include another Typst file (content)
#include "chapter1.typ"

// Import functions/variables from file
#import "utils.typ": format-date, highlight
```

## Debugging Tips

Check diagnostics from tinymist LSP for:
- Undefined variables or functions
- Type mismatches in function arguments
- Missing closing brackets or parentheses
- Import resolution errors

Use `#repr(value)` to inspect values during debugging:
```typst
#repr(some-variable)  // Shows type and value
#type(value)          // Shows just the type
```

Common errors and fixes:
- "Unknown variable" → Check spelling, ensure `#let` before use
- "Expected content" → Wrap value in brackets: `[#value]`
- "Cannot apply" → Check function signature and argument types
- "Unexpected end" → Check for unclosed brackets `{`, `[`, `(`

## Additional Resources

- [Typst Documentation](https://typst.app/docs)
- [Typst Universe (Packages)](https://typst.app/universe)
- [tinymist LSP](https://github.com/Myriad-Dreamin/tinymist)

For compilation and preview, use the `/typst:compile` and `/typst:preview` commands.
