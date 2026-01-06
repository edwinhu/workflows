#!/usr/bin/env python3
"""Complete batch processing pipeline for document extraction using Gemini Batch API.

This module provides a production-ready GeminiBatchProcessor class for end-to-end
batch processing of documents (PDFs, images) with Google's Gemini models.

Example:
    processor = GeminiBatchProcessor(
        bucket_name="my-batch-bucket",
        model="gemini-2.0-flash-lite"
    )

    results = processor.run_pipeline(
        input_dir="./documents",
        prompt="Extract key information as JSON...",
        output_dir="./results"
    )
"""

from __future__ import annotations

import os
import json
import time
import hashlib
import re
from pathlib import Path
from datetime import datetime
from typing import Iterator, Optional

import google.generativeai as genai
from google.cloud import storage


class GeminiBatchProcessor:
    """End-to-end batch processing for documents."""

    def __init__(
        self,
        bucket_name: str,
        model: str = "gemini-2.0-flash-lite",
        api_key: str = None
    ):
        """Initialize processor.

        Args:
            bucket_name: GCS bucket in us-central1
            model: Gemini model to use
            api_key: Google API key (or set GOOGLE_API_KEY env var)
        """
        self.bucket_name = bucket_name
        self.model = model

        # Configure API
        api_key = api_key or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("API key required")
        genai.configure(api_key=api_key)

        # Initialize GCS client
        self.storage_client = storage.Client()
        self.bucket = self.storage_client.bucket(bucket_name)

    def upload_file(self, local_path: str, gcs_prefix: str = "documents") -> str:
        """Upload file to GCS.

        Args:
            local_path: Local file path
            gcs_prefix: GCS path prefix

        Returns:
            GCS URI
        """
        filename = Path(local_path).name
        blob_name = f"{gcs_prefix}/{filename}"
        blob = self.bucket.blob(blob_name)

        blob.upload_from_filename(local_path)

        return f"gs://{self.bucket_name}/{blob_name}"

    def upload_directory(
        self,
        local_dir: str,
        gcs_prefix: str = "documents",
        extensions: tuple = (".pdf", ".png", ".jpg", ".jpeg")
    ) -> list[tuple[str, str]]:
        """Upload all matching files from directory.

        Args:
            local_dir: Local directory path
            gcs_prefix: GCS path prefix
            extensions: File extensions to include

        Returns:
            List of (local_path, gcs_uri) tuples
        """
        uploaded = []

        for path in Path(local_dir).rglob("*"):
            if path.suffix.lower() in extensions:
                gcs_uri = self.upload_file(str(path), gcs_prefix)
                uploaded.append((str(path), gcs_uri))
                print(f"Uploaded: {path.name}")

        return uploaded

    def create_request(
        self,
        gcs_uri: str,
        prompt: str,
        request_id: str,
        mime_type: str = None
    ) -> dict:
        """Create a batch request entry.

        Args:
            gcs_uri: GCS URI of document
            prompt: Extraction prompt
            request_id: Unique request ID
            mime_type: MIME type (auto-detected if None)

        Returns:
            Request dictionary
        """
        # Auto-detect MIME type
        if mime_type is None:
            ext = Path(gcs_uri).suffix.lower()
            mime_types = {
                ".pdf": "application/pdf",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
            }
            mime_type = mime_types.get(ext, "application/octet-stream")

        return {
            "request": {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "fileData": {
                                    "fileUri": gcs_uri,
                                    "mimeType": mime_type
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
                "request_id": request_id
            }
        }

    def prepare_batch(
        self,
        files: list[tuple[str, str]],
        prompt: str,
        output_path: str = None
    ) -> str:
        """Prepare JSONL file for batch processing.

        Args:
            files: List of (local_path, gcs_uri) tuples
            prompt: Extraction prompt
            output_path: Output JSONL path (auto-generated if None)

        Returns:
            Path to generated JSONL file
        """
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = f"/tmp/batch_requests_{timestamp}.jsonl"

        # Hash prompt for request ID versioning
        prompt_hash = hashlib.md5(prompt.encode()).hexdigest()[:6]

        with open(output_path, 'w') as f:
            for local_path, gcs_uri in files:
                # Generate unique request ID
                file_hash = hashlib.md5(
                    Path(local_path).read_bytes()
                ).hexdigest()[:8]
                request_id = f"{Path(local_path).stem}_{file_hash}_{prompt_hash}"

                request = self.create_request(gcs_uri, prompt, request_id)
                f.write(json.dumps(request) + '\n')

        print(f"Created batch file with {len(files)} requests: {output_path}")
        return output_path

    def submit_job(
        self,
        jsonl_path: str,
        job_name: str = None
    ) -> genai.types.BatchJob:
        """Submit batch job.

        Args:
            jsonl_path: Path to local JSONL file
            job_name: Display name for job

        Returns:
            BatchJob object
        """
        # Upload JSONL to GCS
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if job_name is None:
            job_name = f"batch_{timestamp}"

        input_blob = f"batch_requests/{job_name}.jsonl"
        self.bucket.blob(input_blob).upload_from_filename(jsonl_path)
        input_uri = f"gs://{self.bucket_name}/{input_blob}"

        output_uri = f"gs://{self.bucket_name}/batch_outputs/{job_name}/"

        job = genai.batches.create(
            model=self.model,
            src=input_uri,
            dest=output_uri,
            config={"display_name": job_name}
        )

        print(f"Submitted job: {job.name}")
        print(f"Input: {input_uri}")
        print(f"Output: {output_uri}")

        return job

    def wait_for_job(
        self,
        job_name: str,
        poll_interval: int = 60,
        timeout: int = 86400
    ) -> genai.types.BatchJob:
        """Wait for job completion.

        Args:
            job_name: Batch job name
            poll_interval: Seconds between polls
            timeout: Maximum wait time

        Returns:
            Completed job
        """
        start = time.time()

        while True:
            job = genai.batches.get(name=job_name)
            elapsed = time.time() - start

            print(f"[{elapsed:.0f}s] Job state: {job.state}")

            if job.state == "JOB_STATE_SUCCEEDED":
                print(f"Job completed successfully!")
                return job
            elif job.state == "JOB_STATE_FAILED":
                raise RuntimeError(f"Job failed: {job.error}")
            elif job.state == "JOB_STATE_CANCELLED":
                raise RuntimeError("Job was cancelled")

            if elapsed > timeout:
                raise TimeoutError(f"Job timed out after {timeout}s")

            time.sleep(poll_interval)

    def download_results(self, output_prefix: str, local_dir: str) -> list[str]:
        """Download result files.

        Args:
            output_prefix: GCS output prefix (without gs://)
            local_dir: Local download directory

        Returns:
            List of downloaded file paths
        """
        Path(local_dir).mkdir(parents=True, exist_ok=True)

        prefix = output_prefix.replace(f"gs://{self.bucket_name}/", "")
        blobs = self.bucket.list_blobs(prefix=prefix)

        downloaded = []
        for blob in blobs:
            if blob.name.endswith('.jsonl'):
                local_path = Path(local_dir) / Path(blob.name).name
                blob.download_to_filename(str(local_path))
                downloaded.append(str(local_path))
                print(f"Downloaded: {local_path}")

        return downloaded

    def parse_results(self, jsonl_path: str) -> Iterator[dict]:
        """Parse results from JSONL file.

        Args:
            jsonl_path: Path to result JSONL

        Yields:
            Parsed result dictionaries
        """
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

                    # Try to parse JSON from response
                    parsed = self._extract_json(text)

                    yield {
                        "request_id": request_id,
                        "success": True,
                        "raw_text": text,
                        "parsed_data": parsed,
                        "finish_reason": candidates[0].get("finishReason")
                    }
                else:
                    yield {
                        "request_id": request_id,
                        "success": False,
                        "error": response.get("error"),
                        "raw_text": None,
                        "parsed_data": None
                    }

    def _extract_json(self, text: str) -> Optional[dict]:
        """Extract JSON from response text."""
        if not text:
            return None

        # Direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Remove code fences
        for pattern in [r'```json\s*(.*?)\s*```', r'```\s*(.*?)\s*```']:
            match = re.search(pattern, text, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(1))
                except json.JSONDecodeError:
                    continue

        # Find JSON boundaries
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass

        return None

    def run_pipeline(
        self,
        input_dir: str,
        prompt: str,
        output_dir: str,
        wait: bool = True
    ) -> dict:
        """Run complete batch processing pipeline.

        Args:
            input_dir: Directory containing input documents
            prompt: Extraction prompt
            output_dir: Directory for output results
            wait: Whether to wait for completion

        Returns:
            Pipeline results summary
        """
        # Step 1: Upload files
        print("=" * 50)
        print("Step 1: Uploading files...")
        files = self.upload_directory(input_dir)

        if not files:
            raise ValueError(f"No files found in {input_dir}")

        # Step 2: Prepare batch
        print("=" * 50)
        print("Step 2: Preparing batch request...")
        jsonl_path = self.prepare_batch(files, prompt)

        # Step 3: Submit job
        print("=" * 50)
        print("Step 3: Submitting batch job...")
        job = self.submit_job(jsonl_path)

        if not wait:
            return {
                "job_name": job.name,
                "status": "submitted",
                "files_count": len(files)
            }

        # Step 4: Wait for completion
        print("=" * 50)
        print("Step 4: Waiting for completion...")
        job = self.wait_for_job(job.name)

        # Step 5: Download results
        print("=" * 50)
        print("Step 5: Downloading results...")
        output_prefix = f"gs://{self.bucket_name}/batch_outputs/"
        result_files = self.download_results(output_prefix, output_dir)

        # Step 6: Parse results
        print("=" * 50)
        print("Step 6: Parsing results...")
        all_results = []
        for result_file in result_files:
            for result in self.parse_results(result_file):
                all_results.append(result)

        # Summary
        success_count = sum(1 for r in all_results if r["success"])

        print("=" * 50)
        print(f"Pipeline complete!")
        print(f"  Total files: {len(files)}")
        print(f"  Successful: {success_count}")
        print(f"  Failed: {len(all_results) - success_count}")

        return {
            "job_name": job.name,
            "status": "completed",
            "files_count": len(files),
            "success_count": success_count,
            "results": all_results
        }


# Example usage
if __name__ == "__main__":
    processor = GeminiBatchProcessor(
        bucket_name="my-batch-bucket",
        model="gemini-2.0-flash-lite"
    )

    prompt = """
    Extract the following information from this document as JSON:
    {
        "title": "document title",
        "date": "publication date",
        "summary": "brief summary",
        "key_entities": ["list", "of", "entities"]
    }
    """

    results = processor.run_pipeline(
        input_dir="./documents",
        prompt=prompt,
        output_dir="./results"
    )
