#!/usr/bin/env bash
# Build a production runbook PDF from its Markdown source.
#
#   build-runbook.sh --source RUNBOOK.md --out RUNBOOK.pdf [--date YYYY-MM-DD] [--width N]
#
# wrap_commands.py breaks every ```command fence to N columns (default 80) before flags; pandoc
# renders through assets/runbook.typ; typst compiles with only its embedded fonts, stamped with
# --date (default today, UTC) at 00:00 UTC; scrub_metadata.py strips everything but the two dates.
# Image paths resolve against the source's directory.
#
# Exit 0 built; 1 a step failed; 2 usage.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
template="$here/../assets/runbook.typ"

usage() {
  sed -n '4p' "${BASH_SOURCE[0]}" | sed 's/^#   /usage: /' >&2
  [ -n "${1:-}" ] && echo "build-runbook.sh: $1" >&2
  exit 2
}

source_md="" out="" date="" width=80
while [ $# -gt 0 ]; do
  case "$1" in
    --source) [ $# -ge 2 ] || usage "--source needs a value"; source_md=$2; shift 2 ;;
    --out) [ $# -ge 2 ] || usage "--out needs a value"; out=$2; shift 2 ;;
    --date) [ $# -ge 2 ] || usage "--date needs a value"; date=$2; shift 2 ;;
    --width) [ $# -ge 2 ] || usage "--width needs a value"; width=$2; shift 2 ;;
    -h|--help) sed -n "4p" "${BASH_SOURCE[0]}" | sed "s/^#   /usage: /"; exit 0 ;;
    *) usage "unknown argument: $1" ;;
  esac
done
[ -n "$source_md" ] || usage "missing --source"
[ -n "$out" ] || usage "missing --out"
[ -f "$source_md" ] || usage "no such file: $source_md"
[[ "$width" =~ ^[0-9]+$ ]] && [ "$width" -ge 20 ] && [ "$width" -le 90 ] \
  || usage "--width must be an integer from 20 to 90 (the template fits 90 columns)"
[ -n "$date" ] || date=$(date -u +%Y-%m-%d)
[[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || usage "--date must be YYYY-MM-DD: $date"
epoch=$(python3 -I -c '
import sys
from datetime import date, datetime, timezone
d = date.fromisoformat(sys.argv[1])
print(int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()))
' "$date" 2>/dev/null) || usage "--date must be YYYY-MM-DD: $date"

for tool in pandoc typst uv; do
  command -v "$tool" >/dev/null || { echo "build-runbook.sh: $tool not found on PATH" >&2; exit 1; }
done

tmp=$(mktemp -d "${TMPDIR:-/tmp}/build-runbook.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
src_dir=$(cd "$(dirname "$source_md")" && pwd)

python3 -I "$here/wrap_commands.py" --width "$width" "$source_md" > "$tmp/wrapped.md"
pandoc -f markdown -t typst --template "$template" -o "$tmp/runbook.typ" "$tmp/wrapped.md"
# Compiled from stdin so relative image paths resolve against --root, the source's directory.
typst compile --ignore-system-fonts --root "$src_dir" --creation-timestamp "$epoch" \
  - "$tmp/runbook.pdf" < "$tmp/runbook.typ"
uv run --quiet "$here/scrub_metadata.py" "$tmp/runbook.pdf" > /dev/null

mkdir -p "$(dirname "$out")"
mv -f "$tmp/runbook.pdf" "$out"
echo "build-runbook.sh: wrote $out (dated $date)"
