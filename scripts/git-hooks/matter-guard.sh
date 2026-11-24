#!/usr/bin/env bash
# Refuse commits and pushes that add a confidential-matter term to this public repo.
#
#   matter-guard.sh commit-msg <file>   the staged diff's added lines and the message
#   matter-guard.sh pre-push <remote>   every outgoing commit's added lines and message (refs on stdin)
#   matter-guard.sh install             symlink both hooks into this clone's hooks dir
#
# Override, per commit: a message line `Matter-Override: <reason>`. The commit and its push then
# pass, and the override is printed so it is never silent.
# The terms live OUTSIDE the repo -- listing them here would publish them. One fixed string per line,
# matched case-insensitively; blank lines and lines starting with # are ignored.
# File: $MATTER_TERMS_FILE, default ~/.config/git/matter-terms. Missing or empty fails closed.
set -euo pipefail

terms=${MATTER_TERMS_FILE:-$HOME/.config/git/matter-terms}
mode=${1:-}
override='^Matter-Override:[[:space:]]*[^[:space:]]'

die() { printf 'matter-guard: %s\n' "$*" >&2; exit 1; }

if [ "$mode" = install ]; then
  hooks=$(git rev-parse --git-path hooks)
  self=$(cd "$(dirname "$0")" && pwd)
  mkdir -p "$hooks"
  for h in commit-msg pre-push; do
    [ -e "$hooks/$h" ] && [ ! -L "$hooks/$h" ] && die "$hooks/$h exists and is not ours; merge it by hand"
    ln -sfn "$self/$h" "$hooks/$h"
  done
  echo "matter-guard: hooks installed in $hooks (terms: $terms)"
  exit 0
fi

[ -r "$terms" ] || die "terms file $terms is missing or unreadable. Refusing (fail closed). Create it (one term per line, chmod 600) or set MATTER_TERMS_FILE."
pats=$(mktemp); trap 'rm -f "$pats"' EXIT
grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$terms" > "$pats" || true
[ -s "$pats" ] || die "terms file $terms has no terms. Refusing (fail closed)."

# stdin: text to scan; $1: what it is. Reports WHERE a term hit, never the term itself.
scan() {
  local n
  n=$(grep -c -i -F -f "$pats" || true)
  [ "${n:-0}" -eq 0 ] && return 0
  printf 'matter-guard: %s: %s line(s) match a confidential-matter term (list: %s).\n' "$1" "$n" "$terms" >&2
  return 1
}

added() { grep -a '^+' | grep -av '^+++ ' || true; }

case "$mode" in
  commit-msg)
    [ -n "${2:-}" ] || die "commit-msg needs the message file"
    msg=$(grep -v '^#' "$2" || true)
    if grep -qE "$override" <<<"$msg"; then
      echo "matter-guard: override in message ($(grep -m1 -E "$override" <<<"$msg")); not checked." >&2
      exit 0
    fi
    fail=0
    git diff --cached --no-color --no-ext-diff -U0 | added | scan "the staged change" || fail=1
    scan "the commit message" <<<"$msg" || fail=1
    [ "$fail" -eq 0 ] || die "commit refused. Remove the term, or add a line 'Matter-Override: <reason>' to the message. Find it: git diff --cached | grep -inFf $terms"
    ;;
  pre-push)
    zero=0000000000000000000000000000000000000000
    fail=0
    while read -r _lref lsha _rref _rsha; do
      [ "$lsha" = "$zero" ] && continue            # deleting a ref sends nothing
      for c in $(git rev-list "$lsha" --not --remotes); do
        if git log -1 --format=%B "$c" | grep -qE "$override"; then
          echo "matter-guard: $c carries Matter-Override; not checked." >&2
          continue
        fi
        { git show --no-color --no-ext-diff --format= -U0 "$c" | added; } | scan "commit $c" || fail=1
        git log -1 --format=%B "$c" | scan "the message of $c" || fail=1
      done
    done
    [ "$fail" -eq 0 ] || die "push refused. Rewrite those commits, or amend each with a 'Matter-Override: <reason>' line."
    ;;
  *) die "usage: matter-guard.sh commit-msg <file> | pre-push <remote> | install" ;;
esac
