---
name: dev-explore
description: "Internal read-only reconnaissance for dev planning."
user-invocable: false
disable-model-invocation: true
---

**Announce:** "I'm using dev-explore to map the relevant code and test path."

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-explore`

# Read-only reconnaissance

The opening dev clarification sentinel must authorize this session before any discovery. Do not
write planning artifacts. Do not design or implement.

Use targeted, parallel read-only exploration when it helps. Trace the actual entry point, data
flow, integration boundaries, relevant conventions, similar implementations, and the test
infrastructure. Read every key file selected from exploration; summaries are not a substitute.

Return these findings directly in the conversation:

1. **Key files** — 5–15 repo-relative `path:line` entries and their purpose.
2. **Current architecture and conventions** — dependencies and interfaces that constrain design.
3. **Real-test contract** — framework, runnable command, production protocol/transport, user
   action sequence, visible result, and test files/patterns to extend.
4. **Risks and ambiguities** — decisions that code cannot answer.

**Iron law: a test must do what the user does.** Testing an alternate HTTP path when production
uses WebSocket, or inspecting source/logs instead of exercising runtime behavior, is not evidence.
If no usable automated harness exists, identify setup as the first planned task and obtain the
user's decision; never treat absence of tests as a waiver.

When reconnaissance exposes uncertainties, immediately load `skills/dev-clarify/SKILL.md`. Do
not write `EXPLORATION.md`, update a spec, or create a handoff/ledger.
