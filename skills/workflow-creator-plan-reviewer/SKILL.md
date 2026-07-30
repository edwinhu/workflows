---
name: workflow-creator-plan-reviewer
description: "Internal workflow-creator native-plan review gate after approval and before compilation or mutation."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/reviewer-verdict-guard.ts --workflow workflow-creator"
---

# Workflow Creator Native Plan Reviewer

After exact plan persistence, dispatch one fresh `Agent(subagent_type="workflows:plan-checker", ...)` session distinct from approval and implementation.

```text
Workflow/domain: workflow-creator
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: .planning/PLAN.md
Inputs: .planning/PLAN.meta.json and the target workflow files named by the plan
```

Load common plus workflow-creator constraints. Verify the two-entry lifecycle, canonical output manifest, task-local mutation authority, deterministic compiler inputs, independent verification, no-legacy policy, and human review surfaces.

Write only `.planning/PLAN_REVIEWED.md`. `ISSUES_FOUND` returns to native Plan mode for fresh approval. Never patch immutable plan artifacts.
