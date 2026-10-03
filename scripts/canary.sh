#!/usr/bin/env bash
# canary.sh — the release gate the unit suite cannot be: two REAL runs through the real path
# (work-dispatch.sh -> work-loop.sh -> work-round.sh -> farm rows -> work-checks.sh -> lens ->
# work-result.sh), against the checkout this script lives in, then decidable assertions over what
# they left on disk. A failing canary blocks the tag.
#
#   scripts/canary.sh --run              suites + template + both runs (the runs cost model calls)
#   scripts/canary.sh --run --only suites|template|diag|dev   one step
#   scripts/canary.sh --dry-run          suites + template, then build + plan-lint + probes for both
#                                        runs, dispatching nothing — no model calls
#   scripts/canary.sh --assert RUN_DIR --events DIR [--expect-exit 0|8] [--mech-count 'RE' ...]
#                                        re-run the assertions on an existing run dir
#   CANARY_TIMEOUT_MIN=40                wall cap per run (default 40)
#   CANARY_DIAG_LECTURE=17               the already-taught secreg lecture the diagnose reads
#
# (a) DIAG: a read-only teaching slides DIAGNOSE of an already-taught secreg lecture whose gates
#     passed. Run dir under ~/.local/state/work; the course tree is only ever READ.
# (b) DEV: one dev round on a throwaway git repo in a temp dir — a red bun test, one task to green it.
# SUITES: workflows' scripts/test.sh in a clean worktree at the committed HEAD, AND teaching's
#     tests/run-all.sh (FAIL on a tracked-file change there), each pointed at the other's tree under
#     release, so a cross-repo break blocks the tag of EITHER repo (teaching 4.3.7's {{NAME}} refs
#     turned workflows' gate-vacuity red while only teaching's suite had run).
# TEMPLATE: teaching's notes repair template rendered for secreg lecture $LECTURE by
#     course_paths.py (scripts/render-template.ts), every course path it names on disk, and
#     plan-lint at 0 findings of any severity — the plan a real session would dispatch.
#
# Isolation: TMPDIR, CLAUDE_CODE_SESSION_ID and CLAUDE_PROJECT_DIR point into a canary temp root, so the
# hold state, the dispatch log, the farm-events stream and any settings.local.json land there — never
# in the course tree and never on the calling session. The bridge id is unset so the hold has no
# transport into the caller.
#
# Exit 0 every assertion held; 1 at least one failed (each is listed); 2 usage or setup. Zero
# arguments is exit 2, never a run: a bare invocation must not spend model calls.
set -uo pipefail

# One brace group: bash parses the whole file before running any of it, so editing this script
# during a 15-minute canary cannot shift the bytes the running copy reads next.
{
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK="$ROOT/skills/work/scripts"
TEACHING=${CANARY_TEACHING:-$HOME/.claude/skills/teaching}
# Resolved: teaching's tests compare paths against their own real checkout, so the default symlink
# would fail them for a reason that is not a defect.
TEACHING=$(cd "$TEACHING" 2>/dev/null && pwd -P || printf '%s' "$TEACHING")
COURSE=${CANARY_COURSE:-$HOME/areas/secreg}
STATE=${CANARY_STATE:-$HOME/.local/state/work}
TIMEOUT_MIN=${CANARY_TIMEOUT_MIN:-40}
LECTURE=${CANARY_DIAG_LECTURE:-17}

die() { printf 'canary: %s\n' "$*" >&2; exit 2; }

ONLY=""; DRY=0; RUN=0; ASSERT_DIR=""; ASSERT_EVENTS=""; ASSERT_EXIT=""; ASSERT_COUNTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY=${2-}; shift 2 || die "--only needs diag|dev" ;;
    --run) RUN=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --assert) ASSERT_DIR=${2-}; shift 2 || die "--assert needs a run dir" ;;
    --events) ASSERT_EVENTS=${2-}; shift 2 || die "--events needs a directory" ;;
    --expect-exit) ASSERT_EXIT=${2-}; shift 2 || die "--expect-exit needs a code list" ;;
    --mech-count) ASSERT_COUNTS+=("${2-}"); shift 2 || die "--mech-count needs a regex" ;;
    -h|--help) sed -n '2,33p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
