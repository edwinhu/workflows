---
name: structural-vs-runtime-verification
description: Code existing in a file is not evidence it works — only runtime execution with pass output counts
applies-to: [dev, dev-tdd, dev-implement, dev-review, dev-verify, dev-debug, dev-test, dev-test-gaps]
---

## Rule

**Code existing in a file is structural evidence. Code running and producing expected output is runtime evidence. Only runtime evidence verifies a claim.**

| NOT Verification | IS Verification |
|------------------|-----------------|
| "Code exists in file" | "Code ran and produced output X" |
| "Function is defined" | "Function was called and returned Y" |
| "Grep found the pattern" | "Program output shows expected behavior" |
| "ast-grep found the code" | "Test executed and passed with output" |
| "Diff shows the change" | "Change tested with actual input/output" |
| "Implementation looks correct" | "Ran test, saw PASS in logs" |

**If you find yourself saying "the code exists" without running it, STOP — you're doing structural analysis, not verification.**

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

## Rationale

**Why this exists** — the dev-debug audit (March 16, 2026) showed that 71 protocol violations occurred in a single session, many of them structural verification: reading code to confirm it "looks right" instead of running it. Structural verification is fast but wrong. Runtime verification is the only reliable signal that code does what it claims.

## Examples

### Correct

```
# Verifying an API endpoint
response = requests.get("http://localhost:8000/api/users")
assert response.status_code == 200
assert "users" in response.json()
# PASS — runtime verification
```

### Incorrect

```
# "Verifying" an API endpoint
grep -r "def get_users" src/api/
# Found the function. Ship it?
# NO — this is structural analysis, not verification
```

## Verification Facts

- Hidden bugs survive visual review — the dev-debug audit (March 16, 2026) counted 71 protocol violations in one session, many of them "it looks right" structural checks. Claiming "verified" off a read, a diff, or an ast-grep hit is an unverified claim presented as fact. One test run is faster than the time debt of shipping unverified code — the "short on time" shortcut is counterproductive on its own terms.

## Red Flags

- **"The code is there, it should work"** — STOP. Run it. Assert it works.
- **"Grep confirms the function exists"** — STOP. Existence ≠ correctness. Execute and assert.
- **"The diff looks right"** — STOP. Diffs are structural. Run the test.
- **"I'm confident the implementation is correct"** — STOP. Confidence is not evidence. Run the test.
- **Claiming feature complete without running E2E tests** — STOP. Unit tests are not sufficient for feature claims.
