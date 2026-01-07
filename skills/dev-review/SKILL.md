---
name: dev-review
description: Code review guidelines combining spec compliance, quality checks, and testing requirements.
---

# Code Review

Review completed work against requirements and best practices.

## When to Review

After all implementation tasks complete and tests pass:
1. Tests PASS (full suite)
2. No regressions
3. LEARNINGS.md documents the work

## Spec Compliance

Does the code do what was asked for?

- [ ] All requirements met
- [ ] No scope creep ("nice to have" features that weren't required)
- [ ] Edge cases from spec are handled
- [ ] Error cases work as specified

If ANY requirement is missing, mark as "needs work" and don't proceed.

## Testing Quality

Are tests thorough and meaningful?

- [ ] Tests EXECUTE code (not grep/pattern matching)
- [ ] Happy path tested
- [ ] Error cases tested
- [ ] Edge cases tested
- [ ] Tests are readable and maintainable
- [ ] No test skips or pending tests
- [ ] Full test suite passes

**Tests that don't execute code aren't tests.** Code review should catch this.

## Code Quality

Is the code clean and maintainable?

- [ ] Code is readable (clear variable names, functions)
- [ ] Functions are small and focused
- [ ] Duplication is eliminated
- [ ] Comments explain WHY (not WHAT)
- [ ] Follows project patterns
- [ ] No dead code or TODOs left behind
- [ ] Proper error handling

## Documentation

Is the work documented for future maintainers?

- [ ] LEARNINGS.md explains decisions made
- [ ] Complex logic has comments
- [ ] Commit messages are clear
- [ ] API changes are documented (if applicable)

## Integration

Does the code work with the rest of the system?

- [ ] Builds successfully
- [ ] No breaking changes to existing code
- [ ] Integration tests pass (if applicable)
- [ ] Performance impact considered (for critical paths)

## Common Issues to Check

### Over-Engineering
- Does code do more than required? (Scope creep)
- Are there unused abstractions or generality?
- **Fix:** Remove features not in spec

### Under-Testing
- Does code have test coverage?
- Are edge cases tested?
- Can tests actually catch bugs?
- **Fix:** Write more targeted tests

### Code Quality
- Is the code clean and understandable?
- Are there obvious smells (long functions, duplication)?
- **Fix:** Refactor while tests pass

### Documentation Gaps
- Would someone understand this 6 months from now?
- Are complex decisions documented?
- **Fix:** Add comments and update LEARNINGS.md

## Approval Criteria

Approve when:
- ✓ All requirements met
- ✓ Tests pass and are thorough
- ✓ Code is clean and maintainable
- ✓ Documentation is complete
- ✓ No regressions in existing code

Block approval if:
- ✗ Requirements missing
- ✗ Tests don't execute code
- ✗ Test suite fails
- ✗ Code quality issues
- ✗ Regressions detected

## After Approval

Once work passes review:
1. Code is ready to merge
2. Final verification can happen
3. Document completion

## Tips

- **Review early and often** - Don't wait until everything is "done"
- **Be specific** - "Needs work" is less helpful than "This function is too long, split it"
- **Test the tests** - Remove test assertions. Tests should fail. Put them back.
- **Check the spec** - Did work actually meet requirements or just look good?
- **Look at git history** - Do commits tell a clear story?

