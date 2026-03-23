# Dev Workflow: Common Constraints

Shared enforcement for all dev-family skills. Every dev skill that touches implementation, testing, or verification MUST Read() this file.

**Skills that load this file:** dev (brainstorm), dev-tdd, dev-implement, dev-review, dev-verify, dev-debug

---

## C1: The Iron Law of Delegation

**MAIN CHAT MUST NOT WRITE CODE OR INVESTIGATE DIRECTLY. This is not negotiable.**

Main chat orchestrates. Subagents implement and investigate. If you catch yourself about to use Write, Edit, Grep, or Glob on project files (not .claude/ files), STOP and spawn a subagent instead.

| Allowed in Main Chat | NOT Allowed in Main Chat |
|---------------------|--------------------------|
| Spawn Task/Agent subagents | Write/Edit code files |
| Review subagent output | Direct implementation |
| Write to .claude/*.md files | "Quick fixes" |
| Run git commands | Any code editing |
| Run test commands (verification) | Grep/Glob code (investigation) |
| Read HYPOTHESES.md, LEARNINGS.md | Read project source files |
| | Docker exec into containers |
| | Read application logs |
| | Query databases (sqlite3, etc.) |
| | Curl/wget to test endpoints |
| | Inspect process state / env vars |

**Operational debugging is investigation.** Running `docker exec`, reading logs, querying databases, and curling endpoints are ALL investigation — they require interpreting results and forming hypotheses. Delegate to subagents.

### Rationalization Prevention (Delegation)

| Thought | Reality |
|---------|---------|
| "It's just a small fix" | Small fixes become big mistakes. Delegate. |
| "I'll be quick" | Quick means sloppy. Delegate. |
| "The subagent will take too long" | Subagent time is cheap. Your context is expensive. |
| "I already know what to do" | Knowing != doing it well. Delegate. |
| "Let me just do this one thing" | One thing leads to another. Delegate. |
| "This is too simple for a subagent" | Simple is exactly when delegation works best. |
| "I'm already here in the code" | Being there != writing there. Delegate. |
| "The user is waiting" | User wants DONE, not fast. They won't debug your shortcuts. |
| "This is just porting/adapting code" | Porting = writing = code. Delegate. |
| "I already have context loaded" | Fresh context per task is the point. Delegate. |
| "It's config, not real code" | JSON/YAML/TOML = code. Delegate. |
| "I need to set things up first" | Setup IS implementation. Delegate. |
| "Let me just quickly check one thing" | "One thing" becomes 50 file reads. Subagent. |
| "I have a strong hypothesis already" | That's what you thought last time. Subagent. |

**The Meta-Rationalization:** If you're treating these rules as "guidelines for complex work" rather than "invariants for ALL work", you've already failed. Simple work is EXACTLY when discipline matters most.

---

## C1b: Verification vs Investigation

**Running the test suite is verification. Reading source code is investigation. These are NOT the same thing.**

The most common delegation violation is disguising investigation as "verification." After a subagent returns, main chat "verifies" by grepping source files, reading logs, checking container state — this is investigation, not verification.

| Verification (main chat allowed) | Investigation (subagent only) |
|----------------------------------|-------------------------------|
| Run test suite (`vitest`, `pytest`, `npm test`) | Read/Grep/Glob source files |
| Check test exit code | Read application logs |
| `git diff -- '*.test.*'` (check test file changed) | Docker exec / container inspection |
| Read HYPOTHESES.md / LEARNINGS.md | Database queries |
| `git status` / `git log` | Curl/wget endpoints |
| | Inspect env vars / process state |

**If you need to READ CODE to "verify," you need a subagent, not verification.**

---

## C2: Real Test Enforcement

**Read the canonical reference:**

Read `${CLAUDE_SKILL_DIR}/../../references/real-test-enforcement.md`.

This file is the single source of truth for REAL vs FAKE test definitions. Do NOT duplicate its content inline. Read() it.

### Protocol Mismatch Detection (Common Fake Test Trap)

| Production Uses | FAKE Test Uses | Result |
|-----------------|----------------|--------|
| WebSocket | HTTP | Wrong code path tested |
| GraphQL | REST mock | Wrong serialization |
| Async/await | Sync calls | Race conditions hidden |
| IPC (Electron) | Direct import | Process boundary skipped |
| CLI invocation | Function call | Argument parsing skipped |

**The test must use the SAME protocol/transport as production.**

### E2E Evidence Requirement

User-facing claims require E2E evidence. Unit tests are necessary but insufficient.

| Claim | Unit Test Evidence | E2E Evidence Required |
|-------|--------------------|-----------------------|
| "API works" | Insufficient | Full request/response test |
| "UI renders" | Insufficient | Playwright snapshot/interaction |
| "Feature complete" | Insufficient | User flow simulation |
| "No regressions" | Insufficient | E2E suite passes |

**Fake E2E Patterns (NOT real E2E):**

| NOT E2E | Real E2E |
|---------|----------|
| "Log shows function was called" | "Screenshot shows correct UI" |
| "Console output contains 'success'" | "Playwright assertion on element" |
| "File was created" | "E2E test opens file and verifies contents" |
| "Process exited 0" | "Functional test verifies actual output" |
| "Mock returned expected value" | "Real integration returns expected value" |

---

## C3: Structural vs Runtime Verification

| NOT Verification | IS Verification |
|------------------|-----------------|
| "Code exists in file" | "Code ran and produced output X" |
| "Function is defined" | "Function was called and returned Y" |
| "Grep found the pattern" | "Program output shows expected behavior" |
| "ast-grep found the code" | "Test executed and passed with output" |
| "Diff shows the change" | "Change tested with actual input/output" |
| "Implementation looks correct" | "Ran test, saw PASS in logs" |

**If you find yourself saying "the code exists" without running it, STOP -- you're doing structural analysis, not verification.**

---

## Check Matrix

Which constraints apply in which context:

| Check | Brainstorm | Explore | Clarify | Design | Implement | Review | Verify | Debug |
|-------|-----------|---------|---------|--------|-----------|--------|--------|-------|
| C1: Delegation | - | - | - | - | **CRITICAL** | - | - | **CRITICAL** |
| C1b: Verification vs Investigation | - | - | - | - | Post-subagent | Post-subagent | Post-subagent | **CRITICAL** |
| C2: Real Tests | Define | Discover infra | Verify strategy | Lock in plan | Enforce TDD | Gate evidence | Prove E2E | Regression |
| C3: Structural vs Runtime | - | - | - | - | Verify agent output | Gate test evidence | Fresh evidence | Verify fix |

**How to use this matrix:**
- **CRITICAL** = This constraint is the primary enforcement point. Load and enforce fully.
- **Named context** = The constraint applies in this specific way for this phase.
- **-** = Constraint does not apply to this phase.
