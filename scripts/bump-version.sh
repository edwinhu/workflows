#!/usr/bin/env bash
# Bump the plugin version everywhere it is spelled, then tell you how to ship it.
#
# WHY THIS EXISTS
#   The version appears in SIX places across FOUR files. `.claude/CLAUDE.md` documented
#   three of them. The two undocumented JSON fields are enforced by
#   tests/public-extension-contract.test.ts, so a hand-bump that follows the old
#   documentation turns the suite red — which is how the gap was found, one bump at a time.
#   A procedure with six manual edit sites schedules its own next drift; this script is the
#   spec, and the doc reduces to "run it".
#
#   The seventh step is the one with actual blast radius and the one no file records:
#   `claude plugin update` resolves releases from ANNOTATED GIT TAGS, not from
#   marketplace.json. Push main without `workflows--vX.Y.Z` and the new version ships to
#   nobody — every installed plugin silently stays on the previous release. The script
#   therefore prints the tag command rather than running it, so tagging stays a deliberate
#   act: landing on main and shipping to users are separate decisions.
#
# USAGE
#   scripts/bump-version.sh 5.106.0     # rewrite all six sites
#   scripts/bump-version.sh --check     # verify the six agree (no writes); exit 1 if not
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PLUGIN=.claude-plugin/plugin.json
MARKET=.claude-plugin/marketplace.json
CAPS=.claude-plugin/capabilities.json
CONTRACT=tests/public-extension-contract.test.ts

current() { python3 -c "import json;print(json.load(open('$PLUGIN'))['version'])"; }

# Every site, as (label, actual-value) pairs. Sourced from the files themselves so this
# cannot drift from what the contract test reads.
observed() {
  python3 - "$PLUGIN" "$MARKET" "$CAPS" "$CONTRACT" <<'PY'
import json, re, sys
plugin, market, caps, contract = (open(p, encoding="utf-8").read() for p in sys.argv[1:5])
p, m, c = json.loads(plugin), json.loads(market), json.loads(caps)
name = p["name"]
entry = next((e for e in m["plugins"] if e.get("name") == name), {})
target = re.search(r'^const TARGET_VERSION = "([^"]+)";', contract, re.M)
title = re.search(r'version fields and capability identity agree at ([0-9]+\.[0-9]+\.[0-9]+)', contract)
for label, value in (
    ("plugin.json version", p.get("version")),
    ("marketplace.json metadata.version", m.get("metadata", {}).get("version")),
    (f"marketplace.json plugins[{name}].version", entry.get("version")),
    ("capabilities.json plugin.version", c.get("plugin", {}).get("version")),
    ("public-extension-contract TARGET_VERSION", target.group(1) if target else None),
    ("public-extension-contract test title", title.group(1) if title else None),
):
    print(f"{value}\t{label}")
PY
}

check() {
  local rows distinct
  rows="$(observed)"
  distinct="$(cut -f1 <<<"$rows" | sort -u | wc -l)"
  printf '%s\n' "$rows" | awk -F'\t' '{printf "  %-46s %s\n", $2, $1}'
  if [ "$distinct" -ne 1 ]; then
    echo "MISMATCH: the six version sites do not agree." >&2
    return 1
  fi
  if grep -q 'None' <<<"$rows"; then
    echo "MISSING: a version site could not be located — the file shape changed." >&2
    return 1
  fi
  echo "OK: all six agree at $(cut -f1 <<<"$rows" | head -1)"
}

if [ "${1:-}" = "--check" ]; then check; exit $?; fi

NEW="${1:-}"
if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/bump-version.sh <x.y.z> | --check" >&2
  exit 2
fi
OLD="$(current)"
[ "$OLD" = "$NEW" ] && { echo "already at $NEW" >&2; exit 2; }

python3 - "$PLUGIN" "$MARKET" "$CAPS" "$CONTRACT" "$OLD" "$NEW" <<'PY'
import json, re, sys
plugin_p, market_p, caps_p, contract_p, old, new = sys.argv[1:7]

def load(path):
    return json.loads(open(path, encoding="utf-8").read())

def dump(path, data):
    open(path, "w", encoding="utf-8").write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

p = load(plugin_p); p["version"] = new; dump(plugin_p, p)
m = load(market_p); m.setdefault("metadata", {})["version"] = new
for entry in m.get("plugins", []):
    if entry.get("name") == p["name"]:
        entry["version"] = new
dump(market_p, m)
c = load(caps_p); c.setdefault("plugin", {})["version"] = new; dump(caps_p, c)

# The test file holds the version twice: the enforcing constant and the human-readable
# title. Both are rewritten; a stale title is not a test failure, which is exactly why it
# rots unless something mechanical keeps it honest.
text = open(contract_p, encoding="utf-8").read()
text, n1 = re.subn(r'^const TARGET_VERSION = "[^"]+";', f'const TARGET_VERSION = "{new}";', text, count=1, flags=re.M)
text, n2 = re.subn(r'(version fields and capability identity agree at )[0-9]+\.[0-9]+\.[0-9]+', rf'\g<1>{new}', text, count=1)
if not (n1 and n2):
    sys.exit(f"failed to rewrite {contract_p}: TARGET_VERSION={n1} title={n2} — file shape changed")
open(contract_p, "w", encoding="utf-8").write(text)
PY

echo "bumped $OLD -> $NEW"
check
cat <<EOF

Next, in order:
  bun test $CONTRACT          # the six sites are enforced here
  git commit -am "chore: release v$NEW"
  git push origin main
  git tag -a workflows--v$NEW -m "workflows v$NEW" && git push origin workflows--v$NEW

The tag is what ships. \`claude plugin update\` resolves from annotated tags, NOT from
marketplace.json — main without the tag reaches no installed plugin.
EOF
