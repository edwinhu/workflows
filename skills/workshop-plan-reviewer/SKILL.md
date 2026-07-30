---
name: workshop-plan-reviewer
description: "Internal workshop native-plan review gate after approval and before slide generation."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/reviewer-verdict-guard.ts --workflow workshop"
---

# Workshop Native Plan Reviewer

After `ExitPlanMode` persists `.planning/PLAN.md` and `.planning/PLAN.meta.json`, dispatch a fresh
`workflows:plan-checker` session distinct from approval and implementation:

```text
Workflow/domain: workshop
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: .planning/PLAN.md
Inputs: .planning/PLAN.meta.json, .planning/SOURCES.md, .planning/OUTLINE.md
```

The reviewer loads common plus workshop constraints and writes only the guarded current-hash
`.planning/PLAN_REVIEWED.md` verdict. Issues return to native Plan mode for fresh approval; never patch
immutable `PLAN.md` or substitute slide verification for plan review.
