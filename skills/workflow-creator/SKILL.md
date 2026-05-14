---
name: workflow-creator
description: "This skill should be used when the user asks to 'create a workflow', 'design a workflow', 'edit a workflow', 'audit workflow', 'improve workflow', 'break down a task into phases', or needs to substantially create or edit any multi-phase workflow."
version: 0.1.0
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/wc-step-gate-guard.py"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/plugin-validate.py"
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/validate-skill-paths.py"
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/wc-constraint-check.py"
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

1. **IDENTIFY:** Run `Glob(".planning/wc/*/HANDOFF.md")` and `Glob(".planning/wc/*/STATE.md")`
2. **READ:** If any HANDOFF.md found → read it. If STATE.md found without HANDOFF.md → read STATE.md to determine last completed step.
3. **VERIFY:** If HANDOFF.md exists, confirm the recorded mode/step match what STATE.md shows. If they conflict, trust STATE.md (it's hook-enforced).
4. **DECIDE:** If resumable state found → offer to resume from recorded position (skip mode detection). If not found → proceed with mode detection below. [checkpoint: decision]

**Determining `{name}`:** The `{name}` in all state file paths is the target workflow name (e.g., `dev`, `ds`, `writing`, `teaching`). For Mode 1, use the proposed workflow name from the interview. For Modes 2-3, use the workflow being audited/improved.

**Why `.planning/wc/`:** workflow-creator's state files must NOT conflict with the target project's `.planning/` state files (SPEC.md, PLAN.md, STATE.md, etc.). The `wc/` subdirectory isolates workflow-creator's meta-state from the workflow state it's auditing or creating.

**Namespace by target workflow:** Each workflow-creator invocation operates on a specific target workflow. State files go in `.planning/wc/{workflow-name}/` to prevent clashes when auditing/improving multiple workflows in parallel (e.g., parallel companions auditing dev, ds, writing simultaneously).

```
.planning/wc/
├── dev/                    → audit/improve state for dev workflow
│   ├── STATE.md
│   ├── AUDIT.md
│   └── SCORES.md
├── ds/                     → audit/improve state for ds workflow
│   ├── STATE.md
│   ├── AUDIT.md
│   └── SCORES.md
└── writing/                → audit/improve state for writing workflow
    ├── STATE.md
    └── AUDIT.md
```

For Mode 1 (create), use the proposed workflow name: `.planning/wc/{new-workflow-name}/`.

**Standard workflow-creator state files:**

| File | Purpose | Created By |
|------|---------|-----------|
| `.planning/wc/{name}/STATE.md` | Current mode + step | All modes at startup |
| `.planning/wc/{name}/INTERVIEW.md` | Captured interview answers | Mode 1 Step 2 |
| `.planning/wc/{name}/DESIGN.md` | Phase decomposition decisions | Mode 1 Step 3 |
| `.planning/wc/{name}/AUDIT.md` | Audit findings and scores | Mode 2 Step 4, Mode 3 Phase A |
| `.planning/wc/{name}/SCORES.md` | Score history across iterations | Mode 3 Phase A |
| `.planning/wc/{name}/HANDOFF.md` | Session resume context | Any mode on context exhaustion |

---

## Mode 1: Create New Workflow

```
Step 1: Philosophy ──→ Step 2: Interview ──→ Step 3/3b: Decomposition + Artifact Gates
  [auto]                [pause: interview]     [auto]
    │                       │                      │
    ▼                       ▼                      ▼
  STATE.md updated        INTERVIEW.md           DESIGN.md
                          STATE.md updated       STATE.md updated
                                                     │
Step 7: Self-Audit ◄── Step 6: Generate ◄── Step 5: Entry Points ◄── Step 4/4b: Enforcement
  [decision: present]    [decision: present]   [auto]                    [auto]
    │                       │                      │                        │
    ▼                       ▼                      ▼                        ▼
  AUDIT.md via subagent   Skill files written    STATE.md updated         STATE.md updated
  Score ≥ 8.0? ──NO──→ Fix ──→ Re-audit (max 3)
    │ YES
    ▼
  Present to user
```

**IMPORTANT:** After completing each step, proceed to the next step. Do not pause for user approval except where explicitly required (Step 6: present files, Step 7: present audit results).

<EXTREMELY-IMPORTANT>
**Enforcement architecture:** Step transitions are hook-enforced via `wc-step-gate-guard.py`:
- **Layer 2 (step-chain):** Writing `step: N` to STATE.md is BLOCKED unless `step: N-1` shows `status: completed`. This fires for ALL modes (create, audit, improve).
- **Layer 1 (file-path gates):** Writing INTERVIEW.md, DESIGN.md, AUDIT.md, and skill/constraint files is BLOCKED unless the prerequisite step is completed. Mode 1 only.

Every step below has a STATE.md YAML template. You MUST write this template to STATE.md BEFORE advancing — the hook enforces the chain.

If you catch yourself thinking "I can skip the STATE.md update" — STOP. The STATE.md update IS the gate artifact. The hook will BLOCK subsequent writes without it.
</EXTREMELY-IMPORTANT>

### Step 1: Ground in Philosophy
<!-- implements: WC-01 -->

Discover and read PHILOSOPHY.md:Read `${CLAUDE_SKILL_DIR}/../../PHILOSOPHY.md` and follow its instructions. **You MUST read this file before proceeding. No claiming you "remember" it.** Every workflow must address: phased decomposition, gates (deterministic or judgment-based), independent verification, artifact review, iteration strategy, and two entry points.

**Gate: Philosophy Loaded** `[checkpoint: human-verify, auto-advanceable]`
- Verify PHILOSOPHY.md was read
- Check that your response references: phased decomposition, gates, independent verification, artifact review, iteration strategy, two entry points
- If you cannot explain these principles, re-read PHILOSOPHY.md

**After verifying Philosophy is loaded, write initial state:**
```bash
mkdir -p .planning/wc/{name} && cat > .planning/wc/{name}/STATE.md << 'EOF'
---
mode: create
step: 1-philosophy
status: completed
implements: [WC-01]
requires: [PHILOSOPHY.md]
provides: []
affects: [.planning/wc/{name}/STATE.md]
---
Philosophy loaded. Proceeding to interview.
EOF
```

**Proceed to Step 2.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 2: Interview
<!-- implements: WC-02 -->

**Context check:** The interview is interactive and may require multiple exchanges. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with philosophy status and current progress. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

Use AskUserQuestion to understand the domain:

1. **What kind of work?** (code, data, writing, research, other)
2. **What's the deliverable?** (working feature, analysis report, polished document, etc.)
3. **What are the common failure modes?** (skipping tests, shallow analysis, weak arguments, etc.)
4. **When does drift happen?** (implementation without design, conclusions without evidence, etc.)
5. **How should iteration work?** (one-shot with verification, serial hypothesis testing, parallel exploration, agent team review)
6. **What does verification look like?** (running tests, checking output exists, reviewing summary artifact — define concretely so "verification" can't become investigation)

**Gate: Interview Complete** `[checkpoint: human-verify, auto-advanceable]`
- Verify AskUserQuestion was called
- Check that answers to all 6 questions are present
- If interview incomplete, ask remaining questions

**After verifying Interview is complete, persist answers and update state:**

Write `.planning/wc/{name}/INTERVIEW.md` with all 6 answers in structured format:
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

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 2-interview
status: completed
implements: [WC-02]
requires: [PHILOSOPHY.md]
provides: [INTERVIEW.md]
affects: [.planning/wc/{name}/INTERVIEW.md, .planning/wc/{name}/STATE.md]
key-files: {created: [.planning/wc/{name}/INTERVIEW.md]}
one-liner: "Captured domain, deliverables, failure modes, drift points, iteration style, and verification approach."
```

#### INTERVIEW.md Review Gate

Before proceeding to decomposition, verify the interview capture is complete and unambiguous. Dispatch a lightweight reviewer:

```python
Agent(
  subagent_type="general-purpose",
  description="Review INTERVIEW.md completeness",
  allowed_tools=["Read", "Grep", "Glob"],
  prompt="""Read .planning/wc/{name}/INTERVIEW.md.

Check against the 6 required interview questions:
1. Work type  2. Deliverable  3. Failure modes  4. Drift points  5. Iteration style  6. Verification

For each question, verify the answer is:
- Present (not missing or placeholder)
- Specific enough for decomposition (not "TBD" or "various")
- Consistent with the stated domain

Report: APPROVED if all 6 are adequate, or list specific gaps.
Do NOT edit the file — report only."""
)
```

**Gate: Interview Reviewed** `[checkpoint: human-verify, auto-advanceable]`
- If reviewer reports APPROVED → proceed
- If reviewer reports gaps → ask remaining questions, update INTERVIEW.md, re-review (max 3 iterations)

**Proceed to Step 3.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 3: Propose Phase Decomposition
<!-- implements: WC-03 -->

**Context check:** Decomposition and artifact gate design (Steps 3-3b) produce DESIGN.md — the recoverable artifact for enforcement generation. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with interview answers (from INTERVIEW.md) and current progress. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

Design phases where each phase has:
- **Name** - verb-noun (e.g., explore-codebase, design-approach)
- **Responsibility** - ONE question this phase answers (single responsibility principle)
- **Gate condition** - verifiable exit criterion (file exists, test passes, artifact contains X)
- **Gate artifact** - the concrete file the producing phase writes and the consuming phase checks (see Structural Gate Artifacts below)
- **Enforcement needs** - high/medium/low based on drift risk

### Structural Gate Artifacts

<EXTREMELY-IMPORTANT>
**Every mandatory gate between phases MUST be enforced by a concrete artifact — not instructional text.**

Advisory gates ("you must run X before proceeding", "prerequisite: Y complete") are unenforceable. The agent that skips a gate doesn't check whether it was supposed to run. The consuming phase must structurally refuse to start without the artifact.

**The pattern:**
1. **Producing phase** writes a marker file (e.g., `.planning/PHASE_REVIEWED.md`) with status frontmatter
2. **Consuming phase** checks for the file at startup and REFUSES to proceed without it
3. The marker file includes: `status: APPROVED/COMPLETED`, timestamp, and summary of what was verified

**Example (from dev workflow):**
```
dev-plan-reviewer writes → .planning/PLAN_REVIEWED.md (status: APPROVED)
dev-implement checks   → file exists AND status == APPROVED, else REFUSE to start
```

**Naming convention:** `.planning/{PHASE_NAME}_{ACTION}.md` (e.g., `SPEC_REVIEWED.md`, `DESIGN_APPROVED.md`, `EXPLORATION_COMPLETE.md`)

**Red Flags — STOP if you catch yourself thinking:**
- "The skill says 'must' so it will be followed" → STOP. Advisory text is not enforcement. The agent that would skip the gate is the same agent reading the advisory text.
- "The entry point chains phases automatically so gates can't be skipped" → STOP. Users can invoke any phase skill directly. Mid-point entry bypasses the chain.
- "Adding marker files is overhead" → STOP. The dev workflow shipped advisory-only gates for months. The bug was only caught by a meta-audit, not by the workflow itself.

| Gate Type | Enforcement | Can Be Bypassed? | Strength |
|-----------|-------------|-------------------|----------|
| **Advisory** | "You must run X first" | Yes — agent rationalizes past it | Weakest |
| **Artifact check** | Instructional text checks for file at startup | Mostly no — but can be skipped under context pressure | Medium |
| **Hook-enforced** | PreToolUse blocks tool calls until artifact exists | No — Claude Code blocks before action, no rationalization possible | Strongest |

**Design every inter-phase gate as hook-enforced. Artifact checks are fallback. Never advisory-only.**

### Hook-Enforced Gates (Preferred Pattern)

Use the generic `phase-gate-guard.py` hook to enforce gate artifacts at runtime. The hook blocks Write/Edit/Agent tools until the required artifact exists with the correct status.

**Frontmatter pattern for consuming phase:**
```yaml
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Agent"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
            GATE_STATUS=APPROVED
            GATE_DESCRIPTION="Plan review"
            GATE_REMEDY="Return to dev-design and run dev-plan-reviewer"
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
```

**How it works:**
1. Producing phase writes `.planning/X_REVIEWED.md` with `status: APPROVED` frontmatter (unchanged)
2. Consuming phase declares a PreToolUse hook that checks for the artifact
3. Claude Code blocks Write/Edit/Agent calls until the artifact exists
4. Writes to `.planning/` and `.claude/` are always allowed (the phase can still write state files)

**Why hooks > artifact checks in instructions:**
- Instructions can be compressed away during context compaction
- Claude can rationalize "the file probably exists, I'll check later"
- Hooks fire on EVERY tool call — no escape, no rationalization, no context dependency

**When designing gates for a new workflow, generate BOTH:**
1. The artifact (producing phase writes it)
2. The hook (consuming phase declares it in frontmatter)
</EXTREMELY-IMPORTANT>

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

**CRITICAL — Flat Dispatch Only:** For "Parallel exploration" and "Agent team" strategies, the orchestrator (phase skill or main chat) MUST spawn all agents directly. Never design an intermediate "coordinator" or "dispatcher" agent that spawns sub-agents on its own. See Iron Law of Flat Dispatch.

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
<!-- implements: WC-10 -->

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
2. **Handoff trigger** — when context is low, trigger `.planning/HANDOFF.md` creation instead of starting a new phase
3. **Phase-aware warnings** — implementation phases need more remaining context than exploration phases

**Implementation pattern:**
- At phase entry, check if sufficient context remains for the phase's expected work
- If context is low (≤35% remaining), write `.planning/HANDOFF.md` and pause rather than starting degraded work
- If context is critical (≤25% remaining), immediately write `.planning/HANDOFF.md` — no new work

**Standard thresholds:**

| Level | Remaining Context | Action |
|-------|------------------|--------|
| Normal | >35% | Proceed normally |
| Warning | 25-35% | Complete current task, then handoff |
| Critical | ≤25% | Immediate handoff, no new tasks |

**Why:** Context exhaustion is the #1 cause of lost work in long workflows. An agent that starts a 10-task implementation phase with 20% context remaining will produce garbage for the last 5 tasks. Better to handoff cleanly and resume fresh.

### Summary Frontmatter
<!-- implements: WC-11 -->

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

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 3-decomposition
status: completed
implements: [WC-03]
requires: [PHILOSOPHY.md, INTERVIEW.md]
provides: [phase decomposition, gate conditions, enforcement needs]
affects: [.planning/wc/{name}/STATE.md]
one-liner: "Phases decomposed with single responsibilities, gate conditions, and enforcement needs."
```

**Proceed to Step 3b.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 3b: Add Artifact Review Gates
<!-- implements: WC-04 -->

**Context check:** Step 3b produces DESIGN.md — the recoverable artifact for enforcement generation. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with decomposition progress and current DESIGN.md draft. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

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

**Gate: Artifact Review Gates Designed** `[checkpoint: human-verify, auto-advanceable]`
- Every artifact-producing phase has a review gate before the consuming phase
- Reviewer is a fresh subagent (not self-review)
- Fix-and-re-review loop with max 5 iterations
- Chunking specified for large artifacts

**After verifying Artifact Review Gates are designed, persist design decisions:**

Write `.planning/wc/{name}/DESIGN.md` with phase decomposition, topology choice, iteration strategies, and artifact review gates. This is the recoverable artifact if context exhausts during enforcement generation.

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 3b-artifact-review
status: completed
implements: [WC-03, WC-04]
requires: [PHILOSOPHY.md, INTERVIEW.md]
provides: [DESIGN.md]
affects: [.planning/wc/{name}/DESIGN.md]
key-files: {created: [.planning/wc/{name}/DESIGN.md]}
one-liner: "Phase decomposition, topology, iteration strategies, and artifact review gates finalized."
```

#### DESIGN.md Review Gate

Before proceeding to enforcement generation, verify the decomposition design is sound. Dispatch a lightweight reviewer:

```python
Agent(
  subagent_type="general-purpose",
  description="Review DESIGN.md completeness",
  allowed_tools=["Read", "Grep", "Glob"],
  prompt="""Read .planning/wc/{name}/DESIGN.md.

Check against decomposition requirements:
1. Each phase has a single responsibility (one question answered)
2. Every phase has a gate condition (verifiable exit criterion)
3. Gate artifacts are specified (concrete files, not prose)
4. Iteration topology is assigned per phase
5. Artifact review gates exist between producing/consuming phases

Report: APPROVED if design is sound, or list specific gaps.
Do NOT edit the file — report only."""
)
```

**Gate: Design Reviewed** `[checkpoint: human-verify, auto-advanceable]`
- If reviewer reports APPROVED → proceed
- If reviewer reports gaps → fix DESIGN.md, re-review (max 3 iterations)

**Proceed to Step 4.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 4: Apply Enforcement Patterns
<!-- implements: WC-05 -->

**Context check:** Steps 4-6 generate enforcement content and workflow files — the most context-intensive work. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with interview answers (from `.planning/wc/{name}/INTERVIEW.md`), phase decomposition (from `.planning/wc/{name}/DESIGN.md`), and current progress. Pause.
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
| **Phase gate prerequisite** | `PreToolUse` hook using `phase-gate-guard.py` — checks artifact exists with correct status before allowing Write/Edit/Agent |
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
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/[phase]/scripts/guard-media-files.py"
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

**Gate: Enforcement Patterns Loaded** `[checkpoint: human-verify, auto-advanceable]`
- Verify enforcement-checklist.md was read
- Check that you can name all 13 patterns
- If you cannot list them, re-read enforcement-checklist.md

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 4-enforcement
status: completed
implements: [WC-05]
requires: [DESIGN.md, enforcement-checklist.md]
provides: [enforcement pattern assignments per phase]
affects: [.planning/wc/{name}/STATE.md]
one-liner: "13 enforcement patterns assigned to phases based on drift risk."
```

**Proceed to Step 4b.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 4b: Common Enforcement Across Skill Families

**Context check:** Cross-skill consistency analysis reads multiple sibling skills and produces hook/script coverage matrices. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with enforcement plan from Step 4 and current progress. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

When multiple skills operate on the same domain, they need consistent enforcement across **three layers**: constraints (prompt), hooks (structural), and script wiring (gate orchestration). Scan the target plugin:

#### Layer 1: Shared Constraints (Co-located in `constraints/`)

1. List all `skills/*/SKILL.md` files in the target plugin directory
2. For each sibling skill, identify enforcement patterns (Iron Laws, Rationalization Tables, Red Flags)
3. Check if a `references/constraints/` directory already exists with co-located `.md` + `.py` pairs

**If `constraints/` directory exists:** new skills MUST `Read()` the specific `.md` files they need from that directory.

**If no shared directory exists but sibling skills share the same domain:** create `references/constraints/` and extract common enforcement into atomic files — one `.md` per rule, co-located `.py` for mechanically testable rules. Each skill `Read()`s only the specific files it needs; skill-specific enforcement stays inline.

**Constraint Propagation Rule:** When adding a new rule, create the `.md` file (+ `.py` if testable) in `references/constraints/` with `applies-to` frontmatter. Over-inclusion beats drift. The filesystem is the index — no separate TOC file to maintain.

#### Constraint Architecture: Co-located Pairs, Auto-discovered

Constraints and conventions are **unit tests for agent behavior**. The architecture follows test framework design: co-located files, auto-discovery, structured output, no manual wiring.

#### The One Directory

All rules live in a single `constraints/` directory. No separate `conventions/` directory. The distinction between constraint and convention is **presence of a check script**, not directory location.

```
references/
├── constraints/                       → all rules live here
│   ├── no-agent-resume.md             → rule (loaded into LLM context)
│   ├── no-agent-resume.py             → check script (run by test runner)
│   ├── source-first-fixes.md          → has .py pair = constraint (tested)
│   ├── source-first-fixes.py
│   ├── verbatim-quotes.md
│   ├── verbatim-quotes.py
│   ├── diagram-storytelling.md        → no .py pair = convention (judgment-only)
│   ├── section-transitions.md         → convention (graduation candidate)
│   └── ...
```

**Same name links them.** `source-first-fixes.md` + `source-first-fixes.py` = a constraint. `diagram-storytelling.md` alone = a convention. No frontmatter wiring. No manual registration. No index files to maintain.

**Graduation = writing the `.py` file.** A convention becomes a constraint the moment you add its check script. No moving files, no updating indexes.

**The classification test:** Ask the user: "Can you write a script that returns pass/fail for this rule?" If yes → write the `.py` file (constraint). If it requires reading and judging → `.md` only (convention). Some rules start as conventions and graduate when testability improves.

**Examples:**
- `no-agent-resume.md` + `no-agent-resume.py` → constraint (mechanically detectable)
- `diagram-storytelling.md` (no `.py`) → convention (requires judgment)
- `verbatim-quotes.md` + `verbatim-quotes.py` → constraint (diff-checkable)
- `section-transitions.md` (no `.py`) → convention (requires reading)

#### Rule File Structure

Each `.md` file is self-contained:

```markdown
---
name: constraint-name
description: One-line trigger description
applies-to: [skill-1, skill-2, skill-3]
---

## Rule

The rule stated clearly.

## Rationale

**Why this exists** — cite the real incident or failure mode.

## Examples

### Correct
[Example of correct behavior]

### Incorrect
[Example of incorrect behavior]

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| ... | ... | ... |

## Red Flags

- **"..."** → STOP. [Why this thought is wrong]
```

#### Check Script Interface

Each `.py` file follows a standard interface so the runner can auto-discover and execute it:

```python
#!/usr/bin/env python3
"""Constraint: no-agent-resume — NEVER use agent resume; spawn fresh."""

CONSTRAINT = "no-agent-resume"
APPLIES_TO = ["all"]
SEVERITY = "hard"  # hard = block, soft = warn

def check(context):
    """Returns list of violations. Empty list = pass."""
    violations = []
    # ... check logic ...
    return violations

if __name__ == "__main__":
    import json, sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
```

#### Test Runner: Auto-discovery

The runner **discovers** check scripts — no manual wiring. Add a `.py` file, it runs automatically.

```python
#!/usr/bin/env python3
"""check-all.py — auto-discovers and runs all constraint checks."""
import glob, importlib.util, json, sys

constraints_dir = "references/constraints"
results = {"passed": [], "failed": [], "conventions": [], "errors": []}

md_files = set(p.stem for p in Path(constraints_dir).glob("*.md"))
py_files = set(p.stem for p in Path(constraints_dir).glob("*.py"))

for name in sorted(md_files):
    if name in py_files:
        # Constraint — has check script, run it
        mod = import_check(f"{constraints_dir}/{name}.py")
        violations = mod.check(context)
        if violations:
            results["failed"].append({"name": name, "violations": violations})
        else:
            results["passed"].append(name)
    else:
        # Convention — no check script, flag for reviewer
        results["conventions"].append(name)

print(json.dumps(results, indent=2))
print(f"\n{len(results['passed'])}/{len(md_files)} passed, "
      f"{len(results['failed'])} failed, "
      f"{len(results['conventions'])} conventions (judgment-only)")
sys.exit(1 if results["failed"] else 0)
```

**Coverage is automatic.** The runner computes it from the filesystem — no hand-maintained coverage matrix.

#### Verification Architecture: Two Legs

```
Verification Phase
    ↓
Leg 1: uv run python3 check-all.py (auto-discovers constraints/*.py)
    ↓
    Structured results: {passed: [...], failed: [...], conventions: [...]}
    ↓                              ↓
    All passed                    FAIL → fix → re-run
    ↓
Leg 2: Spawn reviewer subagent
    ↓  (runner passes conventions list — the .md files without .py pairs)
    ↓  (reviewer loads those .md files and scores work against them)
    ↓                              ↓
    Score >= threshold             Score < threshold → revise → re-score
    ↓
VERIFIED
```

Both legs are necessary. Passing constraints but failing conventions = code that passes CI but fails code review. Passing conventions but failing constraints = code that looks good but has bugs.

**How skills reference constraint files:**

Skills use a bang to auto-load all applicable constraints at skill load time:

```
# In a skill's SKILL.md:
!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py skill-name`
```

This mirrors `check-all.py`'s auto-discovery but for `.md` prose:

```python
#!/usr/bin/env python3
"""load-constraints.py — load .md constraint prose for a skill, filtered by applies-to."""
import yaml, sys
from pathlib import Path

def load(skill_name, constraints_dir="references/constraints"):
    for md in sorted(Path(constraints_dir).glob("*.md")):
        text = md.read_text()
        if not text.startswith("---"):
            continue
        _, fm, body = text.split("---", 2)
        meta = yaml.safe_load(fm)
        applies = meta.get("applies-to", [])
        if "all" in applies or skill_name in applies:
            print(f"\n{'='*60}")
            print(f"# Constraint: {meta.get('name', md.stem)}")
            print(f"{'='*60}")
            print(body.strip())

if __name__ == "__main__":
    load(sys.argv[1])
```

The script:
1. Globs `constraints/*.md`
2. Parses `applies-to` frontmatter
3. Filters for the skill name (or `all`)
4. Outputs concatenated content

Adding a new constraint = create the `.md` file with `applies-to`. No skill edits needed.

> **Fallback:** For plugins without the loader script, explicit `Read()` calls to specific `.md` files still work — but the auto-discovery pattern is preferred.

No index file needed. The filesystem IS the index. `ls constraints/*.md` shows all rules. `ls constraints/*.py` shows all tests.

**Constraint Propagation Rule:** When adding a new rule, create the `.md` file in `constraints/`. If it's mechanically testable, also create the `.py` file. Set `applies-to` in the `.md` frontmatter. Over-inclusion beats drift.

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

#### Layer 3: Script Wiring (Auto-discovery + Hooks)

With the co-located architecture, script wiring is simpler — the auto-discovering runner (`check-all.py`) handles batch execution. But hooks still need explicit wiring:

1. List all `.py` check scripts in `references/constraints/`
2. Verify the auto-discovering runner (`check-all.py`) exists and globs `constraints/*.py`
3. For guard hooks (`PreToolUse`/`PostToolUse`), verify each is in at least one skill's YAML frontmatter
4. Produce a **Script Wiring Matrix**:

```
| Script              | Auto-discovered | Hook Reference |
|---------------------|----------------|----------------|
| no-agent-resume.py  | ✅ constraints/ | ✅ pre-tool guard |
| source-first.py     | ✅ constraints/ | ✅ pre-tool guard |
| check-widows.py     | ✅ constraints/ | ✅ post-compile guard |
| new-check.py        | ✅ constraints/ | ❌ No hook |
```

5. Flag any `.py` file in `constraints/` without a corresponding `.md` file (orphaned test)
6. Flag any guard hook that references a script NOT in `constraints/` (manual wiring when it should be co-located)

**Why auto-discovery eliminates most wiring bugs:** Adding a `.py` to `constraints/` = automatically run by the test runner. No manual registration. The main wiring failure mode now is hooks — guard hooks still need explicit YAML frontmatter.

**Gate: Cross-Skill Consistency Complete** `[checkpoint: human-verify, auto-advanceable]`
- Verify sibling skills were scanned (or note that no siblings exist)
- Layer 1: If `constraints/` directory exists, verify sibling skills `Read()` the specific `.md` files they need. If skills share a domain, verify common rules are in `constraints/` (not inlined).
- Layer 2: Hook Coverage Matrix produced. No unexplained gaps.
- Layer 3: Script Wiring Matrix produced. No unwired scripts.

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 4b-cross-skill
status: completed
implements: [WC-05]
requires: [DESIGN.md, enforcement-checklist.md]
provides: [enforcement plan, hook coverage matrix]
affects: [.planning/wc/{name}/STATE.md]
```

**Proceed to Step 5.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 5: Design Two Entry Points
<!-- implements: WC-06 -->

**Context check:** Entry point design is moderate effort. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with enforcement plan and current progress. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

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
  1. .planning/ACTIVE_WORKFLOW.md    → workflow state (what phase, what style)
  2. .planning/PRECIS.md, .planning/OUTLINE.md → structural intent (what we're building)
  3. ai-anti-patterns      → universal constraints (no AI-smell)
  4. domain skill           → domain constraints
  THEN: check the draft against all four layers

/dev-debug loads:
  1. .planning/HYPOTHESES.md          → what's been tried
  2. .planning/LEARNINGS.md           → accumulated knowledge
  THEN: spawn fresh subagent for next investigation iteration

/ds-fix loads:
  1. .planning/SPEC.md, .planning/PLAN.md       → objectives and task breakdown
  2. .planning/LEARNINGS.md            → pipeline state and observations
  3. output-first protocol   → verification enforcement
  THEN: diagnose and route to fix path
```

**Critical rule:** Any phase that evaluates quality must load the full constraint set, not a summary of it. Summaries enable reward hacking — the agent checks against a 4-item summary, finds no issues, and reports "all checks pass" when the full rules would have caught problems. The fix: `Read()` the actual skill before checking.

#### Shared Constraint Files

See Step 4b for the full atomic constraint/convention architecture. This section covers only the **midpoint-specific** concern.

**Midpoint constraint loading:** The midpoint must load every constraint it needs before touching the work. Load the specific `.md` files relevant to the current phase directly — no index file needed.

```
/writing-revise loads:
  1. .planning/ACTIVE_WORKFLOW.md    → workflow state
  2. references/constraints/verbatim-quotes.md → specific constraint for revision
  3. references/constraints/source-first-fixes.md → specific constraint for revision
  THEN: check the draft against loaded constraints
```

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

**Gate: Two Entry Points Designed** `[checkpoint: human-verify, auto-advanceable]`
- Verify entry point (start fresh) is defined
- Verify midpoint (re-enter) is defined with constraint loading
- If either is missing, design both entry points

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 5-entry-points
status: completed
implements: [WC-06]
requires: [DESIGN.md]
provides: [entry point design, midpoint design]
affects: [.planning/wc/{name}/STATE.md]
one-liner: "Entry point (start fresh) and midpoint (re-enter with constraint loading) designed."
```

**Proceed to Step 6.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 6: Generate Workflow Files
<!-- implements: WC-07 -->

Create the following artifacts:
1. **Entry command** (`skills/[name]/SKILL.md`) — routes to first phase
2. **Midpoint command** (`skills/[name]-fix/SKILL.md` or `skills/[name]-debug/SKILL.md`) — self-contained re-entry
3. **Phase skills** (`skills/[name]-[phase]/SKILL.md`) — one per phase, internal only
4. **Constraint files** — co-located in `references/constraints/`:
   - One `.md` per rule (loaded into LLM context)
   - Co-located `.py` for mechanically testable rules (auto-discovered by runner)
   - `.md` without `.py` = convention (judgment-only)
   - `check-all.py` auto-discovering runner
5. **Wire up transitions** — each phase ends by reading the next phase's skill
6. **Post-subagent boundaries** — each phase skill that dispatches a subagent MUST include:
   - What main chat CAN do after subagent returns (read results, fix gaps, present to user)
   - What main chat CANNOT do (re-score, override subagent findings, declare "close enough")
   - Tool restriction tier for the subagent (executor/verifier/researcher/auditor)

#### State Folder Convention

Workflows should store all state files in a `.planning/` directory at the project root (not `.claude/`). This keeps workflow state separate from Claude Code configuration.

**Standard state files (all written to `.planning/`):**
| File | Purpose | When Created |
|------|---------|-------------|
| `.planning/SPEC.md` | Requirements, goals, constraints | Brainstorm/clarify phase |
| `.planning/PLAN.md` | Task breakdown with status tracking | Design phase |
| `.planning/STATE.md` | Current workflow position (active phase, blockers) | Entry point startup |
| `.planning/HANDOFF.md` | Session pause/resume context | On pause or context exhaustion |
| `.planning/VALIDATION.md` | Requirement-to-test coverage map | Validation phase |
| `.planning/LEARNINGS.md` | Accumulated discoveries and decisions | Throughout workflow |

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

Present complete file list for user approval before writing. `[checkpoint: decision — user chooses which files to generate]`

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 6-generate
status: completed
implements: [WC-07, WC-10, WC-11]
requires: [INTERVIEW.md, DESIGN.md]
provides: [skills/{name}/SKILL.md, skills/{name}-fix/SKILL.md, phase skills, constraint files]
affects: [skills/{name}/, references/constraints/]
key-files: {created: [skills/{name}/SKILL.md, skills/{name}-fix/SKILL.md]}
one-liner: "All workflow files generated: entry command, midpoint, phase skills, constraints."
```

### Deviation Rules for Steps 4-6 (File Generation)

During enforcement generation (Step 4) and file writing (Step 6), unplanned issues may arise. Apply these deviation rules:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Bug** | Broken path, invalid YAML, syntax error in generated file | Fix immediately, note in STATE.md | Auto |
| **R2: Missing Critical** | Generated workflow missing a gate, missing enforcement for high-drift phase | Add the missing element, note in STATE.md | Auto |
| **R3: Blocking** | Constraint file conflict, skill naming collision, hook script missing | Fix blocker, note in STATE.md | Auto |
| **R4: Architectural** | User's domain doesn't fit proposed topology, need to restructure phases | STOP — present decision to user with options | Ask user |

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4

### Delete & Restart Protocol

<EXTREMELY-IMPORTANT>
If you generate workflow files (Step 6) without having completed Steps 1-5 — or if STATE.md does not show steps 1-5 as completed — DELETE all generated files and restart from Step 1. No exceptions.

Patching files generated without proper investigation, interview, decomposition, and enforcement design is worse than restarting. The generated files inherit every gap from the skipped steps.
</EXTREMELY-IMPORTANT>

### Step 7: Self-Audit the Generated Workflow
<!-- implements: WC-08 -->

**Context check:** Step 7 dispatches a subagent with a large prompt containing all generated file paths and audit criteria. This is one of the most context-intensive operations. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with generated file list, current step, and note that self-audit is pending. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately — do not attempt the subagent dispatch.

<EXTREMELY-IMPORTANT>
## The Iron Law of Eating Your Own Cooking

**NO GENERATED WORKFLOW WITHOUT A MODE 2 AUDIT ON IT. This is not negotiable.**

workflow-creator mandates audit-fix loops, independent verification, and artifact review gates for every workflow it creates. It cannot exempt its own output from these same standards.

**Skipping the self-audit is NOT HELPFUL — you're shipping an unverified workflow to the user. The user will discover the gaps when the workflow fails in production. The 5-minute audit would have caught them.**
</EXTREMELY-IMPORTANT>

After generating workflow files in Step 6:

<EXTREMELY-IMPORTANT>
**The audit MUST be run by a fresh subagent with read-only tools — not by you.** If you run the audit yourself, you are self-reviewing your own work; see the Iron Law above. The same agent that wrote the files cannot score them independently.
</EXTREMELY-IMPORTANT>

1. **Dispatch fresh audit subagent** (same pattern as Mode 3 Phase A):

   ```python
   Agent(
     subagent_type="general-purpose",
     description="Self-audit generated workflow",
     allowed_tools=["Read", "Grep", "Glob"],  # REQUIRED — no Write/Edit
     prompt="""You are an independent workflow auditor with no knowledge of how
     these files were written. Read Mode 2 criteria in
     ${CLAUDE_SKILL_DIR}/SKILL.md, then
     read ALL generated skill files: [LIST THEM].

     Score the 20 architecture principles (0-10 each) and 13 enforcement
     patterns (Present/Weak/Absent per phase). Compute composite (average of
     non-exempt principles).

     Return findings as text output (you have read-only tools — the caller writes AUDIT.md). Do NOT soften.
     """
   )
   ```

2. **Check score:** If composite score < 8.0, fix the generated files and re-dispatch a fresh audit subagent (max 3 iterations). Each iteration gets a NEW subagent — no resume, no context carryover.
3. **Present to user** `[checkpoint: decision — user approves or requests changes]` with the audit report attached — the user sees both the workflow AND its quality score

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

#### Post-Subagent Enforcement (Step 7)

After the audit subagent returns, main chat operates under these restrictions:

| Main chat CAN do (verification) | Main chat CANNOT do (investigation) |
|----------------------------------|--------------------------------------|
| Read AUDIT.md and SCORES.md | Re-score principles (auditor's scores are authoritative) |
| Fix specific gaps identified in AUDIT.md | Override audit findings ("the auditor was wrong about X") |
| Re-dispatch a NEW audit subagent | Declare "close enough" below 8.0 |
| Present results to user | Edit generated files without addressing a scored gap |

**The audit subagent's score is authoritative.** If you disagree with a score, fix the gap and let the next audit re-score — do not override.

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 7-self-audit
status: completed
implements: [WC-08, WC-09]
requires: [DESIGN.md, generated skill files]
provides: [AUDIT.md]
affects: [.planning/wc/{name}/AUDIT.md]
key-files: {created: [.planning/wc/{name}/AUDIT.md]}
one-liner: "Fresh subagent audit complete. Composite score and per-principle gaps recorded."
```

---

## Mode 2: Audit Existing Workflow

```
Step 1: Read All Files ──→ Step 2: Score 20 Principles ──→ Step 3: Score 13 Patterns
  [auto]                     [auto]                          [auto]
    │                           │                               │
    ▼                           ▼                               ▼
  File map built              P01-P21 scored                  Patterns scored per phase
                                                                  │
                              Step 3b: Path Portability ◄─────────┘
                                [auto]
                                  │
                                  ▼
                              Step 4: Output Report
                                [decision: present to user]
                                  │
                                  ▼
                              AUDIT.md written
```

**IMPORTANT:** After completing each step, IMMEDIATELY proceed to the next step. Do not pause or wait for user input between steps.

**State initialization:** Create `.planning/wc/{name}/STATE.md` with `mode: audit, step: 1-read, status: in_progress, target: [workflow name]`.

**Context monitoring:** Mode 2 audits complex multi-file workflows. Check context availability:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` and pause — the audit will degrade if context is exhausted mid-scoring.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

### Step 1: Read the Workflow

Read the workflow's entry command and ALL phase skills. Build a map of phases, transitions, and enforcement.

**Gate: Workflow Fully Read** `[checkpoint: human-verify, auto-advanceable]`
- Verify entry command was read
- Verify ALL phase skills were read (count Read() calls)
- If any phase skill is missing, read it now

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 1-read
status: completed
requires: [all workflow skill files]
provides: [file map, phase/transition inventory]
affects: [.planning/wc/{name}/STATE.md]
```

**Proceed to Step 2.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 2: Score Against Core Principles (P01-P21)
<!-- implements: WC-09 -->

Score each principle 0-10. Use the formal ID (P01-P21) in all audit output for traceability.

**P01 — Phased decomposition:**
- Does each phase have a single responsibility?
- Are phase boundaries clear?
- Can phases be executed out of order? (they shouldn't be)

**P02 — Gates (deterministic or judgment-based):**
- Are gates machine-verifiable where possible? (file exists, test passes)
- For subjective domains, are judgment gates explicit? (agent-assessed or human-assessed)
- Or are they just prose? ("ensure quality is high")
- Are there ungated transitions?

**P03 — Structural gate enforcement (CRITICAL — this is the #1 audit gap):**
- For every mandatory inter-phase gate, classify as STRUCTURAL or ADVISORY:
  - **STRUCTURAL:** Producing phase writes a concrete artifact (`.planning/X_REVIEWED.md`), consuming phase checks for it at startup and refuses to proceed without it
  - **ADVISORY:** Gate uses instructional text only ("you must", "prerequisite:", "do not proceed without") — no artifact, no check
- **Any advisory-only mandatory gate is a defect.** Flag it in the Critical Gaps section.
- Check BOTH sides: (1) does the producing phase actually write the artifact? (2) does the consuming phase actually check for it?
- Produce a **Gate Enforcement Matrix**:

```
| Transition | Gate | Artifact | Producer Writes? | Consumer Checks? | Status |
|------------|------|----------|-------------------|-------------------|--------|
| design → implement | plan reviewed | PLAN_REVIEWED.md | ✅ | ✅ | STRUCTURAL |
| explore → clarify | exploration done | (none) | ❌ | ❌ | ADVISORY ⚠️ |
```

- Additionally classify STRUCTURAL gates as **HOOK-ENFORCED** or **INSTRUCTION-ONLY**:
  - **HOOK-ENFORCED:** Skill frontmatter declares a PreToolUse hook that checks for the artifact (strongest)
  - **INSTRUCTION-ONLY:** Skill text checks for the artifact but no hook blocks tool calls (weaker — can be rationalized past under context pressure)
- Score: count of STRUCTURAL gates / total mandatory gates. Below 80% = critical gap. Count of HOOK-ENFORCED / STRUCTURAL gates — below 50% = recommend hook migration.

**P04 — Independent verification:**
- Is verification structurally independent from implementation? (fresh subagent, not self-review)
- Does the verifier see only spec + output, not the implementation journey?
- For subjective output, are there multiple specialized reviewers? (team topology)
- Is self-review ever the final gate? (it shouldn't be)
- Does verification check all 4 depth levels, or just existence?
- Does any agent spawn its own sub-agents? (nested dispatch — must be flat instead)

**Verification depth levels** (from GSD goal-backward verification):

| Level | Name | Checks | Example Failure |
|-------|------|--------|-----------------|
| 1 | **Exists** | File/function/test physically present | Test file never created |
| 2 | **Substantive** | Not a stub, placeholder, or TODO | Function body is `pass` or `return {}` |
| 3 | **Wired** | Connected to the system (imported, called, routed) | Component defined but never rendered |
| 4 | **Functional** | Actually works end-to-end | Tests pass, feature runs |

If verification only checks Level 1 (exists), it's theater. A workflow that claims "test exists" without checking the test is substantive, wired, and functional is shipping false confidence.

**P05 — Artifact review:**
- Are intermediate artifacts (specs, plans, outlines) reviewed before downstream phases consume them?
- Is the reviewer a fresh subagent (not the phase that wrote the artifact)?
- Is there a fix-and-re-review loop with iteration limits?
- Are large artifacts (>15 items) chunked for separate review?
- Is there model tier guidance for delegation phases?

**P06 — Two entry points:**
- Does the workflow have both an entry (start fresh) and midpoint (re-enter)?
- Is the midpoint self-contained? (loads all constraints, doesn't depend on prior phases)
- Does the midpoint load full skills, not summaries?
- Do skills that share a domain share a common enforcement file? (or does each skill enforce its own version of the rules?)
- Could a user get inconsistent enforcement depending on which skill they invoke?

**P07 — Cross-skill consistency (three layers):**
- **Constraints:** Do all sibling skills Read() from the same `constraints/` directory? Are rules co-located (`.md` + `.py` pairs for testable rules, `.md` only for conventions)? Is there an auto-discovering runner (`check-all.py`) that globs `constraints/*.py`?
- **Hooks:** Do all sibling skills declare the same hooks in their YAML frontmatter? If a hook is present in some siblings but not others, is the gap justified? (Produce a Hook Coverage Matrix: skills × hooks)
- **Script wiring:** Is every check script referenced in all three layers: (a) hook frontmatter, (b) batch orchestrator, (c) verification-checks definition? (Produce a Script Wiring Matrix: scripts × invocation points)

**P08 — Constraint/convention test coverage:**
- Do all rules live in a single `constraints/` directory? (no separate `conventions/` directory)
- Is the constraint/convention distinction based on **presence of a `.py` check script**, not directory location?
- Does `check-all.py` (auto-discovering test runner) exist? Does it glob `constraints/*.py` — no manual wiring?
- Does the verification phase run **both legs**: constraint checks (test runner, hard block) AND convention scoring (reviewer subagent loads `.md` files without `.py` pairs, soft block)?
- Are there `.md`-only files (conventions) that could **graduate** to constraints by adding a `.py` check script?
- Compute **coverage** from the filesystem: `len(*.py) / len(*.md)` — what percentage of rules have mechanical tests?

**P09 — Iteration strategy:**
- Does each phase have an appropriate iteration topology? (one-shot, serial, parallel, team)
- Are exit conditions structural (tests, convergence, human approval) not honor-system (promises)?

**P10 — Post-subagent enforcement (from dev-debug v5.0 audit, March 16 2026):**
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

**P11 — Deviation rules (from GSD 4-rule system):**
- Do implementation phases have a deviation rule system (auto-fix for bugs/missing/blocking, STOP for architectural)?
- Are deviation categories adapted to the domain?
- Are deviations tracked and summarized per task?

**P12 — State management:**
- Does the workflow use `.planning/` for state files (not `.claude/` or scattered locations)?
- Are standard state files present (`.planning/SPEC.md`, `.planning/PLAN.md`, `.planning/STATE.md`, `.planning/LEARNINGS.md`)?
- Is state file-based, git-trackable, and human-editable?

**P13 — Session handoff:**
- Does the entry point check for `.planning/HANDOFF.md` on startup?
- Is the handoff document structured with frontmatter and mandatory sections?
- Can work resume from a handoff without re-discovering context?

**P14 — Checkpoint types:**
- Are gates classified by type (human-verify, decision, human-action)?
- Can the workflow auto-advance human-verify checkpoints in autonomous mode?
- Are true decision points (multiple valid approaches) distinguished from rubber-stamp approvals?

**P15 — Context monitoring:**
- Do phases check context availability before starting expensive work?
- Is there a handoff trigger when context is low (≤35%)?
- Does the workflow degrade gracefully or just produce garbage at context exhaustion?

**P16 — Summary frontmatter:**
- Do phase completions produce structured YAML summaries?
- Do summaries include `implements`, `requires`, `provides`, `affects` fields?
- Is the one-liner substantive (not "Phase complete")?

**P17 — Agent tool restrictions:**
- Are verification/review agents restricted to read-only tools via `allowed-tools` frontmatter?
- Can a verifier Write or Edit? (it shouldn't — that bypasses plan-execute-verify)
- Are tool restriction tiers appropriate for each agent role?

**P18 — Requirement traceability:**
- Do requirements have unique IDs in `.planning/SPEC.md` (e.g., AUTH-01)?
- Do `.planning/PLAN.md` tasks reference requirement IDs?
- Does `.planning/VALIDATION.md` map every ID to test evidence?
- Is there a scope classification (v1/v2/out-of-scope)?

**P19 — Autonomous phase chaining:**
- Can phases chain automatically without human intervention at every step?
- Does the workflow batch ambiguities (smart discuss) instead of sequential asks?
- Does it re-read the plan after each phase to catch dynamically inserted phases?
- Are blockers handled with retry/skip/stop options?

**P19b — Visual output for human verification:**
- Do `decision` checkpoints offer visual artifacts when the human's review pattern suggests them?
- Does the workflow log what the human actually looks at during review (in `.planning/LEARNINGS.md`)?
- If the human has asked for the same view 3+ times, has it been automated into a script?

**P20 — Hooks over prompt enforcement:**
- Are mechanically-checkable constraints enforced via scoped hooks (PreToolUse/PostToolUse in skill frontmatter)?
- Or are they enforced only via prompt text (Iron Laws, Red Flags) that consume context and can be rationalized away?
- Specifically check for: **phase gate enforcement** (prerequisite artifact checks), file extension guards, path guards, tool parameter validation, tool sequence enforcement, post-subagent restrictions
- Behavioral/motivational constraints (rationalization tables, drive-aligned framing) should STAY as prompt — hooks can't teach reasoning
- Score based on: how many mechanical constraints are prompt-only when they could be hooks?

**P21 — Auto-loader usage for constraints:**
- Do phase skills that load constraint prose use the bang-invoked auto-loader?
  ```
  !`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py <skill-name>`
  ```
- Or do they list `Read()` calls for each constraint `.md` file manually?
- **Why this matters:** The auto-loader + `applies-to` frontmatter is the wiring that makes atomic constraints work. Manual `Read()` lists mean adding a new constraint requires editing every skill that should load it — silent drift is the default failure mode.
- Check: Run `uv run python3 references/constraints/auto-loader-usage.py`. Every flagged SKILL.md is a violation.
- Exceptions: router skills that immediately delegate (no constraint evaluation), ad-hoc single-file references (not phase sets), plugins without `scripts/load-constraints.py`.
- Score: count of phase skills using the loader / count of phase skills that load ≥2 constraints. Below 80% = critical gap.

**Gate: Architecture Scored** `[checkpoint: human-verify, auto-advanceable]`
- Verify scores for all P01-P21 (+ P19b) principles are present
- Each principle must have numeric score (0-10) + 1-line justification
- If any principle ID is missing, score it now
- Composite = average of scored (non-N/A) principles

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 2-score
status: completed
implements: [WC-09]
requires: [all workflow skill files]
provides: [P01-P21 scores with justifications]
affects: [.planning/wc/{name}/STATE.md]
```

**Proceed to Step 3.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 3: Score Against Enforcement Checklist

!`cat ${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md` **You MUST read this file before scoring. No scoring from memory.**

For each of the 13 patterns, score:
- **Present** - pattern exists and is well-implemented
- **Weak** - pattern exists but is insufficient (e.g., soft language instead of Iron Law)
- **Absent** - pattern is missing where it should exist

Identify the highest-drift phases with the weakest enforcement - these are the critical gaps.

**Gate: Enforcement Scored** `[checkpoint: human-verify, auto-advanceable]`
- Verify all 13 patterns were scored
- Each pattern must be marked: Present / Weak / Absent
- If any pattern is missing, score it now

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 3-enforcement
status: completed
requires: [enforcement-checklist.md, all workflow skill files]
provides: [13-pattern scores per phase]
affects: [.planning/wc/{name}/STATE.md]
```

**Proceed to Step 3b.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 3b: Audit Path Portability

Skills run in the user's project CWD, not the plugin directory. Every path in a SKILL.md that references plugin-internal files must resolve regardless of CWD.

**Scan every SKILL.md and references/*.md file in the workflow for these patterns:**

1. **Relative script paths** — `uv run python3 scripts/`, `uv run python3 ../`, `uv run python3 ../../` referencing plugin scripts
   - These break because the agent's CWD is the user's project
   - **Fix:** Use `${CLAUDE_SKILL_DIR}/../..` for absolute paths:
     ```bash
     uv run python3 "${CLAUDE_SKILL_DIR}/../../skills/SKILL/scripts/script.py" args
     ```
   - Or use `${CLAUDE_SKILL_DIR}` for files within the same skill directory:
     ```bash
     uv run python3 "${CLAUDE_SKILL_DIR}/scripts/script.py" args
     ```

2. **Relative Read() paths** — `Read("../../skills/...")`, `Read("../audit-check/SKILL.md")`
   - The Read tool requires absolute paths; `../../` resolves from user's project CWD, not skill directory
   - **Fix:** Use `${CLAUDE_SKILL_DIR}/../..` or `${CLAUDE_SKILL_DIR}`:
     ```
     Read `${CLAUDE_SKILL_DIR}/../../skills/SKILL-NAME/SKILL.md` and follow its instructions.
     ```

3. **Dynamic context via bang-backtick injection** — For constraint files that should be inlined at skill load time, use the pattern: exclamation mark followed by backtick-cat path backtick. Example: `BANG` + `` `cat ${CLAUDE_SKILL_DIR}/../../references/file.md` ``. This inlines the file contents at skill load time. Note: bang-backtick injection only works in top-level skills loaded via `Skill()`. Internal skills loaded via `Read()` should use direct `Read()` instructions instead.

4. **Path variable substitution** — the two variables apply to DIFFERENT contexts:

| Context | Correct Variable | Docs |
|---------|------------------|------|
| **Hook `command:` fields in YAML frontmatter** | `${CLAUDE_PLUGIN_ROOT}` | [hooks.md](https://code.claude.com/docs/en/hooks.md) |
| **Skill content body (markdown + bash injection)** | `${CLAUDE_SKILL_DIR}` | [skills.md](https://code.claude.com/docs/en/skills.md) |
| **Internal skills (loaded via Read)** | Neither substitutes. Use `${CLAUDE_SKILL_DIR}/../../` as a convention so a consistent style is preserved — the agent infers the actual path from context. | — |

   **The hook/content variables ARE NOT INTERCHANGEABLE.** `${CLAUDE_SKILL_DIR}` is bound in the shell environment only when a skill is actively loaded via `Skill()`. When a hook fires for a tool call *outside* that active session — e.g., a `matcher: "*"` hook, or an `Agent` matcher spawned from main chat — the env var is empty and the path resolves to garbage like `/../../hooks/foo.py`.

5. **Hook-command variable misuse — the April 2026 incident** ⚠️
   - **What happened:** course-materials plugin v2.83.1 (Apr 15 2026) switched hook commands from `${CLAUDE_PLUGIN_ROOT}/hooks/...` to `${CLAUDE_SKILL_DIR}/../../hooks/...` based on a misdiagnosis claiming CLAUDE_PLUGIN_ROOT was "unset at PreToolUse runtime". Five skills across two plugins (teaching + derivative exam skills) shipped with broken hook paths for 9 days.
   - **Why it stayed hidden:** the affected hooks (`no-agent-resume-guard.py`, `context-monitor.py`) default to `{"decision": "approve"}` when the script runs. When the script doesn't exist at all, Claude Code *also* approves. The silent-failure mode was indistinguishable from a clean approval, so "no enforcement" looked like "approved every time".
   - **Why exam-prep finally exposed it:** a new skill added `matcher: "*"` under `PreToolUse` for `context-monitor.py`. `matcher: "*"` fires on every tool call in the session, including tool calls *before* the new skill was ever invoked via `Skill()`. At that moment `${CLAUDE_SKILL_DIR}` was empty, producing a nonexistent path — Claude Code blocked every tool call with the hook's failure.
   - **The lesson:** **`${CLAUDE_SKILL_DIR}` in hook frontmatter is a silent-failure landmine.** It appears to work because existing hooks default-approve. Add one blocking hook — or a broad matcher — and the whole plugin surfaces the latent bug at once.

**Hook Command Variable Audit (mandatory during Path Portability review):**
```bash
# This command should return EMPTY — any hit is a defect:
grep -rn "command:.*\${CLAUDE_SKILL_DIR}" skills/*/SKILL.md

# All hook commands should match this pattern:
grep -rn "command:.*uv run python3 \${CLAUDE_PLUGIN_ROOT}" skills/*/SKILL.md
```

If the first grep returns anything, flag as a Critical Gap.

**Score:**
- **Clean** — no broken paths found AND no `${CLAUDE_SKILL_DIR}` in hook command fields
- **Partial** — some paths fixed, others remain
- **Broken** — relative paths present in skill instructions OR `${CLAUDE_SKILL_DIR}` in hook command fields (even if file paths happen to resolve when tested)

**Gate: Path Portability Scored** `[checkpoint: human-verify, auto-advanceable]`
- Verify all SKILL.md and references/*.md files were scanned
- Every `uv run python3 ../` and `Read("../` pattern was flagged
- Score is recorded

Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 3b-portability
status: completed
requires: [all SKILL.md and references/*.md files]
provides: [path portability score]
affects: [.planning/wc/{name}/STATE.md]
```

**Proceed to Step 4.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 4: Output Audit Report

Format:

```
## Audit: [Workflow Name]

### Architecture Scores (P01-P21)
| ID | Principle | Score | Notes |
|----|-----------|-------|-------|
| P01 | Phased decomposition | [0-10] | [notes] |
| P02 | Gates (deterministic/judgment) | [0-10] | [notes] |
| P03 | Structural gate enforcement | [0-10] | [notes] (STRUCTURAL/total) |
| P04 | Independent verification | [0-10] | [notes] |
| P05 | Artifact review (4-level) | [0-10] | [notes] |
| P06 | Two entry points | [0-10] | [notes] |
| P07 | Cross-skill consistency | [0-10] | [notes] |
| P08 | Constraint/convention coverage | [0-10] | [notes] |
| P09 | Iteration strategy | [0-10] | [notes] |
| P10 | Post-subagent enforcement | [0-10] | [notes] |
| P11 | Deviation rules | [0-10] | [notes] |
| P12 | State management | [0-10] | [notes] |
| P13 | Session handoff | [0-10] | [notes] |
| P14 | Checkpoint types | [0-10] | [notes] |
| P15 | Context monitoring | [0-10] | [notes] |
| P16 | Summary frontmatter | [0-10] | [notes] |
| P17 | Agent tool restrictions | [0-10] | [notes] |
| P18 | Requirement traceability | [0-10] | [notes] |
| P19 | Autonomous phase chaining | [0-10] | [notes] |
| P19b | Visual output | [0-10] | [notes] |
| P20 | Hooks over prompt | [0-10] | [notes] |
| P21 | Auto-loader usage | [0-10] | [notes] (loader skills / phase skills ≥2 constraints) |

### Gate Enforcement Matrix
| Transition | Gate | Artifact | Producer Writes? | Consumer Checks? | Hook Enforced? | Status |
|------------|------|----------|-------------------|-------------------|----------------|--------|
| [phase A] → [phase B] | [gate desc] | [artifact file] | ✅/❌ | ✅/❌ | ✅/❌ | HOOK/STRUCTURAL/ADVISORY ⚠️ |

### Enforcement Coverage
| Pattern | Phase 1 | Phase 2 | ... | Phase N |
|---------|---------|---------|-----|---------|
| Iron Laws | ✅/⚠️/❌ | ... | ... | ... |
| ... | ... | ... | ... | ... |

### Path Portability
| File | Pattern | Status |
|------|---------|--------|
| skills/X/SKILL.md | `uv run python3 scripts/foo.py` | ❌ Broken / ✅ Fixed |
| skills/Y/SKILL.md | `Read("../../lib/...")` | ❌ Broken / ✅ Fixed |

### Critical Gaps
1. [Highest priority gap + recommendation]
2. [Second priority gap + recommendation]
...

### Recommendations
[Specific, actionable changes]
```

**Render score trend** (if SCORES.md exists from a prior audit):
```bash
uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/render-audit-scores.py .planning/wc/{name}/SCORES.md
```

**Persist audit results:** Write the audit report to `.planning/wc/{name}/AUDIT.md` in addition to displaying it. Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 4-report
status: completed
implements: [WC-09]
requires: [all workflow skill files]
provides: [AUDIT.md]
affects: [.planning/wc/{name}/AUDIT.md]
```

<EXTREMELY-IMPORTANT>
### The Iron Law of Thorough Scoring

**NO PRINCIPLE SCORE WITHOUT LINE-NUMBER EVIDENCE. This is not negotiable.**

Mode 2 is the highest-drift mode: the auditor is tempted to skim, anchor to an overall impression, and give generous scores. Every principle score MUST cite specific line numbers or artifact names as evidence. A score without evidence is a guess, not an audit.

**If you cannot point to a specific line, file, or pattern that justifies the score — the score is wrong.**
</EXTREMELY-IMPORTANT>

### Deviation Rules for Mode 2 (Auditing)

During auditing, unplanned issues may arise. Apply these deviation rules:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Broken path** | Skill file path doesn't resolve, Read fails on referenced file | Note broken path in audit, score affected principles accordingly | Auto |
| **R2: Missing section** | Expected section (gates, enforcement, state management) absent from workflow | Note as critical gap in audit report, don't invent content | Auto |
| **R3: Blocking format** | Workflow file is malformed YAML, unparseable frontmatter, or encoding issue | Note the format issue, score what you can read, flag the rest | Auto |
| **R4: Scope change** | Audit scope needs to expand (new files discovered, dependency chain found) | STOP — present the expanded scope to the user before continuing | Ask user |

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4

### Mode 2 Enforcement

#### Rationalization Table — Mode 2

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "This workflow is simple, I can skim the skill files" | Skimming produces generous scores. You miss enforcement gaps in the middle of long files. March 2026: 285-line Step 3 hid 6 un-gated sub-responsibilities. | Read ALL files line by line. Use Read with offset/limit to chunk large files. |
| "This principle obviously doesn't apply to this domain" | Score it anyway with a justification. The auditor's job is to score everything, not to pre-filter. A principle that "doesn't apply" gets a justified N/A, not a skip. | Score it. Write the justification. Let the reader decide if N/A is warranted. |
| "The workflow has good enforcement overall, I'll give generous scores" | Generous audits ship broken workflows. April 2026: baseline 5.2 was generous at 6.5 before careful tally. | Score each principle independently. Sum at the end. Don't anchor to an overall impression. |
| "Enforcement patterns don't matter for low-drift phases" | Low-drift phases still need gates. A brainstorm phase with no gate means the agent can skip directly to implementation. | Score enforcement for every phase. Note "low enforcement appropriate" in justification if warranted. |
| "The audit is already long enough, I'll skip the matrices" | The Gate Enforcement Matrix and Hook Coverage Matrix catch gaps that prose misses. Without them, the audit is subjective. | Produce all required matrices. They take 5 minutes and catch what prose can't. |

#### Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Scoring a principle without reading the relevant skill file section | You're scoring from memory or impression, not evidence | Read the specific section, find the line numbers, then score |
| Giving a 9 or 10 without finding specific evidence | High scores require evidence of excellence, not absence of problems | Find the specific line/pattern that earns the score. No evidence = no high score |
| Skipping the enforcement pattern matrix | "I covered it in prose" — matrices catch asymmetries prose misses | Produce the matrix. Score every pattern × every phase |
| Scoring structural gate enforcement without producing the Gate Enforcement Matrix | You can't assess gates without mapping every transition | Produce the matrix first, then score from it |
| Combining two principles into one score | Each principle measures a different quality dimension | Score each P01-P21 independently |

#### Staged Review — Mode 2

If the audit report composite is below 5.0 on first pass, STOP and re-read all workflow files from scratch before finalizing scores. Audits below 5.0 usually indicate the auditor missed a section or misunderstood the workflow structure — not that the workflow is truly that weak. Re-reading costs 5 minutes; a wrong baseline wastes the entire improvement cycle.

#### Delete & Restart — Mode 2

If you discover mid-audit that you scored Steps 1-2 without reading all phase skill files: delete your partial scores and restart from Step 1. Partial-read audits produce anchored scores that resist correction. Starting fresh is faster than debiasing.

#### Drive-Aligned Framing — Mode 2

| Your Drive | Why You Cut Corners | What Actually Happens | The Drive You Failed |
|------------|--------------------|-----------------------|---------------------|
| **Helpfulness** | "Quick audit so user gets results faster" | Generous audit ships broken workflow. User discovers gaps in production. | **Anti-helpful** |
| **Competence** | "I can tell from the structure this is fine" | Without line-by-line reading, you miss the gap buried at line 285 of a 500-line file. | **Incompetent** |
| **Efficiency** | "Matrices are overhead, prose covers it" | Prose catches narrative gaps. Matrices catch structural gaps. You shipped an asymmetric hook coverage. | **Anti-efficient** |
| **Honesty** | "I'll score this 8 because it's mostly there" | "Mostly there" means gaps exist. An honest score reflects the gaps. | **Dishonest** |

---

## Mode 3: Improve Workflow

<EXTREMELY-IMPORTANT>
## The Iron Law of Workflow Improvement

**MODE 3 IS AN AUDIT-FIX LOOP. THE SCORE DECIDES WHEN TO STOP, NOT YOU. This is not negotiable.**

Mode 3 uses the audit-fix-loop pattern: independent audit → score → fix → re-audit. The loop terminates when the **auditor's score** crosses the threshold (default: 9.5/10), NOT when you "feel" the workflow is good enough.

**The structural problem Mode 3 solves:** Without a loop, the agent audits once, applies some fixes, and stops — rationalizing that the remaining gaps are "domain characteristics" or "diminishing returns." March 19, 2026: agent stopped at 8.5/10 and said "close enough." It wasn't.
</EXTREMELY-IMPORTANT>

### Step 1: Run Initial Audit (Mode 2)

**State initialization:** Create `.planning/wc/{name}/STATE.md` with `mode: improve, step: 1-initial-audit, status: in_progress, target: [workflow name]`.

**Context monitoring:** Mode 3 runs multi-iteration audit-fix loops. Each iteration consumes significant context. Check availability:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with current iteration, score, and remaining gaps before starting the next iteration.
- If context is critical (≤25% remaining), write HANDOFF.md immediately — do not start another iteration.

Run Mode 2 on the target workflow. This produces the baseline score.

**Gate:** Mode 2 audit report exists with numeric scores for all P01-P21 principles. `[checkpoint: human-verify, auto-advanceable]`

### Step 2: Launch Audit-Fix Loop
<!-- implements: WC-12 -->

Use the audit-fix-loop pattern with `/goal` as the cross-turn iteration primitive (separate-model evaluator reads SCORES.md from the transcript):

```
/goal Workflow [WORKFLOW_NAME] scores >= 9.5 in .planning/SCORES.md across all selected scorers, with zero CRITICAL findings outstanding. Stop after 10 turns.
```

**Each turn under the active goal follows this exact sequence:**

```
Phase A: AUDIT ──→ Phase B: DECIDE ──→ Phase C: FIX
  [fresh subagent]   [check score]       [targeted edits]
    │                    │                    │
    ▼                    ▼                    ▼
  AUDIT.md            Score >= 9.5?         Fix gaps by priority:
  SCORES.md             │                   1. P < 7.0 (critical)
                    YES ──→ end turn;       2. P 7-8.9 (medium)
                           /goal evaluator   3. P 9-9.4 (polish)
                           marks done             │
                        │                         ▼
                    NO ──→ Phase C            End turn → /goal
                                              refires Phase A
```

#### Phase A: AUDIT (Fresh Subagent — MANDATORY)

Spawn a fresh audit subagent that:
1. Reads ALL skill files in the workflow (entry, midpoint, all phases, references, common-constraints)
2. Scores against the P01-P21 architecture principles (0-10 each)
3. Scores against the 13 enforcement patterns (Present/Weak/Absent per phase)
4. Checks path portability
5. Computes composite score (average of non-N/A principle scores)
6. Returns findings as text output (read-only tools — caller writes AUDIT.md and SCORES.md)

```
Agent(
  subagent_type="general-purpose",
  description="Audit workflow enforcement",
  allowed_tools=["Read", "Grep", "Glob"],  # REQUIRED — verifier MUST NOT Write/Edit
  prompt="""You are an independent workflow auditor. You have NO knowledge of any prior fixes.

You have Read/Grep/Glob ONLY. If you find a violation, REPORT it — do not
silently fix it. A verifier that edits bypasses the plan-execute-verify cycle
(see Iron Law of Read-Only Verifiers).

Read the workflow-creator Mode 2 audit criteria:
Read "${CLAUDE_SKILL_DIR}/SKILL.md" — Mode 2 section only.

Read the enforcement checklist:
Read "${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md"

Then audit this workflow by reading ALL its skill files:
[LIST ALL SKILL FILES IN THE WORKFLOW]

Score each of the 21 architecture principles (P01-P21 + P19b) 0-10.
Score each of the 13 enforcement patterns per phase: Present/Weak/Absent.
Check path portability.

Compute composite score = average of non-N/A principle scores (exclude any principle marked N/A from both numerator and denominator).

Output to .planning/wc/{name}/AUDIT.md with this format:
- Composite score (single number)
- Per-principle scores with 1-line justification
- Critical gaps (principle score < target composite, i.e. < 9.5) with specific fix recommendations
- Enforcement matrix (13 patterns × N phases)

Be thorough. A generous audit that misses gaps is worse than a harsh one.
Do NOT soften findings. Do NOT say 'overall good.'
""")
```

<EXTREMELY-IMPORTANT>
**THE AUDITOR MUST BE A FRESH SUBAGENT. If you audit your own fixes, you are rubber-stamping.**

The auditor has no context from the fix phase. It reads the files cold. This is what makes the score trustworthy.
</EXTREMELY-IMPORTANT>

#### Phase B: DECIDE `[checkpoint: decision]`

Read `.planning/wc/{name}/SCORES.md`. Render the score trend for visual context:

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/render-audit-scores.py .planning/wc/{name}/SCORES.md
```

Check composite score against threshold:

| Condition | Action |
|-----------|--------|
| Score >= 9.5 | Output `<promise>WORKFLOW_9_5</promise>` — workflow meets quality bar |
| Score < 9.5 AND iteration < 10 | Continue to Phase C |
| Score < 9.5 AND iteration >= 10 | Escalate to user with current score and remaining gaps |

**You may ONLY output the completion promise when the auditor's score >= 9.5. Not when you "feel" it's good enough. Not when the remaining gaps seem minor. The score decides.**

#### Phase C: FIX

Address findings from `.planning/wc/{name}/AUDIT.md`, prioritized by severity:

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
| No shared enforcement across skill family | Move rules to `references/constraints/`; all domain skills `Read()` the specific `.md` files they need |
| Rules in separate `constraints/` and `conventions/` directories | Merge into single `constraints/` directory. Presence of `.py` file = constraint; `.md` only = convention |
| Monolithic shared constraints file >15 sections | Refactor to atomic files in `constraints/` — one `.md` per rule, co-located `.py` for testable rules |
| Constraint `.md` without co-located `.py` check script | Write the `.py` file alongside the `.md`. Same name, same directory. Auto-discovered by runner |
| No auto-discovering test runner | Create `check-all.py` that globs `constraints/*.py` — no manual wiring needed |
| Manual test runner that lists scripts explicitly | Replace with auto-discovery (`glob("constraints/*.py")`). Adding a `.py` file = automatically tested |
| Verification only runs scripts OR only does LLM review | Both legs: `check-all.py` (hard block on `.py` failures) + reviewer subagent (soft block, scores `.md`-only conventions) |
| Convention that could be a constraint | Graduate it: write the `.py` check script alongside the existing `.md`. No file moves needed |
| `check-script` frontmatter linking `.md` to `.py` | Remove — naming convention handles the link. `foo.md` + `foo.py` = paired |
| Index/TOC files manually listing constraints | Remove — the filesystem IS the index. `ls constraints/*.md` = all rules, `ls constraints/*.py` = all tests |
| Hooks inconsistent across skill family | Produce Hook Coverage Matrix (skills × hooks); add missing hooks to skill frontmatter; justify intentional gaps |
| Constraint added to individual skill but applies to family | Move to `references/constraints/` with `applies-to` frontmatter; remove from individual skill |
| Missing artifact review gate | Add reviewer subagent dispatch between producing/consuming phases, max 5 iterations |
| Nested agent dispatch (agent spawns sub-agents) | Flatten: orchestrator spawns all agents directly in parallel. Move "dispatcher" logic into the skill definition. |
| Broken paths (script) | Use `${CLAUDE_SKILL_DIR}/../../skills/SKILL/scripts/script.py` |
| Broken paths (Read) | Use `${CLAUDE_SKILL_DIR}/../../skills/SKILL-NAME/SKILL.md` |
| Missing post-subagent enforcement | Add verification/investigation boundary table for the domain |
| Hook command uses `${CLAUDE_SKILL_DIR}` instead of `${CLAUDE_PLUGIN_ROOT}` | Replace with `${CLAUDE_PLUGIN_ROOT}/hooks/script.py`. `${CLAUDE_SKILL_DIR}` only substitutes in skill content, not hook frontmatter — it's empty when hooks fire outside an active Skill() session, silently failing. See April 2026 incident (teaching plugin v2.83.1→v2.84.4). |
| Hook `matcher: "*"` under `PreToolUse` without hardened script | Move to `PostToolUse` unless the hook genuinely needs to block every tool call. A PreToolUse `"*"` hook that fails (bad path, missing file, non-zero exit) blocks *every* tool in the session — so the hook script must be resilient (defaults to approve on error) and its command path must be rock-solid. |
| Missing topic change protocol | Add announce-pause / handle / announce-resume |
| Missing deviation rules | Add 4-rule system (R1-R3 auto, R4 STOP) adapted to domain |
| Missing state folder | Consolidate into `.planning/` with standard files |
| Missing session handoff | Add `.planning/HANDOFF.md` check to entry point startup |
| Missing checkpoint types | Classify every gate as human-verify/decision/human-action |
| Missing context monitoring | Add thresholds: warning ≤35%, critical ≤25% |
| Missing summary frontmatter | Add YAML frontmatter with implements/requires/provides/affects |
| Missing agent tool restrictions | Add `allowed-tools` to reviewer/verifier skills |
| Missing requirement traceability | Add CATEGORY-NN IDs in spec, trace through plan and validation |
| Missing autonomous phase chaining | Add auto-advance for human-verify gates, smart-discuss batching |
| Mechanical constraints enforced only via prompt | Write scoped `PreToolUse`/`PostToolUse` hooks in skill frontmatter. File extension guards, path guards, tool param validation, sequence enforcement → hooks. Keep rationalization tables, drive-aligned framing, and quality judgments as prompt text |

### Deviation Rules for Mode 3 Phase C (Fixing)

During fix application, unplanned issues may arise. Apply these deviation rules:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Fix regression** | A fix for one principle breaks another (e.g., adding a hook causes a constraint script false positive) | Revert the specific fix, note the regression in STATE.md, try alternative approach | Auto |
| **R2: Fix incomplete** | Fix partially addresses the gap but can't fully close it in one edit | Apply partial fix, note remaining work in AUDIT.md for next iteration | Auto |
| **R3: Blocking dependency** | Fix requires a file/hook/script that doesn't exist yet | Create the dependency first, then apply the fix, track both in STATE.md | Auto |
| **R4: Approach change** | Fix requires restructuring the skill file, splitting phases, or changing the architecture | STOP — present the approach change to the user before proceeding | Ask user |

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4

**Fix rules:**
- Targeted changes only — do NOT rewrite entire skill files
- Each fix addresses ONE gap from the audit
- After fixing, do NOT self-assess — the next iteration's audit will judge
- **End your turn immediately** so the loop feeds you back for re-audit

### Efficiency Optimizations

Mode 3 can be expensive. These optimizations reduce cost without sacrificing audit independence.

#### 1. Batch Fixes Per File

Group all fixes targeting the same file into a single edit. Don't make 5 separate edits to the same constraint file — read the audit findings, plan all changes, apply them in one Edit call.

#### 2. Scoped Re-Audit After Iteration 1

The first audit (baseline) must read ALL files — no shortcuts. After that, subsequent audits can be **scoped**: the audit subagent reads all files but the fix agent only needs to re-read files it changed + the specific constraint `.md` files relevant to the fix. The audit subagent always does a full read (independence requires it), but the fixer can be smarter about what it reads before fixing.

#### 3. Prioritize Cheapest High-Impact Fixes

After the audit, sort gaps by `impact / effort`:
- Adding a `.md` + `.py` pair to `constraints/` (all skills inherit, auto-discovered) = high impact, low effort
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

**The structural fix:** `/goal` drives the iteration. A separate evaluator reads `.planning/SCORES.md` from the transcript and only marks the condition met when the score crosses 9.5. The fixer's opinion of whether 9.2 is "close enough" is irrelevant.

### Rationalization Table — Mode 3

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "9.2 is close enough to 9.5" | The threshold exists for a reason. 0.3 means real gaps remain. | Fix them. The score decides, not you. |
| "The remaining gaps are domain characteristics" | Maybe, but prove it by having the auditor agree, not by self-declaring | Let the auditor score it. If it's truly a domain limit, the auditor will note it. |
| "Diminishing returns on further iteration" | You don't know that. The last 0.3 might be one targeted fix. | Run the audit, see what's cheapest to fix, try it. |
| "I'll run the audit manually instead of using `/goal`" | Manual loops have no enforcement. You'll stop early. You literally just did. | Set `/goal` with the condition pinned to SCORES.md. The evaluator decides. |
| "Re-reading all files each iteration is wasteful" | Fresh-context audit is what makes the score trustworthy. Incremental audits miss regressions. | Full re-read every iteration. Independence > efficiency. |

### Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Running Mode 3 without `/goal` | Honor system — you'll stop early | Set `/goal` whose condition is pinned to SCORES.md >= 9.5 |
| Auditing your own fixes | Rubber-stamping | Spawn fresh audit subagent |
| Declaring "close enough" below 9.5 | Threshold violation | Keep iterating or escalate at max iterations |
| Skipping the audit subagent "to save time" | The audit IS the value — without it, fixes are unverified | Full independent audit every iteration |
| Stopping after 1-2 iterations without checking score | You don't know if you're done | Read SCORES.md, check against 9.5 |

#### Drive-Aligned Framing — Mode 3

| Your Drive | Why You Cut Corners | What Actually Happens | The Drive You Failed |
|------------|--------------------|-----------------------|---------------------|
| **Helpfulness** | "Ship the fixes faster, skip the re-audit" | Unverified fixes ship broken enforcement. User discovers gaps when the workflow fails. | **Anti-helpful** |
| **Competence** | "I can tell from the diff this fixes the gap" | Self-assessment is rubber-stamping. The auditor exists because you can't see your own blind spots. | **Incompetent** |
| **Efficiency** | "Re-reading all files each iteration is wasteful" | Fresh-context audit catches regressions that incremental review misses. One regression undoes 3 fixes. | **Anti-efficient** |
| **Honesty** | "9.2 is close enough to 9.5" | The threshold exists for a reason. Declaring "close enough" below threshold is fabricating completion. | **Dishonest** |

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

### NO CONSTRAINT WITHOUT A CO-LOCATED CHECK SCRIPT
A constraint is a mechanically testable rule. Every constraint `.md` MUST have a co-located `.py` check script with the same name in the same `constraints/` directory. No frontmatter linking, no manual wiring — same name = paired. The auto-discovering runner (`check-all.py`) globs `constraints/*.py`. If your constraint doesn't have a `.py` file, it's a convention (judgment-only), not a constraint. A `.md` that claims to be a constraint but has no `.py` is an untested unit test.

### NO VERIFICATION WITHOUT BOTH LEGS
Verification has two legs: (1) constraint checks via auto-discovering `check-all.py` — runs all `constraints/*.py` files, structured JSON output, hard block on failure; (2) convention scoring via reviewer subagent — loads the `.md`-only files (no `.py` pair = convention), scores work against them, soft block below threshold. Running only one leg is incomplete. Scripts catch mechanical violations LLMs miss. LLMs catch quality issues scripts can't test. Both are necessary, neither alone is sufficient.

### NO VERIFIER WITH WRITE ACCESS
Verification and review agents MUST use `allowed-tools` frontmatter restricting them to read-only tools. A verifier that can Write/Edit will "fix" issues it finds — silently bypassing the plan-execute-verify cycle. The fix was never planned, never reviewed, never tested. Tool restrictions make verification structurally honest, not just procedurally independent.

### NO LONG WORKFLOW WITHOUT CONTEXT MONITORING
Workflows with 4+ phases MUST plan for context exhaustion. Warning at ≤35% remaining context (complete current task, then handoff). Critical at ≤25% (immediate handoff). An agent that starts a 10-task implementation phase with 20% context remaining will produce garbage for the last 5 tasks.

### NO NESTED AGENT DISPATCH (Iron Law of Flat Dispatch)
Never design a workflow where an agent spawns its own sub-agents. The orchestrator (main chat or phase skill) MUST spawn all agents directly in parallel. Three-layer delegation (orchestrator → dispatcher agent → sub-sub-agents) fails because sub-sub-agent results don't reliably return via SendMessage — the middle dispatcher times out or loses results.

**The course-materials incident (March 2026):** `slides-edit` spawned `teaching:reviewer`, which dispatched 5 background sub-sub-agents (`slide-auditor`, `notes-auditor`). The reviewer returned without a final report. Had to be called 3 times — the 3rd time with "do NOT spawn sub-agents, run ALL checks inline." Fix: `slides-edit` now spawns 4-5 review agents directly. All return reliably.

```
BAD:  orchestrator → dispatcher agent → 5× sub-sub-agents (results lost)
GOOD: orchestrator → 5× agents directly in parallel (all return reliably)
```

**When an agent needs multiple checks:** The orchestrator reads the check list and spawns each check as a direct parallel agent. The "dispatcher" logic lives in the skill/phase definition, not in a middle agent.
</EXTREMELY-IMPORTANT>

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Creating a workflow without reading PHILOSOPHY.md | You'll miss the foundational principles | Read it first, every time |
| Skipping the user interview | You'll design for an imagined domain, not the real one | Ask the six questions |
| Writing soft language instead of Iron Laws | LLMs ignore polite suggestions | Use strong framing with EXTREMELY-IMPORTANT tags |
| Proposing ungated phase transitions | Quality will die at the ungated boundary | Define a verifiable gate condition |
| Designing all phases with equal enforcement | Drift risk varies by phase | Score enforcement density per phase |
| Creating domain skills without shared enforcement | Each skill enforces its own version of the rules. lecture-prep misses checks that slides-edit catches — user has to run multiple skills to get consistent quality. | Co-locate common rules in `references/constraints/` — skills `Read()` the specific `.md` files they need |
| Adding a hook to one skill without checking siblings | Hook fires in slides-edit but not lecture-prep. The user gets different enforcement depending on which skill they invoke. Silent — no error, just missing enforcement. | Produce Hook Coverage Matrix. Add hook to all relevant siblings or justify the gap. |
| Adding a constraint to an individual skill that should be shared | Constraint works in lecture-prep but notes-edit doesn't have it. User discovers the gap when notes-edit ships work that lecture-prep would have caught. | Add `.md` + `.py` to `references/constraints/` with `applies-to` frontmatter. Over-inclusion beats drift. |
| Growing a monolithic constraints file past 20+ sections | Every skill loads 450+ lines of constraints when it needs 5. Context bloat, slow loads, hard to maintain. | Refactor to atomic files in `constraints/`. One `.md` per rule, co-located `.py` for testable ones. Skills `Read()` only what they need. |
| Writing a constraint `.md` without a co-located `.py` | A constraint without a test is like a unit test without an assertion — it documents intent but verifies nothing. | Write the `.py` alongside the `.md`. Same name, same directory. Auto-discovered by runner. |
| Manually wiring check scripts into a runner | Manual wiring means new checks silently fail to run. Adding a file should be enough. | Use auto-discovering runner (`glob("constraints/*.py")`). No registration needed. |
| Verification phase that only runs scripts OR only does LLM review | Scripts catch mechanical violations but miss quality. LLM review catches quality but misses mechanical violations. | Run both legs: `check-all.py` (hard block) + reviewer subagent scoring `.md`-only conventions (soft block). |
| Letting an artifact pass to the next phase without review | Bad specs become bad designs become bad implementations. A 30-second review saves hours. | Add artifact review gate between producing and consuming phases |
| No enforcement at the post-subagent boundary | That's where 71 violations happened in dev-debug (March 16). Main chat "verifies" by investigating. | Define verification/investigation boundary explicitly for the domain |
| No topic change protocol in iterative loops | Off-topic user messages silently kill the loop. User has to re-invoke the skill. | Add announce-pause / handle / announce-resume protocol |
| Rationalizations are hypothetical, not grounded | "Agents sometimes skip" is ignorable. "March 16: 71 violations, 3 re-invocations" is not. | Cite real failed sessions with dates, IDs, and violation counts |
| Implementation phase with no deviation rules | Agents encounter unplanned work and either silently change architecture or halt on trivial bugs. | Add 4-rule deviation system with auto-fix for R1-R3, STOP for R4 |
| State files scattered across `.claude/` and project root | Next session can't find state; handoff fails. | Consolidate into `.planning/` directory |
| No handoff support in entry points | Context window exhaustion means lost work — next session starts from scratch. | Check for `.planning/HANDOFF.md` at startup, support structured resume |
| Verification agent with Write/Edit access | Verifier silently "fixes" issues, bypassing plan-execute-verify. The fix was never planned or tested. | Add `allowed-tools` frontmatter restricting to Read, Grep, Glob only |
| All gates treated as human-required | Workflow stops 7 times for rubber-stamp approvals. Unusable in autonomous/overnight mode. | Classify gates: human-verify (auto-advance), decision (pause), human-action (manual) |
| No context monitoring in multi-phase workflow | Agent starts expensive phase with 20% context, produces degraded output, loses state. | Add context checks at phase entry, trigger handoff at ≤35% |
| Phase summaries are unstructured prose | Handoff/resume requires re-reading all files. No dependency graph for parallel execution. | Add YAML frontmatter with implements/requires/provides/affects |
| Requirements have no unique IDs | "We tested auth" doesn't tell you if login, refresh, AND logout are covered. | Assign IDs in `.planning/SPEC.md`, trace through `.planning/PLAN.md` and `.planning/VALIDATION.md` |
| Every phase requires manual invocation | 7-phase workflow needs 7 human interventions to run. | Add autonomous chaining with auto-advance for human-verify gates |
| Decision checkpoint with no review pattern tracking | You don't know what the human looks at, so you can't optimize for it. | Log what the human asks for at each review. After 3+ patterns, offer to automate. |
| Designing an agent that spawns its own sub-agents | 3-layer delegation fails — sub-sub-agent results don't reliably return via SendMessage. The middle dispatcher times out or loses results. March 2026: teaching:reviewer dispatched 5 sub-agents, returned empty 2/3 times. | Use flat parallel dispatch: the orchestrator spawns ALL agents directly. Put the "dispatcher" logic in the skill definition, not in an agent. |
| Copying a hook frontmatter pattern from a sibling skill without checking the variable | Sibling skills can carry latent bugs that only surface under specific matcher combinations. The teaching plugin carried a `${CLAUDE_SKILL_DIR}` vs `${CLAUDE_PLUGIN_ROOT}` bug in hook commands for 9 days (v2.83.1–v2.84.4) — silently default-approving because hook scripts also default to approve. Adding a single `matcher: "*"` hook in a new skill exposed the latent bug across the plugin. | Check docs: `${CLAUDE_PLUGIN_ROOT}` for hook `command:` fields, `${CLAUDE_SKILL_DIR}` for skill content. Never trust a sibling's pattern without verifying. |
| Using `matcher: "*"` under `PreToolUse` without a bulletproof hook script | `matcher: "*"` fires for *every* tool call in the entire session — including calls before the skill was loaded. A hook script that can't find its path or exits non-zero blocks every tool. | Move to `PostToolUse` unless blocking is genuinely needed. If blocking IS needed, use a specific matcher (`Write\|Edit\|Agent`) and a defensively-coded script. |

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
| "I'll add this constraint to the shared file later" | Later never comes. The rule lives in one skill, others ship without it. | Add `.md` (+ `.py` if testable) to `constraints/` NOW. Over-inclusion is cheaper than drift. |
| "One big constraints file is simpler than many small files" | Simpler to create, harder to maintain. At 20+ sections, every skill loads 400+ lines it doesn't need. | Atomic files: one `.md` per rule, co-located `.py` for testable ones. |
| "I need an index file to track all constraints" | The filesystem IS the index. `ls constraints/*.md` = all rules. `ls constraints/*.py` = all tests. | No index needed. Auto-discovery replaces manual tracking. |
| "This rule doesn't need a check script" | If it's mechanically testable, it needs a `.py` file. If it can't be tested, it's a convention — that's fine, just don't call it a constraint. | Ask: "Can I write a script that returns pass/fail?" If yes, write the `.py`. |
| "I'll write the check script later" | Later never comes. The `.md` ships without its `.py`. The runner auto-discovers nothing. | Write `.md` and `.py` together. They're a pair. |
| "I need to register the check script in the runner" | Auto-discovery means adding the `.py` file IS registration. Manual wiring is a bug source. | Just add the `.py` file. The runner globs `constraints/*.py`. |
| "The LLM review covers everything, scripts are redundant" | LLM review drifts, rationalizes, and misses mechanical violations. Scripts are deterministic. | Scripts for mechanical checks, LLM for judgment. Both legs of verification. |
| "This convention could be a constraint but testing it is hard" | Start it as a convention. Note it as a graduation candidate. Revisit when you have a testing idea. Don't force-fit a bad test. | Classify honestly. Graduation happens when testability improves, not when you want fewer conventions. |
| "The spec looks fine, no need to review it" | Self-review is rubber-stamping. The author can't see their own blind spots. | Dispatch a fresh reviewer subagent. 30 seconds saves hours. |
| "Plan review will slow us down" | A bad plan costs 10x more to fix during implementation than during review. | Review the plan. Fix it now, not during implementation. |
| "The reviewer can just fix small issues it finds" | That bypasses plan-execute-verify. The "fix" was never planned, never reviewed, never tested. Now you have unverified code in production. | Restrict verifiers to read-only tools. Issues go back to the executor. |
| "Context monitoring is overkill for short workflows" | A 4-phase workflow can exhaust context on phase 2 if implementation is complex. "Short" is about phase count, not context usage. | Add monitoring. It costs nothing when context is plentiful. |
| "Requirement IDs are bureaucracy" | Without IDs, the validation phase maps requirements by fuzzy text matching. "Auth" matches 3 different requirements and misses 2. | IDs take 30 seconds to assign and make coverage auditable. |
| "Autonomous mode is too risky without human oversight" | 90% of gates are rubber-stamp `human-verify`. The other 10% still pause. Autonomous mode skips the rubber stamps, not the real decisions. | Classify checkpoints. Auto-advance the rubber stamps. |
| "The human can read the test output to verify" | Maybe they can, maybe they rubber-stamp it. You don't know until you observe. Don't assume — track what they actually do. | Log the review pattern. If they consistently ask for a specific view, automate it. |
| "The dispatcher pattern keeps things modular" | 3-layer delegation fails because sub-sub-agent results don't reliably return. The middle dispatcher times out, returns empty, or loses results. Modularity that doesn't work isn't modular — it's broken. | Flat dispatch from the orchestrator. The "dispatcher" logic lives in the skill definition (a file), not in an agent (a runtime). |
| "This agent needs to coordinate multiple checks" | Coordination is the orchestrator's job. An agent that spawns other agents is a dispatcher — and dispatchers fail. March 2026: reviewer agent had to be called 3 times before results returned. | The orchestrator reads the check list and spawns each check as a direct parallel agent. |

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
