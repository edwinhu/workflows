# PLAN — work adapter

Read `${CLAUDE_SKILL_DIR}/../beat-plan/SKILL.md` and follow it: receipt binding, the whole-plan review
boundary, the approval/review session separation, and the fan-out check are shared and are not restated
here. This adapter supplies the two things that are work's own — the plan grammar, and the ceiling.

Keep the plan proportional. If it grows beyond roughly ten steps, needs real sub-phases, or wants a
domain-specific specification, stop and route to the appropriate workflow.

## Required work PLAN schema

Every work plan contains these exact top-level sections exactly once:

```markdown
## Intent

## Exclusions

## Success Criteria

## Implementation Plan

## Evidence Plan

## Review Surfaces
```

- **Intent** states the desired outcome and material constraints.
- **Exclusions** names what this episode will not change or decide.
- **Success Criteria** gives each criterion a stable identifier and observable outcome.
- **Implementation Plan** gives every actionable task a stable task ID and complete runner fields:
  task name, concrete work, criteria, outputs, writable paths, dependencies, required instruction files,
  model, and effort. Dependencies use stable task IDs, not prose ordering.
- **Evidence Plan** maps every criterion and task to executable evidence or an explicitly human judgment.
- **Review Surfaces** names each diff, rendered artifact, output, or decision the user must inspect.

Missing task authority is a planning failure. Do not infer outputs, writable paths, or criteria later to
make a task dispatchable.

## Red flags

| About to | Do instead |
|---|---|
| Let the plan become a fifteen-step mini-project | Escalate to `/dev`, `/ds`, `/writing`, or another specialized workflow |
| Enter implementation on a generated plan missing one of the six sections | Replace the plan through native Plan mode and fresh whole-plan review |
