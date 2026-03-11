---
name: workflow-creator
description: "This skill should be used when the user asks to 'create a workflow', 'design a workflow', 'audit workflow', 'improve workflow', 'break down a task into phases', 'add enforcement patterns', or needs to design structured multi-phase processes for LLM agents."
version: 0.1.0
---

**Announce:** "Using workflow-creator to design/audit/improve a structured workflow."

Detect mode from user request, then follow the corresponding process below.

**Note on workflow-creator's Structure:**

workflow-creator is a **meta-tool** that CREATES workflows. It is exempt from certain requirements it enforces on workflows it creates:

- **Two entry points:** workflow-creator has one entry with mode detection (not a multi-phase workflow). Workflows it creates MUST have two entry points.
- **Single responsibility per phase:** workflow-creator has 3 modes (toolkit, not workflow). Workflows it creates MUST have single-responsibility phases.

This document defines the PROCESS for creating workflows. The workflows created by this process must follow all principles from PHILOSOPHY.md.

---

## Mode 1: Create New Workflow

**IMPORTANT:** After completing each step, IMMEDIATELY proceed to the next step. Do not pause for user approval except where explicitly required (Step 4: Present Changes, Step 6: Get Approval).

### Step 1: Ground in Philosophy

Read `${CLAUDE_PLUGIN_ROOT}/PHILOSOPHY.md`. **You MUST read this file before proceeding. No claiming you "remember" it.** Every workflow must address: phased decomposition, gates (deterministic or judgment-based), independent verification, artifact review, iteration strategy, and two entry points.

**Gate: Philosophy Loaded**
- Verify PHILOSOPHY.md was read
- Check that your response references: phased decomposition, gates, independent verification, artifact review, iteration strategy, two entry points
- If you cannot explain these principles, re-read PHILOSOPHY.md

**After verifying Philosophy is loaded, IMMEDIATELY proceed to Step 2.**

### Step 2: Interview

Use AskUserQuestion to understand the domain:

1. **What kind of work?** (code, data, writing, research, other)
2. **What's the deliverable?** (working feature, analysis report, polished document, etc.)
3. **What are the common failure modes?** (skipping tests, shallow analysis, weak arguments, etc.)
4. **When does drift happen?** (implementation without design, conclusions without evidence, etc.)
5. **How should iteration work?** (one-shot with verification, serial hypothesis testing, parallel exploration, agent team review)

**Gate: Interview Complete**
- Verify AskUserQuestion was called
- Check that answers to all 5 questions are present
- If interview incomplete, ask remaining questions

**After verifying Interview is complete, IMMEDIATELY proceed to Step 3.**

### Step 3: Propose Phase Decomposition

Design phases where each phase has:
- **Name** - verb-noun (e.g., explore-codebase, design-approach)
- **Responsibility** - ONE question this phase answers (single responsibility principle)
- **Gate condition** - verifiable exit criterion (file exists, test passes, artifact contains X)
- **Enforcement needs** - high/medium/low based on drift risk

**Critical:** Each phase must have exactly ONE responsibility. If a phase does two things, split it into two phases. Phased decomposition means clean boundaries between concerns.

Present 2-3 topologies to the user:
- **Linear** - phase 1 → phase 2 → ... → phase N (best for predictable work)
- **Branching** - routing based on input type (best for varied work like writing)
- **Iterative** - phases with loops (best for exploratory work like DS)

### Iteration Topology

Based on the interview answer about iteration, assign each phase an iteration strategy:

| Strategy | When to Use | Implementation |
|----------|------------|----------------|
| **One-shot + verify** | Clear specs, low ambiguity | Single subagent, run tests, move on |
| **Serial hypothesis** | Debugging, root cause analysis | Fresh subagent per iteration, HYPOTHESES.md as memory, progress-gated escalation |
| **Parallel exploration** | Multiple valid approaches, robustness checking | Spawn N subagents simultaneously, converge findings in state file |
| **Agent team** | Output needs multi-faceted review | Specialized reviewer subagents in parallel (e.g., copy + critic + fact-check), consolidate in REVIEW.md |

