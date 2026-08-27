#!/usr/bin/env bash
# Phase 3 + Phase 4, mechanically: hash the plan, set the goal, dispatch workflow.js detached.
#
# Everything it needs is in the plan's `<!-- craft:dispatch … -->` block, so a session that has
# lost its context — the clear on plan approval, /clear, a restart — can run this and be correct
# without re-deriving anything, and without re-exploring the tree the plan was built from.
#
#   craft-dispatch.sh [plan.md]        dispatch (plan defaults to the armed one)
#   craft-dispatch.sh --abandon [plan] record the plan as not-to-be-run; releases the guard
#   craft-dispatch.sh --print [plan]   write args.preview.json and stop; the run stays armed
#   craft-dispatch.sh --no-lint [plan] skip BOTH dispatch gates below
#   craft-dispatch.sh --no-red-probe   skip only the red-gate probe; keep plan-lint
#   craft-dispatch.sh --no-mech-probe  skip only the mechanical baseline probe; keep plan-lint
#   craft-dispatch.sh --run-dir DIR    put args/result/log under DIR/<run-id> instead of $PWD/.craft/
#   craft-dispatch.sh --red-probe ARGS run the red-gate probe on an args.json and exit 0/3 (reused
#                                      by craft-redispatch.sh so there is one implementation)
#   craft-dispatch.sh --archive-plan SRC DIR HASH  archive a plan into a run dir (same reuse)
#   craft-dispatch.sh --spec-hash PLAN print the plan's spec hash and nothing else
#   craft-dispatch.sh --scaffold PLAN PATH is PATH declared in scaffoldPaths? 0 yes, 1 no, 2 undecidable
#   craft-dispatch.sh --covers PLAN PATH  is PATH inside some task's writablePaths? 0 yes, 1 no,
#                                      2 undecidable (read by main-thread-guard.sh, which fails closed)
#   CRAFT_DISPATCH_DRYRUN=1            build + lint + probe + size, stop before dispatching
#   CRAFT_RED_PROBE_TIMEOUT=300        per-command probe timeout in seconds
#   CRAFT_MECH_PROBE_TIMEOUT=300       per-check mechanical baseline timeout in seconds
#
# --run-dir exists for a readOnly run whose projectDir is a tree it must NOT write to. The run dir
# defaulted to $PWD/.craft/, and $PWD is also passed as the runner's --cwd, so the two were coupled: a
# skill judging ~/areas/secreg had no way to dispatch from there without dropping args.json,
# result.json and run.log into the tree it promises not to touch. --run-dir separates them; --cwd
# stays $PWD so dispatched agents keep resolving relative paths the way they always have.
#
# TIER 1 GATE: plan-lint.ts runs on the built args before args.json is written, and a major/critical
# finding aborts with the run still armed. It fails CLOSED — a verdict it cannot count blocks too.
#
# TIER 2 GATE: every active task's `redCommand` is EXECUTED here, before args.json is written. craft
# already reports `red-not-red` and `green-not-green` — but only after the implementers, verifiers,
# lenses and mechanical checks have run. Both are decidable from the same command at dispatch, one
# round and ~34 agents earlier, and a command that could not run at all is not a verdict of any kind.
#
# TIER 2b GATE: every `mechanicalChecks` command is EXECUTED at BASELINE too, via plan-preflight.ts.
# TIER 2 covers redCommands only and returns early on readOnly — where the mechanical checks ARE the
# whole gate — so a leg exiting 127 was previously discovered only after a full round had been paid
# for. Only `critical` (127, cannot-run) refuses; a mixed red/green baseline is normal and reports.
#
# THE SPEC IS THE AUTHORITY. The hash is over the CANONICAL JSON of the `craft:dispatch` block
# (sorted keys, no whitespace), never the plan's bytes: the block is what was authored and executed,
# the prose around it explains it. Hashing the whole file made a typo fix in rationale invalidate a
# live run and cost a round. Reformatting or reordering the block therefore moves nothing; changing
# any value moves it.
#
# planPath and specHash are injected here, never read from the block: a block cannot state its own
# hash without changing it.
#
# THE PLAN IS ARCHIVED into the run dir, because craft does not own the file it hashes. `.claude/plans/`
# is gitignored scratch, and re-entering plan mode OVERWRITES the plan in place. The archive is named
# by the spec hash, so an amended spec adds a file and can never destroy the bytes an earlier round
# ran under.
set -uo pipefail

