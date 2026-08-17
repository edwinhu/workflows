// Fixture deck: a title page, then a section divider plus a content page per Slide Spec row.
// Seven pages against three body rows exercises R10's INEQUALITY and the divider skip set while
// keeping the scanned count at the body-row floor. `inv` is declared locally so the fixture needs
// no package download; the vendored templates/theme.typ declares the same no-op.
#let inv(..ids) = none

#set page(paper: "presentation-16-9", margin: 2em)
#set text(size: 20pt)

Ownership and payout: a fixture deck

#pagebreak()

== Motivation

#pagebreak()

=== Concentrated ownership predicts higher payout.
#inv("R1", "A4")

- Ownership concentration rises across the sample window

- Payout ratios move with it in the same direction

Both series move together across the whole window.

#pagebreak()

== Data

#pagebreak()

=== The panel spans 1994 through 2019.
#inv("T3", "A4")

- Coverage is annual and unbalanced at the edges

- Entry and exit are modelled explicitly

Coverage is stable after the first three years.

#pagebreak()

== Result

#pagebreak()

=== Blockholders raise dividends by four points.
#inv("R1", "F2")

- The point estimate survives firm and year effects

- The event study shows the same jump

The estimate is stable across every specification.
