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

After `ExitPlanMode` persists `.planning/PLAN.md` and `.planning/PLAN.meta.json`, dispatch one fresh
`workflows:plan-checker` session distinct from approval and implementation:

```text
Workflow/domain: writing
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: .planning/PLAN.md
Inputs: .planning/PLAN.meta.json, .planning/PRECIS.md, .planning/OUTLINE.md, outlines/
```

The reviewer deterministically loads common plus writing constraints and writes only the guarded
`.planning/PLAN_REVIEWED.md` verdict.

- `APPROVED`: begin drafting in a distinct implementation session.
- `ISSUES_FOUND`: return to native Plan mode, obtain fresh approval, then dispatch a fresh review.

Never patch immutable `PLAN.md`, self-approve, or substitute automated document review for plan review.
