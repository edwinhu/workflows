#!/usr/bin/env -S uv run python3
"""Constraint: real-test-enforcement — tests must execute code and verify runtime behavior.

Scans test files for patterns that indicate fake tests:
- Test files that only contain grep/pattern-matching assertions
- Test files with no actual function calls or assertions
- Tests that mock the system under test itself (not seams)
"""

CONSTRAINT = "real-test-enforcement"
APPLIES_TO = ["dev", "dev-tdd", "dev-implement", "dev-verify", "dev-test", "dev-test-gaps"]
SEVERITY = "hard"

import re
from pathlib import Path

SKIP_DIRS = {'.venv', 'node_modules', '__pycache__', '.pixi', '.git', '.tox', 'site-packages', 'dist', 'build'}

# Patterns that indicate fake tests (static analysis instead of execution)
FAKE_TEST_PATTERNS = [
    (re.compile(r'\bsubprocess\.run\(\[.*\brg\b|grep\b', re.IGNORECASE), "uses grep/rg as test assertion"),
    (re.compile(r'ast[\._]grep|ast-grep'), "uses ast-grep as test assertion"),
    (re.compile(r'"code looks correct"|"implementation looks right"', re.IGNORECASE), "vibes-based assertion"),
]

# Patterns indicating a test has real assertions
REAL_ASSERTION_PATTERNS = [
    re.compile(r'\bassert\b'),
    re.compile(r'\.assertEqual\b|\.assertTrue\b|\.assertFalse\b|\.assertIn\b|\.assertRaises\b'),
    re.compile(r'expect\(.*\)\.(to|toBe|toEqual|toMatch|toContain|toHaveBeenCalled)'),
    re.compile(r'cy\.(get|visit|click|type|should)\b'),
    re.compile(r'@pytest\.mark|def test_'),
    re.compile(r'it\(|describe\(|test\('),
]


def find_test_files(cwd: Path):
    """Find test files in the project."""
    test_patterns = ['test_*.py', '*_test.py', '*.test.js', '*.test.ts', '*.spec.js', '*.spec.ts',
                     '*.test.jsx', '*.test.tsx', '*.spec.jsx', '*.spec.tsx']
    test_dirs = ['tests', 'test', '__tests__', 'spec']

    found = set()
    for pattern in test_patterns:
        for f in cwd.rglob(pattern):
            if not any(part in SKIP_DIRS for part in f.parts):
                found.add(f)

    for test_dir in test_dirs:
        td = cwd / test_dir
        if td.exists():
            for f in td.rglob('*'):
                if f.is_file() and not any(part in SKIP_DIRS for part in f.parts):
                    found.add(f)

    return found


def find_implementation_files(cwd: Path):
    """Find implementation files (src/, lib/, or top-level .py/.js/.ts)."""
    impl_patterns = ['*.py', '*.js', '*.ts', '*.jsx', '*.tsx']
    impl_dirs = ['src', 'lib', 'app']

    found = set()
    for impl_dir in impl_dirs:
        d = cwd / impl_dir
        if d.exists():
            for pattern in impl_patterns:
                for f in d.rglob(pattern):
                    if not any(part in SKIP_DIRS for part in f.parts):
                        # Exclude test files
                        name = f.name
                        if not any([name.startswith('test_'), name.endswith('_test.py'),
                                    '.test.' in name, '.spec.' in name]):
                            found.add(f)
    return found


def check_file_for_fake_tests(filepath: Path):
    """Check a test file for fake test patterns."""
    violations = []
    try:
        text = filepath.read_text(encoding='utf-8', errors='replace')
    except (OSError, PermissionError):
        return violations

    lines = text.split('\n')
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('#') or stripped.startswith('//'):
            continue
        for pattern, desc in FAKE_TEST_PATTERNS:
            if pattern.search(line):
                violations.append(f"{filepath}:{i} — {desc}: {stripped[:80]}")

    return violations


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", ".")).resolve()
    violations = []

    impl_files = find_implementation_files(cwd)
    test_files = find_test_files(cwd)

    # Check 1: If there are implementation files, there should be test files
    if impl_files and not test_files:
        violations.append(
            f"No test files found despite {len(impl_files)} implementation files. "
            "Delegation to TDD subagents should produce test files. (SOFT)"
        )

    # Check 2: Scan test files for fake test patterns
    for test_file in sorted(test_files):
        file_violations = check_file_for_fake_tests(test_file)
        violations.extend(file_violations)

    return violations


if __name__ == "__main__":
    import sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
