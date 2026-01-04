#!/usr/bin/env python3
"""Validate JSONL files for Gemini Batch API submission.

Usage:
    python validate_jsonl.py <path_to_jsonl_file>

Exit codes:
    0 - Valid JSONL
    1 - Validation errors found
"""

import json
import sys
from pathlib import Path


def validate_jsonl(path: str) -> tuple[bool, list[str]]:
    """Validate JSONL file format for Gemini Batch API.

    Checks:
    - Valid JSON on each line
    - Required 'request' field present
    - Required 'contents' field in request
    - Role field set to 'user'
    - File URIs use gs:// protocol
    - Request IDs are unique
    - No empty lines

    Args:
        path: Path to JSONL file

    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []
    warnings = []
    request_ids = set()

    with open(path, 'r') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()

            # Check for empty lines
            if not line:
                warnings.append(f"Line {i}: Empty line (will be skipped)")
                continue

            # Parse JSON
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"Line {i}: Invalid JSON - {e}")
                continue

            # Check required 'request' field
            if "request" not in data:
                errors.append(f"Line {i}: Missing 'request' key")
                continue

            request = data["request"]

            # Check required 'contents' field
            if "contents" not in request:
                errors.append(f"Line {i}: Missing 'contents' in request")
                continue

            contents = request.get("contents", [])

            # Check role field
            if not contents:
                errors.append(f"Line {i}: Empty contents array")
            elif contents[0].get("role") != "user":
                errors.append(f"Line {i}: First content must have role='user'")

            # Check file URI format
            parts = contents[0].get("parts", []) if contents else []
            for part in parts:
                if "fileData" in part:
                    uri = part["fileData"].get("fileUri", "")
                    if not uri.startswith("gs://"):
                        errors.append(f"Line {i}: fileUri must start with 'gs://' (got: {uri[:50]}...)")

            # Check request ID uniqueness
            request_id = data.get("metadata", {}).get("request_id")
            if request_id:
                if request_id in request_ids:
                    errors.append(f"Line {i}: Duplicate request_id '{request_id}'")
                request_ids.add(request_id)
            else:
                warnings.append(f"Line {i}: Missing request_id in metadata")

    # Print warnings
    for warning in warnings:
        print(f"WARNING: {warning}")

    return len(errors) == 0, errors


def main():
    """Main entry point."""
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path_to_jsonl_file>")
        sys.exit(1)

    path = sys.argv[1]

    if not Path(path).exists():
        print(f"Error: File not found: {path}")
        sys.exit(1)

    print(f"Validating: {path}")
    print("-" * 50)

    is_valid, errors = validate_jsonl(path)

    if is_valid:
        # Count lines
        with open(path, 'r') as f:
            line_count = sum(1 for line in f if line.strip())
        print(f"\nValid JSONL with {line_count} requests")
        sys.exit(0)
    else:
        print(f"\nValidation failed with {len(errors)} error(s):")
        for error in errors:
            print(f"  ERROR: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
