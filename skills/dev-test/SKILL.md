---
name: dev-test
description: Testing tools reference. Covers unit tests, integration tests, Playwright (web), Hammerspoon (macOS), ydotool (Linux).
---
## Where This Fits

```
Main Chat                          Task Agent (you)
─────────────────────────────────────────────────────
dev-implement
  → dev-ralph-loop
    → dev-delegate
      → Task agent ──────────────→ follows dev-tdd (TDD protocol)
                                   uses dev-test (this skill)
```

**This skill is for Task agents** selecting testing tools.
For TDD philosophy (RED-GREEN-REFACTOR), see `dev-tdd`.

## Contents

- [Testing Hierarchy](#testing-hierarchy)
- [Platform Detection](#platform-detection)
- [Platform-Specific Skills](#platform-specific-skills)
- [Unit & Integration Tests](#unit--integration-tests)
- [Output Requirements](#output-requirements)

# Testing Tools Reference

## Testing Hierarchy

Try in order. Only fall back when higher options unavailable:

| Priority | Type | Tools | When to use |
|----------|------|-------|-------------|
| 1 | **Unit tests** | pytest, jest, cargo test, meson test | Always first |
| 2 | **Integration tests** | CLI invocation, API calls | Test component interaction |
| 3 | **UI automation** | Playwright (web), Hammerspoon (macOS), ydotool (Linux) | Test user-facing behavior |
| 4 | **Visual regression** | Screenshots + comparison | Verify visual output |
| 5 | **Accessibility** | AT-SPI, axe-core | Verify a11y compliance |
| 6 | **Manual testing** | User verification | **LAST RESORT ONLY** |

<EXTREMELY-IMPORTANT>
## Tool Availability Gate

**If a required testing tool is not installed, STOP and tell the user to install it.**

See platform-specific skills for installation commands:
- **macOS**: `dev-test-macos` - Hammerspoon, screencapture
- **Linux**: `dev-test-linux` - ydotool (Wayland), xdotool (X11), grim
- **Web**: `dev-test-playwright` - Playwright MCP, /chrome

**DO NOT:**
- Skip the test because tool is missing
- Fall back to manual testing silently
- Continue and let the test fail
- Assume the tool will be available

**This gate is non-negotiable. Missing tools = full stop.**
</EXTREMELY-IMPORTANT>

## Platform Detection

```bash
# Detect platform
case "$(uname -s)" in
    Darwin) echo "macOS - use dev-test-macos" ;;
    Linux)
        if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
            echo "Linux/Wayland - use dev-test-linux (ydotool)"
        else
            echo "Linux/X11 - use dev-test-linux (xdotool)"
        fi
        ;;
esac
```

## Platform-Specific Skills

**Load the appropriate skill for E2E desktop automation:**

| Platform | Skill | Primary Tool |
|----------|-------|--------------|
| **macOS** | `Skill(skill="workflows:dev-test-macos")` | Hammerspoon |
| **Linux** | `Skill(skill="workflows:dev-test-linux")` | ydotool / xdotool |
| **Web** | `Skill(skill="workflows:dev-test-playwright")` | Playwright MCP |

### Quick Reference

**macOS (Hammerspoon):**
```bash
hs -c 'hs.eventtap.keyStroke({"cmd"}, "c")'  # Cmd+C
hs -c 'hs.application.launchOrFocus("Safari")'
screencapture /tmp/screenshot.png
```

**Linux/Wayland (ydotool):**
```bash
ydotool type "hello world"
ydotool key 29:1 46:1 46:0 29:0  # Ctrl+C
grim /tmp/screenshot.png
```

**Linux/X11 (xdotool):**
```bash
xdotool type "hello world"
xdotool key ctrl+c
scrot /tmp/screenshot.png
```

**Web (Playwright):**
```
mcp__playwright__browser_navigate(url="https://example.com")
mcp__playwright__browser_click(element="Submit")
mcp__playwright__browser_snapshot()
```

## Unit & Integration Tests

### Test Discovery

```bash
# Find test directory
ls -d tests/ test/ spec/ __tests__/ 2>/dev/null

# Find test framework
cat package.json 2>/dev/null | grep -E "(test|jest)"
cat pyproject.toml 2>/dev/null | grep -i pytest
cat Cargo.toml 2>/dev/null | grep -i "\[dev-dependencies\]"
cat meson.build 2>/dev/null | grep -i test
```

### Common Test Frameworks

| Language | Framework | Command |
|----------|-----------|---------|
| Python | pytest | `pytest tests/ -v` |
| JavaScript | jest | `npm test` |
| TypeScript | vitest | `npx vitest` |
| Rust | cargo | `cargo test` |
| C/C++ | meson | `meson test -C build -v` |
| Go | go test | `go test ./...` |

### CLI Application Testing

```bash
# Run with test inputs
./app --test-mode input.txt > output.txt

# Compare to expected
diff expected.txt output.txt

# Check exit code
./app --validate file && echo "PASS" || echo "FAIL"
```

## Output Requirements

**Every test run MUST be documented in LEARNINGS.md:**

```markdown
## Test Run: [Description]

**Command:**
```bash
pytest tests/ -v
```

**Output:**
```
tests/test_feature.py::test_basic PASSED
tests/test_feature.py::test_edge_case PASSED
tests/test_feature.py::test_error FAILED

1 failed, 2 passed
```

**Result:** 2/3 PASS, 1 FAIL

**Next:** Fix test_error failure
```

## Code Search for Tests

**Use ast-grep to find existing test patterns:**

```bash
# Python
sg -p 'def test_$NAME($$$):' --lang python
sg -p '@pytest.fixture' --lang python

# JavaScript
sg -p 'it($DESC, $$$)' --lang javascript
sg -p 'describe($DESC, $$$)' --lang javascript

# Find assertions
sg -p 'assert $EXPR' --lang python
sg -p 'expect($EXPR)' --lang javascript
```

## Integration

For platform-specific E2E automation, invoke the appropriate sub-skill:

```
Skill(skill="workflows:dev-test-macos")      # macOS
Skill(skill="workflows:dev-test-linux")      # Linux
Skill(skill="workflows:dev-test-playwright") # Web
```

For TDD protocol (RED-GREEN-REFACTOR), see:
```
Skill(skill="workflows:dev-tdd")
```