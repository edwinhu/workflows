#!/usr/bin/env python3
"""
Data Quality Checker Hook

Warns on common data quality anti-patterns:
- DataFrame created without .head() or .info() call
- No null check (df.isnull().sum())
- No duplicate check (df.duplicated())
- Missing .describe() for numeric data
"""

import json
import re
import sys


def get_hook_input():
    """Read hook input from stdin."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def check_data_quality_patterns(content: str, tool_name: str) -> list[str]:
    """Check for data quality anti-patterns in code."""
    warnings = []

    # Patterns indicating DataFrame creation/loading
    df_creation_patterns = [
        r'pd\.read_csv',
        r'pd\.read_excel',
        r'pd\.read_json',
        r'pd\.read_parquet',
        r'pd\.read_sql',
        r'pd\.read_table',
        r'pd\.DataFrame\s*\(',
        r'\.merge\s*\(',
        r'\.join\s*\(',
        r'\.concat\s*\(',
    ]

    # Data inspection patterns
    inspection_patterns = [
        r'\.head\s*\(',
        r'\.tail\s*\(',
        r'\.info\s*\(',
        r'\.shape',
        r'\.dtypes',
        r'\.columns',
        r'display\s*\(',
    ]

    # Null check patterns
    null_check_patterns = [
        r'\.isnull\s*\(',
        r'\.isna\s*\(',
        r'\.notna\s*\(',
        r'\.notnull\s*\(',
        r'\.dropna\s*\(',
        r'\.fillna\s*\(',
        r'missing',
    ]

    # Duplicate check patterns
    duplicate_check_patterns = [
        r'\.duplicated\s*\(',
        r'\.drop_duplicates\s*\(',
        r'\.nunique\s*\(',
        r'\.unique\s*\(',
    ]

    # Descriptive statistics patterns
    describe_patterns = [
        r'\.describe\s*\(',
        r'\.mean\s*\(',
        r'\.std\s*\(',
        r'\.median\s*\(',
        r'\.min\s*\(',
        r'\.max\s*\(',
        r'\.quantile\s*\(',
        r'\.value_counts\s*\(',
    ]

    # Check if DataFrame is being created
    has_df_creation = any(
        re.search(pattern, content)
        for pattern in df_creation_patterns
    )

    if not has_df_creation:
        # No DataFrame operations, nothing to check
        return warnings

    # Check for inspection
    has_inspection = any(
        re.search(pattern, content)
        for pattern in inspection_patterns
    )

    # Check for null handling
    has_null_check = any(
        re.search(pattern, content, re.IGNORECASE)
        for pattern in null_check_patterns
    )

    # Check for duplicate handling
    has_duplicate_check = any(
        re.search(pattern, content)
        for pattern in duplicate_check_patterns
    )

    # Check for descriptive statistics
    has_describe = any(
        re.search(pattern, content)
        for pattern in describe_patterns
    )

    # Generate warnings
    if not has_inspection:
        warnings.append(
            "DataFrame created without inspection. "
            "Consider adding .head(), .info(), or .shape to verify data."
        )

    if not has_null_check:
        warnings.append(
            "No null value check detected. "
            "Consider using df.isnull().sum() to check for missing data."
        )

    if not has_duplicate_check:
        warnings.append(
            "No duplicate check detected. "
            "Consider using df.duplicated().sum() to check for duplicates."
        )

    if not has_describe:
        warnings.append(
            "No descriptive statistics found. "
            "Consider using df.describe() for numeric column summaries."
        )

    return warnings


def main():
    hook_input = get_hook_input()

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Get content based on tool type
    if tool_name == "Bash":
        content = tool_input.get("command", "")
    elif tool_name == "Write":
        content = tool_input.get("content", "")
    else:
        content = ""

    if not content:
        result = {"decision": "approve"}
        print(json.dumps(result))
        return

    # Only check Python-related content
    is_python_content = (
        "python" in content.lower() or
        "pd." in content or
        "pandas" in content or
        "DataFrame" in content or
        tool_input.get("file_path", "").endswith(".py") or
        tool_input.get("file_path", "").endswith(".ipynb")
    )

    if not is_python_content:
        result = {"decision": "approve"}
        print(json.dumps(result))
        return

    warnings = check_data_quality_patterns(content, tool_name)

    if warnings:
        # Return warnings but don't block - just inform
        result = {
            "decision": "approve",
            "reason": " | ".join(warnings)
        }
    else:
        result = {"decision": "approve"}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