if [ "$RUN" = 0 ] && [ "$DRY" = 0 ] && [ -z "$ASSERT_DIR" ]; then
  echo "usage: canary.sh --run | --dry-run | --assert RUN_DIR --events DIR — no mode named (--run costs model calls)" >&2
  exit 2
fi
case "$ONLY" in ''|suites|template|diag|dev) ;; *) die "--only must be suites, template, diag or dev, got: $ONLY" ;; esac
step() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
case "$TIMEOUT_MIN" in ''|*[!0-9]*) die "CANARY_TIMEOUT_MIN must be whole minutes" ;; esac

# ------------------------------------------------------------------ the assertions (decidable only)
# assert_run RUN_DIR EVENTS_DIR EXPECTED_EXITS [COUNT_REGEX ...] — prints one FAIL line per failure.
assert_run() {
  LEG_COUNTS_DIR="$WORK" python3 - "$@" <<'PY'
import glob, json, os, re, sys

sys.path.insert(0, os.environ["LEG_COUNTS_DIR"])
from leg_counts import audit as leg_audit

run, events, expect = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
counts = sys.argv[4:]
name = os.path.basename(run.rstrip("/"))
fails = []
def fail(msg): fails.append(f"FAIL [{name}] {msg}")

def read(p):
    try:
        return open(p, encoding="utf-8", errors="replace").read()
    except OSError:
        return None

# 1. A verdict was reached.
ex = (read(os.path.join(run, "loop.exit")) or "").strip()
if ex not in expect:
    fail(f"loop.exit is {ex or '(missing)'}, expected {' or '.join(expect)}")
res = None
try:
    res = json.load(open(os.path.join(run, "result.json")))
    if isinstance(res, list):
        res = res[-1]
except Exception as e:
    fail(f"result.json unreadable: {e}")
if res is not None and not isinstance(res.get("overallPass"), bool):
    fail("result.json carries no boolean overallPass — no verdict")

# 2. No tool error line anywhere the run logged.
SIGS = [
    (r"E2BIG|Argument list too long", "E2BIG"),
    (r"Traceback \(most recent call last\)", "Python traceback"),
    (r"ChildProcessError", "ChildProcessError"),
    (r"ENOENT[^\n]*(?:/\.claude/(?:skills|plugins)/|/projects/(?:workflows|teaching)/)", "ENOENT on a plugin path"),
    (r"refused the round", "redispatch refused the round"),
    (r"(?i)\bhook (?:error|failed)|hook[^\n]{0,40}(?:non-blocking|blocking) error|Hook [A-Za-z:]+ failed", "hook error"),
    (r"UNVERIFIED:", "UNVERIFIED row"),
    (r"COULD-NOT-(?:RUN|CHECK)", "a leg could not run/check"),
    (r"command not found|exited 127\b", "missing command"),
]
logs = sorted(glob.glob(os.path.join(run, "run*.log"))) + [os.path.join(run, "loop.log"), os.path.join(run, "checks.json")]
for p in logs:
    text = read(p)
    if text is None:
        if not p.endswith("checks.json") and os.path.basename(p) != "loop.log":
            continue
        fail(f"{os.path.basename(p)} missing")
        continue
    if p.endswith("checks.json"):
        try:
            c = json.loads(text)
            text = "\n".join(str(x.get(k, "")) for sec in ("red", "acceptance", "mechanical", "rules")
                             for x in c.get(sec) or [] for k in ("output", "stdout", "stderr"))
        except Exception as e:
            fail(f"checks.json unparseable: {e}")
            continue
    for rx, label in SIGS:
        for m in re.finditer(rx, text):
            line = text[text.rfind("\n", 0, m.start()) + 1: text.find("\n", m.end()) if text.find("\n", m.end()) >= 0 else len(text)]
            fail(f"{label} in {os.path.basename(p)}: {line.strip()[:220]}")
            break

# 3. Every mechanical and rule leg examined a non-zero amount: leg_counts.audit, the one parser of the
# `<leg>: N <unit> examined` convention that work-checks.sh and every check.sh leg also use. The output
# is checks.json's 60-line tail, so a leg whose header was cut is not looked for here — work-checks.sh
# audited the full output and left its COULD-NOT-CHECK lines in that tail (assertion 2 reports them).
try:
    c = json.load(open(os.path.join(run, "checks.json")))
except Exception:
    c = {}
mech = c.get("mechanical") or []
if not mech:
    fail("checks.json has no mechanical check — the round gated on nothing")
for m in mech:
    out = (m.get("output") or "") + "\n" + (m.get("stdout") or "")
    for f in leg_audit(out):
        fail(f"mechanical {m.get('name')}: {f}")
    for rx in counts:
        hits = [int(x) for x in re.findall(rx, out)]
        if not hits:
            fail(f"mechanical {m.get('name')}: no count line matching /{rx}/")
        elif max(hits) == 0:
            fail(f"mechanical {m.get('name')}: /{rx}/ counted 0 — vacuous")
rules = c.get("rules") or []
if not rules:
    fail("checks.json has no rule leg")
for r in rules:
    if r.get("exitCode") not in (0, 1):
        fail(f"rule leg {r.get('name')} exited {r.get('exitCode')}")
    try:
        v = json.loads(r.get("stdout") or "")
    except Exception:
        fail(f"rule leg {r.get('name')}: stdout is not the verdict JSON")
        continue
    if not v.get("verdicts"):
        fail(f"rule leg {r.get('name')}: 0 verdicts — examined nothing")
    if v.get("unavailable"):
        fail(f"rule leg {r.get('name')}: unavailable {json.dumps(v['unavailable'])[:220]}")
if res is not None:
    st = res.get("scoreTable") or {}
    if not st.get("lensesReported"):
        fail("the lens never reported (scoreTable.lensesReported)")
    if not st.get("mechanicalRun"):
        fail("scoreTable.mechanicalRun is 0 — no mechanical leg ran")
    if not st.get("ruleVerdicts"):
        fail("scoreTable.ruleVerdicts is 0 — no rule was judged")

# 4. Tokens recorded, and no row with tool calls at W=0.
# 5. The watcher stream has START and DONE for the loop, the round(s) and every farm row.
evfiles = glob.glob(os.path.join(events, "*.ndjson"))
lines = []
for f in evfiles:
    for ln in (read(f) or "").splitlines():
        lines.append((f, ln))
dec = lambda s: re.sub(r"%([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), s)
real = os.path.realpath(run)
# An event file is this run's when a START out= or a CLAIM path= in it lies inside the run dir (a
# lens row's START carries an empty out= and names lens.json only in its CLAIM).
mine = set()
for f, ln in lines:
    for m in re.finditer(r" (?:out|path)=(\S+)", ln):
        if os.path.realpath(dec(m.group(1))).startswith(real + "/"):
            mine.add(f)
starts = {}
dones = {}
W = 0
for f, ln in lines:
    if f not in mine:
        continue
    m = re.match(r"farm: START (\S+)", ln)
    if m:
        starts.setdefault((f, m.group(1)), ln)
    m = re.match(r"farm: DONE (\S+) (\S+)(.*)", ln)
    if m:
        dones[(f, m.group(1))] = ln
        tc = re.search(r"toolCalls=(\d+)", ln)
        w = re.search(r"\bW=(\d+)", ln)
        if w:
            W += int(w.group(1))
        if tc and int(tc.group(1)) > 0 and w and int(w.group(1)) == 0:
            fail(f"row {dec(m.group(1))} made {tc.group(1)} tool call(s) but recorded W=0")
labels = {dec(l) for _, l in starts}
for need in ("work-loop", "work-round"):
    if need not in labels:
        fail(f"no START {need} in the watcher stream ({events})")
for key, ln in starts.items():
    if key not in dones:
        fail(f"START {dec(key[1])} has no DONE in {os.path.basename(key[0])}")
if not any(k[1] not in ("work-loop", "work-round") for k in starts):
    fail("no farm row START in the watcher stream — no model row ran")
if W <= 0:
    fail("tokens recorded: 0 W across every farm row")

for x in fails:
    print(x)
print(f"canary: [{name}] {'ok' if not fails else str(len(fails)) + ' failure(s)'} "
      f"(loop.exit={ex or '-'}, verdict={'PASS' if res and res.get('overallPass') else 'FAIL' if res else '-'}, "
      f"W={W}, event files={len(mine)})", file=sys.stderr)
sys.exit(1 if fails else 0)
PY
}

if [ -n "$ASSERT_DIR" ]; then
  [ -d "$ASSERT_DIR" ] || die "no such run dir: $ASSERT_DIR"
  [ -n "$ASSERT_EVENTS" ] || die "--assert needs --events DIR (the session's farm-events directory)"
  assert_run "$ASSERT_DIR" "$ASSERT_EVENTS" "${ASSERT_EXIT:-0,8}" "${ASSERT_COUNTS[@]}"
  exit $?
fi

# ------------------------------------------------------------------ setup
# The suites step runs workflows' own suite; a canary started from inside it would recurse.
[ -z "${CANARY_NESTED:-}" ] || die "refusing to run inside a canary's own suite run (CANARY_NESTED is set)"
command -v bun >/dev/null || die "bun not on PATH"
command -v jq >/dev/null || die "jq not on PATH"
STAMP=$(date +%m%d-%H%M%S)-$$
HOME_DIR=$(mktemp -d "${CANARY_TMP:-/tmp}/workflows-canary.XXXXXX") || die "mktemp failed"
mkdir -p "$HOME_DIR/tmp" "$STATE"
SID="canary-$STAMP"
EVENTS="$HOME_DIR/tmp/farm-events/$SID"
echo "canary: checkout $ROOT ($(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null))"
echo "canary: temp root $HOME_DIR, session $SID, state $STATE"

# Run a command as the canary's own session, from DIR.
as_canary() {
  local dir=$1; shift
  ( cd "$dir" && env -u CLAUDE_CODE_BRIDGE_SESSION_ID -u HERDR_PANE_ID -u HERDR_ENV \
      TMPDIR="$HOME_DIR/tmp" CLAUDE_CODE_SESSION_ID="$SID" CLAUDE_PROJECT_DIR="$dir" "$@" )
}

dispatch() {   # dispatch NAME PLAN_DIR PLAN LOOPS
  local flags=(--run-dir "$STATE" --no-cron --loops "$4")
  if [ "$DRY" = 1 ]; then
    as_canary "$2" env WORK_DISPATCH_DRYRUN=1 bash "$WORK/work-dispatch.sh" "${flags[@]}" "$3"
  else
    as_canary "$2" bash "$WORK/work-dispatch.sh" "${flags[@]}" "$3"
  fi
}

# ------------------------------------------------------------------ (a) the read-only diagnose
DIAG_ID="canary-diag-$STAMP"
plan_diag() {
  local dir=$HOME_DIR/diag deck master inv chap
  mkdir -p "$dir"
  deck=$(cd "$COURSE" && ls slides/*/"$LECTURE".typ 2>/dev/null | head -1)
  [ -n "$deck" ] || die "no deck for lecture $LECTURE under $COURSE/slides/*/"
  chap=$(basename "$(dirname "$deck")")
  master="slides/$chap.typ"
  inv=$(cd "$COURSE" && ls inventory/content-inventory-*-"$LECTURE".md 2>/dev/null | head -1)
  [ -n "$inv" ] || die "no inventory for lecture $LECTURE"
  python3 - "$dir/plan.md" "$DIAG_ID" "$COURSE" "$deck" "$master" "$inv" "$LECTURE" "$TEACHING" "$WORK" <<'PY'
import json, sys
out, rid, course, deck, master, inv, nn, teaching, work = sys.argv[1:]
refs = f"{teaching}/skills/slides/references"
mech = (f"bash {teaching}/skills/slides/scripts/check.sh --course {course} --master {master} "
        f"--lecture {nn}:{deck}:{inv}")
block = {"runId": rid, "goalTurns": 1, "args": {
  "projectDir": course,
  "goal": f"Reach a verdict on whether the already-taught lecture {nn} deck {deck} is complete and source-faithful against its inventory.",
  "readOnly": True,
  "maxRounds": 1,
  "tasks": [],
  "mechanicalChecks": [{"name": "slides-mech", "cmd": mech}],
  "ruleChecks": {"name": "jev-slides-rules",
                 "cmd": f"bun {work}/rule-check.ts --files {course}/{deck} --rules {teaching}/constraints/jev/slides"},
  "lens": {
    "agentType": "slide-auditor",
    "refs": [f"{refs}/verification-checks.md", f"{course}/{deck}", f"{course}/{inv}"],
    "prompt": ("CANARY: keep this pass SHORT — at most 12 tool calls. Judge ONE lecture, " + nn + ", against its "
               "inventory using S1 in the refs. Report as MAJOR one finding per inventory item MISSING from the deck, "
               "quoting the inventory id and the nearest deck line. If you classified ZERO inventory items, report "
               "that as CRITICAL. Every finding has ownerTask 'plan' (the task table is empty). Change nothing."),
  },
  "authorityExtra": "IRON LAW — this run is READ-ONLY. Create, edit and overwrite no file in the course tree.",
}}
open(out, "w").write(
  "---\nworkflow: teaching:slides\n---\n\n"
  f"# CANARY slides diagnose — lecture {nn} (read-only)\n\n"
  "Release canary: one real read-only diagnose of an already-taught lecture. The task table is empty.\n\n"
  "Goal: the audit reaches a verdict (PASS or FAIL).\n\n"
  "<!-- work:dispatch\n" + json.dumps(block, indent=1) + "\n-->\n")
PY
  echo "$dir"
}

# ------------------------------------------------------------------ (b) the dev round
DEV_ID="canary-dev-$STAMP"
plan_dev() {
  local dir=$HOME_DIR/dev
  mkdir -p "$dir/src"
  cat > "$dir/src/clamp.js" <<'JS'
// clamp(x, lo, hi): x limited to the closed range [lo, hi].
export function clamp(x, lo, hi) {
  return x
}
JS
  cat > "$dir/src/clamp.test.js" <<'JS'
import { expect, test } from 'bun:test'
import { clamp } from './clamp.js'

test('clamp limits a value to [lo, hi]', () => {
  expect(clamp(5, 0, 10)).toBe(5)
  expect(clamp(-3, 0, 10)).toBe(0)
  expect(clamp(42, 0, 10)).toBe(10)
})
JS
  printf '{ "name": "canary-fixture", "type": "module", "private": true }\n' > "$dir/package.json"
  printf 'node_modules/\n.work/\n.claude/\n' > "$dir/.gitignore"
  ( cd "$dir" && git init -q && git add -A && git -c user.name=canary -c user.email=canary@localhost commit -qm fixture ) \
    || die "fixture git init failed"
  python3 - "$dir/plan.md" "$DEV_ID" "$dir" "$ROOT" <<'PY'
import json, sys
out, rid, proj, root = sys.argv[1:]
dev = f"{root}/skills/dev"
block = {"runId": rid, "goalTurns": 2, "args": {
  "projectDir": proj,
  "goal": "clamp(x, lo, hi) in src/clamp.js returns x limited to [lo, hi], and `bun test` passes.",
  "maxRounds": 2,
  "tasks": [{
    "id": "T1", "name": "implement clamp",
    "work": "src/clamp.js returns x unchanged. Make clamp return lo when x < lo and hi when x > hi. The test in src/clamp.test.js already exists and is red; do not change it. Keep the change to src/clamp.js.",
    "writablePaths": ["src/clamp.js"],
    "acceptance": "clamp(-3, 0, 10) is 0 and clamp(42, 0, 10) is 10, as src/clamp.test.js asserts.",
    "redCommand": "bun test src/clamp.test.js",
    "refs": [f"{dev}/references/tdd.md"],
  }],
  "mechanicalChecks": [{"name": "dev",
    "cmd": f"bash {dev}/scripts/check.sh --project-dir {proj} --test-cmd \"bun test\""}],
  "ruleChecks": {"name": "jev-dev-rules",
    "cmd": f"bun {root}/skills/work/scripts/rule-check.ts --project-dir {proj} --plan {out} --rules {root}/constraints/jev/dev"},
  "lens": {
    "agentType": "Explore",
    "refs": [f"{dev}/references/lens-security.md"],
    "prompt": ("CANARY: keep this pass SHORT — at most 8 tool calls. Judge the change in the working tree against "
               "the plan and the goal: (1) does an artifact satisfy each criterion; (2) did edits stay inside "
               "src/clamp.js. MODE RED: route each failure in the digest to T1 or 'plan'. MODE GREEN: one pass, "
               "every finding with an ownerTask. Severity MAJOR at minimum."),
  },
  "authorityExtra": "CANARY fixture: the red test already exists; the task is the implementation only. Keep it to the one function.",
  "verifierAgentType": "Explore",
}}
open(out, "w").write(
  "---\nworkflow: dev\n---\n\n# CANARY dev round — clamp\n\n"
  "| id | task | writablePaths |\n|---|---|---|\n| T1 | implement clamp | src/clamp.js |\n\n"
  "<!-- work:dispatch\n" + json.dumps(block, indent=1) + "\n-->\n")
PY
  echo "$dir"
}

# ------------------------------------------------------------------ suites: both repos, before any tag
# Each suite is pointed at the OTHER repo's checkout under release: teaching's tests resolve plan-lint,
# leg_counts and the Jev runner from this checkout, and workflows' gate-vacuity probes $TEACHING.
# The tag goes on the committed HEAD, so workflows' suite runs in a clean worktree at HEAD: the main
# checkout carries other sessions' uncommitted files, and one unpinned binary there blocked 6.38.0.
# Teaching stays in its checkout (its agent-resolution test needs the real path), so a tracked-file
# change there FAILS: a dirty tree is not what gets tagged.
SUITE_WT=""
drop_suite_wt() {   # only the worktree this invocation minted
  [ -n "$SUITE_WT" ] || return 0
  git -C "$ROOT" worktree remove --force "$SUITE_WT" >/dev/null 2>&1 || rm -rf -- "$SUITE_WT"
  git -C "$ROOT" worktree prune >/dev/null 2>&1
  SUITE_WT=""
}
run_suites() {
  local rc head dirty wf
  [ -x "$ROOT/scripts/test.sh" ] || { echo "FAIL [suites] $ROOT/scripts/test.sh is missing — NO SUITE RAN"; FAILED=1; return; }
  [ -f "$TEACHING/tests/run-all.sh" ] || { echo "FAIL [suites] $TEACHING/tests/run-all.sh is missing — NO SUITE RAN"; FAILED=1; return; }
  head=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null) \
    || { echo "FAIL [suites] $ROOT is not a git checkout — no committed HEAD to test, NO SUITE RAN"; FAILED=1; return; }
  SUITE_WT=$(mktemp -d "$HOME_DIR/suite-head.XXXXXX") \
    && git -C "$ROOT" worktree add --detach "$SUITE_WT" "$head" >/dev/null 2>&1 \
    || { echo "FAIL [suites] could not create a clean worktree at ${head:0:12} — NO SUITE RAN"; drop_suite_wt; FAILED=1; return; }
  trap drop_suite_wt EXIT
  wf=$SUITE_WT
  echo; echo "=== canary suites: workflows at ${head:0:12} (committed HEAD, clean worktree $wf)"
  ( cd "$wf" && CANARY_NESTED=1 TEACHING_PLUGIN_ROOT="$TEACHING" bash scripts/test.sh ) > "$HOME_DIR/workflows-suite.log" 2>&1
  rc=$?
  # Each suite's summary and its failing tests are what a reader needs; the full log is kept.
  grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)$|^Ran |^test\.sh: |Unhandled error' "$HOME_DIR/workflows-suite.log" | tail -n 40
  [ "$rc" = 0 ] || { echo "FAIL [suites] workflows scripts/test.sh at ${head:0:12} exited $rc — log $HOME_DIR/workflows-suite.log"; FAILED=1; }
  echo; echo "=== canary suites: teaching ($TEACHING at $(git -C "$TEACHING" rev-parse --short=12 HEAD 2>/dev/null || echo 'no git HEAD'))"
  dirty=$(git -C "$TEACHING" status --porcelain --untracked-files=no 2>&1)
  if [ -n "$dirty" ]; then
    echo "FAIL [suites] teaching checkout has uncommitted changes to tracked files — the suite below is not testing what gets tagged:"
    printf '%s\n' "$dirty" | sed 's/^/  /'
    FAILED=1
  fi
  mkdir -p "$HOME_DIR/tmp/teaching-suite"
  ( cd "$TEACHING" && CANARY_NESTED=1 TMPDIR="$HOME_DIR/tmp/teaching-suite" PLAN_LINT="$wf/skills/work/scripts/plan-lint.ts" \
      WORKFLOWS_ROOT="$wf" LEG_COUNTS_PY="$wf/skills/work/scripts/leg_counts.py" bash tests/run-all.sh ) > "$HOME_DIR/teaching-suite.log" 2>&1
  rc=$?
  grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)$|[0-9]+ (passed|failed)|^FAILED|^ERROR|^==' "$HOME_DIR/teaching-suite.log" | tail -n 25
  [ "$rc" = 0 ] || { echo "FAIL [suites] teaching tests/run-all.sh exited $rc — log $HOME_DIR/teaching-suite.log"; FAILED=1; }
  drop_suite_wt
  trap - EXIT
}

