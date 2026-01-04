---
name: dev-verify
description: This skill should be used when the user asks to "verify this works", "prove it's done", "show me evidence", or as Phase 5 of the /dev workflow before claiming completion. Requires fresh runtime evidence.
---

# Verification Gate

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