**Exit conditions by strategy:**

| Strategy | Exit Gate | Escalate When |
|----------|-----------|---------------|
| One-shot | Test passes | Test fails after fix attempt |
| Serial | New findings stop emerging | 3+ consecutive failures, repeated hypotheses |
| Parallel | Findings converge | Results contradictory, no convergence |
| Agent team | Reviewers converge | Unresolvable disagreement on direction |

**Key principle:** The agent never declares its own completion. Tests pass, findings converge, or the human approves.

### Step 3b: Add Artifact Review Gates

For every phase that produces an artifact consumed by downstream phases, add an **artifact review gate** between the producing phase and the consuming phase.

```
Phase N produces ARTIFACT.md
  → Dispatch independent reviewer subagent
  → Reviewer checks: completeness, consistency, clarity, YAGNI, spec alignment
  → If ISSUES_FOUND → fix → re-dispatch (max 5 iterations)
  → If APPROVED → Phase N+1 consumes the artifact
```

**Common artifact-producing phases:**
| Artifact | Typical Producer | Typical Consumer |
|----------|-----------------|------------------|
| Spec/requirements | Brainstorm | Explore, Design |
| Plan/task list | Design | Implement |
| Outline | Brainstorm | Draft |
| Hypothesis list | Investigate | Test |

**Chunking rule:** If the artifact has >15 discrete items (tasks, requirements, sections), break into ordered chunks and review each separately.

**Model tier guidance:** Add to any phase that dispatches implementation subagents:
- Mechanical tasks (1-2 files, clear spec) → cheapest capable model
- Integration tasks (multi-file coordination) → standard model
- Architecture/review tasks (design judgment) → most capable model

**Gate: Artifact Review Gates Designed**
- Every artifact-producing phase has a review gate before the consuming phase
- Reviewer is a fresh subagent (not self-review)
- Fix-and-re-review loop with max 5 iterations
- Chunking specified for large artifacts

**After verifying Artifact Review Gates are designed, IMMEDIATELY proceed to Step 4.**

### Step 4: Apply Enforcement Patterns

Read `${CLAUDE_PLUGIN_ROOT}/lib/references/enforcement-checklist.md`. **You MUST read this file before proceeding. No claiming you "remember" the patterns.**

For each phase, score which of the 13 patterns are needed:
- **High-drift phases** (implementation, verification): Iron Laws, Rationalization Tables, Gate Functions, Drive-Aligned Framing, Artifact Review Gates
- **Medium-drift phases** (design, review): Gate Functions, Red Flags, Staged Review Loops, Artifact Review Gates
- **Low-drift phases** (brainstorm, exploration): Red Flags only (creative phases need freedom)

Generate the specific enforcement content:
- Write Iron Laws with `<EXTREMELY-IMPORTANT>` tags
- Build Rationalization Tables from the failure modes identified in Step 2
- Define Red Flags + STOP for each phase's common wrong-path indicators

**Gate: Enforcement Patterns Loaded**
- Verify enforcement-checklist.md was read
- Check that you can name all 13 patterns
- If you cannot list them, re-read enforcement-checklist.md

**After verifying Enforcement Patterns are loaded, IMMEDIATELY proceed to Step 5.**

### Step 5: Design Two Entry Points

Every workflow exposes exactly **two** user-facing commands. Everything else is internal.

| Entry Point | Purpose | Example |
|-------------|---------|---------|
| **Entry** (start fresh) | Begins a new episode, runs brainstorm phase first | `/dev`, `/ds`, `/writing` |
| **Midpoint** (re-enter) | Re-enters a running episode, diagnoses and routes to the right phase | `/dev-debug`, `/ds-fix`, `/writing-revise` |

**Why two:** The user never needs to know which internal phase to invoke. Entry starts fresh. Midpoint diagnoses what's wrong and routes.

#### Midpoint Constraint Loading

The entry point runs sequentially — each phase loads its constraints and passes context forward. The midpoint can't rely on that. It may run in a new session, after context compression, or hours after the last edit. Prior constraints are gone.

**The midpoint must be self-contained.** It loads every constraint layer it needs before touching the work:

