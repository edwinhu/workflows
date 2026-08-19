#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: look_at.sh --file <path> --goal <prompt> [OPTIONS]

Send an image or document to a vision model for evaluation.

Required:
  --file, -f       Path to image/PDF file
  --goal, -g       Vision prompt / goal text

Options:
  --backend, -b    Vision backend: claude (default), agy, codex, copilot, api
  --consensus [L]  Run several backends in parallel and label each result.
                   L is a comma-separated list; default is all four CLI backends.
  --model, -m      Override model (claude and api backends)
  --agentic, -a    Enable agentic mode (only for api backend)
  --verbose, -v    Debug output to stderr
  -h, --help       Show this help

Backends:
  claude   claude-code -p (CLIProxyAPI wrapper over the pooled Claude OAuth
           accounts, NOT plain `claude`). Reads images and PDFs natively.
  agy      agy -p (Antigravity CLI). PDFs are rasterized first.
  codex    codex exec (attaches the image with -i, no read tool needed).
           PDFs are rasterized and every page attached.
  copilot  GitHub Copilot CLI (GPT-5.4). PDFs are rasterized first.
  api      Python google-genai SDK. METERED — spends GOOGLE_API_KEY. Opt-in only,
           for agentic mode. Never a default and never in --consensus.
EOF
  exit "${1:-0}"
}

FILE="" GOAL="" BACKEND="claude" CONSENSUS=false CONSENSUS_LIST="claude,agy,codex,copilot"
MODEL="" AGENTIC=false VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file|-f)      FILE="$2"; shift 2 ;;
    --goal|-g)      GOAL="$2"; shift 2 ;;
    --backend|-b)   BACKEND="$2"; shift 2 ;;
    --consensus)
      CONSENSUS=true; shift
      # Optional argument: consume the next token only if it is not a flag.
      if [[ $# -gt 0 && "$1" != -* ]]; then CONSENSUS_LIST="$1"; shift; fi ;;
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
FULL_PROMPT="Read the file at $FILE. $GOAL"

# Rasterize a PDF to page PNGs for backends that cannot ingest PDFs. Echoes the
# temp directory; the caller owns removing it.
rasterize_pdf() {
  local tmpdir pages
  command -v pdftoppm >/dev/null 2>&1 || {
    echo "Error: pdftoppm (poppler-utils) is required to send a PDF to this backend." >&2
    echo "Use --backend claude, which reads PDFs natively." >&2
    return 1
  }
  tmpdir="$(mktemp -d)"
  pdftoppm -r 200 -png "$FILE" "$tmpdir/page" >/dev/null 2>&1 || {
    rm -rf "$tmpdir"; echo "Error: failed to rasterize PDF." >&2; return 1
  }
  pages=("$tmpdir"/page*.png)
  [[ -e "${pages[0]}" ]] || { rm -rf "$tmpdir"; echo "Error: PDF produced no pages." >&2; return 1; }
  printf '%s' "$tmpdir"
}

run_claude() {
  if $VERBOSE; then echo "[look-at] backend=claude${MODEL:+ model=$MODEL}" >&2; fi
  local args=(-p "$FULL_PROMPT" --allowed-tools Read --add-dir "$IMAGE_DIR")
  [[ -n "$MODEL" ]] && args+=(--model "$MODEL")
  # claude-code, not claude: it routes through CLIProxyAPI to the pooled OAuth
  # accounts and defaults to claude-opus-5[1m]. Plain `claude` bills this
  # session's own account, which is the cost this backend exists to avoid.
  #
  # LOOK_AT_NESTED tells image-read-guard.ts to stand down inside this child.
  # Without it the guard denies the child's Read and points it back at this
  # script, which spawns another child: unbounded recursion, not a slow call.
  LOOK_AT_NESTED=1 claude-code "${args[@]}"
}

run_copilot() {
  if $VERBOSE; then echo "[look-at] backend=copilot model=gpt-5.4" >&2; fi
  local dir="$IMAGE_DIR" prompt="$FULL_PROMPT" tmpdir="" pages=()
  if [[ "${FILE,,}" == *.pdf ]]; then
    tmpdir="$(rasterize_pdf)" || return 1
    # shellcheck disable=SC2064
    trap "rm -rf '$tmpdir'" RETURN
    pages=("$tmpdir"/page*.png)
    dir="$tmpdir"
    prompt="The document has been rendered to ${#pages[@]} page image(s): ${pages[*]}. Read them all. $GOAL"
  fi
  LOOK_AT_NESTED=1 copilot --model gpt-5.4 --allow-all-tools --add-dir "$dir" -p "$prompt"
}

run_agy() {
  if $VERBOSE; then echo "[look-at] backend=agy${MODEL:+ model=$MODEL}" >&2; fi
  local dir="$IMAGE_DIR" prompt="$FULL_PROMPT" tmpdir="" pages=()
  if [[ "${FILE,,}" == *.pdf ]]; then
    tmpdir="$(rasterize_pdf)" || return 1
    # shellcheck disable=SC2064
    trap "rm -rf '$tmpdir'" RETURN
    pages=("$tmpdir"/page*.png)
    dir="$tmpdir"
    prompt="The document has been rendered to ${#pages[@]} page image(s): ${pages[*]}. Read them all. $GOAL"
  fi
  local args=(-p "$prompt" --add-dir "$dir" --dangerously-skip-permissions)
  [[ -n "$MODEL" ]] && args+=(--model "$MODEL")
  LOOK_AT_NESTED=1 agy "${args[@]}"
}

run_codex() {
  if $VERBOSE; then echo "[look-at] backend=codex${MODEL:+ model=$MODEL}" >&2; fi
  # codex attaches images directly with -i, so it never needs a read tool --
  # and never trips image-read-guard. `-p` here would mean --profile, not print;
  # the non-interactive entry point is the `exec` subcommand.
  local dir="$IMAGE_DIR" images=("$FILE") tmpdir=""
  if [[ "${FILE,,}" == *.pdf ]]; then
    tmpdir="$(rasterize_pdf)" || return 1
    # shellcheck disable=SC2064
    trap "rm -rf '$tmpdir'" RETURN
    images=("$tmpdir"/page*.png)
    dir="$tmpdir"
  fi
  local args=(exec -s read-only --skip-git-repo-check -C "$dir")
  for img in "${images[@]}"; do args+=(-i "$img"); done
  [[ -n "$MODEL" ]] && args+=(-m "$MODEL")
  # `--` is load-bearing: `-i/--image` is variadic, so a bare trailing prompt is
  # swallowed as another image path and codex then blocks reading stdin.
  args+=(-- "$GOAL")
  LOOK_AT_NESTED=1 codex "${args[@]}" < /dev/null
}

run_api() {
  if $VERBOSE; then echo "[look-at] backend=api (METERED)" >&2; fi
  local args=(--file "$FILE" --goal "$GOAL")
  [[ -n "$MODEL" ]] && args+=(--model "$MODEL")
  $AGENTIC && args+=(--agentic)
  $VERBOSE && args+=(--verbose)
  # --script honors look_at.py's inline PEP 723 metadata, so uv provisions
  # google-genai into an ephemeral env instead of relying on the ambient python.
  uv run --script "$SCRIPT_DIR/look_at.py" "${args[@]}"
}

run_backend() {
  case "$1" in
    claude)  run_claude ;;
    agy)     run_agy ;;
    codex)   run_codex ;;
    copilot) run_copilot ;;
    api)     run_api ;;
    *) echo "Error: unknown backend '$1' (use claude, agy, codex, copilot, or api)" >&2; return 1 ;;
  esac
}

