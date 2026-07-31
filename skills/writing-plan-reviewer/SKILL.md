---
name: writing-plan-reviewer
description: "Internal writing native-plan review gate after approval and before drafting."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/reviewer-verdict-guard.ts --workflow writing"
---

# Writing Native Plan Reviewer

After the approved native Plan interaction completes, retain its exact generated plan path and dispatch
one fresh reviewer session distinct from implementation. If that exact path is unavailable, STOP; never
list `.planning/`, choose the newest file, or infer a filename.

```text
Agent(
  subagent_type="workflows:plan-checker",
  allowed_tools=["Read", "Glob", "Grep", "Bash", "Write"],
  description="Review writing native plan",
  prompt="""
Workflow/domain: writing
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: <exact generated plan path returned by the completed native Plan interaction>
Inputs: <one or more concrete source, reference, or output paths named by that plan>

Review the exact supplied generated plan; never discover or substitute another plan file. Write only the guarded complete-plan verdict if the dispatch contract and all required files are valid.
""")
```

Replace both angle-bracket placeholders with concrete paths before dispatch. The reviewer deterministically
loads common plus writing constraints, hashes the exact generated path before review and immediately before
finalization, and may replace only `.planning/.state/review.json`. It must reproduce `workflow`, `plan_file`,
`plan_hash`, `approved_session_id`, and `approved_at` unchanged, then set only `status`, its actual
`reviewer_session_id`, and strict `reviewed_at`.

- `APPROVED`: begin outlining and drafting in a third, distinct implementation session.
- `ISSUES_FOUND`: return to native Plan mode, create a new generated file, obtain fresh approval, then dispatch a fresh review.

Never patch generated plan bytes, write `PLAN_REVIEWED.md`, self-approve, or substitute automated document review for whole-plan review.
