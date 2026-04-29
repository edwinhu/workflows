#!/usr/bin/env bash
# Refresh UVA EZproxy session by hitting a proxied URL via Dia CDP.
# Cron this every 25 min to defeat the 30-min idle timeout.

set -euo pipefail

if ! curl -sf --connect-timeout 2 http://localhost:9222/json/version >/dev/null; then
  echo "[warmup] Dia CDP not on :9222" >&2
  exit 1
fi

uv run --quiet "$(dirname "$0")/resolve_pdf.py" --login-only 2>&1 | sed 's/^/[warmup] /'
