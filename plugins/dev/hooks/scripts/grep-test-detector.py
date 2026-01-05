#!/usr/bin/env python3
"""
Grep Test Detector: Warn when agents grep SOURCE FILES as a test mechanism.
Grepping source checks if strings exist - it doesn't test behavior.
Grepping LOG files after running code IS valid testing.

Session-aware: Only runs when dev workflow is active.
"""

import json
import sys
import re
import os

# Add shared scripts dir to path for session module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'shared', 'hooks', 'scripts'))
from session import is_workflow_active

# Early exit if dev workflow is not active (session-aware like Ralph loops)
if not is_workflow_active('dev'):
    sys.exit(0)

# Source file extensions - grepping these as tests is WRONG
SOURCE_EXTENSIONS = r'\.(c|h|cpp|hpp|py|js|ts|go|rs|java|rb|sh|bash)$'

# Log/output files - grepping these is OK (runtime behavior)
LOG_PATTERNS = [
    r'/tmp/',
    r'\.log$',
    r'\.out$',
    r'\.err$',
    r'stderr',
    r'stdout',
    r'2>&1',
    r'\|',  # piped output
]

def is_source_file_grep(grep_match: str) -> bool:
    """Check if grep is targeting a source file (bad) vs log file (ok)."""
    if '|' in grep_match or '2>&1' in grep_match:
        return False
    for log_pattern in LOG_PATTERNS:
        if re.search(log_pattern, grep_match, re.IGNORECASE):
            return False
    if re.search(SOURCE_EXTENSIONS, grep_match, re.IGNORECASE):
        return True
    return False

def detect_grep_test_patterns(content: str) -> list:
    """Detect grep patterns being used to test SOURCE FILES (not logs)."""
    patterns = []

    grep_commands = re.findall(r'grep[^|&\n]*', content)

    for grep_cmd in grep_commands:
        if not is_source_file_grep(grep_cmd):
            continue

        if re.search(r'if\s+grep', content) and is_source_file_grep(grep_cmd):
            if re.search(r'(PASS|FAIL|CHECK|SUCCESS)', content, re.IGNORECASE):
                stripped = grep_cmd.strip()
                truncated = stripped[:60] + "..." if len(stripped) > 60 else stripped
                patterns.append(f"Grepping source file as test: {truncated}")
                break

        if re.search(r'grep.*&&.*echo.*(PASS|FAIL|CHECK)', content, re.IGNORECASE):
            if is_source_file_grep(grep_cmd):
                stripped = grep_cmd.strip()
                truncated = stripped[:60] + "..." if len(stripped) > 60 else stripped
                patterns.append(f"Grepping source file as test: {truncated}")
                break

    if re.search(r'#!/bin/bash', content):
        source_greps = [g for g in grep_commands if is_source_file_grep(g)]
        if source_greps and ('test' in content.lower() or 'check' in content.lower()):
            patterns.append("Test script greps source files instead of checking runtime logs")

    if re.search(r'else\s*\n?\s*(if\s+)?grep.*\.(c|h|py|js)', content, re.IGNORECASE):
        patterns.append("Fallback to grepping source when log check fails - add debug logging instead")

    if re.search(r'#.*[Ff]allback.*\n.*grep.*\.(c|h|py)', content):
        patterns.append("'Fallback' pattern detected - don't grep source as backup, add logging")

    if re.search(r'code verified|implementation verified|source verified', content, re.IGNORECASE):
        patterns.append("'Code verified' by grepping source is not runtime verification")

    if re.search(r'(code|function|implementation|change|fix)\s+(exists|is\s+there|is\s+present|looks\s+correct|appears\s+correct)', content, re.IGNORECASE):
        patterns.append("'Code exists' is not verification - must test RUNTIME behavior")

    if re.search(r'(ast-grep|sg\s+-p).*&&.*(PASS|verified|confirmed)', content, re.IGNORECASE):
        patterns.append("ast-grep finds code patterns but doesn't test runtime behavior")

    return patterns


def detect_skip_as_pass(content: str) -> list:
    """Detect patterns where SKIP is being treated as PASS."""
    patterns = []

    if re.search(r'SKIP.*PASS|PASS.*SKIP', content, re.IGNORECASE):
        if re.search(r'(\d+)\s*(SKIP|skipped)', content, re.IGNORECASE):
            patterns.append("SKIP being counted - skipped tests are NOT passing tests")

    if re.search(r'all.*pass|tests.*pass|passing', content, re.IGNORECASE):
        if re.search(r'skip|skipped', content, re.IGNORECASE):
            patterns.append("Claiming 'pass' with skipped tests - SKIP ≠ PASS")

    if re.search(r'exit\s+0.*skip|skip.*exit\s+0', content, re.IGNORECASE):
        patterns.append("Exiting success with skipped tests")

    return patterns

def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    patterns_found = []
    skip_patterns = []

    if tool_name == 'Write':
        content = tool_input.get('content', '')
        file_path = tool_input.get('file_path', '')

        if 'test' in file_path.lower():
            patterns_found = detect_grep_test_patterns(content)
            skip_patterns = detect_skip_as_pass(content)

    if tool_name == 'Bash':
        command = tool_input.get('command', '')
        patterns_found = detect_grep_test_patterns(command)
        skip_patterns = detect_skip_as_pass(command)

    if skip_patterns:
        warning = """⚠️  SKIP ≠ PASS ANTI-PATTERN DETECTED

Patterns found:
""" + "\n".join(f"  • {p}" for p in skip_patterns) + """

SKIPPED TESTS ARE NOT PASSING TESTS:
- A skipped test has NOT verified anything
- SKIP means the code path was NOT executed
- You cannot claim GREEN if tests were skipped

FIX:
1. Identify why tests are being skipped
2. Fix the skip condition (missing deps, env issues, etc.)
3. Run the test and see it actually EXECUTE
4. Only claim PASS when you see actual PASS output

⚠️  Fix skipped tests before claiming completion.
"""
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "message": warning
            }
        }))
        return

    if patterns_found:
        warning = """⚠️  GREP SOURCE FILE ANTI-PATTERN DETECTED

Patterns found:
""" + "\n".join(f"  • {p}" for p in patterns_found) + """

GREPPING SOURCE FILES IS NOT TESTING:
- It checks if strings EXIST in code, not if code WORKS
- Code can segfault and this "test" still passes
- It tests structure, not runtime behavior

CORRECT PATTERN - Log-based testing:
1. Run the actual code: ./build/myapp --command
2. Capture output to log: > /tmp/test.log 2>&1
3. Grep the LOG file: grep 'expected' /tmp/test.log

✅ CORRECT:
  ./build/myapp --import file.pdf > /tmp/test.log 2>&1
  grep -q 'Imported 5 highlights' /tmp/test.log && echo PASS

❌ WRONG:
  grep -q "import_function" commands.c && echo PASS

⚠️  Rewrite tests to run code and check logs/output.
"""
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": warning
            }
        }))
        return

    sys.exit(0)

if __name__ == '__main__':
    main()
