#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["google-genai"]
# ///
"""Analyze media files using Gemini 2.5 Flash Lite for fast, cost-effective interpretation.

This script uploads a local file to Google's Gemini API and extracts specific information
based on the provided goal. It's designed to be used by Claude Code as a tool for analyzing
files that require interpretation beyond raw text.

Usage:
    uv run python3 look_at.py --file <path> --goal "<what to extract>" [--model <model_name>]

Examples:
    # Extract title from PDF
    uv run python3 look_at.py --file report.pdf --goal "Extract the title and date"

    # Describe diagram
    uv run python3 look_at.py --file diagram.png --goal "Explain the architecture shown"

    # Extract table data
    uv run python3 look_at.py --file data.pdf --goal "Extract the table as JSON"

Environment (checked in order):
    GOOGLE_API_KEY: Google API key for Gemini access.
    GEMINI_API_KEY: Alternative env var with the key value directly.
    GEMINI_API_KEY_FILE: Path to a file containing the key.
    Fallback: reads from $(getconf DARWIN_USER_TEMP_DIR)/agenix/gemini-api-key.
"""

from __future__ import annotations

import os
import subprocess
import sys
import argparse
from pathlib import Path

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: google-genai package not installed", file=sys.stderr)
    print("Run this script with `uv run --script look_at.py` so uv can", file=sys.stderr)
    print("provision the inline PEP 723 dependencies automatically.", file=sys.stderr)
    sys.exit(1)


def infer_mime_type(file_path: str) -> str:
    """Infer MIME type from file extension.

    Args:
        file_path: Path to the file

    Returns:
        MIME type string
    """
    ext = Path(file_path).suffix.lower()

    mime_types = {
        # Images
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/heic",
        ".heif": "image/heif",
        ".gif": "image/gif",

        # Videos
        ".mp4": "video/mp4",
        ".mpeg": "video/mpeg",
        ".mpg": "video/mpeg",
        ".mov": "video/mov",
        ".avi": "video/avi",
        ".flv": "video/x-flv",
        ".webm": "video/webm",
        ".wmv": "video/wmv",
        ".3gpp": "video/3gpp",
        ".3gp": "video/3gpp",

        # Audio
        ".wav": "audio/wav",
        ".mp3": "audio/mp3",
        ".aiff": "audio/aiff",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",

        # Documents
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".csv": "text/csv",
        ".md": "text/markdown",
        ".html": "text/html",
        ".htm": "text/html",
        ".json": "application/json",
        ".xml": "application/xml",
    }

    return mime_types.get(ext, "application/octet-stream")


def _resolve_api_key() -> str | None:
    """Resolve the Gemini/Google API key from multiple sources.

    Checks in order:
    1. GOOGLE_API_KEY env var
    2. GEMINI_API_KEY env var (direct value)
    3. GEMINI_API_KEY_FILE env var (path to file containing key)
    4. $(getconf DARWIN_USER_TEMP_DIR)/agenix/gemini-api-key (macOS agenix fallback)
    """
    # 1. GOOGLE_API_KEY
    key = os.environ.get("GOOGLE_API_KEY")
    if key:
        return key

    # 2. GEMINI_API_KEY
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key

    # 3. GEMINI_API_KEY_FILE
    key_file = os.environ.get("GEMINI_API_KEY_FILE")
    if key_file:
        try:
            return Path(key_file).read_text().strip()
        except (OSError, IOError):
            pass

    # 4. macOS agenix fallback
    try:
        tmp_dir = subprocess.check_output(
            ["getconf", "DARWIN_USER_TEMP_DIR"], text=True
        ).strip()
        agenix_path = Path(tmp_dir) / "agenix" / "gemini-api-key"
        if agenix_path.is_file():
            return agenix_path.read_text().strip()
    except (subprocess.SubprocessError, OSError):
        pass

    return None


