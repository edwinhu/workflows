---
name: writing-ai-smell-em-dash
description: AI-writing-smell check for em-dash overuse in prose
applies-to: [writing-draft, writing-review, writing-revise, workshop, workshop-revise]
---

# Constraint: writing-ai-smell-em-dash

**Severity:** soft  
**Applies to:** writing-draft, writing-review, writing-revise

## What it checks

Flags paragraphs with excessive em-dash density. LLMs overuse em-dashes — inherited from novel training data — in places where human writers use commas, parentheses, or colons. This sign is most useful in combination with other indicators from `writing-ai-smell-puffery`.

Scans `drafts/*.md`. Skips YAML frontmatter, fenced code blocks, blockquotes, footnote definitions, and HTML comments.

## Two signals

**`[em-dash:density]`** — Paragraph contains 4 or more em-dashes. Legitimate legal prose rarely exceeds 3 em-dashes per paragraph. Threshold is conservative to avoid flagging passages with paired em-dash parentheticals ("The rule—often called X—provides that…").

**`[em-dash:colon-combo]`** — Em-dash appears immediately adjacent to a colon (`—:` or `:—`). This combination is not standard punctuation in any major style guide and suggests AI formatting.

## False positive guidance

- Two em-dashes per sentence for a parenthetical clause is legitimate — a 200-word paragraph with two such clauses may have 4 em-dashes without being AI-generated.
- The density threshold (4) is set to fire rarely on well-edited prose; if it fires on a paragraph, review whether the em-dashes could be replaced with commas, parentheses, or colons.
- This check fires most reliably when combined with puffery or artifact violations in the same file — a single em-dash violation in otherwise clean prose is likely a false positive.

## Fix guidance

Review flagged paragraphs for sentences using em-dashes where commas or parentheses would serve equally well. Legal writing generally prefers parenthetical parentheses over paired em-dashes. If em-dashes are stylistically intentional and the paragraph is clean otherwise, suppress the violation.
