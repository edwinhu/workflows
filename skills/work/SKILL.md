---
name: work
description: "Use when the user asks to 'run a work workflow', 'do this properly', 'clarify, plan, and verify this', 'small structured task', or 'don't just wing it' for a bounded task too small for a specialized workflow."
hooks:
  PostToolUse:
    - matcher: "AskUserQuestion"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/episode-phase.ts --workflow work"
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow work"
  PreToolUse:
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow work"
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow work"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow work"
---

**Announce:** "Using work — clarify, plan, goal, verify, review."

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/ensure-plans-directory.ts ${CLAUDE_SESSION_ID}`

# Work

The lightweight, domain-agnostic workflow for a bounded task that deserves explicit intent,
evidence, independent verification, and human review without becoming a full domain workflow.

## Write surface: main chat does not do the work

**You may Write/Edit only under `.planning/` and `.claude/`. Every other file the task touches is
written by a dispatched agent.** `orchestrator-mutation-guard` is registered in this skill's
frontmatter, so the attempt is REFUSED, not corrected: a write you try anyway costs a turn and
produces nothing. Reach for `Agent` first, not after a denial.

Two narrow exceptions: the generated plan while you are IN Plan mode, and `.claude-workflows.json`
when adopting governance.

```text
 ┌──── OUTER LOOP: REJECT: → criteria were wrong → CLARIFY ───────────────────┐
 │                                                                            │
 ▼                                                                            │
CLARIFY ──► PLAN ──► IMPLEMENT ──► VERIFY ──PASS──► REVIEW ──┬─ clean → done  │
                        ▲              │                     │                │
                        └── fix ◄───FAIL                     └─ REJECT: ──────┘
```

**This diagram is the specification.** Tactical failures repair work against the approved criteria.
`REJECT:` replaces the interpretation through a freshly approved plan.

## Selection boundary

| Shape | Route |
|---|---|
| One-line answer, lookup, or tiny edit | Do it directly |
| Bounded cross-domain task needing clarify → verify → review | `/work` |
| Feature needing a real spec, TDD, or substantial architecture | `/dev` |
| Bug with an unknown cause | `/dev-debug` |
| Research-quality dataset analysis | `/ds` |
| Wrong analysis results or notebook failure | `/ds-fix` |
| Paper, article, or other long-form prose | `/writing` |
| Workshop presentation | `/workshop` |
| Existing artifact improved against a score | `/audit-fix-loop` |

Work's floor is “I would otherwise start typing and hope.” Its ceiling is “this now needs its own
specialized specification.” Escalate by task shape rather than stretching this workflow.

## Canonical state

**NO WORK IMPLEMENTATION WITHOUT THE EXACT GENERATED PLAN AUTHENTICATED AND INDEPENDENTLY APPROVED BY `.planning/.state/review.json`.**

For a modern work episode:

- The safe generated `.planning/<native-name>.md` selected by `review.json` is the sole substantive
  planning specification.
- The receipt binds its exact `plan_file`, `plan_hash`, workflow identity, native approval session/time,
  and independent review session/time. Use the exposed `planFile` and `planHash` unchanged.
- TaskList owns phase, task status, dependencies, attempts, verification rounds, review findings,
  rejection disposition, and completion.
- Project auto-memory receives only reusable facts; normal project directories hold deliverables.

Do not create or treat any visible review, work, active-workflow, phase-summary, copied-plan, or mutable
status document as authority. Copying the generated plan into another specification creates competing
authority and is prohibited.

### Startup and compatibility

Classify before resuming:

1. **Canonical:** `review.json` selects and authenticates one generated plan path/hash. If its review is
   pending, resume at independent whole-plan review. If it is approved, reconcile and resume only
   current-hash TaskList work.
2. **Legacy-only:** retired planning or lifecycle files exist without an authenticated generated plan.
   Explain the conversion, preserve them unchanged as provenance, reconstruct the required native plan
   schema, and require fresh approval and independent review before implementation. Legacy files never
   authorize implementation.
3. **Canonical with legacy provenance:** the receipt-selected generated plan and TaskList remain the only
   authority. Retired files may be read only to explain history; never merge them into the live
   specification.
4. **Conflicting authority:** a legacy approval layout competes with the generated receipt for current
   authority. Stop, identify both layouts, and require explicit resolution; never merge automatically.
5. On the same authenticated plan hash, reconcile TaskList and continue without duplicate tasks. A new
   plan hash supersedes old open authority according to the deterministic rollover rules in IMPLEMENT.

## 1. CLARIFY

Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md` and follow it before task reconnaissance. Supply
these generic axes: desired outcome, exclusions, material constraints, observable completion evidence,
and required human review surfaces. Keep clarification in the conversation until it is incorporated
into the native plan.

**Gate:** intent, exclusions, evidence-bearing success criteria, and review surfaces are explicit enough
to enter native Plan mode without guessing.

## 2. PLAN

Read `${CLAUDE_SKILL_DIR}/../beat-plan/SKILL.md`, then `${CLAUDE_SKILL_DIR}/beats/plan.md` for work's
required plan schema and proportionality ceiling. Use native Plan mode and obtain approval. The
PostToolUse persistence hook binds the exact generated plan bytes in the receipt and invalidates stale
review state. Then obtain one independent whole-plan review bound to the same hash.

**Gate:** the receipt-selected `planFile` and `planHash` form an approved artifact for workflow `work`.

