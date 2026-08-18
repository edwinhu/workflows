#!/usr/bin/env bash
# Re-hash an amended plan into an existing args.json, and optionally re-dispatch craft.
#
# The FAIL loop is: fix, amend the plan, re-hash, re-dispatch. Doing that by hand is where a
# specHash gets typed from a stale copy, and where an args file drifts from the plan it names.
# The hash is over the plan's CANONICAL craft:dispatch spec (craft-dispatch.sh --spec-hash), so a
# prose-only amendment between rounds moves nothing.
#
# Re-hashing is not enough on its own, so this also RE-SYNCS the plan's `craft:dispatch` block into
# the args: `redCommand` is executed from args.json and `work` is what the implementer is handed, so
# a plan amendment that never reached the args is an amendment that never ran. Run-local keys
# (onlyTasks, priorResults, priorFindings, freezeFindingSet, maxAgents, maxRounds) are not in the
# plan and are preserved.
#
#   craft-redispatch.sh <plan.md> <args.json>              # re-hash only, print old -> new
#   craft-redispatch.sh <plan.md> <args.json> --dispatch   # re-hash, then dispatch detached
#   craft-redispatch.sh … --dispatch --full                # re-run every task, not just the flagged
#   craft-redispatch.sh … --dispatch --no-lint             # skip BOTH gates below
#   craft-redispatch.sh … --dispatch --no-red-probe        # skip only the red probe; keep plan-lint
#   CRAFT_REDISPATCH_DRYRUN=1                              # everything but the farm-out
#
# SELECTIVE RE-RUN, with --dispatch and derived here rather than remembered: `onlyTasks` is the
# previous verdict's `tasksThatFlagged` CLOSED UNDER TRANSITIVE DEPENDENTS, and `priorResults` (with
# `red`, so a carried task keeps its adjudication) carries everything else. The closure is the
# soundness condition: a carried "verified" for a task downstream of a re-run one was earned against
# code that no longer exists. A previous result that is absent, unreadable, or whose
# `tasksThatFlagged` cannot be parsed falls back to a FULL re-run and says so — a scope built from a
# verdict nobody could read is the vacuous pass craft exists to prevent. Lenses and mechanical checks
# judge the whole deliverable and are never narrowed.
#
# With --dispatch, the run directory is args.json's own directory; result.json there is rotated to
# result-<n>.json first so a stale verdict can never be read as this run's.
#
# FROZEN FINDING SET + ROUND CAP, both with --dispatch. On the advance to round 2 the previous
# verdict's surviving blocking findings are carried into `priorFindings` and `freezeFindingSet` is
# set, ONCE: from there the loop asks whether that carried set is closed (each entry is adversarially
# refuted every round) rather than whether this round's lenses raised anything. Fresh blocking lens
# findings are reported as `residue` and do not gate. `maxRounds` (default 3) is a hard stop: the
# dispatch that would exceed it is refused with exit 4, prints what is still open as a paste-ready
# priorFindings block for a fresh run, and hands the run to human review.
#
# TIER 1 GATE, mirroring craft-dispatch.sh: with --dispatch, plan-lint.ts runs on the FINAL args —
# after the plan block is re-synced and the counters advanced — and a major/critical exits 3. It
# fails CLOSED. The mutations are STAGED until it passes: a refusal spends no round, rotates no
# result and does not touch args.json, so the run is left exactly as it was.
set -euo pipefail

# Self-locating: the skill root is this script's parent, so the copy runs wherever it is installed.
SKILL=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# farm-out ships alongside craft; a sibling copy wins, an installed one is the fallback, and
# CRAFT_FARM overrides both. farm.ts installs its own SDK on first run.
FARM=${CRAFT_FARM:-}
if [ -z "$FARM" ]; then
  if [ -f "$SKILL/../farm-out/scripts/farm.ts" ]; then
    FARM="$SKILL/../farm-out/scripts/farm.ts"
  else
    FARM="$HOME/.claude/skills/farm-out/scripts/farm.ts"
  fi
fi

die() { printf 'craft-redispatch: %s\n' "$1" >&2; exit 1; }

