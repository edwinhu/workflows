#!/usr/bin/env python3
"""Extract markdown text from a PDF using pymupdf4llm.

Usage: python3 extract-pdf-text.py <pdf_path>

Outputs markdown text to stdout. Designed to be called from the
cite-check TypeScript pipeline via subprocess.
"""

import sys
import pymupdf4llm


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: extract-pdf-text.py <pdf_path>", file=sys.stderr)
        return 1

    pdf_path = sys.argv[1]

    try:
        md = pymupdf4llm.to_markdown(
            pdf_path,
            show_progress=False,
            write_images=False,
            ignore_images=True,
        )
        sys.stdout.write(md)
        return 0
    except Exception as e:
        print(f"Error extracting text: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
