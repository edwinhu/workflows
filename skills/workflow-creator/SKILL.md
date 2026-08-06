---
name: workflow-creator
description: "Use when creating or designing a new multi-phase workflow, including its entry points, phases, gates, constraints, compiler manifest, verification, and human review surfaces. Fresh creation entry; use workflow-creator-improve for audits, redesigns, repairs, or migrations of existing workflows."
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Skill, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Workflow
hooks:
  PreToolUse:
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow workflow-creator"
    - matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow workflow-creator"
    - matcher: "Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow workflow-creator"
  PostToolUse:
    - matcher: "AskUserQuestion"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/episode-phase.ts --workflow workflow-creator"
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow workflow-creator"
---

# Workflow Creator — Fresh Entry

Create a new workflow through the shared-v1 lifecycle. This entry orchestrates; it never directly writes target workflow files.

## Write surface: main chat does not do the work

**You may Write/Edit only under `.planning/` and `.claude/`. Every target workflow file — skills,
hooks, scripts, tests — is written by a dispatched agent.** `orchestrator-mutation-guard` is
registered in this skill's frontmatter, so the attempt is REFUSED, not corrected: a write you try
anyway costs a turn and produces nothing. Reach for `Agent` first, not after a denial. Bash is held
to the same line — only the named read-only checks and compilers are permitted from main chat.

Two narrow exceptions: the generated plan while you are IN Plan mode, and `.claude-workflows.json`
when adopting governance.

## Compatibility boundary

If legacy `.planning/wc/` state exists, stop. Legacy Mode 1/2/3 state, numeric steps, review markers, and HANDOFF files are not resumable or convertible; a shared-v1 marker does not convert them. Start a fresh episode with a new receipt-selected generated plan.

## Shared lifecycle

```text
CLARIFY → planning evidence → native Plan approval → independent plan review
        → deterministic plan compiler → beat-implement → independent workflow-creator-verify verification
        → shared beat-review / HUMAN_REVIEW.md
```

The diagram is authoritative.

## Beats 3–5 run as one program: `workflows/work.js`

Beats 3, 4 and 5 run as a single orchestrated workflow rather than three stretches of main-chat
discipline. Two steps, in this order.

**Step 1 — get the authenticated args. One call, and it is not optional.**

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/work-args.ts <abs project> --workflow workflow-creator --session ${CLAUDE_SESSION_ID}
```

It prints `{projectDir, workflow, planPath, planHash}` read from `.planning/.state/review.json` and
re-hashed against the plan's current bytes, or refuses and names the reason — `missing-artifact`
(you have not been through PLAN), `review-pending`, `stale-receipt` (the plan was edited after
approval), or a receipt identity disagreement. **Do not hand-copy `planPath`/`planHash` instead.**
That is the step where a hash gets typed from memory and an unapproved plan gets implemented anyway.

**Step 2 — run the beats, merging in the task list.**

```
Workflow({
  scriptPath: "${CLAUDE_SKILL_DIR}/../../workflows/work.js",
  args: { ...<the JSON from step 1, verbatim>, tasks: [{ id, name, work, writablePaths: [], acceptance }] },
})
```

It returns `{ workflow, planPath, planHash, overallPass, verdict, scoreTable, implemented, verified,
findings, refutedFindings, reviews, tasksThatFlagged, carriedForward, domainRun }`. Render the gate,
drive the fix loop from `findings`, and re-invoke with `onlyChecks: tasksThatFlagged` plus
`priorReviews` to re-judge only what flagged.

**Why a program rather than three beats of instruction.** The beat machinery restrains a free agent:
guards deny reconnaissance, the mutation guard denies main-chat writes, an order gate refuses an
out-of-order wave, a Stop hook refuses a turn end while review is owed. Each exists because the
orchestrator *could* do otherwise. A workflow script has no Write tool and no shell, so delegation is
structural and the beat order is the order of its statements. CLARIFY and PLAN approval stay above,
in main chat and hook-enforced, because both are conversations with a human that a subagent cannot
hold — and `work.js` refuses to start without `planPath` and a 64-hex `planHash`, so it cannot be
used to skip them.

## 1. CLARIFY

**Write no sentinel.** `.planning/WC_CLARIFIED.json` is retired — a hook records the clarify phase
into `.planning/.state/episode.json` when it observes your `AskUserQuestion` call, which is evidence
rather than self-assertion. Reconnaissance unlocks when that phase is recorded. Initialize:

```yaml
---
workflow: workflow-creator
lifecycle: shared-v1
entry: fresh
phase: clarify
target: pending
---
```

Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md`. Ask in one batched interaction:

- workflow outcome and target repository/plugin;
- fresh and corrective entry behavior;
- phase responsibilities and common failure modes;
- deterministic versus judgment gates;
- mutation owners and required outputs;
- verification commands and human review surfaces;
- explicit exclusions and completion evidence.

Nothing is written after the user answers: the observed phase is the evidence. Only then inspect the target and build planning evidence.

