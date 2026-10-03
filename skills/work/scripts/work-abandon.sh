#!/usr/bin/env bash
# work-abandon.sh — retire a run the USER abandoned, in one sanctioned step.
#
#   work-abandon.sh <run-dir> --why '<reason>'
#
# A run the user walks away from leaves two things behind that outlive it: a run dir with no
# result.json, which `cron-delete-guard.ts` reads as in-flight forever, and (if one was armed) a
# hold nothing will ever release. The escape used to be an env var the SESSION sets for
# itself, which is not a user decision at all. This is: gate it with a `permissions.ask` rule and
# the abandonment reaches the user wherever they are.
#
# It NEVER overwrites a real verdict. A run that already returned has been adjudicated; abandoning
# it afterwards is a statement about the loop, not about the result.
#
# exit 0 abandoned, 2 usage / no args.json in the run dir.
set -uo pipefail

die() { printf 'work-abandon: %s\n' "$*" >&2; exit 2; }

RUN="${1-}"
[ -n "$RUN" ] || die "usage: work-abandon.sh <run-dir> --why '<reason>'"
case "$RUN" in -*) die "usage: work-abandon.sh <run-dir> --why '<reason>'" ;; esac
shift

WHY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --why) WHY="${2-}"; shift 2 ;;
    *) die "unknown flag $1" ;;
  esac
done
[ -n "$WHY" ] || die "--why '<reason>' is required — an abandonment with no reason is indistinguishable from a crash"
[ -f "$RUN/args.json" ] || die "$RUN holds no args.json — that is not a work run directory"

RESULT="$RUN/result.json"
AT=$(date -Is)

# (a) THE VERDICT. Absent or empty only: `[ -s ]` is exactly the in-flight test cron-delete-guard.ts
# and work-goal-resend.sh use, so writing here closes the same question they ask.
if [ -s "$RESULT" ]; then
  echo "work-abandon: $RESULT already holds a verdict — left untouched."
else
  python3 - "$RESULT" "$WHY" "$AT" <<'PY'
import json, sys
path, why, at = sys.argv[1:4]
json.dump({"overallPass": False, "abandoned": True, "why": why, "at": at}, open(path, "w"))
PY
  echo "work-abandon: wrote $RESULT (overallPass=false, abandoned=true)"
fi

# (b) THE HOLD. Same state and ledger paths hooks/work-hold.ts computes; the ledger line goes down
# BEFORE the state file is removed, so there is no window in which the hook sees a hold that
# vanished with `armed` still the last word and restores it.
SID="${CLAUDE_CODE_SESSION_ID-}"
if [ -n "$SID" ]; then
  STATE="${TMPDIR:-/tmp}/work-hold-$SID.json"
  LOG="${STATE%.json}.releases.log"
  if [ -f "$STATE" ]; then
    HOOK="$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)/hooks/work-hold.ts"
    printf '%s\tabandoned by user\t%s\n' "$AT" "$WHY" >> "$LOG"
    # Only THIS run's hold: a session holding several runs keeps the others. A hold that watches no
    # run at all (hand-armed) is released as before.
    drop=released
    if [ -r "$HOOK" ] && command -v bun >/dev/null 2>&1; then
      drop=$(bun "$HOOK" --drop-run "$(cd "$RUN" && pwd)" 2>/dev/null) || drop=released
      if [ "$drop" = absent ] && jq -e '.run' "$STATE" >/dev/null 2>&1; then
        echo "work-abandon: the hold armed in this session watches other run(s), not $RUN — left armed."
        drop=kept
      fi
    fi
    if [ "$drop" = kept ]; then
      echo "work-abandon: this run's hold released; any other hold in this session stays armed."
    else
      # Restore the compact window BEFORE the state goes: the cap record lives inside it, exactly as
      # --disarm and every release in the hook do it.
      [ -r "$HOOK" ] && command -v bun >/dev/null 2>&1 && bun "$HOOK" --uncap
      rm -f "$STATE"
      echo "work-abandon: hold released (ledger: abandoned by user)"
    fi
  else
    echo "work-abandon: no hold armed for this session."
  fi
else
  echo "work-abandon: no CLAUDE_CODE_SESSION_ID — no session-scoped hold to release."
fi

# (c) What the caller came for.
echo "work-abandon: CronDelete on this run's heartbeat is now allowed."
