---
name: dev-verify
description: Verification checklist before declaring work complete. Ensures all tests pass and requirements met.
---

# Verification Gate

Before claiming work is complete, verify these.

## Pre-Verification Checklist

- [ ] All new tests written (not skipped, not pending)
- [ ] All tests PASS (SKIP doesn't count)
- [ ] Full test suite runs with no regressions
- [ ] Code builds successfully
- [ ] LEARNINGS.md documents the work done
- [ ] Changes committed to git
- [ ] No TODOs left in code (or documented in LEARNINGS.md)

## Test Verification

### Tests Actually Execute

Don't just check if tests exist. Verify they EXECUTE:

```bash
# Run full test suite
pytest tests/

# Check for skipped tests
pytest tests/ -v | grep SKIP
# Should output nothing
```

### All Tests Pass

```bash
pytest tests/ -v
# Should end with "X passed" (not "X passed, Y skipped")
```

### No Regressions

Run the full test suite, not just new tests:

```bash
# Bad: pytest tests/test_new_feature.py
# Good: pytest tests/
```

All existing tests must still pass.

## Code Quality Checks

### Builds Successfully

```bash
# Language-specific build command
npm run build        # Node/JS
cargo build          # Rust
python -m py_compile *.py  # Python
go build             # Go
```

### No Obvious Issues

Quick mental checklist:
- [ ] Code is readable
- [ ] Variable names make sense
- [ ] Functions are small and focused
- [ ] No dead code left behind
- [ ] Comments explain WHY, not WHAT

### Follows Project Patterns

Check recent commits to see how things are typically done:
```bash
git log --oneline -20
```

Your code should follow similar patterns.

## Documentation

### LEARNINGS.md is Complete

Document what you did:

```markdown
## Completed Work

### Feature: [Name]
- What was implemented
- How tests verify it works
- Any interesting decisions made

### Testing
- Test framework used
- Which tests were written
- Edge cases covered

### Problems Encountered
- Any blockers and how they were resolved
```

### Commit Messages are Clear

```bash
git log --oneline -5
```

Commit messages should explain WHAT and WHY, not HOW.

## Acceptance

### Against Original Requirements

Re-read what was asked for. Does your work address it?

- [ ] All requirements met
- [ ] No scope creep
- [ ] No features "almost done"

### Test Coverage

Ask yourself:
- [ ] Happy path tested
- [ ] Error cases tested
- [ ] Edge cases tested
- [ ] Integration tested

If you can't test something, that's a sign it's too complex.

## Git Status

```bash
git status
```

Should show:
- All work committed
- No untracked files (except .gitignore items)
- No uncommitted changes

## Final Check

If you can answer YES to all these:

- ✓ All tests pass (run full suite)
- ✓ No regressions (existing tests still pass)
- ✓ Code builds
- ✓ Work addresses original requirements
- ✓ LEARNINGS.md documents decisions
- ✓ Changes committed to git

**Then you're ready. Work is complete.**

## If Something Fails This Check

Don't skip it. Investigate:

- Failing test? Fix the code or the test (but run it to verify the fix)
- Build failing? Fix dependencies or configuration
- Missing requirement? Implement it properly (don't ship incomplete work)
- Poor test coverage? Write more tests

**Verification exists to catch issues before they become problems.**