def analyze_file(
    file_path: str,
    goal: str,
    model: str = "gemini-3.1-flash-lite-preview",
    agentic: bool = False,
    verbose: bool = False
) -> str:
    """Analyze a file using Gemini API and extract specific information.

    Args:
        file_path: Path to the local file to analyze
        goal: Specific information to extract from the file
        model: Gemini model to use (default: gemini-3.1-flash-lite-preview)
        agentic: Enable code execution for better visual reasoning (requires gemini-3-flash-preview)
        verbose: Whether to print debug information

    Returns:
        Extracted information as text

    Raises:
        ValueError: If API key is not set or file doesn't exist
        Exception: For API errors
    """
    # Validate inputs
    api_key = _resolve_api_key()
    if not api_key:
        raise ValueError(
            "No Gemini API key found. Set one of: GOOGLE_API_KEY, "
            "GEMINI_API_KEY, or GEMINI_API_KEY_FILE"
        )

    file_path = os.path.abspath(file_path)
    if not os.path.exists(file_path):
        raise ValueError(f"File not found: {file_path}")

    # Agentic mode requires gemini-3-flash-preview
    if agentic and model != "gemini-3-flash-preview":
        model = "gemini-3-flash-preview"

    # Configure client
    client = genai.Client(api_key=api_key)

    # Infer MIME type
    mime_type = infer_mime_type(file_path)

    if verbose:
        print(f"Analyzing file: {file_path}", file=sys.stderr)
        print(f"MIME type: {mime_type}", file=sys.stderr)
        print(f"Model: {model}", file=sys.stderr)
        print(f"Goal: {goal}", file=sys.stderr)
        print("-" * 50, file=sys.stderr)

    # Upload file to Gemini
    if verbose:
        print("Uploading file to Gemini API...", file=sys.stderr)

    with open(file_path, 'rb') as f:
        uploaded_file = client.files.upload(file=f, config={'mime_type': mime_type})

    if verbose:
        print(f"File uploaded: {uploaded_file.name}", file=sys.stderr)

    # Construct prompt
    prompt = f"""Analyze this file and extract the requested information.

Goal: {goal}

Provide ONLY the extracted information that matches the goal.
Be thorough on what was requested, concise on everything else.
If the requested information is not found, clearly state what is missing."""

    if verbose:
        print("Generating response...", file=sys.stderr)
        if agentic:
            print("Agentic mode enabled (code execution)", file=sys.stderr)

    try:
        # Build config with optional code execution for agentic vision
        config = None
        if agentic:
            config = types.GenerateContentConfig(
                tools=[types.Tool(code_execution=types.ToolCodeExecution())]
            )

        response = client.models.generate_content(
            model=model,
            contents=[uploaded_file, prompt],
            config=config
        )

        # Clean up uploaded file
        client.files.delete(name=uploaded_file.name)

        if verbose:
            print("Analysis complete", file=sys.stderr)
            print("=" * 50, file=sys.stderr)

        return response.text

    except Exception as e:
        # Try to clean up even on error
        try:
            client.files.delete(name=uploaded_file.name)
        except:
            pass
        raise e


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Analyze media files using Gemini 2.5 Flash Lite",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --file report.pdf --goal "Extract the title and date"
  %(prog)s --file diagram.png --goal "Describe the architecture"
  %(prog)s --file data.pdf --goal "Extract table as JSON"

Environment (checked in order):
  GOOGLE_API_KEY       Google API key for Gemini access
  GEMINI_API_KEY       Alternative env var with key value
  GEMINI_API_KEY_FILE  Path to file containing the key
  Fallback: $(getconf DARWIN_USER_TEMP_DIR)/agenix/gemini-api-key
        """
    )

    parser.add_argument(
        "--file", "-f",
        required=True,
        help="Path to the file to analyze"
    )

    parser.add_argument(
        "--goal", "-g",
        required=True,
        help="Specific information to extract from the file"
    )

    parser.add_argument(
        "--model", "-m",
        default="gemini-3.1-flash-lite-preview",
        help="Gemini model to use (default: gemini-3.1-flash-lite-preview)"
    )

    parser.add_argument(
        "--agentic", "-a",
        action="store_true",
        help="Enable agentic vision with code execution for complex reasoning (uses gemini-3-flash-preview)"
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Print debug information to stderr"
    )

    args = parser.parse_args()

    try:
        result = analyze_file(
            file_path=args.file,
            goal=args.goal,
            model=args.model,
            agentic=args.agentic,
            verbose=args.verbose
        )
        print(result)

    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
