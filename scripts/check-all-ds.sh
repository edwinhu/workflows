#!/usr/bin/env bash
# Test runner: calls all DS constraint check scripts.
# Usage: ./scripts/check-all-ds.sh [optional: path to project directory]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKS_DIR="$SCRIPT_DIR/checks"
PASS=0
FAIL=0
TOTAL=0

if [ -n "$1" ]; then
    cd "$1" || { echo "Cannot cd to $1"; exit 1; }
fi

echo "=== DS Workflow Constraint Checks ==="
echo "Project directory: $(pwd)"
echo ""

for check in "$CHECKS_DIR"/check-ds-*.py; do
    [ -f "$check" ] || continue
    TOTAL=$((TOTAL + 1))
    check_name=$(basename "$check" .py | sed 's/^check-ds-//')

    if output=$(python3 "$check" "$@" 2>&1); then
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
