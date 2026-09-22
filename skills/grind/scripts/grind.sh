#!/usr/bin/env bash
# grind.sh -- an unattended agent loop whose entire memory is one append-only journal.
#
# The loop calls a FRESH model process per iteration and keeps nothing between them. There is no
# pidfile, no state file, no lock and no cache: the iteration counter, the floor set, the pid and
# whether a stop was requested are all DERIVED by reading the journal, because two files that can
# disagree about one fact are a bug generator.
#
# Three properties carry a loop that runs for days:
#
#   1. A model call is spent only when a decision exists. While --gate exits non-zero the loop
#      records a wait, sleeps, and never invokes the runner. The verdict on a ten-hour grid job
#      comes from a shell command, not from asking a model whether the job finished.
#   2. The loop never grades itself. Continue-or-stop is --check's exit code and nothing else. The
#      agent's only write channel is `append`, and that channel carries OBSERVATIONS, never verdicts:
#      it takes a whitelist of agent-owned kinds, so no record the agent can write ends the run,
#      declares success, or is mistaken for the loop's own bookkeeping. `stop` is the operator's
#      command and is refused from inside an iteration, and `status` reports the run's outcome from
#      the last LOOP-owned record, so nothing the agent appends afterwards erases it.
#   3. A key recorded as a floor is injected into EVERY later prompt as an exclusion. Without that,
#      an amnesiac iteration re-diagnoses the same dead item every pass, for a week.
#
# And the property that makes an append-only log worth having: a record that does not fit in one
# atomic write is REFUSED -- never split, never truncated -- and every reader skips unparseable
# lines, which is what makes a journal cut short by a crash resumable rather than fatal.
#
# Exit codes: 0 check went green (done) | 2 refused (bad call, bad record) | 3 stalled
#             4 pass budget exhausted   | 5 stopped by a stop record or a signal
set -uo pipefail

# POSIX guarantees an O_APPEND write of at most PIPE_BUF bytes lands whole. That guarantee is the
# entire reason this file needs no lock while the loop and the agent both append to it -- the same
# discipline as farm.sh:131-134: one printf, no flock, write errors swallowed.
ATOMIC_BOUND=4096

SELF=$(realpath -- "${BASH_SOURCE[0]}" 2>/dev/null) || SELF=${BASH_SOURCE[0]}

usage() {
  cat >&2 <<'EOF'
grind.sh -- an unattended loop whose only memory is one append-only journal.

  grind.sh run    --journal J --check CMD --prompt-file F [--gate CMD] [--runner R]
                  [--model M] [--max-iters N] [--sleep S] [--stall-after K]
                  [--notify CMD]   run by bash on every ending, with RALPH_STATE, RALPH_EXIT
                                   and RALPH_JOURNAL set; its failure never changes the exit
  grind.sh append --journal J '{"kind":"progress","key":"..."}'
  grind.sh floors --journal J
  grind.sh status --journal J
  grind.sh tail   --journal J [-n N] [-f]
  grind.sh stop   --journal J [--why TEXT]

exit: 0 done | 2 refused | 3 stalled | 4 budget exhausted | 5 stopped
EOF
  exit 2
}

# Exit 2 is "you called me wrong", distinct from the loop's own verdicts.
refuse() { printf 'grind: %s\n' "$*" >&2; exit 2; }
warn()   { printf 'grind: %s\n' "$*" >&2; }
now()    { local t; printf -v t '%(%Y-%m-%dT%H:%M:%S%z)T' -1; printf '%s' "$t"; }
want_int() { case "$2" in ''|*[!0-9]*) refuse "$1 needs a non-negative integer, got: $2" ;; esac; }

# ------------------------------------------------------------------ the write side

