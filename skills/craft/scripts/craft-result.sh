#!/usr/bin/env bash
# craft-result.sh — adjudicate the JSON that `farm.ts --out` wrote for a craft run, then print it.
#
#   craft-result.sh <craft-result.json>
#
# exit 0  shape is a craft gate return, every claimed mechanical exit code was re-observed, overallPass true
# exit 1  same, but overallPass false — the run FAILED. Verdict and score table still print on stdout.
# exit 2  refused — stdout stays empty, every reason is named on stderr
#
# THIS EXIT CODE IS THE VERDICT. A model is in the return path (the delegated agent transcribes the
# workflow's object into the file), so a caller reading overallPass out of the file is trusting that
# model; the adjudication below is what makes the code trustworthy where the field is not.
#
# Adjudication: `args.json` beside the result names each mechanical check's cmd, and EVERY declared
# check is re-run here, in a shell, from the run's projectDir. Not only the claimed passes: this file
# is a transcription of the gate object, so a transcription pairing a claimed-failed check with
# overallPass true would otherwise be waved through. Re-running all of them is affordable because a
# workflow exposes one entry point per component. The one exception is a check claiming exitCode -1,
# the sentinel for a probe that never reported: no claim exists to contradict, so it FAILS not refuses.
set -euo pipefail

# key -> required JSON type. Must stay identical to the gate return at the tail of
# ../workflow.js; a key that drifts out of that return silently reads as "missing" here.
#
# The gate return also carries `judged` (string), `implemented`, `verified`, `refuted`, `thirdParty`,
# `mechanical`, `scores` (arrays), and — conditionally — `red` and `residue`. Only the keys below are
# required: the rest are either advisory or emitted by one mode. OPTIONAL names the conditional ones
# whose type is still checked WHEN PRESENT, so a mode-specific key cannot arrive malformed.
CONTRACT='{
  "overallPass": "boolean",
  "verdict": "string",
  "scoreTable": "object",
  "findings": "array",
  "tasksThatFlagged": "array",
  "mechanicalThatFailed": "array",
  "lensesThatFlagged": "array"
}'
OPTIONAL='{
  "red": "array",
  "residue": "array"
}'

die() { printf 'craft-result.sh: %s\n' "$*" >&2; exit 2; }

command -v jq >/dev/null 2>&1 || die "jq is required but not on PATH"

FILE="${1:-}"
[ -n "$FILE" ] || die "usage: craft-result.sh <craft-result.json>"
[ -e "$FILE" ] || die "no such file: $FILE"
[ -f "$FILE" ] || die "not a regular file: $FILE"
[ -r "$FILE" ] || die "not readable: $FILE"
[ -s "$FILE" ] || die "empty file: $FILE — the delegated run wrote nothing"

# Slurped so a whitespace-only file (which `jq empty` accepts, emitting no value) and a file
# holding several concatenated values are both distinguishable from one well-formed object.
if ! SLURP=$(jq -s '.' -- "$FILE" 2>&1); then
  printf 'craft-result.sh: %s is not valid JSON\n%s\n' "$FILE" "$SLURP" >&2
  exit 2
fi
NVALS=$(printf '%s' "$SLURP" | jq 'length')
[ "$NVALS" = "1" ] || die "$FILE holds $NVALS JSON values, expected exactly 1"

