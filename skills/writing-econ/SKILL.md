---
name: writing-econ
description: Internal skill for economics and finance writing. Loaded by /writing when style=econ. Based on McCloskey's "Economical Writing".
includes:
  - writing-general   # Base writing rules (Strunk & White)
  - ai-anti-patterns  # Quality check on /writing-revise
user-invocable: false
disable-model-invocation: true
---

# Economics and Finance Writing

Style guide for economics journal articles, working papers, and finance analysis based on Deirdre McCloskey's *Economical Writing*.

## On Skill Load

**Step 1: Load base writing rules**

Read `${CLAUDE_SKILL_DIR}/../../skills/writing/SKILL.md` and follow its instructions.

**Step 2: Resolve canonical writing context**

For a modern writing episode, resolve the receipt-selected immutable `{planFile, planHash}` and read `## Writing Intent` for the style, thesis, audience, and claims. If the plan’s style is not `econ`, return control to the writing router rather than mutating configuration.

If no authenticated canonical writing plan exists, suggest `/writing` to create and approve one. A legacy-only layout is conversion input, not active authority.

**Step 3: Apply econ-specific rules below**

## When to Use

Invoke this skill for:
- Economics journal articles and working papers
- Finance analysis and market commentary
- Policy briefs and economic reports
- Editing economics/finance prose for clarity

**For general writing**: Use `/writing` skill (Strunk & White)
**For legal writing**: Use `/writing-legal` skill (Volokh)

## Enforcement

### IRON LAW #1: NO BOILERPLATE WITHOUT DELETE & RESTART

If you write ANY of these, DELETE the draft and START OVER:
- "This paper discusses..."
- Table-of-contents paragraph
- "As we shall see"
- "It is interesting to note that..."
- "The rest of this paper is organized as follows..."

These signal you haven't found your hook. Start fresh with a compelling finding.

### IRON LAW #2: NO ELEGANT VARIATION

One concept = One word. If you catch yourself varying terms ("industrialization" / "development" / "growth") for the same concept, you are confusing the reader. Pick ONE term and use it consistently.

### Econ Writing Facts

- Describing an empirical strategy without understanding its identification assumption is a fatal methodological gap — referees reject papers for it, and not addressing endogeneity is the canonical fatal omission. Pattern-matching the design from similar papers is not econometric reasoning; presenting it as such is an unverified claim wearing a methods section.
- Openers like "In recent years..." read as AI filler to academic readers — an opening written "to seem academic" destroys credibility before the finding lands.

### Red Flags

- About to write a "standard introduction" → STOP. Find the hook first.
- About to leave boilerplate in place "to improve later" → STOP. Fix it now or restart — boilerplate left in stays in.
- About to vary terms for the same concept → STOP. Consistency beats variation; the reader thinks varied terms are different concepts.
- About to keep a phrase because "readers expect it" → STOP. Expectations can be wrong.

### Delete & Restart Pattern

**When to delete and restart:**

1. **Boilerplate detected in first paragraph** → Delete entire intro, write finding-first
2. **Three different terms for same concept** → Delete section, pick ONE term
3. **Table-of-contents paragraph exists** → Delete it, no replacement needed
4. **Metric conversions every time** → Delete all but first, trust reader

**How to restart:**

```
Old: "This paper discusses the relationship between X and Y..."
New: "Trade liberalization increased wages by 15% for skilled workers."
```

Restart with THE FINDING, not with throat-clearing.

## Core Principles

### Speak to One Reader

Choose an implied reader and stick with her. A skeptical but sympathetic colleague. Keep the prose at one level of difficulty. If it embarrasses you to imagine how she would read it, the stuff is embarrassing.

### Avoid Boilerplate

| Anti-Pattern | Why It Fails |
|--------------|--------------|
| "This paper discusses..." | Bores the reader; use a hook instead |
| Table-of-contents paragraph | Readers skip it; they can't understand until they've read the paper |
| Background/padding | If you discovered it was beside the point, don't include it |
| "As we shall see" | Useless anticipation; the reader will see soon enough |
| Metric conversions every time | Shows you think the reader is an ignoramus |

Never repeat without apologizing ("as I said earlier"). If apologizing too much, you're repeating too much.

### Control Tone

- Avoid invective: "This is pure nonsense" arouses suspicion the argument is weak
- Delete every "very" and "absolutely" - most things aren't
- Use wit to compensate for strong opinions
- Relax the pose of The Scientist; write like a human being

### One Point Per Paragraph

End each paragraph with a simple, street-talk encapsulation. The paragraph can be technical as long as the last sentence comes down a notch. It makes the paragraph sing.

### Make Tables Self-Explanatory

The reader should understand the table without the main text. Use words in headings, not acronyms. "Logarithm of Domestic Price" not "LPDOM". Follow Tufte: no chart junk, have a point.

Use meaningful labels in equations: "Quantity of Grain = 3.56 + 5.6(Price of Grain)" not "Q = 3.56 + 5.6P where Q is..."

### Make Writing Cohere

Repeat key words to link sentences. (AB)(BC)(CD) is easy to understand. The figure is called polyptoton. English achieves coherence by repetition, not by "not only...but also" which marks you as incompetent.

## Word Choice

### Avoid Elegant Variation

Use one word to mean one thing. A paper used: "industrialization," "growing structural differentiation," "economic and social development," "development," "economic growth," "growth," and "revolutionized means of production" to mean the same thing. Don't.

When uncertain, look back and use the same word.

### Key Principles

| Principle | Example |
|-----------|---------|
| Be concrete | "sheep and wheat" not "natural resource-oriented exports" |
| Untie Teutonisms | "equalization of the prices of factors" not "factor price equalization" |
| Avoid ersatz economics | Never use "skyrocketing," "fair prices," "vicious cycle," "exploit" |
| Avoid this-ism | Replace *this*, *these*, *those* with *the* |

See `references/economical-writing-full.md` for extended bad words list, Teutonism examples, and ersatz economics vocabulary.

## Quick Reference

| Problem | Solution |
|---------|----------|
| "This paper discusses X" | Hook the reader with the finding |
| Table-of-contents paragraph | Delete it; readers skip it anyway |
| "As we shall see" | Delete; anticipation is useless |
| Elegant variation | Use the same word for the same thing |
| Five-dollar words | Anglo-Saxon roots are more concrete |
| Noun pile-ups | Untie with "of" |
| This/that/these/those | Replace with "the" |
| "Not only...but also" | Just use "and" |

## Progressive Disclosure

For comprehensive guidance, consult:

### Reference File

- **`references/economical-writing-full.md`** - Complete McCloskey guide covering:
  - 35 rules with full explanations and examples
  - Extended bad words list with usage notes
  - Historical and etymological context

### When to Load Reference

Load the full reference when:
- Encountering specific vocabulary questions
- Needing detailed examples for economics jargon
- Working on substantial manuscript revision
- Teaching economics writing

## Integration

After completing any economics writing task, invoke `/ai-anti-patterns` to check for AI writing indicators. The `/writing` skill covers general prose principles (active voice, omit needless words) that complement this skill.