# Self-locating: the skill root is this script's parent, so the copy runs wherever it is installed.
SKILL=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# farm-out ships alongside craft; a sibling copy wins, an installed one is the fallback, and
# CRAFT_FARM overrides both.
FARM=${CRAFT_FARM:-}
if [ -z "$FARM" ]; then
  if [ -f "$SKILL/../farm-out/scripts/farm.sh" ]; then
    FARM="$SKILL/../farm-out/scripts/farm.sh"
  else
    FARM="$HOME/.claude/skills/farm-out/scripts/farm.sh"
  fi
fi

# ---------------------------------------------------------------- the spec hash (the authority)
# sha256 of json.dumps(parsed, sort_keys=True, separators=(',',':')) — the canonical form of the
# PARSED block, not its raw bytes. Prints the 64 hex digits and nothing else; a missing or malformed
# block exits non-zero with a message rather than a hash, because a spec nobody can parse was never
# armed. Run-local fields (rounds, onlyTasks, priorResults) are injected after extraction and so are
# excluded for free — nothing here filters them.
spec_hash() {
  python3 - "$1" <<'PY'
import hashlib, json, re, sys
plan = sys.argv[1]
try:
    src = open(plan).read()
except OSError as exc:
    sys.exit(f"spec-hash: cannot read {plan} ({exc})")
m = re.search(r'<!--\s*craft:dispatch\s*(.*?)-->', src, re.S)
if not m:
    sys.exit("spec-hash: plan carries no <!-- craft:dispatch --> block: " + plan)
try:
    parsed = json.loads(m.group(1))
except json.JSONDecodeError as exc:
    sys.exit(f"spec-hash: craft:dispatch block is not valid JSON ({exc}): {plan}")
canon = json.dumps(parsed, sort_keys=True, separators=(",", ":"))
print(hashlib.sha256(canon.encode("utf-8")).hexdigest())
PY
}

if [ "${1:-}" = "--spec-hash" ]; then
  [ -f "${2:-}" ] || { echo "--spec-hash needs an existing plan file" >&2; exit 2; }
  spec_hash "$2"
  exit $?
fi

# ------------------------------------------------ is this path the run's own output? (the guard asks)
# A path inside some task's writablePaths is work the dispatched implementers will do. A path outside
# every one of them is work they CANNOT do: arg-validation confines each implementer to its own set,
# and the red suite every gate points at is writable by nobody — a task that could rewrite its own
# gate is `self-gating-task` — so it has nowhere to be authored except before the dispatch.
# Containment is one-directional on purpose: a target that merely CONTAINS a writablePath is a
# directory, never a file write.
# 0 = covered, 1 = outside every writable set, 2 = undecidable, and the caller must fail CLOSED.
covers() {
  python3 - "$1" "$2" <<'PY'
import json, os, re, sys
plan, target = sys.argv[1], sys.argv[2]
try:
    src = open(plan).read()
except OSError:
    raise SystemExit(2)
m = re.search(r'<!--\s*craft:dispatch\s*(.*?)-->', src, re.S)
if not m:
    raise SystemExit(2)
try:
    block = json.loads(m.group(1))
except json.JSONDecodeError:
    raise SystemExit(2)
args = block.get("args") if isinstance(block.get("args"), dict) else block
if not isinstance(args, dict):
    raise SystemExit(2)
# writablePaths are routinely relative to the run's own projectDir; the caller's target is absolute.
root = args.get("projectDir") or os.path.dirname(os.path.abspath(plan))
writable = [
    os.path.normpath(os.path.join(root, w.strip()))
    for t in (args.get("tasks") or []) if isinstance(t, dict)
    for w in (t.get("writablePaths") or []) if isinstance(w, str) and w.strip()
]
# No writable surface at all — a readOnly run, or a spec too thin to decide from. Not a "no".
if not writable:
    raise SystemExit(2)
t = os.path.normpath(os.path.abspath(target))
raise SystemExit(0 if any(t == w or t.startswith(w + os.sep) for w in writable) else 1)
PY
}

