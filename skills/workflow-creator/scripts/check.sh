#!/usr/bin/env bash
# check.sh — the ONE mechanical entry point for a workflow skill. Its exit code IS the mechanical
# verdict: 0 only when every leg passed. A workflow declares this command and nothing else, because
# a list of N independent commands loses one silently and nothing reports a check it never knew
# about.
#
# Usage: check.sh --target <skill dir> [--agent <agent .md outside the skill dir>]
#
# Legs (all six run; none short-circuits, so one line is printed per leg every time):
#   wc-probe     the probe over --target (and --agent, which lives outside it)
#   sc-probe     SKILL shape over --target — the TOC bang, the four ways a bang aborts a load,
#                paths the prose cannot resolve
#   pc-probe     CHECKER shape over the PLUGIN ROOT resolved upward from --target. Plugin-scoped
#                on purpose: "is this rule correctly COMMON" is a count of consumers, and no
#                skill-scoped view can answer it. Going red for a sibling skill is CORRECT —
#                structure is a plugin property, so a workflow's gate owns its plugin's structure.
#   parity       gate-vs-write-hook agreement — takes no target
#   node-check   `node --check` over <target>/*.js; PASSES when the target ships none
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
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal (bad usage, missing target, or a leg
# that COULD NOT LOOK — an unresolvable plugin root, an unreachable probe. A leg that cannot look is
# not a leg that passed, so it never reports 0.)
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
TARGET="$(cd "$TARGET" && pwd)"

FAILED=0
# Every leg reports through here, so a leg that runs but whose status reaches no verdict is not
# expressible. A leg exiting 2 (could-not-look) raises the whole verdict to 2, never to 1: the
# caller must be able to tell "a rule was broken" from "a rule was never applied".
report() { # report <leg name> <exit code> [note]
  printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"
  case "$2" in
    0) ;;
    2) FAILED=2 ;;
    *) [ "$FAILED" -eq 2 ] || FAILED=1 ;;
  esac
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
  bun "$SC_PROBE" --target "$TARGET" >&2
  report sc-probe $?
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
bash "$SCRIPT_DIR/parity-check.sh" >&2
report parity $?

# --- leg: node-check ---------------------------------------------------------------------------
# A workflow that ships no .js is the normal case and passes; only a real syntax error fails.
node_rc=0
js_n=0
for f in "$TARGET"/*.js; do
  [ -e "$f" ] || continue
  js_n=$((js_n + 1))
  node --check "$f" >&2 || node_rc=1
done
if [ "$js_n" -eq 0 ]; then
  report node-check 0 "no .js under target"
else
  report node-check "$node_rc" "$js_n .js checked"
fi

# --- leg: probe-tests --------------------------------------------------------------------------
# Target-relative on purpose: this skill's own suite is not evidence about a generated skill.
if [ ! -d "$TARGET/scripts" ]; then
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
    # SHARDED. bun runs the files handed to one process one after another, so a suite whose cases
    # spawn subprocesses adds up: `work` is 23 files and 136s, of which five dispatcher files are
    # 121s. The files are independent, so they go to SHARDS run concurrently. Measured 2026-09-18
    # on `work`: 136s sequential, 80s across four shards — the floor is its longest single file.
    # Scheduling only. A shard's non-zero exit is rc=1 exactly as one process's was, because
    # changing a verdict while changing a schedule is how a speedup quietly becomes a weakening.
    SHARDS="${CHECK_SHARDS:-4}"
    pids=()
    if [ "${#suite[@]}" -gt 0 ]; then
      n=${#suite[@]}
      [ "$SHARDS" -gt "$n" ] && SHARDS=$n
      i=0
      while [ "$i" -lt "$SHARDS" ]; do
        shard=(); j=$i
        while [ "$j" -lt "$n" ]; do shard+=("${suite[$j]}"); j=$(( j + SHARDS )); done
        bun test "${shard[@]}" >&2 &
        pids+=($!)
        i=$(( i + 1 ))
      done
    fi
    if [ "${#pysuite[@]}" -gt 0 ]; then
      # --script lets uv read each file's own PEP 723 dependency block: a generic gate
      # cannot know a suite needs pypdf, and guessing wrong fails cases for a missing
      # import, which reads as broken contracts rather than a misconfigured runner.
      for pf in "${pysuite[@]}"; do
        uv run --quiet --with pytest --script "$pf" -m pytest -q "$pf" >&2 &
        pids+=($!)
      done
    fi
    # Every child is waited on individually: `wait` with no argument discards the statuses, which
    # would turn a failing suite into a passing leg.
    for pid in "${pids[@]}"; do wait "$pid" || rc=1; done
    report probe-tests "$rc" "$(( ${#suite[@]} + ${#pysuite[@]} )) file(s)"
  fi
fi

exit "$FAILED"
