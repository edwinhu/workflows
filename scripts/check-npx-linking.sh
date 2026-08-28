#!/usr/bin/env bash
# Gate for the ISS->CRSP ladder refactor: every tier contract, on fixtures.
#
# Fixtures rather than WRDS on purpose -- the ladder needs credentials and a
# 238M-row table, so a suite that reached for them could not run unattended or
# in CI, and a gate that cannot run is not a gate. The live coverage numbers are
# measured separately and recorded in the run report; they are evidence, not the
# gate.
set -uo pipefail
cd "$(dirname "$0")/.."

SUITES=(
  tests/npx_linking_exclusions_test.py     # T1 Step 0
  tests/npx_linking_tier1_test.py          # T2 exact seriesid pass
  tests/npx_linking_cik_tier_test.py       # T3 CIK single-portfolio
  tests/npx_linking_name_vocab_test.py     # T4 match vocabulary
  tests/npx_linking_claim_check_test.py    # T5 one fundid per portno
  tests/npx_linking_coverage_report_test.py  # T6 exact reported apart from fuzzy
)

present=()
missing=()
for s in "${SUITES[@]}"; do
  if [ -f "$s" ]; then present+=("$s"); else missing+=("$s"); fi
done

if [ ${#missing[@]} -gt 0 ]; then
  printf 'MISSING %s\n' "${missing[@]}"
fi
printf 'suites present: %d/%d\n' "${#present[@]}" "${#SUITES[@]}"

if [ ${#present[@]} -gt 0 ]; then
  uv run --with pandas --with pytest python3 -m pytest "${present[@]}" -q || exit 1
fi

# The gate is ALL SIX green. A subset passing is progress, not done -- otherwise
# the goal closes the moment the easiest suite is written.
[ ${#missing[@]} -eq 0 ]
