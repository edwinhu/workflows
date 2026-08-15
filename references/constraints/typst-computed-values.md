---
name: typst-computed-values
description: Never hardcode calculated numbers — extract base values from the source, then use the Typst calc module for everything derived
type: convention
graduated: false
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

## Rule

**Base values must be extracted from the paper first.** Then use Typst's `calc` module for derived values. Never type a number from memory — extract it from the paper's tables/figures, then compute.

**Never hardcode calculated numbers.** Use Typst's `calc` module:

```typst
#let start = 1e6
#let rate = 1.1
#let periods = 12
// WRONG: \$3.1 million
// RIGHT: \$#calc.round(start * calc.pow(rate, periods) / 1e6, digits: 1) million
```

If you catch yourself typing a dollar amount, percentage, or any derived number — STOP and write a `calc` expression.

## Computed Values / calc Module

The same rule in lecture material, where the derived number usually appears mid-sentence:

```typst
#let start = 1e6
#let rate = 1.1
#let periods = 12
// WRONG: After one year: \$3.1 million
// RIGHT: After one year: \$#calc.round(start * calc.pow(rate, periods) / 1e6, digits: 1) million
```

If you catch yourself typing a dollar amount, percentage, or any derived number — STOP and write a `calc` expression instead.
