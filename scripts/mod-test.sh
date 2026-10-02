#!/usr/bin/env bash
# Run the plugin mods' kit tests (hooks/mod-tests/*.test.ts) under `claude plugin test`.
#
# The kit runs EVERY *.test.ts under the folder it is given, and this repo's ~100 bun tests import
# bun:test, which a hooks module cannot. So stage only the mods (manifest, hooks.json, register.ts,
# bulk-guard.mjs, watch/, guards/, mod-tests/) into a temp plugin folder and test that.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
command -v claude >/dev/null || { echo "mod-test: claude not on PATH" >&2; exit 2; }
T=$(mktemp -d -t mod-test.XXXXXX)
trap 'rm -rf -- "$T"' EXIT
mkdir -p "$T/.claude-plugin" "$T/hooks"
jq '{name, version, description}' "$ROOT/.claude-plugin/plugin.json" > "$T/.claude-plugin/plugin.json"
jq '{modules}' "$ROOT/hooks/hooks.json" > "$T/hooks/hooks.json"
cp "$ROOT/hooks/register.ts" "$ROOT/hooks/bulk-guard.mjs" "$T/hooks/"
cp -r "$ROOT/hooks/watch" "$ROOT/hooks/guards" "$ROOT/hooks/mod-tests" "$T/hooks/"
claude plugin test "$T"
