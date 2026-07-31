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

After the approved native Plan interaction completes, retain its exact generated plan path and dispatch
one fresh reviewer session distinct from implementation. If that exact path is unavailable, STOP; never
list `.planning/`, choose the newest file, or infer a filename.

```text
Agent(
  subagent_type="workflows:plan-checker",
  allowed_tools=["Read", "Glob", "Grep", "Bash", "Write"],
  description="Review workflow-creator native plan",
  prompt="""
Workflow/domain: workflow-creator
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: <exact generated plan path returned by the completed native Plan interaction>
Inputs: <one or more concrete target workflow paths named by that plan>

Review the exact supplied generated plan; never discover or substitute another plan file. Load every common and workflow-creator constraint before reviewing. Write only the guarded complete-plan verdict if the dispatch contract and all required files are valid.
""")
```

Replace both angle-bracket placeholders with concrete paths before dispatch. Verify the two-entry
lifecycle, canonical output manifest, task-local mutation authority, deterministic compiler inputs,
independent verification, no-legacy policy, and human review surfaces.

Write only the guarded hook-owned `.planning/.state/review.json` finalization, preserving approval-owned
receipt fields and binding the exact generated basename/current bytes. `ISSUES_FOUND` returns to native
Plan mode for fresh approval. Never patch the generated plan.
