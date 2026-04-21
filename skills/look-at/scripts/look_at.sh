#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<EOF
Usage: look_at.sh --file <path> --goal <prompt> [OPTIONS]

Send an image to a vision model for evaluation.

Required:
  --file, -f       Path to image file
  --goal, -g       Vision prompt / goal text

Options:
  --backend, -b    Vision backend: gemini (default), copilot, api
  --consensus      Run gemini + copilot in parallel, output both results
  --model, -m      Override model (only for api backend)
  --agentic, -a    Enable agentic mode (only for api backend)
  --verbose, -v    Debug output to stderr
  -h, --help       Show this help

Backends:
  gemini   Gemini CLI (default, uses bundled quota)
  copilot  GitHub Copilot CLI with GPT-5.4
  api      Legacy Python API via google-genai SDK (uses your API key)
EOF
  exit "${1:-0}"
}

FILE="" GOAL="" BACKEND="gemini" CONSENSUS=false MODEL="" AGENTIC=false VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file|-f)      FILE="$2"; shift 2 ;;
    --goal|-g)      GOAL="$2"; shift 2 ;;
    --backend|-b)   BACKEND="$2"; shift 2 ;;
    --consensus)    CONSENSUS=true; shift ;;
    --model|-m)     MODEL="$2"; shift 2 ;;
    --agentic|-a)   AGENTIC=true; shift ;;
    --verbose|-v)   VERBOSE=true; shift ;;
    -h|--help)      usage 0 ;;
    *) echo "Error: unknown option: $1" >&2; usage 1 ;;
  esac
done

[[ -z "$FILE" ]] && { echo "Error: --file is required" >&2; usage 1; }
[[ -z "$GOAL" ]] && { echo "Error: --goal is required" >&2; usage 1; }
[[ -f "$FILE" ]] || { echo "Error: file not found: $FILE" >&2; exit 1; }

FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"
IMAGE_DIR="$(dirname "$FILE")"
FULL_PROMPT="Read the image at $FILE. $GOAL"

run_gemini() {
  if $VERBOSE; then echo "[look-at] backend=gemini" >&2; fi
  gemini -y --include-directories "$IMAGE_DIR" -p "$FULL_PROMPT"
}

run_copilot() {
  if $VERBOSE; then echo "[look-at] backend=copilot model=gpt-5.4" >&2; fi
  copilot --model gpt-5.4 --allow-all-tools --add-dir "$IMAGE_DIR" -p "$FULL_PROMPT"
}

run_api() {
  if $VERBOSE; then echo "[look-at] backend=api" >&2; fi
  local args=(--file "$FILE" --goal "$GOAL")
  [[ -n "$MODEL" ]] && args+=(--model "$MODEL")
  $AGENTIC && args+=(--agentic)
  $VERBOSE && args+=(--verbose)
  uv run python3 "$SCRIPT_DIR/look_at.py" "${args[@]}"
}

if $CONSENSUS; then
  GEMINI_OUT=$(mktemp) COPILOT_OUT=$(mktemp)
  trap 'rm -f "$GEMINI_OUT" "$COPILOT_OUT"' EXIT

  if $VERBOSE; then echo "[look-at] consensus mode: running gemini + copilot in parallel" >&2; fi

  run_gemini >"$GEMINI_OUT" 2>&1 &
  PID_G=$!
  run_copilot >"$COPILOT_OUT" 2>&1 &
  PID_C=$!

  FAIL=""
  wait "$PID_G" || FAIL="gemini"
  wait "$PID_C" || FAIL="${FAIL:+$FAIL+}copilot"

  echo "=== GEMINI ==="
  if [[ "$FAIL" == *gemini* ]]; then
    echo "[ERROR] Gemini backend failed"
  else
    cat "$GEMINI_OUT"
  fi

  echo ""
  echo "=== COPILOT (GPT-5.4) ==="
  if [[ "$FAIL" == *copilot* ]]; then
    echo "[ERROR] Copilot backend failed"
  else
    cat "$COPILOT_OUT"
  fi
  exit 0
fi

case "$BACKEND" in
  gemini)  run_gemini ;;
  copilot) run_copilot ;;
  api)     run_api ;;
  *) echo "Error: unknown backend '$BACKEND' (use gemini, copilot, or api)" >&2; exit 1 ;;
esac
