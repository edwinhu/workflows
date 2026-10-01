#!/usr/bin/env -S uv run python3
"""Validate Developer or Cloud generateContent Batch JSONL without API calls.

Usage: python validate_jsonl.py requests.jsonl --backend developer|cloud
Exit codes: 0 valid, 1 invalid.
"""

import argparse
import json
from pathlib import Path


def validate_jsonl(path: str, backend: str = "cloud") -> tuple[bool, list[str]]:
    """Check request structure and backend-specific row IDs and media URIs."""
    if backend not in ("developer", "cloud"):
        raise ValueError(f"Unknown backend: {backend}")
    errors = []
    request_ids = set()
    with open(path) as source:
        for number, line in enumerate(source, 1):
            if not line.strip():
                errors.append(f"Line {number}: Empty line")
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append(f"Line {number}: Invalid JSON - {exc}")
                continue
            if not isinstance(data, dict) or not isinstance(data.get("request"), dict):
                errors.append(f"Line {number}: Missing 'request' object")
                continue
            contents = data["request"].get("contents")
            if not isinstance(contents, list) or not contents:
                errors.append(f"Line {number}: Missing or empty contents array")
                continue
            for content in contents:
                if not isinstance(content, dict) or not isinstance(content.get("parts"), list):
                    errors.append(f"Line {number}: Content requires parts array")
                    continue
                for part in content["parts"]:
                    if not isinstance(part, dict):
                        errors.append(f"Line {number}: Part must be an object")
                        continue
                    file_data = part.get("fileData", part.get("file_data"))
                    if file_data is not None:
                        uri = file_data.get("fileUri", file_data.get("file_uri", "")) if isinstance(file_data, dict) else ""
                        prefixes = ("gs://",) if backend == "cloud" else ("https://", "files/")
                        if not isinstance(uri, str) or not uri.startswith(prefixes):
                            errors.append(f"Line {number}: Invalid {backend} file URI: {uri}")
            if backend == "developer":
                request_id = data.get("key")
                if not isinstance(request_id, str) or not request_id:
                    errors.append(f"Line {number}: Missing nonempty key")
                    continue
            else:
                # GCS documents request echo, not Developer key passthrough.
                request_id = json.dumps(data["request"], sort_keys=True, separators=(",", ":"))
            if request_id in request_ids:
                errors.append(f"Line {number}: Duplicate request ID '{request_id}'")
            else:
                request_ids.add(request_id)
    return not errors, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--backend", choices=["developer", "cloud"], default="cloud")
    args = parser.parse_args()
    if not Path(args.path).is_file():
        parser.error(f"File not found: {args.path}")
    valid, errors = validate_jsonl(args.path, args.backend)
    for error in errors:
        print(f"ERROR: {error}")
    print("Valid JSONL" if valid else f"Validation failed: {len(errors)} error(s)")
    raise SystemExit(0 if valid else 1)


if __name__ == "__main__":
    main()
