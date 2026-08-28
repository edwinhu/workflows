#!/usr/bin/env bash
# Classify a plan's blocking defects into MECHANICALLY fixable and SCOPE decisions.
#
#   craft-amend.sh --plan <plan.md> --args <args.json> [--apply]
#
# Exactly two plan-lint rules are auto-amendable, because only those two have a fix that invents
# nothing:
#
#   work-accretion            collapse the work cell to its LATEST round marker, by REPLACEMENT
#   redcommand-relative-path  rewrite the repo-relative gate path against projectDir
#
# Every other blocking rule ESCALATES. Fixing one means authoring a criterion or widening a
# permission, and both are choosing SCOPE — an amender that guessed there would launder a broken
# brief past the gate.
#
# Exit: 0 an AUTO set exists (and was applied under --apply), 7 something escalates (under --apply
# the plan is left byte-identical), 1 no blocking findings, 2 bad arguments or an unreadable plan.
#
# Env: CRAFT_PLAN_LINT overrides the linter path.
set -uo pipefail

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LINT="${CRAFT_PLAN_LINT:-$SKILL_DIR/scripts/plan-lint.ts}"

die() { printf 'craft-amend: %s\n' "$1" >&2; exit 2; }

PLAN=""; ARGS=""; APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --plan)  [ $# -ge 2 ] || die "--plan needs a value";  PLAN=$2; shift 2 ;;
    --args)  [ $# -ge 2 ] || die "--args needs a value";  ARGS=$2; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) sed -n '2,19p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$PLAN" ] || die "--plan is required"
[ -n "$ARGS" ] || die "--args is required"
[ -f "$PLAN" ] || die "plan not found: $PLAN"
[ -f "$ARGS" ] || die "args not found: $ARGS"
[ -f "$LINT" ] || die "plan-lint not found: $LINT"

# plan-lint exits 1 whenever it has findings, which is the normal case here — read its JSON, not
# its status. An empty capture is the real failure (parse refusal, exit 2).
LINT_JSON=$(bun "$LINT" "$ARGS" --json 2>/dev/null)
LINT_RC=$?
[ -n "$LINT_JSON" ] || die "plan-lint produced no JSON for $ARGS (exit $LINT_RC)"

CRAFT_AMEND_PLAN="$PLAN" CRAFT_AMEND_ARGS="$ARGS" CRAFT_AMEND_APPLY="$APPLY" \
python3 - "$LINT_JSON" <<'PY'
import difflib, json, os, re, sys

AUTO_RULES = ("work-accretion", "redcommand-relative-path")
BLOCKING = ("critical", "major")

plan_path = os.environ["CRAFT_AMEND_PLAN"]
args_path = os.environ["CRAFT_AMEND_ARGS"]
apply = os.environ["CRAFT_AMEND_APPLY"] == "1"

try:
    findings = json.loads(sys.argv[1]).get("findings", [])
except Exception as e:
    sys.stderr.write("craft-amend: plan-lint JSON is unreadable: %s\n" % e)
    sys.exit(2)

# An auto-amendable rule is selected by RULE, not by severity: plan-lint rates
# redcommand-relative-path minor, and a severity filter applied first swallowed it before the AUTO
# set was ever consulted. Escalation is still severity-gated — only a blocking finding a rule cannot
# fix is a human's decision.
auto = [f for f in findings if f.get("rule") in AUTO_RULES]
escalate = [f for f in findings
            if f.get("severity") in BLOCKING and f.get("rule") not in AUTO_RULES]
blocking = auto + escalate

def report(label, items):
    for f in items:
        print("%-8s %s  [%s]" % (label, f.get("rule", "?"), f.get("where", "?")))
        print("         %s" % f.get("message", ""))

report("AUTO", auto)
report("ESCALATE", escalate)
print("\n%d blocking finding(s): %d AUTO, %d ESCALATE" % (len(blocking), len(auto), len(escalate)))

if not blocking:
    print("nothing to amend")
    sys.exit(1)

# Escalation wins over an applicable AUTO set: a plan carrying a scope decision is not amended at
# all, so no auto-edit can ride alongside a defect a human still has to settle.
if escalate:
    print("escalating: a fix for the above means authoring a criterion or widening a permission")
    sys.exit(7)

if not apply:
    sys.exit(0)

# ---------------------------------------------------------------- apply

BLOCK = re.compile(r"(<!--\s*craft:dispatch\s*)([\s\S]*?)(-->)")
# plan-lint's own marker regex, so the collapse is judged by the rule that raised the finding.
ROUND_MARKER = re.compile(r"\bROUND \d+\b|\bRound \d+\s*[—–-]")
# plan-lint's own relative-path probe (R4).
REL_PATH = re.compile(r"(?:^|\s)((?!/)[\w.-]+/[\w./-]+)")
WHERE_TASK = re.compile(r"task\s+(\S+)")

before = open(plan_path, encoding="utf-8").read()
m = BLOCK.search(before)
if not m:
    sys.stderr.write("craft-amend: %s carries no craft:dispatch block\n" % plan_path)
    sys.exit(2)
try:
    block = json.loads(m.group(2))
except Exception as e:
    sys.stderr.write("craft-amend: dispatch block is not JSON: %s\n" % e)
    sys.exit(2)

try:
    project_dir = json.load(open(args_path, encoding="utf-8")).get("projectDir", "")
except Exception as e:
    sys.stderr.write("craft-amend: cannot read %s: %s\n" % (args_path, e))
    sys.exit(2)

tasks = block.get("args", {}).get("tasks", [])
by_id = {t.get("id"): t for t in tasks}

def collapse_work(task):
    """A round amendment REPLACES the cell: keep the LATEST marker and drop what it superseded."""
    work = task.get("work", "")
    marks = list(ROUND_MARKER.finditer(work))
    if len(marks) < 2:
        return False
    task["work"] = work[marks[-1].start():].strip()
    return True

def absolutise_gate(task):
    rc = task.get("redCommand", "")
    hit = REL_PATH.search(rc)
    if not rc or not hit or not project_dir:
        return False
    task["redCommand"] = rc[:hit.start(1)] + os.path.join(project_dir, hit.group(1)) + rc[hit.end(1):]
    return True

FIXES = {"work-accretion": collapse_work, "redcommand-relative-path": absolutise_gate}

changed = 0
for f in auto:
    w = WHERE_TASK.search(f.get("where", "") or "")
    task = by_id.get(w.group(1)) if w else None
    if task is None:
        sys.stderr.write("craft-amend: finding %s names no task in the dispatch block: %s\n"
                         % (f.get("rule"), f.get("where")))
        sys.exit(2)
    if FIXES[f["rule"]](task):
        changed += 1

# Splice the re-serialised block back in place: everything outside the comment, prose included, is
# carried through untouched.
after = before[:m.start(2)] + json.dumps(block, indent=2, ensure_ascii=False) + "\n" + before[m.end(2):]
if after != before:
    with open(plan_path, "w", encoding="utf-8") as fh:
        fh.write(after)

print("\namended %d finding(s) in %s" % (changed, plan_path))
sys.stdout.writelines(difflib.unified_diff(
    before.splitlines(keepends=True), after.splitlines(keepends=True),
    fromfile="%s (before)" % plan_path, tofile="%s (after)" % plan_path))
sys.exit(0)
PY
