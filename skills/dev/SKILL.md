---
name: dev
description: "Use for feature development and engineering changes."
allowed-tools: Read, Grep, Glob, Bash, Skill, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Workflow, TaskCreate, TaskUpdate, TaskList, TaskGet
hooks:
  PreToolUse:
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow dev"
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
  PostToolUse:
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow dev"
---

**Announce:** "I'm using dev to clarify the outcome before I inspect the codebase."

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev`

# Dev planning entry

## Opening clarification sentinel

Before reconnaissance, create the narrow session-bound sentinel exactly as required by
`clarify-before-recon-guard.ts`:

```json
{"status":"pending","sessionId":"[current session]"}
```

at `.planning/DEV_CLARIFIED.json`. Ask the user, conversationally and before reading project
files, about the outcome, exclusions, constraints, acceptance evidence, automated real-test
strategy, intended first failing test, user workflow, protocol/transport, and review surfaces.
After the user answers, replace it exactly with:

```json
{"status":"clarified","sessionId":"[current session]"}
```

The sentinel proves only current-session clarification. It is not a specification or planning
authority. Never create `SPEC.md`, `SPEC_REVIEWED.md`, `EXPLORATION.md`, `ACTIVE_WORKFLOW.md`,
`STATE.md`, `LEARNINGS.md`, `BACKLOG.md`, or `HANDOFF.md`.

**Iron law: ask before reconnaissance.** Code explains how the current system works, not what
the user wants. A manual-only test proposal is a blocker: resolve an automated test approach or
leave this workflow rather than silently waive TDD.

## Flow

```text
opening clarification → read-only reconnaissance → post-recon clarification
→ architecture options + user choice → native Plan mode → exact-path review
```

1. Read `skills/dev-explore/SKILL.md`; return its findings directly to the user.
2. Read `skills/dev-clarify/SKILL.md`; resolve ambiguities exposed by reconnaissance.
3. Read `skills/dev-design/SKILL.md`; present alternatives and obtain the architecture choice.
4. Enter native Plan mode. The generated plan returned by `ExitPlanMode` is the sole plan and
   exact-byte approval boundary. Do not copy, rename, or replace it.
5. Read `skills/dev-plan-reviewer/SKILL.md` and dispatch the independent whole-plan review for
   that exact generated path. Only its hidden receipt can admit implementation.

A prior fixed dev plan or visible ledger is conversion-only provenance. Do not resume it. If the
user needs changed requirements, architecture, task dependencies, test contract, or evidence,
create a new native generated plan and obtain a new receipt.
