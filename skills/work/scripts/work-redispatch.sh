#!/usr/bin/env bash
# Re-sync and re-hash the plan's canonical work:dispatch spec into args.json.
#
#   work-redispatch.sh <plan.md> <args.json>              # re-hash only
#   work-redispatch.sh … --dispatch                      # dispatch detached
#   work-redispatch.sh … --dispatch --full                # re-run every task
#   work-redispatch.sh … --dispatch --no-lint             # skip lint and red probe
#   work-redispatch.sh … --dispatch --no-red-probe        # keep lint, skip red probe
#   work-redispatch.sh … --dispatch --provider codex      # whole-round override; without it the
#                                                         # kind map is re-resolved via route.ts
#   WORK_REDISPATCH_DRYRUN=1                              # gates only; write nothing
#   WORK_FARM=PATH                                        # farm.sh override
#   WORK_NO_SCOPE=1                                       # plain setsid dispatch
#   WORK_SYSTEMD_RUN=PATH                                 # scope probe override
#
# Selection is closed under transitive dependents: their verification predates the upstream fix.
# Blocking findings map by ownerTask, then location-stripped file containment in writablePaths.
# Mechanical failures narrow only with a valid lens route. Unreadable results and unmapped items
# fall back to FULL. The lens and mechanical checks always judge the whole deliverable.
#
# Proven red survives FULL round >= 2 only for the same command: fixed code cannot reproduce RED.
# Unchanged spec + planFindings refuses with exit 3. All-plan routing after an amendment permits
# onlyTasks: [] only when every task is carried. taskFixes delivers routed items to their implementers.
#
# From round 2, carriedFindings holds the previous verdict's blocking survivors, with evidenced
# closes removed; priorFindings remains the external-claims channel. freezeFindingSet defers fresh
# lens findings to residue. maxRounds (default 6) refuses the next round with exit 4 and prints a
# paste-ready priorFindings block containing still-open carried entries and residue for human review.
#
# Mutations are staged until both gates pass: a refusal spends no round and rotates no result.
# Dispatch rotates result.json to result-round<N>.json inside args.json's run directory.
set -euo pipefail


# Self-locating: the skill root is this script's parent, so the copy runs wherever it is installed.
SKILL=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# farm-out ships alongside work; a sibling copy wins, an installed one is the fallback, and
# WORK_FARM overrides both.
FARM=${WORK_FARM:-}
if [ -z "$FARM" ]; then
  if [ -f "$SKILL/../farm-out/scripts/farm.sh" ]; then
    FARM="$SKILL/../farm-out/scripts/farm.sh"
  else
    # farm-out is a skill INSIDE this plugin, so the installed path carries the plugin
    # segment. The old fallback, $HOME/.claude/skills/farm-out/..., resolves nowhere and
    # would have failed at exactly the moment the sibling lookup did.
    FARM="$HOME/.claude/skills/workflows/skills/farm-out/scripts/farm.sh"
  fi
fi

die() { printf 'work-redispatch: %s\n' "$1" >&2; exit 1; }

[ $# -ge 2 ] || die "usage: work-redispatch.sh <plan.md> <args.json> [--dispatch] [--no-lint]"
PLAN=$1; ARGS=$2; shift 2
DISPATCH=""; LINT=1; REDPROBE=1; FULL=0
# See work-dispatch.sh for what this actually swaps. Per-invocation, never sticky: a round inherits
# nothing from its predecessor. Empty means the claude wrapper hosts the round and args.routing is
# re-resolved through route.ts, so a refreshed table takes effect next round.
PROVIDER=""
while [ $# -gt 0 ]; do
  case "$1" in
    # Boolean. A provider after it is the --provider flag misspelled; say so rather than dying on
    # "unknown argument: codex" two iterations later.
    --dispatch) DISPATCH=--dispatch
                case "${2:-}" in claude|codex|gemini)
                  die "--dispatch is a boolean; the provider is a separate flag: --dispatch --provider $2" ;; esac ;;
    --provider) shift; PROVIDER="${1:-}"
                case "$PROVIDER" in claude|codex|gemini) ;;
                  *) die "--provider must be claude|codex|gemini, got: ${PROVIDER:-(empty)}" ;; esac ;;
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

NEW_HASH=$(bash "$SKILL/scripts/work-dispatch.sh" --spec-hash "$PLAN_ABS") \
  || die "cannot hash the plan's work:dispatch spec — see the message above"

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
cap = args.get("maxRounds", 6)
if not isinstance(cap, int) or isinstance(cap, bool) or cap < 1:
    sys.exit(f"maxRounds in {args_path} is not a positive whole number: {cap!r}")

