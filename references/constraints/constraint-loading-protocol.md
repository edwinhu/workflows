---
name: constraint-loading-protocol
description: Every phase touching prose MUST load ALL constraint layers before editing
applies-to: [writing-draft, writing-validate, writing-review, writing-revise]
---

## Rule

Every phase that touches draft prose MUST load ALL constraint layers before editing. Prior context may be compressed or lost — the midpoint must be self-contained.

### Required Layers

| Layer | What | When |
|-------|------|------|
| **Workflow state** | `.planning/ACTIVE_WORKFLOW.md` | Always |
| **Structural intent** | `.planning/PRECIS.md`, `.planning/OUTLINE.md` | Always |
| **Domain skill** | `writing-legal`, `writing-econ`, or `writing-general` based on `style` in ACTIVE_WORKFLOW | Before any prose work (drafting, reviewing, revising) |
| **AI anti-patterns** | `Skill(skill="workflows:ai-anti-patterns")` | Before any prose work (drafting, reviewing, revising) |

### Domain Skill Loading Table

| Style in ACTIVE_WORKFLOW | Skill to Read() |
|--------------------------|-----------------|
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
1. Before drafting a legal article section: Read ACTIVE_WORKFLOW.md → Read PRECIS.md and OUTLINE.md → Read `skills/writing-legal/SKILL.md` → Load ai-anti-patterns → Begin drafting.
2. Before reviewing: Same full loading sequence, then invoke review.

### Incorrect
1. "I loaded the domain skill" → Begin drafting without ai-anti-patterns. Result: prose with legal citations but full of AI writing smell.
2. "I remember the rules from the last section" → Begin drafting without re-reading skill files. Result: context-compressed hallucination of rules.

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I loaded the domain skill, that's enough" | Domain skill doesn't catch AI writing smell | Load ai-anti-patterns too |
| "ai-anti-patterns covers the basics" | It doesn't know legal citation rules or econ style | Load domain skill too |
| "I remember the rules from earlier" | Context may be compressed; you're guessing | Read() the skill files every time |
| "This is just a quick fix" | Quick fixes without constraints introduce new violations | Load constraints, then fix |

**Editing with partial constraints is NOT HELPFUL — the user publishes prose that passes one quality check but fails another.** Both constraint layers exist because each catches problems the other misses.

## Red Flags

- **"I already loaded the constraints earlier"** → STOP. Context compression may have erased them. Read() the skill files again.
- **"This is just a minor edit"** → STOP. Minor edits without constraints introduce new violations.
- **"I only need the domain skill for this section"** → STOP. Both layers are always required for prose work.
- **"Loading constraints takes too long"** → STOP. Loading takes seconds. Fixing constraint violations after publication takes hours.