**Gate:** the clarify phase is recorded in `.planning/.state/episode.json`, and outcome, entries,
phase responsibilities, gate kinds, mutation owners, verification commands, review surfaces,
exclusions, and completion evidence are all explicit.

## 2. PLAN

Read `${CLAUDE_SKILL_DIR}/../beat-plan/SKILL.md`. Create an executable native plan containing:

- intent, exclusions, target slug, and no-legacy policy;
- fresh/corrective entries and ordered internal phases;
- a canonical `## Workflow Output Manifest` table with columns:

```text
ID | Kind | Path | Depends On | Work | Criteria | Evidence | Writable Paths | Instruction Files | Model | Effort
```

- exact hooks, constraints, scripts, and review artifacts;
- mechanical compiler/check commands;
- independent semantic verification and human Review Surfaces.

Every row is a complete task specification. No duplicate IDs or outputs, unsafe paths, globs, directory authority, missing evidence, or undeclared dependencies.

Enter native Plan mode only when this manifest is executable. `ExitPlanMode` binds exact approved generated bytes to a hook-owned receipt. Never edit a selected generated plan or `.planning/.state/review.json` directly.

Read `${CLAUDE_SKILL_DIR}/../workflow-creator-plan-reviewer/SKILL.md` and dispatch the independent plan checker. Issues return to native Plan mode for fresh approval.

**Gate:** the receipt-selected `planFile` and `planHash` are `APPROVED` for workflow
`workflow-creator` by a distinct reviewer session, and the Workflow Output Manifest compiles with no
duplicate IDs or outputs, unsafe paths, globs, directory authority, missing evidence, or undeclared
dependencies.

## 3. IMPLEMENT

In a distinct implementation session:

1. Set `phase: compile` in `ACTIVE_WORKFLOW.md`.
2. Run the read-only compiler:
   ```bash
   bun ${CLAUDE_SKILL_DIR}/../../scripts/wc/workflow-plan-compiler.ts ".planning/<receipt-selected-planFile>" --project "<absolute target root>" --json
   ```
3. Parser/compiler failure blocks. There is no LLM, Python, or legacy enumeration fallback.
4. Pass the returned `readyWave` and immutable plan identity to `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md` with `workflow: "workflow-creator"`.
5. Set one budgeted `/goal` pinned to compiler success, all implementation records, focused checks, independent verification, and human review.
6. Main chat may read results and update planning state; only delegated implementation agents mutate target files.

**Gate:** the compiler succeeded on the authenticated plan identity, every manifest row has a
completed implementation record produced by a delegated agent, and exactly one budgeted `/goal` is
active.

## 4. VERIFY

Read `${CLAUDE_SKILL_DIR}/../beat-verify/SKILL.md`. Set `phase: verification`. **First run the deterministic compliance probe**, and pass its command as one of the required mechanical probes:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/wc/compliance-probe.ts --target "<plugin repo root>"
```

It checks three CONFIGURATION properties no reviewer agent can hold, because the characteristic way to get each one wrong is to measure the reference instead of the mechanism: every workflow reaches every beat; every hook file is registered on some matcher; every hook that fails open has a gate that treats its silence as failure. Exit 1 with findings is a blocking result.

**Point `--target` at the plugin under audit, including this one.** `workflow-creator` is a meta workflow, so it must be able to audit the workflows plugin itself — an auditor that only inspects generated workflows catches the next workflow's version of a defect and never its own host's, and every defect this probe encodes was in the host. `tests/compliance-probe.test.mjs` runs it against this repo on every test run, with an asserted `KNOWN_FINDINGS` registry.

Then invoke `workflow-creator-verify` with the deterministic compiler manifest and required mechanical probes. It is read-only and independently verifies architecture, enforcement, paths, hooks, and the approved criteria. A composite score is diagnostic only; completion requires no blocking finding and every evidence row passing.

Failures re-enter `/workflow-creator-improve`; retries preserve approved plan identity and only re-run proven attempted work.

**Gate:** the compliance probe exits 0, `workflow-creator-verify` returns no blocking finding, and
every evidence row passes on the command the plan named for it.

## 5. REVIEW

After independent PASS, set `phase: human-review`, read `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`, present the diff and any rendered surfaces named by the plan, and record dispositions in `.planning/HUMAN_REVIEW.md`.

Tactical feedback routes through `/workflow-creator-improve`. `REJECT:` invalidates the criteria and returns to CLARIFY.

**Gate:** every disposition is recorded in `.planning/HUMAN_REVIEW.md`, the final review relaunch has
no new annotations, and no `REJECT:` remains.

## Iron laws

- No task reconnaissance before clarification.
- No implementation without exact approved-plan identity and independent current-hash review.
- No direct main-chat mutation of target workflow artifacts.
- No fallback enumerator when the compiler rejects the manifest.
- The verifier is never the implementer.
- Automated PASS is not human acceptance.
