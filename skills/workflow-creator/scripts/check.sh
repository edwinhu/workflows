#!/usr/bin/env bash
# check.sh — the ONE mechanical entry point for a workflow skill. Its exit code IS the mechanical
# verdict: 0 only when every leg passed. A workflow declares this command and nothing else, because
# a list of N independent commands loses one silently and nothing reports a check it never knew
# about.
#
# Usage: check.sh --target <skill dir> [--agent <agent .md outside the skill dir>]
#
# Legs (all seven run; none short-circuits, so one line is printed per leg every time):
#   wc-probe     the probe over --target (and --agent, which lives outside it)
#   sc-probe     SKILL shape over --target — the TOC bang, the four ways a bang aborts a load,
#                paths the prose cannot resolve
#   pc-probe     CHECKER shape over the PLUGIN ROOT resolved upward from --target. Plugin-scoped
#                on purpose: "is this rule correctly COMMON" is a count of consumers, and no
#                skill-scoped view can answer it. Going red for a sibling skill is CORRECT —
#                structure is a plugin property, so a workflow's gate owns its plugin's structure.
#   parity       gate-vs-write-hook agreement — takes no target
#   authoring-lint  the authoring rules a string settles, over the lines the change ADDED under
#                --target (a SKILL_DIR climb, a retired enforcement table, plugin.json
#                dependencies, a non-canonical state file)
#   authoring-gate  `bin/workflow-check authoring --constraints-only` over the target: every constraint
#                under checks/authoring/constraints/ (node-check among them: `node --check` over its
#                .js; nothing in scope when it ships none), so a constraint added there runs with no
#                edit here. Its Jev rules are skipped: the plan's ruleChecks scores them.
#   probe-tests  `bun test <target>/scripts/*.test.ts` — TARGET-relative, so pointing this at a
#                generated skill runs THAT skill's suite; a scripts/ dir with no test file FAILS
#
# wc-probe has only ever judged GATE INTEGRITY, never STRUCTURE. That is how typst accumulated 16
# runners, a check.sh running one leg of six, and 62 checkers across four locations while passing
# every gate. The two probes existed and were maintained throughout; nothing ran them here.
#
# stdout carries only the leg lines (the verdict); each leg's own output goes to stderr, so
# counting `^leg ` on stdout counts legs and nothing else.
#
# NON-VACUITY: work-checks.sh audits this output (skills/work/scripts/leg_counts.py), so every leg
# prints `<leg>: N <unit> examined` to stderr, N taken from what the leg read, or
# `<leg>: 0 <unit> examined — nothing in scope (<why>)`. wc-probe and pc-probe print their own.
#
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal (bad usage, missing target, or a leg
# that COULD NOT LOOK — an unresolvable plugin root, an unreachable probe, a suite file that ran no
# test. A leg that cannot look is not a leg that passed, so it never reports 0.) A leg with nothing
# in scope BY CONSTRUCTION (no .js for authoring-gate, an unchanged tree for authoring-lint, no
# scripts/) did look and found nothing to judge: it prints `0 … examined — nothing in scope` and
# NOT CHECKED, and exits 0 — visible, not gating.
set -uo pipefail  # deliberately not -e: every leg must run so every leg reports.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "usage: check.sh --target <skill dir> [--agent <agent .md>]" >&2
}

TARGET=""
AGENT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      [ $# -ge 2 ] || { echo "check.sh: --target requires a value" >&2; usage; exit 2; }
      TARGET="$2"; shift 2 ;;
    --agent)
      [ $# -ge 2 ] || { echo "check.sh: --agent requires a value" >&2; usage; exit 2; }
      AGENT="$2"; shift 2 ;;
    *)
      echo "check.sh: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[ -n "$TARGET" ] || { echo "check.sh: --target is required" >&2; usage; exit 2; }
