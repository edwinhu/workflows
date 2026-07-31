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

After the approved native Plan interaction completes, retain the hook-authenticated generated plan path and its receipt-selected `{planFile, planHash}`. Dispatch one fresh reviewer in a session distinct from later implementation. It reviews that complete plan once and finalizes the only durable review state; main chat never substitutes its own review.

If that authenticated path is unavailable, STOP. Do not list `.planning/`, choose the newest file, inspect the hidden receipt to invent a path, or infer a filename.

```text
Agent(
  subagent_type="workflows:plan-checker",
  allowed_tools=["Read", "Glob", "Grep", "Bash", "Write"],
  description="Review DS native plan",
  prompt="""
Workflow/domain: ds
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: <exact generated plan path returned by the completed native Plan interaction>
Inputs: <one or more concrete project input or evidence paths named by that plan>

Read every deterministically discovered common and ds constraint before reviewing. Review the exact supplied generated plan; never discover or substitute another plan file. Write only the guarded complete-plan verdict if the dispatch contract and all required files are valid.
""")
```

Replace both angle-bracket placeholders with concrete paths before dispatch. The concrete installed reference root is supplied in the prompt; the agent must not infer a default. The shared guard remains authoritative: it permits only hook-owned `.planning/.state/review.json` finalization and validates the receipt-selected basename/current bytes, preserved approval fields, reviewer identity, and strict UTC timestamp.

## Resolution

- **APPROVED:** transition directly to `${CLAUDE_SKILL_DIR}/../ds-implement/SKILL.md` in a genuinely distinct implementation session.
- **ISSUES_FOUND or integrity failure:** return to native Plan mode, revise and obtain fresh approval through `ExitPlanMode`, let persistence bind a replacement generated plan and reset its receipt, then dispatch a fresh reviewer. Never patch the immutable plan, create a custom task table, or use a parallel state file.

## Gate

1. **IDENTIFY:** the hook-owned receipt selects an authenticated generated plan.
2. **RUN:** dispatch the independent generic plan-checker.
3. **READ:** receive its receipt-finalized complete-plan outcome.
4. **VERIFY:** resolve defects only through native Plan reapproval and a fresh review.
5. **CLAIM:** transition only on the reviewer-owned receipt state for the current plan hash.
