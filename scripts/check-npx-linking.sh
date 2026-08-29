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
  tests/npx_linking_header_master_test.py  # L2a-headers: pre-2010 vocabulary
  tests/npx_linking_name_vocab_test.py     # build_name_variants: the match vocabulary
  tests/npx_linking_normalize_test.py      # the two opt-in ISS normalisation rules
  tests/npx_linking_claim_check_test.py    # one fundid per crsp_portno per period
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
  # sparse_dot_topn is built against numpy 1.x on conda-forge and PyPI alike,
  # so the pin is not optional: without it the matcher suite cannot import.
  # numpy<2 is not optional: sparse_dot_topn, which matching.py imports, is
  # built against numpy 1.x on conda-forge and PyPI alike.
  uv run --with pandas --with polars --with pyarrow --with pytest \
         --with scikit-learn --with sparse_dot_topn --with "numpy<2" \
         python3 -m pytest "${present[@]}" -q || exit 1
fi

# The gate is ALL SIX green. A subset passing is progress, not done -- otherwise
# the goal closes the moment the easiest suite is written.
[ ${#missing[@]} -eq 0 ]
