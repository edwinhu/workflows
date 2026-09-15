#!/usr/bin/env bash
# The ONE mechanical entry point for the writing workflow. Its exit code IS the verdict.
#
# The cite-claim leg was a VARIABLE-LENGTH list before 2026-09-15 -- one mechanicalChecks
# entry per section, written out by the plan. That is the failure P10 names in its purest
# form: a plan that forgets a row drops a section's citation gate and nothing reports a
# check it never knew about. The sections are DISCOVERED here instead, from the drafts
# directory, so the set cannot disagree with what exists on disk.
#
# Usage: check.sh --project <dir> --bib <file> --plan <planPath> --plan-hash <hash> --style <domain>
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal (bad usage, no sections).
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

FAILED=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -eq 0 ] || FAILED=1; }

uv run python3 "$HERE/writing_section_index.py" "$PROJ" >&2
report grammar $?

# DISCOVERED, not listed. A drafts directory with no section means the gate would examine
# nothing, which is a refusal rather than a pass.
mapfile -t SECTIONS < <(find "$PROJ/drafts" -maxdepth 1 -name '*.md' -print 2>/dev/null | sort)
if [ "${#SECTIONS[@]}" -eq 0 ]; then
  echo "check.sh: no *.md under $PROJ/drafts — the citation gate would examine nothing" >&2
  report cite-claim 2 "no sections found"
else
  rc=0
  for d in "${SECTIONS[@]}"; do
    uv run python3 "$HERE/writing_gate_probe.py" "$d" --bib "$BIB" --plan "$PLAN" --plan-hash "$HASH" >&2 || rc=1
  done
  report cite-claim "$rc" "${#SECTIONS[@]} section(s)"
fi

uv run python3 "$HERE/writing_prose_gate.py" --project "$PROJ" --style "$STYLE" >&2
report prose $?

exit "$FAILED"
