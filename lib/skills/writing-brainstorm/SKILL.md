---
name: writing-brainstorm
description: Internal skill for brainstorming writing projects. Called by /writing for mode detection, source gathering, and topic exploration.
---

# Writing Brainstorm

**Entry point for all writing tasks.** Routes to quick mode or project workflow.

## Step 1: Detect Mode

**Quick Mode Indicators** (edit text directly, no workflow):
- “Check this paragraph”
- “Edit this text”
- “Review my writing”
- Short text provided inline
- No mention of “project”, “paper”, “article”

→ If quick mode: `Read(“${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-general/SKILL.md”)` and apply rules to text.

**Project Mode Indicators** (full workflow):
- “Write a paper on...”
- “Start a law review article”
- “Draft an economics paper”
- Mentions thesis, argument, research

→ If project mode: Continue to Phase 2 below.

## Step 2: Check for Active Workflow

```
if .claude/ACTIVE_WORKFLOW.md exists:
    Read(“.claude/ACTIVE_WORKFLOW.md”)
    Read(“.claude/PRECIS.md”)
    Read(“.claude/OUTLINE.md”)
    → Resume at current phase with appropriate domain skill
else:
    → Continue to Phase 3 (new project setup)
```

---

## Project Mode Workflow

Creates PRECIS.md (thesis, audience, claims) and OUTLINE.md (structure), then hands off to domain-specific writing skill.

## Project Structure

Writing projects should follow this standardized structure:

```
project-name/
├── .claude/
│   ├── ACTIVE_WORKFLOW.md      # Workflow state (auto-created)
│   ├── PRECIS.md               # Thesis, audience, claims, counterarguments
│   └── OUTLINE.md              # Master document structure
├── outlines/                    # Detailed section/part outlines
│   ├── Part I (Outline).md
│   ├── Part II (Outline).md
│   └── ...
├── drafts/                      # Prose drafts (expanded from outlines)
│   ├── Part I (Draft).md
│   ├── Part II (Draft).md
│   └── ...
├── references/                  # Source materials, notes
│   ├── sources.md               # Bibliography / source list
│   └── [topic-notes].md         # Research notes by topic
└── scratch/                     # Working files (gitignored)
    └── brainstorm-notes.md
```

### Directory Purposes

| Directory | Purpose | Tracked in Git |
|-----------|---------|----------------|
| `.claude/` | Workflow state + high-level docs (PRECIS, OUTLINE) | Yes |
| `outlines/` | Detailed outlines per section/part | Yes |
| `drafts/` | Prose versions of outlines | Yes |
| `references/` | Sources, research notes | Yes |
| `scratch/` | Temporary working files | No |

### Progressive Expansion Workflow

Writing proceeds through levels of detail:

```
.claude/PRECIS.md          # Level 1: Thesis, claims, audience
       ↓
.claude/OUTLINE.md         # Level 2: Master structure (sections, goals)
       ↓
outlines/Part I.md         # Level 3: Detailed section outline (bullets, sources)
       ↓
drafts/Part I.md           # Level 4: Prose expansion
```

**Each level expands the previous.** Don’t skip levels:
- PRECIS before OUTLINE
- Master OUTLINE before section outlines
- Section outline before drafting prose

### File Naming Convention

For multi-part documents:
- Section outlines: `outlines/Part I (Outline).md`
- Prose drafts: `drafts/Part I (Draft).md`

For single documents:
- Master outline in `.claude/OUTLINE.md` is sufficient
- Draft: `drafts/draft.md` or `drafts/[title].md`

### Creating Project Structure

When starting a new writing project, create the directories:

```bash
mkdir -p outlines drafts references scratch .claude
echo “scratch/” >> .gitignore
```

## Writing Workflow Overview

```
/writing (entry point)
    │
    └── lib/skills/writing-brainstorm/ (this skill)
            │ Mode detect, source gathering, topic exploration
            │ GATE: Sources gathered, domain detected
            │
            └── lib/skills/writing-setup/ (project foundation)
                    │ PRECIS.md, OUTLINE.md, ACTIVE_WORKFLOW.md
                    │ GATE: All three files exist with required content
                    │
                    └── lib/skills/writing-outline/ (per section)
                            │ outlines/[Section] (Outline).md
                            │ GATE: Outline cross-references PRECIS claims
                            │
                            └── lib/skills/writing-draft/ (per section)
                                    │ Domain skill loaded (legal/econ/general)
                                    │ drafts/[Section] (Draft).md
                                    │ GATE: All sections drafted with depth
                                    │
                                    └── /writing-edit (verify + polish + complete)
```

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

## Critical: Sub-Agent Pattern for Readwise Searches

