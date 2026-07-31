---
name: writing-revise
version: 1.0
description: "Use when revising PLAN-bound writing drafts, fixing independent review findings, or completing the writing correction loop."
hooks:
  PreToolUse:
    - matcher: "Edit|Write|Bash|Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow writing"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow writing"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-suggest-verify.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-claim-id-guard.ts"
---

# Writing Revise

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts writing-revise`

Apply targeted fixes from current-hash TaskList review findings, then obtain fresh independent re-review. Revise domain outputs without mutating stable PLAN structure.

## Iron Laws

- **NO REVISION WITHOUT AN OPEN, EVIDENCE-GROUNDED REVIEW FINDING.**
- **NO FIXED CLAIM WITHOUT FRESH INDEPENDENT RE-REVIEW.**
- **NO STRUCTURAL REVISION UNDER THE OLD PLAN HASH.**
- **NO COMPLETION WHILE CRITICAL OR MAJOR FINDINGS REMAIN.**

## Inputs

1. Authenticate the exact generated `plan_file` and `plan_hash` selected by the current approved combined receipt; the compiler exposes them as index `planFile` and `planHash`.
2. Compile the deterministic section index and require its `planFile` and `planHash` to match TaskList findings.
3. Load the domain skill, `workflows:ai-anti-patterns`, affected detailed outlines, drafts, and Source Plan context.
4. Select open TaskList findings in severity order. Do not infer findings from a retired review ledger.

## Structural Boundary

The following require a replacement native plan, fresh approval, and fresh independent whole-plan review:

- thesis or scope changes;
- adding, removing, renaming, or reordering a section;
- adding/removing claims or moving a claim's primary section;
- changing bibliography/notebook configuration or key-source commitments;
- changing Section Outputs paths or dependencies;
- changing Review Surfaces.

Stop and return to writing setup/native Plan mode. Do not edit the immutable PLAN. Existing current-hash execution and review items become `completed` with `disposition: superseded` and `superseded_by_plan_hash` when the replacement plan is approved.

## Tactical Revision Loop

For nonstructural findings, dispatch an authorized implementation agent with exclusive write authority over the exact affected `drafts/`, `outlines/`, or `references/` paths. The orchestrator remains read-only and updates TaskList only from returned evidence.

Each delegated revision task must:

1. Read the cited draft passage and exact finding evidence.
2. Apply the smallest targeted fix to its authorized paths.
3. Re-read the edited passage and adjacent boundaries.
4. Run the PLAN-based deterministic gate probe and source verification.
5. Run the mandatory `workflows:de-ai-revise` pass on edited drafts without chasing a score.
6. Reinvoke independent writing review for affected sections, passing prior reviews only when the plan hash is unchanged.
7. Update the TaskList finding disposition only from the fresh review result.

Retries remain bound to the same `planHash`, section, finding identity, and candidate fingerprint. A replacement plan cannot reuse them.

## Iteration Gate

- **COMPLETE:** zero critical and major current-hash findings, no unreliable reviewer, source verification clean, and every PLAN Review Surface inspected. Residual minors are advisory.
- **CONTINUE:** blocking findings remain and fewer than three review-revise rounds have run. Start the next round immediately.
- **ESCALATE:** blocking findings remain after three rounds, or the reviewer identifies a structural change. Present the evidence and options to the user.

Round counters and dispositions belong in TaskList or narrow hidden machine state, never in a Markdown planning ledger.

## Completion

Return the final evidence and human review surfaces directly. Preserve PLAN, hidden authentication state, TaskList history, detailed outlines, drafts, and references in their assigned roles. Do not archive or move a visible workflow marker because new canonical episodes do not create one.
