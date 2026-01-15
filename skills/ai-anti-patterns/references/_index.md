# Wikipedia: Signs of AI Writing

This directory contains sections from Wikipedia's "Signs of AI writing" guide, split for easier navigation and referencing. This is a field guide to help detect undisclosed AI-generated content, based on patterns observed across thousands of instances.

**Source:** [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)

## Table of Contents

### Core Concepts
- [@00-introduction.md](00-introduction.md) - Purpose, disclaimers, and statistical regression to the mean

### Content and Style Patterns (Rules 1-4)
- [@01-puffery-and-exaggeration.md](01-puffery-and-exaggeration.md) - "Stands as", "plays a vital role", superficial analyses with "-ing" phrases
- [@02-promotional-language.md](02-promotional-language.md) - "Rich tapestry", "nestled", "it's important to note" disclaimers
- [@03-structural-patterns.md](03-structural-patterns.md) - Section summaries, "Despite challenges" patterns, negative parallelisms, rule of three, weasel wording
- [@04-stylistic-quirks.md](04-stylistic-quirks.md) - Elegant variation, false ranges, title case in headings

### Formatting Issues (Rules 5-7)
- [@05-formatting-and-typography.md](05-formatting-and-typography.md) - Excessive boldface, inline-header lists, emojis, em dashes
- [@06-communication-patterns.md](06-communication-patterns.md) - Subject lines, collaborative phrases ("I hope this helps"), knowledge cutoff disclaimers, prompt refusal
- [@07-template-artifacts.md](07-template-artifacts.md) - Phrasal templates (Mad Libs style), placeholder text with brackets

### Technical Artifacts (Rules 8-10)
- [@08-markup-issues.md](08-markup-issues.md) - Markdown vs wikitext confusion, broken wikitext formatting
- [@09-chatgpt-specific-artifacts.md](09-chatgpt-specific-artifacts.md) - `turn0search0`, `contentReference`, `oaicite`, attribution JSON
- [@10-citation-problems.md](10-citation-problems.md) - Non-existent categories, dead links, hallucinated DOIs/ISBNs, incorrect reference syntax, `utm_source` parameters

### Meta-Analysis (Rule 11)
- [@11-meta-indicators.md](11-meta-indicators.md) - Abrupt cutoffs, writing style discrepancies, temporal considerations, AI-generated edit summaries, false indicators to avoid

## Usage for AI Agents

When reviewing or editing writing for AI-generated content indicators:

1. **Quick screening**: Start with [@09-chatgpt-specific-artifacts.md](09-chatgpt-specific-artifacts.md) and [@10-citation-problems.md](10-citation-problems.md) for the most objective, unambiguous signs
2. **Content analysis**: Review [@01-puffery-and-exaggeration.md](01-puffery-and-exaggeration.md) and [@03-structural-patterns.md](03-structural-patterns.md) for common rhetorical patterns
3. **Style checking**: Consult [@02-promotional-language.md](02-promotional-language.md) and [@04-stylistic-quirks.md](04-stylistic-quirks.md) for tone and vocabulary issues
4. **Format inspection**: Check [@05-formatting-and-typography.md](05-formatting-and-typography.md) and [@08-markup-issues.md](08-markup-issues.md) for formatting tells
5. **Avoid false positives**: Always review [@11-meta-indicators.md](11-meta-indicators.md) to understand what does NOT indicate AI use

## Key Principles

- **These are signs, not proof**: Multiple indicators together strengthen the case, but no single indicator is definitive
- **Context matters**: Some patterns appear in human writing too; use judgment
- **Focus on deeper issues**: Surface defects point to more serious problems like synthesis, original research, or copyright violations
- **Assume good faith**: False accusations can drive away new editors
- **Don't rely on detection tools**: AI detection software has significant error rates and cannot replace human judgment

## G15 Speedy Deletion Criteria

Only three indicators are sufficient for G15 speedy deletion:
1. Prompt refusal text ("As an AI language model...") - see [@06-communication-patterns.md](06-communication-patterns.md)
2. ChatGPT-specific artifacts (turn0search0, etc.) - see [@09-chatgpt-specific-artifacts.md](09-chatgpt-specific-artifacts.md)
3. Certain citation artifacts - see [@10-citation-problems.md](10-citation-problems.md)

All other signs require further investigation and are not grounds for immediate deletion.
