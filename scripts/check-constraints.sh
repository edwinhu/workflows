#!/usr/bin/env bash
# Scoped mechanical entry point for the constraints-canonical change.
# The repo-wide suite carries 8 failures unrelated to this change (npx_linking_*, ds_dq_runner,
# hook-golden, test_prose_lint_hook); gating on it would gate on someone else's red.
set -uo pipefail
cd "$(dirname "$0")/.." 2>/dev/null || true
fail=0
bun test tests/constraints-no-duplication.test.ts || fail=1
bun tests/agent-contract.test.mjs               || fail=1
exit $fail
