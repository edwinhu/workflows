---
name: writing-brainstorm
description: Internal skill for project setup. Called by /writing for new projects. Creates PRECIS.md and OUTLINE.md, then loads appropriate domain skill.
---

# Writing Brainstorm

**Entry point for all writing projects.** Creates PRECIS.md (thesis, audience, claims) and OUTLINE.md (structure), then hands off to domain-specific writing skill.

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

**Each level expands the previous.** Don't skip levels:
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
echo "scratch/" >> .gitignore
```

## Writing Workflow Overview

```
/writing (entry point)
    │
    └── lib/skills/writing-brainstorm/ (this skill)
            │
            ├── Interview → .claude/PRECIS.md
            ├── Structure → .claude/OUTLINE.md
            └── Handoff → .claude/ACTIVE_WORKFLOW.md
                    │
                    ▼
            lib/skills/writing-outline/ (per section)
                    │
                    └── outlines/[Section] (Outline).md
                            │
                            ▼
            lib/skills/writing-[domain]/
            (legal | econ | general)
                    │
                    └── drafts/[Section] (Draft).md
                    └── Edit loop (hook suggests /writing-edit)
                            │
                            ▼
                    /writing-edit (verify + polish + complete)
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
  subagent_type="general-purpose",
  model="haiku",  # Fast and cheap for filtering
  prompt="""Search Readwise for highlights about **[THEME]**.

Use `mcp__readwise__search_readwise_highlights` with:
- vector_search_term: "[semantic search terms]"
- full_text_queries: [{"field_name": "highlight_plaintext", "search_term": "[keyword]"}]

Return ONLY:
- Top 3 most relevant sources (title, author)
- Top 3 quotes worth citing (with source attribution)
- 1-2 sentence theme summary"""
)
```

### Example: Law Review on Private Equity Access

Launch 5 parallel agents:
1. "private equity retail investors democratization"
2. "accredited investor definition regulation"
3. "401k retirement private markets"
4. "interval fund tender offer evergreen"
5. "investor protection paternalism securities"

Each returns ~100 words instead of ~5000 words of raw highlights.

---

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

### Gathering Mode (Progressive Workflow)

When user has a topic ("gather sources on X"), follow this **human-in-the-loop** workflow:

#### Phase 1: Clarify Intent

**BEFORE any search**, use `AskUserQuestion` to understand:

```
AskUserQuestion(questions=[
  {
    "question": "What's your primary angle or thesis for this piece?",
    "header": "Angle",
    "options": [
      {"label": "Critique existing framework", "description": "Argue current approach is flawed"},
      {"label": "Propose reform", "description": "Offer specific policy changes"},
      {"label": "Comparative analysis", "description": "Compare approaches across jurisdictions"},
      {"label": "Empirical analysis", "description": "Present data-driven findings"}
    ],
    "multiSelect": false
  },
  {
    "question": "Who is your target audience?",
    "header": "Audience",
    "options": [
      {"label": "Law review", "description": "Academic legal audience"},
      {"label": "Practitioners", "description": "Lawyers, regulators, compliance"},
      {"label": "Policy makers", "description": "Legislators, agency staff"},
      {"label": "General educated", "description": "Informed non-specialists"}
    ],
    "multiSelect": false
  }
])
```

#### Phase 2: Search Sources

1. **Decompose into themes** based on clarified intent
   - Break the topic into 3-6 distinct search themes
   - Each theme becomes a parallel sub-agent search

2. **Launch parallel sub-agents**
   - Use the Task tool with `model="haiku"` for each theme
   - Run all searches in a single message (parallel execution)
   - See "Sub-Agent Pattern" section above

3. **Synthesize results**
   - Deduplicate sources across agent responses
   - Identify the strongest quotes from each theme
   - Note gaps (themes with few/no highlights)

#### Phase 3: Draft Outline → `OUTLINE.md`

Save the outline to a file for iteration:

```markdown
# OUTLINE.md