[ $# -ge 2 ] || die "usage: craft-redispatch.sh <plan.md> <args.json> [--dispatch] [--no-lint]"
PLAN=$1; ARGS=$2; shift 2
DISPATCH=""; LINT=1; REDPROBE=1; FULL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dispatch) DISPATCH=--dispatch ;;
    --no-lint)  LINT=0; REDPROBE=0 ;;
    --no-red-probe) REDPROBE=0 ;;
    --full)     FULL=1 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

[ -f "$PLAN" ] || die "no such plan: $PLAN"
[ -f "$ARGS" ] || die "no such args file: $ARGS"

PLAN_ABS=$(realpath "$PLAN")
ARGS_ABS=$(realpath "$ARGS")
RUN_DIR=$(dirname "$ARGS_ABS")

NEW_HASH=$(bash "$SKILL/scripts/craft-dispatch.sh" --spec-hash "$PLAN_ABS") \
  || die "cannot hash the plan's craft:dispatch spec — see the message above"

# Patch in place via python3: jq is not guaranteed here, and a hand-rolled sed on JSON is how a
# 64-hex string ends up somewhere it does not belong.
# Staged beside args.json, never over it: the gate below has to be able to refuse without having
# already spent a round. Same directory, so plan-lint resolves the run dir the way it will at run time.
STAGE="$RUN_DIR/.args.redispatch.json"

OLD_HASH=$(python3 - "$ARGS_ABS" "$NEW_HASH" "$PLAN_ABS" "$STAGE" "$DISPATCH" <<'PY'
import json, sys
args_path, new_hash, plan_path, stage_path, dispatch = sys.argv[1:6]
try:
    with open(args_path) as fh:
        args = json.load(fh)
except json.JSONDecodeError as exc:
    sys.exit(f"args file is not valid JSON: {exc}")
if not isinstance(args, dict):
    sys.exit("args file is not a JSON object")

old = args.get("specHash", "(absent)")

# The args must name the plan being hashed; silently re-hashing a different file is the exact
# drift this script exists to prevent.
named = args.get("planPath")
if named and named != plan_path:
    sys.exit(f"args planPath is {named}, not the plan given ({plan_path})")

args.pop("planHash", None)
args["specHash"] = new_hash
args["planPath"] = plan_path

# The round counter the /goal escape clause names. In args.json, not beside it: existing state
# object, per the no-new-state-file rule. A corrupt value is refused, never reset — a reset
# silently restores the whole budget.
prev = args.get("rounds", 0)
if not isinstance(prev, int) or isinstance(prev, bool) or prev < 0:
    sys.exit(f"rounds in {args_path} is not a whole number: {prev!r} — refusing to reset it")
args["rounds"] = prev + 1

# The cap the round budget is spent against. Same treatment as the counter: refused, never reset.
cap = args.get("maxRounds", 3)
if not isinstance(cap, int) or isinstance(cap, bool) or cap < 1:
    sys.exit(f"maxRounds in {args_path} is not a positive whole number: {cap!r}")

# Re-sync the plan's dispatch block into the args. The hash authenticates the PLAN, but the
# executed instructions live HERE: `redCommand` is run from args.json, and `work` is what the
# implementer is handed. Re-hashing alone left an amended task at whatever the first
# craft-dispatch.sh built, so a fixed red gate kept running its stale predecessor and reported
# redNotRed against a test the author had already corrected.
#
# Run-local keys are NOT in the plan and are preserved: they are how a FAIL loop scopes its re-run.
RUN_LOCAL = {"onlyTasks", "priorResults", "priorFindings", "maxAgents", "rounds",
             "freezeFindingSet", "maxRounds"}
synced = []
try:
    import re
    block = re.search(r"<!--\s*craft:dispatch\s*\n(.*?)\n-->", open(plan_path).read(), re.S)
    plan_args = json.loads(block.group(1))["args"] if block else None
except (json.JSONDecodeError, KeyError, AttributeError) as exc:
    # A malformed block is reported, never silently ignored — but it does not erase the args:
    # dispatching nothing is worse than dispatching what the previous round already validated.
    print(f"WARNING: plan dispatch block unreadable ({exc}); tasks left as-is", file=sys.stderr)
    plan_args = None

if plan_args is not None:
    for key, value in plan_args.items():
        if key in RUN_LOCAL or key in ("planPath", "planHash", "specHash"):
            continue
        if args.get(key) != value:
            args[key] = value
            synced.append(key)

import os, re
run_dir = os.path.dirname(os.path.abspath(args_path))
live = os.path.join(run_dir, "result.json")
if os.path.exists(live):
    prev_result = live
else:
    rotated = sorted(
        (int(m.group(1)), os.path.join(run_dir, m.group(0)))
        for m in (re.fullmatch(r"result-round(\d+)\.json", f) for f in os.listdir(run_dir)) if m
    )
    prev_result = rotated[-1][1] if rotated else None

# ---- the frozen finding set ------------------------------------------------------------------
# From round 2 the question is whether the CARRIED blocking set is closed, not whether this round's
# lenses raised anything: the second is a draw from a generator whose rate does not fall as fixes
# land, so the loop terminates by luck. Round 1's blocking findings become priorFindings — each one
# adversarially refuted every round, kept when ambiguous — and freezeFindingSet holds fresh lens
# findings as residue instead of gating on them.
#
# Set ONCE. Never re-derived: re-deriving each round from the latest verdict is the accretion this
# exists to stop, and the set would then track the generator rather than freeze against it.
freeze_note = ""
if dispatch == "--dispatch" and args["rounds"] >= 2 and "priorFindings" not in args:
    carried, dropped = [], 0
    if prev_result:
        try:
            with open(prev_result) as fh:
                prev = json.load(fh)
            for f in prev.get("findings", []) or []:
                if not isinstance(f, dict) or f.get("severity") not in ("critical", "major"):
                    continue
                # workflow.js REFUSES a priorFinding missing any of these, which would kill the run
                # before an agent is dispatched. A malformed entry is dropped and counted, not passed on.
                if not (f.get("title") and f.get("detail")):
                    dropped += 1
                    continue
                entry = {"title": f["title"], "severity": f["severity"], "detail": f["detail"],
                         "lens": f.get("lens") or "carried"}
                if f.get("file"):
                    entry["file"] = f["file"]
                carried.append(entry)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"WARNING: previous result {prev_result} unreadable ({exc}); the finding set is NOT frozen",
                  file=sys.stderr)
            carried = None
    if carried is not None:
        args["priorFindings"] = carried
        args["freezeFindingSet"] = True
        freeze_note = (f"frozen:   {len(carried)} blocking finding(s) carried as priorFindings"
                       + (f" ({dropped} malformed dropped)" if dropped else "")
                       + " — fresh lens findings are residue this round, not gates")