# Append ONE record. Refuses -- and writes nothing at all -- when the record is not a single JSON
# object on a single line, or when it does not fit in one atomic write. Splitting an oversized
# record across two writes would leave a log nobody can replay, which is strictly worse than
# refusing the record; truncating it to fit would be worse still, because the result still parses.
#
# A WRITE error (unwritable path, full disk) is swallowed rather than refused: logging must never be
# the thing that kills a week-long run. `run` proves the journal is writable once, before the loop.
journal_append() {
  local j=$1 rec=$2 lead='' n
  case "$rec" in
    *$'\n'*|*$'\r'*)
      printf 'grind: refused: a record must be ONE line; %s\n' 'not split across two' >&2; return 2 ;;
  esac
  # Bytes, not characters: ${#rec} counts characters under a UTF-8 locale and would wave through a
  # multibyte record that overruns the bound on disk. +2 covers this record's own newline and the
  # repair newline below.
  n=$(printf '%s' "$rec" | wc -c); n=${n//[^0-9]/}
  if [ "${n:-0}" -gt "$((ATOMIC_BOUND - 2))" ]; then
    printf 'grind: refused: record is %s bytes, over the %s-byte single-write bound; not split, not truncated\n' \
      "$n" "$ATOMIC_BOUND" >&2
    return 2
  fi
  jq -e -s 'length == 1 and (.[0] | type == "object")' >/dev/null 2>&1 <<<"$rec" || {
    printf 'grind: refused: not one JSON object on one line\n' >&2; return 2; }

  mkdir -p -- "$(dirname -- "$j")" 2>/dev/null || true
  # A journal whose last line was cut short by a crash has no trailing newline. Appending straight
  # on would fuse this record onto that fragment and lose BOTH; one leading newline separates them,
  # inside the same single write.
  if [ -s "$j" ] && [ -n "$(tail -c 1 -- "$j" 2>/dev/null)" ]; then lead=$'\n'; fi
  printf '%s%s\n' "$lead" "$rec" >>"$j" 2>/dev/null || true
}

# ------------------------------------------------------------ the agent's channel

# An appended record may say what the agent FOUND. It may never say how the run ENDED, and it may
# never be mistaken for the loop's own bookkeeping. An amnesiac iteration is not hostile, it is
# uninformed: it reconstructs the record shape from its prompt and gets a field wrong, or decides the
# task looks impossible and says so in the only channel it has. Both are reachable, and the loop
# survives neither if the record lands.
AGENT_KINDS='progress floor attempt note'
# Every kind the agent may not write, and -- the same fact read the other way -- every kind `status`
# will believe about how the run ended. One list, because a second one could disagree with it.
# `stop` is the operator's record and `stopped` is the loop's answer to it; neither is the agent's.
LOOP_KINDS='start iter iter_end wait done stalled budget stop stopped'

# A WHITELIST, not a blacklist: an unrecognised kind is refused, which disposes of every near-miss
# spelling ("Stop", " stop", a unicode lookalike) without enumerating any of them, since the reader
# matches the kind exactly too. Where a record carries duplicate keys, this reads the same one the
# reader will -- both go through jq, and jq keeps the last.
#
# Prints why and returns 2; the caller turns that into the exit status. This is the AGENT's gate, so
# it is called from `append` alone -- the loop and the operator write through journal_append, which
# is how `stop` stays available to the operator and out of reach of the agent.
check_agent_record() {
  local rec=$1 kind
  jq -e -s 'length == 1 and (.[0] | type == "object")' >/dev/null 2>&1 <<<"$rec" || {
    printf 'grind: refused: not one JSON object on one line\n' >&2; return 2; }

  kind=$(jq -r -s '.[0].kind | if type == "string" then . else "" end' <<<"$rec" 2>/dev/null)
  case "$kind" in
    progress|floor|attempt|note) ;;
    *)
      printf 'grind: refused: kind %s is not yours to write; the agent may append [%s], the loop owns [%s]\n' \
        "${kind:-(missing)}" "$AGENT_KINDS" "$LOOP_KINDS" >&2
      return 2 ;;
  esac

  # A floor with no key passes every shape check and is then dropped by the reader, which filters on
  # `.key != null`. The agent believes the key is closed, the next prompt says it is open, and the
  # loop re-diagnoses it forever -- the exact non-convergence floors exist to prevent. Refuse it at
  # the door, where the agent still gets a non-zero exit it can see, rather than accepting a record
  # that means nothing. Whitespace is not a key either: it reaches the prompt as a blank exclusion.
  if [ "$kind" = floor ]; then
    jq -e -s '.[0].key | (type == "string" or type == "number") and (tostring | test("[^[:space:]]"))' \
      >/dev/null 2>&1 <<<"$rec" || {
      printf 'grind: refused: a floor needs a non-empty key; without one the reader drops it and the key is re-diagnosed forever\n' >&2
      return 2; }
  fi
  return 0
}