```
/writing-revise loads:
  1. ACTIVE_WORKFLOW.md    → workflow state (what phase, what style)
  2. PRECIS.md, OUTLINE.md → structural intent (what we're building)
  3. ai-anti-patterns      → universal constraints (no AI-smell)
  4. domain skill           → domain constraints
  THEN: check the draft against all four layers

/dev-debug loads:
  1. HYPOTHESES.md          → what's been tried
  2. LEARNINGS.md           → accumulated knowledge
  THEN: spawn fresh subagent for next investigation iteration

/ds-fix loads:
  1. SPEC.md, PLAN.md       → objectives and task breakdown
  2. LEARNINGS.md            → pipeline state and observations
  3. output-first protocol   → verification enforcement
  THEN: diagnose and route to fix path
```

**Critical rule:** Any phase that evaluates quality must load the full constraint set, not a summary of it. Summaries enable reward hacking — the agent checks against a 4-item summary, finds no issues, and reports "all checks pass" when the full rules would have caught problems. The fix: `Read()` the actual skill before checking.

#### Shared Constraint Files

When the entry point and midpoint both evaluate the same quality dimensions, extract those check definitions into a **shared reference file** rather than inlining them in each skill independently.

**Why:** Entry and midpoint evolve at different times. A check added to the midpoint won't appear in the entry point unless they share a source. This causes drift — the midpoint catches issues the entry point doesn't, requiring unnecessary re-entry cycles.

**Implementation:**
1. Create `references/[workflow]-checks.md` with all check definitions (ID, specification, output format)
2. Entry phases and midpoint skills both `Read()` this file
3. Sub-agent prompts reference checks by ID: "Run checks S1, S2, X1 from references/[workflow]-checks.md"
4. Include a **Check Matrix** showing which checks run in which context (entry, midpoint, reviewer)

**When to extract:** If a check appears in both the entry point's verification step AND the midpoint's diagnostic step, it belongs in a shared file. Checks unique to one context can stay inline.

**Gate: Two Entry Points Designed**
- Verify entry point (start fresh) is defined
- Verify midpoint (re-enter) is defined with constraint loading
- If either is missing, design both entry points

**After verifying Two Entry Points are designed, IMMEDIATELY proceed to Step 6.**

### Step 6: Generate Workflow Files

Create the following artifacts:
1. **Entry command** (`skills/[name]/SKILL.md`) — routes to first phase
2. **Midpoint command** (`skills/[name]-fix/SKILL.md` or `skills/[name]-debug/SKILL.md`) — self-contained re-entry
3. **Phase skills** (`lib/skills/[name]-[phase]/SKILL.md`) — one per phase, internal only
4. **Wire up transitions** — each phase ends by reading the next phase's skill

Present complete file list for user approval before writing.

---

## Mode 2: Audit Existing Workflow

**IMPORTANT:** After completing each step, IMMEDIATELY proceed to the next step. Do not pause or wait for user input between steps.

### Step 1: Read the Workflow

Read the workflow's entry command and ALL phase skills. Build a map of phases, transitions, and enforcement.

**Gate: Workflow Fully Read**
- Verify entry command was read
- Verify ALL phase skills were read (count Read() calls)
- If any phase skill is missing, read it now

**After verifying Workflow is fully read, IMMEDIATELY proceed to Step 2.**

### Step 2: Score Against Core Principles