# Re-sync the plan's dispatch block into the args. The hash authenticates the PLAN, but the
# executed instructions live HERE: `redCommand` is run from args.json, and `work` is what the
# implementer is handed. Re-hashing alone left an amended task at whatever the first
# work-dispatch.sh built, so a fixed red gate kept running its stale predecessor and reported
# redNotRed against a test the author had already corrected.
#
# Run-local keys are NOT in the plan and are preserved: they are how a FAIL loop scopes its re-run.
# `carriedFindings` and `taskFixes` are derived from the PREVIOUS VERDICT below and in the selection
# block; a plan never declares either, so syncing them would mean deleting the round's own carry.
RUN_LOCAL = {"onlyTasks", "priorResults", "priorFindings", "carriedFindings", "taskFixes",
             "maxAgents", "rounds", "freezeFindingSet", "maxRounds"}
synced = []
try:
    import re
    block = re.search(r"<!--\s*work:dispatch\s*\n(.*?)\n-->", open(plan_path).read(), re.S)
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
    # The ONE key the sync has to be able to REMOVE. `reviewLenses` is refused outright by workflow.js,
    # so an args file carrying it from an earlier round while the amended plan declares `lens` throws
    # before a single agent is dispatched — the round cannot run at all, on a plan that is correct. The
    # sync otherwise only ever sets keys, which is why this needs saying once rather than generalising.
    if "reviewLenses" not in plan_args and args.pop("reviewLenses", None) is not None:
        synced.append("-reviewLenses (retired; the plan declares no such key)")

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

# ---- the carried finding set ------------------------------------------------------------------
# Only an evidenced closed ruling removes a carried entry; silence keeps it open.
# Preserve ids across rounds so the lens's ruling continues to name the same finding.
freeze_note = ""
if dispatch == "--dispatch" and args["rounds"] >= 2:
    import hashlib
    BLOCKING = ("critical", "major")

    def mint(f):
        """A stable id from what identifies the finding, for an entry that arrived without one."""
        raw = "|".join([str(f.get("lens") or "carried"), str(f.get("title") or ""),
                        str(f.get("file") or "")])
        return "c-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]

    def normalise(f):
        """A carriedFindings entry, or None when workflow.js would refuse it."""
        if not isinstance(f, dict) or f.get("severity") not in BLOCKING:
            return None
        # workflow.js REFUSES a carried entry missing any of these, which would kill the run before an
        # agent is dispatched. A malformed entry is dropped and counted, not passed on.
        if not (f.get("title") and f.get("detail")):
            return None
        fid = f.get("id")
        entry = {"id": fid if isinstance(fid, str) and fid.strip() else mint(f),
                 "title": f["title"], "severity": f["severity"], "detail": f["detail"],
                 "lens": f.get("lens") or "carried"}
        # `file` scopes the next round and `ownerTask` narrows it — both are load-bearing downstream, so
        # losing either here is losing the narrowing the one-lens gate exists to provide.
        if f.get("file"):
            entry["file"] = f["file"]
        if isinstance(f.get("ownerTask"), str) and f["ownerTask"].strip():
            entry["ownerTask"] = f["ownerTask"].strip()
        return entry

    # External claims remain in priorFindings; copying them into the carry duplicates the spine's ids.
    was = list(args.get("carriedFindings") or [])
    external = list(args.get("priorFindings") or [])
    carried, dropped, closed = None, 0, 0
    if prev_result:
        try:
            with open(prev_result) as fh:
                prev = json.load(fh)
            if not isinstance(prev, dict):
                raise ValueError("the previous result is not a JSON object")
            rulings = prev.get("carried") or []
            external_ids = {f.get("id") for f in external + rulings
                            if isinstance(f, dict) and f.get("id")
                            and (f in external or f.get("source") == "prior")}
            # Legacy returns may lack source/id. Match id-less external claims by provenance.
            def identity(f):
                return (f.get("lens") or "carried", f.get("title"), f.get("file") or "")
            external_keys = {identity(f) for f in external if isinstance(f, dict) and not f.get("id")}
            def is_external(f):
                return (f.get("source") == "prior" or f.get("id") in external_ids
                        or identity(f) in external_keys)
            ruled_closed = {f.get("id") for f in rulings
                            if isinstance(f, dict) and f.get("status") == "closed"
                            and isinstance(f.get("evidence"), str) and f["evidence"].strip()}
            closed = len([i for i in ruled_closed if i and i not in external_ids])
            carried, seen = [], set()
            # Silence never closes a carried entry, including when it was not echoed in findings.
            for f in list(prev.get("findings") or []) + was:
                if isinstance(f, dict) and is_external(f):
                    continue
                entry = normalise(f)
                if entry is None:
                    if isinstance(f, dict) and f.get("severity") in BLOCKING:
                        dropped += 1
                    continue
                if entry["id"] in seen or entry["id"] in ruled_closed:
                    continue
                seen.add(entry["id"])
                carried.append(entry)
        except (OSError, ValueError) as exc:
            print(f"WARNING: previous result {prev_result} unreadable ({exc}); the carried set is unchanged",
                  file=sys.stderr)
            carried = None
    if carried is not None:
        args["carriedFindings"] = carried
        args["freezeFindingSet"] = True
        freeze_note = (f"carried:  {len(carried)} blocking finding(s) as carriedFindings"
                       + (f" ({closed} ruled closed with evidence last round and dropped)" if closed else "")
                       + (f" ({dropped} malformed dropped)" if dropped else "")
                       + " — fresh lens findings are residue this round, not gates")
    else:
        # The previous result was unreadable, so nothing could be re-derived. Whatever the LAST round
        # carried is left EXACTLY as it was, and `freezeFindingSet` with it. Emptying the carried set
        # while the freeze stays on would leave the freeze's only gating channel empty and hold every
        # fresh blocking finding as residue — the round would PASS on a set nobody could read, which is
        # precisely the vacuous pass the freeze exists inside a gate to prevent.
        freeze_note = ("carried:  UNCHANGED — the previous verdict could not be read, so the carried set "
                       f"is left at the {len(args.get('carriedFindings') or [])} entry(ies) the last round set")
