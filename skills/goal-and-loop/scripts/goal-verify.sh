#!/usr/bin/env bash
# Is a goal ACTUALLY set on this session? Exit 0 yes, 1 no, 2 cannot tell.
#
# Reads the session transcript, not the screen. Two screen-scrape channels were tested and both
# fail: `pane wait-output` over recent output matched the assistant's own prose ABOUT the string
# "Goal set:", and Claude Code's `/goal active` chrome renders only in the working spinner, so an
# idle pane shows nothing whether or not a goal is set.
#
# The transcript record is unforgeable by prose because it is matched at the START of a record's
# content: Claude Code writes "<local-command-stdout>Goal set: ..." itself, and an assistant message
# that merely mentions the phrase is a different record whose content does not begin with it.
#
# Usage: goal-verify.sh [--session <id>] [--quiet]
set -uo pipefail
SID="${CLAUDE_CODE_SESSION_ID-}"; QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --session) SID="${2-}"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    *) echo "usage: goal-verify.sh [--session <id>] [--quiet]" >&2; exit 2 ;;
  esac
done
[ -n "$SID" ] || { echo "goal-verify: no session id" >&2; exit 2; }

FILE=$(find "$HOME/.claude/projects" -maxdepth 2 -name "$SID.jsonl" -print -quit 2>/dev/null)
[ -n "$FILE" ] || { echo "goal-verify: no transcript for $SID" >&2; exit 2; }

GV_FILE="$FILE" GV_QUIET="$QUIET" python3 - <<'PY'
import json, os, sys
path = os.environ["GV_FILE"]; quiet = os.environ["GV_QUIET"] == "1"
state = None   # (kind, text, ts)
for line in open(path, errors="replace"):
    try: d = json.loads(line)
    except Exception: continue
    # Claude Code writes the receipt as a local_command record whose content is a plain STRING.
    # Assistant prose and tool results carry content as a LIST of blocks, so requiring a string
    # that STARTS WITH the marker excludes both — including this session's own greps for it.
    c = d.get("content")
    if not isinstance(c, str):
        c = d.get("message", {}).get("content")
    if not isinstance(c, str): continue
    if c.startswith("<local-command-stdout>Goal set:"):
        txt = c[len("<local-command-stdout>Goal set:"):].split("</local-command-stdout>")[0].strip()
        state = ("set", txt, d.get("timestamp"))
    elif c.startswith("<local-command-stdout>No goal set") or c.startswith("<local-command-stdout>Goal cleared"):
        state = ("clear", "", d.get("timestamp"))
if state and state[0] == "set":
    if not quiet: print(f"goal ACTIVE (set {state[2]}): {state[1][:160]}")
    sys.exit(0)
if not quiet:
    print("NO GOAL SET" + (f" (last cleared {state[2]})" if state else " — this session has never had one"))
    # A queued send is the failure this exists to catch, so name it when one is pending.
    q = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"herdr-goal-send-{os.environ.get('CLAUDE_CODE_SESSION_ID','')}.q")
    if os.path.exists(q) and os.path.getsize(q):
        print(f"  pending in queue (not yet delivered): {q}")
sys.exit(1)
PY
