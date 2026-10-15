#!/usr/bin/env bash
# tree-snapshot.sh [--objects OBJDIR] DIR — print the sha of a git tree holding DIR's repo as it stands now (HEAD plus every
# tracked change plus untracked, non-ignored files), built in a throwaway index. The real index, the
# working tree, HEAD and the stash are never touched (only loose objects are added). Prints nothing and
# exits 0 when DIR is not in a git repo, so a caller falls back to HEAD scoping.
# --objects OBJDIR writes the new objects to OBJDIR instead (the repo's own store is read as an alternate), so
# a readOnly run's tree is snapshotted without adding a byte under its .git; OBJDIR is created if absent.
set -uo pipefail
objs=""
if [ "${1:-}" = "--objects" ]; then [ $# -ge 2 ] || { echo "usage: tree-snapshot.sh [--objects OBJDIR] DIR" >&2; exit 2; }; objs=$2; shift 2; fi
[ $# -eq 1 ] || { echo "usage: tree-snapshot.sh [--objects OBJDIR] DIR" >&2; exit 2; }
top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ -n "$objs" ]; then
  mkdir -p "$objs" || exit 1
  repo_objs=$(git -C "$top" rev-parse --path-format=absolute --git-path objects) || exit 1
  export GIT_ALTERNATE_OBJECT_DIRECTORIES="$repo_objs" GIT_OBJECT_DIRECTORY="$(cd "$objs" && pwd)"
fi
idx=$(mktemp "${TMPDIR:-/tmp}/tree-snapshot.XXXXXX") || exit 1
trap 'rm -f "$idx"' EXIT
export GIT_INDEX_FILE="$idx"
if git -C "$top" rev-parse -q --verify HEAD >/dev/null; then git -C "$top" read-tree HEAD || exit 1
else git -C "$top" read-tree --empty || exit 1; fi
git -C "$top" add -A >/dev/null || exit 1
git -C "$top" write-tree
