#!/usr/bin/env bash
# The ONE mechanical entry point for an expert production. Its exit code IS the verdict.
#
# Driven by the production SPEC (references/production-spec.md), verified against the sha256 the
# approved plan recorded, then copied into this run's temp dir so every leg reads the bytes that
# were verified. Four legs, in order, none short-circuiting (package_check.py holds each):
#   archive  rebuild the .7z from the stage, extract it fresh, compare every file to MANIFEST.csv;
#            no table shipped in two formats (one path stem, two of .csv .parquet .feather .dta .tsv)
#   code     over the extraction: import closure, every .py reached by an entry script or a runbook
#            command, ast parse, ruff E9/F vs source, no comments or docstrings, __doc__ readers
#            keep an assignment, bash -n on every .sh
#   leak     paths, usernames and leak_terms in text, PDF and workbook; PDF/OOXML/PNG metadata;
#            no workbook error cell, and at least one formula unless workbook_formulas is false
#   rerun    each rerun in its own copy of the extraction, offline; runbook commands intact in the PDF
# A leg whose input is missing reports 2, never skips. Every leg prints `<leg>: N <unit> examined`.
#
# Usage: package-check.sh --spec <spec.json> (--spec-sha256 <hex> | --no-spec-sha256)
# Exit 0 = every leg passed. 1 = some leg failed. 2 = refusal, or a leg that could not check.
set -uo pipefail   # deliberately not -e: every leg must run so every leg reports.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../work/scripts/leg-counts.sh"

SPEC=""; SHA=""; NOSHA=0
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC="${2:-}"; shift 2 ;;
    --spec-sha256) SHA="${2:-}"; shift 2 ;;
    --no-spec-sha256) NOSHA=1; shift ;;
    *) echo "package-check.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$SPEC" ] || { echo "package-check.sh: --spec <production spec JSON> is required" >&2; exit 2; }
[ -f "$SPEC" ] || { echo "package-check.sh: --spec $SPEC is not a file" >&2; exit 2; }
[ -n "$SHA" ] || [ "$NOSHA" = 1 ] || { echo "package-check.sh: pass --spec-sha256 <the hash the plan recorded> or --no-spec-sha256" >&2; exit 2; }
if [ -n "$SHA" ] && [ "$NOSHA" = 1 ]; then
  echo "package-check.sh: --spec-sha256 and --no-spec-sha256 contradict each other" >&2; exit 2
fi

PC=(python3 -I -B "$HERE/package_check.py")
RUN="$(mktemp -d "${TMPDIR:-/tmp}/package-check.XXXXXX")" || { echo "package-check.sh: cannot create a temp dir" >&2; exit 2; }
cleanup() { chmod -R u+w "$RUN" 2>/dev/null; rm -rf "$RUN"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp "$SPEC" "$RUN/spec.json" || { echo "package-check.sh: cannot copy $SPEC" >&2; exit 2; }
if [ -n "$SHA" ]; then
  got="$("${PC[@]}" sha256 "$RUN/spec.json")" || { echo "package-check.sh: cannot hash $SPEC" >&2; exit 2; }
  want="$(printf '%s' "$SHA" | tr '[:upper:]' '[:lower:]')"
  [ "$got" = "$want" ] || { echo "package-check.sh: $SPEC hashes to $got, not the recorded $want — the spec changed after approval" >&2; exit 2; }
fi
X="$(mktemp -d "$RUN/extract.XXXXXX")" || { echo "package-check.sh: cannot create the extraction dir" >&2; exit 2; }
A=(--spec "$RUN/spec.json" --extract "$X" --tmp "$RUN")

RC=0
report() { printf 'leg %s exit=%s%s\n' "$1" "$2" "${3:+ ($3)}"; [ "$2" -le "$RC" ] || RC="$2"; }

legcount_run archive "${PC[@]}" archive "${A[@]}"
report archive "$LEG_STATUS"
legcount_run code "${PC[@]}" code "${A[@]}"
report code "$LEG_STATUS"
legcount_run leak "${PC[@]}" leak "${A[@]}"
report leak "$LEG_STATUS"
legcount_run rerun "${PC[@]}" rerun "${A[@]}"
report rerun "$LEG_STATUS"

exit "$RC"
