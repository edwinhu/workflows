---
name: ds-plan-reviewer
description: "Internal DS plan-review gate. Use after /ds exits native Plan mode and the plan-persistence hook has copied the approved plan to .planning/PLAN.md."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/reviewer-verdict-guard.ts --workflow ds"
---

# Data-Science Native Plan Reviewer

Review the immutable native plan before `/ds-implement` starts. The user approves the approach when
native Plan mode exits; this review checks whether the approved plan is executable for data work. It
never alters the copy, creates a parallel state file, or substitutes a custom plan format.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Plan Review

**NO IMPLEMENTATION WITHOUT AN INTACT, REVIEWED NATIVE PLAN. This is not negotiable.**

An immutable plan that is missing, modified, or too vague to execute is not a small documentation
problem. It makes workers guess about source grain, evidence, and data quality — precisely the
rework this workflow is meant to prevent. Starting anyway is anti-helpful.
</EXTREMELY-IMPORTANT>

## Inputs and authority

| Input | Use |
|---|---|
| `.planning/PLAN.md` | Exact approved native-plan copy; immutable authority for intent and tasks. |
| `.planning/PLAN.meta.json` | Approval identity and integrity hash for the exact `PLAN.md` bytes. |
| `TaskList` | Live work status only; never infer it from the plan. |
| Project auto-memory | Reusable, durable facts only; not a plan or a progress log. |

## Dispatch an independent reviewer

`/ds` dispatches one fresh `general-purpose` reviewer after `ExitPlanMode` and gives it only this
skill, the immutable plan, and read-only project inspection tools. The reviewer must not have a
planning or implementation transcript **and must run in a different Claude session from the plan
approval and later implementation**. It may use `Bash` only to compute the plan-body SHA-256; it must
not run mutating commands. It may write only the durable verdict artifact.

The orchestrator reads the verdict but never substitutes its own review. Dispatch one reviewer for the
complete current plan so its one hash-bound durable verdict covers every task; do not split a review
into artifacts the runner cannot verify as one current approval.

## Procedure

1. **Read `.planning/PLAN.md` and `.planning/PLAN.meta.json`.** `PLAN.md` must be the exact native
   approval body, with no generated frontmatter. Hash those exact bytes with SHA-256 and compare them
   to `PLAN.meta.json`:

   ```json
   {
     "planHash": "<64 lowercase hexadecimal characters matching exact PLAN.md bytes>",
     "approvedSession": "<non-empty>",
     "approvedAt": "<strict UTC ISO-8601 timestamp ending in .sssZ>"
   }
   ```

   A missing, malformed, or mismatched integrity value is blocking. Do not alter either artifact.
2. **Read the approved plan content.** Check it is concrete enough to create or reconcile native
   tasks: goal, source/data-access approach, analysis scope and exclusions, ordered work, expected
   outputs, and evidence for completion.
3. **Apply DS judgment.** Flag material omissions when relevant to the stated analysis:
   - source location/access and expected grain or unit of observation;
   - profiling before cleaning, joining, modeling, or claims from the data;
   - nulls, duplicates, type drift, coverage, and join-key checks;
   - reproducibility (environment, seed, snapshots/versioning) where results depend on them;
   - an explicit strategy for large or multi-source work, including source-side filtering and safe
     incremental scale-up;
   - a named configuration location and rationale for analytic thresholds or sample filters;
   - a canonical dataset/grain when multiple outputs must share a sample;
   - outputs with concrete evidence, not merely "analyze" or "validate";
   - a **Review Surfaces** section naming the actual tables, figures, exports, diagnostics, or
     decisions the user will inspect. Missing review surfaces is blocking, because `ds-review`
     cannot manufacture the user's acceptance contract after implementation.
4. **Write one durable verdict.** After completing the independent review, write only
   `.planning/PLAN_REVIEWED.md` (the scoped read-only guard permits no other mutation). It must be
   bound to the exact hash and include the actual review:

   ```markdown
   ---
   plan_hash: <PLAN.meta.json planHash>
   status: APPROVED | ISSUES_FOUND
   reviewer_session_id: ${CLAUDE_SESSION_ID}
   reviewed_at: <strict UTC ISO-8601 timestamp ending in Z>
   ---

   ## DS Native Plan Review
   ...actual integrity evidence, blocking issues, and advisory suggestions...
   ```

   Set `reviewer_session_id` to the actual `${CLAUDE_SESSION_ID}` and reject the review if it equals
   `PLAN.meta.json.approvedSession`. `reviewed_at` must be a strict UTC timestamp ending in `Z`. Never
   edit the plan or write any other state file. `ISSUES_FOUND` is a durable failed verdict, not
   permission to implement.

   This is a fail-closed workflow gate, not cryptographic provenance: the platform supplies session
   IDs, and the runner rejects missing, equal, malformed, or stale identity records rather than
   treating a local file alone as proof of reviewer identity.

### Review output

```markdown
## DS Native Plan Review

**Status:** APPROVED | ISSUES_FOUND

**Integrity:** PASS | FAIL — [evidence]

**Blocking issues:**
- [plan section or task]: [specific missing/inconsistent item and implementation consequence]

**Advisory suggestions:**
- [optional improvement]
```

## Resolution

- **APPROVED:** `/ds-implement` may run only from a genuinely different implementation session; the
  runner fail-closes on distinct session IDs. This is workflow provenance checking, not cryptographic
  attestation.
- **ISSUES_FOUND or integrity FAIL:** Return to **native Plan mode**. Revise the plan there, obtain
  user approval through `ExitPlanMode`, let the persistence hook atomically replace `PLAN.md` and
  `PLAN.meta.json` (which stales the review record), and run this reviewer again. Do not patch
  `.planning/PLAN.md` or create `SPEC.md`, a compiler, or a custom task table.

## Gate

1. **IDENTIFY:** `.planning/PLAN.md` and `.planning/PLAN.meta.json` exist.
2. **RUN:** Hash the exact `PLAN.md` bytes with SHA-256 and compare them to `planHash`; validate strict UTC-Z metadata and that this reviewer session differs from `approvedSession`.
3. **READ:** Inspect the actual approved content against the DS checks above.
4. **VERIFY:** Write `PLAN_REVIEWED.md` with exactly `plan_hash`, `status`, `reviewed_at`, and `reviewer_session_id`; it states `APPROVED`, the same exact `plan_hash`, strict UTC-Z `reviewed_at`, and the actual nonempty `${CLAUDE_SESSION_ID}`.
5. **CLAIM:** Only then hand the immutable plan to `/ds-implement` in another genuinely distinct session.

## Red flags

| About to | Stop because | Do instead |
|---|---|---|
| Edit `PLAN.md` to address an issue | That destroys the approved native-plan record | Return to Plan mode and obtain a new approved copy |
| Treat plan checkboxes as live progress | The plan is immutable; this fabricates state | Read `TaskList` |
| Write anything besides the one hash-bound `PLAN_REVIEWED.md` verdict | Review must be durable without recreating a workflow runtime | Write only the verdict artifact permitted by the guard |
| Require a custom DS task table or `SPEC.md` | Native Plan mode owns plan structure and intent | Review the native plan's actual content |
