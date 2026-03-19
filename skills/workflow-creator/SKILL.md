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

## Startup: State Check

Before detecting mode, check for existing workflow-creator state:

1. Check if `.planning/wc/HANDOFF.md` exists
2. If found → read it, offer to resume from recorded state (skip mode detection)
3. If not found → proceed with mode detection below

**Why `.planning/wc/`:** workflow-creator's state files must NOT conflict with the target project's `.planning/` state files (SPEC.md, PLAN.md, STATE.md, etc.). The `wc/` subdirectory isolates workflow-creator's meta-state from the workflow state it's auditing or creating.

**Standard workflow-creator state files:**

| File | Purpose | Created By |
|------|---------|-----------|
| `.planning/wc/STATE.md` | Current mode + step | All modes at startup |
| `.planning/wc/INTERVIEW.md` | Captured interview answers | Mode 1 Step 2 |
| `.planning/wc/DESIGN.md` | Phase decomposition decisions | Mode 1 Step 3 |
| `.planning/wc/AUDIT.md` | Audit findings and scores | Mode 2 Step 4, Mode 3 Phase A |
| `.planning/wc/SCORES.md` | Score history across iterations | Mode 3 Phase A |
| `.planning/wc/HANDOFF.md` | Session resume context | Any mode on context exhaustion |

---

## Mode 1: Create New Workflow

**IMPORTANT:** After completing each step, IMMEDIATELY proceed to the next step. Do not pause for user approval except where explicitly required (Step 6: present files, Step 7: present audit results).

### Step 1: Ground in Philosophy

Discover and read PHILOSOPHY.md:Read `${CLAUDE_SKILL_DIR}/../../PHILOSOPHY.md` and follow its instructions. **You MUST read this file before proceeding. No claiming you "remember" it.** Every workflow must address: phased decomposition, gates (deterministic or judgment-based), independent verification, artifact review, iteration strategy, and two entry points.

**Gate: Philosophy Loaded**
- Verify PHILOSOPHY.md was read
- Check that your response references: phased decomposition, gates, independent verification, artifact review, iteration strategy, two entry points
- If you cannot explain these principles, re-read PHILOSOPHY.md

**After verifying Philosophy is loaded, write initial state:**
```bash
mkdir -p .planning/wc && cat > .planning/wc/STATE.md << 'EOF'
---
mode: create
step: 1-philosophy
status: completed
---
Philosophy loaded. Proceeding to interview.
EOF
```

**IMMEDIATELY proceed to Step 2.**

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

**After verifying Interview is complete, persist answers and update state:**

Write `.planning/wc/INTERVIEW.md` with all 6 answers in structured format:
```yaml
---
workflow_name: [proposed name]
domain: [code/data/writing/research/other]
---
## Answers
1. **Work type:** ...
2. **Deliverable:** ...
3. **Failure modes:** ...
4. **Drift points:** ...
5. **Iteration style:** ...
6. **Verification:** ...
```

Update `.planning/wc/STATE.md`: `step: 2-interview, status: completed`

**IMMEDIATELY proceed to Step 3.**

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

**After verifying Artifact Review Gates are designed, persist design decisions:**

Write `.planning/wc/DESIGN.md` with phase decomposition, topology choice, iteration strategies, and artifact review gates. This is the recoverable artifact if context exhausts during enforcement generation.

Update `.planning/wc/STATE.md`: `step: 3b-artifact-review, status: completed`

**IMMEDIATELY proceed to Step 4.**

### Step 4: Apply Enforcement Patterns

