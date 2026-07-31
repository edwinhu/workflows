---
name: dev-spec-reviewer
description: "Retired internal dev spec-review doctrine; do not invoke."
user-invocable: false
disable-model-invocation: true
---

# Retired: dev spec reviewer

`/dev` no longer writes or reviews `.planning/SPEC.md`, `SPEC_REVIEWED.md`, or a fixed planning
state. Do not invoke this skill, create a spec verdict, or use it as a gate to reconnaissance.

Its useful checks now belong to the active workflow:

- opening and post-reconnaissance clarification establish outcome, exclusions, edge cases,
  automated testing, real user workflow, protocol/transport, RED expectation, evidence, and
  review surfaces;
- the independent native whole-plan reviewer validates complete `REQ-NN` requirement coverage,
  `TASK-NN` traceability, TaskContract grammar, real-test contract, evidence plan, and review
  surfaces against the exact generated plan.

A fixed legacy dev plan/spec is conversion-only provenance. Create a fresh native plan instead.