# ------------------------------------------------- paths this plan authors BEFORE the dispatch
# `--covers` alone cannot answer the pre-dispatch question, because the two facts it conflates are
# genuinely different: a stub is BOTH the implementer's output (so it belongs in writablePaths) and
# a thing that must exist before wave 1 (so the main thread must be able to write it now). Without a
# separate list the only way to author one was to disarm the guard entirely — which also switches
# off the Stop-hook nudge, so the run loses its own reminder that a dispatch is still owed.
# 0 = declared scaffold, 1 = not, 2 = undecidable, and the caller must fail CLOSED.
scaffolds() {
  python3 - "$1" "$2" <<'SCAFFOLD_PY'
import json, os, re, sys
plan, target = sys.argv[1], sys.argv[2]
try:
    src = open(plan).read()
except OSError:
    raise SystemExit(2)
m = re.search(r'<!--\s*craft:dispatch\s*(.*?)-->', src, re.S)
if not m:
    raise SystemExit(2)
try:
    block = json.loads(m.group(1))
except json.JSONDecodeError:
    raise SystemExit(2)
args = block.get("args") if isinstance(block.get("args"), dict) else block
if not isinstance(args, dict):
    raise SystemExit(2)
root = args.get("projectDir") or os.path.dirname(os.path.abspath(plan))
declared = [
    os.path.normpath(os.path.join(root, sp.strip()))
    for sp in (args.get("scaffoldPaths") or []) if isinstance(sp, str) and sp.strip()
]
# An absent list is a decidable NO, unlike covers(): declaring no scaffold is the common case and
# must not fail the guard closed on every write in every project.
if not declared:
    raise SystemExit(1)
t = os.path.normpath(os.path.abspath(target))
raise SystemExit(0 if any(t == d or t.startswith(d + os.sep) for d in declared) else 1)
SCAFFOLD_PY
}

if [ "${1:-}" = "--scaffold" ]; then
  [ -f "${2:-}" ] && [ -n "${3:-}" ] || { echo "--scaffold needs <plan> <path>" >&2; exit 2; }
  scaffolds "$2" "$3"
  exit $?
fi

if [ "${1:-}" = "--covers" ]; then
  [ -f "${2:-}" ] && [ -n "${3:-}" ] || { echo "--covers needs <plan> <path>" >&2; exit 2; }
  covers "$2" "$3"
  exit $?
fi