## Beats 3–5 run as one program: `workflows/work.js`

Beats 3, 4 and 5 run as a single orchestrated workflow rather than as three stretches of main-chat
discipline. Two steps, in this order.

**Step 1 — get the authenticated args. One call, and it is not optional.**

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/work-args.ts <abs project> --workflow work --session ${CLAUDE_SESSION_ID}
```

It prints `{projectDir, workflow, planPath, planHash}` read from `.planning/.state/review.json` and
re-hashed against the plan's current bytes, or it refuses and names the reason — `missing-artifact`
(you have not been through PLAN), `review-pending`, `stale-receipt` (the plan was edited after
approval), or a receipt identity disagreement. **Do not hand-copy `planPath`/`planHash` instead.**
That is the step where a hash gets typed from memory and an unapproved plan gets implemented anyway.

**Step 2 — run the beats, merging in the task list.**

```
Workflow({
  scriptPath: "${CLAUDE_SKILL_DIR}/../../workflows/work.js",
  args: {
    ...<the JSON from step 1, verbatim>,
    tasks: [{ id, name, work, writablePaths: [], acceptance }],   // from TaskList / the approved plan
  },
})
```

`tasks` is the one field step 1 will not produce: TaskList belongs to Claude Code and no script can
read it, and deriving tasks from the plan's prose here would be exactly the LLM-discovery fallback
every other authority path in this repo refuses. `work.js` refuses an empty list.

It returns `{ workflow, planPath, planHash, overallPass, verdict, scoreTable, implemented, verified,
findings, refutedFindings, reviews, tasksThatFlagged, carriedForward }`. Render the gate, drive the
fix loop from `findings`, and re-invoke with `onlyChecks: tasksThatFlagged` plus `priorReviews` to
re-judge only what flagged.

**Why a program and not three beats of instruction.** The beat machinery restrains a free agent:
guards deny reconnaissance, the mutation guard denies main-chat writes, an order gate refuses an
out-of-order wave, a Stop hook refuses a turn end while review is owed. Every one of those exists
because the orchestrator *could* do otherwise. A workflow script has no Write tool and no shell, so
delegation is structural rather than enforced, and the beat order is the order of its statements.

**What stays in main chat, and why the hooks do not all retire.** CLARIFY needs `AskUserQuestion`
and PLAN approval needs `ExitPlanMode` — both are conversations with a human, which a workflow
subagent cannot hold. Those two beats remain above, and remain hook-enforced. `work.js` refuses to
start without `planPath` and a 64-hex `planHash`, so it cannot be used to skip them.

## 3. IMPLEMENT

Dispatched by `workflows/work.js` above; this section is the adapter detail it enacts.
Read `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md` for its implementation/verification doctrine,
then read `${CLAUDE_SKILL_DIR}/beats/goal-work.md` for this adapter's reconciliation and dispatch.

**Gate:** exactly one `/goal` is confirmed active, names the authenticated generated plan identity,
restates transcript-visible evidence requirements, and has a turn budget. TaskList contains the complete
current plan task set before `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md` receives a ready wave.

## 4. VERIFY

Read `${CLAUDE_SKILL_DIR}/../beat-verify/SKILL.md`, then `${CLAUDE_SKILL_DIR}/beats/verify.md` for the
dispatch payload and where each outcome goes. The verifier is never the doer.

**Gate:** every current-plan task has a post-change independent verification round recorded in TaskList,
all criteria pass, and the implementation `/goal` is cleared before human review.

## 5. REVIEW

Read `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`, then
`${CLAUDE_SKILL_DIR}/beats/review-surface.md`. The shared primitive owns feedback capture and disposition;
the adapter supplies the receipt-selected target and rendered surface.

**Gate:** TaskList has no open current-plan implementation, verification, or review item; the final
review relaunch has no new annotations; required rendered artifacts are fresh; and no `REJECT:` remains.

## Escalation and rejection cap

- Same treatment over independent pinned items may use an explicitly approved closed fan-out stage;
  `/work` keeps `/goal`, verification, and human review.
- At least five substantial files or eight implementation steps: dispatch scoped implementation tasks
  through the shared authenticated runner. Mutations remain sequential without filesystem isolation.
- Round two and later resumes the original verifier.
- More than roughly ten plan steps or real sub-phases: move to the appropriate specialized workflow.
- On `REJECT:`, clear the goal, preserve findings in TaskList, replace intent and criteria through a new
  native plan, and increment the TaskList rejection count. If the rejection count is already 1, stop and
  escalate or descope; two rejected interpretations require a real spec, not a third guess.
- If the turn budget expires without PASS, report failing criteria, evidence, and attempted fixes; offer
a new approach, criterion revision, or specialized workflow.

## Red flags — STOP

| About to | Do instead |
|---|---|
| Read or grep a task file before CLARIFY | Ask first; procedure files are the only exemption |
| Run `/work` for a trivial edit | Do it directly |
| Let the plan acquire real sub-phases | Escalate to the specialized workflow |
| Treat implementer output as verification | Dispatch an independent verifier |
| Spawn a replacement verifier after a failure | Resume the same verifier |
| Mutate the receipt-selected generated plan after approval | Replace it through native Plan mode and fresh review |
| Treat legacy state as implementation authority | Convert explicitly and require fresh approval |
| Start a third interpretation after two rejections | Escalate or descope |
