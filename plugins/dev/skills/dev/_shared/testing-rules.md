# Testing Rules

These rules apply to all dev skills that involve testing and verification.

## LOGGING-FIRST RULE

You cannot debug/test what you cannot observe. Before writing ANY test:

1. Add debug logging to the code path (print, console.log, logger.debug, etc.)
2. Rebuild/restart
3. Write test that runs the program and checks the LOG/output for expected messages

## GREP TESTS ARE BANNED

NEVER use 'grep -q' or 'if grep' to check SOURCE FILES as a test.

| Wrong | Right |
|-------|-------|
| `grep -q 'function_name' src/module.py && echo PASS` | `./program --action > /tmp/test.log 2>&1; grep -q 'success' /tmp/test.log` |
| `grep -q 'fixed_function' src/module.py && echo PASS` | `./program --action 2>&1 \| tee /tmp/test.log; ! grep -q 'ERROR' /tmp/test.log` |

**The Iron Rule:** If your test doesn't execute the code path, it's not a test.

## SKIP != PASS

If a test is skipped, it has NOT passed. Run it and see actual PASS output.

- Skipped tests provide no evidence that the code works
- Always verify the test framework actually ran the test
- Check output for `PASS`, not just absence of `FAIL`