[ -d "$TARGET" ] || { echo "check.sh: --target is not a directory: $TARGET" >&2; exit 2; }
if [ -n "$AGENT" ] && [ ! -f "$AGENT" ]; then
  echo "check.sh: --agent is not a file: $AGENT" >&2
  exit 2
fi
TARGET="$(cd "$TARGET" && pwd -P)"

FAILED=0
# Every leg reports through here, so a leg that runs but whose status reaches no verdict is not
# expressible. A leg exiting 2 or 3 (could-not-look, or a probe that crashed) raises the whole verdict
# to 2, never to 1: the caller must be able to tell "a rule was broken" from "a rule was never applied".
report() { # report <leg name> <exit code> [note]
  printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"
  case "$2" in
    0) ;;
    2|3) FAILED=2 ;;
    *) [ "$FAILED" -eq 2 ] || FAILED=1 ;;
  esac
}

count_line() { # count_line <leg> <n> <unit> <why n may be 0>
  if [ "$2" -gt 0 ]; then
    echo "$1: $2 $3 examined" >&2
  else
    echo "$1: 0 $3 examined — nothing in scope ($4)" >&2
  fi
}

# The plugin root is whatever `.claude-plugin/plugin.json` a walk UPWARD from the start directory
# first finds — the marker all four plugins in this corpus carry, and the one the harness itself
# keys on. Walked, never counted: a fixed number of `..` hops is right for exactly the nesting
# depth it was written against and silently wrong for a skill one level deeper.
plugin_root() { # plugin_root <start dir> -> prints root, or exits 1 having printed nothing
  local d
  d="$(cd "$1" 2>/dev/null && pwd)" || return 1
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ -f "$d/.claude-plugin/plugin.json" ] && { printf '%s\n' "$d"; return 0; }
    d="$(dirname "$d")"
  done
  [ -f "/.claude-plugin/plugin.json" ] && { printf '/\n'; return 0; }
  return 1
}

# Where check.sh's own plugin keeps the two sibling probes. Resolved from THIS script's location,
# not from the target: the target may live in another plugin entirely (teaching's three workflows
# are gated by this copy), and that plugin does not ship these probes.
OWN_ROOT="$(plugin_root "$SCRIPT_DIR" || true)"
SC_PROBE=""
PC_PROBE=""
if [ -n "$OWN_ROOT" ]; then
  SC_PROBE="$OWN_ROOT/skills/skill-creator/scripts/sc-probe.ts"
  PC_PROBE="$OWN_ROOT/skills/plugin-creator/scripts/pc-probe.ts"
fi

# --- leg: wc-probe -----------------------------------------------------------------------------
if [ -n "$AGENT" ]; then
  bun "$SCRIPT_DIR/wc-probe.ts" --target "$TARGET" --agent "$AGENT" >&2
else
  bun "$SCRIPT_DIR/wc-probe.ts" --target "$TARGET" >&2
fi
report wc-probe $?

# --- leg: sc-probe -----------------------------------------------------------------------------
# SKILL shape over the target skill dir. sc-probe's usage already accepts either a skill dir or a
# plugin root, so the skill dir is passed straight through.
if [ -z "$SC_PROBE" ]; then
  echo "check.sh: cannot run sc-probe — no plugin root (a dir holding .claude-plugin/plugin.json) above $SCRIPT_DIR" >&2
  report sc-probe 2 "no plugin root above check.sh"
elif [ ! -r "$SC_PROBE" ]; then
  echo "check.sh: cannot run sc-probe — not readable: $SC_PROBE" >&2
  report sc-probe 2 "probe unreachable"
else
  sc_out="$(bun "$SC_PROBE" --target "$TARGET" 2>&1)"
  sc_rc=$?
  printf '%s\n' "$sc_out" >&2
  # The probe's own END line carries `N skill(s)`; that is the count, not a number re-derived here.
  sc_n="$(printf '%s\n' "$sc_out" | sed -nE 's/.*[^0-9]([0-9]+) skill\(s\).*/\1/p' | tail -1)"
  [ -n "$sc_n" ] && count_line sc-probe "$sc_n" "skill(s)" "no SKILL.md under target"
  report sc-probe "$sc_rc"
