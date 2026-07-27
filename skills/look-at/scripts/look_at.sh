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

# Resolve a Gemini API key from the usual places, in priority order.
# Echoes the key, or nothing if none is available.
resolve_gemini_key() {
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    printf '%s' "$GEMINI_API_KEY"
  elif [[ -n "${GOOGLE_API_KEY:-}" ]]; then
    printf '%s' "$GOOGLE_API_KEY"
  elif [[ -n "${GEMINI_API_KEY_FILE:-}" && -r "${GEMINI_API_KEY_FILE}" ]]; then
    tr -d '\n' < "$GEMINI_API_KEY_FILE"
  fi
}

run_gemini() {
  if $VERBOSE; then echo "[look-at] backend=gemini" >&2; fi

  # gemini-cli picks its auth method from GEMINI_API_KEY specifically; it does
  # not accept GOOGLE_API_KEY as an auth *selector* (only as the key value once
  # a method is chosen). Bridge whatever key we have into that variable.
  local key
  key="$(resolve_gemini_key)"
  if [[ -z "$key" ]]; then
    echo "Error: no Gemini API key found. Set GEMINI_API_KEY, GOOGLE_API_KEY, or GEMINI_API_KEY_FILE." >&2
    return 1
  fi

  # gemini-cli cannot ingest PDFs -- it reliably dies with "Invalid stream: the
  # model returned an empty response or malformed tool call". Rasterize to PNG
  # first (poppler) and point it at those instead. The api backend needs no such
  # help: it uploads PDFs natively.
  local dir="$IMAGE_DIR" prompt="$FULL_PROMPT" tmpdir=""
  if [[ "${FILE,,}" == *.pdf ]]; then
    if command -v pdftoppm >/dev/null 2>&1; then
      tmpdir="$(mktemp -d)"
      # shellcheck disable=SC2064
      trap "rm -rf '$tmpdir'" RETURN
      if $VERBOSE; then echo "[look-at] rasterizing PDF -> PNG for gemini backend" >&2; fi
      pdftoppm -r 200 -png "$FILE" "$tmpdir/page" >/dev/null 2>&1 || {
        echo "Error: failed to rasterize PDF for the gemini backend." >&2
        return 1
      }
      local pages=("$tmpdir"/page*.png)
      [[ -e "${pages[0]}" ]] || { echo "Error: PDF produced no pages." >&2; return 1; }
      dir="$tmpdir"
      prompt="The document has been rendered to ${#pages[@]} page image(s): ${pages[*]}. Read them all. $GOAL"
    else
      echo "Warning: pdftoppm not found; the gemini backend cannot read PDFs." >&2
      echo "Install poppler-utils, or use --backend api (handles PDFs natively)." >&2
      return 1
    fi
  fi

  # Non-interactive runs can't answer the trusted-folder prompt, which otherwise
  # aborts the call in any directory the user hasn't trusted interactively.
  GEMINI_API_KEY="$key" GEMINI_CLI_TRUST_WORKSPACE=true \
    gemini -y --include-directories "$dir" -p "$prompt"
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
  # --script honors look_at.py's inline PEP 723 metadata, so uv provisions
  # google-genai into an ephemeral env instead of relying on the ambient python.
  uv run --script "$SCRIPT_DIR/look_at.py" "${args[@]}"
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
