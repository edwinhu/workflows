---
name: workflow-creator
description: "This skill should be used when the user asks to 'create a workflow', 'design a workflow', 'edit a workflow', 'audit workflow', 'improve workflow', 'break down a task into phases', 'migrate a phase to a dynamic workflow (ultracode)', 'convert fan-out to a workflow script / ultracode', or needs to substantially create or edit any multi-phase workflow."
version: 0.6.0
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

**Load workflow-creator's own constraints** (auto-discovered + `applies-to`-filtered — surfaces the `wc-*` behavioral rules at load time, complementing the `wc-constraint-check.py` post-edit hook):

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py workflow-creator`

Detect mode from user request, then follow the corresponding process below:
- **Mode 1 (Create)** — "create/design a workflow", "break a task into phases"
- **Mode 2 (Audit)** — "audit/score a workflow"
- **Mode 3 (Improve)** — "improve a workflow", audit-fix loop, **"migrate a fan-out phase to an ultracode workflow"** (a migration is an improvement — see `${CLAUDE_SKILL_DIR}/references/dynamic-workflow-migration.md`)

**Note on workflow-creator's Structure:**

workflow-creator is a **meta-tool** that CREATES workflows. It is exempt from certain requirements it enforces on workflows it creates:

- **Two entry points:** workflow-creator has one entry with mode detection (not a multi-phase workflow). Workflows it creates MUST have two entry points.
- **Single responsibility per phase:** workflow-creator has 3 modes (toolkit, not workflow). Workflows it creates MUST have single-responsibility phases.
- **Skill Dependencies (cross-file phase chaining):** workflow-creator is a single SKILL.md, so it has no next-phase `Read()` chain. Its structural equivalent is **stronger**: the `wc-step-gate-guard.py` hook + the STATE.md step-chain enforce step ordering at the tool-call layer (a skipped step is blocked, not merely un-chained). Workflows it creates with multiple phase files MUST still wire phase-to-phase `Read()` transitions.
- **Iteration topology labels (P09):** workflow-creator's own steps are a fixed sequence, not a per-phase topology menu, so they carry no `[one-shot|serial|parallel]` label. Workflows it creates MUST assign a topology per phase.

This document defines the PROCESS for creating workflows. The workflows created by this process must follow all principles from PHILOSOPHY.md.

**The mode flowcharts below ARE the authoritative spec.** Each mode (Create, Audit, Improve) opens with an ASCII step/phase diagram. If the prose for a step ever conflicts with its mode's flowchart, **the flowchart wins** — treat a diagram-violating shortcut as a process error, not a "minor deviation from documentation."

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
| `.planning/wc/{name}/VALIDATION.md` | Maps each WC-NN requirement → verification evidence (which gate/audit confirms it) + scope tag (v1/v2/out-of-scope) | Mode 1 Step 7, Mode 2 Step 4 |
| `.planning/wc/{name}/LEARNINGS.md` | Log of what the user attended to / changed at present-to-user checkpoints (Step 6/7) — the observe→record→offer loop wc prescribes for created workflows, applied to itself | Mode 1 Step 6-7 |
| `.planning/wc/{name}/HANDOFF.md` | Session resume context | Any mode on context exhaustion |

**wc HANDOFF.md template** (workflow-creator's own handoff — the same structured format it mandates for the workflows it creates, applied to itself, so a resuming session starts immediately without re-discovery):
```yaml
---
mode: create | audit | improve
step: <current step or phase>
status: paused
target: <workflow name>
context_remaining: <e.g. 24%>
last_updated: <ISO8601 — pass in via args; do not invent>
---
## Current State
<what is in progress right now>
## Completed Work
<steps done + key artifacts written>
## Remaining Work
<steps/phases left>
## Decisions Made / Rejected Approaches
<so the resume doesn't relitigate>
## Next Action
<specific enough to start immediately — not "continue">
```

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

<EXTREMELY-IMPORTANT>
**NO PAUSE BETWEEN STEPS.** After completing each step, immediately start the next. Do NOT ask "should I continue?", do NOT summarize what you just did, do NOT wait for confirmation — pause ONLY where explicitly required (Step 6: present files; Step 7: present audit results). Pausing between steps is procrastination disguised as courtesy: it strands the workflow and hands the user a management burden they should never have to carry.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
**Enforcement architecture:** Step transitions are hook-enforced via `wc-step-gate-guard.py`:
- **Layer 2 (step-chain):** Writing `step: N` to STATE.md is BLOCKED unless `step: N-1` shows `status: completed`. This fires for ALL modes (create, audit, improve).
- **Layer 1 (file-path gates):** Writing INTERVIEW.md, DESIGN.md, AUDIT.md, and skill/constraint files is BLOCKED unless the prerequisite step is completed. Mode 1 only.

Every step below has a STATE.md YAML template. You MUST write this template to STATE.md BEFORE advancing — the hook enforces the chain.

**About to advance a step before writing STATE.md → STOP.** The STATE.md update IS the gate artifact; the hook BLOCKS subsequent writes without it.
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
key-files: {read: [PHILOSOPHY.md]}
one-liner: "Philosophy grounded — phased decomposition, gates, independent verification, artifact review, iteration, two entry points confirmed."
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

**Red Flags — STOP:** inferring the domain from context instead of asking · skipping questions because they "seem obvious" or the user "seems busy" · closing the interview before all 7 answers are concrete (a shallow interview makes every downstream phase wrong — you'll design for an imagined domain, not the real one). Batch all 7 into one AskUserQuestion; don't drip them.

Use AskUserQuestion to understand the domain:

1. **What kind of work?** (code, data, writing, research, other)
2. **What's the deliverable?** (working feature, analysis report, polished document, etc.)
3. **What are the common failure modes?** (skipping tests, shallow analysis, weak arguments, etc.)
4. **When does drift happen?** (implementation without design, conclusions without evidence, etc.)
5. **How should iteration work?** (one-shot with verification, serial hypothesis testing, parallel exploration, agent team review)
6. **What does verification look like?** (running tests, checking output exists, reviewing summary artifact — define concretely so "verification" can't become investigation)
7. **What kind of gate proves one unit of work is done?** This drives the `gateProbe` seam if the workflow turns out to be a compiled runner (Step 3). One of:
   - **exit-code on a test** (TDD: a failing test goes RED→GREEN — honest by construction)
   - **exit-code on a produced artifact** (a `Verify` command runs against a file/table the work produced — REQUIRES an independent outputs-exist probe; `Verify` can pass on a stale/clobbered artifact)
   - **mechanical floor** (a linter/threshold/structural check passes)
   - **judgment + empirical** (a reviewer/LLM judge decides — note: a semantic judge *can* be wrong or gamed, so the adversarial review layer must stay outside any compiled runner)

**Gate: Interview Complete** `[checkpoint: human-verify, auto-advanceable]`
- Verify AskUserQuestion was called
- Check that answers to all 7 questions are present
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
7. **Gate kind:** exit-code-on-test | exit-code-on-artifact | mechanical-floor | judgment+empirical
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

Check against the 7 required interview questions:
1. Work type  2. Deliverable  3. Failure modes  4. Drift points  5. Iteration style  6. Verification  7. Gate kind

For each question, verify the answer is:
- Present (not missing or placeholder)
- Specific enough for decomposition (not "TBD" or "various")
- Consistent with the stated domain

Report: APPROVED if all 7 are adequate, or list specific gaps.
Do NOT edit the file — report only."""
)
```

**Gate: Interview Reviewed** `[checkpoint: human-verify, auto-advanceable]`
- If reviewer reports APPROVED → **write the structural marker `.planning/wc/{name}/INTERVIEW_REVIEWED.md`** (frontmatter `status: APPROVED`, timestamp, 1-line summary of what was verified), then proceed. This is **hook-enforced**: `wc-step-gate-guard.py` (Layer 3) BLOCKS the STATE.md write for `step: 3-decomposition` unless this marker exists with `status: APPROVED` — the same structural-gate-artifact pattern this skill mandates for the workflows it creates, applied to itself, not advisory trust.
- If reviewer reports gaps → drive convergence via `/goal Interview reviewer returns APPROVED on .planning/wc/{name}/INTERVIEW.md. Stop after 5 turns.` Each turn: ask remaining questions, update INTERVIEW.md, re-dispatch the reviewer, end turn

**Proceed to Step 3.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 3: Propose Phase Decomposition
<!-- implements: WC-03 -->

**Gate prerequisite (structural):** Refuse to start Step 3 unless `.planning/wc/{name}/INTERVIEW_REVIEWED.md` exists with `status: APPROVED`. If it is missing, return to the INTERVIEW.md Review Gate — decomposition built on an unreviewed interview inherits its gaps.

**Context check:** Decomposition and artifact gate design (Steps 3-3b) produce DESIGN.md — the recoverable artifact for enforcement generation. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with interview answers (from INTERVIEW.md) and current progress. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

Design phases where each phase has:
- **Name** - verb-noun (e.g., explore-codebase, design-approach)
- **Responsibility** - ONE question this phase answers (single responsibility principle)
- **Gate condition** - verifiable exit criterion (file exists, test passes, artifact contains X)
- **Gate artifact** - the concrete file the producing phase writes and the consuming phase checks (see Structural Gate Artifacts below)
- **Enforcement needs** - high/medium/low based on drift risk

**Compile-vs-interpret classification (do this FIRST — it decides the whole execution skeleton):**

Before choosing any fan-out mechanism, ask of the workflow as a whole: **does it execute a DAG of MECHANICAL work between human gates** — an implement/transform/generate phase driven by a structured plan table (tasks with deps + a per-task gate), where the human-gated phases (brainstorm/plan/review/verify) stay conversational?