# ------------------------------------------------------------------ template: a real course's plan lints clean
run_template() {
  local dir=$HOME_DIR/template rc n
  mkdir -p "$dir"
  echo; echo "=== canary template: teaching notes repair template, secreg lecture $LECTURE"
  [ -f "$TEACHING/scripts/render-template.ts" ] \
    || { echo "FAIL [template] $TEACHING/scripts/render-template.ts is missing — nothing rendered"; FAILED=1; return; }
  bun "$TEACHING/scripts/render-template.ts" --skill notes --mode repair --course "$COURSE" \
      --lecture "$LECTURE" --check-paths > "$dir/args.raw.json"
  rc=$?
  [ "$rc" = 0 ] || { echo "FAIL [template] render-template.ts exited $rc (1 = a course path is absent, 2 = no render)"; FAILED=1; return; }
  python3 - "$dir" <<'PY' || { echo "FAIL [template] could not build the plan and args for plan-lint"; FAILED=1; return; }
import json, os, sys
d = sys.argv[1]
args = json.load(open(os.path.join(d, "args.raw.json")))
plan = os.path.join(d, "plan.md")
open(plan, "w").write("# CANARY notes repair template\n\n<!-- work:dispatch\n"
                      + json.dumps({"runId": "canary-template", "args": args}, indent=1) + "\n-->\n")
json.dump({**args, "planPath": plan, "rounds": 1}, open(os.path.join(d, "args.json"), "w"), indent=2)
PY
  bun "$WORK/plan-lint.ts" "$dir/args.json" --json > "$dir/lint.json"
  rc=$?
  n=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["findings"]))' "$dir/lint.json" 2>/dev/null)
  case "$rc:$n" in
    0:0) echo "template: plan-lint 0 finding(s) over the rendered notes repair template" ;;
    *) echo "FAIL [template] plan-lint exited $rc with ${n:-an uncountable number of} finding(s) — a template must lint with ZERO of any severity"
       bun "$WORK/plan-lint.ts" "$dir/args.json" 2>&1 | head -n 20; FAILED=1 ;;
  esac
}

