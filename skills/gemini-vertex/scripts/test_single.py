#!/usr/bin/env -S uv run python3
"""Test single request before batch submission.

Use this script to validate extraction prompt and file access
before submitting a full batch job.

Usage:
    python test_single.py <gcs_uri> "<prompt>"

    # Cloud GCS smoke test, using ADC and the same model as the batch
    GOOGLE_CLOUD_PROJECT=my-project python test_single.py gs://bucket/doc.pdf "Extract the title"

Example:
    python test_single.py gs://my-bucket/documents/sample.pdf "Extract as JSON: {title, date, summary}"
"""

import os
import sys
from pathlib import Path

from google import genai

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts" / "lib"))
from gemini_models import resolve_model


def test_single_request(gcs_uri: str, prompt: str, model: str | None = None) -> str:
    """Test extraction on single file before batch.

    Args:
        gcs_uri: GCS URI of document (gs://bucket/path/file.pdf)
        prompt: Extraction prompt
        model: Model override; None resolves the 'bulk' role — this probe must run on the
            SAME model the batch will use, or it validates nothing.

    Returns:
        Response text from model
    """
    model = resolve_model("bulk", model)
    client = genai.Client(
        vertexai=True,
        project=os.environ.get("GOOGLE_CLOUD_PROJECT"),
        location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
    )

    # Detect MIME type from URI
    mime_type = "application/pdf"
    if gcs_uri.lower().endswith((".png", ".jpg", ".jpeg")):
        mime_type = "image/png" if gcs_uri.lower().endswith(".png") else "image/jpeg"

    print(f"Testing single request:")
    print(f"  URI: {gcs_uri}")
    print(f"  MIME type: {mime_type}")
    print(f"  Model: {model}")
    print(f"  Prompt: {prompt[:100]}...")
    print("-" * 50)

    response = client.models.generate_content(
        model=model,
        contents=[
            {"file_data": {"file_uri": gcs_uri, "mime_type": mime_type}},
            prompt,
        ],
        config={"response_mime_type": "application/json"},
    )

    print("Response:")
    print(response.text)

    return response.text


def main():
    """Main entry point."""
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <gcs_uri> \"<prompt>\" [model]")
        print(f"\nExample:")
        print(f'  {sys.argv[0]} gs://bucket/doc.pdf "Extract the title as JSON"')
        sys.exit(1)

    gcs_uri = sys.argv[1]
    prompt = sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else None

    if not gcs_uri.startswith("gs://"):
        print(f"Error: URI must start with 'gs://' (got: {gcs_uri})")
        sys.exit(1)

    try:
        test_single_request(gcs_uri, prompt, model)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
