#!/usr/bin/env bash
# Is a craft run armed but undispatched in this project?
#
# Armed  = the newest plan carries a `<!-- craft:dispatch … -->` block. Writing that block is
#          what arms the run, and the plan is the only file plan mode may write — which is also
#          the only thing that survives the context clear on plan approval.
# Undispatched = no .craft/*/args.json records this plan's CURRENT spec hash, and that hash is
#          not listed in .craft/abandoned. The hash is over the dispatch block's canonical JSON,
#          so editing the prose around it does not read as an un-dispatched amendment.
#
# Prints "<planPath>\t<runId>" and exits 0 when a dispatch is owed; silent exit 1 otherwise.
# Called per Edit/Write by main-thread-guard.sh, so the negative path must stay cheap: the
# directory test below fires before anything reads or hashes a file.
set -uo pipefail

# Resolved before the cd below — a relative $0 would not survive it.
SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

cd "${1:-$PWD}" 2>/dev/null || exit 1

# The plans directory is `plansDirectory`, not a fixed path — the shell twin of
# hooks/lib/plans-dir.ts. Precedence is Claude Code's own (project local > shared project > user),
# the value is project-root-relative, and an unset or unparseable setting falls back to the default.
plans_dir=""
for s in .claude/settings.local.json .claude/settings.json "$HOME/.claude/settings.json"; do
  [ -f "$s" ] || continue
  if command -v jq >/dev/null 2>&1; then
    v=$(jq -r 'if type == "object" and (.plansDirectory | type) == "string" then .plansDirectory else "" end' "$s" 2>/dev/null) || v=""
  else
    v=$(python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
    print(d["plansDirectory"] if isinstance(d, dict) and isinstance(d.get("plansDirectory"), str) else "")
except Exception:
    print("")' "$s" 2>/dev/null) || v=""
  fi
  v=${v#"${v%%[![:space:]]*}"}; v=${v%"${v##*[![:space:]]}"}
  if [ -n "$v" ]; then plans_dir=$v; break; fi
done
case "$plans_dir" in
  "") plans_dir="$PWD/.claude/plans" ;;
  "~") plans_dir="$HOME" ;;
  "~/"*) plans_dir="$HOME/${plans_dir#\~/}" ;;
  /*) ;;
  *) plans_dir="$PWD/$plans_dir" ;;
esac

[ -d "$plans_dir" ] || exit 1

plan=$(ls -t "$plans_dir"/*.md 2>/dev/null | head -1)
[ -n "$plan" ] || exit 1
grep -q '<!-- craft:dispatch' "$plan" || exit 1

hash=$(bash "$SCRIPTS/craft-dispatch.sh" --spec-hash "$plan" 2>/dev/null) || exit 1

# Abandoned: one hash per line, appended by `craft-dispatch.sh --abandon`.
if [ -f .craft/abandoned ] && grep -qxF "$hash" .craft/abandoned; then exit 1; fi

# Dispatched: some run dir already wrote args for this exact spec. A re-hash after a FAIL-loop
# amendment therefore re-arms the run, which is correct — the amended spec has not been dispatched.
for a in .craft/*/args.json; do
  [ -f "$a" ] || continue
  grep -qF "\"$hash\"" "$a" && exit 1
done

# The run dir need not live under this root. A dispatch block may name a `projectDir` elsewhere —
# correct when the deliverable is a NEW repo that did not exist at plan time — and craft-dispatch.sh
# writes .craft/<runId>/ there, so the root-relative search above finds nothing and reports a
# RUNNING run as undispatched forever. Fails CLOSED: an unreadable, unparseable or projectDir-less
# block yields the empty string, and the verdict rests on the root-relative evidence alone.
projdir=$(python3 - "$plan" 2>/dev/null <<'PY'
import json, os, re, sys
try:
    m = re.search(r'<!--\s*craft:dispatch\s*(.*?)-->', open(sys.argv[1]).read(), re.S)
    block = json.loads(m.group(1))
    args = block.get("args") if isinstance(block.get("args"), dict) else {}
    p = args.get("projectDir") or block.get("projectDir")
except Exception:
    raise SystemExit(0)
if isinstance(p, str) and p.strip():
    print(os.path.abspath(os.path.expanduser(p.strip())))
PY
) || projdir=""

if [ -n "$projdir" ] && [ "$projdir" != "$PWD" ]; then
  if [ -f "$projdir/.craft/abandoned" ] && grep -qxF "$hash" "$projdir/.craft/abandoned"; then exit 1; fi
  for a in "$projdir"/.craft/*/args.json; do
    [ -f "$a" ] || continue
    grep -qF "\"$hash\"" "$a" && exit 1
  done
fi

runid=$(sed -n 's/.*"runId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$plan" | head -1)
[ -n "$runid" ] || runid=$(basename "$plan" .md)
# Absolute: every consumer reads this from its own cwd, not the project's.
printf '%s\t%s\n' "$(realpath "$plan")" "$runid"
exit 0
