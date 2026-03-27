#!/bin/bash
# Check for slide overflow in workshop presentations.
#
# Creates a temporary validation wrapper that imports the slides with
# handout mode + validation rules, then queries for metadata and pipes
# to overflow.py for detection.
#
# Usage: check-overflow.sh <slides.typ>
#
# Requires: typst CLI, python3
# Exit codes: 0 = no overflow, 1 = overflow detected, 2 = error

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATION_TYP="$SCRIPT_DIR/../validation.typ"

if [ -z "$1" ]; then
  echo "Usage: $0 <slides.typ>"
  exit 2
fi

SLIDES_FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [ ! -f "$SLIDES_FILE" ]; then
  echo "Error: Slides file not found: $SLIDES_FILE"
  exit 2
fi

if [ ! -f "$VALIDATION_TYP" ]; then
  echo "Error: validation.typ not found at $VALIDATION_TYP"
  exit 2
fi

SLIDES_DIR=$(dirname "$SLIDES_FILE")
SLIDES_BASE=$(basename "$SLIDES_FILE")

# Copy validation.typ next to slides (Typst requires relative imports)
VAL_COPY="$SLIDES_DIR/.validation-tmp.typ"
WRAPPER="$SLIDES_DIR/.overflow-check-tmp.typ"
WRAPPER_PDF="$SLIDES_DIR/.overflow-check-tmp.pdf"
PRES_WRAPPER="$SLIDES_DIR/.overflow-check-pres-tmp.typ"
PRES_PDF="$SLIDES_DIR/.overflow-check-pres-tmp.pdf"

cleanup() {
  rm -f "$VAL_COPY" "$WRAPPER" "$WRAPPER_PDF" "$PRES_WRAPPER" "$PRES_PDF"
}
trap cleanup EXIT

cp "$VALIDATION_TYP" "$VAL_COPY"

# Handout wrapper: validation-rules + include slides
cat > "$WRAPPER" << 'TYPST_EOF'
#import ".validation-tmp.typ": validation-rules
#show: validation-rules
TYPST_EOF
echo "#include \"${SLIDES_BASE}\"" >> "$WRAPPER"

# Compile in handout mode
if ! typst compile "$WRAPPER" --input handout=true "$WRAPPER_PDF" 2>/dev/null; then
  echo "Error: Failed to compile overflow check wrapper"
  echo "Tip: Ensure slides.typ compiles normally first"
  # Show the actual error
  typst compile "$WRAPPER" --input handout=true "$WRAPPER_PDF" 2>&1 || true
  exit 2
fi

# Query metadata
HANDOUT_JSON=$(typst query "$WRAPPER" '<val>' --field value --input handout=true --root "$SLIDES_DIR" 2>/dev/null)

if [ -z "$HANDOUT_JSON" ]; then
  echo "Warning: No validation metadata found"
  exit 0
fi

# Presentation mode (optional — gives sub-slide overflow detection)
PRES_JSON=""
cat > "$PRES_WRAPPER" << 'TYPST_EOF2'
#import ".validation-tmp.typ": pres-validation-rules
#show: pres-validation-rules
TYPST_EOF2
echo "#include \"${SLIDES_BASE}\"" >> "$PRES_WRAPPER"

if typst compile "$PRES_WRAPPER" "$PRES_PDF" 2>/dev/null; then
  PRES_JSON=$(typst query "$PRES_WRAPPER" '<val>' --field value --root "$SLIDES_DIR" 2>/dev/null || echo "")
fi

# Pipe to overflow.py
if [ -n "$PRES_JSON" ]; then
  echo "{\"handout\": $HANDOUT_JSON, \"presentation\": $PRES_JSON}" | python3 "$SCRIPT_DIR/overflow.py"
else
  echo "$HANDOUT_JSON" | python3 "$SCRIPT_DIR/overflow.py"
fi
