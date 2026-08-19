#!/bin/bash
# Example: Describe and analyze images

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

# Example 1: Describe UI elements
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/screenshot.png" \
    --goal "List all UI elements and their positions in the layout"

# Example 2: Analyze diagram
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/architecture_diagram.png" \
    --goal "Explain the component relationships and data flow shown in the diagram"

# Example 3: Extract text from image
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/whiteboard.jpg" \
    --goal "Extract all text visible in this image"

# Example 4: Describe chart
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/chart.png" \
    --goal "Describe the chart type, axes, and key trends shown"
