#!/usr/bin/env python3
"""Example: Batch vision analysis of icon images using Vertex AI.

This example demonstrates:
1. Uploading image files to GCS
2. Creating JSONL with image file URIs (not inline data)
3. Submitting batch job via Vertex AI
4. Polling for completion
5. Downloading and parsing results

Based on real-world icon matching use case.
"""

import os
import json
import time
from pathlib import Path
from google.cloud import storage
import google.generativeai as genai


def upload_images_to_gcs(
    local_dir: str,
    bucket_name: str,
    gcs_prefix: str = "icons"
) -> list[tuple[str, str]]:
    """Upload image files to GCS.

    Args:
        local_dir: Local directory containing images
        bucket_name: GCS bucket name (must be us-central1)
        gcs_prefix: Prefix for GCS paths

    Returns:
        List of (local_filename, gcs_uri) tuples
    """
    client = storage.Client()
    bucket = client.bucket(bucket_name)

    uploaded = []
    image_extensions = ('.png', '.jpg', '.jpeg', '.svg', '.webp')

    for file_path in Path(local_dir).rglob("*"):
        if file_path.suffix.lower() in image_extensions:
            # Upload to GCS
            gcs_path = f"{gcs_prefix}/{file_path.name}"
            blob = bucket.blob(gcs_path)
            blob.upload_from_filename(str(file_path))

            gcs_uri = f"gs://{bucket_name}/{gcs_path}"
            uploaded.append((file_path.name, gcs_uri))
            print(f"Uploaded: {file_path.name} -> {gcs_uri}")

    return uploaded


def create_vision_jsonl(
    images: list[tuple[str, str]],
    prompt: str,
    output_path: str = "/tmp/vision_batch.jsonl"
) -> str:
    """Create JSONL file for vision batch processing.

    Args:
        images: List of (filename, gcs_uri) tuples
        prompt: Vision analysis prompt
        output_path: Output JSONL path

    Returns:
        Path to created JSONL file
    """
    with open(output_path, 'w') as f:
        for filename, gcs_uri in images:
            # CRITICAL: Use fileData.fileUri, not inline image data
            request = {
                "request": {
                    "contents": [
                        {
                            "role": "user",
                            "parts": [
                                {
                                    "fileData": {
                                        "fileUri": gcs_uri,
                                        "mimeType": get_mime_type(filename)
                                    }
                                },
                                {
                                    "text": prompt
                                }
                            ]
                        }
                    ],
                    "generationConfig": {
                        "temperature": 0.0,
                        "responseMimeType": "application/json"
                    }
                },
                "metadata": {
                    "request_id": Path(filename).stem
                }
            }
            f.write(json.dumps(request) + '\n')

    print(f"Created JSONL with {len(images)} requests: {output_path}")
    return output_path


def get_mime_type(filename: str) -> str:
    """Get MIME type from filename extension."""
    ext = Path(filename).suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
    }
    return mime_types.get(ext, "image/png")


def submit_vertex_batch_job(
    jsonl_path: str,
    bucket_name: str,
    project_id: str,
    model: str = "gemini-2.5-flash-lite"
) -> genai.types.BatchJob:
    """Submit batch job via Vertex AI.

    Args:
        jsonl_path: Local JSONL file path
        bucket_name: GCS bucket name
        project_id: GCP project ID
        model: Gemini model name

    Returns:
        BatchJob object
    """
    # CRITICAL: vertexai=True requires ADC (gcloud auth application-default login)
    client = genai.Client(
        vertexai=True,
        project=project_id,
        location="us-central1"
    )

    # Upload JSONL to GCS
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    input_blob_name = f"batch_requests/vision_{timestamp}.jsonl"
    blob = bucket.blob(input_blob_name)
    blob.upload_from_filename(jsonl_path)

    input_uri = f"gs://{bucket_name}/{input_blob_name}"
    output_uri = f"gs://{bucket_name}/batch_outputs/vision_{timestamp}/"

    print(f"Input URI: {input_uri}")
    print(f"Output URI: {output_uri}")

    # Submit batch job
    job = client.batches.create(
        model=model,
        src=input_uri,
        dest=output_uri,
        config={"display_name": f"vision-batch-{timestamp}"}
    )

    print(f"Submitted job: {job.name}")
    return job


def wait_for_completion(
    job_name: str,
    project_id: str,
    poll_interval: int = 60,
    timeout: int = 3600
) -> genai.types.BatchJob:
    """Poll batch job until completion.

    Args:
        job_name: Batch job resource name
        project_id: GCP project ID
        poll_interval: Seconds between polls
        timeout: Max wait time in seconds

    Returns:
        Completed job
    """
    client = genai.Client(
        vertexai=True,
        project=project_id,
        location="us-central1"
    )

    start = time.time()

    while True:
        job = client.batches.get(name=job_name)
        elapsed = time.time() - start

        print(f"[{elapsed:.0f}s] Job state: {job.state}")

        if job.state == "JOB_STATE_SUCCEEDED":
            print("Job completed successfully!")
            return job
        elif job.state == "JOB_STATE_FAILED":
            raise RuntimeError(f"Job failed: {job.error}")
        elif job.state == "JOB_STATE_CANCELLED":
            raise RuntimeError("Job was cancelled")

        if elapsed > timeout:
            raise TimeoutError(f"Job timed out after {timeout}s")

        time.sleep(poll_interval)