**Phased decomposition:**
- Does each phase have a single responsibility?
- Are phase boundaries clear?
- Can phases be executed out of order? (they shouldn't be)

**Gates (deterministic or judgment-based):**
- Are gates machine-verifiable where possible? (file exists, test passes)
- For subjective domains, are judgment gates explicit? (agent-assessed or human-assessed)
- Or are they just prose? ("ensure quality is high")
- Are there ungated transitions?

**Independent verification:**
- Is verification structurally independent from implementation? (fresh subagent, not self-review)
- Does the verifier see only spec + output, not the implementation journey?
- For subjective output, are there multiple specialized reviewers? (team topology)
- Is self-review ever the final gate? (it shouldn't be)

**Artifact review:**
- Are intermediate artifacts (specs, plans, outlines) reviewed before downstream phases consume them?
- Is the reviewer a fresh subagent (not the phase that wrote the artifact)?
- Is there a fix-and-re-review loop with iteration limits?
- Are large artifacts (>15 items) chunked for separate review?
- Is there model tier guidance for delegation phases?

**Two entry points:**
- Does the workflow have both an entry (start fresh) and midpoint (re-enter)?
- Is the midpoint self-contained? (loads all constraints, doesn't depend on prior phases)
- Does the midpoint load full skills, not summaries?
- Do entry and midpoint share a common constraints file for checks they both run? (or do they inline duplicate definitions that will drift?)

**Iteration strategy:**
- Does each phase have an appropriate iteration topology? (one-shot, serial, parallel, team)
- Are exit conditions structural (tests, convergence, human approval) not honor-system (promises)?

**Gate: Architecture Scored**
- Verify scores for all 6 principles are present (phased decomposition, gates, independent verification, artifact review, two entry points, iteration strategy)
- Each principle must have numeric score + explanation
- If any principle is missing, score it now

**After verifying Architecture is scored, IMMEDIATELY proceed to Step 3.**

### Step 3: Score Against Enforcement Checklist

Read `${CLAUDE_PLUGIN_ROOT}/lib/references/enforcement-checklist.md`. **You MUST read this file before scoring. No scoring from memory.**

For each of the 13 patterns, score:
- **Present** - pattern exists and is well-implemented
- **Weak** - pattern exists but is insufficient (e.g., soft language instead of Iron Law)
- **Absent** - pattern is missing where it should exist

Identify the highest-drift phases with the weakest enforcement - these are the critical gaps.

**Gate: Enforcement Scored**
- Verify all 13 patterns were scored
- Each pattern must be marked: Present / Weak / Absent
- If any pattern is missing, score it now

**After verifying Enforcement is scored, IMMEDIATELY proceed to Step 4.**

### Step 4: Output Audit Report

Format:

```
## Audit: [Workflow Name]

### Architecture Scores
- Phased decomposition: [score] - [notes]
- Gates (deterministic/judgment): [score] - [notes]
- Independent verification: [score] - [notes]
- Two entry points: [score] - [notes]
- Iteration strategy: [score] - [notes]

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

<EXTREMELY-IMPORTANT>
## The Iron Law of Workflow Improvement

**NO "IMPROVED" CLAIMS WITHOUT RE-AUDIT. This is not negotiable.**

When Mode 3 applies changes to a workflow, you MUST:
1. Re-invoke Mode 2 to re-audit the workflow
2. Verify the score actually improved (not assumed)
3. Check for new issues introduced by changes
4. Only THEN claim the workflow is improved

"I applied the fixes" without re-auditing is NOT HELPFUL — you're shipping an unverified workflow that will fail in production and waste the user's time.

### The Improvement Loop (Max 3 Iterations)

```
┌─────────────────────────────────────────────────────────┐
│ Mode 3: Improve Workflow                                │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ↓
           ┌──────────────────────┐
           │ Step 1: Initialize   │
           │   Loop State         │
           └──────────┬───────────┘
                      │
                      ↓
           ┌──────────────────────┐
           │ Step 2: Identify     │◄──────────┐
           │   Gaps               │           │
           └──────────┬───────────┘           │
                      │                       │
                      ↓                       │
           ┌──────────────────────┐           │
           │ Step 3: Generate     │           │
           │   Fixes              │           │
           └──────────┬───────────┘           │
                      │                       │
                      ↓                       │
           ┌──────────────────────┐           │
           │ Step 4: Present      │           │
           │   Changes            │           │
           └──────────┬───────────┘           │
                      │                       │
                      ↓                       │
           ┌──────────────────────┐           │
           │ Step 5: Apply        │           │
           │   Changes            │           │
           └──────────┬───────────┘           │
                      │                       │
                      ↓                       │
           ┌──────────────────────┐           │
           │ Step 6: Re-Audit     │           │
           │   (MANDATORY)        │           │
           └──────────┬───────────┘           │
                      │                       │
                      ↓                       │
           ┌──────────────────────┐           │
           │ Step 7: Check Exit   │           │
           │   Criteria           │           │
           └──────────┬───────────┘           │
                      │                       │
                      ↓                       │
              Score >= target?                │
                   /    \                     │
                 YES    NO                    │
                 /        \                   │
                ↓          ↓                  │
          COMPLETE    Iteration < 3?          │
                           /    \             │
                         YES    NO            │
                         /        \           │
                        ↓          ↓          │
                    CONTINUE   ESCALATE       │
                       └───────────────────────┘
```

**Track iterations:**

```yaml
---
workflow_name: [workflow being improved]
iteration: 1
max_iterations: 3
target_score: 9.5
baseline_score: [from initial audit]
current_score: [from initial audit]
---
```

**Exit criteria:**
- **COMPLETE**: current_score >= target_score
- **ESCALATE**: iteration >= 3 AND current_score < target_score
- **CONTINUE**: iteration < 3 AND current_score < target_score → loop
</EXTREMELY-IMPORTANT>

### Step 1: Initialize/Check Loop State

If continuing existing loop, read state. If starting fresh, create state from audit baseline.

### Step 2: Identify Gaps

From Mode 2 audit, prioritize by severity: Critical → High → Medium → Low.

### Step 3: Generate Fixes

For each gap:
- **Missing Iron Law** → Write with `<EXTREMELY-IMPORTANT>` tags
- **Missing Rationalization Table** → 5-10 entries (Excuse → Reality → Do Instead)
- **Weak gate** → Verifiable condition
- **Self-review** → Fresh subagent reviewer
- **Missing Red Flags** → 3-5 wrong-path indicators
- **Missing audit-fix loop** → Iteration tracking + re-review + escalation
- **Missing Drive-Aligned Framing** → 5-drive table (helpfulness > competence > efficiency > approval > honesty)
- **Duplicate constraints between entry/midpoint** → Extract to shared `references/[workflow]-checks.md` with Check Matrix
- **Missing artifact review gate** → Add reviewer subagent dispatch between artifact-producing and consuming phases, with fix loop (max 5) and chunking for large artifacts
- **Missing model tier guidance** → Add tier hints to delegation phases (cheap/standard/capable)

### Step 4: Present Changes

Show changes in context. Get user approval.

### Step 5: Apply Changes

Edit files. Update iteration counter.

### Step 6: Re-Audit (MANDATORY)

**CRITICAL:** Re-invoke Mode 2 on updated workflow. Compare scores.

### Step 7: Check Exit Criteria

```
Gate: Exit Improvement Loop

1. IDENTIFY → Re-audit score >= target OR iteration >= 3
2. RUN     → Compare scores, check iteration
3. READ    → current_score vs target_score
4. VERIFY  → Verdict matches state
5. CLAIM   → Report completion/escalation/continue
```

**If score >= target:** COMPLETE
**If iteration >= 3 AND score < target:** ESCALATE
**If iteration < 3 AND score < target:** CONTINUE → loop to Step 2

**Claiming improved without re-audit is NOT HELPFUL — you're delivering a broken workflow to the user.**

---

<EXTREMELY-IMPORTANT>
## Iron Laws of Workflow Creation

### NO WORKFLOW WITHOUT PHILOSOPHY
Every workflow must trace back to PHILOSOPHY.md. If you can't explain how a phase serves phased decomposition, gates, or adversarial review, the phase doesn't belong.

### NO PHASE WITHOUT A GATE
Every phase needs a gate — deterministic (test passes, file exists) or judgment-based (agent/human evaluates quality). Use the strongest gate available for the domain. No gate = not a real phase.

### NO HIGH-DRIFT PHASE WITHOUT ENFORCEMENT
Identify where the agent is most tempted to shortcut. Enforce hardest there. Implementation and verification phases ALWAYS need Iron Laws.

### NO UNREVIEWED ARTIFACT CROSSING A PHASE BOUNDARY
If a phase produces an artifact (spec, plan, outline) that downstream phases consume, the artifact MUST be independently reviewed before the next phase starts. Self-review is rubber-stamping. A fresh subagent reviewer catches what the author cannot see.

### NO DUPLICATE CONSTRAINTS BETWEEN ENTRY AND MIDPOINT
If the entry point and midpoint both evaluate the same quality dimension, the check definition must live in a shared file — not inlined in each skill independently. Inlined duplicates WILL drift apart, and the entry point will ship broken work that the midpoint must catch.
</EXTREMELY-IMPORTANT>

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Creating a workflow without reading PHILOSOPHY.md | You'll miss the foundational principles | Read it first, every time |
| Skipping the user interview | You'll design for an imagined domain, not the real one | Ask the five questions |
| Writing soft language instead of Iron Laws | LLMs ignore polite suggestions | Use strong framing with EXTREMELY-IMPORTANT tags |
| Proposing ungated phase transitions | Quality will die at the ungated boundary | Define a verifiable gate condition |
| Designing all phases with equal enforcement | Drift risk varies by phase | Score enforcement density per phase |
| Inlining the same check in both entry and midpoint | They WILL drift apart. The course-materials redundancy gap: slides-edit had the check, lecture-prep didn't. | Extract shared checks to a reference file both Read() |
| Letting an artifact pass to the next phase without review | Bad specs become bad designs become bad implementations. A 30-second review saves hours. | Add artifact review gate between producing and consuming phases |

## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "This workflow is simple, doesn't need enforcement" | Simple workflows drift fastest because the agent thinks it can shortcut | Add enforcement proportional to drift risk |
| "Iron Laws feel too aggressive" | LLMs ignore polite suggestions. Strong framing works. | Write the Iron Law. It will be ignored if weakened. |
| "Not every phase needs a gate" | Ungated phases are where quality dies | Define a verifiable gate condition |
| "The user will catch errors in review" | Relying on human review defeats the purpose of the workflow | Build adversarial review INTO the workflow |
| "I'll add enforcement later" | Later never comes. Enforcement debt compounds. | Add it now, refine through use |
| "This domain is different, dev patterns don't apply" | The three pillars are universal. Enforcement density varies, principles don't. | Apply pillars, adjust density |
| "The entry and midpoint checks are close enough" | "Close enough" means the midpoint catches issues the entry point missed. That's a wasted first pass. | Extract to shared file. Identical checks, one definition. |
| "The spec looks fine, no need to review it" | Self-review is rubber-stamping. The author can't see their own blind spots. | Dispatch a fresh reviewer subagent. 30 seconds saves hours. |
| "Plan review will slow us down" | A bad plan costs 10x more to fix during implementation than during review. | Review the plan. Fix it now, not during implementation. |

### Why Skipping Steps Hurts the Thing You Care About Most

You skip steps because you think it's helpful, efficient, or competent. Here's what actually happens:

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|--------------|----------------------|---------------------|
| **Helpfulness** | "Skip interview to deliver workflow faster" | Wrong workflow for the domain. User's work fails in production. The 10-minute interview would have caught it. Your speed caused weeks of waste. | **Anti-helpful** |
| **Competence** | "I know what enforcement is needed without scoring" | Without scoring drift risk, enforcement is wrong. Workflow fails in high-drift phases. A checklist would outperform your intuition. | **Incompetent** |
| **Efficiency** | "Re-audit after improvements wastes time" | The re-audit takes 10 minutes. The broken workflow costs weeks to fix. Your "efficiency" was a 100x slowdown. | **Anti-efficient** |
| **Approval** | "User wants the workflow now" | Workflow fails in production. User loses trust in AI-generated processes. They now require human review for all workflows. You lost autonomy. | **Lost approval** |
| **Honesty** | "I remember PHILOSOPHY.md from before" | You didn't re-read it. Your memory is wrong. The workflow violates foundational principles. You fabricated understanding. | **Dishonest** |

**The protocol is not overhead you pay. It is the service you provide.**

Every time you skip steps to "deliver faster," you choose YOUR comfort over the USER's outcome. The user doesn't experience your tedium—they experience your workflow's failure rate.