# ---------------------------------------------------------------- the red-gate probe, executed here
# Runs each active task's redCommand ONCE and classifies the outcome:
#   exit 0 before the work         -> red-not-red; the gate proves nothing, refuse
#   127 / missing runner / pytest 4|5 / no test output at all -> could-not-run; not a verdict, refuse
#   non-zero WITH a real test result -> genuine RED, proceed
# Exit 0 = every probe is a genuine red; exit 3 = refuse, exactly like the plan-lint gate.
red_probe_gate() {
  python3 - "$1" <<'PY'
import json, os, re, subprocess, sys

try:
    a = json.load(open(sys.argv[1]))
except (json.JSONDecodeError, OSError) as exc:
    sys.exit(f"red-probe: cannot read {sys.argv[1]} ({exc}) — refusing to dispatch unprobed")

if a.get("readOnly"):
    print("  red-probe: readOnly run — no redCommand is dispatched, nothing probed")
    raise SystemExit(0)

tasks = a.get("tasks") or []
only = a.get("onlyTasks")
if isinstance(only, list) and only:
    keep = set(only)
    tasks = [t for t in tasks if t.get("id") in keep]
gated = [t for t in tasks if t.get("redCommand")]
if not gated:
    print("  red-probe: no active task declares redCommand — nothing to probe")
    raise SystemExit(0)

cwd = a.get("projectDir") or os.getcwd()
try:
    timeout = float(os.environ.get("CRAFT_RED_PROBE_TIMEOUT", "300"))
except ValueError:
    timeout = 300.0

# What a run that actually reached a test result prints. Absent every one of these, the command
# produced no test output at all, which is the case the table calls could-not-run.
EVIDENCE = re.compile(
    r"\b\d+\s+(?:failed|failures?|fail|errors?|passed|pass|skipped)\b"
    r"|\bFAILED\b|\bFAIL\b|AssertionError|Traceback \(most recent call last\)"
    r"|^not ok\b|✗|✘|\bassert\b|expect\(|^panic:|\(fail\)",
    re.I | re.M,
)
# Deliberately narrow: a shell reporting a missing program, never "No such file or directory", which
# a genuinely failing test legitimately prints.
MISSING = re.compile(r"command not found|:\s*not found\b|is not recognized as", re.I)
NOMODULE = re.compile(r"No module named ['\"]?([\w.]+)")
# The suite never LOADED. Distinct from a missing runner (above): the runner ran, and died reading
# the test files. dev CLARIFY axis 5 refuses this shape of red explicitly, and until this rule the
# refusal was prose only — measured: a test importing a nonexistent module exits pytest 2 and prints
# "1 error in 0.04s", which EVIDENCE matches, so the probe called it a genuine RED and dispatched.
COLLECT = re.compile(
    r"errors? during collection|ImportError while importing test module"
    r"|Cannot find module|ERR_MODULE_NOT_FOUND", re.I)
TOKEN = r"(?<![\w.\-])%s(?![\w.\-])"


def classify(cmd, code, out):
    if code == 0:
        return "red-not-red", "exited 0 — the command already passes, so bracketing it proves nothing"
    if code is None:
        return "could-not-run", "the probe could not execute it at all"
    if code == 127:
        return "could-not-run", "exit 127 — the command itself was not found"
    if MISSING.search(out):
        return "could-not-run", "the output names a missing command, not a test result"
    m = NOMODULE.search(out)
    if m and re.search(TOKEN % re.escape(m.group(1)), cmd):
        return "could-not-run", (
            f"'{m.group(1)}' is named in the command but is not importable — the RUNNER is "
            "missing, so this exit code is an import error, not a test verdict")
    if COLLECT.search(out):
        return "could-not-run", (
            "the suite never loaded — a collection/import error is not a behavioural failure. "
            "The surface under test has to EXIST before its red means anything; a stub that "
            "raises is enough, and the plan declares it in scaffoldPaths")
    if code in (4, 5) and re.search(TOKEN % "pytest", cmd):
        return "could-not-run", (
            f"pytest exit {code} — " + ("usage error" if code == 4 else "no tests were collected"))
    if not EVIDENCE.search(out):
        return "could-not-run", "no test output at all — nothing a test framework prints appeared"
    return "red", "non-zero with a real test result"


rows, refusals = [], []
for t in gated:
    cmd, tid = t["redCommand"], t.get("id", "(unnamed)")
    try:
        p = subprocess.run(["bash", "-c", cmd], cwd=cwd, capture_output=True, text=True,
                           errors="replace", timeout=timeout)
        code, out = p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        code, out = None, f"(still running after {timeout:g}s)"
    except OSError as exc:
        code, out = None, f"(could not spawn a shell: {exc})"
    verdict, why = classify(cmd, code, out)
    shown = "n/a" if code is None else code
    print(f"  red-probe {tid}: {verdict} (exit {shown}) — {why}")
    if verdict != "red":
        refusals.append((tid, verdict, shown, why, cmd, out[-800:].strip()))

if not refusals:
    raise SystemExit(0)

w = sys.stderr
print(f"\nBLOCKED: {len(refusals)} redCommand probe(s) refused at dispatch. "
      "Nothing dispatched; the run stays armed.", file=w)
for tid, verdict, shown, why, cmd, tail in refusals:
    print(f"\n  {tid}: {verdict} (exit {shown}) — {why}", file=w)
    print(f"    command: {cmd}", file=w)
    print("    output:  " + (tail.replace("\n", "\n             ") if tail else "(nothing)"), file=w)
print("\ncraft would have reached the same verdict a round later, after paying for the implementers,"
      "\nverifiers, lenses and mechanical checks. Run the command by hand to see what it needs, fix it"
      "\nin the plan, and re-hash.", file=w)
print("Override (probes nothing, gates nothing): --no-red-probe, or --no-lint to drop both gates.", file=w)
raise SystemExit(3)
PY
}

