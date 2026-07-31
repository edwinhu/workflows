---
name: dev-design
description: "Internal architecture decision and native dev-plan authoring."
user-invocable: false
disable-model-invocation: true
---

**Announce:** "I'm using dev-design to present architecture choices before creating the native plan."

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-design`

# Architecture choice and native plan

Use the conversational clarification and reconnaissance results; do not read or revive historical
`.planning/PLAN.md`, `SPEC.md`, reviews, progress files, or handoffs.

## Architecture gate

Present 2–3 feasible approaches, including a recommendation. For each, name the affected
boundaries/files, compatibility and testing implications, implementation cost, and trade-offs.
Obtain the user's explicit choice before entering Plan mode. A sole viable option still needs its
trade-off explained and explicit acceptance.

## Native Plan mode

Enter native Plan mode and generate exactly one executable Markdown plan. `ExitPlanMode` returns
its path; save that exact path and its returned identity for review and implementation. Do not
write a fixed `.planning/PLAN.md`, copy plan bytes, or create a visible approval marker.

The generated plan must contain these exact sections:

```markdown
## Intent and Scope
## Requirements
## Chosen Architecture
## Testing Strategy and Real-Test Contract
## Implementation Tasks
## Requirement → Test Map
## Evidence Plan
## Review Surfaces
```

### Required grammar

- `## Requirements` assigns every in-scope behavioral requirement a stable `REQ-NN` identifier;
  it states exclusions separately.
- `## Chosen Architecture` records the selected option, rationale, boundaries, interfaces, and
  accepted trade-offs.
- `## Testing Strategy and Real-Test Contract` records the exact framework and commands, user
  workflow, production protocol/transport, observable outcome, first failing test and expected
  RED, plus the full-suite/E2E contract where applicable.
- `## Implementation Tasks` has one stable `TASK-NN` block per execution task. Each block must
  include **Dependencies**, **Work**, **Criteria**, **Outputs**, **Writable paths**,
  **First failing test / RED expectation**, **Verify command**, **Instruction files**, **Model**,
  and **Effort**. `Outputs` and `Writable paths` are nonempty concrete repo-relative paths;
  instruction files are absolute paths. Dependencies name `TASK-NN` IDs and form an acyclic DAG.
  The work, criteria, outputs, writable paths, instruction files, model, and effort compile
  directly to the shared `TaskContract` fields. Work requires RED before implementation and
  GREEN through the exact verify command.
- `## Requirement → Test Map` maps every `REQ-NN` to one or more `TASK-NN`, named tests, and
  evidence commands. No requirement can be prose-only or untested.
- `## Evidence Plan` defines command/runtime artifacts for every requirement and task.
- `## Review Surfaces` names security, correctness, regression, API/UI, and other independently
  reviewable surfaces relevant to the change.

**Iron law: no implementation without a native approved plan.** The generated plan bytes are
immutable after `ExitPlanMode`: changes to requirements, architecture, dependencies, real-test
contract, or evidence require a newly generated plan and receipt rollover.

After native approval, load `skills/dev-plan-reviewer/SKILL.md`; dispatch review with the exact
path returned by Plan mode, never a globbed or inferred plan.
