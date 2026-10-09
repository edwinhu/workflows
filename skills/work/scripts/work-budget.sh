#!/usr/bin/env bash
# work-budget.sh ARGS — the weighted-token budget for a round's ONE farm.sh --workflow row.
#
# That row hosts every implementer and verifier of the round, so FARM_TASK_BUDGET alone capped all
# of them together: the 6-task 1007-nevada-otc round died at 4.10M, about 5 h in and before
# verification (2026-10-07). Prints one line, `budget: N tokensW (why)`; work-dispatch.sh shows it
# and work-round.sh passes N as --budget.
#
#   explicit   WORK_BUDGET, else args.budget (the plan's work:dispatch block)
#   computed   FARM_TASK_BUDGET x implementers + half of it per verifier + one for the host row
#
# Either is capped at FARM_SESSION_BUDGET minus one FARM_TASK_BUDGET: the lens row runs after this
# one in the same session, and farm.sh refuses a row once the session's spend reaches its budget.
set -uo pipefail
[[ $# -eq 1 ]] || { echo "usage: work-budget.sh ARGS" >&2; exit 2; }
python3 - "$1" <<'PY'
import json, os, sys
a = json.load(open(sys.argv[1]))
per = int(os.environ.get("FARM_TASK_BUDGET") or 4000000)
session = int(os.environ.get("FARM_SESSION_BUDGET") or 20000000)
cap = max(session - per, per)
explicit = os.environ.get("WORK_BUDGET") or a.get("budget")
if explicit not in (None, ""):
    want, why = int(explicit), "explicit"
else:
    t = a.get("tasks") or []
    only = a.get("onlyTasks")
    active = [x for x in t if x.get("id") in set(only)] if isinstance(only, list) else t
    ro = bool(a.get("readOnly"))
    impl = 0 if ro else len(active)
    ver = 0 if ro else sum(1 for x in active if not x.get("acceptanceCmd"))
    want = per * impl + per * ver // 2 + per
    why = f"computed: {per} x {impl} implementer(s) + {per // 2} x {ver} verifier(s) + {per} host"
budget = min(want, cap)
if budget < want:
    why += f"; capped at FARM_SESSION_BUDGET {session} less one {per} lens row"
print(f"budget: {budget} tokensW ({why})")
PY