with open(stage_path, "w") as fh:
    json.dump(args, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print(old)
print(args["rounds"])
print(prev_result or "")   # the verdict the selective re-run below scopes from — found once, here
print(args.get("maxRounds", 3))
print(freeze_note)
print("synced from plan: " + (", ".join(synced) if synced else "(already in sync)"))
PY
)
SYNCED=$(printf '%s\n' "$OLD_HASH" | tail -1)
ROUND=$(printf '%s\n' "$OLD_HASH" | sed -n 2p)
PREV_RESULT=$(printf '%s\n' "$OLD_HASH" | sed -n 3p)
MAX_ROUNDS=$(printf '%s\n' "$OLD_HASH" | sed -n 4p)
FREEZE_NOTE=$(printf '%s\n' "$OLD_HASH" | sed -n 5p)
OLD_HASH=$(printf '%s\n' "$OLD_HASH" | head -1)

printf 'plan:     %s\n' "$PLAN_ABS"
printf 'round:    %s of %s\n' "$ROUND" "$MAX_ROUNDS"
printf 'specHash: %s -> %s\n' "${OLD_HASH:0:16}" "${NEW_HASH:0:16}"
printf '%s\n' "$SYNCED"
[ -z "$FREEZE_NOTE" ] || printf '%s\n' "$FREEZE_NOTE"