fi

# --- leg: pc-probe -----------------------------------------------------------------------------
# CHECKER shape over the target's PLUGIN ROOT. A workflow's gate going red for a sibling skill in
# the same plugin is the intended reading, not collateral.
TARGET_ROOT="$(plugin_root "$TARGET" || true)"
if [ -z "$PC_PROBE" ]; then
  echo "check.sh: cannot run pc-probe — no plugin root (a dir holding .claude-plugin/plugin.json) above $SCRIPT_DIR" >&2
  report pc-probe 2 "no plugin root above check.sh"
elif [ ! -r "$PC_PROBE" ]; then
  echo "check.sh: cannot run pc-probe — not readable: $PC_PROBE" >&2
  report pc-probe 2 "probe unreachable"
elif [ -z "$TARGET_ROOT" ]; then
  # Never 0 and never skipped: a target whose plugin root does not resolve is a structure check
  # that did not happen, and the one number that must not wear a verdict's clothes.
  echo "check.sh: cannot run pc-probe — no plugin root (a dir holding .claude-plugin/plugin.json) at or above --target $TARGET" >&2
  report pc-probe 2 "no plugin root above target"
else
  bun "$PC_PROBE" --target "$TARGET_ROOT" >&2
  report pc-probe $? "root $TARGET_ROOT"
fi

# --- leg: parity -------------------------------------------------------------------------------
parity_out="$(bash "$SCRIPT_DIR/parity-check.sh" 2>&1)"
parity_rc=$?
printf '%s\n' "$parity_out" >&2
# One `<agent>.md: gate=… write=…` line per fixture agent compared.
count_line parity "$(printf '%s\n' "$parity_out" | grep -cE '^[^ ]+\.md: gate=')" "fixture agent(s)" "parity-check printed no comparison"
report parity "$parity_rc"

# --- leg: authoring-lint -----------------------------------------------------------------------
bun "$SCRIPT_DIR/authoring-lint.ts" --target "$TARGET" >&2
lint_rc=$?
# Added lines the lint read: addedLines() from the lint itself, under its own text/test-path filters
# (mirrored from authoring-lint.ts TEXT_EXT / TEST_PATH — keep in step).
lint_n="$(LINT_TARGET="$TARGET" LINT_LIB="$SCRIPT_DIR/authoring-lint.ts" bun -e '
import { existsSync, readFileSync } from "node:fs"
import { relative } from "node:path"
const { addedLines } = await import(process.env.LINT_LIB!)
const T = /\.(md|json|ts|js|mjs|py|sh|ya?ml|toml|txt)$/i
const X = /(^|\/)(tests?|__tests__|fixtures)\/|[._-](test|spec)\.[A-Za-z]+$|\.fixture$/
const t = process.env.LINT_TARGET!
let n = 0
for (const [f, l] of addedLines(t) as Map<string, Set<number> | null>) {
  if (!T.test(f) || X.test(relative(t, f)) || !existsSync(f)) continue
  n += l ? l.size : readFileSync(f, "utf8").split("\n").length
}
console.log(n)
' 2>/dev/null)"
case "$lint_n" in
  ''|*[!0-9]*) ;;  # the count could not be taken: print nothing, and the audit says so
  *)
    count_line authoring-lint "$lint_n" "added line(s)" "no line added over HEAD under target"
    # Non-gating, like every other empty scope here, but loud: the lint reads only the diff, so an unchanged tree is unchecked, not clean.
    [ "$lint_n" -gt 0 ] || echo "authoring-lint: NOT CHECKED — the target is unchanged over HEAD and the lint reads added lines only; copy the target or pass a changed tree to apply the authoring rules" >&2 ;;
esac
report authoring-lint "$lint_rc"

