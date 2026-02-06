---
name: workflow-creator
description: "This skill should be used when the user asks to 'create a workflow', 'design a workflow', 'audit workflow', 'improve workflow', 'break down a task into phases', 'add enforcement patterns', or needs to design structured multi-phase processes for LLM agents."
version: 0.1.0
---

**Announce:** "Using workflow-creator to design/audit/improve a structured workflow."

Detect mode from user request, then follow the corresponding process below.

---

## Mode 1: Create New Workflow

### Step 1: Ground in Philosophy

Read `${CLAUDE_PLUGIN_ROOT}/PHILOSOPHY.md`. Every workflow must trace back to the three pillars: phased decomposition, deterministic gates, adversarial review.

### Step 2: Interview

Use AskUserQuestion to understand the domain:

1. **What kind of work?** (code, data, writing, research, other)
2. **What's the deliverable?** (working feature, analysis report, polished document, etc.)
3. **What are the common failure modes?** (skipping tests, shallow analysis, weak arguments, etc.)
4. **When does drift happen?** (implementation without design, conclusions without evidence, etc.)

### Step 3: Propose Phase Decomposition

Design phases where each phase has:
- **Name** - verb-noun (e.g., explore-codebase, design-approach)
- **Responsibility** - ONE question this phase answers
- **Gate condition** - verifiable exit criterion (file exists, test passes, artifact contains X)
- **Enforcement needs** - high/medium/low based on drift risk

Present 2-3 topologies to the user:
- **Linear** - phase 1 → phase 2 → ... → phase N (best for predictable work)
- **Branching** - routing based on input type (best for varied work like writing)
- **Iterative** - phases with loops (best for exploratory work like DS)

### Step 4: Apply Enforcement Patterns

Read `${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/references/enforcement-checklist.md`.

For each phase, score which of the 11 patterns are needed:
- **High-drift phases** (implementation, verification): Iron Laws, Rationalization Tables, Gate Functions, Honesty Framing
- **Medium-drift phases** (design, review): Gate Functions, Red Flags, Staged Review Loops
- **Low-drift phases** (brainstorm, exploration): Red Flags only (creative phases need freedom)

Generate the specific enforcement content:
- Write Iron Laws with `<EXTREMELY-IMPORTANT>` tags
- Build Rationalization Tables from the failure modes identified in Step 2
- Define Red Flags + STOP for each phase's common wrong-path indicators

### Step 5: Generate Workflow Files

Create the following artifacts:
1. **Entry command** (`commands/[name].md`) - routes to first phase
2. **Phase skills** (`lib/skills/[name]-[phase]/SKILL.md`) - one per phase
3. **Wire up transitions** - each phase ends by reading the next phase's skill

Present complete file list for user approval before writing.

---

## Mode 2: Audit Existing Workflow

### Step 1: Read the Workflow

Read the workflow's entry command and ALL phase skills. Build a map of phases, transitions, and enforcement.

### Step 2: Score Against Three Pillars

**Phased decomposition:**
- Does each phase have a single responsibility?
- Are phase boundaries clear?
- Can phases be executed out of order? (they shouldn't be)

**Deterministic gates:**
- Are gates verifiable programmatically? (file exists, content check)
- Or are they just prose? ("ensure quality is high")
- Are there ungated transitions?

**Adversarial review:**
- Is there a review phase?
- Does it use confidence scoring?
- Does it check spec deviation?
- Is honesty framing present?

### Step 3: Score Against Enforcement Checklist

Read `${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/references/enforcement-checklist.md`.

For each of the 11 patterns, score:
- **Present** - pattern exists and is well-implemented
- **Weak** - pattern exists but is insufficient (e.g., soft language instead of Iron Law)
- **Absent** - pattern is missing where it should exist

Identify the highest-drift phases with the weakest enforcement - these are the critical gaps.

### Step 4: Output Audit Report

Format:

```
## Audit: [Workflow Name]

### Pillar Scores
- Phased decomposition: [score] - [notes]
- Deterministic gates: [score] - [notes]
- Adversarial review: [score] - [notes]

### Enforcement Coverage
| Pattern | Phase 1 | Phase 2 | ... | Phase N |
|---------|---------|---------|-----|---------|
| Iron Laws | ✅/⚠️/❌ | ... | ... | ... |
| ... | ... | ... | ... | ... |

### Critical Gaps
1. [Highest priority gap + recommendation]
2. [Second priority gap + recommendation]
...

### Recommendations
[Specific, actionable changes]
```

---

## Mode 3: Improve Workflow

### Step 1: Identify Gaps

Take audit findings (from Mode 2) or user-identified issues. List each gap with its severity.

### Step 2: Generate Fixes

For each gap, generate the specific addition:

- **Missing Iron Law** → Write the law with `<EXTREMELY-IMPORTANT>` tags and strong framing
- **Missing Rationalization Table** → Identify 5-10 common excuses for that phase, write Excuse → Reality → Do Instead table
- **Weak gate** → Propose verifiable condition (file exists, content contains X, command output matches Y)
- **Missing review** → Design adversarial check with confidence scoring and honesty framing
- **Missing Red Flags** → Identify 3-5 wrong-path indicators for the phase

### Step 3: Present Changes

Show each proposed change in context (which file, where in the file, what's added). Get user approval before applying.

### Step 4: Apply Changes

Edit the skill files with the approved changes. Verify each file is syntactically valid after editing.

---

<EXTREMELY-IMPORTANT>
## Iron Laws of Workflow Creation

### NO WORKFLOW WITHOUT PHILOSOPHY
Every workflow must trace back to the three pillars. If you can't explain how a phase serves phased decomposition, deterministic gates, or adversarial review, the phase doesn't belong.

### NO PHASE WITHOUT A GATE
If there's no verifiable exit condition, it's not a real phase - it's a suggestion. Define what artifact or condition proves the phase is complete.

### NO HIGH-DRIFT PHASE WITHOUT ENFORCEMENT
Identify where the agent is most tempted to shortcut. Enforce hardest there. Implementation and verification phases ALWAYS need Iron Laws.
</EXTREMELY-IMPORTANT>

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Creating a workflow without reading PHILOSOPHY.md | You'll miss the foundational principles | Read it first, every time |
| Skipping the user interview | You'll design for an imagined domain, not the real one | Ask the four questions |
| Writing soft language instead of Iron Laws | LLMs ignore polite suggestions | Use strong framing with EXTREMELY-IMPORTANT tags |
| Proposing ungated phase transitions | Quality will die at the ungated boundary | Define a verifiable gate condition |
| Designing all phases with equal enforcement | Drift risk varies by phase | Score enforcement density per phase |

## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "This workflow is simple, doesn't need enforcement" | Simple workflows drift fastest because the agent thinks it can shortcut | Add enforcement proportional to drift risk |
| "Iron Laws feel too aggressive" | LLMs ignore polite suggestions. Strong framing works. | Write the Iron Law. It will be ignored if weakened. |
| "Not every phase needs a gate" | Ungated phases are where quality dies | Define a verifiable gate condition |
| "The user will catch errors in review" | Relying on human review defeats the purpose of the workflow | Build adversarial review INTO the workflow |
| "I'll add enforcement later" | Later never comes. Enforcement debt compounds. | Add it now, refine through use |
| "This domain is different, dev patterns don't apply" | The three pillars are universal. Enforcement density varies, principles don't. | Apply pillars, adjust density |