# ------------------------------------------------- TIER 2b: the MECHANICAL baseline, executed here
# red_probe_gate covers redCommands and nothing else, and it returns early on `readOnly` — where a
# run's whole gate IS its mechanicalChecks. Those were therefore executed for the first time only
# after every implementer, lens and probe had been paid for. A leg that exits 127 is not a verdict,
# and it costs nothing to learn that now.
#
# plan-preflight.ts already implements this; `--only mechanical` keeps it off the redCommands
# red_probe_gate classifies more precisely (pytest 4/5, missing runner, no test output at all).
# Only `critical` refuses: a mixed baseline is normal — the run is what closes the gap — so
# `baseline-split` and `gate-timeout` report and proceed.
mech_probe_gate() {
  local args="$1" js rc
  js="$(mktemp)"
  bun "$SKILL/scripts/plan-preflight.ts" "$args" --cwd "$PWD" --json --only mechanical \
      --timeout "${CRAFT_MECH_PROBE_TIMEOUT:-300}" > "$js" 2>"$js.err"
  rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "  mech-probe: plan-preflight could not run (exit $rc) — refusing to dispatch unprobed" >&2
    cat "$js.err" >&2
    rm -f "$js" "$js.err"
    return 3
  fi
  python3 - "$js" <<'PY'
import json, sys

try:
    d = json.load(open(sys.argv[1]))
except Exception as exc:
    sys.exit(f"  mech-probe: unreadable preflight output ({exc}) — refusing to dispatch unprobed")

probes = [p for p in d.get("probes", []) if p.get("kind") == "mechanical"]
if not probes:
    print("  mech-probe: no mechanicalChecks declared — nothing to probe")
    raise SystemExit(0)

for p in probes:
    state = p.get("skipped") or "exit %s" % p.get("status")
    print("  mech-probe %s: %s (%sms)" % (p.get("key"), state, p.get("ms")))

# Only `critical` refuses. A mixed baseline is normal — the run is what closes the gap — so
# `baseline-split` (minor) and `gate-timeout` (major) report and proceed.
crit = [x for x in d.get("defects", [])
        if x.get("severity") == "critical" and str(x.get("where", "")).startswith("mechanical")]
for x in crit:
    print("\n  CRITICAL %s [%s]\n    %s\n    > %s"
          % (x["rule"], x["where"], x["message"], x["evidence"]), file=sys.stderr)
raise SystemExit(3 if crit else 0)
PY
  rc=$?
  rm -f "$js" "$js.err"
  if [ "$rc" -ne 0 ]; then
    echo "
BLOCKED: a mechanicalCheck cannot run at BASELINE. Nothing dispatched; the run stays armed.
craft would have reached this same verdict a round later, after paying for the implementers,
verifiers and lenses. Fix the command in the plan and re-hash.
Override (probes nothing, gates nothing): --no-mech-probe, or --no-lint to drop every gate." >&2
    return 3
  fi
  return 0
}

# ---------------------------------------------------------------- the red column, shown
# How many active tasks are gated by an EXECUTED redCommand and how many instead carry a
# `redDisposition` — the human's filed claim that no red gate applies to work already complete.
# Echoed verbatim so the claim is visible; its content is judgement and is never graded here.
red_summary() {
  python3 - "$1" <<'PY'
import json, sys
try:
    a = json.load(open(sys.argv[1]))
except (json.JSONDecodeError, OSError) as exc:
    sys.exit(f"red-summary: cannot read {sys.argv[1]} ({exc})")
tasks = a.get("tasks") or []
only = a.get("onlyTasks")
if isinstance(only, list) and only:
    tasks = [t for t in tasks if t.get("id") in set(only)]
gated = sum(1 for t in tasks if t.get("redCommand"))
disp = [(t.get("id", "(unnamed)"), (t.get("redDisposition") or "").strip()) for t in tasks]
disp = [d for d in disp if d[1]]
print(f"  red: {gated} gated, {len(disp)} dispositioned")
for tid, text in disp:
    print(f'    {tid}  "{text}"')
PY
}

