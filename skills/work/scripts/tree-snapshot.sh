#!/usr/bin/env bash
# tree-snapshot.sh DIR — print the sha of a git tree holding DIR's repo as it stands now (HEAD plus every
# tracked change plus untracked, non-ignored files), built in a throwaway index. The real index, the
# working tree, HEAD and the stash are never touched (only loose objects are added). Prints nothing and
# exits 0 when DIR is not in a git repo, so a caller falls back to HEAD scoping.
set -uo pipefail
[ $# -eq 1 ] || { echo "usage: tree-snapshot.sh DIR" >&2; exit 2; }
top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) || exit 0
idx=$(mktemp "${TMPDIR:-/tmp}/tree-snapshot.XXXXXX") || exit 1
trap 'rm -f "$idx"' EXIT
export GIT_INDEX_FILE="$idx"
if git -C "$top" rev-parse -q --verify HEAD >/dev/null; then git -C "$top" read-tree HEAD || exit 1
else git -C "$top" read-tree --empty || exit 1; fi
git -C "$top" add -A >/dev/null || exit 1
git -C "$top" write-tree
