#!/usr/bin/env python3
"""Template for custom batch processing job.

Copy and modify this template for specific use cases.
Requires the GeminiBatchProcessor class from batch_processor.py.

Usage:
    1. Update CONFIG with bucket name and paths
    2. Customize PROMPT for extraction task
    3. Add post-processing logic in main()
    4. Run: python pipeline_template.py
"""

import os
from pathlib import Path

# Import from local module or install as package
from batch_processor import GeminiBatchProcessor

# Configuration
CONFIG = {
    "bucket": "your-bucket-name",
    "model": "gemini-2.0-flash-lite",
    "input_dir": "./data/input",
    "output_dir": "./data/output",
}

# Extraction prompt - customize for task
PROMPT = """
Analyze this document and extract:

1. Document type (invoice, contract, report, etc.)
2. Key dates mentioned
3. Main entities (people, organizations)
4. Summary of content (2-3 sentences)

Return as JSON:
{
    "document_type": "string",
    "dates": ["YYYY-MM-DD"],
    "entities": {
        "people": ["names"],
        "organizations": ["names"]
    },
    "summary": "string"
}
"""


def main():
    """Run batch processing pipeline."""
    # Initialize processor
    processor = GeminiBatchProcessor(
        bucket_name=CONFIG["bucket"],
        model=CONFIG["model"]
    )

    # Run pipeline
    results = processor.run_pipeline(
        input_dir=CONFIG["input_dir"],
        prompt=PROMPT,
        output_dir=CONFIG["output_dir"],
        wait=True
    )

    # Post-process results
    successful = []
    failed = []

    for result in results["results"]:
        if result["success"] and result["parsed_data"]:
            # Do something with successful extractions
            data = result["parsed_data"]
            print(f"{result['request_id']}: {data.get('document_type')}")
            successful.append(result)
        else:
            # Handle failures
            print(f"FAILED: {result['request_id']}: {result.get('error')}")
            failed.append(result)

    # Summary
    print(f"\nProcessing complete:")
    print(f"  Successful: {len(successful)}")
    print(f"  Failed: {len(failed)}")

    return results


if __name__ == "__main__":
    main()
