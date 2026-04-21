#!/usr/bin/env bash
# Test runner: calls all constraint check scripts for the writing workflow.
# Usage: ./scripts/check-all.sh [optional: path to project directory]
#
# Exit code 0 = all checks pass, non-zero = at least one failure.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKS_DIR="$SCRIPT_DIR/checks"
PASS=0
FAIL=0
TOTAL=0

# If a project directory was provided, cd to it
if [ -n "$1" ]; then
    cd "$1" || { echo "Cannot cd to $1"; exit 1; }
fi

echo "=== Writing Workflow Constraint Checks ==="
echo "Project directory: $(pwd)"
echo ""

for check in "$CHECKS_DIR"/check-*.py; do
    [ -f "$check" ] || continue
    TOTAL=$((TOTAL + 1))
    check_name=$(basename "$check" .py | sed 's/^check-//')

    if output=$(uv run python3 "$check" 2>&1); then
        echo "  ✓ $check_name"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $check_name"
        echo "$output" | sed 's/^/    /'
        FAIL=$((FAIL + 1))
    fi
done

echo ""
echo "Results: $PASS/$TOTAL passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
