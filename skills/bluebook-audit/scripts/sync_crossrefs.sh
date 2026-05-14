#!/usr/bin/env bash
# Sync a law-review DOCX's cross-references after manual footnote edits.
#
# Runs the deterministic 3-script chain:
#   1. create_crossrefs.py    — convert any new hardcoded "supra note N" text to NOTEREF fields
#   2. audit_crossref_targets.py --grep --apply
#                             — retarget supras whose hand-typed numbers went stale
#   3. bib_integrate.py --apply
#                             — re-tag bookmarks with bibkeys, pre-compute cached display values
#
# All three are idempotent and fully deterministic (no LLM calls).
# Total runtime: ~5 seconds on a 248-footnote paper.
#
# Usage:
#   sync_crossrefs.sh <draft.docx> [<sources.bib>]
#
# Defaults to <docx-dir>/references/sources.bib if --bib not given.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <draft.docx> [<sources.bib>]" >&2
  exit 1
fi

DOCX="$1"
BIB="${2:-$(dirname "$DOCX")/references/sources.bib}"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$DOCX" ]]; then
  echo "ERROR: docx not found: $DOCX" >&2; exit 1
fi
if [[ ! -f "$BIB" ]]; then
  echo "WARNING: bib not found at $BIB — skipping bib_integrate step." >&2
  echo "  Bootstrap one with: make_bib_from_docx.py --docx $DOCX --out $BIB" >&2
fi

echo "── 1/3 create_crossrefs.py (convert hardcoded supras to NOTEREF) ──"
uv run --with lxml python3 "$SCRIPTS/create_crossrefs.py" --docx "$DOCX"

echo
echo "── 2/3 audit_crossref_targets.py --grep --apply (correct drift) ──"
uv run --with lxml python3 "$SCRIPTS/audit_crossref_targets.py" --docx "$DOCX" --grep --apply

if [[ -f "$BIB" ]]; then
  echo
  echo "── 3/3 bib_integrate.py --apply (bibkey-tag + pre-compute display) ──"
  uv run --with lxml python3 "$SCRIPTS/bib_integrate.py" --docx "$DOCX" --bib "$BIB" --apply
fi

echo
echo "Done. Open the docx — supra/infra numbers should be correct on first read."