# ------------------------------------------------------------------ the read side

# The ONLY reader. One pass over the journal per call, so the floor set can never be read from a
# different moment than the iteration number it is injected beside. `fromjson?` drops a line that
# does not parse instead of aborting the scan -- that skip is what makes a journal truncated by a
# crash resumable, and it must never be turned into an error.
JQ_SCAN='
  def clean: tostring | gsub("[\\n\\r\\t]"; " ");
  ($own | split(" ") | map(select(. != ""))) as $loop
  | [inputs | fromjson? | select(type == "object")] as $r
  | ([$r[] | select(.kind == "iter") | .i | numbers] | max // 0) as $maxi
  | ([$r | to_entries[] | select(.value.kind == "progress") | .key] | last) as $lp
  | ([$r | to_entries[] | select(.value.kind == "iter") | .key
       | select($lp == null or . > $lp)] | length) as $stall
  | ([$r | to_entries[] | select(.value.kind == "stopped") | .key] | last) as $ls
  | ([$r | to_entries[] | select(.value.kind == "stop") | .key
       | select($ls == null or . > $ls)] | length) as $stops
  | ([$r[] | select(.kind == "start") | .pid | numbers] | last) as $pid
  | ([$r[] | select(.kind == "floor") | select(.key != null)
       | {key: (.key | clean), why: ((.why // "") | clean)}]
     | group_by(.key) | map(.[0])) as $floors
  # How the run ENDED is read from the last LOOP-owned record, never the positional last one: the
  # agent may legitimately append a progress record after the loop has written done, and a reader
  # that took the final line would report a finished run as still working. Matched exactly against
  # the whitelist, so " done", "Done" and a unicode lookalike are all simply not loop-owned.
  | ([$r[] | .kind | strings | select(IN($loop[]))] | last) as $lastloop
  | "next_i=\($maxi + 1)",
    "stall=\($stall)",
    "stops=\($stops)",
    "pid=\($pid // "")",
    "last=\(($r | last | .kind? // "") | clean)",
    "loop_last=\(($lastloop // "") | clean)",
    ($floors[] | "floor=\(.key)\t\(.why)")
'

# A sentinel, not a plausible value. A failed scan has to leave behind something the guard at the
# bottom of scan_journal can SEE: initialised to the literal 1, as it was, the guard could never fire
# and an unreadable journal read as a virgin one -- counter back to 1, every floor gone, and a fresh
# agent handed an iteration the journal already records.
SCAN_NEXT_I=- SCAN_STALL=0 SCAN_STOPS=0 SCAN_PID= SCAN_LAST= SCAN_LOOP_LAST=
FLOOR_KEYS=() FLOOR_WHY=()

scan_journal() {
  local j=$1 out rc line k v
  SCAN_NEXT_I=- SCAN_STALL=0 SCAN_STOPS=0 SCAN_PID= SCAN_LAST= SCAN_LOOP_LAST=
  FLOOR_KEYS=() FLOOR_WHY=()
  # Absent or empty is a genuinely virgin journal: there is nothing to read and numbering starts at
  # 1. This is the ONLY path that invents a counter, and it is settled before jq is ever asked.
  if [ ! -s "$j" ]; then SCAN_NEXT_I=1; return 0; fi

  # jq's OWN exit status decides whether the scan happened -- never the shape of its output. Handed
  # a journal it cannot open, jq prints a complete and entirely plausible scan (next_i=1, stall=0, no
  # floors) and exits 2; a reader that believed that output would reset the state the loop depends
  # on, and would look right doing it.
  # The journal is named as an ARGUMENT, not redirected onto stdin: a shell redirect that fails
  # never runs jq at all, so there is no exit status of jq's to read. `--` for the same reason the
  # rest of this file uses it -- a path may begin with a dash.
  out=$(jq -Rrn --arg own "$LOOP_KINDS" "$JQ_SCAN" -- "$j" 2>/dev/null); rc=$?
  if [ "$rc" -ne 0 ]; then
    warn "journal scan of $j failed (jq exit $rc); refusing to reset state"
    return 1
  fi

  while IFS= read -r line; do
    k=${line%%=*}; v=${line#*=}
    case "$k" in
      next_i) SCAN_NEXT_I=$v ;;
      stall)  SCAN_STALL=$v ;;
      stops)  SCAN_STOPS=$v ;;
      pid)    SCAN_PID=$v ;;
      last)   SCAN_LAST=$v ;;
      loop_last) SCAN_LOOP_LAST=$v ;;
      floor)
        if [[ $v == *$'\t'* ]]; then
          FLOOR_KEYS+=("${v%%$'\t'*}"); FLOOR_WHY+=("${v#*$'\t'}")
        else
          FLOOR_KEYS+=("$v"); FLOOR_WHY+=("")
        fi ;;
    esac
  done <<<"$out"
  # The second half of the same rule, for the case where jq exits 0 having emitted no counter: the
  # sentinel is still sitting there, and a counter that is not a number is not a counter. A scan that
  # produced nothing usable must not silently restart the numbering at 1 and hand an
  # already-attempted iteration back to a fresh agent.
  case "$SCAN_NEXT_I" in ''|*[!0-9]*) warn "journal scan of $j produced no iteration counter; refusing to reset state"; return 1 ;; esac
  case "$SCAN_STALL" in ''|*[!0-9]*) SCAN_STALL=0 ;; esac
  case "$SCAN_STOPS" in ''|*[!0-9]*) SCAN_STOPS=0 ;; esac
  case "$SCAN_PID"   in *[!0-9]*)    SCAN_PID= ;; esac
  return 0
}

