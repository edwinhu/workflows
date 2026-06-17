#!/usr/bin/env bash
# Generate a review package — commit list, stat summary, and the net diff with
# extended context — written to ONE file that every reviewer lens reads in a
# single call. A pasted diff parks itself permanently in the most expensive
# context AND is re-pasted once per lens; a file path is read on demand, once
# per reviewer, and never enters the controller's context.
#
# Mirrors superpowers v6 `review-package`. CRITICAL: excludes .planning/ from
# the diff so the handoff artifacts (briefs, prior review packages) never appear
# in the diff the reviewers read — that recursion is exactly the noise the
# file-handoff is meant to remove.
#
# Usage: review-package.sh BASE HEAD [OUTFILE]
#   BASE = the commit recorded BEFORE the task's implementer ran (never HEAD~1,
#          which silently drops all but the last commit of a multi-commit task).
# Default OUTFILE: .planning/handoff/review-<base7>..<head7>.diff (relative to CWD)
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: review-package.sh BASE HEAD [OUTFILE]" >&2
  exit 2
fi

base=$1
head=$2
git rev-parse --verify --quiet "${base}^{commit}" >/dev/null || { echo "bad BASE: $base" >&2; exit 2; }
git rev-parse --verify --quiet "${head}^{commit}" >/dev/null || { echo "bad HEAD: $head" >&2; exit 2; }

if [ $# -eq 3 ]; then
  out=$3
else
  b=$(git rev-parse --short "$base")
  h=$(git rev-parse --short "$head")
  out=".planning/handoff/review-${b}..${h}.diff"
fi
hdir=$(dirname "$out")
mkdir -p "$hdir"
case "$hdir" in */handoff) [ -f "$hdir/.gitignore" ] || printf '*\n' > "$hdir/.gitignore" ;; esac

# Exclude the handoff/state dir from the diff so review artifacts never recurse in.
EXCLUDE=':(exclude).planning/'

{
  echo "# Review package: ${base}..${head}"
  echo
  echo "## Commits"
  git log --oneline "${base}..${head}"
  echo
  echo "## Files changed"
  git diff --stat "${base}..${head}" -- . "$EXCLUDE"
  echo
  echo "## Diff (context -U10, .planning/ excluded)"
  git diff -U10 "${base}..${head}" -- . "$EXCLUDE"
} > "$out"

commits=$(git rev-list --count "${base}..${head}")
echo "wrote ${out}: ${commits} commit(s), $(wc -c < "$out" | tr -d ' ') bytes"
