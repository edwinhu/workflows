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
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
  PostToolUse:
    - matcher: "AskUserQuestion"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/episode-phase.ts --workflow dev"
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow dev"
---

**Announce:** "I'm using dev to clarify the outcome before I inspect the codebase."

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev`

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/ensure-plans-directory.ts ${CLAUDE_SESSION_ID}`

# Dev planning entry

## Opening clarification sentinel

**Write no sentinel.** `.planning/DEV_CLARIFIED.json` is retired: a hook now records the clarify
phase into `.planning/.state/episode.json` when it OBSERVES your `AskUserQuestion` call. That is
direct evidence the user was asked. The sentinel was the model writing `{"status":"clarified"}` about
itself, which is an assertion, not a proof — and it could be written without ever asking.

Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md` and follow it. **The beat owns the procedure** —
one `AskUserQuestion` call, done-ness always established, every criterion naming its own evidence,
and the ask-before-you-look Iron Law the recorded phase now proves. `/dev` supplies only the domain
question axes, which is exactly the split the beat defines:

> outcome, exclusions, constraints, acceptance evidence, automated real-test strategy, intended
> first failing test, user workflow, protocol/transport, and review surfaces.

This step is `/dev`'s **pre-reconnaissance** clarification and is distinct from `dev-clarify`, which
runs *after* reconnaissance to resolve what only the codebase can surface. The two are a sequence,
not duplicates — asking everything up front cannot work, because the questions reconnaissance raises
do not exist yet, and asking everything afterwards lets existing shapes anchor the framing. That
distinction was previously implicit, which is how this pre-recon step ended up hand-rolled: the guard
enforced that it happened while nothing defined what it was.

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
opening clarification (beat-clarify) → read-only reconnaissance → post-recon clarification (dev-clarify)
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
