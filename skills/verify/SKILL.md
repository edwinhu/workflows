---
name: verify
description: "This skill should be used when the user asks to 'run checks', 'verify the build', 'check for errors', 'run tests', 'pre-commit check', 'is it ready to commit', or wants a comprehensive verification checklist (build, types, lint, tests, secrets, debug prints)."
---

# Verification Checklist

Run comprehensive verification on current codebase state.

## Instructions

Execute verification in this exact order:

1. **Build Check**
   - Run the build command for this project
   - If it fails, report errors and STOP

2. **Type Check**
   - Run type checker (mypy, pyright, tsc)
   - Report all errors with file:line

3. **Lint Check**
   - Run linter (ruff, eslint, etc.)
   - Report warnings and errors

4. **Test Suite**
   - Run all tests (pytest, vitest, etc.)
   - Report pass/fail count
   - Report coverage percentage

5. **Console.log Audit**
   - Search for debug prints in source files
   - Report locations (print, console.log, etc.)

6. **Git Status**
   - Show uncommitted changes
   - Show files modified since last commit

## Output

Produce a concise verification report:

```
VERIFICATION: [PASS/FAIL]

Build:    [OK/FAIL]
Types:    [OK/X errors]
Lint:     [OK/X issues]
Tests:    [X/Y passed, Z% coverage]
Secrets:  [OK/X found]
Logs:     [OK/X debug prints]

Ready for commit: [YES/NO]
```

If any critical issues, list them with fix suggestions.

## Arguments

Arguments can be:
- `quick` - Only build + types
- `full` - All checks (default)
- `pre-commit` - Checks relevant for commits
- `pre-pr` - Full checks plus security scan