PROBLEMS=$(printf '%s' "$SLURP" | jq -r --argjson contract "$CONTRACT" --argjson optional "$OPTIONAL" '
  .[0] as $r
  | if ($r | type) != "object" then
      "the return is a \($r | type), not an object — a craft gate return is a single JSON object"
    else
      ( $contract | to_entries[]
        | .key as $k | .value as $want
        | if ($r | has($k)) | not then "missing required key: \($k)"
          elif ($r[$k] | type) != $want then "\($k): expected \($want), got \($r[$k] | type)"
          else empty end ),
      ( $optional | to_entries[]
        | .key as $k | .value as $want
        | if ($r | has($k)) and ($r[$k] | type) != $want
          then "\($k): expected \($want), got \($r[$k] | type)" else empty end ),
      # residue is COUNTED from the array, never read out of the transcribed table — a table saying 0
      # beside a non-empty residue would report a frozen round as having raised nothing fresh.
      ( if ($r | has("residue")) and ($r.residue | type) == "array" then
          ( $r.scoreTable | if type == "object" then .residue else null end ) as $claimed
          | if $claimed == null then "residue is present but scoreTable reports no residue count"
            elif $claimed != ($r.residue | length)
            then "scoreTable.residue is \($claimed), the residue array holds \($r.residue | length)"
            else empty end
        else empty end )
    end
')

if [ -n "$PROBLEMS" ]; then
  printf 'craft-result.sh: REFUSED — %s is not a craft gate return:\n' "$FILE" >&2
  printf '%s\n' "$PROBLEMS" | sed 's/^/  - /' >&2
  exit 2
fi

RESULT=$(printf '%s' "$SLURP" | jq '.[0]')
OVERALL=$(printf '%s' "$RESULT" | jq -r '.overallPass')

# ---- adjudication: every declared mechanical check is re-run in this shell --------------------
# args.json is the dispatched parameter file (craft-dispatch.sh writes it beside result.json). It is
# the only record of what each check's cmd actually was; without it there is nothing to re-run, so a
# missing one refuses rather than skipping — a skip would read as an adjudicated pass.
ARGS="$(dirname -- "$FILE")/args.json"
[ -e "$ARGS" ] || die "no args.json beside $FILE — nothing to adjudicate the mechanical claims against"
[ -f "$ARGS" ] || die "not a regular file: $ARGS"
[ -r "$ARGS" ] || die "not readable: $ARGS"
jq -e 'type == "object"' -- "$ARGS" >/dev/null 2>&1 || die "$ARGS is not a JSON object"

CWD=$(jq -r '.projectDir // empty' -- "$ARGS")
[ -n "$CWD" ] || die "$ARGS declares no projectDir — the cwd a check must be re-run from is unknown"
[ -d "$CWD" ] || die "projectDir is not a directory: $CWD"

# A malformed declaration would make the jq below emit nothing, and an empty loop is a silent skip.
jq -e '
  (.mechanicalChecks // []) as $m
  | ($m | type) == "array"
    and ($m | all((.name | type) == "string" and (.name | length) > 0
                  and (.cmd | type) == "string" and (.cmd | length) > 0))
' -- "$ARGS" >/dev/null 2>&1 \
  || die "$ARGS: mechanicalChecks must be an array of {name, cmd} strings — nothing can be re-run"

while IFS=' ' read -r name64 cmd64; do
  [ -n "$name64" ] || continue
  name=$(printf '%s' "$name64" | base64 -d)
  cmd=$(printf '%s' "$cmd64" | base64 -d)

  claimed=$(printf '%s' "$RESULT" | jq -r --arg n "$name" '
    [ (.mechanical // [])[] | select(.name == $n) ]
    | if length == 0 then "none" else (.[0].exitCode | tostring) end')
  case "$claimed" in
    none) die "REFUSED — the result reports no outcome for declared mechanical check \"$name\"" ;;
    ''|*[!0-9-]*) die "REFUSED — mechanical check \"$name\" reports a non-integer exitCode: $claimed" ;;
  esac
  # Internal consistency: the gate's own arithmetic cannot pass a run with a failed check, so a
  # claimed non-zero beside overallPass true is a transcription defect, not a verdict to report.
  if [ "$claimed" != 0 ] && [ "$OVERALL" = true ]; then
    die "REFUSED — mechanical check \"$name\" claims exitCode $claimed, yet the result claims overallPass true"
  fi

  # 124/137/143 are a KILL, not an exit: the command was still running when something stopped it —
  # `timeout`, SIGKILL, or the Bash tool's 10-minute ceiling. That says the gate is unrunnable as
  # written, not that the code under it fails, and re-running it here would hit the same wall.
  # Measured 2026-08-19 (mail-bridge): the same check returned 143 in two consecutive rounds, each
  # ~3h, and each was scored as a failing gate — so overallPass could never be true and the run
  # burned its rounds on a verdict that carried no information about the work.
  case "$claimed" in
    124|137|143)
      printf 'craft-result.sh: REFUSED — mechanical check "%s" reports exitCode %s, which is a kill (timeout/SIGKILL), not a result.\n' "$name" "$claimed" >&2
      printf '  The gate could not run to completion, so it says nothing about the code. Split it: the\n' >&2
      printf '  slow part runs detached and writes an artifact, and the check reads that artifact fast\n' >&2
      printf '  enough to be re-run here. A gate this shell cannot re-run cannot be adjudicated.\n' >&2
      printf '  cmd: %s\n' "$cmd" >&2
      exit 2 ;;
  esac

  # -1 is the fail-closed sentinel ../workflow.js writes for a probe that died or was skipped: NO
  # claim was made, so there is nothing to re-run against. Structurally unadjudicable, and a
  # legitimate FAIL carried by overallPass — refusing here would lose a verdict the gate got right.
  if [ "$claimed" = -1 ]; then continue; fi

  # stdin from /dev/null: the loop is fed by the process substitution below, and a cmd that reads
  # stdin would otherwise eat the remaining checks and end the loop early — a silent skip.
  if out=$( (cd "$CWD" && eval "$cmd") </dev/null 2>&1 ); then observed=0; else observed=$?; fi
  if [ "$observed" != "$claimed" ]; then
    # The two directions of this disagreement mean opposite things, and reporting them
    # identically is how a flake reads as a lie and stalls the workflow. Measured
    # 2026-08-20 (mail-bridge): a probe reported the aggregate gate exiting 1 after
    # timing-sensitive tests blew a 5s budget under concurrent load; this re-run exited 0.
    # That refusal blocked human review as though the gate could not be trusted, when what
    # actually happened is that the FAILURE could not be reproduced.
    #
    # Both still exit 2. Passing a non-reproducing failure would wave a genuinely flaky
    # gate straight through, which is the opposite lesson.
    case "$claimed/$observed" in
      0/*) direction='the claimed PASS does not reproduce — the probe reported success this shell cannot observe. Treat the result as untrusted: this is the case the adjudicator exists for.' ;;
      */0) direction='the claimed FAILURE does not reproduce — this shell ran the same command and it PASSED. That is a probe-side flake, not a verdict about the code; a check that is load-sensitive (a default test timeout, a wall-clock budget) fails this way while craft runs agents concurrently. RE-RUN the gate, do not re-plan or dispatch another round on it.' ;;
      *)   direction='both runs failed, with different exit codes — the check is not deterministic.' ;;
    esac
    {
      printf 'craft-result.sh: REFUSED — mechanical check "%s" claims exitCode %s, the shell observed %s\n' \
        "$name" "$claimed" "$observed"
      printf '  %s\n' "$direction"
      printf '  cmd: %s\n  cwd: %s\n  last output:\n' "$cmd" "$CWD"
      printf '%s\n' "$out" | tail -n 20 | sed 's/^/    /'
    } >&2
    exit 2
  fi
done < <(jq -r '(.mechanicalChecks // [])[] | "\(.name | @base64) \(.cmd | @base64)"' -- "$ARGS")

printf '%s' "$RESULT" | jq -r '
  "verdict: \(.verdict)  (overallPass=\(.overallPass))",
  "score table:",
  (.scoreTable | to_entries[] | "  \(.key): \(.value)")
'

# The verdict, carried by the exit code rather than left in a field a caller has to read.
[ "$OVERALL" = true ] || exit 1