**NEVER call `search_readwise_highlights` directly from the main chat.** Raw search results return 50-100+ highlights, polluting context and degrading conversation quality.

**ALWAYS use parallel sub-agents** (one per search theme) to:
1. Execute the search
2. Filter and deduplicate results
3. Return a condensed summary

### Sub-Agent Pattern

For a topic with N distinct themes, launch N parallel sub-agents using the Task tool:

```
Task(
  subagent_type=”general-purpose”,
  model=”haiku”,  # Fast and cheap for filtering
  prompt=”“”Search Readwise for highlights about **[THEME]**.

Use `mcp__readwise__search_readwise_highlights` with:
- vector_search_term: “[semantic search terms]”
- full_text_queries: [{“field_name”: “highlight_plaintext”, “search_term”: “[keyword]”}]

Return ONLY:
- Top 3 most relevant sources (title, author)
- Top 3 quotes worth citing (with source attribution)
- 1-2 sentence theme summary”“”
)
```

### Example: Law Review on Private Equity Access

Launch 5 parallel agents:
1. “private equity retail investors democratization”
2. “accredited investor definition regulation”
3. “401k retirement private markets”
4. “interval fund tender offer evergreen”
5. “investor protection paternalism securities”

Each returns ~100 words instead of ~5000 words of raw highlights.

---

## Two Modes

### Discovery Mode

When user wants to find topics (“what should I write about?”):

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

### Gathering Mode (Progressive Workflow)

When user has a topic (“gather sources on X”), follow this **human-in-the-loop** workflow:

#### Phase 1: Clarify Intent

**BEFORE any search**, use `AskUserQuestion` to understand:

```
AskUserQuestion(questions=[
  {
    “question”: “What’s your primary angle or thesis for this piece?”,
    “header”: “Angle”,
    “options”: [
      {“label”: “Critique existing framework”, “description”: “Argue current approach is flawed”},
      {“label”: “Propose reform”, “description”: “Offer specific policy changes”},
      {“label”: “Comparative analysis”, “description”: “Compare approaches across jurisdictions”},
      {“label”: “Empirical analysis”, “description”: “Present data-driven findings”}
    ],
    “multiSelect”: false
  },
  {
    “question”: “Who is your target audience?”,
    “header”: “Audience”,
    “options”: [
      {“label”: “Law review”, “description”: “Academic legal audience”},
      {“label”: “Practitioners”, “description”: “Lawyers, regulators, compliance”},
      {“label”: “Policy makers”, “description”: “Legislators, agency staff”},
      {“label”: “General educated”, “description”: “Informed non-specialists”}
    ],
    “multiSelect”: false
  }
])
```

#### Phase 2: Search Sources

1. **Decompose into themes** based on clarified intent
   - Break the topic into 3-6 distinct search themes
   - Each theme becomes a parallel sub-agent search

2. **Launch parallel sub-agents**
   - Use the Task tool with `model=”haiku”` for each theme
   - Run all searches in a single message (parallel execution)
   - See “Sub-Agent Pattern” section above

3. **Synthesize results**
   - Deduplicate sources across agent responses
   - Identify the strongest quotes from each theme
   - Note gaps (themes with few/no highlights)

#### Phase 3: Synthesize and Present

Present a summary of findings to the user for confirmation:
- **Topic and angle** confirmed
- **Key themes** identified (3-6)
- **Source coverage** - strong/weak areas noted
- **Domain detected** (legal/econ/general)

**Ask for feedback** before proceeding to project setup.

The actual OUTLINE.md and PRECIS.md creation happens in the next phase (writing-setup), not here. Brainstorm's job is to gather and synthesize, not to create project artifacts.

## Output Format

Present brainstorm results as a summary:

```markdown
# [Topic Title]

## Thesis/Angle
[One-sentence framing]

## Key Sources
- **[Source 1]** by [Author]
  - “[Highlight quote]”
  - Relevant to: [subtopic]

## Outline
### [Subtopic 1]
- Point A (Source 1, Source 3)
- Point B (Source 2)

### [Subtopic 2]
...

## Open Questions
- [Questions highlights don’t answer]

## Next Steps
- Suggested writing skill: /writing-[domain]
```

## Domain Detection

After gathering sources, detect the topic domain and load the appropriate skill:

| Domain Indicators | Style | Skill to Load |
|-------------------|-------|---------------|
| Legal cases, statutes, law reviews, constitutional | legal | `lib/skills/writing-legal/SKILL.md` |
| Economics, markets, policy, data, empirical | econ | `lib/skills/writing-econ/SKILL.md` |
| General/other | general | `lib/skills/writing-general/SKILL.md` |

