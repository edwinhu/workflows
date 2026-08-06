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

```text
CLARIFY → PLAN → IMPLEMENT → VERIFY → REVIEW
```

## Write surface: main chat does not do the work

**You may Write/Edit only under `.planning/` and `.claude/`. Every other file — source, tests,
config — is written by a dispatched agent.** `orchestrator-mutation-guard` is registered in this
skill's frontmatter, so the attempt is REFUSED, not corrected: a write you try anyway costs a turn
and produces nothing. Reach for `Agent` first, not after a denial.

Two narrow exceptions: the generated plan while you are IN Plan mode, and `.claude-workflows.json`
when adopting governance.

## 1. CLARIFY

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

Nothing is written after the user answers. The recorded phase IS the evidence, and it is
evidence precisely because a hook observed the tool call rather than reading the model's account of
it. Never create `SPEC.md`, `SPEC_REVIEWED.md`, `EXPLORATION.md`, `ACTIVE_WORKFLOW.md`,
`STATE.md`, `LEARNINGS.md`, `BACKLOG.md`, or `HANDOFF.md`.

**Iron law: ask before reconnaissance.** Code explains how the current system works, not what
the user wants. A manual-only test proposal is a blocker: resolve an automated test approach or
leave this workflow rather than silently waive TDD.

Then reconnoitre and resolve what only the codebase can surface:

1. Read `${CLAUDE_SKILL_DIR}/../dev-explore/SKILL.md`; return its findings directly to the user.
2. Read `${CLAUDE_SKILL_DIR}/../dev-clarify/SKILL.md`; resolve ambiguities exposed by reconnaissance.

**Gate:** the pre-reconnaissance `AskUserQuestion` phase is recorded in `.planning/.state/episode.json`,
every criterion names its own evidence, an automated test approach exists, and post-recon ambiguities
are resolved.

## 2. PLAN

Read `${CLAUDE_SKILL_DIR}/../beat-plan/SKILL.md`, then:

1. Read `${CLAUDE_SKILL_DIR}/../dev-design/SKILL.md`; present alternatives and obtain the architecture choice.
2. Enter native Plan mode. The generated plan returned by `ExitPlanMode` is the sole plan and
   exact-byte approval boundary. Do not copy, rename, or replace it.
3. Read `${CLAUDE_SKILL_DIR}/../dev-plan-reviewer/SKILL.md` and dispatch the independent whole-plan
   review for that exact generated path. Only its hidden receipt can admit implementation.

**Gate:** the receipt-selected `planFile` and `planHash` are `APPROVED` for workflow `dev` by a
reviewer session distinct from the approving session.

## 3. IMPLEMENT

Read `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md`, then `${CLAUDE_SKILL_DIR}/../dev-implement/SKILL.md`.

**Gate:** TaskList holds the complete current-plan task set, each implemented task records its
first failing test and the change that made it pass, and no task ran without the beat's preflight.

## 4. VERIFY

Read `${CLAUDE_SKILL_DIR}/../beat-verify/SKILL.md`, then `${CLAUDE_SKILL_DIR}/../dev-verify/SKILL.md`.
The verifier is never the implementer.

**Gate:** every current-plan task has a post-change independent verification round recorded in
TaskList and every acceptance criterion passes on its named evidence.

## 5. REVIEW

Read `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`, then `${CLAUDE_SKILL_DIR}/../dev-accept/SKILL.md`.
Automated PASS is not a person's acceptance.

**Gate:** TaskList has no open current-plan implementation, verification, or review item; the final
review relaunch has no new annotations; and no `REJECT:` remains.

## Resume and compatibility

A prior fixed dev plan or visible ledger is conversion-only provenance. Do not resume it. If the
user needs changed requirements, architecture, task dependencies, test contract, or evidence,
create a new native generated plan and obtain a new receipt.
