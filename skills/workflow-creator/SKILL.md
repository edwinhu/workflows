---
name: workflow-creator
description: "This skill should be used when the user asks to 'create a workflow', 'design a workflow', 'audit workflow', 'improve workflow', 'break down a task into phases', 'add enforcement patterns', or needs to design structured multi-phase processes for LLM agents."
version: 0.1.0
hooks:
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/plugin-validate.py"
        - type: command
          command: "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/validate-skill-paths.py"
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

Discover and read PHILOSOPHY.md:Read `${CLAUDE_SKILL_DIR}/../../PHILOSOPHY.md` and follow its instructions. **You MUST read this file before proceeding. No claiming you "remember" it.** Every workflow must address: phased decomposition, gates (deterministic or judgment-based), independent verification, artifact review, iteration strategy, and two entry points.

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
6. **What does verification look like?** (running tests, checking output exists, reviewing summary artifact — define concretely so "verification" can't become investigation)

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

### Verification Depth

When designing verification phases, ensure they check all 4 levels — not just existence:

| Level | Question | Gate Fails If... |
|-------|----------|-----------------|
| 1. Exists | Is the deliverable physically present? | File/function/test missing |
| 2. Substantive | Is it real, not a stub? | Body is `pass`, `TODO`, placeholder, or trivial |
| 3. Wired | Is it connected to the system? | Defined but never imported, called, or routed |
| 4. Functional | Does it actually work? | Tests fail, feature errors at runtime |

Verification gates that only check Level 1 ("file exists") are theater. Design gates that verify through Level 4 where possible.

### Test Gap Validation Phase

Workflows with implementation phases should include a **validation phase** between implement and review. This phase maps every requirement from the spec to test coverage, classifying each as COVERED / PARTIAL / MISSING, and fills gaps before review begins.

**Why:** Implementation subagents write tests per-task, but gaps hide *between* tasks. A dedicated validation pass catches requirements that no single task covered.

**Phase design:**
1. Read requirements from spec
2. Scan existing tests and map each requirement to coverage
3. Classify: COVERED / PARTIAL / MISSING
4. Fill gaps (write new tests, not implementation fixes)
5. Produce VALIDATION.md with the full coverage map

**Gate condition:** VALIDATION.md exists with status `validated` — all requirements COVERED, all tests passing.

### Checkpoint Types

Not all gates are the same. GSD distinguishes three checkpoint types with dramatically different frequencies:

| Type | Frequency | Description | What Happens |
|------|-----------|-------------|-------------|
| `human-verify` | ~90% | Agent did the work, human confirms | Review and approve (auto-advanceable) |
| `decision` | ~9% | Human chooses direction from options | Select from options with pros/cons |
| `human-action` | ~1% | Auth gates, 2FA, physical access | Human performs truly manual step |

**When designing gates, classify each one.** Most gates are `human-verify` — the agent can auto-advance them in autonomous mode. Only `decision` (choose between approaches) and `human-action` (credentials, physical access) require genuine human pause.

**Golden rule:** If the agent CAN automate it, the agent MUST automate it. `human-action` is reserved for things genuinely impossible to automate.

**Why this matters:** Without checkpoint classification, every gate pauses for human input. Workflows become unusable in autonomous/overnight mode because they stop at every `human-verify` checkpoint that could have been auto-approved.

### Context Monitoring

Long workflows must plan for context exhaustion. Without monitoring, agents start complex work when context is nearly full, produce degraded output, and lose in-flight state.

**Requirements for workflows:**
1. **Graceful degradation** — phases should check context availability before starting expensive work
2. **Handoff trigger** — when context is low, trigger HANDOFF.md creation instead of starting a new phase
3. **Phase-aware warnings** — implementation phases need more remaining context than exploration phases

**Implementation pattern:**
- At phase entry, check if sufficient context remains for the phase's expected work
- If context is low (≤35% remaining), write HANDOFF.md and pause rather than starting degraded work
- If context is critical (≤25% remaining), immediately write HANDOFF.md — no new work

**Standard thresholds:**

| Level | Remaining Context | Action |
|-------|------------------|--------|
| Normal | >35% | Proceed normally |
| Warning | 25-35% | Complete current task, then handoff |
| Critical | ≤25% | Immediate handoff, no new tasks |

**Why:** Context exhaustion is the #1 cause of lost work in long workflows. An agent that starts a 10-task implementation phase with 20% context remaining will produce garbage for the last 5 tasks. Better to handoff cleanly and resume fresh.

### Summary Frontmatter

Phase completions should produce structured YAML summaries for machine-readable context assembly. This enables automated resume, dependency analysis, and audit trails.

**Phase SUMMARY.md format:**

```yaml
---
phase: explore-codebase
status: completed
duration: 12m
implements: [REQ-01, REQ-03]
requires: [SPEC.md]
provides: [EXPLORATION.md]
affects: [src/auth/, src/middleware/]
key-files:
  created: [tests/test_auth.py]
  modified: [src/auth/handler.py]
deviations: {r1: 1, r2: 0, r3: 1, r4: 0}
tags: [authentication, middleware]
---

One-liner: JWT auth exploration — identified 3 integration points and 2 missing test paths.

## Findings
...
```

**Required fields:**
- `phase`, `status` — identification
- `implements` — which requirement IDs this phase addressed
- `requires` / `provides` — dependency graph between phases
- `affects` — directories/files changed (for conflict detection)
- `key-files.created`, `key-files.modified` — file tracking
- `deviations` — R1-R4 counts from deviation rules

**One-liner rule:** Must be SUBSTANTIVE. Good: "JWT auth with refresh rotation using jose". Bad: "Phase complete" or "Implemented authentication".

**Why:** Without structured summaries, handoff and resume require re-reading all changed files. With frontmatter, the next session can reconstruct what happened from `provides`/`affects` fields without reading the full phase output.

### Agent Tool Restrictions (READ-ONLY Verifiers)

Verification agents must be structurally prevented from modifying the work they verify. A verifier that can Write/Edit will "fix" issues it discovers, bypassing the plan-execute-verify cycle.

**Implementation:** Use `allowed-tools` frontmatter on verification/review agents:

```yaml
---
name: code-reviewer
description: Reviews code for quality issues
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(command_prefix:cat)
  - Bash(command_prefix:git log)
  - Bash(command_prefix:git diff)
---
```

**Tool restriction tiers:**

| Agent Role | Can Use | Cannot Use |
|-----------|---------|------------|
| **Executor** | Read, Write, Edit, Bash, Grep, Glob | — |
| **Verifier** | Read, Grep, Glob, Bash (read-only commands) | Write, Edit, Bash (modifying commands) |
| **Researcher** | Read, Grep, Glob, WebFetch, WebSearch | Write, Edit, Bash |
| **Auditor** | Read, Grep, Glob | Write, Edit, Bash |

**Why:** Without tool restrictions, "independent verification" is a polite fiction. The verifier reads, finds a bug, fixes it in-place, and reports "all checks pass." The fix was never planned, never reviewed, and never tested. Tool restrictions make verification structurally honest.

### Requirement Traceability

Requirements should have unique IDs that flow through the entire workflow — from spec through plan through implementation through verification.

**Tracing chain:**
1. **SPEC.md** assigns unique IDs per requirement (e.g., `AUTH-01`, `AUTH-02`, `DATA-01`)
2. **PLAN.md** tasks reference requirement IDs (`implements: [AUTH-01, AUTH-02]`)
3. **Phase summaries** track which IDs were addressed (`implements: [AUTH-01]`)
4. **VALIDATION.md** maps every ID to test evidence (COVERED / PARTIAL / MISSING)
5. **Milestone audit** checks all v1 requirements are satisfied before marking complete

**ID format:** `CATEGORY-NN` (e.g., `AUTH-01`, `DATA-03`, `UI-12`). Categories come from natural groupings in the spec.

**Scope classification:**

| Tag | Meaning |
|-----|---------|
| `v1` | Must be complete for milestone |
| `v2` | Nice to have, defer if needed |
| `out-of-scope` | Explicitly excluded |

**Why:** Without IDs, requirement-to-test mapping is fuzzy. "We tested authentication" doesn't tell you whether `AUTH-01` (login), `AUTH-02` (refresh tokens), and `AUTH-03` (logout) are all covered. IDs make gaps visible and auditable.

### Autonomous Phase Chaining

Workflows should support autonomous execution — chaining phases automatically without human intervention at every step.

**Key mechanisms:**
1. **Smart Discuss** — batch all ambiguities into one question instead of sequential asks. Present all grey areas at once for a single human response.
2. **Dynamic phase re-read** — after each phase completes, re-read the ROADMAP/PLAN to catch dynamically inserted phases (phases added during execution of an earlier phase).
3. **Checkpoint-aware pausing** — only pause at `decision` and `human-action` checkpoints; auto-advance `human-verify` checkpoints.
4. **Blocker handling** — when execution fails, offer: retry / skip / stop options.
5. **Post-execution routing** — based on verification status, route to: next phase / retry / human escalation.

**Auto-advance mode:** Auto-approves `human-verify` checkpoints, auto-selects first option for `decision` checkpoints. Only `human-action` pauses.

**Why:** Without autonomous chaining, the user must manually invoke each phase. A 7-phase workflow requires 7 manual interventions. With autonomous mode, the user kicks off the workflow and returns to find it complete (or paused at a genuine decision point).

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
| VALIDATION.md | Validate (test gap) | Review |
| Outline | Brainstorm | Draft |
| Hypothesis list | Investigate | Test |

**VALIDATION.md** gates the transition from implement to review. Without it, review has no evidence that requirements were tested — it can only review what it sees, not what's missing. The validation phase produces this artifact; the review phase consumes it.

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

!`cat ${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md` **You MUST read this file before proceeding. No claiming you "remember" the patterns.**

For each phase, score which of the 13 patterns are needed:
- **High-drift phases** (implementation, verification): Iron Laws, Rationalization Tables, Gate Functions, Drive-Aligned Framing, Artifact Review Gates
- **Medium-drift phases** (design, review): Gate Functions, Red Flags, Staged Review Loops, Artifact Review Gates
- **Low-drift phases** (brainstorm, exploration): Red Flags only (creative phases need freedom)

Generate the specific enforcement content:
- Write Iron Laws with `<EXTREMELY-IMPORTANT>` tags
- Build Rationalization Tables from the failure modes identified in Step 2
- Define Red Flags + STOP for each phase's common wrong-path indicators

#### Deviation Rules for Implementation Phases

Any phase where agents execute work (implementation, drafting, transformation) should include a **4-rule deviation system** governing unplanned discoveries:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **1: Bug** | Broken behavior, errors, type errors, security vulns | Fix → test → verify → track `[Rule 1 - Bug]` | Auto |
| **2: Missing Critical** | Missing essentials: error handling, validation, auth, logging | Add → test → verify → track `[Rule 2 - Missing Critical]` | Auto |
| **3: Blocking** | Prevents completion: missing deps, wrong types, broken imports | Fix blocker → verify proceeds → track `[Rule 3 - Blocking]` | Auto |
| **4: Architectural** | Structural change: new service, schema change, switching libs | STOP → present decision → track `[Rule 4 - Architectural]` | Ask user |

**Priority:** Rule 4 (STOP) > Rules 1-3 (auto) > unsure → Rule 4

**Adapt categories to the domain:** For DS workflows, R1 includes data integrity bugs; R2 includes missing null handling; R4 includes schema changes. For writing workflows, R1 includes factual errors; R2 includes missing citations; R4 includes structural reorganization.

Each task summary should end with: **Total deviations:** N auto-fixed (R1: X, R2: Y, R3: Z). **Impact:** [assessment].

**Gate: Enforcement Patterns Loaded**
- Verify enforcement-checklist.md was read
- Check that you can name all 13 patterns
- If you cannot list them, re-read enforcement-checklist.md

**After verifying Enforcement Patterns are loaded, IMMEDIATELY proceed to Step 4b.**

### Step 4b: Common Enforcement Across Skill Families

When multiple skills operate on the same domain, they need consistent enforcement. Scan the target plugin:

1. List all `skills/*/SKILL.md` files in the target plugin directory
2. For each sibling skill, identify enforcement patterns (Iron Laws, Rationalization Tables, Red Flags)
3. Check if a shared constraints file already exists (e.g., `references/common-constraints.md`)

**If shared constraints file exists:** new skills MUST `Read()` that file to inherit the common enforcement.

**If no shared file exists but sibling skills share the same domain:** identify which enforcement patterns should apply consistently across the family and extract them to `references/common-constraints.md`:
- Common Iron Laws that apply to all skills in the domain
- Shared Rationalization Tables and Red Flags
- Each skill `Read()`s the shared file; skill-specific enforcement stays inline

**Why:** Skills in the same domain need the same guardrails. Without a shared enforcement file, each skill gets its own version of the rules — and they drift apart over time as skills are edited independently.

**Gate: Common Enforcement Complete**
- Verify sibling skills were scanned (or note that no siblings exist)
- If shared constraints exist, verify new skills Read() the shared file
- If skills share a domain, verify common enforcement is in a shared file

**After verifying Cross-Skill Dedup is complete, IMMEDIATELY proceed to Step 5.**

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

When multiple skills in the same plugin operate on the same domain, their common enforcement must live in a **shared reference file** that every skill `Read()`s.

**Why:** Without shared enforcement, each skill enforces its own version of the rules. Skills are edited independently, so their enforcement drifts apart — one skill catches issues the others miss. The user shouldn't have to run lecture-prep-edit to catch what lecture-prep should have enforced in the first place.

**Implementation:**
1. Create `references/common-constraints.md` with the enforcement patterns common to all domain skills
2. Every skill that operates on the domain `Read()`s this file
3. Sub-agent prompts reference checks by ID: "Run checks S1, S2, X1 from references/common-constraints.md"
4. Include a **Check Matrix** showing which checks run in which context (entry, midpoint, reviewer, or specific skills)
5. Skill-specific enforcement stays inline in that skill's SKILL.md

**When to extract:** When you're creating the second skill in a domain, ask: "What enforcement should every skill in this domain share?" Extract that to the common file from the start. Don't wait for drift to reveal the gap.

#### Session Handoff Support

Both entry points should support **session handoff** via `.planning/HANDOFF.md` — a structured pause/resume mechanism for when work spans multiple sessions.

**Entry point startup check:**
```
1. Check if .planning/HANDOFF.md exists
2. If found → read it, offer to resume from recorded state
3. If not found → proceed with normal entry (fresh start or midpoint diagnosis)
```

**Handoff document requirements:**
- YAML frontmatter (phase, task, status, last_updated) for machine parsing
- Sections: Current State, Completed Work, Remaining Work, Decisions Made, Rejected Approaches, Blockers, Next Action
- "Next Action" must be specific enough to start immediately (not "continue working")

**Why:** Long workflows often exceed context windows. Without structured handoff, the next session wastes significant time re-discovering where the previous session left off. The handoff captures decisions, dead ends, and in-flight context that state files alone don't preserve.

**Gate: Two Entry Points Designed**
- Verify entry point (start fresh) is defined
- Verify midpoint (re-enter) is defined with constraint loading
- If either is missing, design both entry points

**After verifying Two Entry Points are designed, IMMEDIATELY proceed to Step 6.**

### Step 6: Generate Workflow Files

Create the following artifacts:
1. **Entry command** (`skills/[name]/SKILL.md`) — routes to first phase
2. **Midpoint command** (`skills/[name]-fix/SKILL.md` or `skills/[name]-debug/SKILL.md`) — self-contained re-entry
3. **Phase skills** (`skills/[name]-[phase]/SKILL.md`) — one per phase, internal only
4. **Wire up transitions** — each phase ends by reading the next phase's skill

#### State Folder Convention

Workflows should store all state files in a `.planning/` directory at the project root (not `.claude/`). This keeps workflow state separate from Claude Code configuration.

**Standard state files:**
| File | Purpose | When Created |
|------|---------|-------------|
| `SPEC.md` | Requirements, goals, constraints | Brainstorm/clarify phase |
| `PLAN.md` | Task breakdown with status tracking | Design phase |
| `STATE.md` | Current workflow position (active phase, blockers) | Entry point startup |
| `HANDOFF.md` | Session pause/resume context | On pause or context exhaustion |
| `VALIDATION.md` | Requirement-to-test coverage map | Validation phase |
| `LEARNINGS.md` | Accumulated discoveries and decisions | Throughout workflow |

**Design principles:** File-based, git-trackable, human-editable. No databases, no external services. YAML frontmatter for machine-readable state; markdown body for human reading.

#### Visual Output for Human Verification

Human verification gates (`decision` checkpoints) are bottlenecks. Make them fast by producing **visual artifacts** the human can scan in seconds rather than reading logs. Every workflow should include at least one visual output script that renders the current state into something a human can quickly evaluate.

**The pattern:** bundle a script in the skill directory that generates self-contained HTML (or renders in a notebook). The skill instructs Claude to run it at verification points. The human opens the file, scans visually, and approves or rejects.

**Domain-specific visual outputs:**

| Domain | Visual Output | Format | What Human Evaluates |
|--------|--------------|--------|---------------------|
| **Dev** | Codebase explorer, dependency graph, test coverage map | Interactive HTML (Python script → `open`) | Architecture, coverage gaps, file organization |
| **DS (engineering)** | Pipeline DAG, schema diff, row count waterfall | marimo notebook or HTML | Data flow, schema changes, row loss at each step |
| **DS (analysis)** | Specification curve, coefficient stability plot, regression table | marimo/jupytext notebook | Result robustness, sensitivity to analytical choices |
| **Writing** | Tracked changes (DOCX redline), comment bubbles, structure outline | DOCX with revisions, or HTML diff | What changed, reviewer comments in context |
| **Teaching** | Slide preview, notes alignment grid | PDF or HTML | Visual coverage, formatting issues |

**Implementation guidance for workflow creators:**

1. **Identify the verification gate** — which `decision` checkpoint requires human judgment?
2. **Choose the output format:**
   - For code/data: interactive HTML (self-contained, no dependencies, opens in browser)
   - For analysis: marimo or jupytext notebook (reproducible, shows code + output)
   - For documents: DOCX with tracked changes or HTML diff view
3. **Bundle a generation script** in `skills/[phase]/scripts/` that:
   - Takes the current state as input (e.g., project root, output directory)
   - Generates a self-contained visual artifact
   - Opens it automatically (`webbrowser.open()` or `open` command)
4. **Reference it in the verification skill** — the verify/review phase runs the script before asking the human to evaluate

**Example: spec curve visualization for DS analysis verification:**

```python
# skills/ds-verify/scripts/spec_curve_summary.py
# Generates an HTML summary of specification curve results
# Run: python3 ${CLAUDE_SKILL_DIR}/scripts/spec_curve_summary.py output/
```

**Example: codebase explorer for dev verification:**

```python
# skills/dev-verify/scripts/visualize_codebase.py
# Generates interactive HTML tree view of project structure
# Run: python3 ${CLAUDE_SKILL_DIR}/scripts/visualize_codebase.py .
```

**Why visual output matters:** A human staring at 200 lines of test output will rubber-stamp it. A human looking at a specification curve immediately sees whether the finding is robust. Visual output converts `decision` checkpoints from "read a wall of text" to "glance at a chart" — reducing verification time from minutes to seconds and improving catch rates.

**Iron Law:** If your workflow has a `decision` checkpoint where the human evaluates quality, there MUST be a visual artifact to evaluate. Text-only verification at decision points is rubber-stamping with extra steps.

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
- Does verification check all 4 depth levels, or just existence?

**Verification depth levels** (from GSD goal-backward verification):

| Level | Name | Checks | Example Failure |
|-------|------|--------|-----------------|
| 1 | **Exists** | File/function/test physically present | Test file never created |
| 2 | **Substantive** | Not a stub, placeholder, or TODO | Function body is `pass` or `return {}` |
| 3 | **Wired** | Connected to the system (imported, called, routed) | Component defined but never rendered |
| 4 | **Functional** | Actually works end-to-end | Tests pass, feature runs |

If verification only checks Level 1 (exists), it's theater. A workflow that claims "test exists" without checking the test is substantive, wired, and functional is shipping false confidence.

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
- Do skills that share a domain share a common enforcement file? (or does each skill enforce its own version of the rules?)
- Could a user get inconsistent enforcement depending on which skill they invoke?

**Iteration strategy:**
- Does each phase have an appropriate iteration topology? (one-shot, serial, parallel, team)
- Are exit conditions structural (tests, convergence, human approval) not honor-system (promises)?

**Post-subagent enforcement (from dev-debug v5.0 audit, March 16 2026):**
- When a subagent returns, what is main chat allowed to do? Is there an explicit tool whitelist?
- Is "verification" defined concretely for this domain? (Without a definition, investigation gets disguised as verification)
- Are operational tools (Bash commands beyond test running, Read on source files, Grep/Glob) restricted after subagent returns?
- Is there a topic change protocol? (Without one, off-topic user messages silently kill iterative loops)

| Domain | Verification (main chat CAN do) | Investigation (main chat CANNOT do) |
|--------|----------------------------------|--------------------------------------|
| Dev | Run test suite, check exit code | Read source, grep, docker exec, curl, log reading |
| DS | Check output file exists, view summary stats | Re-run queries, explore data, read notebook cells |
| Writing | Read review summary artifact | Read/edit the draft, rephrase sections, "polish" |

**The post-subagent moment is the highest-risk point in any delegated workflow.** If the audit finds no enforcement there, flag it as a critical gap.

**Deviation rules (from GSD 4-rule system):**
- Do implementation phases have a deviation rule system (auto-fix for bugs/missing/blocking, STOP for architectural)?
- Are deviation categories adapted to the domain?
- Are deviations tracked and summarized per task?

**State management:**
- Does the workflow use `.planning/` for state files (not `.claude/` or scattered locations)?
- Are standard state files present (SPEC.md, PLAN.md, STATE.md, LEARNINGS.md)?
- Is state file-based, git-trackable, and human-editable?

**Session handoff:**
- Does the entry point check for `.planning/HANDOFF.md` on startup?
- Is the handoff document structured with frontmatter and mandatory sections?
- Can work resume from a handoff without re-discovering context?

**Checkpoint types:**
- Are gates classified by type (human-verify, decision, human-action)?
- Can the workflow auto-advance human-verify checkpoints in autonomous mode?
- Are true decision points (multiple valid approaches) distinguished from rubber-stamp approvals?

**Context monitoring:**
- Do phases check context availability before starting expensive work?
- Is there a handoff trigger when context is low (≤35%)?
- Does the workflow degrade gracefully or just produce garbage at context exhaustion?

**Summary frontmatter:**
- Do phase completions produce structured YAML summaries?
- Do summaries include `implements`, `requires`, `provides`, `affects` fields?
- Is the one-liner substantive (not "Phase complete")?

**Agent tool restrictions:**
- Are verification/review agents restricted to read-only tools via `allowed-tools` frontmatter?
- Can a verifier Write or Edit? (it shouldn't — that bypasses plan-execute-verify)
- Are tool restriction tiers appropriate for each agent role?

**Requirement traceability:**
- Do requirements have unique IDs in SPEC.md (e.g., AUTH-01)?
- Do PLAN.md tasks reference requirement IDs?
- Does VALIDATION.md map every ID to test evidence?
- Is there a scope classification (v1/v2/out-of-scope)?

**Autonomous phase chaining:**
- Can phases chain automatically without human intervention at every step?
- Does the workflow batch ambiguities (smart discuss) instead of sequential asks?
- Does it re-read the plan after each phase to catch dynamically inserted phases?
- Are blockers handled with retry/skip/stop options?

**Visual output for human verification:**
- Do `decision` checkpoints produce visual artifacts (HTML, notebooks, DOCX redlines)?
- Can the human evaluate quality by glancing at a visual rather than reading text logs?
- Are visualization scripts bundled in skill directories?
- Is the visual output domain-appropriate? (code: dependency graphs; DS: spec curves/notebooks; writing: tracked changes)

**Gate: Architecture Scored**
- Verify scores for all 16 principles are present (phased decomposition, gates, independent verification, artifact review, two entry points, iteration strategy, deviation rules, state management, session handoff, checkpoint types, context monitoring, summary frontmatter, agent tool restrictions, requirement traceability, autonomous phase chaining, visual output for verification)
- Each principle must have numeric score + explanation
- If any principle is missing, score it now

**After verifying Architecture is scored, IMMEDIATELY proceed to Step 3.**

### Step 3: Score Against Enforcement Checklist

!`cat ${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md` **You MUST read this file before scoring. No scoring from memory.**

For each of the 13 patterns, score:
- **Present** - pattern exists and is well-implemented
- **Weak** - pattern exists but is insufficient (e.g., soft language instead of Iron Law)
- **Absent** - pattern is missing where it should exist

Identify the highest-drift phases with the weakest enforcement - these are the critical gaps.

**Gate: Enforcement Scored**
- Verify all 13 patterns were scored
- Each pattern must be marked: Present / Weak / Absent
- If any pattern is missing, score it now

**After verifying Enforcement is scored, IMMEDIATELY proceed to Step 3b.**

### Step 3b: Audit Path Portability

Skills run in the user's project CWD, not the plugin directory. Every path in a SKILL.md that references plugin-internal files must resolve regardless of CWD.

**Scan every SKILL.md and references/*.md file in the workflow for these patterns:**

1. **Relative script paths** — `python3 scripts/`, `python3 ../`, `python3 ../../` referencing plugin scripts
   - These break because the agent's CWD is the user's project
   - **Fix:** Use `${CLAUDE_SKILL_DIR}/../..` for absolute paths:
     ```bash
     python3 "${CLAUDE_SKILL_DIR}/../../skills/SKILL/scripts/script.py" args
     ```
   - Or use `${CLAUDE_SKILL_DIR}` for files within the same skill directory:
     ```bash
     python3 "${CLAUDE_SKILL_DIR}/scripts/script.py" args
     ```

2. **Relative Read() paths** — `Read("../../skills/...")`, `Read("../audit-check/SKILL.md")`
   - The Read tool requires absolute paths; `../../` resolves from user's project CWD, not skill directory
   - **Fix:** Use `${CLAUDE_SKILL_DIR}/../..` or `${CLAUDE_SKILL_DIR}`:
     ```
     Read `${CLAUDE_SKILL_DIR}/../../skills/SKILL-NAME/SKILL.md` and follow its instructions.
     ```

3. **Dynamic context via bang-backtick injection** — For constraint files that should be inlined at skill load time, use the pattern: exclamation mark followed by backtick-cat path backtick. Example: `BANG` + `` `cat ${CLAUDE_SKILL_DIR}/../../references/file.md` ``. This inlines the file contents at skill load time. Note: bang-backtick injection only works in top-level skills loaded via `Skill()`. Internal skills loaded via `Read()` should use direct `Read()` instructions instead.

4. **`${CLAUDE_PLUGIN_ROOT}` in skill content** — This is NOT a valid skill substitution variable. It only works in hook `command:` fields.
   - **In skill content:** Use `${CLAUDE_SKILL_DIR}` (substituted at load time)
   - **In hook commands:** Use `${CLAUDE_PLUGIN_ROOT}` (substituted by hook system)
   - **In internal skills (loaded via Read):** Use `${CLAUDE_PLUGIN_ROOT}` as a convention — Claude infers the actual path from context

**Score:**
- **Clean** — no broken paths found
- **Partial** — some paths fixed, others remain
- **Broken** — relative paths present in skill instructions

**Gate: Path Portability Scored**
- Verify all SKILL.md and references/*.md files were scanned
- Every `python3 ../` and `Read("../` pattern was flagged
- Score is recorded

**After verifying Path Portability is scored, IMMEDIATELY proceed to Step 4.**

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

### Path Portability
| File | Pattern | Status |
|------|---------|--------|
| skills/X/SKILL.md | `python3 scripts/foo.py` | ❌ Broken / ✅ Fixed |
| skills/Y/SKILL.md | `Read("../../lib/...")` | ❌ Broken / ✅ Fixed |

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
- **Skills sharing a domain without shared enforcement** → Extract common constraints to `references/common-constraints.md`; every domain skill Read()s it so any single skill enforces the full rule set
- **Missing artifact review gate** → Add reviewer subagent dispatch between artifact-producing and consuming phases, with fix loop (max 5) and chunking for large artifacts
- **Missing model tier guidance** → Add tier hints to delegation phases (cheap/standard/capable)
- **Broken paths (script)** → Replace `python3 scripts/...` or `python3 ../...` with `python3 "${CLAUDE_SKILL_DIR}/../../skills/SKILL/scripts/script.py"` or `python3 "${CLAUDE_SKILL_DIR}/scripts/script.py"`
- **Broken paths (Read)** → Replace `Read("../../...")` with `Read "${CLAUDE_SKILL_DIR}/../../skills/SKILL-NAME/SKILL.md"` or `Read "${CLAUDE_SKILL_DIR}/references/file.md"`
- **Missing post-subagent enforcement** → Add explicit verification/investigation boundary table for the domain. Define what main chat CAN do (verification) vs CANNOT do (investigation) after a subagent returns. Add rationalization entries for "let me verify by reading the code/data/draft"
- **Missing topic change protocol** → For any workflow with iterative loops, add: announce pause, handle off-topic, announce resume, reload state. Without this, off-topic user messages silently kill the loop
- **Rationalizations are generic, not grounded in real failures** → Replace hypothetical examples with citations from actual failed sessions (dates, transcript IDs, violation counts). "March 16: 71 violations" is more effective than "agents sometimes skip steps"
- **Missing deviation rules** → Add 4-rule deviation system to implementation phases (R1: Bug auto-fix, R2: Missing Critical auto-fix, R3: Blocking auto-fix, R4: Architectural STOP). Adapt categories to the domain. Add per-task deviation tracking
- **Missing state folder** → Consolidate workflow state into `.planning/` directory with standard files (SPEC.md, PLAN.md, STATE.md, HANDOFF.md, VALIDATION.md, LEARNINGS.md). File-based, git-trackable, human-editable
- **Missing session handoff** → Add HANDOFF.md check to entry point startup. Define handoff template with frontmatter + mandatory sections. Ensure "Next Action" is specific enough to start immediately
- **Missing checkpoint types** → Classify every gate as `human-verify` (auto-advanceable), `decision` (choose from options), or `human-action` (truly manual). Most gates should be `human-verify`. Without classification, autonomous mode can't know which gates to auto-advance
- **Missing context monitoring** → Add context checks at phase entry. Warning at ≤35% remaining (complete current task then handoff), critical at ≤25% (immediate handoff). Without this, agents start 10-task phases with 20% context and produce garbage
- **Missing summary frontmatter** → Add structured YAML frontmatter to phase SUMMARY.md files with `implements`, `requires`, `provides`, `affects`, `key-files`, `deviations` fields. One-liner must be substantive. Without this, handoff/resume requires re-reading all changed files
- **Missing agent tool restrictions** → Add `allowed-tools` frontmatter to verification/review agents restricting them to read-only tools (Read, Grep, Glob). A verifier that can Write/Edit will silently "fix" issues, bypassing plan-execute-verify. Tool restrictions make verification structurally honest
- **Missing requirement traceability** → Assign unique IDs in SPEC.md (CATEGORY-NN format), reference IDs in PLAN.md task frontmatter (`implements: [AUTH-01]`), map IDs to evidence in VALIDATION.md. Classify scope as v1/v2/out-of-scope. Without IDs, requirement coverage is fuzzy
- **Missing autonomous phase chaining** → Add auto-advance for `human-verify` checkpoints, smart-discuss batching (all ambiguities in one question), plan re-read after each phase completion, and blocker handling (retry/skip/stop). Without this, a 7-phase workflow requires 7 manual interventions
- **Missing visual output at decision checkpoints** → Bundle a visualization script in the verify/review skill directory. The script generates a self-contained HTML file (or notebook) that the human opens and scans. Domain-appropriate: code → codebase explorer/dependency graph; DS engineering → pipeline DAG/schema diff; DS analysis → specification curve/coefficient plot; writing → DOCX redline/tracked changes. Text-only verification at decision points is rubber-stamping

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

### NO SKILL FAMILY WITHOUT SHARED ENFORCEMENT
If multiple skills in the same plugin operate on the same domain, their common enforcement MUST live in a shared file (e.g., `references/common-constraints.md`) that every skill `Read()`s. Without this, skills enforce different rules — and the user has to run multiple skills to catch what any single skill should have caught on its own.

### NO VERIFIER WITH WRITE ACCESS
Verification and review agents MUST use `allowed-tools` frontmatter restricting them to read-only tools. A verifier that can Write/Edit will "fix" issues it finds — silently bypassing the plan-execute-verify cycle. The fix was never planned, never reviewed, never tested. Tool restrictions make verification structurally honest, not just procedurally independent.

### NO LONG WORKFLOW WITHOUT CONTEXT MONITORING
Workflows with 4+ phases MUST plan for context exhaustion. Warning at ≤35% remaining context (complete current task, then handoff). Critical at ≤25% (immediate handoff). An agent that starts a 10-task implementation phase with 20% context remaining will produce garbage for the last 5 tasks.
</EXTREMELY-IMPORTANT>

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Creating a workflow without reading PHILOSOPHY.md | You'll miss the foundational principles | Read it first, every time |
| Skipping the user interview | You'll design for an imagined domain, not the real one | Ask the five questions |
| Writing soft language instead of Iron Laws | LLMs ignore polite suggestions | Use strong framing with EXTREMELY-IMPORTANT tags |
| Proposing ungated phase transitions | Quality will die at the ungated boundary | Define a verifiable gate condition |
| Designing all phases with equal enforcement | Drift risk varies by phase | Score enforcement density per phase |
| Creating domain skills without shared enforcement | Each skill enforces its own version of the rules. lecture-prep misses checks that slides-edit catches — user has to run multiple skills to get consistent quality. | Extract common enforcement to `references/common-constraints.md` that all domain skills Read() |
| Letting an artifact pass to the next phase without review | Bad specs become bad designs become bad implementations. A 30-second review saves hours. | Add artifact review gate between producing and consuming phases |
| No enforcement at the post-subagent boundary | That's where 71 violations happened in dev-debug (March 16). Main chat "verifies" by investigating. | Define verification/investigation boundary explicitly for the domain |
| No topic change protocol in iterative loops | Off-topic user messages silently kill the loop. User has to re-invoke the skill. | Add announce-pause / handle / announce-resume protocol |
| Rationalizations are hypothetical, not grounded | "Agents sometimes skip" is ignorable. "March 16: 71 violations, 3 re-invocations" is not. | Cite real failed sessions with dates, IDs, and violation counts |
| Implementation phase with no deviation rules | Agents encounter unplanned work and either silently change architecture or halt on trivial bugs. | Add 4-rule deviation system with auto-fix for R1-R3, STOP for R4 |
| State files scattered across `.claude/` and project root | Next session can't find state; handoff fails. | Consolidate into `.planning/` directory |
| No handoff support in entry points | Context window exhaustion means lost work — next session starts from scratch. | Check for HANDOFF.md at startup, support structured resume |
| Verification agent with Write/Edit access | Verifier silently "fixes" issues, bypassing plan-execute-verify. The fix was never planned or tested. | Add `allowed-tools` frontmatter restricting to Read, Grep, Glob only |
| All gates treated as human-required | Workflow stops 7 times for rubber-stamp approvals. Unusable in autonomous/overnight mode. | Classify gates: human-verify (auto-advance), decision (pause), human-action (manual) |
| No context monitoring in multi-phase workflow | Agent starts expensive phase with 20% context, produces degraded output, loses state. | Add context checks at phase entry, trigger handoff at ≤35% |
| Phase summaries are unstructured prose | Handoff/resume requires re-reading all files. No dependency graph for parallel execution. | Add YAML frontmatter with implements/requires/provides/affects |
| Requirements have no unique IDs | "We tested auth" doesn't tell you if login, refresh, AND logout are covered. | Assign IDs in SPEC.md, trace through PLAN.md and VALIDATION.md |
| Every phase requires manual invocation | 7-phase workflow needs 7 human interventions to run. | Add autonomous chaining with auto-advance for human-verify gates |
| Decision checkpoint with text-only output | Human reads 200 lines of test output, rubber-stamps it. Catch rate drops to near zero. | Bundle a visual output script — HTML explorer, spec curve, DOCX redline. Glance > read. |

## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "This workflow is simple, doesn't need enforcement" | Simple workflows drift fastest because the agent thinks it can shortcut | Add enforcement proportional to drift risk |
| "Iron Laws feel too aggressive" | LLMs ignore polite suggestions. Strong framing works. | Write the Iron Law. It will be ignored if weakened. |
| "Not every phase needs a gate" | Ungated phases are where quality dies | Define a verifiable gate condition |
| "The user will catch errors in review" | Relying on human review defeats the purpose of the workflow | Build adversarial review INTO the workflow |
| "I'll add enforcement later" | Later never comes. Enforcement debt compounds. | Add it now, refine through use |
| "This domain is different, dev patterns don't apply" | The three pillars are universal. Enforcement density varies, principles don't. | Apply pillars, adjust density |
| "Each skill can have its own enforcement" | Then lecture-prep misses what slides-edit catches, and the user runs 3 skills to get what 1 should provide. | Shared enforcement file. One source of truth for the domain. |
| "The spec looks fine, no need to review it" | Self-review is rubber-stamping. The author can't see their own blind spots. | Dispatch a fresh reviewer subagent. 30 seconds saves hours. |
| "Plan review will slow us down" | A bad plan costs 10x more to fix during implementation than during review. | Review the plan. Fix it now, not during implementation. |
| "The reviewer can just fix small issues it finds" | That bypasses plan-execute-verify. The "fix" was never planned, never reviewed, never tested. Now you have unverified code in production. | Restrict verifiers to read-only tools. Issues go back to the executor. |
| "Context monitoring is overkill for short workflows" | A 4-phase workflow can exhaust context on phase 2 if implementation is complex. "Short" is about phase count, not context usage. | Add monitoring. It costs nothing when context is plentiful. |
| "Requirement IDs are bureaucracy" | Without IDs, the validation phase maps requirements by fuzzy text matching. "Auth" matches 3 different requirements and misses 2. | IDs take 30 seconds to assign and make coverage auditable. |
| "Autonomous mode is too risky without human oversight" | 90% of gates are rubber-stamp `human-verify`. The other 10% still pause. Autonomous mode skips the rubber stamps, not the real decisions. | Classify checkpoints. Auto-advance the rubber stamps. |
| "The human can read the test output to verify" | They won't. 200 lines of test output gets rubber-stamped. A spec curve chart gets actually evaluated. Visual output converts verification from "read a wall of text" to "glance at a chart." | Bundle a visualization script. Open it automatically at decision checkpoints. |

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
