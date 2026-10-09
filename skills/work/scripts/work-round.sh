#!/usr/bin/env bash
# work-round.sh — one dispatched work round, end to end. The only agents are the workflow's and the
# ONE lens row; every command between them is a script.
#
#   work-round.sh ARGS RESULT CWD HOST
#
#   1. farm.sh --workflow           AGENTS stage: implementers (in waves) + verifiers -> RUN/raw.json
#   2. work-checks.sh               red-after, acceptanceCmds, mechanicalChecks, red-suite re-hash
#   3. work-stage.mjs digest        RUN/digest.{json,md} and RUN/rows.json (ONE row, kind review)
#   4. farm.sh --tasks rows.json    the lens, --provider = the row's own, so route.ts is not re-asked
#   5. work-stage.mjs assemble      RESULT, the contract work-result.sh adjudicates
#
# RUN is RESULT's directory. A missing lens.json is assembled anyway — workflow.js reads a lens that
# never reported as a CRITICAL. No raw.json means the agents never returned: no RESULT is written,
# exactly as a dead farm run left none before.
#
# Liveness: farm-alive.sh and the watcher mod (hooks/watch/watcher.ts) key on $TMPDIR/farm-events/<session>/<pid>.ndjson.
# The farm.sh children each write their own; this script writes one claiming RESULT, so the run is
# alive between children and a death with no DONE is reported. WORK_FARM overrides farm.sh.
set -uo pipefail

[[ $# -eq 4 ]] || { echo "usage: work-round.sh ARGS RESULT CWD HOST" >&2; exit 2; }
ARGS=$(realpath -m -- "$1"); RESULT=$(realpath -m -- "$2"); CWD=$3; HOST=$4
RUN=$(dirname "$RESULT")
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SKILL=$(cd "$HERE/.." && pwd)
FARM=${WORK_FARM:-$SKILL/../farm-out/scripts/farm.sh}

enc() { local s=${1-}; s=${s//%/%25}; s=${s// /%20}; s=${s//$'\t'/%09}; s=${s//=/%3D}; printf '%s' "$s"; }
EVENT_DIR="${TMPDIR:-/tmp}/farm-events${CLAUDE_CODE_SESSION_ID:+/$CLAUDE_CODE_SESSION_ID}"
mkdir -p "$EVENT_DIR" 2>/dev/null || true
EVENTS="$EVENT_DIR/$$.ndjson"
emit() { printf 'farm: %s\n' "$*" >>"$EVENTS" 2>/dev/null || true; }
emit "START work-round cwd=$(enc "$CWD") out=$(enc "$RESULT") expect=1 t=$(date +%s)"
emit "CLAIM work-round path=$(enc "$RESULT") "

step() { printf '\nwork-round: %s\n' "$*"; }
die() { printf 'work-round: %s\n' "$*" >&2; emit "DONE work-round fail $(enc "$*")"; exit 1; }

RAW="$RUN/raw.json" CHECKS="$RUN/checks.json" ROWS="$RUN/rows.json" LENS="$RUN/lens.json"
rm -f -- "$RAW" "$CHECKS" "$ROWS" "$LENS"

step "1/5 agents (farm.sh --workflow)"
# JEV_EDIT_MOD=1: the implementers are headless farm children, which the per-edit Jev mod (hooks/jev/)
# skips unless asked; they are the ones its feedback is for. The lens row below stays without it.
# --no-cron: the dispatcher (work-dispatch.sh) already printed this run's one backstop cron.
# --budget: this one row hosts every implementer and verifier, so it scales with the plan.
budget_line=$(bash "$HERE/work-budget.sh" "$ARGS") || die "work-budget.sh could not size the round"
echo "work-round: $budget_line"
JEV_EDIT_MOD=1 bash "$FARM" --provider "$HOST" --workflow "$SKILL/workflow.js" --args "$ARGS" --out "$RAW" --cwd "$CWD" --no-cron \
  --budget "$(awk '{print $2}' <<<"$budget_line")"
frc=$?
jq -e '.stage == "agents"' "$RAW" >/dev/null 2>&1 \
  || die "agents stage left no agents-stage $RAW (farm.sh exit $frc); see the log above"

step "2/5 checks (work-checks.sh)"
bash "$HERE/work-checks.sh" "$ARGS" "$RAW" "$CHECKS" || die "work-checks.sh failed; no checks to gate on"

step "3/5 digest (work-stage.mjs)"
bun "$HERE/work-stage.mjs" digest --args "$ARGS" --raw "$RAW" --checks "$CHECKS" --run "$RUN" \
  --provider "$HOST" --cwd "$CWD" || die "digest stage failed"

step "4/5 lens (ONE farm.sh row, kind review)"
lprov=$(jq -r '.[0].provider // empty' "$ROWS")
bash "$FARM" --provider "${lprov:-$HOST}" --tasks "$ROWS" --cwd "$CWD" \
  || echo "work-round: the lens row did not finish ok — assembling; the gate reads a missing lens as CRITICAL" >&2

step "5/5 gate (work-stage.mjs assemble)"
bun "$HERE/work-stage.mjs" assemble --args "$ARGS" --raw "$RAW" --checks "$CHECKS" --lens "$LENS" \
  --out "$RESULT" || die "assemble failed; no result written"
emit "DONE work-round ok"
echo "work-round: result -> $RESULT"
