#!/bin/bash
# Example: Extract information from a PDF document

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

# Example 1: Extract title and date
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/report.pdf" \
    --goal "Extract the document title and publication date"

# Example 2: Extract executive summary
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/report.pdf" \
    --goal "Extract the executive summary section"

# Example 3: Extract specific data points
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/financial_report.pdf" \
    --goal "Extract the revenue, profit, and employee count figures"

# Example 4: Extract table as structured data
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/data_table.pdf" \
    --goal "Extract the table data as JSON with columns: name, value, date"
