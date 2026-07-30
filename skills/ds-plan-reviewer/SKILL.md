---
name: ds-plan-reviewer
description: "Internal DS native-plan review gate after approval and before implementation."
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

<EXTREMELY-IMPORTANT>
**NO IMPLEMENTATION WITHOUT AN INTACT, REVIEWED NATIVE PLAN.** The approved native plan is immutable. A vague or altered plan makes workers guess about data, evidence, and acceptance, which is anti-helpful.
</EXTREMELY-IMPORTANT>

After `ExitPlanMode` persists `.planning/PLAN.md` and `.planning/PLAN.meta.json`, dispatch one fresh reviewer in a session distinct from plan approval and later implementation. It reviews the complete plan once and owns the only durable verdict; main chat never substitutes its own review.

```text
Agent(
  subagent_type="workflows:plan-checker",
  allowed_tools=["Read", "Glob", "Grep", "Bash", "Write"],
  description="Review DS native plan",
  prompt="""
Workflow/domain: ds
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: .planning/PLAN.md
Inputs: .planning/PLAN.meta.json

Read every deterministically discovered common and ds constraint before reviewing. Verify native-plan integrity and approval-session separation before reviewing content. Write only the guarded complete-plan verdict if the dispatch contract and all required files are valid.
""")
```

The concrete installed reference root is supplied in the dispatch prompt; the agent must not infer a default. The shared guard remains authoritative: it permits only `.planning/PLAN_REVIEWED.md` and validates safe path, exact current hash, reviewer identity, strict four-field YAML, and UTC timestamp.

## Resolution

- **APPROVED:** transition directly to `${CLAUDE_SKILL_DIR}/../ds-implement/SKILL.md` in a genuinely distinct implementation session.
- **ISSUES_FOUND or integrity failure:** return to native Plan mode, revise and obtain fresh approval through `ExitPlanMode`, let persistence replace PLAN and metadata, then dispatch a fresh reviewer. Never patch the immutable plan, create a custom task table, or use a parallel state file.

## Gate

1. **IDENTIFY:** PLAN and approval metadata exist.
2. **RUN:** dispatch the independent generic plan-checker.
3. **READ:** receive its complete-plan verdict.
4. **VERIFY:** resolve defects only through native Plan reapproval and a fresh review.
5. **CLAIM:** transition only on the reviewer-owned current-hash `APPROVED` verdict.
