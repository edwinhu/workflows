#!/bin/bash
# Example: Describe and analyze images

SCRIPT_DIR="../scripts"

# Example 1: Describe UI elements
uv run --script "${SCRIPT_DIR}/look_at.py" \
    --file "/path/to/screenshot.png" \
    --goal "List all UI elements and their positions in the layout"

# Example 2: Analyze diagram
uv run --script "${SCRIPT_DIR}/look_at.py" \
    --file "/path/to/architecture_diagram.png" \
    --goal "Explain the component relationships and data flow shown in the diagram"

# Example 3: Extract text from image
uv run --script "${SCRIPT_DIR}/look_at.py" \
    --file "/path/to/whiteboard.jpg" \
    --goal "Extract all text visible in this image"

# Example 4: Describe chart
uv run --script "${SCRIPT_DIR}/look_at.py" \
    --file "/path/to/chart.png" \
    --goal "Describe the chart type, axes, and key trends shown"
