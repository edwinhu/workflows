#!/usr/bin/env bash
# The ONE mechanical entry point for the writing workflow. Its exit code IS the verdict.
#
# The cite-claim leg was a VARIABLE-LENGTH list before 2026-09-15 -- one mechanicalChecks
# entry per section, written out by the plan. That is the failure P10 names in its purest
# form: a plan that forgets a row drops a section's citation gate and nothing reports a
# check it never knew about. The sections are DISCOVERED here instead, from the drafts
# directory, so the set cannot disagree with what exists on disk.
#
# Every leg prints `<leg>: N <unit> examined` (work/scripts/leg-counts.sh).
#
# Usage: check.sh --project <dir> --bib <file> --plan <planPath> --plan-hash <hash> --style <domain>
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal (bad usage, no sections), or a leg that
# examined nothing.
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../work/scripts/leg-counts.sh"
PROJ=""; BIB=""; PLAN=""; HASH=""; STYLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJ="${2:-}"; shift 2 ;;
    --bib) BIB="${2:-}"; shift 2 ;;
    --plan) PLAN="${2:-}"; shift 2 ;;
    --plan-hash) HASH="${2:-}"; shift 2 ;;
    --style) STYLE="${2:-}"; shift 2 ;;
    *) echo "check.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
for v in PROJ BIB PLAN HASH STYLE; do
  [ -n "${!v}" ] || { echo "check.sh: --${v,,} is required" >&2; exit 2; }
done

RC=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -le "$RC" ] || RC="$2"; }

# The section index's JSON on stderr, then the sections it indexed.
grammar_leg() {
  local out s
  out="$(uv run python3 "$HERE/writing_section_index.py" "$PROJ")"
  s=$?
  printf '%s\n' "$out" >&2
  printf '%s' "$out" | python3 -c 'import json, sys
d = json.load(sys.stdin)
print("grammar: %d section(s) examined, ok=%s" % (len(d.get("sections") or []), d.get("ok")))' >&2
  return "$s"
}
legcount_run grammar grammar_leg
report grammar "$LEG_STATUS"

# DISCOVERED, not listed. A drafts directory with no section means the gate would examine
# nothing, which is a refusal rather than a pass.
mapfile -t SECTIONS < <(find "$PROJ/drafts" -maxdepth 1 -name '*.md' -print 2>/dev/null | sort)
if [ "${#SECTIONS[@]}" -eq 0 ]; then
  echo "check.sh: no *.md under $PROJ/drafts — the citation gate would examine nothing" >&2
  report cite-claim 2 "no sections found"
else
  # A section counts as examined when its probe printed a verdict; the cites are its detail.
  cite_claim_leg() {
    local rc=0 d out n=0 cites=0
    for d in "${SECTIONS[@]}"; do
      out="$(uv run python3 "$HERE/writing_gate_probe.py" "$d" --bib "$BIB" --plan "$PLAN" --plan-hash "$HASH")" || rc=1
      printf '%s\n' "$out" >&2
      if c="$(printf '%s' "$out" | python3 -c 'import json, sys
d = json.load(sys.stdin)
assert isinstance(d.get("pass"), bool)
print(int(d.get("citesChecked") or 0))' 2>/dev/null)"; then
        n=$((n + 1)); cites=$((cites + c))
      fi
    done
    count_line cite-claim "$n" "section(s)" "of ${#SECTIONS[@]}, $cites cite(s) checked" >&2
    return "$rc"
  }
  legcount_run cite-claim cite_claim_leg
  report cite-claim "$LEG_STATUS" "${#SECTIONS[@]} section(s)"
fi

# The style rules a regex settles (Ship diction, ALL-CAPS emphasis, register crossing). The
# judged register rules are rule-check.ts's, over constraints/jev/writing.
style_leg() { uv run python3 "$HERE/writing_style_check.py" --project "$PROJ" --style "$STYLE" >&2; }
legcount_run style style_leg
report style "$LEG_STATUS"

prose_leg() { uv run python3 "$HERE/writing_prose_gate.py" --project "$PROJ" --style "$STYLE" >&2; }
legcount_run prose prose_leg
report prose "$LEG_STATUS"

exit "$RC"
