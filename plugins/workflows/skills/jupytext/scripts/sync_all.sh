#!/usr/bin/env bash
# Sync all paired jupytext notebooks in the current project
#
# Usage: ./sync_all.sh [directory]
#
# Finds all .py files with jupytext headers and syncs them with their
# paired .ipynb files. Useful for ensuring all notebooks are up to date
# before committing or after pulling changes.

set -euo pipefail

DIR="${1:-.}"

echo "Syncing jupytext files in: $DIR"
echo ""

# Find Python files with jupytext headers
count=0
errors=0

# Look for percent-format Python files
while IFS= read -r -d '' file; do
    # Check if file has jupytext header
    if head -5 "$file" | grep -q "jupytext:"; then
        echo "Syncing: $file"
        if jupytext --sync "$file" 2>/dev/null; then
            ((count++))
        else
            echo "  ERROR: Failed to sync $file"
            ((errors++))
        fi
    fi
done < <(find "$DIR" -name "*.py" -print0 2>/dev/null)

# Also check R files
while IFS= read -r -d '' file; do
    if head -5 "$file" | grep -q "jupytext:"; then
        echo "Syncing: $file"
        if jupytext --sync "$file" 2>/dev/null; then
            ((count++))
        else
            echo "  ERROR: Failed to sync $file"
            ((errors++))
        fi
    fi
done < <(find "$DIR" -name "*.R" -print0 2>/dev/null)

# Summary
echo ""
echo "----------------------------------------"
echo "Synced: $count files"
if [ "$errors" -gt 0 ]; then
    echo "Errors: $errors files"
    exit 1
fi
echo "Done."
