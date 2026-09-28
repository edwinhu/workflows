#!/usr/bin/env bash
# TRANSITION SHIM. `craft` was renamed to `work`; every CRAFT_* env var is now WORK_*.
#
# Source this near the top of any work script that reads a WORK_* variable. It promotes each still-
# set CRAFT_* name onto its WORK_* successor. The NEW name always wins: a legacy name is read only
# when the successor is unset, so nothing a caller sets deliberately is overridden.
#
# Delete this file, and the `source` lines that reference it, once no caller sets CRAFT_* any more.
for _work_legacy_n in $(compgen -v CRAFT_ 2>/dev/null); do
  _work_legacy_w="WORK_${_work_legacy_n#CRAFT_}"
  [ -n "${!_work_legacy_w+x}" ] || export "$_work_legacy_w=${!_work_legacy_n}"
done
unset _work_legacy_n _work_legacy_w
