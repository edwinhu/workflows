#!/bin/bash
# Example: Extract structured data from tables

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

# Example 1: Extract as JSON
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/data_table.pdf" \
    --goal "Extract the table as JSON array with fields: product, quantity, price, total"

# Example 2: Extract as CSV-formatted text
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/spreadsheet_screenshot.png" \
    --goal "Extract the table data as CSV format"

# Example 3: Extract specific columns
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/report.pdf" \
    --goal "Extract only the 'Date' and 'Amount' columns from the financial table"

# Example 4: Summarize table
"${SCRIPT_DIR}/look_at.sh" \
    --file "/path/to/complex_table.pdf" \
    --goal "Summarize the key statistics: total, average, min, max values"
