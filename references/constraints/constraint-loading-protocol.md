---
name: constraint-loading-protocol
description: Every phase touching prose MUST load ALL constraint layers before editing
applies-to: [writing-draft, writing-validate, writing-verify, writing-revise]
---

## Rule

Every phase that touches draft prose MUST load ALL constraint layers before editing. Prior context may be compressed or lost — the midpoint must be self-contained.

### Required Layers

| Layer | What | When |
|-------|------|------|
| **Workflow state** | the receipt-selected `{planFile, planHash}` | Always |
| **Structural intent** | the plan's deterministic section index and mapped outlines/drafts | Always |
| **Domain skill** | the domain skill selected by the plan's `style` field | Before any prose work (drafting, reviewing, revising) |
| **AI anti-patterns** | `Skill(skill="workflows:ai-anti-patterns")` | Before any prose work (drafting, reviewing, revising) |

### Domain Skill Loading Table

The domain skill is selected dynamically from `style` — skills do not hardcode the path.

| Style | Skill to load |
|-------|---------------|
| legal | `skills/writing-legal/SKILL.md` |
| econ | `skills/writing-econ/SKILL.md` |
| general | `skills/writing-general/SKILL.md` |

<EXTREMELY-IMPORTANT>
### Iron Law: Full Constraint Loading

**NO PROSE WORK WITHOUT ALL CONSTRAINT LAYERS. This is not negotiable.**

Editing with only domain skill loaded misses AI anti-patterns. Editing with only ai-anti-patterns loaded misses domain-specific rules. Both layers are required for drafting, reviewing, AND revising.
</EXTREMELY-IMPORTANT>

## Rationale

**Why this exists** — each constraint layer catches problems the others miss. Domain skills enforce citation style, argument conventions, and disciplinary norms. AI anti-patterns catch hollow hedging, sycophantic framing, and LLM writing smell. Loading only one layer creates false confidence: prose that passes one quality check but fails another. The user publishes work that looks polished but violates rules they explicitly asked to enforce.

## Examples

### Correct
1. Before drafting a legal article section: authenticate the receipt-selected plan → read its section index and mapped outline → read the `style`-selected domain skill (`skills/writing-legal/SKILL.md`) → load ai-anti-patterns → begin drafting.
2. Before reviewing: Same full loading sequence, then invoke review.

### Incorrect
1. "I loaded the domain skill" → Begin drafting without ai-anti-patterns. Result: prose with legal citations but full of AI writing smell.
2. "I remember the rules from the last section" → Begin drafting without re-reading skill files. Result: context-compressed hallucination of rules.

## Loading Facts

- The layers are not substitutes: the domain skill doesn't catch AI writing smell, and ai-anti-patterns doesn't know legal citation rules or econ style. Editing with one layer loaded produces prose that passes one quality check and fails the other — and the user publishes the failure.
- "I remember the rules from earlier" after context compression is a hallucination of rules, not a memory — Read() the skill files every time, even for a "quick fix". Loading takes seconds; fixing constraint violations after publication takes hours, so skipping it is counterproductive on its own terms.

## Red Flags

- **"I already loaded the constraints earlier"** → STOP. Context compression may have erased them. Read() the skill files again.
- **"This is just a minor edit"** → STOP. Minor edits without constraints introduce new violations.
- **"I only need the domain skill for this section"** → STOP. Both layers are always required for prose work.
- **"Loading constraints takes too long"** → STOP. Loading takes seconds. Fixing constraint violations after publication takes hours.
