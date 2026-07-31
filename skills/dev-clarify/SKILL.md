---
name: dev-clarify
description: "Internal conversational clarification after dev reconnaissance."
user-invocable: false
disable-model-invocation: true
---

**Announce:** "I'm using dev-clarify to resolve the decisions the codebase cannot answer."

# Post-reconnaissance clarification

Use the returned reconnaissance findings to ask only questions that remain material: behavior at
integration boundaries, scope exclusions, ambiguous edge cases, compatibility, failure behavior,
real-test workflow and protocol, the first meaningful RED expectation, acceptance evidence, and
review surfaces. Batch independent questions; ask a dependency-blocking question first when its
answer changes the remaining questions.

Explain relevant code alternatives and trade-offs without selecting architecture yet. Do not infer
product behavior from existing patterns. Return the user decisions directly in the conversation;
do not write or update `SPEC.md`, `LEARNINGS.md`, or another planning artifact.

Before design, confirm all of the following are concrete:

- stable outcome and exclusions;
- automated test framework and exact command, or an approved test-infrastructure task;
- user workflow, production protocol/transport, and observable result that the real test must
  exercise;
- first test that should fail for the intended missing behavior and what RED looks like;
- required runtime evidence and independent review surfaces.

**Iron law: ask before designing.** A test that skips the real user path creates false confidence,
so resolve mismatches now rather than recording a manual-testing exception.

Then load `skills/dev-design/SKILL.md`.
