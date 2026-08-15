---
name: typst-formatting
description: Typst formatting conventions — case names italic, em/en-dash syntax, escaped dollar signs, smart apostrophes after ), ] or .
type: convention
graduated: partial
check-script: formatting.py
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

## Rule — Formatting

| Element | Syntax | Example |
|---------|--------|---------|
| Case names | `_Case v. Party_` | `_SEC v. Howey_` |
| Key terms | `*emphasis*` | `*materiality*` |
| Greek letters | `$beta$` | |
| Casebook ref | `(CP XX)` | `(CP 120)` |
| Em-dash | `---` | separate clauses |
| En-dash (ranges) | `--` | `10--20`, `2020--2025` |
| Dollar sign | `\$` | `\$100 million` |
| Apostrophe after `)`, `]`, or `.` | `\u{2019}s` | `§ 2(a)(3)\u{2019}s`, `J.R.\u{2019}s` |

**CRITICAL: Apostrophe after `)` or `]`** — Typst's smart-quote algorithm treats `'` after `)` or `]` as a LEFT quote, not possessive. Always use `\u{2019}s` in these positions.

### Smart Quotes / Apostrophes

Typst's smart-quote algorithm treats `'` after `)`, `]`, or `.` as an **opening** left single quote instead of a possessive apostrophe. This affects any possessive on a parenthetical reference or abbreviated name:

```typst
// WRONG: renders as left quote (')
§ 2(a)(3)'s definition
J.R.'s strategy

// CORRECT: explicit right single quote (')
§ 2(a)(3)\u{2019}s definition
J.R.\u{2019}s strategy
```

The pattern to watch for: any `)'s`, `]'s`, or `.'s` in running text. Use `\u{2019}` (Unicode RIGHT SINGLE QUOTATION MARK) instead of a literal `'` in these positions.
