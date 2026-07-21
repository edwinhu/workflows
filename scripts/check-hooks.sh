#!/usr/bin/env bash
# Validate every wired hook's output against the per-event schema from
# https://code.claude.com/docs/en/hooks.md
#
#   ./scripts/check-hooks.sh            # pytest: one case per wiring, fails loudly
#   ./scripts/check-hooks.sh --report   # human table: script | event | matcher | verdict
#
# An invalid hook payload is rejected wholesale by the harness ("Hook JSON output
# validation failed — (root): Invalid input") without raising, warning, or exiting
# non-zero. Nothing else in this repo notices. This does.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "--report" ]; then
    exec uv run --with pyyaml python3 tests/hook_output_schema_test.py
fi

exec uv run --with pytest --with pyyaml python3 -m pytest \
    tests/hook_output_schema_test.py "${@}"
