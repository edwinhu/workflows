#!/usr/bin/env bash
# Rewrite the retired `craft:dispatch` plan marker to `work:dispatch` under one or more roots.
#
#   scripts/migrate-craft-to-work.sh ~/projects ~/areas      # DRY RUN — prints file:line, writes nothing
#   scripts/migrate-craft-to-work.sh --apply ~/projects      # rewrite in place
#
# Scope, deliberately narrow:
#   * only `*.md` files, and only the `craft:dispatch` token inside them — run directories, env
#     vars and prose are NOT touched, because every reader still accepts the old spellings.
#   * `.craft/` run directories are skipped: they hold live run history, and the args.json inside
#     them is hashed. Rewriting anything there would break a run in flight.
#   * anything under a `.git/` directory is skipped.
#   * with no root argument it refuses rather than defaulting to $PWD.
set -uo pipefail

APPLY=0
ROOTS=()
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
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

# One list of candidate files, filtered the same way in both modes so the dry run is honest about
# exactly what --apply would touch.
files=$(grep -rl --include='*.md' --exclude-dir='.git' --exclude-dir='.craft' \
          -e 'craft:dispatch' -- "${ROOTS[@]}" 2>/dev/null | sort -u)

if [ -z "$files" ]; then
  echo "no plan file under ${ROOTS[*]} carries craft:dispatch — nothing to migrate."
  exit 0
fi

count=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  count=$((count + 1))
  if [ "$APPLY" -eq 1 ]; then
    perl -0pi -e 's/\bcraft:dispatch\b/work:dispatch/g' "$f" && echo "rewrote $f"
  else
    grep -n 'craft:dispatch' -- "$f" | sed "s|^|$f:|"
  fi
done <<< "$files"

if [ "$APPLY" -eq 1 ]; then
  echo "applied: $count file(s) rewritten."
else
  echo
  echo "DRY RUN: $count file(s) would be rewritten. Pass --apply to write."
fi