else:
    # Round 1, or a re-hash that dispatches nothing: there is no previous verdict to carry from, and a
    # carry left over from an earlier run is not this round's evidence.
    args.pop("carriedFindings", None)

with open(stage_path, "w") as fh:
    json.dump(args, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print(old)
print(args["rounds"])
print(prev_result or "")   # the verdict the selective re-run below scopes from — found once, here
print(args.get("maxRounds", 6))
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
# Round 3 is the earliest trigger because two results is the earliest a round can be seen to REPEAT
# its predecessor's failure — the signal that says the brief is wrong rather than the implementer.
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
    printf 'priorFindings block for a fresh work run — the CARRIED entries the lens could not close, the\n'
    printf 'standing findings, and the RESIDUE (blocking findings the freeze held out of the verdict, so\n'
    printf 'they gated nothing and would otherwise be lost). `priorFindings` is the door for a FRESH run;\n'
    printf 'inside a run the same pool arrives as `carriedFindings`:\n\n'
    python3 - "$PREV_RESULT" "$ARGS_ABS" <<'PY'
import json, sys
with open(sys.argv[2]) as fh:
    a = json.load(fh)
r = {}
if sys.argv[1]:
    try:
        with open(sys.argv[1]) as fh:
            r = json.load(fh)
        if not isinstance(r, dict):
            raise ValueError("the previous result is not a JSON object")
    except (OSError, ValueError) as exc:
        print(f"  (the previous result is unreadable: {exc}; retaining the input carry)", file=sys.stderr)
        r = {}
# Include the input carry: a verdict omitting an entry is not a ruling that closed it.
rulings = r.get("carried") or []
closed = {f.get("id") for f in rulings if isinstance(f, dict) and f.get("status") == "closed"
          and isinstance(f.get("evidence"), str) and f["evidence"].strip()}
carried_open = [f for f in rulings if isinstance(f, dict) and f.get("id") not in closed]
seen, out = set(), []
pool = (list(r.get("residue") or []) + carried_open + list(r.get("findings") or [])
        + list(a.get("carriedFindings") or []) + list(a.get("priorFindings") or []))
for f in pool:
    if not isinstance(f, dict) or f.get("severity") not in ("critical", "major"): continue
    if not (f.get("title") and f.get("detail")) or f.get("id") in closed: continue
    k = f["id"] if isinstance(f.get("id"), str) and f["id"].strip() else f["title"]
    if k in seen: continue
    seen.add(k)
    e = {"title": f["title"], "severity": f["severity"], "detail": f["detail"], "lens": f.get("lens") or "carried"}
    if isinstance(f.get("id"), str) and f["id"].strip(): e["id"] = f["id"]
    if f.get("file"): e["file"] = f["file"]
    if isinstance(f.get("ownerTask"), str) and f["ownerTask"].strip(): e["ownerTask"] = f["ownerTask"]
    out.append(e)
print(json.dumps({"priorFindings": out}, indent=2, ensure_ascii=False))
PY
    printf '\nOverride, once a human has decided another round is worth it:\n'
    printf '  add "maxRounds": <n> to %s\n' "$ARGS_ABS"
  } >&2
  exit 4