# ---------------------------------------------------------------- the plan, archived with its run
# archive_plan <src> <run-dir> <expected-spec-hash>
# Named by the SPEC hash, so it is provably non-destructive for the thing that matters: an amended
# spec lands beside its predecessor instead of over it. A src whose spec no longer matches what the
# run recorded is refused rather than archived under a name that would misdescribe it.
archive_plan() {
  local src="$1" dir="$2" want="$3" got dest
  got=$(spec_hash "$src") || return 1
  if [ "$got" != "$want" ]; then
    echo "archive-plan: $src now specs $got, not the $want this run recorded — not archiving" >&2
    return 1
  fi
  dest="$dir/plan-${want:0:12}.md"
  [ -e "$dest" ] || cp -- "$src" "$dest" || return 1
  echo "plan:  $dest"
}

# Subcommand forms, so craft-redispatch.sh reuses these rather than growing a second copy of them.
if [ "${1:-}" = "--archive-plan" ]; then
  [ -f "${2:-}" ] && [ -d "${3:-}" ] && [ -n "${4:-}" ] \
    || { echo "--archive-plan needs <src> <run-dir> <hash>" >&2; exit 2; }
  archive_plan "$2" "$3" "$4"
  exit $?
fi
if [ "${1:-}" = "--red-summary" ]; then
  [ -f "${2:-}" ] || { echo "--red-summary needs an existing args.json" >&2; exit 2; }
  red_summary "$2"
  exit $?
fi
if [ "${1:-}" = "--red-probe" ]; then
  [ -f "${2:-}" ] || { echo "--red-probe needs an existing args.json" >&2; exit 2; }
  red_probe_gate "$2"
  exit $?
fi

