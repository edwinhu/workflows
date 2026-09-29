#!/usr/bin/env bash
# Re-hash an amended plan into an existing args.json, and optionally re-dispatch work.
#
# The FAIL loop is: fix, amend the plan, re-hash, re-dispatch. Doing that by hand is where a
# specHash gets typed from a stale copy, and where an args file drifts from the plan it names.
# The hash is over the plan's CANONICAL work:dispatch spec (work-dispatch.sh --spec-hash), so a
# prose-only amendment between rounds moves nothing.
#
# Re-hashing is not enough on its own, so this also RE-SYNCS the plan's `work:dispatch` block into
# the args: `redCommand` is executed from args.json and `work` is what the implementer is handed, so
# a plan amendment that never reached the args is an amendment that never ran. Run-local keys
# (onlyTasks, priorResults, priorFindings, freezeFindingSet, maxAgents, maxRounds) are not in the
# plan and are preserved.
#
#   work-redispatch.sh <plan.md> <args.json>              # re-hash only, print old -> new
#   work-redispatch.sh <plan.md> <args.json> --dispatch   # re-hash, then dispatch detached
#   work-redispatch.sh … --dispatch --full                # re-run every task, not just the flagged
#   work-redispatch.sh … --dispatch --no-lint             # skip BOTH gates below
#   work-redispatch.sh … --dispatch --no-red-probe        # skip only the red probe; keep plan-lint
#   work-redispatch.sh … --dispatch --provider codex      # run this round's whole spine on GPT-5.6
#   WORK_REDISPATCH_DRYRUN=1                              # gates only: writes NOTHING, prints what would
#                                                         # be advanced, archived and rotated
#   WORK_FARM=PATH                                        # the farm.sh a real dispatch invokes
#   WORK_NO_SCOPE=1                                       # force the plain setsid dispatch
#   WORK_SYSTEMD_RUN=PATH                                 # the binary the scope probe uses
#
# SELECTIVE RE-RUN, with --dispatch and derived here rather than remembered: `onlyTasks` is the
# previous verdict's `tasksThatFlagged` CLOSED UNDER TRANSITIVE DEPENDENTS, and `priorResults` (with
# `red`, so a carried task keeps its adjudication) carries everything else. The closure is the
# soundness condition: a carried "verified" for a task downstream of a re-run one was earned against
# code that no longer exists. A previous result that is absent, unreadable, or whose
# `tasksThatFlagged` cannot be parsed falls back to a FULL re-run and says so — a scope built from a
# verdict nobody could read is the vacuous pass work exists to prevent. Lenses and mechanical checks
# judge the whole deliverable and are never narrowed.
#
# A LENS-ONLY FAIL still narrows. `tasksThatFlagged` is [] when no implementer, verifier or red gate
# failed, and FULL then re-probes every red command — including the ones the last round fixed, which
# now exit 0 and are refused as `red-not-red`, so the round cannot be dispatched at all. Each
# surviving blocking finding is mapped to the task(s) whose `writablePaths` contain its `file`; one
# finding that maps to nothing, or any failed mechanical check, falls back to FULL and says why.
#
# With --dispatch, the run directory is args.json's own directory; result.json there is rotated to
# result-<n>.json first so a stale verdict can never be read as this run's.
#
# FROZEN FINDING SET + ROUND CAP, both with --dispatch. From round 2 on, `priorFindings` is the
# PREVIOUS VERDICT'S SURVIVORS — its blocking `findings`, which workflow.js already filtered to the
# unrefuted, merged with still-open carried entries and deduped by lens+title+file — and
# `freezeFindingSet` is set. So the loop asks whether that carried set is closed (each entry is
# adversarially refuted every round) rather than whether this round's lenses raised anything, findings
# the refuters killed drop out, and ones a later round raised are carried rather than lost. Fresh
# blocking lens findings are reported as `residue` and do not gate. `maxRounds` (default 6) is a hard stop: the
# dispatch that would exceed it is refused with exit 4, prints what is still open as a paste-ready
# priorFindings block for a fresh run, and hands the run to human review.
#
# TIER 1 GATE, mirroring work-dispatch.sh: with --dispatch, plan-lint.ts runs on the FINAL args —
# after the plan block is re-synced and the counters advanced — and a major/critical exits 3. It
# fails CLOSED. The mutations are STAGED until it passes: a refusal spends no round, rotates no
# result and does not touch args.json, so the run is left exactly as it was.
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
# See work-dispatch.sh for what this actually swaps. Per-invocation, never sticky: switching
# provider between rounds is the whole point, so a round inherits nothing from its predecessor.
PROVIDER=claude
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
RUN_LOCAL = {"onlyTasks", "priorResults", "priorFindings", "maxAgents", "rounds",
             "freezeFindingSet", "maxRounds"}
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
# RE-DERIVED EVERY ROUND, from the previous verdict's SURVIVORS. It used to be set once, on the
# advance to round 2, and never touched again — which meant a finding the round-3 refuters killed was
# still carried into round 4 as an open gate, and blocking findings the later rounds raised were never
# carried at all. The set was frozen against the generator and also against the evidence.
#
# The bound is refutation, not the calendar. `workflow.js` puts every carried finding through the same
# adversarial refuter as a fresh lens finding and returns the survivors in `findings`, so what comes
# back is smaller than what went out unless a finding genuinely still stands; `refuted` names the ones
# that fell, and they drop out here. `maxRounds` is what stops the run.
freeze_note = ""
if dispatch == "--dispatch" and args["rounds"] >= 2:
    BLOCKING = ("critical", "major")
    # lens+title+file: the same finding re-reported by the same lens about the same file is one
    # finding. Two lenses raising the same title about one file are two, and stay two.
    def key(f):
        return (f.get("lens") or "carried", f.get("title"), f.get("file") or "")

    def normalise(f):
        """A priorFindings entry, or None when workflow.js would refuse it."""
        if not isinstance(f, dict) or f.get("severity") not in BLOCKING:
            return None
        # workflow.js REFUSES a priorFinding missing any of these, which would kill the run before an
        # agent is dispatched. A malformed entry is dropped and counted, not passed on.
        if not (f.get("title") and f.get("detail")):
            return None
        entry = {"title": f["title"], "severity": f["severity"], "detail": f["detail"],
                 "lens": f.get("lens") or "carried"}
        if f.get("file"):
            entry["file"] = f["file"]
        return entry

    carried, dropped, was = [], 0, list(args.get("priorFindings") or [])
    if prev_result:
        try:
            with open(prev_result) as fh:
                prev = json.load(fh)
            # `findings` in the gate return is ALREADY the surviving pool — refuted entries are in
            # `refuted` and never here — and it holds surviving carried findings and surviving lens
            # findings alike, which is exactly the still-open blocking set.
            seen = set()
            for f in prev.get("findings", []) or []:
                entry = normalise(f)
                if entry is None:
                    if isinstance(f, dict) and f.get("severity") in BLOCKING:
                        dropped += 1
                    continue
                if key(entry) in seen:
                    continue
                seen.add(key(entry))
                carried.append(entry)
            # A carried finding the previous round never judged — the refute leg died, or the verdict
            # predates it — is still OPEN. Only an explicit refutation removes one.
            refuted = {key(f) for f in (prev.get("refuted") or []) if isinstance(f, dict)}
            for f in was:
                entry = normalise(f)
                if entry is None or key(entry) in seen or key(entry) in refuted:
                    continue
                seen.add(key(entry))
                carried.append(entry)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"WARNING: previous result {prev_result} unreadable ({exc}); the finding set is NOT frozen",
                  file=sys.stderr)
            carried = None
    if carried is not None:
        closed = len([f for f in was if normalise(f) and key(normalise(f)) not in {key(c) for c in carried}])
        args["priorFindings"] = carried
        args["freezeFindingSet"] = True
        freeze_note = (f"frozen:   {len(carried)} blocking finding(s) carried as priorFindings"
                       + (f" ({closed} refuted last round and dropped)" if closed else "")
                       + (f" ({dropped} malformed dropped)" if dropped else "")
                       + " — fresh lens findings are residue this round, not gates")

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
    printf 'priorFindings block for a fresh work run (residue first — those never gated):\n\n'
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
# and its `taskGraph` (the layering work-dispatch.sh prints and workflow.js schedules by), so the
# graph closed over here is the graph that will run. A cycle is refused by falling back, not by
# laying out half of an unschedulable plan.
if [ "$DISPATCH" = "--dispatch" ]; then
  SEL=$(WORK_SEL_STAGE="$STAGE" WORK_SEL_PREV="$PREV_RESULT" WORK_SEL_FULL="$FULL" WORK_SKILL="$SKILL" bun -e '
import { readFileSync, writeFileSync } from "node:fs"
// coveredBy is plan-lint’s own writablePaths containment test — the one the lint rules use to decide
// which task delivers which artifact. Mapping a finding’s file by a second rule would scope a round
// by a boundary the plan is not linted against.
const { parseArgs, taskGraph, coveredBy } = await import(process.env.WORK_SKILL + "/scripts/plan-lint.ts")

const stage = process.env.WORK_SEL_STAGE!
const prevPath = process.env.WORK_SEL_PREV || ""
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

if (process.env.WORK_SEL_FULL === "1") fullRun("--full was given")
if (args.readOnly) fullRun("readOnly run — there is no task channel to scope")
if (!prevPath) fullRun("no previous result.json or result-round<N>.json in the run dir to scope from")

let prev: any
try {
  prev = JSON.parse(readFileSync(prevPath, "utf8"))
} catch (e) {
  fullRun(`previous result ${prevPath} is unreadable (${(e as Error).message})`)
}
if (!prev || typeof prev !== "object") fullRun(`previous result ${prevPath} is not a JSON object`)

const reported = prev.tasksThatFlagged
if (!Array.isArray(reported) || reported.some((x: unknown) => typeof x !== "string"))
  fullRun(`previous result ${prevPath} has no readable tasksThatFlagged`)

const tasks = parseArgs(args).tasks
const byId = new Map(tasks.map(t => [t.id, t]))

// ---- a lens-only FAIL, narrowed by the FILES its findings name --------------------------------
// A FAIL carried entirely by review lenses names no task: `tasksThatFlagged` is [] because no
// implementer, verifier or red gate failed. Selection then fell back to FULL, and FULL re-probes
// every red command — including the ones the last round FIXED, which now exit 0 and are refused as
// `red-not-red`. The round could not be dispatched at all, on a verdict whose findings were confined
// to two files.
//
// A blocking finding names a `file`, and a task declares the paths it may write. That is the mapping,
// and it is the only honest one available: a lens finding has no owning task, but the task whose
// writable surface contains the file is the one that has to change for the finding to close. Closed
// under dependents below, exactly like a flagged task.
let flagged = reported
let lensScoped = ""
if (flagged.length === 0) {
  const blocking = (Array.isArray(prev.findings) ? prev.findings : [])
    .filter((f: any) => f && (f.severity === "critical" || f.severity === "major"))
  // A failed mechanical check is attributable to no task and no file. Narrowing there would leave
  // the fix outside the implementer’s reach — mechanical checks are re-run whatever the scope, so the
  // round would fail on the same check with nobody able to touch it.
  const mechFailed = (Array.isArray(prev.mechanicalThatFailed) ? prev.mechanicalThatFailed : []).length
  if (!blocking.length)
    fullRun("the previous verdict flagged no task and carries no surviving blocking finding — a readOnly run, or a FAIL there is nothing to scope from")
  if (mechFailed)
    fullRun(`the previous verdict flagged no task and ${mechFailed} mechanical check(s) failed — a mechanical failure is attributable to no task’s files, so the fix must not be scoped out`)

  // Findings may name an absolute path while writablePaths are project-relative.
  const root = typeof args.projectDir === "string" ? args.projectDir.replace(/\/+$/, "") + "/" : ""
  const rel = (p: string) => (root && p.startsWith(root) ? p.slice(root.length) : p)

  const owners = new Map<string, string[]>()
  const orphan: string[] = []
  for (const f of blocking) {
    const file = typeof f.file === "string" && f.file.trim() ? rel(f.file.trim()) : ""
    const owns = file ? tasks.filter(t => coveredBy(file, t.writablePaths)).map(t => t.id) : []
    if (!owns.length) { orphan.push(`${f.lens || "?"}: ${f.title || "(untitled)"}${file ? ` (${file})` : " (names no file)"}`); continue }
    owners.set(file, owns)
  }
  // ONE unmapped finding is enough to fall back: scoping to the rest would carry a task the
  // unmapped finding may be about, and its "verified" record was earned before the fix.
  if (orphan.length)
    fullRun(`a lens-only FAIL, but ${orphan.length} blocking finding(s) map to no task’s writablePaths — ${orphan.join("; ")}`)

  flagged = [...new Set([...owners.values()].flat())]
  lensScoped = `  lens-only FAIL: ${blocking.length} blocking finding(s) in ${owners.size} file(s) map to ${flagged.join(", ")}`
}

if (flagged.length === 0)
  fullRun("the previous verdict flagged no task — a readOnly run, or a FAIL carried entirely by lenses or mechanical checks, which name no task to scope to")

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
if (lensScoped) lines.push(lensScoped)
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
Override (records nothing, gates nothing): work-redispatch.sh $PLAN_ABS $ARGS_ABS --dispatch --no-lint
MSG
    exit 3
  fi
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

# One argument vector, so the two dispatch paths cannot drift apart.
farm_cmd=(bash "$FARM" --provider "$PROVIDER"
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

printf 'dispatched, log: %s (provider: %s)\n' "$LOG" "$PROVIDER"
printf 'wait with a Monitor on %s, then run work-result.sh on it\n' "$RESULT"