**Context check:** Steps 4-6 generate enforcement content and workflow files — the most context-intensive work. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/HANDOFF.md` with interview answers (from `.planning/wc/INTERVIEW.md`), phase decomposition (from `.planning/wc/DESIGN.md`), and current progress. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately — do not start enforcement generation.

!`cat ${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md` **You MUST read this file before proceeding. No claiming you "remember" the patterns.**

For each phase, score which of the 13 patterns are needed:
- **High-drift phases** (implementation, verification): Iron Laws, Rationalization Tables, Gate Functions, Drive-Aligned Framing, Artifact Review Gates
- **Medium-drift phases** (design, review): Gate Functions, Red Flags, Staged Review Loops, Artifact Review Gates
- **Low-drift phases** (brainstorm, exploration): Red Flags only (creative phases need freedom)

Generate the specific enforcement content:
- Write Iron Laws with `<EXTREMELY-IMPORTANT>` tags
- Build Rationalization Tables from the failure modes identified in Step 2
- Define Red Flags + STOP for each phase's common wrong-path indicators

#### Hooks Over Prompt Enforcement

Before writing prompt-based enforcement for a constraint, ask: **is this mechanically checkable?** If yes, write a scoped hook instead.

Skills and agents can declare `PreToolUse` and `PostToolUse` hooks in their frontmatter. These hooks fire on every matching tool call during the skill's lifetime — no prompt tokens consumed, no drift, no rationalization.

**For each constraint identified in the enforcement plan:**

| If the constraint is... | Then use... |
|------------------------|-------------|
| File extension/path guard | `PreToolUse` hook on Read/Edit/Write — check path |
| Tool parameter validation | `PreToolUse` hook — check required params |
| Tool sequence enforcement | `PreToolUse` hook with state file — track what's been done |
| Post-subagent restriction | `PostToolUse` on Agent + `PreToolUse` on restricted tools |
| Quality/judgment call | Prompt enforcement (Iron Law, Red Flags) |
| Educational/motivational | Prompt enforcement (Rationalization Table, Drive-Aligned Framing) |

**Write the hook as a Python script** in `skills/[phase]/scripts/` and reference it in the skill's frontmatter:
```yaml
hooks:
  PreToolUse:
    - matcher: "Read"
      hooks:
        - type: command
          command: "python3 ${CLAUDE_PLUGIN_ROOT}/skills/[phase]/scripts/guard-media-files.py"
```

**Design rule:** Hook first. If the hook can't express the constraint (requires judgment, context, or semantics), fall back to prompt enforcement.

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

When multiple skills operate on the same domain, they need consistent enforcement across **three layers**: constraints (prompt), hooks (structural), and script wiring (gate orchestration). Scan the target plugin:

#### Layer 1: Shared Constraints (Prompt Enforcement)

1. List all `skills/*/SKILL.md` files in the target plugin directory
2. For each sibling skill, identify enforcement patterns (Iron Laws, Rationalization Tables, Red Flags)
3. Check if a shared constraints file already exists (e.g., `references/common-constraints.md`)

**If shared constraints file exists:** new skills MUST `Read()` that file to inherit the common enforcement.

**If no shared file exists but sibling skills share the same domain:** identify which enforcement patterns should apply consistently across the family and extract them to `references/common-constraints.md`:
- Common Iron Laws that apply to all skills in the domain
- Shared Rationalization Tables and Red Flags
- Each skill `Read()`s the shared file; skill-specific enforcement stays inline

**Constraint Propagation Rule:** When a new constraint is added to ANY individual skill in the family, check: does this constraint apply to other skills? If yes → add to the shared constraints file, not the individual skill. If uncertain → add to shared (over-inclusion is cheaper than drift). Mark each constraint in common-constraints.md with an `**Applies to:**` annotation listing which skills use it.

#### Layer 2: Hook Coverage (Structural Enforcement)

1. For each sibling skill, extract the `hooks:` block from YAML frontmatter
2. Produce a **Hook Coverage Matrix** (skills × hooks):

```
| Hook Script | skill-1 | skill-2 | skill-3 | skill-4 |
|-------------|---------|---------|---------|---------|
| guard-a.py  | ✅ Pre  | ✅ Pre  | ❌      | ✅ Pre  |
| guard-b.py  | ✅ Post | ✅ Post | ❌      | ✅ Post |
| monitor.py  | ✅ Post | ✅ Post | ❌      | ✅ Post |
```

3. Flag any hook present in some siblings but not others
4. Require justification for intentional gaps (e.g., "router delegates immediately — hooks fire in the routed-to skill")

**Why hooks drift:** Hooks are added when a failure mode is discovered in one skill. The fix adds the hook to that skill's frontmatter but doesn't propagate to siblings. Unlike constraints (which can drift subtly), missing hooks are silent — no error, no warning, the enforcement just doesn't fire.

#### Layer 3: Script Wiring (Gate Orchestration)

1. List all check/guard scripts in `hooks/` and `scripts/`
2. For each script, verify it's referenced in:
   - (a) At least one skill's hook frontmatter
   - (b) The batch orchestrator (e.g., `check-all.sh`) if one exists
   - (c) `references/verification-checks.md` if it implements a named check
3. Produce a **Script Wiring Matrix**:

```
| Script              | Hook Reference | Batch Orchestrator | Check Definition |
|---------------------|---------------|--------------------|------------------|
| check-conventions.py | ✅ convention-check-guard.py | ✅ check-all.sh | ✅ verification-checks.md |
| check-widows.py     | ✅ post-compile-widow-guard.py | ✅ check-all.sh | ✅ verification-checks.md |
| new-check.py        | ❌ No hook    | ❌ Not in batch     | ✅ verification-checks.md |
```

4. Flag any script with gaps — a script that exists but isn't wired into all three layers is enforcement theater

**Why scripts unwire:** New check scripts are created to catch a specific failure mode. The author adds the script and its check definition, but forgets to wire it into the batch orchestrator or create a corresponding guard hook. The script exists, passes when run manually, but never fires automatically.

**Why:** Skills in the same domain need the same guardrails across all three layers. Without shared enforcement, each skill gets its own version of the rules — and they drift apart as skills are edited independently. Constraints drift through independent editing. Hooks drift through selective addition. Scripts drift through incomplete wiring.

**Gate: Cross-Skill Consistency Complete**
- Verify sibling skills were scanned (or note that no siblings exist)
- Layer 1: If shared constraints exist, verify new skills Read() the shared file. If skills share a domain, verify common enforcement is in a shared file.
- Layer 2: Hook Coverage Matrix produced. No unexplained gaps.
- Layer 3: Script Wiring Matrix produced. No unwired scripts.

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

#### Visual Output for Human Verification (Learn-by-Doing)

Visual artifacts *can* make `decision` checkpoints faster — but what helps depends on the human and the domain. **Don't prescribe visual output. Observe what the human actually does during review, then offer to automate it.**

**The learning pattern:**

1. **Observe** — at each `decision` checkpoint, note what the human asks for. Do they want a diff? A table? A chart? Do they open files in another tool? Or do they just read the summary and approve?
2. **Record** — log the observation in LEARNINGS.md: "User evaluated results by asking for coefficient comparison table" or "User approved after reading test summary"
3. **Offer** — after 3+ reviews with the same pattern, offer to bundle a script that generates the view automatically. Don't build it speculatively.

**When visual output IS worth building:**
- The human has asked for the same view 3+ times
- The checkpoint involves evaluating a distribution or pattern (spec curves, coverage maps) — humans do visual pattern recognition faster than reading tables
- The output is a rendered artifact (slides, documents) where "does it look right?" is the literal question

**When visual output is NOT worth building:**
- The human reads the summary and approves — that's fine, don't add friction
- The checkpoint is a yes/no with clear criteria (tests pass, file exists)
- Building the visualization takes longer than the verification it replaces

**Available patterns (offer when the human's review behavior suggests them):**

| If the Human Asks For... | Consider Building |
|--------------------------|-------------------|
| "Show me what changed" | Interactive diff explorer (HTML) |
| "What's the architecture?" | Dependency graph / codebase tree |
| "Are results robust?" | Specification curve (specr/marimo) |
| "Where did we lose rows?" | Row count waterfall chart |
| "What changed since last draft?" | DOCX redline / tracked changes |
| "Does the draft cover all claims?" | Claim coverage heatmap |

**Implementation:** bundle scripts in `skills/[phase]/scripts/`. Self-contained HTML or notebooks. The verify/review phase offers to run the script — it doesn't force it.

Present complete file list for user approval before writing.

### Step 7: Self-Audit the Generated Workflow

<EXTREMELY-IMPORTANT>
## The Iron Law of Eating Your Own Cooking

**NO GENERATED WORKFLOW WITHOUT A MODE 2 AUDIT ON IT. This is not negotiable.**

workflow-creator mandates audit-fix loops, independent verification, and artifact review gates for every workflow it creates. It cannot exempt its own output from these same standards.

**Skipping the self-audit is NOT HELPFUL — you're shipping an unverified workflow to the user. The user will discover the gaps when the workflow fails in production. The 5-minute audit would have caught them.**
</EXTREMELY-IMPORTANT>

After generating workflow files in Step 6:

1. **Run Mode 2** on the generated workflow — audit architecture (16 principles) and enforcement (13 patterns)
2. **Check score:** If composite score < 8.0, fix the generated files and re-audit (max 3 iterations)
3. **Present to user** with the audit report attached — the user sees both the workflow AND its quality score

```
Step 6: Generate Files
    ↓
Step 7: Mode 2 Audit on generated files
    ↓
Score >= 8.0? ──YES──→ Present files + audit report to user
    │
    NO
    ↓
Fix gaps (max 3 iterations) → Re-audit
    │
    ↓ (after 3 iterations)
Present files + audit report + remaining gaps to user
```

**Why 8.0 not 9.5:** Generated workflows are first drafts. They need real-world usage to reach 9.5. But they should clear 8.0 — no missing gates, no broken paths, no ungated phase transitions. Mode 3 exists for the 8.0 → 9.5 climb.

Update `.planning/wc/STATE.md`: `step: 7-self-audit, status: completed`

---

## Mode 2: Audit Existing Workflow

**IMPORTANT:** After completing each step, IMMEDIATELY proceed to the next step. Do not pause or wait for user input between steps.

**State initialization:** Create `.planning/wc/STATE.md` with `mode: audit, step: 1-read, status: in_progress, target: [workflow name]`.

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

**Cross-skill consistency (three layers):**
- **Constraints:** Do all sibling skills Read() the same shared constraints file? Are constraints that apply to multiple skills in the shared file (not inlined in individual skills)?
- **Hooks:** Do all sibling skills declare the same hooks in their YAML frontmatter? If a hook is present in some siblings but not others, is the gap justified? (Produce a Hook Coverage Matrix: skills × hooks)
- **Script wiring:** Is every check script referenced in all three layers: (a) hook frontmatter, (b) batch orchestrator, (c) verification-checks definition? (Produce a Script Wiring Matrix: scripts × invocation points)

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
- Do `decision` checkpoints offer visual artifacts when the human's review pattern suggests them?
- Does the workflow log what the human actually looks at during review (in LEARNINGS.md)?
- If the human has asked for the same view 3+ times, has it been automated into a script?

**Hooks over prompt enforcement:**
- Are mechanically-checkable constraints enforced via scoped hooks (PreToolUse/PostToolUse in skill frontmatter)?
- Or are they enforced only via prompt text (Iron Laws, Red Flags) that consume context and can be rationalized away?
- Specifically check for: file extension guards, path guards, tool parameter validation, tool sequence enforcement, post-subagent restrictions
- Behavioral/motivational constraints (rationalization tables, drive-aligned framing) should STAY as prompt — hooks can't teach reasoning
- Score based on: how many mechanical constraints are prompt-only when they could be hooks?

**Gate: Architecture Scored**
- Verify scores for all 17 principles are present (phased decomposition, gates, independent verification, artifact review, two entry points, iteration strategy, deviation rules, state management, session handoff, checkpoint types, context monitoring, summary frontmatter, agent tool restrictions, requirement traceability, autonomous phase chaining, visual output for verification, hooks over prompt)
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

**Persist audit results:** Write the audit report to `.planning/wc/AUDIT.md` in addition to displaying it. Update `.planning/wc/STATE.md`: `step: 4-report, status: completed`.

---

## Mode 3: Improve Workflow

<EXTREMELY-IMPORTANT>
## The Iron Law of Workflow Improvement

**MODE 3 IS AN AUDIT-FIX LOOP. THE SCORE DECIDES WHEN TO STOP, NOT YOU. This is not negotiable.**

Mode 3 uses the audit-fix-loop pattern: independent audit → score → fix → re-audit. The loop terminates when the **auditor's score** crosses the threshold (default: 9.5/10), NOT when you "feel" the workflow is good enough.

**The structural problem Mode 3 solves:** Without a loop, the agent audits once, applies some fixes, and stops — rationalizing that the remaining gaps are "domain characteristics" or "diminishing returns." March 19, 2026: agent stopped at 8.5/10 and said "close enough." It wasn't.
</EXTREMELY-IMPORTANT>

### Step 1: Run Initial Audit (Mode 2)

**State initialization:** Create `.planning/wc/STATE.md` with `mode: improve, step: 1-initial-audit, status: in_progress, target: [workflow name]`.

Run Mode 2 on the target workflow. This produces the baseline score.

**Gate:** Mode 2 audit report exists with numeric scores for all 16 principles.

### Step 2: Launch Audit-Fix Loop

Use the audit-fix-loop pattern with ralph-loop infrastructure:

```
Skill(skill="ralph-loop:ralph-loop", args="Improve [WORKFLOW_NAME] workflow to >= 9.5 enforcement score. --max-iterations 10 --completion-promise WORKFLOW_9_5")
```

**Each iteration of the loop follows this exact sequence:**

#### Phase A: AUDIT (Fresh Subagent — MANDATORY)

Spawn a fresh audit subagent that:
1. Reads ALL skill files in the workflow (entry, midpoint, all phases, references, common-constraints)
2. Scores against the 16 architecture principles (0-10 each)
3. Scores against the 13 enforcement patterns (Present/Weak/Absent per phase)
4. Checks path portability
5. Computes composite score (average of 16 principle scores)
6. Writes findings to `.planning/wc/AUDIT.md`
7. Appends score to `.planning/wc/SCORES.md`

```
Agent(
  subagent_type="general-purpose",
  description="Audit workflow enforcement",
  prompt="""You are an independent workflow auditor. You have NO knowledge of any prior fixes.

Read the workflow-creator Mode 2 audit criteria:
Read "${CLAUDE_SKILL_DIR}/SKILL.md" — Mode 2 section only.

Read the enforcement checklist:
Read "${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md"

Then audit this workflow by reading ALL its skill files:
[LIST ALL SKILL FILES IN THE WORKFLOW]

Score each of the 16 architecture principles 0-10.
Score each of the 13 enforcement patterns per phase: Present/Weak/Absent.
Check path portability.

Compute composite score = average of 16 principle scores.

Output to .planning/wc/AUDIT.md with this format:
- Composite score (single number)
- Per-principle scores with 1-line justification
- Critical gaps (principle score < 9.0) with specific fix recommendations
- Enforcement matrix (13 patterns × N phases)

Be thorough. A generous audit that misses gaps is worse than a harsh one.
Do NOT soften findings. Do NOT say 'overall good.'
""")
```

<EXTREMELY-IMPORTANT>
**THE AUDITOR MUST BE A FRESH SUBAGENT. If you audit your own fixes, you are rubber-stamping.**

The auditor has no context from the fix phase. It reads the files cold. This is what makes the score trustworthy.
</EXTREMELY-IMPORTANT>

#### Phase B: DECIDE

Read `.planning/wc/SCORES.md`. Check composite score against threshold:

| Condition | Action |
|-----------|--------|
| Score >= 9.5 | Output `<promise>WORKFLOW_9_5</promise>` — workflow meets quality bar |
| Score < 9.5 AND iteration < 10 | Continue to Phase C |
| Score < 9.5 AND iteration >= 10 | Escalate to user with current score and remaining gaps |

**You may ONLY output the completion promise when the auditor's score >= 9.5. Not when you "feel" it's good enough. Not when the remaining gaps seem minor. The score decides.**

#### Phase C: FIX

Address findings from `.planning/wc/AUDIT.md`, prioritized by severity:

1. Fix all principles scoring < 7.0 first (critical gaps)
2. Then principles scoring 7.0-8.9 (medium gaps)
3. Then principles scoring 9.0-9.4 (polish)

**Fix reference — common gap → fix mapping:**

| Gap | Fix |
|-----|-----|
| Missing Iron Law | Write with `<EXTREMELY-IMPORTANT>` tags |
| Missing Rationalization Table | 5-10 entries (Excuse → Reality → Do Instead) |
| Weak gate | Replace with verifiable condition |
| Self-review as final gate | Add fresh subagent reviewer dispatch |
| Missing Red Flags | 3-5 wrong-path indicators |
| Missing Drive-Aligned Framing | 5-drive table (helpfulness > competence > efficiency > approval > honesty) |
| No shared enforcement across skill family | Extract to `references/common-constraints.md`; all domain skills Read() it |
| Hooks inconsistent across skill family | Produce Hook Coverage Matrix (skills × hooks); add missing hooks to skill frontmatter; justify intentional gaps |
| New check script not wired into batch orchestrator | Add script invocation to batch orchestrator (check-all.sh equivalent); update verification-checks.md |
| Constraint added to individual skill but applies to family | Move to common-constraints.md with `**Applies to:**` annotation; remove from individual skill |
| Missing artifact review gate | Add reviewer subagent dispatch between producing/consuming phases, max 5 iterations |
| Broken paths (script) | Use `${CLAUDE_SKILL_DIR}/../../skills/SKILL/scripts/script.py` |
| Broken paths (Read) | Use `${CLAUDE_SKILL_DIR}/../../skills/SKILL-NAME/SKILL.md` |
| Missing post-subagent enforcement | Add verification/investigation boundary table for the domain |
| Missing topic change protocol | Add announce-pause / handle / announce-resume |
| Missing deviation rules | Add 4-rule system (R1-R3 auto, R4 STOP) adapted to domain |
| Missing state folder | Consolidate into `.planning/` with standard files |
| Missing session handoff | Add HANDOFF.md check to entry point startup |
| Missing checkpoint types | Classify every gate as human-verify/decision/human-action |
| Missing context monitoring | Add thresholds: warning ≤35%, critical ≤25% |
| Missing summary frontmatter | Add YAML frontmatter with implements/requires/provides/affects |
| Missing agent tool restrictions | Add `allowed-tools` to reviewer/verifier skills |
| Missing requirement traceability | Add CATEGORY-NN IDs in spec, trace through plan and validation |
| Missing autonomous phase chaining | Add auto-advance for human-verify gates, smart-discuss batching |
| Mechanical constraints enforced only via prompt | Write scoped `PreToolUse`/`PostToolUse` hooks in skill frontmatter. File extension guards, path guards, tool param validation, sequence enforcement → hooks. Keep rationalization tables, drive-aligned framing, and quality judgments as prompt text |

**Fix rules:**
- Targeted changes only — do NOT rewrite entire skill files
- Each fix addresses ONE gap from the audit
- After fixing, do NOT self-assess — the next iteration's audit will judge
- **End your turn immediately** so the loop feeds you back for re-audit

### Efficiency Optimizations

Mode 3 can be expensive. These optimizations reduce cost without sacrificing audit independence.

#### 1. Batch Fixes Per File

Group all fixes targeting the same file into a single edit. Don't make 5 separate edits to `references/common-constraints.md` — read the audit findings, plan all changes to that file, apply them in one Edit call.

#### 2. Scoped Re-Audit After Iteration 1

The first audit (baseline) must read ALL files — no shortcuts. After that, subsequent audits can be **scoped**: the audit subagent reads all files but the fix agent only needs to re-read files it changed + common-constraints.md. The audit subagent always does a full read (independence requires it), but the fixer can be smarter about what it reads before fixing.

#### 3. Prioritize Cheapest High-Impact Fixes

After the audit, sort gaps by `impact / effort`:
- Adding a section to common-constraints.md (shared file, all skills inherit) = high impact, low effort
- Adding `allowed-tools` frontmatter to 3 reviewer skills = high impact, 5 seconds each
- Rewriting a phase skill's entire gate structure = medium impact, high effort

Fix the cheap high-impact gaps first. This maximizes score improvement per iteration.

#### 4. Domain-Appropriate Scoring

Some principles have natural ceilings in certain domains:
- Writing gates are judgment-based (not deterministic) — 9.0 is the natural ceiling for "gates" in writing
- Writing has one midpoint because the domain only needs one — 9.0 is appropriate for "two entry points"

The auditor should note when a score reflects a **domain ceiling** vs a **fixable gap**. Domain ceilings don't count against the composite if the auditor justifies them. The composite then averages only the non-ceiling scores.

**Caution:** This is the auditor's call, not the fixer's. The fixer cannot declare a domain ceiling to avoid work. Only the independent auditor can classify a principle as domain-limited.

### Why This Must Be a Loop (Not Manual Iteration)

The old Mode 3 had a flowchart showing a loop but no loop infrastructure. It relied on the agent manually deciding to continue iterating. This is an honor system — the exact failure mode that audit-fix-loop was built to prevent.

**What happened (March 19, 2026):** Agent ran Mode 2 audit (baseline 7.3), applied fixes, re-audited to 8.5, applied more fixes, re-audited to 9.2, then stopped and rationalized: "remaining 0.3 is spread across many principles at 9.0 — diminishing returns." The target was 9.5. The agent stopped because it was tired of iterating, not because the score met the threshold.

**The structural fix:** ralph-loop drives the iteration. The agent can't stop until the auditor's score says 9.5. The fixer's opinion of whether 9.2 is "close enough" is irrelevant.

### Rationalization Table — Mode 3

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "9.2 is close enough to 9.5" | The threshold exists for a reason. 0.3 means real gaps remain. | Fix them. The score decides, not you. |
| "The remaining gaps are domain characteristics" | Maybe, but prove it by having the auditor agree, not by self-declaring | Let the auditor score it. If it's truly a domain limit, the auditor will note it. |
| "Diminishing returns on further iteration" | You don't know that. The last 0.3 might be one targeted fix. | Run the audit, see what's cheapest to fix, try it. |
| "I'll run the audit manually instead of using ralph-loop" | Manual loops have no enforcement. You'll stop early. You literally just did. | Use ralph-loop. The score decides. |
| "Re-reading all files each iteration is wasteful" | Fresh-context audit is what makes the score trustworthy. Incremental audits miss regressions. | Full re-read every iteration. Independence > efficiency. |

### Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Running Mode 3 without ralph-loop | Honor system — you'll stop early | Use ralph-loop with completion promise |
| Auditing your own fixes | Rubber-stamping | Spawn fresh audit subagent |
| Declaring "close enough" below 9.5 | Threshold violation | Keep iterating or escalate at max iterations |
| Skipping the audit subagent "to save time" | The audit IS the value — without it, fixes are unverified | Full independent audit every iteration |
| Stopping after 1-2 iterations without checking score | You don't know if you're done | Read SCORES.md, check against 9.5 |

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
If multiple skills in the same plugin operate on the same domain, their common enforcement MUST be consistent across THREE layers: (1) shared constraints file that every skill `Read()`s, (2) identical hooks in every skill's YAML frontmatter (or justified gaps), (3) every check script wired into the batch orchestrator, hook frontmatter, AND check definitions. Without three-layer consistency, skills enforce different rules — and the user gets different quality depending on which skill they invoke.

**The course-materials incident (March 2026):** batch-check-guard was added to slides-edit but not lecture-prep. convention-check-guard was added to sub-agent prompts but not as a hook. check-conventions.py existed but wasn't in check-all.sh. Result: lecture-prep shipped work that slides-edit would have caught. The constraints file was shared, but hooks and script wiring were not — two of three layers failed silently.

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
| Adding a hook to one skill without checking siblings | Hook fires in slides-edit but not lecture-prep. The user gets different enforcement depending on which skill they invoke. Silent — no error, just missing enforcement. | Produce Hook Coverage Matrix. Add hook to all relevant siblings or justify the gap. |
| Adding a check script without wiring it into the batch orchestrator | Script exists, passes when run manually, but never fires during the verification gate. False confidence — the gate "passes" but the check never ran. | Wire into batch orchestrator AND hook frontmatter AND verification-checks.md. All three layers. |
| Adding a constraint to an individual skill that should be shared | Constraint works in lecture-prep but notes-edit doesn't have it. User discovers the gap when notes-edit ships work that lecture-prep would have caught. | Add to common-constraints.md with `**Applies to:**` annotation. Over-inclusion beats drift. |
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
| Decision checkpoint with no review pattern tracking | You don't know what the human looks at, so you can't optimize for it. | Log what the human asks for at each review. After 3+ patterns, offer to automate. |

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
| "This hook only applies to slides-edit, not lecture-prep" | Hooks enforce mechanical constraints. If the constraint applies to the domain, it applies to ALL skills in the domain. A hook that fires in one skill but not its sibling creates inconsistent enforcement with no visible warning. | Add to all sibling skills or justify in the Hook Coverage Matrix. |
| "The script works when I run it manually" | Manual execution proves the script works. It doesn't prove the script runs automatically. An unwired script is enforcement theater — it exists but never fires. | Wire into all three layers: hook frontmatter, batch orchestrator, check definitions. |
| "I'll add this constraint to common-constraints.md later" | Later never comes. The constraint lives in one skill, the other skills ship without it, and nobody notices until the user gets inconsistent results. | Add to shared file NOW. Over-inclusion is cheaper than drift. |
| "The spec looks fine, no need to review it" | Self-review is rubber-stamping. The author can't see their own blind spots. | Dispatch a fresh reviewer subagent. 30 seconds saves hours. |
| "Plan review will slow us down" | A bad plan costs 10x more to fix during implementation than during review. | Review the plan. Fix it now, not during implementation. |
| "The reviewer can just fix small issues it finds" | That bypasses plan-execute-verify. The "fix" was never planned, never reviewed, never tested. Now you have unverified code in production. | Restrict verifiers to read-only tools. Issues go back to the executor. |
| "Context monitoring is overkill for short workflows" | A 4-phase workflow can exhaust context on phase 2 if implementation is complex. "Short" is about phase count, not context usage. | Add monitoring. It costs nothing when context is plentiful. |
| "Requirement IDs are bureaucracy" | Without IDs, the validation phase maps requirements by fuzzy text matching. "Auth" matches 3 different requirements and misses 2. | IDs take 30 seconds to assign and make coverage auditable. |
| "Autonomous mode is too risky without human oversight" | 90% of gates are rubber-stamp `human-verify`. The other 10% still pause. Autonomous mode skips the rubber stamps, not the real decisions. | Classify checkpoints. Auto-advance the rubber stamps. |
| "The human can read the test output to verify" | Maybe they can, maybe they rubber-stamp it. You don't know until you observe. Don't assume — track what they actually do. | Log the review pattern. If they consistently ask for a specific view, automate it. |

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