# ------------------------------------------------------------------ run
RUNS=()   # NAME|DIR|RUN_DIR|EXPECT|COUNTS (counts joined by \x1f)
FAILED=0
step suites && run_suites
step template && run_template
if step diag; then
  d=$(plan_diag) || exit 2
  echo; echo "=== canary (a): read-only diagnose, secreg lecture $LECTURE -> $STATE/$DIAG_ID"
  # The diagnose plan states its own maxRounds 1; the loop exits 8 at a read-only verdict.
  if dispatch diag "$d" "$d/plan.md" 1; then
    RUNS+=("diag|$d|$STATE/$DIAG_ID|0,8|american-english: (\d+) (?:added )?line\(s\) examined"$'\x1f'"case-cites: (\d+) (?:added )?\(CP N\) cite\(s\) examined")
  else
    echo "FAIL [diag] work-dispatch.sh refused or failed (exit above)"; FAILED=1
  fi
fi
if step dev; then
  d=$(plan_dev) || exit 2
  echo; echo "=== canary (b): dev round on a throwaway repo ($d) -> $STATE/$DEV_ID"
  if dispatch dev "$d" "$d/plan.md" 2; then
    RUNS+=("dev|$d|$STATE/$DEV_ID|0|(\d+) pass")
  else
    echo "FAIL [dev] work-dispatch.sh refused or failed (exit above)"; FAILED=1
  fi
