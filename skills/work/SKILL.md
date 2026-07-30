---
name: work
description: "Use when the user asks to 'run a work workflow', 'do this properly', 'clarify, plan, and verify this', 'small structured task', or 'don't just wing it' for a bounded task too small for a specialized workflow."
---

**Announce:** "Using work — clarify, plan, goal, verify, review."

# Work

The lightweight, domain-agnostic workflow for a bounded task that deserves explicit intent,
evidence, independent verification, and human review without becoming a full domain workflow.

```text
 ┌──── OUTER LOOP: REJECT: → criteria were wrong → CLARIFY ──────────────────────┐
 │                                                                                │
 ▼                                                                                │
CLARIFY ──► PLAN ──► GOAL + WORK ──► independent VERIFY ──PASS──► human REVIEW ──┤
   │          │              ▲                  │                     │             │
   │          │              └──── fix ◄────FAIL                     ├─ clean → done
   │          │                                     tactical fix ────┘
   ▼          ▼
WORK.md     approved plan
```

**This diagram is the specification.** The inner loop repairs work that fails current criteria. The
outer loop handles `REJECT:`, which means the criteria encoded the wrong outcome and must be replaced.

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
specialized specification.” Escalate by task shape rather than silently stretching this workflow.

## Canonical state

Use `.planning/WORK.md`:

```markdown
---
workflow: work
task: <one line>
started: <YYYY-MM-DD>
status: clarified|planned|implementing|verified|complete
rejections: 0
---

## Intent

## Out of scope

## Success Criteria

| # | Criterion | Evidence |
|---|---|---|

## Plan

## Verify log
```

Use `.planning/REVIEW.md` for the human-review ledger. While status is not `complete`, also maintain
`.planning/ACTIVE_WORKFLOW.md`:

```markdown
---
workflow: work
phase: clarify|plan|implement|verify|review
state: .planning/WORK.md
---
```

Update `phase` at each transition. Remove the marker only after the REVIEW gate sets `status: complete`.

### Startup and legacy state

1. If `.planning/ACTIVE_WORKFLOW.md` names an active specialized workflow, resume that workflow. Do
   not fork state by starting `/work` beside it.
2. If an incomplete `.planning/WORK.md` exists, offer to resume it.
3. If only `.planning/MINI.md` exists, explain that it is legacy standalone-mini state and ask before
   converting it. Preserve the old file; copy its intent, exclusions, criteria, approved plan, verify
   log, status, and rejection count into `WORK.md` only after confirmation.
4. If both exist, `WORK.md` is canonical. Never merge automatically.

## 1. CLARIFY

Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md` and follow it before task reconnaissance. Supply
these generic axes: desired outcome, scope and exclusions, material constraints, and observable
completion evidence. Persist the answers and evidence-bearing criteria into `WORK.md` with
`status: clarified`.

**Gate:** `WORK.md` exists; Intent and Out of scope are explicit; every criterion has concrete Evidence
or an explicitly scheduled `TBD (<phase>)`.

## 2. PLAN

Read `${CLAUDE_SKILL_DIR}/beats/plan.md` and follow it. Use native Plan mode, get approval, then copy
the approved plan into `WORK.md` and set `status: planned`.

**Gate:** `ExitPlanMode` returned approved and the approved plan appears in `WORK.md`.

## 3. GOAL + WORK

Read `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md` for its implementation/verification doctrine,
then read `${CLAUDE_SKILL_DIR}/beats/goal-work.md` for this adapter's execution procedure.

**Gate:** exactly one `/goal` is confirmed active, names `.planning/WORK.md`, restates transcript-visible
evidence requirements, and has a turn budget. Set `status: implementing` before changing the target.

## 4. VERIFY

Read `${CLAUDE_SKILL_DIR}/beats/verify.md` and follow it. The verifier is never the doer.

**Gate:** `WORK.md` has a verify run dispatched after the last change with a bare `OVERALL: PASS` and
no unchecked criterion. Set `status: verified`, clear the implementation `/goal`, and advance to human
review outside the autonomous loop.

## 5. REVIEW

Read `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`, then
`${CLAUDE_SKILL_DIR}/beats/review-surface.md`. The shared primitive owns chat capture, dispositions,
ledger semantics, and rejection re-entry; the adapter supplies the review target and rendered surface.

**Gate:** every annotation and actionable chat item is dispositioned in `.planning/REVIEW.md`, no task
is pending or in progress, no `REJECT:` is outstanding, the final relaunch has no new annotations, and
any required durable rendered artifact is fresh. Then set `status: complete` and remove
`.planning/ACTIVE_WORKFLOW.md`.

## Escalation and rejection cap

- Same treatment over independent pinned items: offer an explicitly approved dynamic Workflow for
  that closed fan-out stage; `/work` keeps `/goal`, verification, and human review.
- At least five substantial files or eight implementation steps: dispatch scoped implementation
  subagents; keep mutations sequential unless genuine filesystem isolation exists.
- Round two and later: resume the original verifier.
- More than roughly ten plan steps or real sub-phases: move to the appropriate specialized workflow.
- Before handling `REJECT:`, read `rejections` from `WORK.md`. Clear the active goal, replace intent
  and criteria, increment the count, and re-enter CLARIFY. If it is already 1, stop and escalate or
  descope; two rejected interpretations require a real spec, not a third guess.
- If the turn budget expires without PASS, report the failing criteria, evidence, and attempted fixes;
  offer a new approach, criterion revision, or specialized workflow.

## Trust boundary

`/work` follows the shared `beat-implement` doctrine procedurally. It does **not** execute
`workflows/beat-implement.js`: that runner currently authenticates DS's immutable approved-plan
metadata. Do not generalize the runner, plan-persistence hooks, or reviewer-verdict boundary from this
skill. Inline work is the default; delegated work receives complete task-local instructions and is
verified independently afterward.

## Red flags — STOP

| About to | Do instead |
|---|---|
| Read or grep a task file before CLARIFY | Ask first; procedure files are the only exemption |
| Run `/work` for a trivial edit | Do it directly |
| Let the plan acquire a real spec or many sub-phases | Escalate to the specialized workflow |
| Treat implementer output as verification | Dispatch an independent verifier |
| Spawn a replacement verifier after a failure | Resume the same verifier |
| Patch work after `REJECT:` | Clear the goal and replace intent and criteria |
| Start a third interpretation after two rejections | Escalate or descope |