# --- leg: authoring-gate -----------------------------------------------------------------------
# The runner is this plugin's, found the way the two probes are. Its first line is the leg's count.
if [ -z "$OWN_ROOT" ] || [ ! -r "$OWN_ROOT/bin/workflow-check" ]; then
  echo "check.sh: cannot run authoring-gate — no bin/workflow-check under ${OWN_ROOT:-a plugin root above $SCRIPT_DIR}" >&2
  report authoring-gate 2 "runner unreachable"
else
  gate_out=$(python3 "$OWN_ROOT/bin/workflow-check" authoring --constraints-only --project-dir "${TARGET_ROOT:-$TARGET}" --files "$TARGET" 2>&1)
  gate_rc=$?
  printf '%s\n' "$gate_out" >&2
  # Non-gating like the lint leg, but loud: a gate that examined nothing is unchecked, not clean.
  case "$gate_out" in
    *"authoring-gate: 0 check(s) examined"*) echo "authoring-gate: NOT CHECKED — no authoring constraint examined anything under the target; pass a tree the constraints apply to" >&2 ;;
  esac
  report authoring-gate "$gate_rc"
fi

# --- leg: probe-tests --------------------------------------------------------------------------
# Target-relative on purpose: this skill's own suite is not evidence about a generated skill.
if [ ! -d "$TARGET/scripts" ]; then
  count_line probe-tests 0 "test(s)" "target ships no scripts/"
  report probe-tests 0 "target ships no scripts/"
