---
name: dev-plan-reviewer
description: "Internal dev native-plan review gate after approval and before implementation."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/reviewer-verdict-guard.ts --workflow dev"
---

# Dev Native Plan Reviewer

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-plan-reviewer`

**NO IMPLEMENTATION WITHOUT AN INTACT, REVIEWED NATIVE PLAN.** The user-approved generated plan
is immutable intent; task detail must be independently checked before workers execute it.

Retain the exact generated plan path and authenticated `{planFile, planHash}` returned by the
completed native Plan interaction. Dispatch the reviewer as a fresh subagent: the dispatched agent
is a distinct actor from this conversation, and the later implementers must in turn be actors
distinct from it. If that path is unavailable, stop: never list `.planning/`, glob plans, inspect a
receipt to invent a path, use a fixed `PLAN.md`, or choose a recent file.

### What the separation actually buys — do not overstate it

**PROVES.** Under an APPROVED, hash-matched receipt, the actor performing a gated mutation is a
different hook actor from the recorded approver and the recorded reviewer: three distinct
`(session_id, agent_id)` tuples observed on the tool calls themselves.

**DOES NOT PROVE.** That the implementer is not a *descendant* of the approver — in
single-conversation `/dev` it always is. Nor independence of judgment: approver, reviewer, and
implementer are the same model, in the same repository, reading the same plan, which
`hooks/subagent-start.ts` injects into the subagent. Nor anything about Bash-based mutation beyond
what `hooks/_bash_mutation.ts`'s denylist catches — writes performed inside an opaque executable
(`make`, `cargo build`, `./scripts/build.sh`) are admitted by design.

`approver != implementer` is a separation-of-actors control that raises the cost of self-approval.
It is not evidence of independent review in the sense a human reviewer would mean. Full statement:
the header of `workflows/lib/approved-artifact.ts`.

```text
Agent(
  subagent_type="workflows:plan-checker",
  allowed_tools=["Read", "Glob", "Grep", "Bash", "Write"],
  description="Review dev native plan",
  # Plan review is a blocking gate: this conversation cannot proceed without the verdict.
  # Agent defaults to background, and a backgrounded reviewer returns a completion
  # NOTIFICATION, not a verdict — the dispatcher then idles waiting for one. Dispatch synchronously.
  run_in_background=false,
  prompt="""
Workflow/domain: dev
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: <exact generated plan path returned by the completed native Plan interaction>
Inputs: <concrete project paths examined during reconnaissance and named by this plan>

Read every deterministically discovered common and dev constraint before reviewing. Validate the
complete dev grammar: all eight required sections, REQ-NN IDs, TASK-NN task blocks, acyclic
dependencies, TaskContract fields, RED/real-test commands, requirement-to-test coverage, evidence,
and review surfaces. Review only the exact supplied generated plan. Rehash immediately before
finalization. Write only the guarded complete-plan hidden receipt if all dispatch, integrity, and
review requirements are valid.
""")
```

Replace both angle-bracket placeholders with concrete paths before dispatch. The reviewer may
write only `.planning/.state/review.json`; it preserves the approval fields and finalizes one
`APPROVED` or `ISSUES_FOUND` outcome. It never patches, copies, renames, or creates a visible
verdict for the plan.

## Resolution

- **APPROVED:** transition to `skills/dev-implement/SKILL.md` using the current exact
  `{planFile, planHash}`, dispatching implementers as subagents distinct from BOTH the reviewer
  and the approving conversation. Dispatching is not implementing: this conversation approved the
  plan and may delegate the work, but it may never perform that work itself.
- **ISSUES_FOUND or integrity failure:** return to native Plan mode, create a replacement plan,
  obtain fresh `ExitPlanMode` approval, and dispatch a fresh review. Do not patch approved bytes.

## Gate

1. **IDENTIFY:** hook-owned receipt selects the authenticated exact generated plan.
2. **RUN:** dispatch the independent generic checker.
3. **READ:** consume its hidden receipt outcome.
4. **VERIFY:** resolve defects solely through native replanning and fresh review.
5. **CLAIM:** admit implementation only on the current-hash reviewer receipt.