- **YES → scaffold `spec → plan → deterministic compile → run.js` (the compiled-runner pattern), NOT an interpreted per-phase loop and NOT an in-workflow LLM "discovery" agent.** This is the lesson the ds + dev refactors paid for (PR#7/PR#8). The plan table is regex-parseable; a deterministic parser + compiler emits the runner. Read `${CLAUDE_SKILL_DIR}/references/dynamic-workflow-migration.md` §0 (compile-vs-interpret) and the **compiled-runner skeleton** there. What you emit by default:
  1. a **born-canonical plan EMITTER** — the plan-producing phase (the skill that writes PLAN.md) emits the EXACT canonical table format, so plans are born canonical. **This is doctrine #6 (emitter-canonical) and the biggest scaffolding fix — do NOT skip it.** Emitting only a tolerant parser + guard (items 2 & 4) *relocates* the LLM's silent tolerance into regex (the very `2026-06-26_llm-discovery-masked-spec-drift` anti-pattern) instead of eliminating it. The full triple is **emitter (canonical) + guard (STRICT) + parser (back-compat shim)**.
  2. a deterministic plan-table parser (`scripts/<domain>/<domain>_plan_table.py`) — the SINGLE source of truth (S1). Once the emitter is canonical, its tolerance is a back-compat **shim**, not the primary defense.
  3. a compiler (`scripts/<domain>/<domain>_compile.py`) = **produce the work-list** (S5) → emit `run.js` (CODE) **or** a data work-list (DATA, if a generic engine already consumes it — e.g. writing). Don't hardcode codegen.
  4. a `workflows/templates/<domain>-run-template.js` carrying the **shared CORE + the doctrine invariants baked in** (payload>pass/fail · mandatory R4 block on assumption change · probe corroborates artifacts-exist · adversarial layer OUTSIDE run.js — PRIMARY when the gate is a judgment) + two-kinds-of-decision routing + stale-gate backstop + gate-first short-circuit, with the **four INJECTED seams D1-D4** the author fills: `gateProbe(t)` (trust-class: exit-code vs judgment), `implementerPrompt(t)`, task-spec columns, tier/effort policy (gate kind from interview Q7). **Intra-level parallel-vs-sequential is CORE, compiler-DERIVED (parallel iff declared outputs are provably disjoint) — NOT a seam to hand-set, and NOT an author question.**
  5. the executable-guard whose `validate_plan()` imports parser #2 and asserts **STRUCTURE only** (cycles / missing cells / dangling deps), never format (S6) — it can be strict because the emitter is canonical.
  6. a **slim** skill (COMPILE → run/pause loop, flowchart-as-spec — NOT a per-level dispatch loop) that **branches on the runner's RETURN-REASON**: `done` · `hard-fail` · `pause-human` (declared ⏸ or dynamic R4) · `yield-for-recheck` (an AUTOMATED cross-cutting gate — dev's full-suite, ds's validate-coverage; NO human). Never model a `yield-for-recheck` as a human pause.
  **Canonical seam list (source of truth): `docs/common-infra-candidates.md`** (shared S1-S7, injected D1-D4, 6 doctrine invariants, return-reason taxonomy). The shared driver is **`workflows/templates/run-core.js`** (one copy, pass #9) — the compiler **splices** it with a per-domain FRAGMENT; you scaffold only the fragment + the compiler. Reference impls in-repo: `run-core.js` (shared driver) + `ds-task.js` / `dev-task.js` (live fragments) + `workflows/templates/compiled-runner-template.js` (the generic fragment skeleton to copy); `scripts/ds/` + `scripts/dev/` (the `_compile.py` splicers + `_plan_table.py` parsers).
  **If compile output is DATA (a work-list a generic engine consumes — writing/workshop/teaching), read `${CLAUDE_SKILL_DIR}/references/dynamic-workflow-migration.md` §A.1** (the data-variant deepenings: the JOIN trust-class predictive test — *"does verify enumerate from a different source than generate? → the join is semantic, keep it OUTSIDE the parser"* — emitter two-shapes + golden-test-vs-REAL-artifact, phantom-canonical, gate-all-outputs, floor-vs-assist, n≥3 variance, and the `applies-to`/`ACTIVE_WORKFLOW.md` scaffolding rules).
- **NO → use the fan-out / conversational patterns below.** A pure per-item fan-out with no plan-table DAG (review or transform) is the `already-a-fan-out` shape — correct as-is; do NOT bolt a compiled runner onto it.

> **Iron Law (see "NO LLM STEP BETWEEN A STRUCTURED PRODUCER AND A STRICT CHECKER"):** if a structured table feeds a strict checker, NEVER scaffold an LLM step between them. An LLM "discovery" agent that re-reads the plan absorbs format drift invisibly — it tolerates rows the guard rejects, masking a spec-drift bug while looking like it works. Scaffold a deterministic parser, not an agent that re-reads the table.

**Ultracode-workflow check (for FAN-OUT phases, once the workflow is NOT a compiled runner):** For any phase that is a **fan-out over a known list** — either *read-only review* (one reviewer per item → gate/findings) OR *write/transform* (one write-agent per item that creates/transforms from a fixed spec — codemod, migration, per-item spec-driven generation, worktree-isolated) — decide whether to implement it as a Claude Code **ultracode workflow** rather than in-skill agent dispatch. Workflows are NOT read-only; the docs' flagship case is a 500-file write migration. Read `${CLAUDE_SKILL_DIR}/references/dynamic-workflow-migration.md` for the decision rubric, the hybrid split (workflow = deterministic fan-out read-or-write; skill keeps *creative* drafting + `/goal` + R4 + user input), and script conventions. Keep only *creative/judgment* generation, user-approval, and `/goal` loops conversational — mechanical/spec-driven per-item creation belongs in a transform workflow.

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

**Gate Design Facts:**
- Advisory text is not enforcement: the agent that would skip the gate is the same agent reading the "must" sentence.
- Entry-point chaining does not protect gates — users can invoke any phase skill directly, so mid-point entry bypasses the chain.
- The dev workflow shipped advisory-only gates for months; the bug was caught by a meta-audit, not by the workflow itself. Marker files are not overhead — they are the layer that would have failed closed.

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
            GATE_BLOCKED_TOOLS=Agent
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
```

**Landmine: `matcher` and `GATE_BLOCKED_TOOLS` are two separate lists that must agree.** `matcher` only decides which calls invoke the script; `phase-gate-guard.py` only actually blocks tools named in `GATE_BLOCKED_TOOLS` (default `Write,Edit` — Agent is NOT blocked unless you list it). A matcher of `Write|Edit|Agent` with no `GATE_BLOCKED_TOOLS=...,Agent` fires on every `Agent` call but silently lets it through — a gate that looks wired but never blocks the fan-out it names.

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

**Gate: Decomposition Complete** `[checkpoint: human-verify, auto-advanceable]`
- Every proposed phase has a single responsibility, a verifiable gate condition, a named gate artifact, and an iteration topology
- The topology choice (linear/branching/iterative) presented to the user is recorded `[checkpoint: decision]`
- The fan-out / ultracode-workflow check was applied to every phase
- If any phase lacks a gate or has >1 responsibility, split/fix it before advancing

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

**Red Flags — STOP:** marking an inter-phase gate "advisory-only" to move faster (advisory gates are the #1 audit gap — P03 — and you are designing the exact transition that will later fail) · designing a gate the consuming phase never structurally checks · assuming "the SKILL.md says *must*, so it will be followed" (the agent that skips the gate is the one reading that prose). Prefer hook-enforced gate artifacts; advisory is never acceptable for a mandatory gate.

For every phase that produces an artifact consumed by downstream phases, add an **artifact review gate** between the producing phase and the consuming phase.

```
Phase N produces ARTIFACT.md
  → Dispatch independent reviewer subagent
  → Reviewer checks: completeness, consistency, clarity, YAGNI, spec alignment
  → If ISSUES_FOUND → drive convergence via /goal pinned to reviewer APPROVED, 5-turn budget
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
- Fix-and-re-review loop is `/goal`-driven (5-turn budget; evaluator gates exit on reviewer APPROVED)
- Chunking specified for large artifacts

**After verifying Artifact Review Gates are designed, persist design decisions:**

Write `.planning/wc/{name}/DESIGN.md` with phase decomposition, topology choice, iteration strategies, and artifact review gates. This is the recoverable artifact if context exhausts during enforcement generation.

**DESIGN.md MUST include a born-canonical `## Generation Manifest` section** (emitter-canonical, doctrine #6 — wc-creator eats its own cooking). Step 6's `wc-generate` enumerates the file SET from it **deterministically** via `scripts/wc/wc_file_set.py` (a shared parser, no LLM re-enumeration), so the generated set can't drift from the design. Write it exactly:
```
## Generation Manifest
<!-- wc-generate enumerates the file set from this section deterministically. Keep it canonical. -->
workflow: {name}
midpoint: fix            # the Step-5 midpoint entry: one of fix | debug | revise | none
phases: explore, design, implement      # the Step-3 phase slugs, comma-separated, in order
constraints:             # the Step-4b constraints; `testable` ⇒ a co-located .py is generated, `convention` ⇒ .md only
- no-skip-tests | testable
- naming-convention | convention
```
Keep it in sync with the decomposition above — the manifest is the single source of truth for *which* files Step 6 generates (the per-file *spec* still comes from the prose design). `wc_file_set.py --check {DESIGN}` must report no violations before Step 6.

**If Step 3 classified the workflow as a compiled runner (executes a plan-table DAG), DESIGN.md MUST also record the per-domain decisions** — the canonical seam list is `docs/common-infra-candidates.md` (shared core S1-S7, injected seams D1-D4, the 6 doctrine invariants). Fill the **four INJECTED seams** (D1-D4); everything else is shared CORE you inherit, not a choice:

| Injected seam (D1-D4) | Options / note |
|-----------------------|----------------|
| **D1 — Gate kind** (`gateProbe` body) | returns `{pass, outputsPresent, evidence, scope}`. **`pass` is ALWAYS deterministic** (exit code / mechanical floor — never a returned judgment). exit-code-on-test · exit-code-on-artifact (REQUIRES outputs-exist corroboration) · mechanical-floor (necessary-not-sufficient; the sufficient semantic authority is the adversarial review OUTSIDE run.js). `scope` (`checked`/`not-checked`) discloses the floor's blind spot (doctrine #3). From interview Q7. |
| **D2 — `implementerPrompt(t)`** | output-first (ds) · TDD failing-test-first (dev) |
| **D3 — task-spec COLUMNS** | feed the deterministic parser (ds: Outputs/Expected/Verify · dev: Files/Failing Test/Verify Command) |
| **D4 — tier/effort policy** | inherit session model (dev — TDD needs capability) · tier heuristic by task weight (ds) |

Plus two **commitment** decisions:
| Decision | Note |
|----------|------|
| **Compile output (S5)** | CODE (`run.js`) · DATA (work-list a generic engine consumes). *Codegen proven (ds+dev); the data form is now proven by writing (PR#18, parity passed) — keep the emit step an injected interface for a clean seam.* |
| **Retire old engine** | ONLY after parity is proven on a real spec. And do NOT extract a shared run-core until a 2nd domain runs on the template. |

**Do NOT put intra-level parallel-vs-sequential in the decision list** — it is **CORE, compiler-DERIVED** (parallel IFF a level's declared outputs are provably disjoint; ds's disjoint parquets qualify, dev's shared tree never does → sequential by construction). Hand-setting it is the retired `D5` proposal; a naive parallel copy corrupts a shared tree.

**If the workflow is SELF-GRADING** (a JS gate that returns `overallPass`/`substratePass` + a `findings` list + a re-run selector like `*ThatFailed`/`reviewersThatFlagged` consumed by a `/goal` loop's `onlyChecks`/`priorReviews`) — this is broader than the compiled-runner case above; a pure review fan-out with no plan-table DAG (e.g. `wc-audit` itself) qualifies too. Read `${CLAUDE_SKILL_DIR}/references/gate-doctrine.md` NOW and satisfy its **design-time checklist** before generation — the 11 laws there (return-shape contract, selective-re-run integrity, the 3-way overallPass⇔findings⇔selector contract, fail-closed signals, self-report vs independent probe, and more) are cross-repo-recurring defects in exactly this gate shape.

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
- If reviewer reports APPROVED → **write the structural marker `.planning/wc/{name}/DESIGN_REVIEWED.md`** (frontmatter `status: APPROVED`, timestamp, summary of what was verified), then proceed. This is **hook-enforced**: `wc-step-gate-guard.py` (Layer 3) BLOCKS the STATE.md write for `step: 4-enforcement` unless this marker exists with `status: APPROVED` — the same structural-gate-artifact pattern this skill mandates for created workflows, applied to itself.
- If reviewer reports gaps → drive convergence via `/goal Design reviewer returns APPROVED on .planning/wc/{name}/DESIGN.md. Stop after 5 turns.` Each turn: fix DESIGN.md, re-dispatch the reviewer, end turn

**Proceed to Step 4.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 4: Apply Enforcement Patterns
<!-- implements: WC-05 -->

**Context check:** Steps 4-6 generate enforcement content and workflow files — the most context-intensive work. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with interview answers (from `.planning/wc/{name}/INTERVIEW.md`), phase decomposition (from `.planning/wc/{name}/DESIGN.md`), and current progress. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately — do not start enforcement generation.

!`cat ${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md` **You MUST read this file before proceeding. No claiming you "remember" the patterns.**

Step 4 is high-drift: you decide how much enforcement each generated phase carries, and the cheapest shortcut is to under-enforce.

#### Step 4 Facts

- The Step 4 gate fails at Level 4: naming ≠ generating. A phase whose plan says "Iron Laws: yes" but carries no Iron Law text has none — draft the actual Iron Law / fact rows / Red Flags per phase, not a checklist of pattern names.
- A missing gate costs 10× to fix during implementation. Under-enforcing a "medium-drift" phase to move faster to generation is anti-helpful (the user inherits a workflow that drifts) and anti-efficient on its own terms — drift-risk scoring by the tier table below beats intuition, and enforcement proportional to drift IS the deliverable.
- Mechanical rules written as prompt lines drift and cost context; anything checkable belongs in a hook or co-located `.py` — prose only for judgment.

For each phase, score which of the 13 patterns are needed:
- **High-drift phases** (implementation, verification): Iron Laws, Fact Rows (incident-grounded), Gate Functions, Artifact Review Gates
- **Medium-drift phases** (design, review): Gate Functions, Red Flags, Staged Review Loops, Artifact Review Gates
- **Low-drift phases** (brainstorm, exploration): Red Flags only (creative phases need freedom)

Generate the specific enforcement content:
- Write Iron Laws with `<EXTREMELY-IMPORTANT>` tags
- Build **Fact Rows** from the failure modes identified in Step 2: a `### <Topic> Facts` section of declarative bullets, each stating a non-derivable fact (number, threshold, named incident, tool quirk, workflow mechanic) followed by the consequence as a property of the action in drive vocabulary (counterproductive / unhelpful / dishonest / incompetent). The litmus per row: *could a strong model derive this from the rule itself?* If yes, omit it — the rule statement carries it. Do NOT generate excuse/reality "Rationalization Tables" or standalone Drive-Aligned Framing tables (deprecated v5.36.0 — they targeted laziness-shaped failures of weak models; current-model failures are judgment-shaped, and the drive vocabulary lives inside the facts).
- Define Red Flags + STOP for each phase's common wrong-path indicators — **action-targeted and compact** ("about to X · about to Y (consequence)"), never intention-targeted ("if you catch yourself thinking"). Any mechanically-checkable red flag becomes a hook, not prose.

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
| Incident-learned domain knowledge | Prompt enforcement (Fact Rows with drive-consequence vocabulary) |

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

**If the constraint gates a `Workflow`/`Agent` fan-out and the phase is self-grading** (see the Step 3b pointer above), don't just wire the hook — REPL a real dispatched call and confirm the `matcher` fires on what the pipeline actually emits (tool name, path position, `hook_input.cwd` vs `args.*`). This is `references/gate-doctrine.md` L7, which extends the `matcher`/`GATE_BLOCKED_TOOLS` landmine above and the P20 sub-probe to the `Workflow`-dispatch case.

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
2. For each sibling skill, identify enforcement patterns (Iron Laws, Fact Rows, Red Flags — legacy Rationalization Tables in older siblings count as fact-row candidates, not templates to copy)
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

## Facts
<!-- OPTIONAL — include only if non-derivable, incident-grounded facts exist.
     Each bullet: fact first (number / threshold / named incident / tool quirk),
     then the consequence as a property of the action (counterproductive /
     unhelpful / dishonest / incompetent). Omit the section rather than fill
     it with restatements of the Rule. -->

- [Non-derivable fact] — [consequence of ignoring it, framed as a property of the action]

## Red Flags

- **About to [observable action]** → STOP. [Consequence — one line]
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
Leg 1: uv run --with lxml python3 check-all.py (auto-discovers constraints/*.py)
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
one-liner: "Hook coverage and script wiring matrices produced across the skill family; intentional gaps justified."
```

**Proceed to Step 5.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 5: Design Two Entry Points
<!-- implements: WC-06 -->

**Context check:** Entry point design is moderate effort. Before proceeding:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with enforcement plan and current progress. Pause.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

**Red Flags — STOP:** designing only one entry point (the fresh-start one) and skipping the midpoint · writing a midpoint that loads a *summary* of constraints instead of `Read()`-ing the actual `.md` files (summaries enable reward-hacking — the agent checks a 4-item digest, finds nothing, reports "all clear") · a midpoint that depends on prior-phase context instead of being self-contained.

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

<EXTREMELY-IMPORTANT>
**NO GENERATED PHASE FILE WITHOUT THE ENFORCEMENT DENSITY ITS DRIFT TIER DEMANDS.** Step 6 is the highest-drift phase of Mode 1 — you are now WRITING, and the temptation is to emit a clean-looking SKILL.md that silently drops the gate, the Iron Law, or the co-located `.py` that DESIGN assigned. A generated file that looks complete but omits its enforcement ships the gap to every user of that workflow.
</EXTREMELY-IMPORTANT>

#### Step 6 Facts

- The constraint runner auto-discovers co-located `.py` files only — an `.md` shipped "now" with its `.py` deferred is never machine-checked, and later never comes. Write `.md` + `.py` together: same stem, same dir.
- Prose transitions are advisory: users invoke phase skills directly and bypass them. Where DESIGN marked a gate mandatory, wire the hook-enforced gate artifact — generating prose in its place ships the gap to every user of the workflow.
- Medium-drift phases still drift, and an enforcement omission is invisible until the workflow fails in production. Generate the enforcement DESIGN assigned to EVERY phase, by tier.

**Red Flags — STOP:** about to write a phase SKILL.md without the gate DESIGN specified · about to skip the co-located `.py` for a testable rule · about to write a verifier/reviewer agent without read-only `allowed-tools` · about to emit a hook `command:` with `${CLAUDE_SKILL_DIR}` instead of `${CLAUDE_PLUGIN_ROOT}`. **Drive check:** skipping enforcement to "ship the files faster" is anti-helpful — the user inherits every gap you dropped.

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

#### Optional: generate the files with the wc-generate transform workflow

Once the user has approved the file list, the per-file *creation* from the approved DESIGN.md is a textbook **transform/generate fan-out** — a fixed spec (DESIGN.md) drives one independent write per file, with no creative latitude. workflow-creator eats its own cooking here too: prefer the **wc-generate ultracode workflow** over hand-writing each file in main chat. (The interview, decomposition, enforcement design, and the user file-approval gate above stay CONVERSATIONAL — only the mechanical per-file write moves into the workflow.)

```bash
WF=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/workflows/wc-generate.js 2>/dev/null | sort -V | tail -1)
[ -z "$WF" ] && WF="${CLAUDE_SKILL_DIR}/../../workflows/wc-generate.js"
```
```
Workflow({ scriptPath: "<WF>", args: {
  workflowName: "{name}",
  projectDir: "<abs plugin repo root>",
  designPath: "<abs .planning/wc/{name}/DESIGN.md>"   // optional; defaults to that path
} })
```

It fans out one **worktree-isolated write-agent per file** (each phase SKILL.md + each constraint `.md`/`.py` pair + `check-all.py`), each creating its file from the **pinned DESIGN spec** (the workflow refuses if DESIGN.md is missing/unapproved — Delete & Restart). A read-only **verify** stage then confirms each file matches its spec and the co-located `.md`/`.py` pairing holds. It returns `{ overallPass, scoreTable, files, findings, filesThatFailed }`.

**Ground-truth before claiming done (self-reports are not ground truth):** the write-agents run in isolated worktrees, so after the workflow returns you MUST (1) merge the surfaced worktrees, then (2) `ls` each file at its **expected** path (watch for doubled `skills/skills/` or `workflows/workflows/` typo paths) and `node --check` / lint the generated files yourself. On a re-run after fixing gaps, pass `onlyChecks: <prev result.filesThatFailed>` + `priorReviews: <prev result.reviews>`. If `wc-generate` is unavailable, fall back to writing the files directly per the list above. **Whichever path you take, Step 7's wc-audit self-audit still runs on the result.**

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

**Traceability (self-applied P18):** Before/with the self-audit, write `.planning/wc/{name}/VALIDATION.md` mapping each `WC-NN` requirement (from the `<!-- implements: WC-NN -->` tags in the generated skills) to the concrete evidence that verifies it — the gate, hook, or audit check that confirms it — and tag each requirement's scope (`v1` / `v2` / `out-of-scope`). This closes the loop from requirement → verification evidence, not just requirement → spec.

**Review-pattern logging (self-applied P19b):** At each present-to-user checkpoint (Step 6 file presentation, Step 7 audit results), append to `.planning/wc/{name}/LEARNINGS.md` what the user attended to or changed (which findings they prioritized, what they overrode). This is the observe→record→offer loop wc prescribes for the workflows it creates, applied to wc itself — after 3+ recurring patterns, propose encoding them as defaults.

**If the generated workflow is itself self-grading** (a JS gate returning `overallPass`/`substratePass` + `findings` + a re-run selector — this includes any generated `*-verify.js`/`*-audit.js`/`*-generate.js`), the wc-audit run below must additionally satisfy `references/gate-doctrine.md`'s **audit-time checklist** — its P02/P03/P04 gate/enforcement/verification scoring already folds in the gate-doctrine sub-checks (return-shape lint, ONLY-path integrity, the 3-way overallPass⇔findings⇔selector contract, fail-closed signals, self-report vs independent probe). Run `python3 tests/workflow_return_shape_test.py` on the generated files as part of this.

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
**The audit MUST be run by the wc-audit workflow (read-only reviewers, JS gate) — not by you.** If you score the files yourself, you are self-reviewing your own work; see the Iron Law above. The same agent that wrote the files cannot score them independently.
</EXTREMELY-IMPORTANT>

1. **Run the wc-audit workflow on the newly generated workflow** (same workflow Mode 2/Mode 3 use — read-only reviewers, JS-computed gate, so generation and judgment are structurally separate). First drafts clear **8.0** (composite), not the calibrated ceiling — but they still must reach **`substratePass`** (0 critical, no enforcement Absent, portability Clean) before presenting:

   ```bash
   WF=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/workflows/wc-audit.js 2>/dev/null | sort -V | tail -1)
   [ -z "$WF" ] && WF="${CLAUDE_SKILL_DIR}/../../workflows/wc-audit.js"
   ```
   ```
   Workflow({ scriptPath: "<WF>", args: { targetWorkflow: "{name}", projectDir: "<abs repo root>", pluginRoot: "<abs .../workflows dir>", threshold: 8.0 } })
   ```

   Write `result.reportMarkdown` to `.planning/wc/{name}/AUDIT.md` and append `result.composite` to `.planning/wc/{name}/SCORES.md`.

2. **Check score:** If `result.substratePass` is false OR `result.composite < 8.0`, drive convergence via the native `/goal` primitive — a separate evaluator gates exit by reading SCORES.md from the transcript, so the agent that generated the files isn't also the judge.

   Invoke:

   ```
   /goal Generated workflow reaches result.substratePass=true (0 critical, no enforcement Absent, portability Clean) AND composite >= 8.0 in .planning/wc/{name}/SCORES.md from a fresh audit subagent. Stop after 3 turns.
   ```

   Each turn under the active goal: fix the generated files based on the latest AUDIT.md findings, re-run the wc-audit workflow (full pass, or `onlyChecks: <prev result.reviewersThatFlagged>` + `priorReviews: <prev result.reviews>`), append the new composite to SCORES.md, end turn.

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
/goal-driven fix loop (3-turn budget) → fresh audit subagent re-scores each turn
    │
    ↓ (after 3-turn budget elapses)
Present files + audit report + remaining gaps to user
```

**Why an 8.0 composite floor (not the ceiling) at Step 7:** Generated workflows are first drafts; the composite needs real-world iteration to approach the calibrated ceiling (~9.0). But a first draft must already be structurally sound — `substratePass` true (no missing gates, no broken paths, no ungated transitions) and composite ≥ 8.0. Mode 3 then drives the 8.0 → substrate-clean-at-ceiling climb (NOT a chase to 9.5 — see the Iron Law of Workflow Improvement).

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

<EXTREMELY-IMPORTANT>
**NO PAUSE BETWEEN AUDIT STEPS.** Complete Step 1 → 2 → 3 → 3b → 4 without stopping. Do NOT pause or wait for user input between steps. Pausing mid-audit resets working memory, anchors scores on the last principle read, and produces scores that reflect reading order rather than the evidence — the exact failure Mode 2's Delete & Restart exists to undo.
</EXTREMELY-IMPORTANT>

**State initialization:** Create `.planning/wc/{name}/STATE.md` with this YAML template (the `wc-state-frontmatter` constraint requires requires/provides/affects):
```yaml
---
mode: audit
step: 1-read
status: in_progress
target: [workflow name]
implements: [WC-09]
requires: [all target workflow skill files]
provides: [file map]
affects: [.planning/wc/{name}/STATE.md]
one-liner: "Audit started on {target} — discovering skill files via wc-audit."
---
```

**Context monitoring:** Mode 2 audits complex multi-file workflows. Check context availability:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` and pause — the audit will degrade if context is exhausted mid-scoring.
- If context is critical (≤25% remaining), write HANDOFF.md immediately.

<EXTREMELY-IMPORTANT>
### How Mode 2 runs: the wc-audit ultracode workflow (eat your own cooking)

**The audit fan-out is owned by an ultracode workflow — a script, not hand-dispatched agents in main chat.** workflow-creator tells every other workflow to migrate its review fan-out to a Claude Code ultracode workflow; it MUST do the same for its own audit. `workflows/wc-audit.js` fans out one **read-only** reviewer per audit dimension (4 architecture clusters covering P01-P21, the 13-pattern enforcement checklist, path portability, the Ultracode-Workflow Candidacy Scan), adversarially **verifies** each critical/major gap against the actual files, and computes the **composite + verdict in pure JS** — so the model can no longer self-report a generous composite (the exact honor-system smell this skill flags in others). Steps 1-3b below are the **criteria the workflow's reviewers read** (they Read this SKILL.md's Mode 2 section for the P01-P21 definitions); Step 4 is how you **render AUDIT.md from the result** — you do NOT score by hand.

**Run it:**

1. Resolve the cached workflow path (local-plugin fallback when running from source):
```bash
WF=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/workflows/wc-audit.js 2>/dev/null | sort -V | tail -1)
[ -z "$WF" ] && WF="${CLAUDE_SKILL_DIR}/../../workflows/wc-audit.js"
echo "$WF"
```

2. Run it (full audit first; on a Mode 3 re-audit pass `onlyChecks` + `priorReviews` from the prior result):
```
Workflow({ scriptPath: "<WF>", args: {
  targetWorkflow: "{name}",
  projectDir: "<abs plugin repo root>",
  pluginRoot: "<abs .../workflows dir>"   // optional; helps resolve enforcement-checklist.md + the migration playbook
} })
```

It returns `{ overallPass, composite, verdict, threshold, isMetaTool, scoreTable, reportMarkdown, candidacyTable, findings, reviews, reviewersThatFlagged }`. The reviewers ground in the criteria in Steps 1-3b; the **JS gate** computes the composite as the mean of non-exempt, non-domain-ceiling principle scores and honors the **meta-tool exemptions** (when auditing workflow-creator itself, P01 and P06 are excluded from the composite — see the structure note at the top of this skill).

**Post-workflow boundary (verification, not investigation):** after the workflow returns you may Read AUDIT.md/`result.*`, render the report, and fix gaps — you may NOT recompute or rationalize `result.composite`/`result.overallPass` (the JS owns the arithmetic), nor re-score a principle the reviewers scored.

The STATE.md step-chain (1-read → 2-score → 3-enforcement → 3b-portability → 4-report) is **preserved** — the workflow performs the work each step describes; you still write each STATE.md transition so the hook chain holds. **This step-chain IS Mode 2's structural gate enforcement (P03):** `wc-step-gate-guard.py` Layer 2 BLOCKS writing `step: N` to STATE.md unless `step: N-1` shows `status: completed` — a tool-call-layer block, not advisory prose, and the reason a separate per-step marker file is unnecessary for Mode 2's linear chain (the same Layer-2 enforcement governs Mode 3's `1-initial-audit → 1-audit-loop`).

**If the target workflow is self-grading** (a JS gate returning `overallPass`/`substratePass` + `findings` + a re-run selector consumed by `onlyChecks`/`priorReviews` — this covers `wc-audit` itself, any generated `*-verify.js`/`*-audit.js`, and any compiled-runner gate), Step 2's P02/P03/P04 scoring below is where `references/gate-doctrine.md`'s **audit-time checklist** gets applied — its 11 laws are folded into those three principles' scoring criteria (see the sub-bullets under each), not a separate cluster. Run `python3 tests/workflow_return_shape_test.py` against the target as part of P02 evidence-gathering.
</EXTREMELY-IMPORTANT>

### Step 1: Read the Workflow

The wc-audit workflow's **Discover phase** reads the target workflow's entry command, midpoint, and ALL phase skills (plus references/constraints) and returns the file map — you do not need to read them all into main context. Confirm the workflow's discovery enumerated the full file set (the workflow `throw`s if it found none). Build/Read the phase map only as needed to interpret the result.

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
one-liner: "wc-audit Discover enumerated the target's entry/midpoint/phase skills + references — full file map built."
```

**Proceed to Step 2.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 2: Score Against Core Principles (P01-P21)
<!-- implements: WC-09 -->

<EXTREMELY-IMPORTANT>
**Scoring is the highest-drift step in this skill.** You are about to score 22 principles across multiple files and the pull is to skim, anchor to a first impression, and award generous round numbers. A generous score here is the most damaging error wc makes: it ships an improvement plan built on a false baseline.
</EXTREMELY-IMPORTANT>

#### Scoring Facts

- "Can tell from the structure" is the anchoring that produced a generous 6.5 where the careful tally was 5.2 (Apr 2026). A score without a cited file:line that earns it is a guess presented as a measurement.
- Adjacent-principle anchoring makes scores reflect reading order, not evidence — score each principle from its own evidence and reset between principles.
- "Mostly there" means a gap exists; an honest score reflects the gap, not the vibe. Find the gap, score to it, write the one-line justification.

**Red Flags — STOP:** awarding a 9-10 without a cited line · scoring before reading the relevant file section · rounding a 7-ish up to 8 to "move on" · trusting a self-reported composite (the JS gate owns it). **Drive check:** a fast generous audit is **anti-helpful** — the user acts on a false baseline and the workflow fails where you said it was fine.

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
- **If the workflow is self-grading** (a JS gate returning `overallPass` + `findings` + a re-run selector — `references/gate-doctrine.md` L1-L3): run `tests/workflow_return_shape_test.py` against it — does the documented `returns {...}` shape match the actual `return {...}` keys AND the re-run selector's id-namespace (L1)? Does `overallPass === false` imply the selector is non-empty for EVERY fail path, including whole-artifact-level failures with no single owning item, and does every fail condition emit an actionable finding (L3)? Is the field that renders the status row the SAME variable that blocks (not a display-only boolean that happens to usually agree) (L3c)? Any drift is a CRITICAL finding — it produces a silent full-regeneration loop that looks like it's working.

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
- **If a hook gates a `Workflow`/`Agent` fan-out phase** (`references/gate-doctrine.md` L7, extending the `matcher`/`GATE_BLOCKED_TOOLS` landmine above and the P20 sub-probe): trace (or dispatch) a real call and confirm `matcher` actually fires on what the pipeline emits — the tool name (`Workflow` vs `Agent`, especially after an ultracode-migration where the matcher was left on the old tool), path position in the command, and `hook_input.cwd` vs `args.*` for `projectDir`-style reads. A silent exit-0 no-op here is invisible without this trace.
- **If the workflow's gate is self-grading, also check the ONLY/onlyChecks path as a first-class execution path, not an afterthought** (L2): does an empty selector array ever render a pass for a non-empty or skipped set? Does adversarial verification still run when `ONLY` is set, or does an `if (ONLY) continue` disable it? Is the carried-forward `reviews`/`priorReviews` a UNION (`[...live, ...carried]`) with verifier corrections written back into the carried record, or can it silently drop/re-flag phantoms? Also check for shared-core drift if the workflow splices an extracted driver across domains (L9), and whether detect/fix share one predicate rather than two hand-copied passes (L8).

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

**Self-grading gate sub-checks** (`references/gate-doctrine.md` L4-L6, L10-L11 — apply when the workflow computes its own gate in JS):
- **Fail-closed on absent signals (L4):** for every gated dimension, grep for `.filter(Boolean)` / optional-chaining defaults that let an absent or null result read as a vacuous pass. Is there a `dispatchedPairs`-style set distinguishing a crash-drop (should fail/mark unreliable) from an intentional selective-skip (should read n/a)? Is every single (non-fan-out) `await agent()` call guarded with declared null semantics, not dereferenced directly?
- **Self-report vs independent probe (L5):** for every field the gate reports as evidence (a self-grepped status, a self-reported `artifactsPresent`/`citedInventory`), is there an independent deterministic check or a separate low-effort probe agent — or is it decoration from the same agent whose work it certifies? Are status greps anchored (`^status: APPROVED`), not bare substring matches that false-match unrelated frontmatter?
- **Doc-template ⇔ parser acceptance (L6):** if a parser feeds both an executable guard and the workflow, does the AUTHORING doc's example actually pass the parser (not just look plausible)? A template the parser rejects false-denies every valid spec written to it.
- **Enforcement claims are testable (L10):** spot-check 2-3 "wired via X" / "blocks Y" claims in the target's SKILL.md against the actual hook/schema/check — a claim that only cross-references other prose is unenforced.
- **Real eval, not just `node --check` (L11):** was the workflow smoke-tested with a bogus target and confirmed to reach its OWN arg-validation error (not a template-literal crash at `eval()`)? Is adversarial verification exercised against REAL inputs during authoring, not synthetic ones a verifier would rubber-stamp?

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
- **Mechanical sub-probe (COVERAGE, not presence — RUN it, do not eyeball):** P20 is NOT satisfied by the mere existence of some hooks. Grep the skill bodies for every IMPERATIVE script-step — bang-lines (`` !`…` ``) and phrases like "run `X`", "must run", "first run", "uv run", "run check-all", "run the … script". For each that is mechanically checkable (a script that exits non-zero / emits a checkable artifact), confirm a hook **or** bang-line actually guarantees it, matching the hook's **matcher + command** to the step. Two false-positives to reject: (a) other unrelated hooks do not cover this step; (b) a gate whose matcher is `Write|Edit|Agent` does NOT cover a step that must precede a **`Workflow`/`Agent` fan-out** (the matcher must include the gated tool). Any mechanically-checkable imperative step with no matching enforcing mechanism is a P20 gap — even when the skill has other hooks. (Real miss this encodes: "run check-all before the review fan-out" sat in skippable prose while a hook on `VALIDATION.md` existence looked like it satisfied "phase gate enforcement.")

**P21 — Auto-loader usage for constraints:**
- Do phase skills that load constraint prose use the bang-invoked auto-loader?
  ```
  !`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py skill-name`
  ```
- Or do they list `Read()` calls for each constraint `.md` file manually?
- **Why this matters:** The auto-loader + `applies-to` frontmatter is the wiring that makes atomic constraints work. Manual `Read()` lists mean adding a new constraint requires editing every skill that should load it — silent drift is the default failure mode.
- Check: Run `uv run python3 ${CLAUDE_SKILL_DIR}/../../references/constraints/auto-loader-usage.py`. Every flagged SKILL.md is a violation. (Bare relative path won't resolve from the auditor's CWD — always prefix with `${CLAUDE_SKILL_DIR}/../../`.)
- Exceptions: router skills that immediately delegate (no constraint evaluation), ad-hoc single-file references (not phase sets), plugins without `scripts/load-constraints.py`.
- Score: count of phase skills using the loader / count of phase skills that load ≥2 constraints. Below 80% = critical gap.

#### Compiled-runner architecture (P22-P30) — CONDITIONAL on executionClass

These principles apply **only when the workflow executes a DAG/work-list of mechanical work between human gates** — an implement/transform/generate phase driven by a structured plan table or section/slide index. They are the lessons the ds/dev/writing/workshop/teaching `spec → plan → compile` ports paid for (PR#7/#8/#18/#24 + teaching). **First classify, then score** — for conversational / single-pass / pure-creative workflows P22-P30 are **N/A** and excluded from the composite. Canonical seam list: `docs/common-infra-candidates.md`.

**Lockstep map (audit principle ↔ canonical seam/doctrine in `docs/common-infra-candidates.md`)** — keep these in sync; if the canonical source changes a seam, update the matching principle:

| Principle | Canonical seam / doctrine |
|-----------|---------------------------|
| P22 Compile-vs-interpret fit | S2 (driver) + S5 (compile = produce the work-list) · doctrine #5 |
| P23 Single-source plan parser | S1 (shared parser) + S6 (guard↔parser reconciliation) |
| P24 Honest gate | D1 (`gateProbe`→`{pass, artifactsPresent, evidence, scope}`) + S4-art (pass ⊥ artifactsPresent) · doctrine #3 (floor blind-spot) + #4 (semantic authority outside) |
| P25 Pause/resume + payload | S3 (pause/resume + stale-gate backstop) + S4 (payload TYPE) · doctrine #1/#2 · RETURN-REASON taxonomy |
| P26 Adversarial layer outside | doctrine #4 |
| P27 Join trust-class | S5 (the JOIN refinement: single-source⇒mechanical, multi-source⇒semantic) |
| P28 Emitter-canonical hardened | doctrine #6 (two shapes by producer; golden-test vs a REAL pre-canonical artifact) |
| P29 Guard passes REAL artifacts | doctrine #6 (real-artifact golden-test) extended to phantom-canonical (teaching) |
| P30 Gate covers all declared outputs | workshop "gate only what you compile" |

**executionClass detector (run FIRST).** Read the workflow's execution layer — the implement/transform/verify phase skill AND any `workflows/<name>-*.js`, AND `scripts/<name>/*.py` + `hooks/<name>*guard*.py` (a deterministic compile/parser lives there). 

> ⚠️ **THE DEFINING PROPERTY of `compiled-runner` (both variants) is: a DETERMINISTIC compile/parser REPLACED the in-workflow LLM "discovery" agent, AND the guard SHARES that parser** (`validate = parse()/build_index().violations`). Key on THAT, **not on whether a generated `run.js` exists.** There are TWO valid compile-output forms (S5): a **CODE variant** emits a self-contained `.planning/run.js` (ds/dev); a **DATA variant** emits a work-list/index a GENERIC fan-out engine consumes via `args` (writing/workshop/teaching). **Absence of `run.js` is NOT a gap** — it is the data-variant emit form. Mis-flagging a data-variant because "there's no run.js" is the #1 detector error.

| executionClass | Tell-tale | Recommendation |
|----------------|-----------|----------------|
| **generic-interpreter** | An in-workflow LLM "discovery" agent re-parses a PLAN/spec into a DAG/work-list **every invocation** → per-item fan-out → a **heavyweight re-analysis LLM verifier** computes the gate. **The retired anti-pattern.** | **CRITICAL** → fails the substrate gate. **Port to spec→plan→compile** (migration playbook §0). |
| **already-a-fan-out** | A per-item fan-out that **STILL LLM-enumerates/structures the work-list each call** — no deterministic compile/parser; the guard does NOT share a parser. | Correct shape, not yet compiled. **Do NOT force an engine swap** — add the deterministic compile + shared guard (P22/P23). |
| **compiled-runner** | A deterministic compile/parser **replaced the LLM discovery and the guard imports it**; emit form is **CODE (`run.js`)** OR **DATA (work-list a generic engine consumes — no `run.js`, by design)**; gates on real exit codes / a domain `gateProbe`; pause/resume. | Already correct — score P22-P30 UNIFORMLY for both emit forms. |
| **not-applicable** | Conversational / single-pass / pure-creative; no work-list of mechanical work. | P22-P30 **N/A** (excluded from composite). |

**P22 — Compile-vs-interpret fit:** is the work-list deterministically **compiled** (parser → `run.js` OR data index), or **re-discovered by an in-workflow LLM agent every call**? A `generic-interpreter` scores LOW; a data-variant with a deterministic compile scores HIGH (do NOT penalize the absence of `run.js`).

**P23 — Single-source plan parser:** does the executable-guard `import` the **same parser** the compiler/runner uses (`validate = parse().violations`, so "compiles ⇔ passes gate"), or a **second drifting regex**?

**P24 — Honest gate:** (a) `pass` is **ALWAYS DETERMINISTIC** — a real exit code OR a mechanical floor, **never a returned LLM judgment** (a `gateProbe` that returns a judgment = the haiku-judging-prose anti-pattern → LOW). (b) the contract returns `{pass, artifactsPresent, evidence, scope}` with **`pass ⊥ artifactsPresent` as TWO INDEPENDENT booleans the core conjoins (`pass && artifactsPresent`), never trusting `pass` alone.** (c) a mechanical floor **discloses its blind spot via `scope`** (a clean `pass` must not over-claim coverage). (d) **FLOOR vs ASSIST (inverted-G2):** a deterministic candidate-narrowing list (`uncitedCandidates[]`/`bibUnresolved`) that feeds the OUTSIDE semantic authority for **per-item adjudication** is an **assist** — it lives in `evidence`+`scope.notChecked` and must **NOT bear the gate**; a probe that FAILS the gate on those candidates is the **inverted-G2 defect** (a false-negative gate — inverse of funnel-clobber; LOW). The assist (per-item judgment — feeding it is *good*) is **distinct from a P27 join-menu** (closed-set correspondence — feeding it force-matches, *bad*); don't conflate them. Output-first/artifact gates MUST carry the outputs-exist probe; TDD gates may skip it.

**P25 — Pause/resume + payload>pass-fail:** pauses carry **deviations + a NUMBERED summary** (not a bare pass/fail); **two-kinds-of-decision** routing (layer-agnostic: data `Verify` or spec sentinel) + **stale-gate backstop** + **gate-first short-circuit**; the skill **switches on RETURN-REASON** (`done | hard-fail | pause-human | yield-for-recheck`) and does **NOT mux an automated recheck onto the human-pause channel**.

**P26 — Adversarial layer outside the runner:** the full-suite/review/verify layer lives **OUTSIDE** `run.js`, and is the **PRIMARY** arbiter (not a backstop) when the gate trust-class is semantic.

**P27 — Join trust-class:** a work-list row's downstream JOIN (work-item ↔ produced artifact) is **mechanical** (deterministic key) only when the work-list enumerates from a **SINGLE source**; if it enumerates from **MORE THAN ONE source** (generate←spec AND verify←built-artifact) the join is **SEMANTIC** and an LLM does it OUTSIDE the parser. Score: does the workflow keep a multi-source join semantic (parser **enumerates**, never key-matches a drifting identifier) and **NOT feed the deterministic artifact as a candidate MENU into the join-agent** (post-filter in JS outside)? A **join-menu** constrains a *correspondence to a closed set* ("match X to one of these") → force-matching that masks a dropped item — **distinct from a P24(d) assist** (per-item adjudication, which *is* good to feed). The menu bias is workshop-measured (appendix over-match, n=3). Do NOT penalize a multi-source domain for lacking a deterministic join. A **born-canonical byte-stable join-key anchor** (converts semantic→mechanical) scores high.

**P28 — Emitter-canonical hardened:** is the **EMITTER** hardened to born-canonical (doctrine #6), or **only the parser+guard** (which RELOCATES the LLM's tolerance into regex)? Two valid shapes **by producer**: machine producer → *eliminate* tolerance + a **strict** guard (writing); hand-editable producer → *canonical emitter + intentional back-compat tolerance* (ds), whose guard correctly stays **structure-only + tolerant** (do NOT ding it for not being strict). Trap (both shapes): was the guard **golden-tested against a REAL pre-canonical artifact** (not the template — already canonical, can't reveal the drift)?

**P29 — Guard passes REAL artifacts (phantom-canonical):** does the **existing shipped data in the repo PASS its own guard/parser**? Run the guard against real artifacts, not just the template. A guard encoding a canonical format the real authoring never used (false-denying shipped specs) is the **phantom-canonical** defect (CRITICAL). A DEFAULT check.

**P30 — Gate covers all declared outputs:** does the gate validate **EVERY declared first-class output's** compile/validation, not just the primary? An un-gated compiled deliverable (e.g. notes alongside slides) is a hole.

**Gate: Architecture Scored** `[checkpoint: human-verify, auto-advanceable]`
- Classify executionClass FIRST (key on the deterministic-compile + shared-guard property, NOT `run.js` presence); if `generic-interpreter`, that is a critical finding.
- Verify scores for all P01-P21 (+ P19b) principles are present; score P22-P30 too when executionClass ≠ `not-applicable` (else mark them N/A).
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
one-liner: "P01-P21 scored with line-number evidence by the wc-audit reviewers; composite computed in JS."
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
one-liner: "13 enforcement patterns scored Present/Weak/Absent per phase; weakest high-drift phases flagged."
```

**Proceed to Step 3b.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 3b: Audit Path Portability

**Red Flags — STOP:** declaring portability "Clean" without actually running the mandatory grep commands below · treating a non-zero `${CLAUDE_SKILL_DIR}`-in-hook-command hit as a warning instead of a defect · assuming a path resolves because it "looks right" rather than tracing it from the user's CWD. (The April 2026 incident — 9 days of silently-broken hooks — was exactly a path that "looked right" and was never grep-audited.)

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
| **Hook `command:` fields in YAML frontmatter** | `${CLAUDE_PLUGIN_ROOT}` (NOT `${CLAUDE_SKILL_DIR}` — the SKILL_DIR-in-hooks mistake) | [hooks.md](https://code.claude.com/docs/en/hooks.md) |
| **Skill content body (markdown + bash injection), incl. `references/constraints/*.md` loaded via load-constraints** | `${CLAUDE_SKILL_DIR}` (NOT `${CLAUDE_PLUGIN_ROOT}` — the **inverse** mistake: it is substituted ONLY in hook commands, so in content it stays literal and a runnable path/bang-command fails. wc-audit grep: `${CLAUDE_PLUGIN_ROOT}` in any `skills/*/SKILL.md` body or `references/constraints/*.md` = critical) | [skills.md](https://code.claude.com/docs/en/skills.md) |
| **Internal skills (loaded via Read)** | Neither substitutes. Use `${CLAUDE_SKILL_DIR}/../../` as a convention so a consistent style is preserved — the agent infers the actual path from context. | — |
| **`${CLAUDE_SKILL_DIR}` inside an `Agent()` prompt string** | SAFE — it is skill-content body, so it is substituted to the literal absolute path at skill-load, *before* the orchestrator constructs the `Agent()` call. The spawned subagent receives the resolved path, never the token. No need to pre-resolve and pass it in. | — |

   **The hook/content variables ARE NOT INTERCHANGEABLE.** `${CLAUDE_SKILL_DIR}` is bound in the shell environment only when a skill is actively loaded via `Skill()`. When a hook fires for a tool call *outside* that active session — e.g., a `matcher: "*"` hook, or an `Agent` matcher spawned from main chat — the env var is empty and the path resolves to garbage like `/../../hooks/foo.py`.

5. **Hook-command variable misuse — the April 2026 incident** ⚠️
   - **What happened:** course-materials plugin v2.83.1 (Apr 15 2026) switched hook commands from `${CLAUDE_PLUGIN_ROOT}/hooks/...` to `${CLAUDE_SKILL_DIR}/../../hooks/...` based on a misdiagnosis claiming CLAUDE_PLUGIN_ROOT was "unset at PreToolUse runtime". Five skills across two plugins (teaching + derivative exam skills) shipped with broken hook paths for 9 days.
   - **Why it stayed hidden:** the affected hooks (`no-agent-resume-guard.py`, `context-monitor.py`) default to `{"decision": "approve"}` when the script runs. When the script doesn't exist at all, Claude Code *also* approves. The silent-failure mode was indistinguishable from a clean approval, so "no enforcement" looked like "approved every time".
   - **Why exam-prep finally exposed it:** a new skill added `matcher: "*"` under `PreToolUse` for `context-monitor.py`. `matcher: "*"` fires on every tool call in the session, including tool calls *before* the new skill was ever invoked via `Skill()`. At that moment `${CLAUDE_SKILL_DIR}` was empty, producing a nonexistent path — Claude Code blocked every tool call with the hook's failure.
   - **The lesson:** **`${CLAUDE_SKILL_DIR}` in hook frontmatter is a silent-failure landmine.** It appears to work because existing hooks default-approve. Add one blocking hook — or a broad matcher — and the whole plugin surfaces the latent bug at once.

**Hook Command Variable Audit (mandatory during Path Portability review):**
```bash
# Anchor to the target plugin root ($PROJECT) so the glob resolves regardless of CWD.
# This command should return EMPTY — any hit is a defect:
grep -rn "command:.*\${CLAUDE_SKILL_DIR}" "$PROJECT"/skills/*/SKILL.md

# All hook commands should match this pattern:
grep -rn "command:.*uv run python3 \${CLAUDE_PLUGIN_ROOT}" "$PROJECT"/skills/*/SKILL.md
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
one-liner: "Path portability scored Clean/Partial/Broken; hook-command variable audit run; candidacy scan fed into Step 4."
```

#### Ultracode-Workflow Candidacy Scan (feeds Step 4 Recommendations — no separate gate)

Before writing the report, scan every phase for **ultracode-workflow migration candidates** — fan-out phases that should be Claude Code ultracode workflows rather than in-skill agent dispatch. Read `${CLAUDE_SKILL_DIR}/references/dynamic-workflow-migration.md` §1 for the rubric. **Scan for BOTH worker modes — workflows are NOT read-only:**
- **Review fan-out** — N read-only agents (per section/lecture/question/source/footnote) → computed gate / structured findings.
- **Write/transform fan-out** — N write-agents (per file/site/lecture/section) that *create or transform* artifacts from a fixed spec (codemod, migration, per-item spec-driven generation), worktree-isolated. The docs' flagship case: 500-file migration, "make the change." **Do not skip these — they are often the strongest candidates.**

Flag a phase when the SHAPE qualifies AND it wins on ≥1 value driver:

1. **Shape (required):** the phase dispatches N agents "one per X" over a known list, and either the skill consumes their aggregated results (review) OR each does an **independent per-item mutation** (write). A *numeric* gate is NOT required.
2. **At least one value driver:** (a) **parallelism**, (b) **context isolation**, (c) a **deterministic gate** replacing a model-reported "recompute by hand" score (strongest review signal), or (d) **independent per-item mutation at scale** (write fan-out — migrations, codemods, per-item generation).

**The generation line — SPLIT it (do NOT blanket-leave generation):** *mechanical/spec-driven* per-item creation/transformation (the "what" is pinned by an inventory/outline/rule — e.g. per-lecture slide creation from a 15-20-item inventory, per-section assembly from an outline, a codemod) → **FLAG as a transform-workflow candidate.** Only *creative/judgment* generation (brainstorm a thesis, draft novel prose where voice IS the work) stays conversational.

**Not disqualifiers:** a mid-run user *strategy* choice ("sequential or parallel?") stays in the skill. A diagnosis output (REVIEW.md) instead of a numeric score is fine (driver b). The phase *writing files* is NOT a disqualifier (that's exactly driver d).

For each flagged phase, classify **strong** / **moderate**, note worker-mode (review vs transform), and add a Recommendation: *"Migrate <phase> to an ultracode workflow — review→gate/findings, or transform→worktree write + verify; keep the creative 'what' + `/goal` + R4 in the skill. Mode 3 improvement; see the migration playbook."* Do NOT flag: single-agent phases (no fan-out), *creative*-judgment drafting/brainstorm, content-approval gates, routing, or fan-outs whose agents are external (Batch API / CLI, not Claude subagents). If a phase has a real fan-out but no value-driver win, note "fan-out present, no migration win". If nothing qualifies, state "no ultracode-workflow candidates" — silence is ambiguous.

**Proceed to Step 4.** (STATE.md step-chain hook enforces this transition — update STATE.md before advancing.)

### Step 4: Output Audit Report

**Render AUDIT.md from the workflow result — do NOT re-score by hand.** The wc-audit workflow already produced `result.reportMarkdown` (the full AUDIT.md body: P01-P26 table, runner-architecture/executionClass section, enforcement coverage, path portability, candidacy table, critical gaps), `result.scoreTable` (the dimension-level gate), `result.candidacyTable`, `result.executionClass`, `result.composite`, and `result.verdict`. Write `result.reportMarkdown` verbatim to `.planning/wc/{name}/AUDIT.md` and present `result.scoreTable` + `result.composite` to the user. **The gate is `result.overallPass`/`result.composite`, computed in JS — do not recompute or rationalize it.** **If `result.executionClass === 'generic-interpreter'`, lead the Recommendations with a compiled-runner port** (see the migration playbook §0) — it is the highest-value fix. If `already-a-fan-out`, recommend spec-harden + guard-reconcile, NOT an engine swap. Append the composite row to `.planning/wc/{name}/SCORES.md` for the Mode 3 trend.

The format below documents what `result.reportMarkdown` contains (so you can sanity-check the workflow's output) — it is the spec the workflow renders to, not a worksheet to fill in yourself.

Format:

```
## Audit: [Workflow Name]

### Architecture Scores (P01-P30)
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
| P22 | Compile-vs-interpret fit | [0-10] / N/A | [notes] (N/A unless executionClass executes a plan-table DAG) |
| P23 | Single-source plan parser | [0-10] / N/A | [notes] |
| P24 | Honest gate (exit-code/probe) | [0-10] / N/A | [notes] |
| P25 | Pause/resume + payload>pass-fail | [0-10] / N/A | [notes] |
| P26 | Adversarial layer outside runner | [0-10] / N/A | [notes] |
| P27 | Join trust-class (mechanical/semantic) | [0-10] / N/A | [notes] (multi-source enumeration ⇒ semantic join outside the parser) |
| P28 | Emitter-canonical hardened | [0-10] / N/A | [notes] (emitter, not parser-only; golden-test vs REAL artifact) |
| P29 | Guard passes REAL artifacts | [0-10] / N/A | [notes] (phantom-canonical: does shipped data pass its own guard?) |
| P30 | Gate covers all declared outputs | [0-10] / N/A | [notes] |

### Runner Architecture (P22-P30)
**Execution class:** `generic-interpreter` / `already-a-fan-out` / `compiled-runner` / `not-applicable`
- Classify on the deterministic-compile + shared-guard property, **NOT** on `run.js` presence (DATA-variant compiled-runners have no `run.js` by design).
- If `generic-interpreter`: CRITICAL — recommend a `spec → plan → compile` port (migration playbook §0).
- If `already-a-fan-out`: do NOT force an engine swap — add the deterministic compile + shared guard (P22/P23).
- If `not-applicable`: P22-P30 N/A (excluded from composite).

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

### Ultracode-Workflow Migration Candidates
| Phase | Fan-out? | Worker mode (review/transform) | Value driver | Recommend migrate? (strong/moderate) | Note |
|-------|----------|--------------------------------|--------------|--------------------------------------|------|
| [phase] | ✅/❌ (one per X) | review / transform / — | parallelism / context / gate / per-item-mutation | ✅ Mode 3 (strong\|moderate) / ❌ leave | [why] |

(From the Ultracode-Workflow Candidacy Scan. "no ultracode-workflow candidates" if none qualify.)

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

**Traceability (self-applied P18):** write or update `.planning/wc/{name}/VALIDATION.md` mapping each `WC-NN` requirement to the audit evidence that verifies it (the gate/principle that confirms it) + its scope tag — the same closure Mode 1 Step 7 performs, applied to an audit-only run.

**Gate: Audit Reported** `[checkpoint: human-verify, auto-advanceable]`
- `.planning/wc/{name}/AUDIT.md` exists and contains `result.reportMarkdown` (P01-P21 table, enforcement coverage, path portability, candidacy table, critical gaps)
- `result.composite` was appended to `.planning/wc/{name}/SCORES.md`
- `.planning/wc/{name}/VALIDATION.md` maps the WC-NN evidence (P18 self-application)
- The gate verdict presented to the user is `result.overallPass` verbatim — not recomputed

**Persist audit results:** Write `result.reportMarkdown` to `.planning/wc/{name}/AUDIT.md` in addition to displaying it. Append `result.composite` to `.planning/wc/{name}/SCORES.md`. **Review-pattern logging (self-applied P19b):** append to `.planning/wc/{name}/LEARNINGS.md` what the user attended to in the audit results (which findings they prioritized or overrode) — the same observe→record→offer loop Mode 1 Step 7 performs. Update `.planning/wc/{name}/STATE.md`:
```yaml
step: 4-report
status: completed
implements: [WC-09]
requires: [all workflow skill files]
provides: [AUDIT.md, VALIDATION.md]
affects: [.planning/wc/{name}/AUDIT.md, .planning/wc/{name}/VALIDATION.md]
one-liner: "AUDIT.md rendered from the wc-audit result (composite + matrices + candidacy); VALIDATION.md maps WC-NN evidence."
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

#### Audit Facts — Mode 2 (incident-derived)

- Skimming produces generous scores: a March 2026 audit missed 6 un-gated sub-responsibilities buried in a 285-line Step 3. Read ALL files line by line (Read with offset/limit for large files) — scoring from impression is an unverified claim presented as measurement.
- Anchoring to an overall impression inflates composites: an April 2026 baseline scored 6.5 on impression and 5.2 on careful per-principle tally. Score each principle independently and sum at the end; "mostly there" means gaps exist, and a score that hides them is dishonest.
- A principle that "doesn't apply" gets a justified N/A, not a skip — pre-filtering principles substitutes the auditor's judgment for the thing the rubric exists to check.
- A 9-10 requires cited evidence of excellence (specific line/pattern), not absence of found problems. No evidence = no high score.
- The Gate Enforcement and Hook Coverage matrices catch structural asymmetries that prose review misses; an audit without them is subjective, however thorough the prose feels. Low-drift phases still get scored — a brainstorm phase with no gate means the agent can skip directly to implementation.

#### Staged Review — Mode 2

If the audit report composite is below 7.0 on first pass, STOP and re-read all workflow files from scratch before finalizing scores. Audits this low usually indicate the auditor missed a section or misunderstood the workflow structure — not that the workflow is truly that weak. Re-reading costs 5 minutes; a wrong baseline wastes the entire improvement cycle.

#### Delete & Restart — Mode 2

<EXTREMELY-IMPORTANT>
**If you scored ANY principle before its evidence was available, DELETE all scores and restart from Step 1. No exceptions.** This fires in three cases: (1) you scored before reading the relevant file section; (2) you scored before the wc-audit workflow returned `result`; (3) you carried a score for a principle the reviewers did not actually cover this run. A partial-read or pre-result audit produces anchored scores that resist correction — starting fresh is faster than debiasing.
</EXTREMELY-IMPORTANT>

A fast, generous audit is counterproductive on every axis: the user acts on a false baseline, discovers the gaps in production, and stops trusting your scores — slower and costlier than the honest audit would have been.

---

## Mode 3: Improve Workflow

**Migrating a fan-out phase to an ultracode workflow is a Mode 3 improvement.** If the user asks to "migrate a phase to an ultracode workflow" / "convert fan-out to a workflow script," or the audit's candidacy scan flags a fan-out phase — *review* (read-only → gate/findings) OR *transform* (write-agents creating/transforming from a fixed spec, worktree-isolated; e.g. a codemod, a migration, per-item spec-driven generation) — treat the migration as the fix: read `${CLAUDE_SKILL_DIR}/references/dynamic-workflow-migration.md` (decision rubric, both worker modes, the `discover→transform→verify` pattern for writes, script conventions, packaging, wiring, exit gate), confirm the candidate from the ACTUAL phase file (not a summary), write `workflows/<name>.js`, `node --check` it, verify the artifact lands at the expected path, then wire the skill (keep the creative "what" + `/goal` + R4). For migrating a *backlog* of several phases at once, prefer a one-off migration workflow (fan out over all candidates) rather than one-at-a-time.

<EXTREMELY-IMPORTANT>
## The Iron Law of Workflow Improvement

**MODE 3 IS AN AUDIT-FIX LOOP. THE SUBSTRATE GATE DECIDES WHEN TO STOP, NOT YOU AND NOT A BARE COMPOSITE NUMBER. This is not negotiable.**

Mode 3 terminates when **`result.substratePass` is true AND the composite has gone FLAT** (within ±0.2 of the prior iteration) — NOT when a noisy composite crosses an arbitrary 9.5. The substrate gate is the deterministic, monotonic signal: **0 critical findings · no enforcement pattern Absent where a phase needs it · path portability Clean.** Those converge; the 0-10 composite does not.

**The structural problem Mode 3 solves** (two failure modes, opposite directions):
1. **Stopping too early** by self-declaring "diminishing returns" before the substrate is clean. The loop + `/goal` evaluator prevents this — you cannot stop while a critical or an Absent enforcement pattern remains.
2. **Chasing a noisy proxy forever.** The composite is an LLM panel: it re-rolls ±0.2 each run, its domain-ceiling denominator drifts, and it regenerates new minor findings every pass. Targeting `composite ≥ 9.5` sends the loop onto a treadmill where fixing 4 findings surfaces 4 new ones and the number never converges (empirically every workflow asymptotes ~9.0; see project_wc_mode3_asymptote). The last 0.5 to 9.5 can only be bought by over-enforcing creative/low-drift phases — which **violates** the Step-4 drift tiering and the no-speculative-enforcement rule. So 9.5 rewards making the workflow *worse*.
</EXTREMELY-IMPORTANT>

### Why the gate is the substrate, not 9.5 (calibrated ceiling)

| | Composite (0-10) | Substrate gate |
|---|---|---|
| Stationary across runs? | No — ±0.2 LLM noise, drifting denominator | **Yes** — deterministic |
| Converges as you fix? | No — regenerates findings (treadmill) | **Yes** — criticals 5→0, enforcement Weak→Present are monotonic |
| Last-mile incentive | Push to 9.5 ⇒ over-enforce creative steps (anti-pattern) | Close real structural gaps only |

**Doctrine:** drive the loop to **`substratePass` + composite ≥ 9.0 (calibrated ceiling) + composite flat across 2 iterations**, then STOP. Do not iterate further to lift the composite — that is the treadmill. If `substratePass` is true but the composite sits at, say, 8.6 and is flat, the workflow is **at its ceiling and sound**: ship it and note the composite as the honest harsh-auditor reading, not a defect.

### Step 1: Run Initial Audit (Mode 2)

**State initialization:** Create `.planning/wc/{name}/STATE.md` with this YAML template:
```yaml
---
mode: improve
step: 1-initial-audit
status: in_progress
target: [workflow name]
implements: [WC-12]
requires: [target workflow files]
provides: [baseline composite]
affects: [.planning/wc/{name}/STATE.md, .planning/wc/{name}/SCORES.md]
one-liner: "Improve loop started on {target} — running baseline wc-audit before the /goal climb."
---
```

**Context monitoring:** Mode 3 runs multi-iteration audit-fix loops. Each iteration consumes significant context. Check availability:
- If context is low (≤35% remaining), write `.planning/wc/{name}/HANDOFF.md` with current iteration, score, and remaining gaps before starting the next iteration.
- If context is critical (≤25% remaining), write HANDOFF.md immediately — do not start another iteration.

Run Mode 2 on the target workflow. This produces the baseline score.

**Gate:** Mode 2 audit report exists with numeric scores for all P01-P21 principles. `[checkpoint: human-verify, auto-advanceable]`

### Step 2: Launch Audit-Fix Loop
<!-- implements: WC-12 -->

Use the audit-fix-loop pattern with `/goal` as the cross-turn iteration primitive (separate-model evaluator reads SCORES.md from the transcript). The **canonical doctrine** — auditor≠fixer, substrate-gate-not-bare-score, and the anti-grind rationale — lives in the `audit-fix-loop` skill; what follows is the wc-specific instantiation (wc-audit's `substratePass` / `composite` fields):

```
/goal Workflow [WORKFLOW_NAME] reaches result.substratePass=true (0 critical, no enforcement Absent, portability Clean) AND composite >= 9.0 AND composite flat (within ±0.2 of the prior SCORES.md row). Stop after 10 turns. Do NOT keep iterating to lift the composite once the substrate gate is clean and the composite is flat — that is the treadmill.
```

**Before launching the goal, persist the second link of the improve chain** (the hook's improve chain is `1-initial-audit → 1-audit-loop`):
```yaml
step: 1-audit-loop
status: in_progress
requires: [Mode 2 audit report]
provides: [score-gated fix iterations]
affects: [.planning/wc/{name}/STATE.md, .planning/wc/{name}/SCORES.md, target workflow files]
one-liner: "/goal audit-fix loop launched (gate: substratePass + composite≥9.0 + flat); each turn re-runs wc-audit and appends composite + substratePass to SCORES.md."
```

**Each turn under the active goal follows this exact sequence:**

```
Phase A: AUDIT ──→ Phase B: DECIDE ──→ Phase C: FIX
  [fresh subagent]   [check score]       [targeted edits]
    │                    │                    │
    ▼                    ▼                    ▼
  AUDIT.md         substratePass &&      Fix gaps by priority:
  SCORES.md        composite≥9.0 &&       1. criticals (any severity:critical)
                   flat(±0.2)?            2. enforcement Absent → Present
                        │                 3. portability → Clean
                    YES ──→ end turn;      4. then P<9 medium gaps
                           /goal evaluator      │
                           marks done           ▼
                        │                   End turn → /goal
                    NO ──→ Phase C          refires Phase A
```

#### Phase A: AUDIT (the wc-audit workflow — MANDATORY, independent by construction)

**Run the Mode 2 wc-audit ultracode workflow** (see "How Mode 2 runs" above) — it IS the fresh, independent audit. Each dimension reviewer reads the files cold with NO knowledge of your fixes, and the **composite is computed in JS**, so a fixer cannot rubber-stamp its own work:

```bash
WF=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/workflows/wc-audit.js 2>/dev/null | sort -V | tail -1)
[ -z "$WF" ] && WF="${CLAUDE_SKILL_DIR}/../../workflows/wc-audit.js"
```
```
# Full audit on iteration 1; selective re-audit thereafter:
Workflow({ scriptPath: "<WF>", args: {
  targetWorkflow: "{name}", projectDir: "<abs repo root>", pluginRoot: "<abs .../workflows dir>",
  threshold: 9.0,                                   // calibrated ceiling, NOT 9.5 — composite is advisory; substratePass is the gate
  onlyChecks: <prev result.reviewersThatFlagged>,   // omit on iteration 1
  priorReviews: <prev result.reviews>               // omit on iteration 1
} })
```

Write `result.reportMarkdown` to `.planning/wc/{name}/AUDIT.md` and append a row to `.planning/wc/{name}/SCORES.md` recording **`result.composite`, `result.substratePass`, `result.substrate` (criticals / enforcementAbsent / portability)**. The workflow's reviewers are read-only (they REPORT, never fix) and the gate is computed in JS. **`result.substratePass` is the trustworthy convergence signal; `result.composite` is an advisory ±0.2 LLM proxy — record it, but the gate keys on substratePass + flatness, not the bare number.**

<EXTREMELY-IMPORTANT>
**THE AUDIT IS THE wc-audit WORKFLOW, NOT YOUR OWN RE-READ. If you score your own fixes by hand, you are rubber-stamping.**

The workflow's reviewers have no context from the fix phase — they read the files cold and the composite is computed in JS from raw scores. This is what makes the score trustworthy. Do not substitute a hand audit; do not recompute `result.composite`.
</EXTREMELY-IMPORTANT>

#### Phase B: DECIDE `[checkpoint: decision]`

Read `.planning/wc/{name}/SCORES.md`. Render the score trend for visual context:

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/render-audit-scores.py .planning/wc/{name}/SCORES.md
```

Check the **substrate gate**, then the calibrated composite + flatness. "Flat" = this iteration's composite is within ±0.2 of the prior SCORES.md row.

| Condition | Action |
|-----------|--------|
| `result.substratePass` AND composite ≥ 9.0 AND flat | Output `<promise>WORKFLOW_DONE</promise>` — substrate clean at the calibrated ceiling; STOP (do not iterate to lift the composite) |
| `result.substratePass` AND composite ≥ 9.0 but NOT yet flat | Continue to Phase C **only** for any remaining sub-9 medium gaps; if none are cheap/real, treat as flat and STOP |
| NOT `result.substratePass` (a critical, an enforcement Absent, or portability not Clean) AND iteration < 10 | Continue to Phase C — fix the substrate blocker (this is the non-negotiable part) |
| NOT `result.substratePass` AND iteration ≥ 10 | Escalate to user with the substrate blockers and scoreTable |
| `result.substratePass` but composite < 9.0 AND flat across 2 iterations | Escalate to user: substrate is clean but the composite sits below the ceiling and won't climb — likely a genuine domain ceiling or a judge artifact; present it, don't grind |

**You may output the completion promise once `result.substratePass` is true and the composite is at/above the calibrated ceiling and flat. You may NOT keep iterating to push a flat composite toward 9.5 — that is the treadmill the Iron Law forbids. You may NOT declare done while `substratePass` is false (a critical / Absent enforcement / dirty portability remains) — the substrate is non-negotiable.**

**Review-pattern logging (self-applied P19b):** append to `.planning/wc/{name}/LEARNINGS.md` after each DECIDE: which principle moved this iteration, the cheapest fix that moved it, and (if the user interjected) what they attended to. After 3+ iterations with a recurring drag-principle, propose encoding its fix as a default in the skill.

#### Phase C: FIX

<EXTREMELY-IMPORTANT>
**NO FIX WITHOUT A SPECIFIC AUDIT FINDING. Targeted changes only — never rewrite a phase file wholesale.** Each edit must close ONE gap the wc-audit workflow named. Editing files the audit did not flag is unverified change that the next audit cannot attribute — and risks regressing a principle that was passing.

**Delete & Restart (Phase C):** if you have already edited a target file WITHOUT a corresponding AUDIT.md finding — revert that edit, find the finding that actually justifies the change (or drop it), then re-apply as a targeted fix. Fixes applied outside the audit are unverified and routinely regress a passing principle. (This run's own lesson: labeling the review markers "structural" without the enforcing hook regressed P03 and P20 — the hook had to follow the prose.)
</EXTREMELY-IMPORTANT>

**Post-subagent boundary (after `wc-audit` returns).** The audit is the wc-audit workflow's job; fixing is yours. Keep the two separate:

| Main chat CAN do (fixing) | Main chat CANNOT do (re-auditing / investigation) |
|----------------------------|-----------------------------------------------------|
| Read AUDIT.md / SCORES.md and the specific files a finding cites | Re-score a principle by hand (the JS gate + reviewers own the composite) |
| Edit the target files to close a named finding | Override `result.composite` / `result.overallPass` ("the auditor was wrong") |
| Re-run the `wc-audit` workflow (full or `onlyChecks`) | Declare "close enough" below threshold |
| `git`/`ls`/`node --check` to confirm an edit landed | Bash/Grep-spelunk the workflow to form your own score instead of re-running the audit |

After fixing, you re-run the workflow — you do NOT substitute your own read for the auditor's verdict.

**Topic-change protocol (the `/goal` loop is iterative — an off-topic message must not silently kill it).** If the user interjects mid-loop: (1) **announce** "Pausing the wc audit-fix loop at iteration N (composite X) to handle your request"; (2) **handle** the request; (3) **announce-resume** "Resuming the loop from iteration N" and re-fire Phase A. Never abandon the loop without saying so.

Address findings from `.planning/wc/{name}/AUDIT.md`, prioritized by severity:

1. Fix all principles scoring < 7.0 first (critical gaps)
2. Then principles scoring 7.0-8.9 (medium gaps)
3. Then principles scoring 9.0-9.4 (polish)

**Fix reference — common gap → fix mapping:**

| Gap | Fix |
|-----|-----|
| Missing Iron Law | Write with `<EXTREMELY-IMPORTANT>` tags |
| Missing Fact Rows | `### <Topic> Facts` bullets from observed incidents — numbers, thresholds, tool quirks — with the drive-consequence inline (never excuse/reality tables; deprecated v5.36.0) |
| Weak gate | Replace with verifiable condition |
| Self-review as final gate | Add fresh subagent reviewer dispatch |
| Missing Red Flags | 3-5 wrong-path indicators |
| Missing Drive-Aligned Framing | Embed drive vocabulary (helpfulness > competence > efficiency > approval > honesty) inside fact rows and Iron Laws — standalone 5-drive tables deprecated v5.36.0 |
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
| Missing artifact review gate | Add reviewer subagent dispatch between producing/consuming phases, `/goal`-driven (5-turn budget; evaluator gates exit on reviewer APPROVED) |
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
| Mechanical constraints enforced only via prompt | Write scoped `PreToolUse`/`PostToolUse` hooks in skill frontmatter. File extension guards, path guards, tool param validation, sequence enforcement → hooks. Keep fact rows, Iron Laws, and quality judgments as prompt text |

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
- **End your turn immediately** so the loop feeds you back for re-audit. Do NOT ask "should I continue?", do NOT summarize the fixes you just made, do NOT wait for confirmation — the `/goal` evaluator re-fires Phase A on its own. Pausing between fix iterations is procrastination disguised as courtesy; it strands the loop.

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

**What happened (March 19, 2026):** Agent stopped at 8.5 with a critical still open, self-rationalizing "diminishing returns." The failure wasn't "stopped below a magic number" — it was **stopping while the substrate gate was still failing** (a critical outstanding) and without a `/goal` loop forcing a re-audit. The `/goal` loop + `substratePass` gate prevent exactly that: you cannot stop while a critical / Absent enforcement / dirty portability remains.

**The structural fix:** `/goal` drives the iteration; a separate evaluator reads `.planning/SCORES.md` and marks done only when **`substratePass` is true AND the composite is flat at/above the calibrated ceiling**. This cuts BOTH failure modes: it won't let you stop with a substrate blocker, and it won't make you grind a flat composite toward an unreachable 9.5.

### Mode 3 Facts

- The composite is a ±0.2 LLM proxy with a drifting denominator; its observed ceiling is ~9.0, not 9.5. Once `substratePass` is true and the composite is FLAT, further grinding is the treadmill — the judge regenerates findings and the last mile rewards over-enforcement of creative steps, making the workflow worse. A flat 8.7 with substratePass beats a gamed 9.5; record the composite as the honest harsh reading and ship at the calibrated ceiling.
- `substratePass: true` with a still-climbing (non-flat) composite is not done — a non-flat composite means cheap real gaps may remain. One more pass on sub-9 medium gaps; stop once flat or no cheap real fix remains.
- A critical keeps `substratePass` false — you cannot stop on it. But verify it first: a worktree's ambient `.planning/` SPEC can make traceability checks fire spuriously (see asymptote memory). Confirm the critical against the actual files; fix it, or if it is a confirmed measurement artifact, neutralize the artifact. Ignoring an open critical is fabricating completion.
- Manual loops have no enforcement and stop early. Run Mode 3 under `/goal` pinned to substratePass + flat — the evaluator decides, not the fixer.
- A fresh-context full re-read every audit iteration is what makes the substrate trustworthy: it catches regressions that incremental review misses (selective via `onlyChecks` after iteration 1 applies to the *fixer's* reading, never the auditor's). Skipping the re-read audits your own memory — rubber-stamping.
- A diff cannot show that a fix closed a gap — self-assessment is rubber-stamping; the independent auditor exists because the author cannot see their own blind spots. Shipping unverified fixes hands the user a substrate gap in production.

### Red Flags — STOP:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Iterating to push a FLAT composite from ~9.0 toward 9.5 | The treadmill — the judge regenerates findings and the last mile rewards over-enforcement. | Stop once substratePass + flat. The composite ceiling is ~9.0, not 9.5. |
| Declaring done with `substratePass` false | A critical / Absent enforcement / dirty portability is a real structural gap, not noise. | Keep iterating or escalate at the budget. |
| Running Mode 3 without `/goal` | Honor system — you'll stop early. | Set `/goal` pinned to substratePass + composite≥9.0 + flat. |
| Auditing your own fixes by hand | Rubber-stamping. | Re-run the wc-audit workflow (read-only reviewers, JS gate). |
| Treating the composite as the gate | It's a ±0.2 LLM proxy with a drifting denominator. | The gate is `substratePass`; the composite is advisory + the flatness check. |

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

**The structural fix — ultracode workflows:** For a genuine fan-out (one reviewer per item × check) producing a computed gate, migrate the dispatch into a Claude Code **ultracode workflow** (see `${CLAUDE_SKILL_DIR}/references/dynamic-workflow-migration.md`; build it during Mode 1 decomposition or migrate an existing phase via Mode 3). An ultracode workflow is a *script*, not a dispatcher agent: reviewer results land in script variables and the gate is computed in JS, so result loss is impossible by construction — and the model can no longer inflate a self-reported score. Use it when a phase fans out + gates; keep drafting, `/goal`, and user-input phases conversational in the skill.

### NO LLM STEP BETWEEN A STRUCTURED PRODUCER AND A STRICT CHECKER
When a structured artifact (a plan table, a typed spec) feeds a strict checker (an executable-guard, a deterministic parser), NEVER scaffold an LLM step between them. An LLM "discovery" agent that re-reads the table doesn't just cost tokens — it **silently tolerates format drift the checker rejects**, masking a spec-drift bug while looking like it works. If the input is a structured table, scaffold a **deterministic parser** (shared by the compiler AND the guard, so "compiles ⇔ passes gate"), not an agent that re-reads it.

**The ds incident (June 2026):** the generic-interpreter `ds-implement.js` ran an LLM discovery agent between `ds-plan` (a structured producer) and `ds-plan-executable-guard.py` (a strict checker). Real plans used `**T1**`/em-dash deps that the guard rejected on *every row* — but the LLM tolerated them, so the workflow ran while the guard was silently dead. The drift was invisible until the LLM was removed. The accompanying re-analysis verifier "caught zero substantive bugs." Fix: deterministic parser+compiler shared with the guard; the discovery LLM and the re-analysis verifier were both deleted. (`docs/investigations/2026-06-26_llm-discovery-masked-spec-drift.md`.) This is enforced at audit time as **executionClass=generic-interpreter ⇒ critical** (Mode 2 P22-P26).

**Layer-agnostic:** this applies to ANY structured-producer → strict-checker boundary, not just the data/plan layer — the **spec layer** too (an `OUTLINE.md` / `*_REVIEWED.md` sentinel a downstream phase parses). The full remedy is the emitter-canonical triple (born-canonical emitter + strict guard + tolerant-parser shim, doctrine #6). The **stale-gate backstop** is likewise layer-agnostic: a gate-changing decision that leaves a stale UPSTREAM artifact must fail loud at whatever layer the gate lives (data Verify or spec sentinel), never be quietly reshaped to pass.
</EXTREMELY-IMPORTANT>

## Red Flags - STOP:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Creating a workflow without reading PHILOSOPHY.md | You'll miss the foundational principles | Read it first, every time |
| Skipping the user interview | You'll design for an imagined domain, not the real one | Ask the seven questions |
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
| Fact rows are hypothetical, not grounded | "Agents sometimes skip" is ignorable. "March 16: 71 violations, 3 re-invocations" is not. | Cite real failed sessions with dates, IDs, and violation counts |
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

## Workflow Design Facts

- Simple workflows drift fastest — "simple, doesn't need enforcement" marks exactly where the agent shortcuts. Enforcement is proportional to drift risk, not workflow size; and LLMs ignore polite suggestions, so soft language in place of an Iron Law is enforcement that does not exist.
- A bad plan costs 10x more to fix during implementation than during review; the 10-minute interview and the 10-minute re-audit each prevent weeks of waste. Skipping either to "deliver faster" is a ~100x slowdown — anti-efficient on its own terms, and the user experiences the workflow's failure rate, not your saved tedium.
- "Short" is about phase count, not context usage: a 4-phase workflow can exhaust context on phase 2 if implementation is complex. Context monitoring costs nothing when context is plentiful; omitting it as overkill produces a degraded tail and lost state.
- Without requirement IDs, validation maps requirements by fuzzy text matching — "Auth" matches 3 different requirements and misses 2. IDs take 30 seconds to assign and make coverage auditable.
- ~90% of gates are rubber-stamp `human-verify`; the other 10% still pause. Classifying checkpoints lets autonomous mode skip the rubber stamps without skipping real decisions — treating every gate as human-required makes a 7-phase workflow need 7 interventions and unusable overnight.
- A convention that is hard to test stays a convention: note it as a graduation candidate and revisit when testability improves. Force-fitting a bad test to call it a "constraint" produces a check that asserts nothing — classify honestly.
- "I remember PHILOSOPHY.md" without re-reading it this session is fabricated understanding — memory of a foundational document is an unverified claim, and the workflow built on it can violate the principles it must trace to.
