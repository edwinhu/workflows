# Constraint: writing-ai-smell-structure

**Severity:** soft  
**Applies to:** writing-draft, writing-review, writing-revise

## What it checks

Flags formulaic structural openers at paragraph start that are statistically associated with AI-generated prose. All patterns fire only on the **first line of a prose paragraph** (after a blank line, heading, blockquote, or document start) — not mid-paragraph — to minimize false positives from these phrases appearing legitimately in subordinate clauses or running text.

Scans `drafts/*.md`. Skips YAML frontmatter, fenced code blocks, blockquotes, footnote definitions, and HTML comments.

## Patterns flagged

| Pattern | Label | Notes |
|---------|-------|-------|
| `In summary,` / `In conclusion,` / `In closing,` / `In sum,` | `structure:summary-opener` | Mechanical paragraph openers. Volokh: delete or lead with substance. |
| `To summarize` | `structure:to-summarize` | Same pattern, different phrasing. |
| `Despite [noun phrase], ...` | `structure:despite-formula` | AI "challenges" formula: "Despite its success, X faces challenges..." |
| `Furthermore,` / `Furthermore:` | `structure:filler-furthermore` | Filler transition. Volokh: cut or find the actual logical link. |
| `Moreover,` / `Moreover:` | `structure:filler-moreover` | Filler transition. |
| `In addition,` / `In addition:` | `structure:filler-in-addition` | Filler transition. (Does not fire for "In addition to X" — no comma.) |
| `Additionally,` / `Additionally:` | `structure:filler-additionally` | Filler transition. |
| `That said,` / `That said:` | `structure:filler-that-said` | Soft pivot marker; often adds nothing. |
| `With that said,` | `structure:filler-with-that-said` | Same pattern, verbose. |

## False positive guidance

**Filler transitions** (`Furthermore,` `Moreover,` `Additionally,` `In addition,`) appear legitimately in law review writing to signal logical sequence. These fire frequently on any structured academic draft. The violation is advisory: consider whether the transition word is doing real logical work or just filling a slot.

**`In conclusion,`** at the start of a concluding paragraph is standard law review practice (e.g., "In conclusion, this Article has argued that..."). This is a soft warning, not a rejection — it flags the phrase for review, not for removal.

**`Despite X, Y`** — the concessive opener is formulaic only when overused or when "X" is promotional ("Despite its success..."). "Despite the court's holding in *X*, the doctrine remains..." is legitimate legal writing. Review the specific landing: does the "Y" clause add substance or just reassert the positive case?

## Deferred for v3

- **Elegant variation** (using synonyms to avoid repeating a key term) — requires semantic analysis
- **Rule of three** (formulaic triple-clause lists) — tricky regex, high false-positive risk
