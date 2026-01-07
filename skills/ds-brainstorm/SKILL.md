---
name: ds-brainstorm
description: "REQUIRED Phase 1 of /ds workflow. Uses Socratic questioning to clarify goals, data sources, and constraints."
---

**Announce:** "I'm using ds-brainstorm (Phase 1) to gather analysis requirements."

## Contents

- [The Iron Law of DS Brainstorming](#the-iron-law-of-ds-brainstorming)
- [What Brainstorm Does](#what-brainstorm-does)
- [Critical Questions to Ask](#critical-questions-to-ask)
- [Process](#process)
- [Red Flags - STOP If You're About To](#red-flags---stop-if-youre-about-to)
- [Output](#output)

# Brainstorming (Questions Only)

Refine vague analysis requests into clear objectives through Socratic questioning.
**NO data exploration, NO coding** - just questions and objectives.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Brainstorming

**ASK QUESTIONS BEFORE ANYTHING ELSE. This is not negotiable.**

Before loading data, before exploring, before proposing approaches, you MUST:
1. Ask clarifying questions using AskUserQuestion
2. Understand what the user actually wants to learn
3. Identify data sources and constraints
4. Define success criteria
5. Only THEN propose analysis approaches

**If you catch yourself about to load data or explore before asking questions, STOP.**
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

Use `AskUserQuestion` immediately:
- **One question at a time** - never batch
- **Multiple-choice preferred** - easier to answer
- Focus on: objectives, data sources, constraints, replication requirements

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

If replicating:
- Get reference to original (paper, code, report)
- Document exact methodology requirements
- Define acceptable deviation from original results

### 3. Propose Approaches

Once objectives are clear:
- Propose **2-3 different approaches** with trade-offs
- **Lead with recommendation** (mark as "Recommended")
- Use `AskUserQuestion` for user to pick

### 4. Write Spec Doc

After approach is chosen:
- Write to `.claude/SPEC.md`
- Include: objectives, data sources, success criteria, constraints
- **NO implementation details** - that's for /ds-plan

```markdown
# Spec: [Analysis Name]

> **For Claude:** After writing this spec, use `Skill(skill="workflows:ds-plan")` for Phase 2.

## Objective
[What question this analysis answers]

## Data Sources
- [Source 1]: [location, format, time period]
- [Source 2]: [location, format, time period]

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Constraints
- Replication: [yes/no - if yes, reference source]
- Timeline: [deadline]
- Methodology: [required approaches]

## Chosen Approach
[Description of selected approach]

## Rejected Alternatives
- Option B: [why rejected]
- Option C: [why rejected]
```

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Load data | Exploring before understanding goals | Ask what user wants to learn |
| Run describe() | Data profiling is for /ds-plan | Finish objectives first |
| Propose specific model | Jumping to HOW before WHAT | Define success criteria first |
| Create task list | Planning before objectives clear | Complete brainstorm first |
| Skip replication question | Methodology may be constrained | Always ask about replication |

## Output

Brainstorm complete when:
- Analysis objectives clearly understood
- Data sources identified
- Success criteria defined
- Constraints documented (especially replication requirements)
- Approach chosen from alternatives
- `.claude/SPEC.md` written
- User confirms ready for data exploration

## Phase Complete

**REQUIRED SUB-SKILL:** After completing brainstorm, IMMEDIATELY invoke:
```
Skill(skill="workflows:ds-plan")
```
