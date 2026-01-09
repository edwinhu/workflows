#!/bin/bash
# Example: Extract information from a PDF document

SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts"

# Example 1: Extract title and date
python3 "${SCRIPT_DIR}/look_at.py" \
    --file "/path/to/report.pdf" \
    --goal "Extract the document title and publication date"

# Example 2: Extract executive summary
python3 "${SCRIPT_DIR}/look_at.py" \
    --file "/path/to/report.pdf" \
    --goal "Extract the executive summary section"

# Example 3: Extract specific data points
python3 "${SCRIPT_DIR}/look_at.py" \
    --file "/path/to/financial_report.pdf" \
    --goal "Extract the revenue, profit, and employee count figures"

# Example 4: Extract table as structured data
python3 "${SCRIPT_DIR}/look_at.py" \
    --file "/path/to/data_table.pdf" \
    --goal "Extract the table data as JSON with columns: name, value, date"