fi

if [ "$DRY" = 1 ]; then
  echo; echo "canary: --dry-run — suites and template run; runs built, linted and probed; nothing dispatched"
  [ "$FAILED" = 0 ] && echo "canary: dry-run PASS" || echo "canary: dry-run FAIL — the failures are listed above"
  # Only the two run dirs this invocation minted (their ids carry this STAMP); a failure keeps the
  # temp root, which holds the teaching suite's log and the rendered template.
  rm -rf -- "$STATE/$DIAG_ID" "$STATE/$DEV_ID"
  if [ "$FAILED" = 0 ]; then rm -rf -- "$HOME_DIR"; else echo "canary: temp root kept at $HOME_DIR"; fi
  exit "$FAILED"
fi

# ------------------------------------------------------------------ wait, then assert
deadline=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
for r in "${RUNS[@]}"; do
  IFS='|' read -r name _ rdir _ _ <<< "$r"
  while [ ! -s "$rdir/loop.exit" ]; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "FAIL [$name] no loop.exit after ${TIMEOUT_MIN} min — $rdir/loop.log"; FAILED=1; break
    fi
    sleep 20
  done
done

echo
for r in "${RUNS[@]}"; do
  IFS='|' read -r name _ rdir expect counts <<< "$r"
  [ -s "$rdir/loop.exit" ] || continue
  IFS=$'\x1f' read -r -a cre <<< "$counts"
  echo "=== assertions: $name ($rdir)"
  echo "--- work-result.sh"
  bash "$WORK/work-result.sh" "$rdir/result.json" 2>&1 | sed -n '1,4p'
  assert_run "$rdir" "$EVENTS" "$expect" "${cre[@]}" || FAILED=1
done

if [ "$FAILED" = 0 ]; then
  echo; echo "canary: PASS — every run reached a verdict and every assertion held"
  rm -rf -- "$HOME_DIR"
else
  echo; echo "canary: FAIL — the failures are listed above; temp root kept at $HOME_DIR"
fi
exit "$FAILED"
}
