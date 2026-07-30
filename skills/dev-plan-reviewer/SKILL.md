---
name: dev-plan-reviewer
description: "Internal dev plan-review gate after design and before implementation."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Write
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/reviewer-verdict-guard.ts --workflow dev"
---

# Dev Plan Reviewer

<EXTREMELY-IMPORTANT>
**NO IMPLEMENTATION WITHOUT A REVIEWED PLAN.** User approval approves the approach; an independent reviewer verifies executable task detail. Skipping this gate makes omissions invisible to implementation workers.
</EXTREMELY-IMPORTANT>

After `dev-design` has written and the user has approved `.planning/PLAN.md`, dispatch one fresh reviewer for the complete current plan. The reviewer, not main chat, owns the only verdict write. Do not chunk into multiple verdict artifacts.

```text
Agent(
  subagent_type="workflows:plan-checker",
  allowed_tools=["Read", "Glob", "Grep", "Bash", "Write"],
  description="Review dev plan",
  prompt="""
Workflow/domain: dev
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: .planning/PLAN.md
Inputs: .planning/SPEC.md

Read every deterministically discovered common and dev constraint before reviewing. Read both supplied artifacts. Write only the guarded complete-plan verdict if the dispatch contract and all required files are valid.
""")
```

The concrete installed reference root is supplied in the dispatch prompt; the agent must not infer a default. The shared guard permits only `.planning/PLAN_REVIEWED.md` and validates its hash, session, path, timestamp, and exact four-field schema.

## Resolution

- **APPROVED:** immediately read `${CLAUDE_SKILL_DIR}/../../skills/dev-implement/SKILL.md` and begin implementation.
- **ISSUES_FOUND:** repair `.planning/PLAN.md`, obtain any required approval, and dispatch a fresh reviewer again. After five unresolved iterations, escalate the specific blockers to the user.

## Gate

1. **IDENTIFY:** PLAN and SPEC exist and the plan is approved.
2. **RUN:** dispatch the independent generic plan-checker.
3. **READ:** receive its complete-plan verdict.
4. **VERIFY:** resolve `ISSUES_FOUND` through replanning and a fresh review.
5. **CLAIM:** transition only on the reviewer-owned current-hash `APPROVED` verdict.
