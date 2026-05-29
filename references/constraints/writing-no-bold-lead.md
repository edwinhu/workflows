---
name: writing-no-bold-lead
description: No bold-lead paragraph patterns in prose drafts — inline-header lists are AI tells
applies-to: [writing-draft, writing-review, writing-revise]
---

## Rule

Prose paragraphs must not begin with a bold inline header followed by descriptive text. The pattern `**Bold Label.** Sentence continues...` is an AI formatting artifact documented in Wikipedia's "Signs of AI writing" guide and in `ai-anti-patterns/references/05-formatting-and-typography.md`.

Acceptable alternatives:
- Regular prose topic sentence (preferred)
- Italic label when genre requires structural markers (`*The objection.* Sentence...`)
- Actual markdown headings (`### Heading`) when the section is long enough to warrant one

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

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Bold labels help the reader scan" | Readers scan via headings and topic sentences, not bold inline labels | Use a heading or write a clear topic sentence |
| "This is standard academic formatting" | No law review uses bold inline headers in body text | Write prose paragraphs |
| "The structure needs visual markers" | If you need markers, use italic or actual headings | Use `*italic*` or `###` |
| "It's just formatting, not content" | Formatting signals genre — this signals AI generation | Remove the bold pattern |
