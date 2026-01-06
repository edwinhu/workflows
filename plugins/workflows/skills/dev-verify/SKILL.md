---
name: dev-verify
description: "REQUIRED Phase 7 of /dev workflow (final). Requires fresh runtime evidence before claiming completion."
---

**Announce:** "I'm using dev-verify (Phase 7) to confirm completion with fresh evidence."

## Contents

- [The Iron Law of Verification](#the-iron-law-of-verification)
- [Red Flags - STOP Immediately If You Think](#red-flags---stop-immediately-if-you-think)
- [The Gate Function](#the-gate-function)
- [Claims Requiring Evidence](#claims-requiring-evidence)
- [Insufficient Evidence](#insufficient-evidence)
- [Verification Patterns](#verification-patterns)
- [User Acceptance (Final Step)](#user-acceptance-final-step)
- [Bottom Line](#bottom-line)

# Verification Gate

<EXTREMELY-IMPORTANT>
## Your Job is to Write Automated Tests

**The automated test IS your deliverable. The implementation just makes the test pass.**

Reframe your task:
- ❌ "Implement feature X, and test it"
- ✅ "Write an automated test that proves feature X works. Then make it pass."

The test proves value. The implementation is a means to an end.

Without a REAL automated test (executes code, verifies behavior), you have delivered NOTHING.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Verification

**NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE. This is not negotiable.**

Before claiming ANYTHING is complete, you MUST:
1. IDENTIFY - Which command proves your assertion?
2. RUN - Execute the command fresh (not from cache/memory)
3. READ - Review full output and exit codes
4. VERIFY - Confirm output supports your claim
5. Only THEN make the claim

This applies even when:
- "I just ran it a moment ago"
- "The agent said it passed"
- "It should work"
- "I'm confident it's fine"

**If you catch yourself about to claim completion without fresh evidence, STOP.**
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "It should work" | "Should" isn't evidence | Run the command |
| "I'm pretty sure it passes" | Confidence isn't verification | Run the command |
| "The agent reported success" | Agent reports need confirmation | Run it yourself |
| "I ran it earlier" | Earlier isn't fresh | Run it again |
| "The code exists" | Existing ≠ working | Run and check output |
| "Grep shows the function" | Pattern match ≠ runtime test | Run the function |

## The Gate Function

Before making ANY status claim:

```
1. IDENTIFY → Which command proves your assertion?
2. RUN     → Execute the command fresh
3. READ    → Review full output and exit codes
4. VERIFY  → Confirm output supports your claim
5. CLAIM   → Only after steps 1-4
```

**Skipping any step is dishonest, not verification.**

## Claims Requiring Evidence

| Claim | Required Evidence |
|-------|-------------------|
| "Tests pass" | Test output showing 0 failures |
| "Build succeeds" | Exit code 0 from build command |
| "Linter clean" | Linter output showing 0 errors |
| "Bug fixed" | Test that failed now passes |
| "Feature complete" | All acceptance criteria verified |

## Insufficient Evidence

These do NOT count as verification:

- Previous runs (must be fresh)
- Assumptions ("it should work")
- Partial checks (ran some tests, not all)
- Agent reports without independent confirmation
- "I think..." / "It seems..." / "Probably..."

## Honesty Requirement

<EXTREMELY-IMPORTANT>
**Claiming completion without fresh evidence is LYING.**

When you say "Feature complete", you are asserting:
- You ran the verification commands yourself (fresh)
- You saw the output with your own tokens
- The output confirms the claim

Saying "complete" based on stale data or agent reports is not "summarizing" - it is LYING about project state.

**"Still verifying" is honest. "Complete" without evidence is fraud.**
</EXTREMELY-IMPORTANT>

## Rationalization Prevention

These thoughts mean STOP—you're about to claim falsely:

| Thought | Reality |
|---------|---------|
| "I just ran it" | "Just" = stale. Run it AGAIN. |
| "The agent said it passed" | Agent reports need YOUR confirmation. Run it. |
| "It should work" | "Should" is hope. Run and see output. |
| "I'm confident" | Confidence ≠ verification. Run the command. |
| "We already verified earlier" | Earlier ≠ now. Fresh evidence only. |
| "User will verify it" | NO. Verify before claiming. User trusts your claim. |
| "Close enough" | Close ≠ complete. Verify fully. |
| "Time to move on" | Only move on after FRESH verification. |

**STRUCTURAL VERIFICATION IS NOT RUNTIME VERIFICATION:**

| ❌ NOT Verification | ✅ IS Verification |
|---------------------|-------------------|
| "Code exists in file" | "Code ran and produced output X" |
| "Function is defined" | "Function was called and returned Y" |
| "Grep found the pattern" | "Program output shows expected behavior" |
| "ast-grep found the code" | "Test executed and passed with output" |
| "Diff shows the change" | "Change tested with actual input/output" |
| "Implementation looks correct" | "Ran test, saw PASS in logs" |

**The key difference:**
- Structural: "The code IS THERE" (useless)
- Runtime: "The code WORKS" (valid)

If you find yourself saying "the code exists" or "I verified the implementation" without running it, **STOP** - that's not verification.

## Verification Patterns

### Tests
```bash
# Run the command
npm test  # or pytest, cargo test, etc.

# See numerical results
# "34/34 pass" → Can claim "tests pass"
# "33/34 pass" → CANNOT claim success
```

### Regression Test
```bash
# 1. Write test → run (should pass)
# 2. Revert fix → run (MUST fail)
# 3. Restore fix → run (should pass)
# Only then claim "bug is fixed"
```

### Build
```bash
npm run build && echo "Exit code: $?"
# Must see "Exit code: 0" to claim success
```

## User Acceptance (Final Step)

After technical verification passes, confirm with user:

```
AskUserQuestion:
  question: "Does this implementation meet your requirements?"
  options:
    - label: "Yes, requirements met"
      description: "Feature works as designed, ready to merge"
    - label: "Partially"
      description: "Core works but missing some requirements"
    - label: "No"
      description: "Does not meet requirements, needs more work"
```

**Reference `.claude/SPEC.md`** when asking - remind user of the success criteria they defined.

If user says "Partially" or "No":
1. Ask which specific requirement is not met
2. Return to `/dev-implement` to address gaps
3. Re-run verification

**Only claim COMPLETE when:**
- [ ] All technical tests pass (automated)
- [ ] User confirms requirements met (manual)

## Bottom Line

**Two types of verification required:**

1. **Technical** - Run commands, see output, confirm no errors
2. **Requirements** - Ask user if it does what they wanted

Both must pass. No shortcuts exist.

## Workflow Complete

When user confirms "Yes, requirements met":

**Announce:** "Dev workflow complete. All 7 phases passed."

The `/dev` workflow is now finished. Offer to:
- Commit the changes
- Clean up `.claude/` files
- Start a new feature with `/dev`
