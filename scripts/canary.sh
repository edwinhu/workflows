#!/usr/bin/env bash
# canary.sh — the release gate the unit suite cannot be: two REAL runs through the real path
# (work-dispatch.sh -> work-loop.sh -> work-round.sh -> farm rows -> work-checks.sh -> lens ->
# work-result.sh), against the checkout this script lives in, then decidable assertions over what
# they left on disk. A failing canary blocks the tag.
#
#   scripts/canary.sh --run              both runs (costs model calls: a few farm rows each)
#   scripts/canary.sh --run --only diag|dev   one of them
#   scripts/canary.sh --dry-run          build + plan-lint + probes for both, dispatch nothing
#   scripts/canary.sh --assert RUN_DIR --events DIR [--expect-exit 0|8] [--mech-count 'RE' ...]
#                                        re-run the assertions on an existing run dir
#   CANARY_TIMEOUT_MIN=40                wall cap per run (default 40)
#   CANARY_DIAG_LECTURE=17               the already-taught secreg lecture the diagnose reads
#
# (a) DIAG: a read-only teaching slides DIAGNOSE of an already-taught secreg lecture whose gates
#     passed. Run dir under ~/.local/state/work; the course tree is only ever READ.
# (b) DEV: one dev round on a throwaway git repo in a temp dir — a red bun test, one task to green it.
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
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
if [ "$RUN" = 0 ] && [ "$DRY" = 0 ] && [ -z "$ASSERT_DIR" ]; then
  echo "usage: canary.sh --run | --dry-run | --assert RUN_DIR --events DIR — no mode named (--run costs model calls)" >&2
  exit 2
fi
case "$ONLY" in ''|diag|dev) ;; *) die "--only must be diag or dev, got: $ONLY" ;; esac
case "$TIMEOUT_MIN" in ''|*[!0-9]*) die "CANARY_TIMEOUT_MIN must be whole minutes" ;; esac

# ------------------------------------------------------------------ the assertions (decidable only)
# assert_run RUN_DIR EVENTS_DIR EXPECTED_EXITS [COUNT_REGEX ...] — prints one FAIL line per failure.
assert_run() {
  python3 - "$@" <<'PY'
import glob, json, os, re, sys

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

# 3. Every mechanical and rule leg examined a non-zero amount.
try:
    c = json.load(open(os.path.join(run, "checks.json")))
except Exception:
    c = {}
mech = c.get("mechanical") or []
if not mech:
    fail("checks.json has no mechanical check — the round gated on nothing")
COUNT = re.compile(r"^([\w-]+): .*?\b(\d+) (?:added )?(?:\(CP N\) )?(?:line|cite|test|item|page|row)\(s\) (read|checked|examined|scanned)\b", re.M)
for m in mech:
    out = (m.get("output") or "") + "\n" + (m.get("stdout") or "")
    for leg, n, verb in [(g[0], int(g[1]), g[2]) for g in COUNT.findall(out)]:
        if n == 0:
            fail(f"mechanical {m.get('name')}: leg {leg} {verb} 0 — vacuous")
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

# ------------------------------------------------------------------ run
RUNS=()   # NAME|DIR|RUN_DIR|EXPECT|COUNTS (counts joined by \x1f)
FAILED=0
if [ "$ONLY" != dev ]; then
  d=$(plan_diag) || exit 2
  echo; echo "=== canary (a): read-only diagnose, secreg lecture $LECTURE -> $STATE/$DIAG_ID"
  # The diagnose plan states its own maxRounds 1; the loop exits 8 at a read-only verdict.
  if dispatch diag "$d" "$d/plan.md" 1; then
    RUNS+=("diag|$d|$STATE/$DIAG_ID|0,8|american-english: \d+ file\(s\), (\d+) (?:added )?line\(s\) read"$'\x1f'"case-cites: \d+ file\(s\), (\d+) (?:added )?\(CP N\) cite\(s\) checked")
  else
    echo "FAIL [diag] work-dispatch.sh refused or failed (exit above)"; FAILED=1
  fi
fi
if [ "$ONLY" != diag ]; then
  d=$(plan_dev) || exit 2
  echo; echo "=== canary (b): dev round on a throwaway repo ($d) -> $STATE/$DEV_ID"
  if dispatch dev "$d" "$d/plan.md" 2; then
    RUNS+=("dev|$d|$STATE/$DEV_ID|0|(\d+) pass")
  else
    echo "FAIL [dev] work-dispatch.sh refused or failed (exit above)"; FAILED=1
  fi
fi

if [ "$DRY" = 1 ]; then
  echo; echo "canary: --dry-run — built, linted and probed; nothing dispatched"
  # Only the two run dirs this invocation minted (their ids carry this STAMP).
  rm -rf -- "$HOME_DIR" "$STATE/$DIAG_ID" "$STATE/$DEV_ID"
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
