#!/usr/bin/env bash
# Is a work run approved but undispatched in this project?
#
#   work-pending.sh [root] [--transcript PATH] [--written]
#
# Armed  = the newest plan carries a `<!-- work:dispatch … -->` block.
# Approved = an ExitPlanMode for THAT plan file returned without error in this session's transcript
#          (or in the transcript a re-seeded "Implement the following plan" session names). Writing a
#          plan is staging it; only the user's approval makes a dispatch owed. The transcript is
#          --transcript, else ~/.claude/projects/*/$CLAUDE_CODE_SESSION_ID.jsonl; with neither, no
#          approval can be shown and nothing is owed. --written skips this test (work-dispatch.sh's
#          "dispatch the newest armed plan" default, where the caller already chose to dispatch).
# Undispatched = no run dir records this plan's CURRENT spec hash, and the hash was not abandoned.
#          Run dirs are found three ways: <root>/{.work,.craft}/*/args.json, the same under the
#          block's projectDir, and the dispatch log ${TMPDIR}/work-dispatch.log, where
#          work-dispatch.sh records every run dir it writes — so a `--run-dir` outside the project
#          is found too. A log entry is trusted only when that args.json still carries the hash.
#          `.craft/` and `<root>/.work/abandoned` are history, read but never written: abandonment
#          is recorded in the dispatch log, outside the project tree.
#          The hash is over the dispatch block's canonical JSON, so editing the prose around it does
#          not read as an un-dispatched amendment.
#
# Prints "<planPath>\t<runId>" and exits 0 when a dispatch is owed; silent exit 1 otherwise.
# Called per Edit/Write by main-thread-guard.sh, so the negative path must stay cheap: the
# directory test below fires before anything reads or hashes a file, and the transcript is read last.
set -uo pipefail

# Resolved before the cd below — a relative $0 would not survive it.
SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

root_arg="" transcript="" written=0
while [ $# -gt 0 ]; do
  case "$1" in
    --transcript) transcript="${2-}"; shift 2 || exit 1 ;;
    --written) written=1; shift ;;
    *) root_arg="$1"; shift ;;
  esac
done
cd "${root_arg:-$PWD}" 2>/dev/null || exit 1

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
grep -qE '<!-- work:dispatch' "$plan" || exit 1

hash=$(bash "$SCRIPTS/work-dispatch.sh" --spec-hash "$plan" 2>/dev/null) || exit 1

# HISTORY_ROOTS: .work is where every new run is written; .craft is the pre-rename spelling, read
# forever because the dispatch record of a plan dispatched before the rename exists nowhere else.
HISTORY_ROOTS=(.work .craft)

# Abandoned: legacy one-hash-per-line files (history; nothing writes them now).
for r in "${HISTORY_ROOTS[@]}"; do
  if [ -f "$r/abandoned" ] && grep -qxF "$hash" "$r/abandoned"; then exit 1; fi
done

# The dispatch log: "<iso>\t<verb>\t<hash>\t<path>". `abandoned` releases; `dispatched` names the run
# dir, which must still carry the hash — the log says where to look, the run dir says what ran.
DLOG="${TMPDIR:-/tmp}/work-dispatch.log"
if [ -f "$DLOG" ]; then
  while IFS=$'\t' read -r _ verb h path; do
    [ "$h" = "$hash" ] || continue
    [ "$verb" = abandoned ] && exit 1
    [ "$verb" = dispatched ] && [ -f "$path/args.json" ] && grep -qF "\"$hash\"" "$path/args.json" && exit 1
  done < <(grep -F "$hash" "$DLOG")
fi

# Dispatched: some run dir already wrote args for this exact spec. A re-hash after a FAIL-loop
# amendment therefore re-arms the run, which is correct — the amended spec has not been dispatched.
for r in "${HISTORY_ROOTS[@]}"; do
  for a in "$r"/*/args.json; do
    [ -f "$a" ] || continue
    grep -qF "\"$hash\"" "$a" && exit 1
  done
done

# The run dir need not live under this root. A dispatch block may name a `projectDir` elsewhere —
# correct when the deliverable is a NEW repo that did not exist at plan time — and work-dispatch.sh
# writes .work/<runId>/ there, so the root-relative search above finds nothing and reports a
# RUNNING run as undispatched forever. Fails CLOSED: an unreadable, unparseable or projectDir-less
# block yields the empty string, and the verdict rests on the root-relative evidence alone.
projdir=$(python3 - "$plan" 2>/dev/null <<'PY'
import json, os, re, sys
try:
    m = re.search(r'<!--\s*work:dispatch\s*(.*?)-->', open(sys.argv[1]).read(), re.S)
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
  for r in "${HISTORY_ROOTS[@]}"; do
    if [ -f "$projdir/$r/abandoned" ] && grep -qxF "$hash" "$projdir/$r/abandoned"; then exit 1; fi
    for a in "$projdir/$r"/*/args.json; do
      [ -f "$a" ] || continue
      grep -qF "\"$hash\"" "$a" && exit 1
    done
  done
fi

# APPROVAL, last because it reads a transcript. A plan nobody approved is staged, not owed.
if [ "$written" != 1 ]; then
  if [ -z "$transcript" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    transcript=$(ls "$HOME"/.claude/projects/*/"$CLAUDE_CODE_SESSION_ID".jsonl 2>/dev/null | head -1)
  fi
  [ -n "$transcript" ] && [ -f "$transcript" ] || exit 1
  python3 "$SCRIPTS/plan-approved.py" "$(realpath "$plan")" "$transcript" || exit 1
fi

runid=$(sed -n 's/.*"runId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$plan" | head -1)
[ -n "$runid" ] || runid=$(basename "$plan" .md)
# Absolute: every consumer reads this from its own cwd, not the project's.
printf '%s\t%s\n' "$(realpath "$plan")" "$runid"
exit 0
