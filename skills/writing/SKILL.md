---
name: writing
description: This skill should be used when the user asks to "write an article", "draft a blog post", "edit prose", "review my writing", "check style", "improve clarity", or needs general writing guidance. Provides Strunk & White's Elements of Style for foundational grammar, usage, and composition principles.
---

# Writing and Editing

Foundational style guide for clear, concise prose based on Strunk & White's Elements of Style.

## When to Use

Invoke this skill for:
- Writing articles, blog posts, or general prose
- Editing text for clarity, conciseness, or style
- Reviewing grammar and usage
- Improving sentence structure and word choice

**For specialized domains:**
- Legal writing (law review articles): Use `/writing-legal` skill (Volokh)
- Economics/Finance: Use `/writing-econ` skill (McCloskey)

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

### Red Flags - Stop If You Think

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "I'll add some qualifiers to be safe" | Weakens the writing | Make definite assertions |
| "Let me list these points" | Bullet points are lazy | Write in prose paragraphs |
| "I should sound more formal" | Formality often means wordiness | Write naturally, then edit |
| "This needs more emphasis" | Overemphasis dilutes meaning | Let strong words speak |

## How to Use This Skill

### Before Writing

1. Identify the main point or thesis
2. Plan the structure: introduction, development, conclusion
3. Gather concrete examples to support claims

### During Drafting

1. Write complete sentences in paragraphs
2. Use active voice and strong verbs
3. Be specific: "three hours" not "a long time"
4. Avoid starting with "There is" or "It is"

### During Editing

Apply these checks in order:

**Sentence Level:**
- Remove unnecessary words ("in order to" → "to")
- Replace weak verbs ("is able to" → "can")
- Convert passive to active voice
- Eliminate redundancies ("past history" → "history")

**Paragraph Level:**
- Ensure each paragraph has one main idea
- Check topic sentences lead clearly
- Verify logical flow between paragraphs

**Word Level:**
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

### Reference Files

- **`references/elements-of-style.md`** - Complete Strunk & White guide covering:
  - Elementary Rules of Usage (commas, colons, participles)
  - Elementary Principles of Composition (paragraph unity, active voice)
  - Words and Expressions Commonly Misused
  - Style guidance and literary reminders

### When to Load References

Load the full reference when:
- Encountering specific grammar questions (comma usage, possessives)
- Needing detailed guidance on composition principles
- Checking whether specific words/expressions are commonly misused
- Working on substantial editing tasks

## Integration with AI Anti-Patterns

After completing any writing task, invoke `/ai-anti-patterns` to check for AI writing indicators. This plugin includes PostToolUse hooks that automatically warn on common anti-patterns in Write/Edit output.

## Examples

**Weak original:**
> It is important to note that there are a variety of different factors that contribute to the overall success of the project in question.

**Strong revision:**
> Several factors determine project success.

**Weak original:**
> The report was written by the team and was subsequently reviewed by management prior to being distributed to stakeholders.

**Strong revision:**
> The team wrote the report, management reviewed it, and stakeholders received it.

## Typography Tools

### Smart Quotes

Convert straight quotes (`"`) to typographic curly quotes (`""`):

```bash
python ${CLAUDE_PLUGIN_ROOT}/scripts/smartquotes.py file.md
python ${CLAUDE_PLUGIN_ROOT}/scripts/smartquotes.py file.md --check  # dry-run
```

Converts quotes and apostrophes while preserving em dashes and other formatting. Requires `pip install smartypants`.

## Related Skills

- `/ai-anti-patterns` - Detect and revise AI writing patterns
- `/writing-legal` - Academic legal writing (Volokh)
- `/writing-econ` - Economics and finance writing (McCloskey)
- `/docx` - Word document creation, editing, tracked changes
- `/pdf` - PDF extraction, creation, form filling
- `/pptx` - Presentation creation and editing
- `/xlsx` - Spreadsheet creation and analysis
