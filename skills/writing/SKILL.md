---
name: writing
description: "This skill should be used when the user asks to 'write a paper', 'start a writing project', 'draft an article', 'write about', 'brainstorm writing topics', 'gather sources for a paper', 'what should I write about', or needs the writing workflow entry point for source gathering, topic discovery, and project setup before outlining and drafting."
---

# Writing

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
    └── skills/writing/ (this skill)
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
                                    └── /writing-review (diagnose → REVIEW.md)
                                            │ Hierarchical review: section → transition → document
                                            │ .claude/REVIEW.md
                                            │ GATE: All sections reviewed, all levels complete
                                            │
                                            └── /writing-revise (fix from REVIEW.md + complete)
```

## When to Use

Invoke this skill for:
- Discovering what to write about from reading patterns
- Gathering sources and references for a known topic
- Finding thematic connections across highlights
- Building an outline with supporting quotes

## Prerequisites

Source searching is handled by the **librarian agent** (`workflows:librarian`), which routes through NLM first, then Readwise via opencode. You do NOT need direct Readwise MCP access.

## Critical: ALL Source Searches Go Through Librarian

<EXTREMELY-IMPORTANT>
**NEVER call Readwise MCP tools directly. NEVER spawn general-purpose agents for searches.**

ALL source gathering MUST go through the librarian agent, which enforces:
1. Check NLM first (curated knowledge)
2. Readwise via opencode (context-safe, 1M window)
3. Structured output (sources, quotes, synthesis)

**If you're about to call `mcp__readwise__*` or spawn a `general-purpose` agent for search, STOP.**
</EXTREMELY-IMPORTANT>

### Librarian Search Pattern

For a topic with N distinct themes, launch N parallel librarian agents:

```
Task(
  subagent_type="workflows:librarian",
  prompt="""Search for highlights and sources about **[THEME]**.

Check NLM notebooks first, then search Readwise.

Return ONLY:
- Top 3 most relevant sources (title, author)
- Top 3 quotes worth citing (with source attribution)
- 1-2 sentence theme summary"""
)
```

### Example: Law Review on Private Equity Access

Launch 5 parallel librarian agents:
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

1. **Survey knowledge base**
   - Dispatch librarian: "List NLM notebooks and summarize what topics are covered"
   - Dispatch librarian: "What are the most common tags and recent reading themes in Readwise?"

2. **Analyze patterns**
   - From librarian results, identify recurring themes, authors, or concepts
   - Look for: tensions, debates, unanswered questions, surprising connections

3. **Present topic candidates**
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

2. **Launch parallel librarian agents**
   - Use the Task tool with `subagent_type="workflows:librarian"` for each theme
   - Run all searches in a single message (parallel execution)
   - See "Librarian Search Pattern" section above

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

## Source Access Quick Reference

| Need | Action |
|------|--------|
| Survey topic landscape | Dispatch librarian: "What topics are in my NLM notebooks and Readwise tags?" |
| Find highlights by keyword | Dispatch librarian: "Search for highlights about [topic]" |
| Get book/article highlights | Dispatch librarian: "Get highlights from [title] and summarize" |
| Full document text | Dispatch librarian: "Fetch full text of articles tagged [tag]" |

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
4. **Search** → Launch 5 parallel librarian agents
5. **Synthesize** → Dedupe sources, extract best quotes, note gaps
6. **Present** → "Here are the themes and sources. Confirm topic and angle?"
7. **User confirms** → "Yes, critique framework. Add comparative section on EU ELTIF."
8. **Handoff** → Proceed to writing-setup for PRECIS.md and OUTLINE.md creation

---

## Agent Team Pattern: Parallel Source Gathering

For topics with many research themes, launch parallel librarian agents that each own a research angle:

```
# Launch 3 librarian agents in a SINGLE message (parallel)
Task(subagent_type="workflows:librarian", prompt="Search for sources SUPPORTING the thesis: [thesis]. Return top quotes and sources.")
Task(subagent_type="workflows:librarian", prompt="Search for sources OPPOSING the thesis: [thesis]. Steel-man the counterarguments.")
Task(subagent_type="workflows:librarian", prompt="Search for empirical evidence and data related to: [thesis]. Focus on numbers and findings.")
```

This produces better-grounded brainstorming than sequential searches because parallel agents find contradictions you'd otherwise miss.

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
| Running a single search instead of parallel librarian agents | Single search misses themes | Decompose into 3-6 parallel librarian searches |
| Calling Readwise MCP tools directly | Violates librarian Iron Law, pollutes context | Always dispatch workflows:librarian |
| Detecting domain without checking source indicators | Wrong domain = wrong style enforcement later | Check the domain detection table |
| Moving to setup before user confirms the topic | User approval is the gate | Present findings, get confirmation |

## Next Phase

After brainstorm is complete, proceed to project setup:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-setup/SKILL.md")
```

Then follow its instructions immediately to create PRECIS.md, OUTLINE.md, and ACTIVE_WORKFLOW.md.
