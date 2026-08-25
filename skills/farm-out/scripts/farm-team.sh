#!/usr/bin/env bash
# Team runner: named teammates that message each other, one result back.
# Teams are a CLI feature (not SDK-configurable), so this path uses `-p`.
set -euo pipefail

PROVIDER=claude PROMPT_FILE="" CWD="$PWD" TIMEOUT=900
EXPECT=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)    PROVIDER="$2"; shift 2 ;;
    --prompt-file) PROMPT_FILE="$2"; shift 2 ;;
    --cwd)         CWD="$2"; shift 2 ;;
    --expect)      EXPECT+=("$2"); shift 2 ;;
    --timeout)     TIMEOUT="$2"; shift 2 ;;
    *) printf 'unknown arg: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ -r "$PROMPT_FILE" ]] || { echo "need --prompt-file <readable file>" >&2; exit 2; }
[[ -d "$CWD" ]] || { echo "--cwd $CWD: not a directory" >&2; exit 2; }

case "$PROVIDER" in
  claude) WRAPPER=claude-code ;;
  codex)  WRAPPER=codex-code ;;
  gemini) WRAPPER=gemini-code ;;
  *) echo "unknown provider $PROVIDER" >&2; exit 2 ;;
esac

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
{
  cat "$PROMPT_FILE"
  cat <<'EOF'

You MUST actually spawn the teammates with real Agent tool calls and pass the
`name` parameter. Do not simulate, summarize, or claim any completion you did
not observe. Report the exact error text and stop if a spawn is rejected.
EOF
} > "$TMP/prompt.txt"

# Teams are off by default: without the env var the lead silently does not spawn anyone.
# No --permission-mode: the lead inherits the user's default (auto), so hard_deny still applies
# inside a team run. Watch for stalls -- a teammate permission prompt bubbles to a lead with no
# human attached, which is what bypassPermissions used to paper over.
# The lead runs in --cwd; the subshell keeps that move off the --expect checks below, which
# resolve against the CALLER's cwd. $TMP is absolute (mktemp -d), so the redirections are
# unaffected by the cd.
(
  cd "$CWD" || exit 1
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
  FARM_OUT_CHILD=1 \
    timeout "$TIMEOUT" "$WRAPPER" -p \
      --output-format stream-json --verbose \
      < "$TMP/prompt.txt" > "$TMP/stream.jsonl" 2>"$TMP/err"
) || true

python3 - "$TMP/stream.jsonl" <<'PY'
import json, sys
spawned, calls, result = [], 0, ""
for line in open(sys.argv[1]):
    try: d = json.loads(line)
    except Exception: continue
    for b in (d.get("message") or {}).get("content") or []:
        if isinstance(b, dict) and b.get("type") == "tool_use":
            calls += 1
            if b.get("name") in ("Agent", "Task"):
                spawned.append(b.get("input", {}).get("name") or "<unnamed>")
    if d.get("type") == "result":
        result = d.get("result") or result
print(json.dumps({"teammates": spawned, "toolCalls": calls, "result": result}, indent=2))
PY

# Rule 1: verify the artifact, never the summary.
rc=0
for f in "${EXPECT[@]}"; do
  if [[ -s "$f" ]]; then printf 'verified: %s\n' "$f"
  else printf 'UNVERIFIED: %s missing or empty\n' "$f" >&2; rc=1
  fi
done
[[ -s "$TMP/err" ]] && grep -v 'claude.ai connectors are disabled' "$TMP/err" >&2 || true
exit $rc