# ------------------------------------------------------------------ the prompt

# Everything a fresh, amnesiac process needs: where to write, which iteration it is, and which keys
# are closed. The floors are read at the TOP of the pass that builds this, so a key filed by the
# previous iteration is already in hand.
build_prompt() {
  local body=$1 j=$2 i=$3 n
  printf 'RALPH_JOURNAL: %s\n' "$j"
  printf 'RALPH_SH: %s\n' "$SELF"
  printf 'RALPH_ITER: %s\n' "$i"
  if [ "${#FLOOR_KEYS[@]}" -eq 0 ]; then
    printf 'RALPH_FLOORS: none recorded yet.\n'
  else
    printf 'RALPH_FLOORS: these keys are CLOSED. Do NOT re-attempt, re-diagnose or re-open them.\n'
    for n in "${!FLOOR_KEYS[@]}"; do
      printf '  %s\t%s\n' "${FLOOR_KEYS[$n]}" "${FLOOR_WHY[$n]}"
    done
  fi
  cat <<EOF
RALPH_PROTOCOL: the journal above is your ONLY write channel to this loop.
  $SELF append --journal $j '{"kind":"progress","key":"...","note":"..."}'
  $SELF append --journal $j '{"kind":"floor","key":"...","why":"..."}'
progress = you moved the goal. Iterations that record none are counted consecutively and the loop
stops after --stall-after of them, so record one whenever you actually moved -- filing a floor
counts, but append the progress record too. floor = this key is dead for good; every later
iteration is handed it as an exclusion, which is the only reason this loop converges.
One JSON object on one line, under $ATOMIC_BOUND bytes, or the append is refused and nothing is
written. kind must be one of [$AGENT_KINDS], and a floor without a non-empty key is refused.
The loop owns [$LOOP_KINDS] and appending any of those is refused: you report what you FOUND, never
how the run ended. Nothing you write decides whether the loop stops -- that is the check command's
exit code. The stop subcommand is the operator's and is refused while you are inside an iteration,
so do not reach for it when the work looks impossible: file a floor and report what you found.

EOF
  printf '%s\n' "$body"
}

