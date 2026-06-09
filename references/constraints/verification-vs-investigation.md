---
name: verification-vs-investigation
description: Running the test suite is verification. Reading source code is investigation. These are NOT the same thing.
applies-to: [dev, dev-tdd, dev-implement, dev-review, dev-verify, dev-debug, dev-delegate, dev-test, dev-test-gaps]
---

## Rule

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

## Rationale

**Why this exists** — the dev-debug audit (March 16, 2026) documented 71 protocol violations in a single session where main chat "verified" subagent work by reading source code. Each "verification" became investigation became fixing became more investigation. The session never recovered to proper orchestration. The boundary is bright: tests produce pass/fail output that main chat can read. Everything else is investigation.

## Examples

### Correct

```
Subagent returns: "Fixed the auth middleware. Tests pass."
Main chat verification:
1. npm test → exit code 0
2. git diff -- '*.test.*' → test file was updated
3. PASS. Recording in LEARNINGS.md.
```

### Incorrect

```
Subagent returns: "Fixed the auth middleware."
Main chat "verification":
1. Read auth/middleware.js to check the fix looks right
2. "Hmm, let me also check the token validation..."
3. "Actually I see another issue in auth/tokens.js..."
(Now main chat is investigating AND planning to fix. Full delegation collapse.)
```

## Boundary Facts

- Needing commit-message context is not a license to read changed files — `git diff --stat` is the allowed tool. Needing logic review is not a license to read source — spawn a code review subagent.
- In the March 16, 2026 session, each violation started as a "quick sanity check" or "making sure the subagent didn't miss anything" — reading source after a subagent returns is investigation regardless of the label, and it cascaded into full delegation collapse. If the tests pass, that IS the verification.

## Red Flags

- **"Let me read the fix to make sure it's correct"** — STOP. That's investigation. Run the tests.
- **"I'll check the implementation to verify the subagent understood correctly"** — STOP. Investigation. Trust the tests.
- **Grepping source files after a subagent returns** — STOP. Investigation. You needed a test.
- **"The test passes but I want to double-check..."** — STOP. Double-checking code is investigation. Tests are your verification.
- **Reading log files to verify a subagent's claim** — STOP. Log reading is investigation. Spawn a subagent.