## Working Title
[Title]

## Thesis
[One-sentence claim]

## Target Audience
[From Phase 1]

## Structure
### I. Introduction
### II. [Section]
### III. [Section]
...

## Key Sources
[Deduplicated from Phase 2]

## Open Questions
[Gaps to address]
```

**Ask for feedback** on the outline before proceeding.

#### Phase 4: Section Deep-Dive

For each major section, use `AskUserQuestion` to refine:

```
AskUserQuestion(questions=[
  {
    "question": "For Section II (Background), what level of detail do you need?",
    "header": "Depth",
    "options": [
      {"label": "Brief context", "description": "1-2 paragraphs, assume reader familiarity"},
      {"label": "Full background", "description": "Comprehensive treatment for general reader"},
      {"label": "Synthesis only", "description": "Synthesize precedents without detailed summaries"}
    ],
    "multiSelect": false
  }
])
```

Create `SECTION-II-OUTLINE.md` with:
- Section thesis/purpose
- Key arguments in order
- Supporting sources mapped to arguments
- Anticipated counterarguments

Repeat for each section, getting human feedback before moving to prose.

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

**User:** "I want to write something but don't know what"

**Process:**
1. Fetch tags → find clusters like "antitrust", "market-power", "regulation"
2. Get recent highlights → notice many from economics sources
3. Analyze → tension between "consumer welfare" and "market structure" keeps appearing
4. Present → "Potential topic: The consumer welfare standard debate. You have 12 highlights across 4 sources discussing this tension. Angle: Why market structure matters beyond prices."
5. Domain detection → Economics sources detected → "Use `/writing-econ` for drafting"

### Gathering Mode Example (Progressive)

**User:** "Let's brainstorm a law review article about retail access to private equity"

**Process:**
1. **Clarify** → AskUserQuestion: angle (critique/reform/comparative), audience (law review/practitioners)
2. **User responds** → "Critique existing framework, law review audience"
3. **Decompose** → 5 themes: PE retail access, accredited investor, 401(k) access, fund structures, investor protection
4. **Search** → Launch 5 parallel Haiku sub-agents
5. **Synthesize** → Dedupe sources, extract best quotes, note gaps
6. **Save** → Write `docs/writing/OUTLINE.md`
7. **Feedback** → "Here's the outline. Any sections to add/remove/reorder?"
8. **User responds** → "Add comparative section on EU ELTIF"
9. **Deep-dive** → AskUserQuestion per section, create `SECTION-II-OUTLINE.md`
10. **Handoff** → "Outline complete. Use `/writing-legal` to draft."

---

## Phase 5: Create PRECIS.md

After clarifying intent and gathering sources, create the foundational PRECIS document.

### Interview for PRECIS

Use `AskUserQuestion` to gather remaining details:

```
AskUserQuestion(questions=[
  {
    "question": "What is your thesis in one sentence?",
    "header": "Thesis",
    "options": [
      {"label": "I have a thesis", "description": "I will type it"},
      {"label": "Help me find it", "description": "Synthesize from sources"},
      {"label": "Critique: X is wrong", "description": "Argue against existing view"},
      {"label": "Propose: X should change", "description": "Recommend reform"}
    ],
    "multiSelect": false
  },
  {
    "question": "What is the strongest objection to your thesis?",
    "header": "Counter",
    "options": [
      {"label": "I know it", "description": "I will describe the objection"},
      {"label": "Find from sources", "description": "What do critics say?"},
      {"label": "Steel-man for me", "description": "Generate the best counter"}
    ],
    "multiSelect": false
  }
])
```

### PRECIS.md Template

Write to `.claude/PRECIS.md`:

```markdown
# Precis: [Working Title]

## Thesis
[One sentence - the core argument]

## Audience
[From earlier interview - who is reading, what they know/believe]

## Purpose
[What reader should think/do/believe after reading]

