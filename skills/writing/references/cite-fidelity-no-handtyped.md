---
name: cite-fidelity-no-handtyped
description: Footnote bodies must not contain hand-typed Bluebook citations (vol-LRev-page, italic-title-year, U.S.C. §, etc.) without a [@bibkey] reference — those bypass the bib and are unverifiable.
applies-to: [writing-draft, writing-revise]
type: constraint
check: cite-fidelity-lint:hand-typed-cite
---

# No hand-typed citations in footnote bodies

Every footnote `[^N]:` body that contains a Bluebook-style citation pattern
MUST also contain at least one `[@bibkey]` reference (or a bare `@bibkey`).
Hand-typed citations bypass the bib, are not cite-checked, and are the most
common vector for hallucinated sources.

## Mechanical check

The PostToolUse hook (`cite-fidelity-lint.py`) detects these patterns inside
footnote bodies:
- `\d+ {Journal Name} L. Rev. \d+` — vol-LRev-page form
- `\d+ {Journal Name} J. \d+` — vol-J-page form
- `U.S.C. §` — statute citation
- `\d+ Sup. Ct. \d+` — Supreme Court reporter
- `\d+ F. Supp. \d+`, `\d+ F.\d+d` — federal reporters
- `_Italic Title_, YYYY` / `*Italic Title*, YYYY` — italicized title with year
- `Vol. N` — generic volume reference

If any pattern matches and no `[@bibkey]` is present in the same footnote
body, the lint hook reports a WARN.

## Whitelist

If the hand-typed citation is intentional (e.g., a primary legal source
already cited inline that doesn't have a bib entry), include the literal
string `lint-allow-handcite` somewhere in the footnote body to silence the
warning for that footnote.

## Why

April 2026 incident: a Mirror Voting draft footnote contained `Jill E. Fisch,
*Empty Voting*, in The Cambridge Handbook ... 2018` — an entirely fabricated
book chapter. Web verification showed no such chapter exists. The agent
hand-typed the citation because the bib lacked the source, and the
write-then-check pipeline never re-examined hand-typed text. This constraint
forces every claim through the bib, where the cite-check pipeline can verify
it.

## Remedies

1. Add the source to the bib + NLM notebook, replace the hand-typed text
   with `[@bibkey]`.
2. Remove the citation if the claim doesn't need it.
3. Tag with `lint-allow-handcite` only if the cite is to a primary source
   that genuinely shouldn't be in the bib (statute text, case opinion).
