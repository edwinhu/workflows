#!/usr/bin/env bash
# Test runner: auto-discovers and runs all DS constraint check scripts.
# Canonical source: references/constraints/ds-*.py (co-located with .md rules)
# Usage: ./scripts/check-all-ds.sh [optional: path to project directory]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONSTRAINTS_DIR="$SCRIPT_DIR/../references/constraints"
PASS=0
FAIL=0
TOTAL=0

PROJECT_DIR="${1:-.}"

echo "=== DS Workflow Constraint Checks ==="
echo "Project directory: $(cd "$PROJECT_DIR" && pwd)"
echo "Constraints directory: $CONSTRAINTS_DIR"
echo ""

for check in "$CONSTRAINTS_DIR"/ds-*.py; do
    [ -f "$check" ] || continue
    TOTAL=$((TOTAL + 1))
    check_name=$(basename "$check" .py)

    if output=$(uv run python3 "$check" "$PROJECT_DIR" 2>&1); then
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

# DISCOVERING NOTHING IS A FINDING, NOT A PASS. `FAIL -eq 0` alone is satisfied by "0/0 passed",
# so a CONSTRAINTS_DIR that resolved to the wrong place — a moved plugin root, a renamed checks
# directory, an unexpanded variable — reported a clean floor while running no checker at all. The
# failure mode is silent and looks exactly like success, which is why it has to be asserted here
# rather than left to whoever reads the summary line.
if [ "$TOTAL" -eq 0 ]; then
    echo "  ✗ no ds-*.py checks found under $CONSTRAINTS_DIR — the floor ran nothing, which is a failure, not a pass"
    exit 1
fi

[ "$FAIL" -eq 0 ]