# ------------------------------------------------------------------ subcommands

# --notify is peeled off here so the loop's five terminal returns stay the single source of the
# outcome: the notifier reads the exit code, never a second copy of the state.
cmd_run() {
  local notify= journal= rc=0
  local -a pass=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --notify)  notify=${2:?--notify needs a value}; shift 2 ;;
      --journal) journal=${2:-}; pass+=("$1" "${2:-}"); shift 2 ;;
      *)         pass+=("$1"); shift ;;
    esac
  done
  run_loop "${pass[@]}" || rc=$?
  [ -n "$notify" ] || return "$rc"
  local state
  case "$rc" in
    0) state=done ;; 3) state=stalled ;; 4) state=budget ;; 5) state=stopped ;;
    *) return "$rc" ;;
  esac
  RALPH_STATE=$state RALPH_EXIT=$rc RALPH_JOURNAL=$journal bash -c "$notify" </dev/null \
    || warn "--notify exited $?; the run's own verdict stands"
  return "$rc"
}

run_loop() {
  local journal= check= gate= promptfile= model= runner=claude-code
  local max_iters=0 sleep_s=60 stall_after=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --journal)     journal=${2:?--journal needs a value};         shift 2 ;;
      --check)       check=${2:?--check needs a value};             shift 2 ;;
      --gate)        gate=${2:?--gate needs a value};               shift 2 ;;
      --prompt-file) promptfile=${2:?--prompt-file needs a value};  shift 2 ;;
      --model)       model=${2:?--model needs a value};             shift 2 ;;
      --runner)      runner=${2:?--runner needs a value};           shift 2 ;;
      --max-iters)   want_int --max-iters "${2:-}";   max_iters=$2;   shift 2 ;;
      --sleep)       want_int --sleep "${2:-}";       sleep_s=$2;     shift 2 ;;
      --stall-after) want_int --stall-after "${2:-}"; stall_after=$2; shift 2 ;;
      *) refuse "run: unknown argument: $1" ;;
    esac
  done
  [ -n "$journal" ]    || refuse "run: --journal is required"
  [ -n "$check" ]      || refuse "run: --check is required; it is the only authority on whether the goal is met"
  [ -n "$promptfile" ] || refuse "run: --prompt-file is required"
  [ -r "$promptfile" ] || refuse "run: --prompt-file $promptfile: not readable"
  command -v "$runner" >/dev/null 2>&1 || refuse "run: --runner $runner not executable or not on PATH"

  # Prove the journal is writable BEFORE the loop: after this point a write error is swallowed, so a
  # journal that was never writable would leave a run with no record of itself.
  mkdir -p -- "$(dirname -- "$journal")" 2>/dev/null || true
  : >>"$journal" || refuse "run: --journal $journal: cannot append"

  local body; body=$(cat -- "$promptfile")

  # Proves the journal is SCANNABLE before a single model call is spent, on the same code path the
  # loop itself uses. A run that cannot read its own history must not start: it would hand a fresh
  # agent an iteration number and a floor set it invented.
  scan_journal "$journal" || refuse "run: cannot scan $journal; refusing to start rather than reset state"

  journal_append "$journal" "$(jq -cn \
    --argjson pid "$$" --arg ts "$(now)" --arg check "$check" --arg gate "$gate" \
    --arg runner "$runner" --arg model "$model" --arg prompt "$promptfile" \
    '{kind:"start",pid:$pid,ts:$ts,check:$check,gate:$gate,runner:$runner,model:$model,prompt:$prompt}')" \
    || warn "start record refused; status will not be able to name this run's pid"

  # A run killed by the operator otherwise vanishes with `iter` as its last word, and status cannot
  # tell that from a crash. One record makes the journal honest about how the run ended.
  trap 'journal_append "$journal" "{\"kind\":\"stopped\",\"ts\":\"$(now)\",\"why\":\"signal\"}"; exit 5' INT TERM

  local passes=0 i rc prompt
  local -a cmd
  while :; do
    passes=$((passes + 1))
    scan_journal "$journal" || { warn "unreadable journal; stopping rather than guessing"; return 2; }

    # 0. The operator's stop wins over everything, at the next loop boundary. A stop is pending
    #    until the loop answers it with `stopped`, so one written while nothing runs still ends the
    #    next run, and an answered one does not make the journal -- and its floors -- unresumable.
    #    Safe only because `append` refuses both kinds: the agent can neither stop nor un-stop.
    if [ "$SCAN_STOPS" -gt 0 ]; then
      journal_append "$journal" "{\"kind\":\"stopped\",\"ts\":\"$(now)\",\"why\":\"stop record\"}"
      warn "stop record honoured after $((SCAN_NEXT_I - 1)) iterations"
      return 5
    fi

    # 1. The check is the ONLY thing that can declare the work done. Never a model's opinion, never
    #    a record the agent wrote.
    if bash -c "$check"; then
      journal_append "$journal" "{\"kind\":\"done\",\"i\":$((SCAN_NEXT_I - 1)),\"ts\":\"$(now)\"}"
      warn "check green after $((SCAN_NEXT_I - 1)) iterations"
      return 0
    fi

    if [ "$max_iters" -gt 0 ] && [ "$passes" -gt "$max_iters" ]; then
      journal_append "$journal" "{\"kind\":\"budget\",\"passes\":$((passes - 1)),\"ts\":\"$(now)\"}"
      warn "pass budget of $max_iters exhausted with the check still red"
      return 4
    fi

    # 2. The supervisor. While the gate is red there is no decision to make, so no model call is
    #    spent -- this is the difference between a loop that costs a fortune and one that does not.
    if [ -n "$gate" ] && ! bash -c "$gate"; then
      journal_append "$journal" "{\"kind\":\"wait\",\"pass\":$passes,\"ts\":\"$(now)\"}"
      [ "$sleep_s" -gt 0 ] && sleep "$sleep_s"
      continue
    fi

    # 3. Checked before the call, not after, so a resumed run that is already stalled spends nothing.
    if [ "$stall_after" -gt 0 ] && [ "$SCAN_STALL" -ge "$stall_after" ]; then
      journal_append "$journal" "{\"kind\":\"stalled\",\"after\":$SCAN_STALL,\"ts\":\"$(now)\"}"
      warn "$SCAN_STALL iterations recorded no progress; stopping"
      return 3
    fi

    i=$SCAN_NEXT_I
    journal_append "$journal" "{\"kind\":\"iter\",\"i\":$i,\"ts\":\"$(now)\"}"
    prompt=$(build_prompt "$body" "$journal" "$i")
    cmd=("$runner" -p "$prompt")
    [ -n "$model" ] && cmd+=(--model "$model")
    warn "iteration $i: ${#FLOOR_KEYS[@]} floors, $SCAN_STALL since progress"
    # The marker that tells `stop` it is being run by an iteration rather than by the operator. It
    # is scoped to this one command, so it reaches the runner and everything the runner spawns and
    # nothing else; the operator's own shell never has it, which is why their stop still works.
    RALPH_ITERATION=$i "${cmd[@]}"
    rc=$?
    journal_append "$journal" "{\"kind\":\"iter_end\",\"i\":$i,\"exit\":$rc,\"ts\":\"$(now)\"}"
  done
}

