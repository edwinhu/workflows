#!/usr/bin/env bash
# Poll Paperpile API until a PDF attachment appears for a given item.
# Usage: poll_attachment.sh <item_id> [--timeout N]
#
# Exit 0 + prints gdrive_id if attachment found
# Exit 1 on timeout or error

set -euo pipefail

ITEM_ID="${1:?Usage: poll_attachment.sh <item_id> [--timeout N]}"
TIMEOUT=90
INTERVAL=5

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

CACHE="$HOME/.claude-work/skills/librarian-fetch/cache/paperpile-index.json"
DEADLINE=$((SECONDS + TIMEOUT))

while [[ $SECONDS -lt $DEADLINE ]]; do
  # Refresh the index
  paperpile index --refresh > /dev/null 2>&1 || true

  # Check for matching attachment
  GDRIVE_ID=$(python3 -c "
import json, sys
with open('$CACHE') as f:
    d = json.load(f)
for att in d.get('attachments', []):
    if att.get('pub_id') == '$ITEM_ID' and att.get('article_pdf') == 1 and att.get('gdrive_id'):
        print(att['gdrive_id'])
        sys.exit(0)
sys.exit(1)
" 2>/dev/null) && {
    echo "$GDRIVE_ID"
    exit 0
  }

  echo "Waiting for PDF attachment... ($((DEADLINE - SECONDS))s remaining)" >&2
  sleep "$INTERVAL"
done

echo "Timeout: no PDF attachment found for $ITEM_ID after ${TIMEOUT}s" >&2
exit 1
