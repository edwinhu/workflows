---
name: writing-brainstorm
description: This skill should be used when the user asks to "find something to write about", "brainstorm topics", "what should I write about", "find writing ideas", "gather sources for", "pull references on", or needs help discovering topics from their reading highlights. Leverages Readwise MCP to surface patterns and gather references.
---

# Writing Brainstorm

Generate writing topics and gather references from Readwise highlights.

## When to Use

Invoke this skill for:
- Discovering what to write about from reading patterns
- Gathering sources and references for a known topic
- Finding thematic connections across highlights
- Building an outline with supporting quotes

## Prerequisites

This skill requires the Readwise MCP server. The plugin auto-configures it, but the `READWISE_TOKEN` environment variable must be set.

**Setup (if MCP not working):**
1. Get API token from https://readwise.io/access_token
2. Set environment variable: `export READWISE_TOKEN=your_token`
3. Verify: `claude mcp list` should show `readwise`

## Two Modes

### Discovery Mode

When user wants to find topics ("what should I write about?"):

1. **Fetch tag landscape**
   - Use `get_tags` to see all topic clusters
   - Present tags grouped by frequency/recency

2. **Analyze recent reading**
   - Use `get_recent_content` to fetch recent highlights
   - Identify recurring themes, authors, or concepts

3. **Semantic pattern detection**
   - Examine highlights for cross-cutting themes
   - Look for: tensions, debates, unanswered questions, surprising connections

4. **Present topic candidates**
   - For each potential topic, show:
     - Theme description
     - Supporting highlights (2-3 examples)
     - Relevant tags
     - Potential angle or thesis

### Gathering Mode

When user has a topic ("gather sources on X"):

1. **Search highlights**
   - Use `search_highlights` with topic keywords
   - Use `search_by_tag` for relevant tags

2. **Expand search**
   - Identify related concepts from initial results
   - Search for those to broaden source base

3. **Compile references**
   - Group by source (book, article, etc.)
   - Include full citation info
   - Extract key quotes with context

4. **Build outline**
   - Organize sources by subtopic
   - Suggest structure based on source clustering

## Output Format

Produce a markdown outline:

```markdown
# [Topic Title]

## Thesis/Angle
[One-sentence framing]

## Key Sources
- **[Source 1]** by [Author]
  - "[Highlight quote]"
  - Relevant to: [subtopic]

## Outline
### [Subtopic 1]
- Point A (Source 1, Source 3)
- Point B (Source 2)

### [Subtopic 2]
...

## Open Questions
- [Questions highlights don't answer]

## Next Steps
- Suggested writing skill: /writing-[domain]
```

## Domain Detection

After gathering sources, detect the topic domain and suggest the appropriate writing skill:

| Domain Indicators | Suggested Skill |
|-------------------|-----------------|
| Legal cases, statutes, law reviews, constitutional | `/writing-legal` (Volokh) |
| Economics, markets, policy, data, empirical | `/writing-econ` (McCloskey) |
| General/other | `/writing` (Strunk & White) |

## Readwise MCP Tools

Primary tools for brainstorming:

| Tool | Use Case |
|------|----------|
| `get_tags` | Survey topic landscape |
| `get_recent_content` | See current reading themes |
| `search_highlights` | Find highlights by keyword |
| `get_highlights` | Retrieve with filters |
| `get_books` | Browse source library |

## Workflow Example

**User:** "I want to write something but don't know what"

**Process:**
1. Fetch tags → find clusters like "antitrust", "market-power", "regulation"
2. Get recent highlights → notice many from economics sources
3. Analyze → tension between "consumer welfare" and "market structure" keeps appearing
4. Present → "Potential topic: The consumer welfare standard debate. You have 12 highlights across 4 sources discussing this tension. Angle: Why market structure matters beyond prices."
5. Domain detection → Economics sources detected → "Use `/writing-econ` for drafting"

## Integration

After brainstorming:
- `/writing` - General prose drafting
- `/writing-econ` - Economics/finance articles
- `/writing-legal` - Law review articles
- `/ai-anti-patterns` - Check for AI writing indicators