cmd_append() {
  local journal= rec= seen=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --journal) journal=${2:?--journal needs a value}; shift 2 ;;
      --) shift
          [ $# -eq 0 ] && break
          [ "$seen" -eq 0 ] || refuse "append: one record per call"
          rec=$1; seen=1; shift ;;
      -*) refuse "append: unknown argument: $1" ;;
      *)  [ "$seen" -eq 0 ] || refuse "append: one record per call"
          rec=$1; seen=1; shift ;;
    esac
  done
  [ -n "$journal" ]  || refuse "append: --journal is required"
  [ "$seen" -eq 1 ]  || refuse "append: needs one JSON object as its argument"
  # The whitelist runs BEFORE the write, so a refused record is absent rather than present-and-ignored.
  check_agent_record "$rec" || return 2
  journal_append "$journal" "$rec"
}

cmd_floors() {
  local journal= n
  while [ $# -gt 0 ]; do
    case "$1" in
      --journal) journal=${2:?--journal needs a value}; shift 2 ;;
      *) refuse "floors: unknown argument: $1" ;;
    esac
  done
  [ -n "$journal" ] || refuse "floors: --journal is required"
  scan_journal "$journal" || return 2
  [ "${#FLOOR_KEYS[@]}" -gt 0 ] || return 0
  for n in "${!FLOOR_KEYS[@]}"; do printf '%s\t%s\n' "${FLOOR_KEYS[$n]}" "${FLOOR_WHY[$n]}"; done
}

