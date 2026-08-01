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

After the approved native Plan interaction completes, retain its exact generated plan path and dispatch
the reviewer as a fresh subagent, a distinct actor from this conversation and from implementation. If that exact path is unavailable, STOP; never
list `.planning/`, choose the newest file, or infer a filename. Implementation must then be carried out by actors distinct from BOTH the reviewer and
this approving conversation: dispatching is not implementing, so this conversation may delegate
the work but may never perform it itself.

```text
Agent(
  subagent_type="workflows:plan-checker",
  allowed_tools=["Read", "Glob", "Grep", "Bash", "Write"],
  description="Review workshop native plan",
  # Plan review is a blocking gate: this conversation cannot proceed without the verdict.
  # Agent defaults to background, and a backgrounded reviewer returns a completion
  # NOTIFICATION, not a verdict — the dispatcher then idles waiting for one. Dispatch synchronously.
  run_in_background=false,
  prompt="""
Workflow/domain: workshop
Reference root: ${CLAUDE_SKILL_DIR}/../../references
Plan: <exact generated plan path returned by the completed native Plan interaction>
Inputs: <one or more concrete paper, source, theme, or output paths named by that plan>

Review the exact supplied generated plan; never discover or substitute another plan file. Write only the guarded complete-plan verdict if the dispatch contract and all required files are valid.
""")
```

Replace both angle-bracket placeholders with concrete paths before dispatch. The reviewer loads common
plus workshop constraints and updates only the guarded receipt state at `.planning/.state/review.json`,
bound to the exact generated basename, path, and current bytes. Issues return to native Plan mode for a
replacement approval; never patch the authenticated plan or substitute slide verification for plan review.