mode=dispatch
lint=1
redprobe=1
mechprobe=1
rundir=""
# The whole spine's provider. farm.sh maps it to a CLIProxyAPI wrapper, and that wrapper remaps the
# TIER NAMES (ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-5.6-terra under codex), so every `model: 'sonnet'`
# in workflow.js follows without a single arg changing. Whole-run granularity by construction: there
# is no way to put implementers on one provider and lenses on another, and mixing them would mean two
# gates. Deliberately NOT recorded in args.json — it is a property of this dispatch, not of the plan,
# and the point of the lever is to differ between rounds.
provider=claude
while :; do
  case "${1:-}" in
    --provider) provider="${2:-}"; shift 2 || { echo "--provider needs claude|codex|gemini" >&2; exit 2; }
               case "$provider" in claude|codex|gemini) ;;
                 *) echo "--provider must be claude|codex|gemini, got: $provider" >&2; exit 2 ;; esac ;;
    --abandon) mode=abandon; shift ;;
    --print)   mode=print;   shift ;;
    --no-lint) lint=0; redprobe=0; mechprobe=0; shift ;;
    --no-red-probe) redprobe=0; shift ;;
    --no-mech-probe) mechprobe=0; shift ;;
    --run-dir) rundir="${2:-}"; shift 2 || { echo "--run-dir needs a directory" >&2; exit 2; }
               [ -n "$rundir" ] || { echo "--run-dir needs a directory" >&2; exit 2; }
               case "$rundir" in /*) ;; *) echo "--run-dir must be absolute: $rundir" >&2; exit 2 ;; esac ;;
    --*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done

plan="${1:-}"
if [ -z "$plan" ]; then
  plan=$(bash "$SKILL/scripts/craft-pending.sh" "$PWD" | cut -f1)
  [ -n "$plan" ] || { echo "no armed craft run in $PWD (and no plan given)" >&2; exit 2; }
fi
[ -f "$plan" ] || { echo "no such plan: $plan" >&2; exit 2; }
plan=$(realpath "$plan")
hash=$(spec_hash "$plan") || exit 1

if [ "$mode" = abandon ]; then
  mkdir -p .craft && printf '%s\n' "$hash" >> .craft/abandoned
  echo "abandoned: $plan"
  echo "  hash $hash recorded in $PWD/.craft/abandoned — the guard no longer holds writes."
  echo "  Editing the spec re-arms it (new hash); dispatch with: craft-dispatch.sh $plan"
  exit 0
fi

# Extract the block and build args.json. Fails loudly rather than inventing anything: a plan
# whose block is malformed is a plan that was never really armed.
run=$(python3 - "$plan" "$hash" "$SKILL" <<'PY'
import json, re, sys
plan, hash_, skill_root = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(plan).read()
m = re.search(r'<!--\s*craft:dispatch\s*(.*?)-->', src, re.S)
if not m:
    sys.exit("plan carries no <!-- craft:dispatch --> block: " + plan)
try:
    block = json.loads(m.group(1))
except json.JSONDecodeError as e:
    sys.exit(f"craft:dispatch block is not valid JSON ({e}): {plan}")
run_id = block.get("runId")
args = block.get("args")
if not run_id or not isinstance(args, dict):
    sys.exit("craft:dispatch block needs a runId and an args object: " + plan)
for k in ("planPath", "planHash", "specHash", "skillRoot"):
    args.pop(k, None)          # injected below; a stale one in the block would be a lie
args["planPath"], args["specHash"] = plan, hash_
# Where craft is installed, so the prompts workflow.js builds name paths that exist here.
args["skillRoot"] = skill_root
args.setdefault("projectDir", block.get("projectDir") or __import__("os").getcwd())
print(json.dumps({"runId": run_id, "turns": block.get("goalTurns", 12), "args": args}))
PY
) || exit 1

runid=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["runId"])' "$run")
turns=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["turns"])' "$run")
R="${rundir:-$PWD/.craft}/$runid"
mkdir -p "$R" || exit 1
# args.json is what disarms the guard, so a preview must NOT write it — otherwise --print would
# release the hold having dispatched nothing.
out="$R/args.json"; [ "$mode" = print ] && out="$R/args.preview.json"

# TIER 1, before $out exists. Blocking findings stop the dispatch with the run still ARMED — writing
# args.json first would release the guard on a plan we are refusing to run.
tmp="$R/.args.lint.json"
# `rounds` is seeded here so a dry run exercises it. Round 1 is this dispatch; craft-redispatch.sh
# increments it. A budget nothing counts is not a budget — the previous "or stop after N turns"
# had no counter anywhere, so a lens re-adjudicated it on every stop. It is a FIELD in the args, not
# a file beside them: new state goes in the existing state object.
python3 - "$run" "$tmp" <<'PY' || exit 1
import json, sys
run, tmp = sys.argv[1], sys.argv[2]
a = json.loads(run)["args"]
a["rounds"] = 1

json.dump(a, open(tmp, "w"), indent=2)
PY
if [ "$lint" = 1 ]; then
  bun "$SKILL/scripts/plan-lint.ts" "$tmp"
  # plan-lint exits 1 WHEN IT HAS FINDINGS, and pipefail is on: never put it in a pipeline whose
  # status is read, and never fall back to 0 on error — a gate that cannot count must fail CLOSED.
  lint_json=$(bun "$SKILL/scripts/plan-lint.ts" "$tmp" --json 2>/dev/null)
  blocking=$(printf '%s' "$lint_json" | python3 -c \
    'import json,sys; f=json.load(sys.stdin)["findings"]; print(sum(1 for x in f if x["severity"] in ("critical","major")))' 2>/dev/null)
  case "$blocking" in
    ''|*[!0-9]*)
      echo "plan-lint did not return a countable verdict — refusing to dispatch unlinted." >&2
      rm -f "$tmp"; exit 3 ;;
  esac
  if [ "$blocking" -gt 0 ] && [ "$mode" != print ]; then
    rm -f "$tmp"
    cat >&2 <<MSG

BLOCKED: $blocking major/critical plan-lint finding(s). Nothing dispatched; the run stays armed.
These are decidable from the plan's own fields — fix the plan, then dispatch again.
Also run, on a quiet tree:  bun $SKILL/scripts/plan-preflight.ts "$plan" --cwd "$PWD"
Override (records nothing, gates nothing): craft-dispatch.sh --no-lint $plan
MSG
    exit 3
  fi
fi

# TIER 2, still before $out exists, so a refusal leaves args.json exactly as it was (or absent) and
# the run armed. Skipped under --print: that mode promises to build and stop, not to run commands.
if [ "$redprobe" = 1 ] && [ "$mode" != print ]; then
  red_probe_gate "$tmp"
  rp=$?
  if [ "$rp" -ne 0 ]; then rm -f "$tmp"; exit "$rp"; fi
fi

# TIER 2b. Deliberately NOT gated on readOnly: red_probe_gate returns early there, and a readOnly
# run's entire gate is its mechanicalChecks — so that is precisely where skipping this probes nothing.
if [ "$mechprobe" = 1 ] && [ "$mode" != print ]; then
  mech_probe_gate "$tmp"
  mp=$?
  if [ "$mp" -ne 0 ]; then rm -f "$tmp"; exit "$mp"; fi
fi
mv "$tmp" "$out" || exit 1

# With args.json, never before it: a plan that was refused never ran, so it is not a run artifact.
archive_plan "$plan" "$R" "$hash" || exit 1

# Sizing, recomputed from what will actually be dispatched. The plan's prose Run sizing block is
# for the human; this is what the gate reads. A mismatch between them is worth stopping over.
python3 - "$out" <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))
t = a.get("tasks") or []
red = sum(1 for x in t if x.get("redCommand"))
lens = len(a.get("reviewLenses") or []) or 2
mech, prior = len(a.get("mechanicalChecks") or []), len(a.get("priorFindings") or [])
scored = sum(len(s.get("items") or []) for s in (a.get("scoredChecks") or []))
tp = len(a.get("thirdParty") or [])
floor = 2*len(t) + 2*red + lens + mech + prior + scored + tp
print(f"  readOnly={bool(a.get('readOnly'))} tasks={len(t)} red={red} lenses={lens} "
      f"mech={mech} scored={scored} prior={prior} thirdParty={tp}")
print(f"  fan-out floor {floor} vs maxAgents {a.get('maxAgents', 50)}")
PY
red_summary "$out"

# The shape `dependsOn` will actually produce, layered by plan-lint.ts the way workflow.js layers it.
# Information, not a gate: it exits 0 whatever it finds, and a cycle has already been refused above.
bun "$SKILL/scripts/plan-lint.ts" "$out" --graph

echo "args:  $out"
[ "$mode" = print ] && { echo "--print: nothing dispatched."; exit 0; }
# Exercises everything above — arg build, lint gate, sizing — and stops before the goal is sent and
# the run is farmed out. For testing this script itself.
[ -n "${CRAFT_DISPATCH_DRYRUN:-}" ] && { echo "CRAFT_DISPATCH_DRYRUN: lint passed, nothing dispatched."; exit 0; }

# Phase 3. The goal is what runs the outer loop (gate FAIL -> fix -> re-run, tuicr findings ->
# fix -> re-review) without the user prompting each step. Named by PATH: the FAIL loop is
# expected to amend and re-hash the plan, so a pinned digest self-invalidates.
if python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("readOnly") else 1)' "$out"; then
  goal=$("$SKILL/scripts/compose-goal.sh" "$plan" "$R" "$turns" 1)
else
  goal=$("$SKILL/scripts/compose-goal.sh" "$plan" "$R" "$turns" 0)
fi
bash "$SKILL/scripts/goal-self-send.sh" "$goal"
gs=$?
[ $gs -eq 0 ] || echo "goal self-send exited $gs — not fatal; submit the line above by hand if it never queued." >&2

# Phase 4. Detached, never foreground: a real gate runs 20-60 min and a foreground call is killed
# mid-run. Harness-tracked background tasks were measured to die too; setsid was not.
setsid nohup bash "$FARM" --provider "$provider" \
  --workflow "$SKILL/workflow.js" \
  --args "$R/args.json" --out "$R/result.json" --cwd "$PWD" \
  > "$R/run.log" 2>&1 < /dev/null &

sleep 2
if bash "$SKILL/scripts/farm-alive.sh" "$R/result.json" > /dev/null; then
  echo "dispatched: $runid (provider: $provider)"
else
  echo "WARNING: no live dispatch for $runid two seconds in — check $R/run.log" >&2
fi

cat <<EOF

Monitor it (persistent, no deadline) and call craft-result.sh when it fires:

  while :; do
    [ -s "$R/result.json" ] && break
    bash $SKILL/scripts/farm-alive.sh "$R/result.json" > /dev/null \\
      || { echo "dispatch died with no verdict — see $R/run.log" >&2; exit 1; }
    sleep 30
  done
  bash $SKILL/scripts/craft-result.sh "$R/result.json"
EOF