cmd_status() {
  local journal= state= alive=
  while [ $# -gt 0 ]; do
    case "$1" in
      --journal) journal=${2:?--journal needs a value}; shift 2 ;;
      *) refuse "status: unknown argument: $1" ;;
    esac
  done
  [ -n "$journal" ] || refuse "status: --journal is required"
  scan_journal "$journal" || return 2

  # A terminal record is the truth about how the run ended; the pid is consulted only when the
  # journal does not already say. (A recycled pid can read as alive -- the record cannot.)
  #
  # The record switched on is the last LOOP-owned one. Status is the only window a human has into a
  # detached run, and a `progress` the agent appends after the loop wrote `done` -- a late note from
  # the iteration that was still finishing when the check went green -- is legitimate. Switching on
  # the positional last record would let that erase the outcome.
  if [ -n "$SCAN_PID" ] && kill -0 "$SCAN_PID" 2>/dev/null; then alive=alive; else alive=gone; fi
  case "$SCAN_LOOP_LAST" in
    done|stalled|budget|stopped) state=$SCAN_LOOP_LAST ;;
    '')                          state=idle ;;
    *)
      # No start record means no run has ever begun on this journal, whatever else it holds --
      # `append` needs no run, so a journal carrying only agent records is exactly that case.
      # Reporting it "orphaned" is a verdict about a run that never happened, which is the same
      # mistake as letting the agent write one.
      #
      # "orphaned", not "abandoned": this report is read by grep as often as by eye, and the word
      # `abandoned` CONTAINS `done`, so a run that died without recording how answered yes to
      # `status | grep done`. Same rule as the journal path below -- nothing in this output may be
      # readable as a verdict it is not.
      if   [ -z "$SCAN_PID" ];   then state=idle
      elif [ "$alive" = alive ]; then state=running
      else                            state=orphaned
      fi ;;
  esac

  # Every line below is DERIVED from the journal. The path is not -- it is the caller's own argument
  # handed back, and echoing caller-supplied text into the status report means the report can carry
  # any word that text carries: `--journal /tmp/run-done/j.jsonl` would make `status | grep done`
  # answer yes about a run that is still going. Same reason farm.sh encodes its event labels. A field
  # the caller controls must never be readable as the loop's verdict, so status reports what it read,
  # not what it was told.
  printf 'state:          %s\n' "$state"
  printf 'loop record:    %s\n' "${SCAN_LOOP_LAST:-none}"
  printf 'last record:    %s\n' "${SCAN_LAST:-none}"
  printf 'pid:            %s (%s)\n' "${SCAN_PID:-unknown}" "$alive"
  printf 'iterations:     %s\n' "$((SCAN_NEXT_I - 1))"
  printf 'floors:         %s\n' "${#FLOOR_KEYS[@]}"
  printf 'since progress: %s\n' "$SCAN_STALL"
}

