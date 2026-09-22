#!/usr/bin/env bash
# Compatibility shim for the ralph -> grind rename (2026-09-22).
#
# A live loop hands every iteration this path in RALPH_SH, and an iteration uses it to append
# floors and progress. Moving the file without this would make those appends fail, so the loop
# would stop recording and then stall — the run would die of a rename.
#
# DELETE THIS, and the directory around it, once no loop started before the rename is still
# running. Residue that outlives its reason is indistinguishable from live code.
exec bash "$(dirname -- "$(realpath -- "${BASH_SOURCE[0]}")")/../../grind/scripts/grind.sh" "$@"
