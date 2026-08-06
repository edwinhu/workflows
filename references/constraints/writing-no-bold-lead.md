---
name: writing-no-bold-lead
description: No bold-lead paragraph patterns in prose drafts — inline-header lists are AI tells
applies-to: [writing-draft, writing-verify, writing-revise]
---

## Rule

Prose paragraphs must not begin with a bold inline header followed by descriptive text. The pattern `**Bold Label.** Sentence continues...` is an AI formatting artifact documented in Wikipedia's "Signs of AI writing" guide and in `ai-anti-patterns/references/05-formatting-and-typography.md`.

Acceptable alternatives:
- Regular prose topic sentence (preferred)
- Italic label when genre requires structural markers (`*The objection.* Sentence...`)
- Actual markdown headings (`### Heading`) when the section is long enough to warrant one

## Scope (v5.134.0)

**Format-agnostic.** The rule applies to markdown `**Bold Label.**`, Typst `#strong[Bold Label.]` and LaTeX `\textbf{Bold Label.}` alike. Before v5.134.0 the detector was a markdown-only regex over `<cwd>/drafts/*.md`, which is how a 620-line Typst comment letter carried 66 `#strong[]` spans through a full `writing-verify` pass unremarked.

**List items are exempt.** `+ **Market mirroring.** The block votes For and Against in proportion.` is not flagged. A numbered or bulleted list of defined scenarios is a list, and its items are *supposed* to carry labels; the AI tell is the bold inline header opening a **plain prose paragraph**. The case that settled this is `~/projects/mirror/paper/typst/body.typ:161-169`, a five-item numbered list of counterfactual voting rules. Flagging it would have made the rule unusable on the one local source carrying the most legitimate emphasis. (The inline-header *vertical list* pattern proper — bullet, bold header, colon, descriptive text, repeated — remains a reading call for the prose reviewer.)

**Exhibit captions are exempt.** `#strong[Table 1:] Headline reform comparison…` is the universal caption convention, not an inline header. This accounted for all five remaining out-of-table hits in the same file.

**Table cells are exempt.** Bold inside a `#table(…)` / `#figure(…)` argument group or a LaTeX `tabular` environment is never flagged by any emphasis rule; a correctly formatted results table would otherwise read as bold saturation.

## Where the detection lives

`scripts/prose-audit.py`, as `emphasis·bold-lead` — ONE implementation. This constraint's `check()` shells out to `prose-audit.py --json` per draft and filters for that label, keeping the `drafts/<file>:<line>: …` violation shape the mechanical gate names. Two implementations of one rule with different semantics is what `docs/DESIGN-prose-constraint-architecture.md` was written about.

## Rationale

Drafting subagents produce this pattern because their training data includes README files, listicles, and structured documents that use bold inline headers. In a law review article or academic paper, this reads as a structured list rather than prose. The user flagged it explicitly: "where did you get the idea that these bold paragraph start things count as prose?"

Observed failure modes:
- Part II data sources: `**Vote-level outcomes.**`, `**Proxy fight flags.**`, `**Activist blockholder shares.**`
- Part IV objections: `**The objection.**`, `**What the data show.**`, `**Response.**`
- Part II limitations: `**Static counterfactual caveat.**`, `**ISS Voting Analytics coverage.**`

## Examples

Wrong:
```markdown
**Proxy fight flags.** SharkRepellent Campaign Details identifies
2,123 definitive proxy fights.
```

Right:
```markdown
SharkRepellent Campaign Details, through December 2024, identifies
2,123 definitive proxy fights that proceeded to a shareholder vote.
```

Right (when structural label needed):
```markdown
*The objection.* A 5% activist stake could leverage mirror voting
to control a disproportionate share of total votes.
```

## Bold-Lead Facts

- No law review uses bold inline headers in body text; readers scan via headings and topic sentences, not bold labels. When the genre genuinely needs a structural marker, the alternatives are `*italic*` labels or actual `###` headings.
- Formatting signals genre — the `**Bold Label.**` pattern signals AI generation regardless of the content that follows it.