## Hook
[Concrete problem, controversy, or question that opens the piece - draft or TBD]

## Key Claims
1. [Claim 1] → supports thesis by...
2. [Claim 2] → supports thesis by...
3. [Claim 3] → supports thesis by...

## Counterarguments to Address
1. **[Objection]**: [description]
   - Response: [how we will address it]
   - Section: [where it appears]

## Scope
### In
- [What we cover]

### Out
- [What we explicitly exclude and why]

## Domain
[legal | econ | general] → determines which writing skill to use
```

---

## Phase 6: Create OUTLINE.md

Structure the argument with sections mapped to claims from PRECIS.md.

### OUTLINE.md Template

```markdown
# Outline: [Title from PRECIS]

## Structure

### I. Introduction
- **Goal**: Hook reader, state thesis, roadmap
- **Hook**: [from PRECIS or TBD]
- **Thesis**: [from PRECIS]
- **Claims preview**: [list from PRECIS]

### II. [Section Name]
- **Goal**: [what this section accomplishes]
- **Claim supported**: [which claim from PRECIS]
- **Key points**:
  - Point A (sources: ...)
  - Point B (sources: ...)
- **Transition to next**: [how it leads to Section III]

### III. [Section Name]
- **Goal**: [what this section accomplishes]
- **Claim supported**: [which claim from PRECIS]
- **Key points**:
  - [points with sources]

### IV. Counterarguments
- **Goal**: Address objections from PRECIS
- **Objection 1**: [from PRECIS] → Response
- **Objection 2**: [from PRECIS] → Response

### V. Conclusion
- **Goal**: Restate thesis with earned authority
- **Implications**: What follows from this argument
- **Future questions**: What remains unresolved

## Key Sources
[Deduplicated from search phase]

## Open Questions
[Gaps to address before drafting]
```

---

## Phase 7: Handoff to Domain Skill

After PRECIS.md and OUTLINE.md are complete, set up the writing workflow.

### Create ACTIVE_WORKFLOW.md

Create `.claude/ACTIVE_WORKFLOW.md` to track workflow state:

```yaml
---
workflow: writing
style: [legal|econ|general]  # From PRECIS domain field
phase: draft
project_root: [current directory]
precis: .claude/PRECIS.md
outline: .claude/OUTLINE.md
current_part: [if multi-part document]
edits_since_verify: 0
verify_threshold: 10
skill_stack:
  - writing
  - writing-[domain]
---
```

### Announce Handoff

After creating workflow state:

```
Writing workflow initialized.

Project: [directory name]
Style: [legal/econ/general]
Phase: draft

Files created:
- .claude/PRECIS.md (thesis, audience, claims)
- .claude/OUTLINE.md (structure)
- .claude/ACTIVE_WORKFLOW.md (workflow state)

Next: Load the domain skill to begin drafting.
Read("${CLAUDE_PLUGIN_ROOT}/skills/writing-[domain]/SKILL.md")

Commands available:
- /writing-verify - Check structure against PRECIS and OUTLINE
- /writing-polish - Final pass with anti-patterns check
- /writing-done - Complete workflow
```

---

## Domain Detection

Detect domain from sources and topic to determine skill:

| Domain Indicators | Internal Skill | Style Value |
|-------------------|----------------|-------------|
| Legal cases, statutes, law reviews, constitutional | writing-legal | legal |
| Economics, markets, policy, data, empirical | writing-econ | econ |
| General/other | writing-general | general |

---

## Integration

After brainstorming completes, load internal skills:
- `lib/skills/writing-outline/` - Create detailed section outlines (Level 3)
- `lib/skills/writing-general/` - General prose (Strunk & White)
- `lib/skills/writing-econ/` - Economics/finance (McCloskey)
- `lib/skills/writing-legal/` - Law review articles (Volokh)

User command:
- `/writing-edit` - Verify structure, check anti-patterns, complete workflow
