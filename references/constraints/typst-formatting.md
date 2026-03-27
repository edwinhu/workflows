---
name: typst-formatting
description: Typst formatting conventions — case names italic, em/en-dash syntax, escaped dollar signs, smart apostrophes after ) or ]
applies-to: [workshop, workshop-revise]
---

## Rule

| Element | Syntax | Example |
|---------|--------|---------|
| Case names | `_Case v. Party_` | `_SEC v. Howey_` |
| Key terms | `*emphasis*` | `*materiality*` |
| Em-dash | `---` | separate clauses |
| En-dash (ranges) | `--` | `10--20`, `2020--2025` |
| Dollar sign | `\$` | `\$100 million` |
| Smart apostrophe after `)` or `]` | `\u{2019}s` | `§ 2(a)(3)\u{2019}s` |

**CRITICAL: Apostrophe after `)` or `]`** — Typst's smart-quote algorithm treats `'` after `)` or `]` as a LEFT quote, not possessive. Always use `\u{2019}s` in these positions.
