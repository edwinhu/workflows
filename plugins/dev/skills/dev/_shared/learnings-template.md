# LEARNINGS.md Template

This template shows how to document attempts in `.claude/LEARNINGS.md` with explicit RED/GREEN phases.

## Template

```markdown
## Attempt N: [feature/task/hypothesis] - [STATUS]

**RED:** Wrote test `test_foo()`. Ran it. Output:
```
FAIL: test_foo - expected X but got undefined
```

**Implementation/Fix:** [describe what you implemented or fixed]

**GREEN:** Ran test again. Output:
```
PASS: test_foo
```

**Learned:** [key insight or confirmation of root cause]
```

## Requirements

1. **The RED section is mandatory.** You must see the test fail before implementing/fixing.
2. **Include actual command output** - not just "it failed" but the actual error message.
3. **The GREEN section documents success** - paste the actual passing output.
4. **Document what you learned** - this helps future debugging/implementation attempts.

## What Goes Wrong Without This

- Without RED: You might be testing the wrong thing or the test might always pass
- Without actual output: No evidence that you ran the test
- Without GREEN: No verification the fix/implementation worked
- Without learnings: Same mistakes get repeated
