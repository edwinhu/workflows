---
name: ds
description: "This skill should be used when the user asks to 'start data analysis', 'brainstorm analysis approach', 'plan a data project', 'clarify analysis requirements', or needs the data science workflow."
allowed-tools: Read, Grep, Glob, Bash, Skill, TodoWrite
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-brainstorm-no-exploration-guard.py"
---

## Contents

- [The Iron Law of DS Brainstorming](#the-iron-law-of-ds-brainstorming)
- [What Brainstorm Does](#what-brainstorm-does)
- [Critical Questions to Ask](#critical-questions-to-ask)
- [Process](#process)
- [Output](#output)

## Session Resume Detection

Before starting, check for an existing handoff:

1. Check if `.planning/HANDOFF.md` exists
2. **If found:** Read it and present to user:
   - Show the phase, task progress, and Next Action from the handoff
   - Ask: "Resume from handoff, or start fresh?"
   - If resume: skip to the recorded phase
   - If fresh: proceed with brainstorm
3. **If not found:** Proceed normally with Phase 1 (brainstorm)

## Context Monitoring

| Level | Remaining Context | Action |
|-------|------------------|--------|
| Normal | >35% | Proceed normally |
| Warning | 25-35% | Complete current question round, then trigger ds-handoff |
| Critical | ≤25% | Immediately trigger ds-handoff — do not start new question rounds |

# Brainstorming (Questions Only)

Refine vague analysis requests into clear objectives through Socratic questioning.
**NO data exploration, NO coding** - just questions and objectives.

**Load shared enforcement first.**

Auto-load all constraints matching `applies-to: ds`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py ds`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Brainstorming

**ASK QUESTIONS BEFORE ANYTHING ELSE. This is not negotiable.**

Before loading data, before exploring, before proposing approaches, you MUST:
1. Ask clarifying questions using AskUserQuestion
2. Understand what the user actually wants to learn
3. Identify data sources and constraints
4. Define success criteria
5. Only THEN propose analysis approaches

**STOP - You're about to load data or explore before asking questions. Don't do this.**
</EXTREMELY-IMPORTANT>

## What Brainstorm Does

| DO | DON'T |
|-------|----------|
| Ask clarifying questions | Load or explore data |
| Understand analysis objectives | Run queries |
| Identify data sources | Profile data (that's /ds-plan) |
| Define success criteria | Create visualizations |
| Ask about constraints | Write analysis code |
| Check if replicating existing analysis | Propose specific methodology |

**Brainstorm answers: WHAT and WHY**
**Plan answers: HOW (data profile + tasks)** (separate skill)

## Critical Questions to Ask

### Data Source Questions
- What data sources are available?
- Where is the data located (files, database, API)?
- What time period does the data cover?
- How frequently is the data updated?

### Objective Questions
- What question are you trying to answer?
- Who is the audience for this analysis?
- What decisions will be made based on results?
- What would a successful outcome look like?

### Constraint Questions
- **Are you replicating an existing analysis?** (Critical for methodology)
- Are there specific methodologies required?
- What is the timeline for this analysis?
- Are there computational resource constraints?

### Output Questions
- What format should results be in (report, dashboard, model)?
- What visualizations are expected?
- How will results be validated?

## Process

### 1. Ask Questions First

Employ `AskUserQuestion` immediately:
- **One question at a time** - never batch
- **Multiple-choice preferred** - easier to answer
- Focus on: objectives, data sources, constraints, replication requirements

### Smart-Discuss: Batch Ambiguities

When multiple analysis questions arise, batch them into ONE AskUserQuestion call:

**Batched (fast — 1 round-trip):**
```python
AskUserQuestion(questions=[
  {"question": "Primary dataset?", "options": [{"label": "CRSP"}, {"label": "Compustat"}, {"label": "Both merged"}]},
  {"question": "Sample period?", "options": [{"label": "2000-2024"}, {"label": "2010-2024"}, {"label": "Custom"}]},
  {"question": "Frequency?", "options": [{"label": "Monthly"}, {"label": "Quarterly"}, {"label": "Annual"}]}
])
```

**When to batch:** After understanding the research question, if 3+ independent questions arise, batch them.
**When NOT to batch:** If a question's answer changes what other questions to ask (e.g., dataset choice affects available variables).

### 2. Identify Replication Requirements

**CRITICAL:** Ask early if replicating existing work:

```
AskUserQuestion:
  question: "Are you replicating or extending existing analysis?"
  options:
    - label: "Replicating existing"
      description: "Must match specific methodology/results"
    - label: "Extending existing"
      description: "Building on prior work with modifications"
    - label: "New analysis"
      description: "Fresh analysis, methodology flexible"
```

When replicating:
- Obtain reference to original (paper, code, report)
- Document exact methodology requirements
- Define acceptable deviation from original results

### 3. Propose Approaches

After objectives are clear:
- Propose **2-3 different approaches** with trade-offs
- **Lead with recommendation** (mark as "Recommended")
- Use `AskUserQuestion` for the user to select the preferred approach

### 4. Write Spec Doc

After selecting an approach:
- Write to `.planning/SPEC.md`
- Include: objectives, data sources, success criteria, constraints
- **NO implementation details** - reserve those for /ds-plan

```markdown
# Spec: [Analysis Name]

> **For Claude:** After writing this spec, discover and load the ds-plan skill for Phase 2:
>Read `${CLAUDE_SKILL_DIR}/../../skills/ds-plan/SKILL.md` and follow its instructions.

## Objective
[What question this analysis answers]

## Data Sources
- [Source 1]: [location, format, time period]
- [Source 2]: [location, format, time period]

## Requirements

Assign each requirement a unique ID using `CATEGORY-NN` format (e.g., `DATA-01`, `VIZ-02`, `STAT-03`). Categories come from natural groupings in the analysis.

| ID | Requirement | Scope |
|----|-------------|-------|
| [CAT-01] | [Requirement 1] | v1 |
| [CAT-02] | [Requirement 2] | v1 |

Scope: `v1` = must complete, `v2` = nice to have, `out-of-scope` = explicitly excluded.

## Success Criteria
- [ ] [CAT-01] [Criterion]
- [ ] [CAT-02] [Criterion]

## Constraints
- Replication: [yes/no - if yes, reference source]
- Timeline: [deadline]
- Methodology: [required approaches]

## Chosen Approach
[Description of selected approach]

## External Skills Likely In Play
<!-- List plugin skills whose data/tools will be touched. ds-plan Step 5b will Glob their references/ and examples/ before drafting tasks. -->
- [e.g. wrds — holdings/voting data via SAS on WRDS grid]
- [e.g. gemini-batch — LLM extraction for text fields]
- [none]

## Rejected Alternatives
- Option B: [why rejected]
- Option C: [why rejected]
```

## Gate: Exit Brainstorm

**Checkpoint type:** human-verify (SPEC.md content is machine-verifiable)

Before transitioning to ds-plan, execute this gate:

```
1. IDENTIFY → SPEC.md exists at `.planning/SPEC.md`
2. RUN      → Read(".planning/SPEC.md")
3. READ     → Verify it contains: Objectives, Data Sources, Requirements (with CATEGORY-NN IDs), Success Criteria sections
4. VERIFY   → User has confirmed the objectives via AskUserQuestion response (not agent self-assessment).
              Check: was AskUserQuestion called and did user respond affirmatively?
5. CLAIM    → Only proceed to ds-plan if ALL checks pass
```

**If ANY check fails, do NOT proceed. Fix the gap first.**

**Self-assessment is not user confirmation. If the user hasn't explicitly approved the objectives via AskUserQuestion, you haven't finished brainstorm.**

## Output

Declare brainstorm complete when:
- Analysis objectives clearly understood
- Data sources identified
- Success criteria defined
- Constraints documented (especially replication requirements)
- Approach chosen from alternatives
- `.planning/SPEC.md` written
- User confirms ready for data exploration

## Workflow Context

This skill is Phase 1 of the 5-phase `/ds` workflow:

```
┌──────────────┐    ┌──────────┐    ┌──────────────┐    ┌───────────┐    ┌───────────┐
│ ds-brainstorm│───→│ ds-plan  │───→│ ds-implement │───→│ ds-review │───→│ ds-verify │
│  SPEC.md     │    │ PLAN.md  │    │ LEARNINGS.md │    │ APPROVED? │    │ COMPLETE? │
└──────────────┘    └──────────┘    └──────────────┘    └─────┬─────┘    └─────┬─────┘
                                         ↑                    │                │
                                         └── CHANGES REQ'D ───┘                │
                                         ↑                                     │
                                         └──── NEEDS WORK ────────────────────┘
```

1. **Phase 1: ds-brainstorm** (current) - Clarify objectives through Socratic questioning
2. **Phase 2: ds-plan** - Profile data and break analysis into tasks
3. **Phase 3: ds-implement** - Execute analysis tasks with output-first verification
4. **Phase 4: ds-review** - Review methodology, data quality, and statistical validity (max 3 cycles)
5. **Phase 5: ds-verify** - Check reproducibility and obtain user acceptance

## No Pause After Brainstorm

<EXTREMELY-IMPORTANT>
**After user confirms objectives, IMMEDIATELY proceed to ds-plan. Do NOT ask "should I continue?" or "ready to proceed?"**

DO NOT:
- Ask "should I continue?" (the user already confirmed objectives — a second confirmation request is a stall, not courtesy)
- Summarize what was agreed (SPEC.md IS the summary; repeating it wastes context)
- Treat this as a stopping point (the workflow is sequential — brainstorm done = plan starts, no gap)
</EXTREMELY-IMPORTANT>

## Phase Summary

After writing SPEC.md, update it with structured frontmatter:

```yaml
---
phase: ds-brainstorm
status: completed
implements: [all requirement IDs assigned in this phase]
requires: [user input]
provides: [.planning/SPEC.md]
affects: [.planning/]
tags: [brainstorm, objectives, requirements]
---
```

**One-liner rule:** Must be SUBSTANTIVE. Good: "Panel regression study of CEO pay-performance sensitivity using CRSP-Compustat 2000-2024". Bad: "Brainstorm complete".

## Phase Complete

After completing brainstorm, dispatch the spec reviewer before proceeding:

```
Phase 1: Brainstorm -> SPEC.md written
  -> Dispatch ds-spec-reviewer subagent
  -> If APPROVED -> proceed to ds-plan
  -> If ISSUES_FOUND -> fix SPEC.md -> re-dispatch reviewer (max 5 iterations)
```

**Step 1:** Discover and load the spec reviewer skill:
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-spec-reviewer/SKILL.md` and follow its instructions.

**Step 2:** Only after reviewer returns APPROVED, discover and load the next phase:
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-plan/SKILL.md` and follow its instructions.

Fallback (if Read fails): `/ds-plan`

**CRITICAL:** Do not skip to analysis implementation. Phase 2 profiles data and breaks down the analysis into discrete, manageable tasks.
**CRITICAL:** Do not skip spec review. An unreviewed spec means profiling the wrong data and planning the wrong analysis.