def download_results(
    output_uri: str,
    local_dir: str = "./results"
) -> list[str]:
    """Download result JSONL files.

    Args:
        output_uri: GCS output URI prefix
        local_dir: Local download directory

    Returns:
        List of downloaded file paths
    """
    # Parse bucket and prefix from URI
    parts = output_uri.replace("gs://", "").split("/", 1)
    bucket_name = parts[0]
    prefix = parts[1] if len(parts) > 1 else ""

    client = storage.Client()
    bucket = client.bucket(bucket_name)

    Path(local_dir).mkdir(parents=True, exist_ok=True)

    downloaded = []
    for blob in bucket.list_blobs(prefix=prefix):
        if blob.name.endswith('.jsonl'):
            local_path = Path(local_dir) / Path(blob.name).name
            blob.download_to_filename(str(local_path))
            downloaded.append(str(local_path))
            print(f"Downloaded: {local_path}")

    return downloaded


def parse_vision_results(jsonl_path: str) -> dict[str, dict]:
    """Parse vision batch results.

    Args:
        jsonl_path: Path to result JSONL file

    Returns:
        Dict mapping request_id to parsed result
    """
    results = {}

    with open(jsonl_path, 'r') as f:
        for line in f:
            entry = json.loads(line)

            request_id = entry.get("metadata", {}).get("request_id")
            response = entry.get("response", {})
            candidates = response.get("candidates", [])

            if candidates:
                text = (
                    candidates[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )

                # Try to parse JSON response
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    parsed = {"raw_text": text}

                results[request_id] = {
                    "success": True,
                    "data": parsed,
                    "finish_reason": candidates[0].get("finishReason")
                }
            else:
                results[request_id] = {
                    "success": False,
                    "error": response.get("error"),
                    "data": None
                }

    return results


def main():
    """Run complete vision batch pipeline."""

    # Configuration
    BUCKET_NAME = "your-batch-bucket"  # Must be in us-central1
    PROJECT_ID = "your-project-id"
    LOCAL_ICONS_DIR = "./icons"
    MODEL = "gemini-2.5-flash-lite"

    # Vision analysis prompt
    PROMPT = """
    Analyze this icon and provide:
    {
        "description": "visual description of the icon",
        "color_scheme": "primary colors used",
        "style": "visual style (flat, gradient, outline, etc.)",
        "suggested_name": "semantic name for this icon",
        "categories": ["list", "of", "categories"]
    }
    """

    print("=" * 60)
    print("Step 1: Upload images to GCS")
    print("=" * 60)
    images = upload_images_to_gcs(LOCAL_ICONS_DIR, BUCKET_NAME)

    if not images:
        print("No images found!")
        return

    print(f"\nUploaded {len(images)} images")

    print("\n" + "=" * 60)
    print("Step 2: Create JSONL request file")
    print("=" * 60)
    jsonl_path = create_vision_jsonl(images, PROMPT)

    print("\n" + "=" * 60)
    print("Step 3: Submit batch job")
    print("=" * 60)
    job = submit_vertex_batch_job(jsonl_path, BUCKET_NAME, PROJECT_ID, MODEL)

    print("\n" + "=" * 60)
    print("Step 4: Wait for completion")
    print("=" * 60)
    job = wait_for_completion(job.name, PROJECT_ID)

    print("\n" + "=" * 60)
    print("Step 5: Download results")
    print("=" * 60)
    # Extract output URI from job
    output_uri = f"gs://{BUCKET_NAME}/batch_outputs/"
    result_files = download_results(output_uri)

    print("\n" + "=" * 60)
    print("Step 6: Parse results")
    print("=" * 60)
    all_results = {}
    for result_file in result_files:
        results = parse_vision_results(result_file)
        all_results.update(results)

    # Summary
    success_count = sum(1 for r in all_results.values() if r["success"])
    print(f"\nProcessed {len(all_results)} images:")
    print(f"  Success: {success_count}")
    print(f"  Failed: {len(all_results) - success_count}")

    # Save results
    output_path = "./icon_analysis_results.json"
    with open(output_path, 'w') as f:
        json.dump(all_results, f, indent=2)
    print(f"\nResults saved to: {output_path}")

    # Show sample
    print("\nSample result:")
    sample_id = next(iter(all_results))
    print(json.dumps({sample_id: all_results[sample_id]}, indent=2))


if __name__ == "__main__":
    # Prerequisites check
    print("Prerequisites:")
    print("1. gcloud auth login")
    print("2. gcloud auth application-default login")
    print("3. gcloud services enable aiplatform.googleapis.com")
    print("4. GCS bucket in us-central1")
    print()

    # Check ADC exists
    adc_path = Path.home() / ".config/gcloud/application_default_credentials.json"
    if not adc_path.exists():
        print("❌ ERROR: ADC not found. Run: gcloud auth application-default login")
        exit(1)

    print("✓ ADC found")
    print()

    main()
