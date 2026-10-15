#!/usr/bin/env bash
# init_worktree_submodules WT ROOT — initialise every submodule of worktree WT from the modules
# ROOT already holds, so it works offline and reaches commits that were never pushed. A submodule ROOT
# has no module for falls back to its .gitmodules url. Returns non-zero (with the git error) on failure.
init_worktree_submodules() {
  local wt=$1 root=$2 mods name args=()
  mods=$(git -C "$root" rev-parse --absolute-git-dir)/modules
  [ -f "$wt/.gitmodules" ] || return 0
  while read -r name; do
    name=${name#submodule.}; name=${name%.url}
    [ -d "$mods/$name" ] && args+=(-c "submodule.$name.url=$mods/$name")
  done < <(git -C "$wt" config -f .gitmodules --name-only --get-regexp '^submodule\..*\.url$')
  git -C "$wt" -c protocol.file.allow=always "${args[@]}" submodule update --init --recursive
}