# ---------------------------------------------------------------- the self-eval, then the cap
# ADVISORY, and before the cap so a capped run carries the diagnosis in the same output. Triggered by
# round count or by elapsed time since the run dir's oldest archive — both derived from files that
# already exist. A NOT CONVERGING verdict gates nothing; the cap below is what stops a run.
if [ "$DISPATCH" = "--dispatch" ]; then
  AGE=$(python3 -c '
import glob, os, sys, time
fs = glob.glob(sys.argv[1] + "/result-round*.json") + glob.glob(sys.argv[1] + "/plan-*.md")
print(int(time.time() - min(os.path.getmtime(f) for f in fs)) if fs else 0)' "$RUN_DIR") || AGE=0
  if [ "$ROUND" -ge 3 ] || [ "$AGE" -gt 7200 ]; then
    printf '\nself-eval (advisory) — computed from this run dir, gates nothing:\n'
    bun "$SKILL/scripts/converge-check.ts" "$RUN_DIR" || true
    printf '\n'
  fi
fi

# The cap. A fix loop whose exit condition is "this round raised nothing" terminates by luck, so the
# budget is finite and spending it is a decision for a human, not another round. Refuses BEFORE
# anything is committed: no round spent, no result rotated, no plan archived, args.json untouched.
if [ "$DISPATCH" = "--dispatch" ] && [ "$ROUND" -gt "$MAX_ROUNDS" ]; then
  rm -f "$STAGE"
  {
    printf '\nBLOCKED: round %s would exceed maxRounds %s. Nothing dispatched; the run stays armed.\n' "$ROUND" "$MAX_ROUNDS"
    printf 'Nothing was spent: args.json is unchanged, the counters above were NOT written, result.json is unrotated.\n'
    printf 'Take what is still open to HUMAN REVIEW. What survived the last round, as a paste-ready\n'
    printf 'priorFindings block for a fresh craft run (residue first — those never gated):\n\n'
    if [ -n "$PREV_RESULT" ] && [ -f "$PREV_RESULT" ]; then
      python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as fh: r = json.load(fh)
except (OSError, json.JSONDecodeError) as exc:
    sys.exit(f"  (the previous result is unreadable: {exc})")
seen, out = set(), []
for f in list(r.get("residue") or []) + list(r.get("findings") or []):
    if not isinstance(f, dict) or f.get("severity") not in ("critical", "major"): continue
    if not (f.get("title") and f.get("detail")) or f["title"] in seen: continue
    seen.add(f["title"])
    e = {"title": f["title"], "severity": f["severity"], "detail": f["detail"], "lens": f.get("lens") or "carried"}
    if f.get("file"): e["file"] = f["file"]
    out.append(e)
print(json.dumps({"priorFindings": out}, indent=2, ensure_ascii=False))' "$PREV_RESULT"
    else
      printf '  (no previous result in %s to read the open findings from)\n' "$RUN_DIR"
    fi
    printf '\nOverride, once a human has decided another round is worth it:\n'
    printf '  add "maxRounds": <n> to %s\n' "$ARGS_ABS"
  } >&2
  exit 4
fi
[ "$OLD_HASH" != "$NEW_HASH" ] || printf 'note:     spec hash unchanged — the dispatch block was not edited\n'

# ---------------------------------------------------------------- the selective re-run, derived
# On the staged args, so a gate below can still refuse without having committed the scope. Only on
# the --dispatch path: a re-hash-only call syncs a plan, it does not restructure a run.
#
# The dependency traversal reuses plan-lint.ts's `parseArgs` (the one normalisation of `dependsOn`)
# and its `taskGraph` (the layering craft-dispatch.sh prints and workflow.js schedules by), so the
# graph closed over here is the graph that will run. A cycle is refused by falling back, not by
# laying out half of an unschedulable plan.
if [ "$DISPATCH" = "--dispatch" ]; then
  SEL=$(CRAFT_SEL_STAGE="$STAGE" CRAFT_SEL_PREV="$PREV_RESULT" CRAFT_SEL_FULL="$FULL" CRAFT_SKILL="$SKILL" bun -e '
import { readFileSync, writeFileSync } from "node:fs"
const { parseArgs, taskGraph } = await import(process.env.CRAFT_SKILL + "/scripts/plan-lint.ts")

const stage = process.env.CRAFT_SEL_STAGE!
const prevPath = process.env.CRAFT_SEL_PREV || ""
const args = JSON.parse(readFileSync(stage, "utf8"))

const commit = (lines: string[]) => {
  writeFileSync(stage, JSON.stringify(args, null, 2) + "\n")
  console.log(lines.join("\n"))
  process.exit(0)
}
const fullRun = (why: string) => {
  delete args.onlyTasks
  delete args.priorResults
  commit([`selection: FULL re-run — ${why}`])
}

if (process.env.CRAFT_SEL_FULL === "1") fullRun("--full was given")
if (args.readOnly) fullRun("readOnly run — there is no task channel to scope")
if (!prevPath) fullRun("no previous result.json or result-round<N>.json in the run dir to scope from")

let prev: any
try {
  prev = JSON.parse(readFileSync(prevPath, "utf8"))
} catch (e) {
  fullRun(`previous result ${prevPath} is unreadable (${(e as Error).message})`)
}
if (!prev || typeof prev !== "object") fullRun(`previous result ${prevPath} is not a JSON object`)

const flagged = prev.tasksThatFlagged
if (!Array.isArray(flagged) || flagged.some((x: unknown) => typeof x !== "string"))
  fullRun(`previous result ${prevPath} has no readable tasksThatFlagged`)
if (flagged.length === 0)
  fullRun("the previous verdict flagged no task — a readOnly run, or a FAIL carried entirely by lenses or mechanical checks, which name no task to scope to")

const tasks = parseArgs(args).tasks
const byId = new Map(tasks.map(t => [t.id, t]))
const unknown = flagged.filter((id: string) => !byId.has(id))
if (unknown.length) fullRun(`the previous verdict flags ${unknown.join(", ")}, absent from tasks[]`)
if (taskGraph(tasks).cycle)
  fullRun(`dependsOn cycle among ${taskGraph(tasks).cycle!.join(", ")} — dependents cannot be closed`)

const rec = (k: string) => (Array.isArray(prev[k]) ? prev[k] : [])
const has = (k: string, id: string) => rec(k).some((r: any) => r && r.id === id)
/** A carried task must be PROVEN settled by the previous verdict, or it is not independent. */
const settled = (t: { id: string; redCommand: string | null }) =>
  has("implemented", t.id) && has("verified", t.id) && (!t.redCommand || has("red", t.id))

const why = new Map<string, string>(flagged.map((id: string) => [id, "flagged"]))
const selected = new Set<string>(flagged)
for (;;) {
  // Transitive dependents: anything reading a re-run task’s output was verified against code that
  // is about to change, so its carried verdict is stale.
  let grew = false
  for (const t of tasks)
    if (!selected.has(t.id) && t.dependsOn.some(d => selected.has(d))) {
      selected.add(t.id); why.set(t.id, "dependent"); grew = true
    }
  if (grew) continue
  const unproven = tasks.filter(t => !selected.has(t.id) && !settled(t))
  if (!unproven.length) break
  for (const t of unproven) { selected.add(t.id); why.set(t.id, "unproven") }
}

const pick = (label: string) => tasks.filter(t => why.get(t.id) === label).map(t => t.id)
const only = tasks.filter(t => selected.has(t.id)).map(t => t.id)
const carried = tasks.filter(t => !selected.has(t.id)).map(t => t.id)
if (!carried.length) fullRun(`every task is selected (${only.join(", ")}) — nothing left to carry`)

const carry = (k: string) => rec(k).filter((r: any) => r && carried.includes(r.id))
args.onlyTasks = only
args.priorResults = { implemented: carry("implemented"), verified: carry("verified"), red: carry("red") }

const lines = [`selection: ${only.length} of ${tasks.length} tasks re-run — ${only.join(", ")}`,
  `  flagged by ${prevPath.replace(/^.*\//, "")}: ${pick("flagged").join(", ")}`]
if (pick("dependent").length) lines.push(`  + transitive dependents:  ${pick("dependent").join(", ")}`)
if (pick("unproven").length)
  lines.push(`  + unproven if carried:    ${pick("unproven").join(", ")} (the previous verdict settles no implemented/verified/red record for them)`)
lines.push(`  carried with their red adjudication: ${carried.join(", ")}`)
lines.push("  lenses and mechanical checks judge the whole deliverable and are NOT narrowed")
commit(lines)
') || die "selective re-run derivation failed — refusing to dispatch an unscoped round"
  printf '%s\n' "$SEL"
fi

# TIER 1, on the staged args and before anything is committed. plan-lint exits 1 when it HAS
# findings and 2 when it cannot read the run, and pipefail is on: never read a pipeline's status
# here, and never fall back to 0 — a gate that cannot count must fail CLOSED.
if [ "$DISPATCH" = "--dispatch" ] && [ "$LINT" = 1 ]; then
  bun "$SKILL/scripts/plan-lint.ts" "$STAGE" || true
  lint_json=$(bun "$SKILL/scripts/plan-lint.ts" "$STAGE" --json 2>/dev/null) || true
  blocking=$(printf '%s' "$lint_json" | python3 -c \
    'import json,sys; f=json.load(sys.stdin)["findings"]; print(sum(1 for x in f if x["severity"] in ("critical","major")))' 2>/dev/null) || true
  case "$blocking" in
    ''|*[!0-9]*)
      echo "plan-lint did not return a countable verdict — refusing to dispatch unlinted." >&2
      rm -f "$STAGE"; exit 3 ;;
  esac
  if [ "$blocking" -gt 0 ]; then
    rm -f "$STAGE"
    cat >&2 <<MSG

BLOCKED: $blocking major/critical plan-lint finding(s). Nothing dispatched; the run stays armed.
Nothing was spent: args.json is unchanged, the counters above were NOT written, result.json is unrotated.
These are decidable from the plan's own fields — fix the plan, then re-run this command.
Also run, on a quiet tree:  bun $SKILL/scripts/plan-preflight.ts "$PLAN_ABS" --cwd "$(pwd)"
Override (records nothing, gates nothing): craft-redispatch.sh $PLAN_ABS $ARGS_ABS --dispatch --no-lint
MSG
    exit 3
  fi
fi

# TIER 2, on the staged args and still before anything is committed: the same probe craft-dispatch.sh
# runs, invoked as its subcommand so there is one implementation of the classification.
if [ "$DISPATCH" = "--dispatch" ] && [ "$REDPROBE" = 1 ]; then
  bash "$SKILL/scripts/craft-dispatch.sh" --red-probe "$STAGE" || {
    rp=$?
    rm -f "$STAGE"
    printf '\nNothing was spent: args.json is unchanged, the counters above were NOT written, result.json is unrotated.\n' >&2
    exit "$rp"
  }
fi

mv "$STAGE" "$ARGS_ABS"

# The plan, archived with the round that will run under it — the FAIL loop amends the plan every
# round, and `.claude/plans/` preserves none of them. Only on --dispatch: a re-hash-only call runs
# nothing, so it has no round to archive against. One implementation, in craft-dispatch.sh.
if [ "$DISPATCH" = "--dispatch" ]; then
  bash "$SKILL/scripts/craft-dispatch.sh" --archive-plan "$PLAN_ABS" "$RUN_DIR" "$NEW_HASH"
fi

# The same red column craft-dispatch.sh prints, from its one implementation: gated vs dispositioned,
# each disposition echoed so a task carrying one is visible rather than silently ungated.
bash "$SKILL/scripts/craft-dispatch.sh" --red-summary "$ARGS_ABS"

[ "$DISPATCH" = "--dispatch" ] || exit 0

RESULT="$RUN_DIR/result.json"
if [ -e "$RESULT" ]; then
    n=1
    while [ -e "$RUN_DIR/result-round$n.json" ]; do n=$((n+1)); done
    mv "$RESULT" "$RUN_DIR/result-round$n.json"
    printf 'rotated:  result.json -> result-round%s.json\n' "$n"
fi

# Exercises everything above — sync, counters, gate, rotation — and stops before farming out.
[ -n "${CRAFT_REDISPATCH_DRYRUN:-}" ] && { echo "CRAFT_REDISPATCH_DRYRUN: nothing dispatched."; exit 0; }

LOG="$RUN_DIR/run-$(date +%H%M%S).log"
setsid nohup bun "$FARM" \
    --workflow "$SKILL/workflow.js" \
    --args "$ARGS_ABS" --out "$RESULT" --cwd "$(pwd)" \
    > "$LOG" 2>&1 < /dev/null &

printf 'dispatched, log: %s\n' "$LOG"
printf 'wait with a Monitor on %s, then run craft-result.sh on it\n' "$RESULT"
