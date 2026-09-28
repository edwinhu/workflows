#!/usr/bin/env bash
# Rewrite the retired `craft:dispatch` plan marker to `work:dispatch` under one or more roots.
#
#   scripts/migrate-craft-to-work.sh ~/projects ~/areas      # DRY RUN — prints file:line, writes nothing
#   scripts/migrate-craft-to-work.sh --apply ~/projects      # rewrite in place
#
# Scope, deliberately narrow — PLAN FILES ONLY:
#   * a candidate must be a `*.md` file whose path contains a `.claude/plans/` or `.planning/`
#     directory component. Nothing else is a plan, and nothing else is rewritten.
#   * `.claude/worktrees/` is skipped: another branch's checkout may still run pre-rename code
#     that parses only `craft:dispatch`.
#   * a file inside a git checkout that contains `skills/craft/scripts/craft-dispatch.sh` is
#     skipped for the same reason — that checkout predates the rename.
#   * `CHANGELOG*`, `README*`, `PHILOSOPHY*`, anything under `docs/`, anything under `skills/`:
#     skipped. Those are history, documentation and plugin code, not plans; rewriting them
#     falsifies dated entries and edits shipped source.
#   * `.craft/` run directories are skipped: they hold live run history, and the args.json inside
#     them is hashed. Rewriting anything there would break a run in flight.
#   * anything under a `.git/` directory is skipped.
#   * with no root argument it refuses rather than defaulting to $PWD.
#
# Dry run prints the skipped counts by reason, so the scope is auditable before --apply.
set -uo pipefail

APPLY=0
ROOTS=()
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,23p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "unknown flag: $a" >&2; exit 2 ;;
    *) ROOTS+=("$a") ;;
  esac
done

if [ "${#ROOTS[@]}" -eq 0 ]; then
  echo "migrate-craft-to-work.sh: at least one root directory is required (it never defaults to \$PWD)" >&2
  exit 2
fi
for r in "${ROOTS[@]}"; do
  [ -d "$r" ] || { echo "no such directory: $r" >&2; exit 2; }
done

# Nearest enclosing git checkout of a path, or empty. Walked by hand rather than by `git -C`:
# candidates include untracked and ignored files, and one process per file is not worth it.
repo_root() {
  local d=$1
  while [ -n "$d" ] && [ "$d" != "/" ] && [ "$d" != "." ]; do
    if [ -e "$d/.git" ]; then echo "$d"; return 0; fi
    d=$(dirname "$d")
  done
  return 1
}

# `skills/craft/scripts/craft-dispatch.sh` present in a checkout means that checkout parses ONLY
# the old marker. Memoised per repo root — a tree has far fewer repos than plan files.
declare -A PRERENAME_CACHE=()
is_prerename_repo() {
  local top=$1
  if [ -z "${PRERENAME_CACHE[$top]+set}" ]; then
    if [ -f "$top/skills/craft/scripts/craft-dispatch.sh" ]; then
      PRERENAME_CACHE[$top]=1
    else
      PRERENAME_CACHE[$top]=0
    fi
  fi
  [ "${PRERENAME_CACHE[$top]}" = "1" ]
}

# One list of candidate files, filtered the same way in both modes so the dry run is honest about
# exactly what --apply would touch.
files=$(grep -rl --include='*.md' --exclude-dir='.git' --exclude-dir='.craft' \
          -e 'craft:dispatch' -- "${ROOTS[@]}" 2>/dev/null | sort -u)

declare -A SKIPPED=()
REASONS=(worktree changelog readme philosophy docs skills not-a-plan-file pre-rename-checkout)
for r in "${REASONS[@]}"; do SKIPPED[$r]=0; done

# Empty reason => rewrite it.
classify() {
  local f=$1 base
  base=$(basename "$f")
  case "/$f" in */.claude/worktrees/*) echo worktree; return ;; esac
  case "$base" in
    CHANGELOG*) echo changelog; return ;;
    README*) echo readme; return ;;
    PHILOSOPHY*) echo philosophy; return ;;
  esac
  case "/$f" in */docs/*) echo docs; return ;; esac
  case "/$f" in */skills/*) echo skills; return ;; esac
  case "/$f" in
    */.claude/plans/*|*/.planning/*) : ;;
    *) echo not-a-plan-file; return ;;
  esac
  local top
  if top=$(repo_root "$(dirname "$f")") && is_prerename_repo "$top"; then
    echo pre-rename-checkout; return
  fi
  echo ""
}

if [ -z "$files" ]; then
  echo "no plan file under ${ROOTS[*]} carries craft:dispatch — nothing to migrate."
  exit 0
fi

count=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  reason=$(classify "$f")
  if [ -n "$reason" ]; then
    SKIPPED[$reason]=$(( ${SKIPPED[$reason]} + 1 ))
    continue
  fi
  count=$((count + 1))
  if [ "$APPLY" -eq 1 ]; then
    perl -0pi -e 's/\bcraft:dispatch\b/work:dispatch/g' "$f" && echo "rewrote $f"
  else
    grep -n 'craft:dispatch' -- "$f" | sed "s|^|$f:|"
  fi
done <<< "$files"

skipped_total=0
for r in "${REASONS[@]}"; do skipped_total=$(( skipped_total + ${SKIPPED[$r]} )); done

if [ "$APPLY" -eq 1 ]; then
  echo "applied: $count file(s) rewritten; $skipped_total skipped."
else
  echo
  echo "skipped $skipped_total file(s) by reason:"
  for r in "${REASONS[@]}"; do
    printf '  %-20s %d\n' "$r" "${SKIPPED[$r]}"
  done
  echo
  echo "DRY RUN: $count file(s) would be rewritten. Pass --apply to write."
fi