fi
HASH_CHANGED=1
if [ "$OLD_HASH" = "$NEW_HASH" ]; then
  HASH_CHANGED=0
  printf 'note:     spec hash unchanged — the dispatch block was not edited\n'
fi

# Plan-owned findings cannot close under the same spec: refuse before committing any mutation.
if [ "$DISPATCH" = "--dispatch" ] && [ "$HASH_CHANGED" = 0 ] \
   && [ -n "$PREV_RESULT" ] && [ -f "$PREV_RESULT" ]; then
  PLAN_ROUTED=$(python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as fh: r = json.load(fh)
except (OSError, json.JSONDecodeError):
    raise SystemExit(0)      # unreadable is the FULL-re-run fallback below, not this refusal
items = r.get("planFindings")
if not isinstance(items, list) or not items:
    raise SystemExit(0)
paths, lines = [], []
for x in items:
    if not isinstance(x, dict):
        lines.append(f"  - {x}")
        continue
    what = x.get("title") or x.get("failure") or x.get("id") or "(unlabelled item)"
    where = x.get("file") or ""
    if where:
        paths.append(str(where))
    lines.append(f"  - {what}" + (f" [{where}]" if where else " (names no file)"))
print(len(items))
print(", ".join(dict.fromkeys(paths)) or "(none named)")
print("\n".join(lines))' "$PREV_RESULT") || PLAN_ROUTED=""
  if [ -n "$PLAN_ROUTED" ]; then
    rm -f "$STAGE"
    {
      printf '\nBLOCKED: %s item(s) in %s are routed to the PLAN, and the spec hash is unchanged.\n' \
        "$(printf '%s\n' "$PLAN_ROUTED" | head -1)" "$PREV_RESULT"
      printf 'Nothing dispatched; the run stays armed. Nothing was spent: args.json is unchanged, the\n'
      printf 'counters above were NOT written, result.json is unrotated.\n'
      printf '%s\n' "$(printf '%s\n' "$PLAN_ROUTED" | tail -n +3)"
      printf "amend the plan: add <path> to a task's writablePaths (or reword), then re-hash\n"
      printf '  path(s) named: %s\n' "$(printf '%s\n' "$PLAN_ROUTED" | sed -n 2p)"
      printf 'No task can close these: re-dispatching the same brief re-derives the same gap, and FULL\n'
      printf 'would re-probe red commands the last round already fixed. Amend, then run this command again.\n'
    } >&2
    exit 3
  fi
fi

# ---------------------------------------------------------------- the selective re-run, derived
# On the staged args, so a gate below can still refuse without having committed the scope. Only on
# the --dispatch path: a re-hash-only call syncs a plan, it does not restructure a run.
#
# The dependency traversal reuses plan-lint.ts's `parseArgs` (the one normalisation of `dependsOn`)
# and its `taskGraph` (the layering work-dispatch.sh prints and workflow.js schedules by), so the
# graph closed over here is the graph that will run. A cycle is refused by falling back, not by
# laying out half of an unschedulable plan.
if [ "$DISPATCH" = "--dispatch" ]; then
  SEL=$(WORK_SEL_STAGE="$STAGE" WORK_SEL_PREV="$PREV_RESULT" WORK_SEL_FULL="$FULL" \
        WORK_SEL_ROUND="$ROUND" WORK_SEL_HASH_CHANGED="$HASH_CHANGED" WORK_SKILL="$SKILL" bun -e '
import { readFileSync, writeFileSync } from "node:fs"
// coveredBy is plan-lint’s own writablePaths containment test — the one the lint rules use to decide
// which task delivers which artifact. Mapping a finding’s file by a second rule would scope a round
// by a boundary the plan is not linted against. stripLineSuffix is that same file’s one implementation
// of the location strip, shared with converge-check so the scope here and the split there agree.
const { parseArgs, taskGraph, coveredBy, stripLineSuffix } = await import(process.env.WORK_SKILL + "/scripts/plan-lint.ts")

const stage = process.env.WORK_SEL_STAGE!
const prevPath = process.env.WORK_SEL_PREV || ""
const round = Number(process.env.WORK_SEL_ROUND || "1") || 1
const hashChanged = process.env.WORK_SEL_HASH_CHANGED === "1"
const args = JSON.parse(readFileSync(stage, "utf8"))

const commit = (lines: string[]) => {
  writeFileSync(stage, JSON.stringify(args, null, 2) + "\n")
  console.log(lines.join("\n"))
  process.exit(0)
}

const tasks = parseArgs(args).tasks
const byId = new Map(tasks.map(t => [t.id, t]))
const PLAN_OWNER = "plan"
const ownerOf = (x: any) => (x && typeof x.ownerTask === "string" ? x.ownerTask.trim() : "")
const isBlocking = (f: any) => !!f && (f.severity === "critical" || f.severity === "major")

// ---- the previous verdict, read ONCE -----------------------------------------------------------
let prev: any = null
let unreadable = ""
if (prevPath) {
  try { prev = JSON.parse(readFileSync(prevPath, "utf8")) }
  catch (e) { unreadable = `previous result ${prevPath} is unreadable (${(e as Error).message})` }
  if (!unreadable && (prev === null || typeof prev !== "object" || Array.isArray(prev))) {
    prev = null
    unreadable = `previous result ${prevPath} is not a JSON object`
  }
}
const rec = (k: string) => (prev && Array.isArray(prev[k]) ? prev[k] : [])
const routes = rec("routes").filter((r: any) => r && typeof r === "object")
const planRouted = rec("planFindings").filter((x: any) => x && typeof x === "object")

// Build fixes before selection so FULL carries them too; stale fixes must not survive a round.
// Only declared owners are valid taskFixes keys in workflow.js.
delete args.taskFixes
const taskFixes: Record<string, any[]> = {}
for (const x of [...routes, ...rec("findings").filter(isBlocking)]) {
  const owner = ownerOf(x)
  if (!owner || !byId.has(owner)) continue
  if (!taskFixes[owner]) taskFixes[owner] = []
  taskFixes[owner].push(x)
}
const fixNote: string[] = []
if (Object.keys(taskFixes).length) {
  args.taskFixes = taskFixes
  fixNote.push(`  taskFixes -> implementer prompts (M3): ${Object.entries(taskFixes).map(([id, xs]) => `${id}:${xs.length} item(s)`).join(", ")}`)
}

// ---- M1: PROVEN red adjudications, carried even on a FULL re-run -------------------------------
// An id alone cannot certify an amended redCommand; filter before every carry/settlement path.
const validRed = rec("red").filter((r: any) => {
  const task = r && byId.get(r.id)
  return task && task.redCommand && r.command === task.redCommand
})
const provenRed = validRed.filter((r: any) => r.verdict === "red-green")

const fullRun = (why: string) => {
  delete args.onlyTasks
  delete args.priorResults
  const lines = [`selection: FULL re-run — ${why}`]
  // Carry proven RED independently of task scope; re-probing fixed code would refuse the round.
  if (round >= 2 && provenRed.length) {
    args.priorResults = { implemented: [], verified: [], red: provenRed }
    lines.push(`  carried red adjudications, NOT re-probed (M1): ${provenRed.map((r: any) => r.id).join(", ")}`)
  }
  commit([...lines, ...fixNote])
}

if (process.env.WORK_SEL_FULL === "1") fullRun("--full was given")
if (args.readOnly) fullRun("readOnly run — there is no task channel to scope")
if (!prevPath) fullRun("no previous result.json or result-round<N>.json in the run dir to scope from")
if (unreadable) fullRun(unreadable)

const reported = prev.tasksThatFlagged
if (!Array.isArray(reported) || reported.some((x: unknown) => typeof x !== "string"))
  fullRun(`previous result ${prevPath} has no readable tasksThatFlagged`)

// Mechanical checks and rules always re-run; narrowing needs a route for every failed check.
const mechFailed: string[] = [
  ...rec("mechanicalThatFailed").map((m: any) => m && typeof m === "object" ? String(m.name ?? "(unnamed)") : String(m)),
  ...rec("rulesThatFailed").map((m: any) => m && typeof m === "object" ? String(m.name ?? "(unnamed)") : String(m))
]
const routeFor = (name: string) => routes.find((r: any) => {
  const o = ownerOf(r)
  return (o === PLAN_OWNER || byId.has(o)) && String(r.failure ?? "").toLowerCase().includes(name.toLowerCase())
})
const mechNote: string[] = []
const mechToTask = mechFailed.filter(n => byId.has(ownerOf(routeFor(n))))
if (mechToTask.length)
  mechNote.push(`  mechanical/rule failure(s) the lens routed to an owner (M2): ${mechToTask.map(n => `${n} -> ${ownerOf(routeFor(n))}`).join(", ")}`)
// Unioned in rather than read out of `tasksThatFlagged` alone: workflow.js already puts a route’s valid
// owner in that selector, and doing it again here costs nothing and keeps the narrowing alive for a
// verdict transcribed without the union. An owner the lens NAMED is an owner.
const routedOwners = [...new Set(routes.map(ownerOf).filter((o: string) => byId.has(o)))]
// A failed check the lens routed to NOTHING is attributable to nothing: narrowing would leave the fix
// outside the implementer’s reach, and checks re-run whatever the scope, so the round would
// fail on the same check with nobody able to touch it.
const unroutedMech = mechFailed.filter(n => !routeFor(n))
if (unroutedMech.length)
  fullRun(`the previous verdict has ${unroutedMech.length} mechanical/rule check(s) failed with no lens route to a valid owner (${unroutedMech.join(", ")}) — an unattributed failure’s fix must not be scoped out`)

// Prefer ownerTask to file containment; both selections are closed under dependents below.
let flagged = [...new Set([...reported, ...routedOwners])]
let lensScoped = ""
if (routedOwners.length && reported.length !== flagged.length)
  mechNote.push(`  route owner(s) unioned into the scope: ${routedOwners.filter((o: string) => !reported.includes(o)).join(", ")}`)
if (flagged.length === 0) {
  const blocking = rec("findings").filter(isBlocking)

  // A plan-only amendment needs re-judging, not implementation, with every task record carried.
  if (planRouted.length && !unroutedMech.length && blocking.every((f: any) => ownerOf(f) === PLAN_OWNER)) {
    if (!hashChanged)
      fullRun("every open item is routed to the plan and the spec hash did not change — nothing in a round can close them")
    // workflow.js REFUSES onlyTasks: [] unless priorResults carries every task, because the task
    // dimensions would otherwise read as clean against an empty set. Checked here so the refusal is a
    // fallback to FULL rather than a round that dies after dispatch.
    const missing = tasks
      .filter(t => !rec("implemented").some((r: any) => r && r.id === t.id) ||
                   !rec("verified").some((r: any) => r && r.id === t.id) ||
                   (t.redCommand && !validRed.some((r: any) => r.id === t.id)))
      .map(t => t.id)
    if (missing.length)
      fullRun(`every open item is routed to the plan, but the previous verdict settles no implemented/verified/current-command red record for ${missing.join(", ")} — a zero-implementer round would judge those dimensions against an empty set`)
    args.onlyTasks = []
    args.priorResults = { implemented: rec("implemented"), verified: rec("verified"), red: validRed }
    commit([
      `selection: ZERO-IMPLEMENTER round — ${planRouted.length} open item(s) routed to the plan, and the spec hash CHANGED`,
      "  onlyTasks: [] — no implementer is dispatched; the mechanical checks and the lens re-judge the amended tree",
      `  all ${tasks.length} task(s) carried with their implemented/verified/red records: ${tasks.map(t => t.id).join(", ")}`,
      ...mechNote, ...fixNote,
    ])
  }

  if (!blocking.length)
    fullRun("the previous verdict flagged no task and carries no surviving blocking finding — a readOnly run, or a FAIL there is nothing to scope from")

  // Findings may name an absolute path while writablePaths are project-relative.
  const root = typeof args.projectDir === "string" ? args.projectDir.replace(/\/+$/, "") + "/" : ""
  const rel = (p: string) => (root && p.startsWith(root) ? p.slice(root.length) : p)

  const scopedTo = new Set<string>()
  const mapped: string[] = []
  const orphan: string[] = []
  for (const f of blocking) {
    const declared = ownerOf(f)
    if (byId.has(declared)) {
      scopedTo.add(declared)
      mapped.push(`${f.title || "(untitled)"} -> ${declared} (ownerTask)`)
      continue
    }
    // Finding files may include :line[-line][:column]; writablePaths contain paths, not locations.
    const raw = typeof f.file === "string" ? f.file.trim() : ""
    const file = raw ? stripLineSuffix(rel(raw)) : ""
    const owns = file ? tasks.filter(t => coveredBy(file, t.writablePaths)).map(t => t.id) : []
    if (!owns.length) { orphan.push(`${f.lens || "?"}: ${f.title || "(untitled)"}${file ? ` (${file})` : " (names no file)"}`); continue }
    for (const id of owns) scopedTo.add(id)
    mapped.push(`${file} -> ${owns.join("/")}`)
  }
  // ONE unmapped finding is enough to fall back: scoping to the rest would carry a task the
  // unmapped finding may be about, and its "verified" record was earned before the fix.
  if (orphan.length)
    fullRun(`a lens-only FAIL, but ${orphan.length} blocking finding(s) map to no task’s writablePaths — ${orphan.join("; ")}`)

  flagged = [...scopedTo]
  lensScoped = `  lens-only FAIL: ${blocking.length} blocking finding(s) map to ${flagged.join(", ")} — ${mapped.join("; ")}`
}

if (flagged.length === 0)
  fullRun("the previous verdict flagged no task — a readOnly run, or a FAIL carried entirely by the lens or the mechanical checks, which name no task to scope to")

const unknown = flagged.filter((id: string) => !byId.has(id))
if (unknown.length) fullRun(`the previous verdict flags ${unknown.join(", ")}, absent from tasks[]`)
if (taskGraph(tasks).cycle)
  fullRun(`dependsOn cycle among ${taskGraph(tasks).cycle!.join(", ")} — dependents cannot be closed`)

const has = (k: string, id: string) => rec(k).some((r: any) => r && r.id === id)
/** A carried task must be PROVEN settled by the previous verdict, or it is not independent. */
const settled = (t: { id: string; redCommand: string | null }) =>
  has("implemented", t.id) && has("verified", t.id) && (!t.redCommand || validRed.some((r: any) => r.id === t.id))

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

// M1 again, on the scoped path: a re-run task whose PROVEN red pair is carried is not re-probed either,
// so its adjudication has to travel even though it is not in `carried`.
const carry = (k: string) => rec(k).filter((r: any) => r && carried.includes(r.id))
const carryRed = [...validRed.filter((r: any) => carried.includes(r.id)),
                  ...provenRed.filter((r: any) => !carried.includes(r.id))]
args.onlyTasks = only
args.priorResults = { implemented: carry("implemented"), verified: carry("verified"), red: carryRed }

const lines = [`selection: ${only.length} of ${tasks.length} tasks re-run — ${only.join(", ")}`,
  `  flagged by ${prevPath.replace(/^.*\//, "")}: ${pick("flagged").join(", ")}`]
if (lensScoped) lines.push(lensScoped)
lines.push(...mechNote)
if (pick("dependent").length) lines.push(`  + transitive dependents:  ${pick("dependent").join(", ")}`)
if (pick("unproven").length)
  lines.push(`  + unproven if carried:    ${pick("unproven").join(", ")} (the previous verdict settles no implemented/verified/red record for them)`)
lines.push(`  carried with their red adjudication: ${carried.join(", ")}`)
const reprobed = only.filter(id => { const t = byId.get(id); return t && t.redCommand && !provenRed.some((r: any) => r.id === id) })
if (provenRed.length)
  lines.push(`  proven red carried, NOT re-probed (M1): ${provenRed.map((r: any) => r.id).join(", ")}${reprobed.length ? `; re-probed: ${reprobed.join(", ")}` : ""}`)
lines.push(...fixNote)
lines.push("  the lens and the mechanical checks judge the whole deliverable and are NOT narrowed")
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
Override (records nothing, gates nothing): work-redispatch.sh $PLAN_ABS $ARGS_ABS --dispatch --no-lint
MSG
    exit 3
  fi
fi

# The kind map, re-resolved every round on the staged args through work-dispatch.sh's one
# implementation. The flag form replaces the whole object, so a previous round's kindModels cannot
# survive into a --provider round. A refusal spends nothing, exactly like the gates around it.
if [ "$DISPATCH" = "--dispatch" ]; then
  bash "$SKILL/scripts/work-dispatch.sh" --resolve-routing "$STAGE" "$(basename "$RUN_DIR")" "$PROVIDER" || {
    rr=$?
    rm -f "$STAGE"
    printf '\nNothing was spent: args.json is unchanged, the counters above were NOT written, result.json is unrotated.\n' >&2
    exit "$rr"
  }
fi

# TIER 2, on the staged args and still before anything is committed: the same probe work-dispatch.sh
# runs, invoked as its subcommand so there is one implementation of the classification.
if [ "$DISPATCH" = "--dispatch" ] && [ "$REDPROBE" = 1 ]; then
  bash "$SKILL/scripts/work-dispatch.sh" --red-probe "$STAGE" || {
    rp=$?
    rm -f "$STAGE"
    printf '\nNothing was spent: args.json is unchanged, the counters above were NOT written, result.json is unrotated.\n' >&2
    exit "$rp"
  }
fi

# A DRY RUN COMMITS NOTHING. It used to commit everything but the farm-out: the staged args landed
# over args.json with `rounds` advanced, result.json was rotated to result-round<n>.json, and the plan
# was archived — then it printed "nothing dispatched". So the one command someone reaches for to see
# what a round WOULD do spent the round and destroyed the verdict the next round needed to scope from,
# and a second look had to be taken against state the first look had already moved.
#
# Reported, not silently skipped: the staged args exist and the round number is known, so what would
# have been written is printed instead of written. The gates above have all run by now — the whole
# point of the flag — and a refusal there exits before reaching this.
if [ -n "${WORK_REDISPATCH_DRYRUN:-}" ] && [ "$DISPATCH" = "--dispatch" ]; then
  bash "$SKILL/scripts/work-dispatch.sh" --red-summary "$STAGE"
  printf 'WOULD advance: rounds -> %s in %s\n' "$ROUND" "$ARGS_ABS"
  printf 'WOULD archive: the plan at %s beside the run\n' "$PLAN_ABS"
  if [ -e "$RUN_DIR/result.json" ]; then
    n=1
    while [ -e "$RUN_DIR/result-round$n.json" ]; do n=$((n+1)); done
    printf 'WOULD rotate:  result.json -> result-round%s.json\n' "$n"
  fi
  rm -f "$STAGE"
  echo "WORK_REDISPATCH_DRYRUN: nothing dispatched, and nothing written — args.json and result.json are untouched."
  exit 0
fi

mv "$STAGE" "$ARGS_ABS"

# The plan, archived with the round that will run under it — the FAIL loop amends the plan every
# round, and `.claude/plans/` preserves none of them. Only on --dispatch: a re-hash-only call runs
# nothing, so it has no round to archive against. One implementation, in work-dispatch.sh.
if [ "$DISPATCH" = "--dispatch" ]; then
  bash "$SKILL/scripts/work-dispatch.sh" --archive-plan "$PLAN_ABS" "$RUN_DIR" "$NEW_HASH"
fi

# The same red column work-dispatch.sh prints, from its one implementation: gated vs dispositioned,
# each disposition echoed so a task carrying one is visible rather than silently ungated.
bash "$SKILL/scripts/work-dispatch.sh" --red-summary "$ARGS_ABS"

[ "$DISPATCH" = "--dispatch" ] || exit 0

RESULT="$RUN_DIR/result.json"
if [ -e "$RESULT" ]; then
    n=1
    while [ -e "$RUN_DIR/result-round$n.json" ]; do n=$((n+1)); done
    mv "$RESULT" "$RUN_DIR/result-round$n.json"
    printf 'rotated:  result.json -> result-round%s.json\n' "$n"
fi

LOG="$RUN_DIR/run-$(date +%H%M%S).log"

# setsid detaches the SESSION, not the resource domain: rounds 2..N would otherwise stay in the
# terminal's cgroup, which is what the measured systemd-oomd kill exploited. Round 1 is scoped in
# work-dispatch.sh; the continuation is the long unattended part, so it needs the same treatment.
# PROBED, never assumed — a container or a non-systemd host must still dispatch. Losing the scope is
# a warning; refusing to run would be the regression.
SYSTEMD_RUN=${WORK_SYSTEMD_RUN:-systemd-run}
RUN_ID=$(basename "$RUN_DIR")
scope=none
scope_why=""
scope_unit=""
if [ "${WORK_NO_SCOPE:-}" = "1" ]; then
  scope_why="WORK_NO_SCOPE=1"
elif ! command -v "$SYSTEMD_RUN" > /dev/null 2>&1; then
  scope_why="$SYSTEMD_RUN not found"
elif ! "$SYSTEMD_RUN" --user --scope --quiet --collect -- true > /dev/null 2>&1; then
  scope_why="no reachable systemd user manager"
else
  scope=transient
  # A unit name is a restricted charset; the run id is author-supplied, so map anything else out
  # rather than handing systemd a name it will reject. The pid keeps this round from colliding with
  # a previous one still live.
  scope_unit="work-$(printf '%s' "$RUN_ID" | tr -c '[:alnum:]_.\-' '_')-$$.scope"
fi

# The wrapper hosting the round: the override when given, else claude running the kind map's ids.
HOST=${PROVIDER:-claude}

# One argument vector, so the two dispatch paths cannot drift apart.
farm_cmd=(bash "$FARM" --provider "$HOST"
    --workflow "$SKILL/workflow.js"
    --args "$ARGS_ABS" --out "$RESULT" --cwd "$(pwd)")

if [ "$scope" = transient ]; then
  setsid nohup "$SYSTEMD_RUN" --user --scope --collect --quiet --unit "$scope_unit" \
      -- "${farm_cmd[@]}" > "$LOG" 2>&1 < /dev/null &
else
  # `set -e` is on here, so this is an if rather than a && short-circuit that would exit the script
  # on an empty reason.
  if [ -n "$scope_why" ]; then
    echo "WARNING: redispatching without a transient scope ($scope_why) — the round
shares this terminal's cgroup and dies with it, or with an oomd kill against it." >&2
  fi
  setsid nohup "${farm_cmd[@]}" > "$LOG" 2>&1 < /dev/null &
fi

# Which path was taken, on stdout and unconditionally: a round that quietly lost its scope is exactly
# the round that later dies without a verdict, so the fact has to be in the output either way.
echo "scope: $scope${scope_unit:+ ($scope_unit)}${scope_why:+ — $scope_why}"

printf 'dispatched, log: %s (provider: %s)\n' "$LOG" "$HOST"
printf 'wait with a Monitor on %s, then run work-result.sh on it\n' "$RESULT"