cmd_tail() {
  local journal= n=20 follow=
  while [ $# -gt 0 ]; do
    case "$1" in
      --journal) journal=${2:?--journal needs a value}; shift 2 ;;
      -n)        want_int -n "${2:-}"; n=$2; shift 2 ;;
      -f|--follow) follow=1; shift ;;
      *) refuse "tail: unknown argument: $1" ;;
    esac
  done
  [ -n "$journal" ] || refuse "tail: --journal is required"
  [ -f "$journal" ] || refuse "tail: no journal at $journal"
  if [ -n "$follow" ]; then tail -f -n "$n" -- "$journal"; else tail -n "$n" -- "$journal"; fi
}

# `stop` belongs to the OPERATOR. `append` already refuses kind=stop, but this subcommand writes the
# same record through journal_append directly, and every prompt prints RALPH_SH -- so an iteration
# that reads the skill, sees the documented command and concludes the task looks impossible could end
# a run it did not start. `run` marks the environment it invokes the runner in; a shell carrying that
# marker is inside an iteration and is refused here, loudly, because a guard that fails silently
# teaches the next amnesiac iteration nothing.
#
# THE LIMIT, STATED RATHER THAN CHASED: the threat is an uninformed iteration, not an adversary. An
# iteration runs bash. It can unset RALPH_ITERATION, and it can kill the pid it reads out of the
# journal. No in-band check can prevent either, and pretending otherwise would be the defect. This
# closes the documented path and names the reason; it is not a guarantee that the loop cannot be
# stopped, and SKILL.md says so.
cmd_stop() {
  local journal= why=requested
  if [ -n "${RALPH_ITERATION:-}" ]; then
    refuse "stop: refused: this shell is inside iteration ${RALPH_ITERATION} of a run, and stop is the OPERATOR's command. An iteration reports what it FOUND through 'append'; whether the run ends is the check command's exit code, never an iteration's opinion that the work looks impossible."
  fi
  while [ $# -gt 0 ]; do
    case "$1" in
      --journal) journal=${2:?--journal needs a value}; shift 2 ;;
      --why)     why=${2:?--why needs a value};         shift 2 ;;
      *) refuse "stop: unknown argument: $1" ;;
    esac
  done
  [ -n "$journal" ] || refuse "stop: --journal is required"
  journal_append "$journal" "$(jq -cn --arg ts "$(now)" --arg why "$why" '{kind:"stop",ts:$ts,why:$why}')" || return 2
  printf 'stop recorded; the loop exits at its next boundary\n'
}

# ------------------------------------------------------------------ dispatch

[ $# -gt 0 ] || usage
command -v jq >/dev/null 2>&1 || refuse "jq is required: every read of the journal goes through it"

sub=$1; shift
case "$sub" in
  run)    cmd_run    "$@" ;;
  append) cmd_append "$@" ;;
  floors) cmd_floors "$@" ;;
  status) cmd_status "$@" ;;
  tail)   cmd_tail   "$@" ;;
  stop)   cmd_stop   "$@" ;;
  -h|--help|help) usage ;;
  *) printf 'grind: unknown subcommand: %s\n' "$sub" >&2; usage ;;
esac
exit $?