label_for() {
  case "$1" in
    claude)  echo "CLAUDE (claude-code)" ;;
    agy)     echo "AGY (Antigravity)" ;;
    codex)   echo "CODEX" ;;
    copilot) echo "COPILOT (GPT-5.4)" ;;
    api)     echo "GEMINI API" ;;
    *)       echo "${1^^}" ;;
  esac
}

if $CONSENSUS; then
  IFS=',' read -r -a BACKENDS <<<"$CONSENSUS_LIST"
  [[ ${#BACKENDS[@]} -ge 2 ]] || { echo "Error: --consensus needs at least two backends" >&2; exit 1; }
  if $VERBOSE; then echo "[look-at] consensus: ${BACKENDS[*]}" >&2; fi

  outs=() pids=()
  for b in "${BACKENDS[@]}"; do
    out="$(mktemp)"; outs+=("$out")
    run_backend "$b" >"$out" 2>&1 &
    pids+=($!)
  done
  # shellcheck disable=SC2064
  trap "rm -f ${outs[*]}" EXIT

  status=()
  for pid in "${pids[@]}"; do
    if wait "$pid"; then status+=(ok); else status+=(fail); fi
  done

  for i in "${!BACKENDS[@]}"; do
    [[ $i -eq 0 ]] || echo ""
    echo "=== $(label_for "${BACKENDS[$i]}") ==="
    if [[ "${status[$i]}" == fail ]]; then
      echo "[ERROR] ${BACKENDS[$i]} backend failed"
      cat "${outs[$i]}"
    else
      cat "${outs[$i]}"
    fi
  done
  exit 0
fi

run_backend "$BACKEND"