else
  # BOTH suite shapes. A workflow whose scripts are python ships pytest, and reading only
  # *.test.ts reported workshop -- 108 pytest cases beside its scripts -- as untested
  # machinery. The rule is unchanged: a scripts/ dir with no suite at all still FAILS.
  suite=(); pysuite=()
  for f in "$TARGET"/scripts/*.test.ts; do [ -e "$f" ] && suite+=("$f"); done
  for f in "$TARGET"/scripts/*_test.py "$TARGET"/scripts/test_*.py; do
    [ -e "$f" ] && pysuite+=("$f")
  done
  if [ "${#suite[@]}" -eq 0 ] && [ "${#pysuite[@]}" -eq 0 ]; then
    echo "check.sh: $TARGET/scripts exists but ships no *.test.ts and no pytest file — a scripts dir with no suite is untested machinery" >&2
    report probe-tests 1 "no suite under scripts/"
  else
    rc=0
    # CONCURRENT. A suite whose cases spawn subprocesses adds up serially (`work`: 23 files, 136s,
    # five dispatcher files 121s); the files are independent, so SHARDS run at once and the floor is
    # the longest single file. Scheduling only: a non-zero exit is rc=1 as it was serially.
    SHARDS="${CHECK_SHARDS:-4}"
    pids=(); pyp=()
    # Each runner's output lands in a file so its own summary can be counted after the wait.
    tdir="$(mktemp -d)"
    if [ "${#suite[@]}" -gt 0 ]; then
      # One bun process PER FILE, at most SHARDS at once: bun reports only `Ran N tests across M
      # files`, so a file that ran nothing is visible only if no sibling shares its process.
      # A target's tests spawn its own check.sh (7 legs); bun's 5 s default kills one at load and
      # strands that leg's leg-o/leg-e temp files. The budget is a ceiling, not a delay.
      # The exit status lands in <out>.rc: `wait -n` below reaps the job, so `wait $pid` cannot.
      bi=0
      for f in "${suite[@]}"; do
        while [ "$(jobs -rp | wc -l)" -ge "$SHARDS" ]; do wait -n 2>/dev/null; done
        ( bun test --timeout "${CHECK_TEST_TIMEOUT_MS:-30000}" "$f" >"$tdir/bun$bi.out" 2>&1; echo $? >"$tdir/bun$bi.rc" ) &
        bi=$(( bi + 1 ))
      done
      wait
      for f in "$tdir"/bun*.rc; do [ "$(cat "$f")" -eq 0 ] || rc=1; done
    fi
    if [ "${#pysuite[@]}" -gt 0 ]; then
      # --with-requirements reads each file's own PEP 723 dependency block (a generic gate cannot
      # know a suite needs pypdf; a missing import reads as a broken contract). NOT `--script`
      # around pytest: that EXECUTES the file with `-m pytest ...` as argv, so no test is
      # collected and it exits 0. The flag is added only when a block exists (else uv errors).
      # A STANDALONE SCRIPT suite (no `def test_`, but a __main__ guard or module-scope sys.exit —
      # tests/script-suites.txt) is the one shape pytest cannot collect: it runs as `uv run
      # --script` and its exit code is the verdict, counted as one suite.
      scriptpy=()
      for pf in "${pysuite[@]}"; do
        req=(); grep -q '^# /// script' "$pf" && req=(--with-requirements "$pf")
        if ! grep -qE '^[[:space:]]*(async )?def test_|^class Test' "$pf" && grep -qE '^if __name__ == .__main__.|^sys\.exit\(' "$pf"; then
          scriptpy+=("$pf")
          uv run --quiet --script "$pf" >"$tdir/py$(basename "$pf").out" 2>&1 &
          pids+=($!)
        else
          uv run --quiet --with pytest --with pytest-xdist "${req[@]}" python3 -m pytest -q -p no:cacheprovider --basetemp "$tdir/bt$(basename "$pf")" "$pf" >"$tdir/py$(basename "$pf").out" 2>&1 &
          pids+=($!); pyp+=($!)
        fi
      done
    fi
    # Every child is waited on individually: `wait` with no argument discards the statuses, which
    # would turn a failing suite into a passing leg.
    # pytest exit 5 = collected nothing: the per-file tally below turns that into exit 2, not 1.
    for pid in "${pids[@]}"; do
      wait "$pid"; st=$?
      [ "$st" -eq 0 ] && continue
      case " ${pyp[*]:-} " in *" $pid "*) [ "$st" -eq 5 ] && continue ;; esac
      rc=1
    done
    cat "$tdir"/*.out >&2
    # bun: `Ran N tests across M files`; pytest -q: `N passed` / `N failed`. Counted per output
    # file: a python file that collected nothing must not hide behind another file's sum.
    tally() { { grep -hoE '^Ran [0-9]+ tests?|^[0-9]+ (passed|failed)|[0-9]+ (passed|failed)(,| in )' "$@" || true; } | grep -oE '[0-9]+' | awk '{ n += $1 } END { print n + 0 }'; }
    test_n=0; empty=()
    bi=0
    for f in "${suite[@]}"; do
      bn="$(tally "$tdir/bun$bi.out")"
      test_n=$(( test_n + bn ))
      [ "$bn" -gt 0 ] || empty+=("$(basename "$f")")
      bi=$(( bi + 1 ))
    done
    for pf in "${pysuite[@]}"; do
      case " ${scriptpy[*]:-} " in *" $pf "*) pn=1 ;; *) pn="$(tally "$tdir/py$(basename "$pf").out")" ;; esac
      test_n=$(( test_n + pn ))
      [ "$pn" -gt 0 ] || empty+=("$(basename "$pf")")
    done
    rm -rf "$tdir"
    if [ "${#empty[@]}" -gt 0 ] || [ "$test_n" -eq 0 ]; then
      # A suite that was handed over and ran nothing could not look: exit 2, never the runner's 0.
      [ "$rc" -eq 1 ] || rc=2
      echo "probe-tests: $test_n test(s) examined — ${#empty[@]} file(s) collected no test: ${empty[*]:-(none counted)}" >&2
    else
      count_line probe-tests "$test_n" "test(s)" "no test ran"
    fi
    report probe-tests "$rc" "$(( ${#suite[@]} + ${#pysuite[@]} )) file(s)"
  fi
fi

exit "$FAILED"
