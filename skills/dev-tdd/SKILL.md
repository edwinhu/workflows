---
name: dev-tdd
description: "Internal RED-GREEN-REFACTOR contract for authenticated /dev implementation tasks."
user-invocable: false
disable-model-invocation: true
---

# Test-driven development

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-tdd`

**NO IMPLEMENTATION BEFORE A GENUINE RED OBSERVATION.** A test that passes on its first run does not
prove the intended missing behavior was exercised.

## Per-task contract

Each current-plan implementation task supplies its stable task ID, `{planFile, planHash}`, intended
behavior, first failing test, expected RED reason, exact verify command, outputs, and writable paths.
The TaskList item and returned task result hold the live TDD evidence; never write `LEARNINGS.md`, a
fixed plan, progress file, or other visible planning ledger.

1. Write the smallest real test that exercises the production-relevant path named by the approved
   task. Unit-only or mock-only coverage cannot replace a required integration/E2E path.
2. Run the test before implementation and read the output. Accept RED only when it fails for the
   intended missing behavior—not a syntax error, broken fixture, unavailable dependency, or unrelated
   failure.
3. Return the exact RED command, exit status, and relevant failure excerpt on the TaskList item.
4. Implement the minimum behavior needed to satisfy the approved task. An architectural or test-contract
   change is an R4 stop requiring user decision and a replacement native plan.
5. Run the exact verify command to GREEN and read its output. Then run the broader relevant suite and
   required real/E2E test.
6. Return changed files, RED/GREEN evidence, broader-suite evidence, deviations, and blockers. The doer
   never grades the task; a fresh verifier decides PASS/FAIL.
7. Refactor only while all required tests remain green.

## Real-test and execution requirements

**The test must do what the user does.** Exercise the declared production protocol, transport, entry
point, and visible outcome. Source inspection, grep results, screenshots without runtime setup, and log
presence are not behavioral verification.

For processes or GUI/E2E systems, build and launch using the plan's declared procedure, wait for
readiness, check the process, read logs, verify logs contain no startup failure, and only then execute
the user-facing test or capture evidence. Store deliverable logs/screenshots only in normal project
paths named by the plan; transient command output may remain transient.

## Delete and restart

Implementation written before a valid RED observation is untrusted. Revert or delete that task-local
implementation, restore the pre-task state, write the failing test, observe the intended RED, and then
implement again. Do not manufacture RED by weakening assertions or breaking fixtures.