Domain-specific enforcement rules are applied during the **draft phase** (writing-draft skill), not during brainstorm. Brainstorm only detects the domain; enforcement happens later.

## Readwise MCP Tools

Primary tools for brainstorming:

| Tool | Use Case | Direct Call OK? |
|------|----------|-----------------|
| `get_tags` | Survey topic landscape | ✅ Yes |
| `get_recent_content` | See current reading themes | ✅ Yes |
| `search_readwise_highlights` | Find highlights by keyword | ❌ **Sub-agent only** |
| `get_highlights` | Retrieve with filters | ⚠️ Use caution (can be large) |
| `get_books` | Browse source library | ✅ Yes |

**Why sub-agents for search?** A single search can return 50-100 highlights (~5000+ tokens). Multiple searches compound this. Sub-agents filter to essentials before returning to main context.

## File Output Convention

Save brainstorming artifacts following the project structure defined above:

```
project/
├── .claude/
│   ├── PRECIS.md                   # Thesis, audience, claims
│   ├── OUTLINE.md                  # Master document structure
│   └── ACTIVE_WORKFLOW.md          # Workflow state
├── outlines/                        # Detailed section outlines
│   ├── Part I (Outline).md
│   └── ...
└── scratch/
    └── brainstorm-notes.md         # Working notes (gitignored)
```

## Workflow Examples

### Discovery Mode Example

**User:** “I want to write something but don’t know what”

**Process:**
1. Fetch tags → find clusters like “antitrust”, “market-power”, “regulation”
2. Get recent highlights → notice many from economics sources
3. Analyze → tension between “consumer welfare” and “market structure” keeps appearing
4. Present → “Potential topic: The consumer welfare standard debate. You have 12 highlights across 4 sources discussing this tension. Angle: Why market structure matters beyond prices.”
5. Domain detection → Economics sources detected → econ style will apply during drafting

### Gathering Mode Example (Progressive)

**User:** “Let’s brainstorm a law review article about retail access to private equity”

**Process:**
1. **Clarify** → AskUserQuestion: angle (critique/reform/comparative), audience (law review/practitioners)
2. **User responds** → “Critique existing framework, law review audience”
3. **Decompose** → 5 themes: PE retail access, accredited investor, 401(k) access, fund structures, investor protection
4. **Search** → Launch 5 parallel Haiku sub-agents
5. **Synthesize** → Dedupe sources, extract best quotes, note gaps
6. **Present** → "Here are the themes and sources. Confirm topic and angle?"
7. **User confirms** → "Yes, critique framework. Add comparative section on EU ELTIF."
8. **Handoff** → Proceed to writing-setup for PRECIS.md and OUTLINE.md creation

---

## Agent Team Pattern: Parallel Source Gathering

For topics with many research themes, agent teams can parallelize the librarian role. Instead of sequential sub-agent searches (which already work well), spawn teammates that each own a research domain and can challenge each other's findings:

```
Create a team with 3 researcher teammates:
- Teammate 1: Search for sources supporting the thesis
- Teammate 2: Search for sources opposing the thesis (steel-man)
- Teammate 3: Search for empirical evidence and data
Have them share findings and identify where sources conflict.
```

This produces better-grounded brainstorming than sequential searches because teammates find contradictions the agent would otherwise miss.

---

## Gate: Exit Brainstorm

Before proceeding to project setup:

1. **IDENTIFY**: What proves brainstorm is complete?
   - Topic confirmed by user
   - Domain detected (legal/econ/general)
   - Key sources identified (discovery or gathering mode complete)
2. **RUN**: Review the conversation - has the user confirmed a topic and angle?
3. **READ**: Check that sources were gathered (sub-agent results returned) or topic was selected (discovery mode)
4. **VERIFY**: User has confirmed topic, angle, and audience. Domain indicators are clear.
5. **CLAIM**: Only if steps 1-4 pass, proceed to writing-setup

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Jumping to PRECIS creation without source gathering | PRECIS without sources = thin argument | Gather sources first |
| Skipping the user interview about angle/audience | You'll brainstorm for the wrong audience | Ask the clarifying questions |
| Running a single search instead of parallel sub-agents | Single search misses themes | Decompose into 3-6 parallel searches |
| Detecting domain without checking source indicators | Wrong domain = wrong style enforcement later | Check the domain detection table |
| Moving to setup before user confirms the topic | User approval is the gate | Present findings, get confirmation |

## Next Phase

After brainstorm is complete, proceed to project setup:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-setup/SKILL.md")
```

Then follow its instructions immediately to create PRECIS.md, OUTLINE.md, and ACTIVE_WORKFLOW.md.
