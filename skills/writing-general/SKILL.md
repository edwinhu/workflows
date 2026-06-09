---
name: writing-general
description: Internal skill for Strunk & White writing rules. Loaded by /writing for quick edits or as base layer for domain skills.
user-invocable: false
disable-model-invocation: true
---

# General Writing Rules (Strunk & White)

Foundational style guide for clear, concise prose based on Strunk & White's Elements of Style.

## Core Principles

### The Iron Law of Good Writing

**Omit needless words.**

Every word must earn its place. Vigorous writing is concise. A sentence should contain no unnecessary words, a paragraph no unnecessary sentences.

### Critical Rules

| Rule | Explanation |
|------|-------------|
| Write in prose | Avoid bullet points and lists unless explicitly requested |
| Use active voice | "The committee approved the plan" not "The plan was approved" |
| Be concrete | Specific details over vague abstractions |
| Put statements in positive form | Say what something is, not what it isn't |
| Use definite language | Avoid hedging, qualifiers, and weasel words |

### Red Flags

- About to add qualifiers "to be safe" → STOP. Hedging weakens the writing; make definite assertions.
- About to reformat prose into bullet points → STOP. Write prose paragraphs unless lists were explicitly requested.
- About to formalize the register → STOP. Formality usually means wordiness; write naturally, then edit.
- About to add emphasis → STOP. Overemphasis dilutes meaning; let strong words speak.

### Delete & Restart Triggers

**If you catch yourself writing ANY of these, DELETE THE SENTENCE and START FRESH:**

| Anti-Pattern | Restart Approach |
|---|---|
| "It is [adjective] that..." | Rewrite as direct assertion |
| "There are [X] reasons" | Replace with direct list or synthesis |
| "In order to" | Replace with "to" |
| Sentence > 40 words with nested clauses | Break into 2-3 sentences |
| Passive voice hiding the actor | Name the actor, use active voice |

After deleting, restart the sentence with THE POINT first, then evidence.

**Skipping the deletion pass is NOT HELPFUL — the user publishes bloated prose that buries their argument.** Identify violations and purge them.

## Editing Checklist

### Sentence Level
- Remove unnecessary words ("in order to" → "to")
- Replace weak verbs ("is able to" → "can")
- Convert passive to active voice
- Eliminate redundancies ("past history" → "history")

### Paragraph Level
- Ensure each paragraph has one main idea
- Check topic sentences lead clearly
- Verify logical flow between paragraphs

### Word Level
- Replace abstract nouns with concrete ones
- Use specific verbs over vague ones + adverbs
- Cut filler words ("very", "really", "quite", "rather")

## Quick Reference: Common Fixes

| Weak | Strong |
|------|--------|
| utilize | use |
| in order to | to |
| due to the fact that | because |
| at this point in time | now |
| in the event that | if |
| prior to | before |
| subsequent to | after |
| with regard to | about |
| a large number of | many |
| is able to | can |

## Progressive Disclosure

For comprehensive guidance, consult:

- **`references/elements-of-style.md`** - Complete Strunk & White guide covering:
  - Elementary Rules of Usage (commas, colons, participles)
  - Elementary Principles of Composition (paragraph unity, active voice)
  - Words and Expressions Commonly Misused
  - Style guidance and literary reminders

## Examples

**Weak original:**
> It is important to note that there are a variety of different factors that contribute to the overall success of the project in question.

**Strong revision:**
> Several factors determine project success.

**Weak original:**
> The report was written by the team and was subsequently reviewed by management prior to being distributed to stakeholders.

**Strong revision:**
> The team wrote the report, management reviewed it, and stakeholders received it.

## Integration

After completing any writing task, invoke `/ai-anti-patterns` to check for AI writing indicators.
