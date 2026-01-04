# Critical Gotchas from Production

Production lessons learned from real-world Gemini Batch API deployments.

---

## Gotcha 1: GCS Bucket Must Be in us-central1

**Problem:** Batch API only works with buckets in `us-central1` region.

**Symptom:** Job submission fails with region mismatch error.

**Solution:**
```bash
# Create bucket in correct region
gsutil mb -l us-central1 gs://your-batch-bucket

# Or check existing bucket location
gsutil ls -L -b gs://your-bucket | grep "Location"
```

**Why:** The Batch API service runs in us-central1 and cannot access buckets in other regions efficiently.

---

## Gotcha 2: File URIs Must Use gs:// Protocol

**Problem:** The API expects GCS URIs, not HTTPS URLs.

**Wrong:**
```python
"fileUri": "https://storage.googleapis.com/bucket/file.pdf"
```

**Correct:**
```python
"fileUri": "gs://bucket/file.pdf"
```

**Why:** The batch service accesses files directly through GCS internal APIs, not HTTP.

---

## Gotcha 3: JSONL Format is Strict

**Problem:** Each line must be valid JSON with exact schema.

**Required Schema:**
```json
{
  "request": {
    "contents": [
      {
        "role": "user",
        "parts": [...]
      }
    ]
  },
  "metadata": {
    "request_id": "unique-id"
  }
}
```

**Common Mistakes:**
- Missing `role` field in contents
- Using `content` instead of `contents` (must be plural)
- Trailing commas in JSON
- Empty lines in JSONL file

**Validation:**
```python
def validate_jsonl(path: str) -> bool:
    """Validate JSONL file format."""
    with open(path, 'r') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                print(f"Warning: Empty line at {i}")
                continue
            try:
                data = json.loads(line)
                assert "request" in data, "Missing 'request' key"
                assert "contents" in data["request"], "Missing 'contents' in request"
                assert data["request"]["contents"][0].get("role") == "user", "Missing role"
            except (json.JSONDecodeError, AssertionError) as e:
                print(f"Error at line {i}: {e}")
                return False
    return True
```

---

## Gotcha 4: Request ID Must Be Unique Per Job

**Problem:** Duplicate request IDs cause silent overwrites or errors.

**Solution:**
```python
import hashlib

def generate_request_id(file_path: str, prompt_hash: str = None) -> str:
    """Generate deterministic unique request ID.

    Args:
        file_path: Path to source file
        prompt_hash: Optional hash of prompt for versioning

    Returns:
        Unique request ID
    """
    # Use file content hash for deduplication
    with open(file_path, 'rb') as f:
        file_hash = hashlib.md5(f.read()).hexdigest()[:8]

    base_name = Path(file_path).stem

    if prompt_hash:
        return f"{base_name}_{file_hash}_{prompt_hash}"
    return f"{base_name}_{file_hash}"
```

---

## Gotcha 5: Large PDFs May Timeout or Fail

**Problem:** PDFs over ~100 pages or 50MB may fail silently.

**Symptoms:**
- Empty response in results
- `FINISH_REASON_UNSPECIFIED` or `FINISH_REASON_MAX_TOKENS`
- Job succeeds but some entries have errors

**Solutions:**
```python
def split_pdf(input_path: str, max_pages: int = 50) -> list[str]:
    """Split large PDF into smaller chunks.

    Args:
        input_path: Path to input PDF
        max_pages: Maximum pages per chunk

    Returns:
        List of paths to split PDFs
    """
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(input_path)
    total_pages = len(reader.pages)

    if total_pages <= max_pages:
        return [input_path]

    output_paths = []
    for start in range(0, total_pages, max_pages):
        end = min(start + max_pages, total_pages)
        writer = PdfWriter()

        for page_num in range(start, end):
            writer.add_page(reader.pages[page_num])

        output_path = input_path.replace('.pdf', f'_part{start//max_pages + 1}.pdf')
        with open(output_path, 'wb') as f:
            writer.write(f)
        output_paths.append(output_path)

    return output_paths


def check_pdf_size(path: str, max_mb: int = 50) -> bool:
    """Check if PDF is within size limits."""
    size_mb = Path(path).stat().st_size / (1024 * 1024)
    return size_mb <= max_mb
```

---

## Gotcha 6: API Key vs Service Account Authentication

**Problem:** Different auth methods have different behaviors.

**API Key (Simpler, Limited):**
```python
import google.generativeai as genai
genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
```

**Service Account (Recommended for Production):**
```python
from google.oauth2 import service_account

credentials = service_account.Credentials.from_service_account_file(
    'service-account.json',
    scopes=['https://www.googleapis.com/auth/cloud-platform']
)

# For genai library
genai.configure(credentials=credentials)

# For direct REST calls
import google.auth.transport.requests
request = google.auth.transport.requests.Request()
credentials.refresh(request)
token = credentials.token
```

**Service Account Requirements:**
- `roles/storage.objectAdmin` on GCS bucket
- `roles/aiplatform.user` for Vertex AI
- Bucket must have IAM bindings for the service account

---

## Gotcha 7: Output URI Must Be a Prefix, Not a File

**Problem:** Output URI is a prefix; the API appends job ID and timestamps.

**Wrong:**
```python
output_uri = "gs://bucket/results/output.jsonl"  # Will fail or create weird paths
```

**Correct:**
```python
output_uri = "gs://bucket/results/"  # Trailing slash recommended
# Results appear at: gs://bucket/results/{job_id}/output.jsonl
```

**Finding Results:**
```python
def find_batch_output(output_prefix: str, job_name: str) -> str:
    """Find the actual output file location.

    Args:
        output_prefix: The URI prefix used when submitting
        job_name: The batch job resource name

    Returns:
        GCS URI to the output JSONL
    """
    # Job name format: batches/{batch_id}
    batch_id = job_name.split('/')[-1]

    client = storage.Client()
    parts = output_prefix.replace("gs://", "").split("/", 1)
    bucket_name = parts[0]
    prefix = parts[1] if len(parts) > 1 else ""

    bucket = client.bucket(bucket_name)

    # Search for output files
    blobs = list(bucket.list_blobs(prefix=prefix))

    for blob in blobs:
        if batch_id in blob.name and blob.name.endswith('.jsonl'):
            return f"gs://{bucket_name}/{blob.name}"

    raise FileNotFoundError(f"No output found for job {job_name}")
```

---

## Gotcha 8: Rate Limits and Quotas

**Problem:** Batch API has separate quotas from synchronous API.

**Limits (as of 2024):**
| Limit Type | Value |
|------------|-------|
| Max requests per JSONL | 10,000 |
| Max concurrent jobs | 10 |
| Max job size | 100MB |
| Job expiration | 24 hours |

**Handling Large Workloads:**
```python
def chunk_requests(requests: list[dict], chunk_size: int = 10000) -> list[list[dict]]:
    """Split requests into chunks for multiple jobs.

    Args:
        requests: All batch requests
        chunk_size: Max requests per job

    Returns:
        List of request chunks
    """
    return [
        requests[i:i + chunk_size]
        for i in range(0, len(requests), chunk_size)
    ]


def submit_chunked_jobs(chunks: list[list[dict]], bucket: str) -> list[str]:
    """Submit multiple batch jobs for large workloads.

    Args:
        chunks: List of request chunks
        bucket: GCS bucket name

    Returns:
        List of job names
    """
    job_names = []

    for i, chunk in enumerate(chunks):
        # Write chunk to JSONL
        jsonl_path = f"/tmp/batch_chunk_{i}.jsonl"
        write_jsonl(chunk, jsonl_path)

        # Upload and submit
        input_uri = upload_to_gcs(jsonl_path, bucket, f"requests/chunk_{i}.jsonl")
        output_uri = f"gs://{bucket}/outputs/chunk_{i}/"

        job = submit_batch_job(input_uri, output_uri)
        job_names.append(job.name)

        print(f"Submitted chunk {i+1}/{len(chunks)}: {job.name}")

    return job_names
```

---

## Gotcha 9: JSON Response Parsing Requires Careful Handling

**Problem:** Even with `responseMimeType: "application/json"`, responses may not be valid JSON.

**Common Issues:**
- Markdown code fences around JSON: ` ```json ... ``` `
- Truncated responses for large outputs
- Model adds explanatory text before/after JSON

**Robust Parsing:**
```python
import re

def extract_json_from_response(text: str) -> dict | None:
    """Extract JSON from potentially messy response text.

    Args:
        text: Raw response text from model

    Returns:
        Parsed JSON dict, or None if extraction fails
    """
    if not text:
        return None

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Remove markdown code fences
    patterns = [
        r'```json\s*(.*?)\s*```',  # ```json ... ```
        r'```\s*(.*?)\s*```',       # ``` ... ```
        r'`(.*?)`',                  # inline code
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                continue

    # Try to find JSON object boundaries
    start = text.find('{')
    end = text.rfind('}')

    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    # Try JSON array
    start = text.find('[')
    end = text.rfind(']')

    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    return None


def parse_batch_results_robust(jsonl_path: str) -> list[dict]:
    """Parse batch results with robust JSON extraction.

    Args:
        jsonl_path: Path to result JSONL file

    Returns:
        List of results with parsed JSON where possible
    """
    results = []

    with open(jsonl_path, 'r') as f:
        for line_num, line in enumerate(f, 1):
            try:
                entry = json.loads(line)
                request_id = entry.get("metadata", {}).get("request_id")

                response = entry.get("response", {})
                candidates = response.get("candidates", [])

                if candidates:
                    text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    parsed_json = extract_json_from_response(text)

                    results.append({
                        "request_id": request_id,
                        "raw_response": text,
                        "parsed_json": parsed_json,
                        "parse_success": parsed_json is not None,
                        "finish_reason": candidates[0].get("finishReason")
                    })
                else:
                    results.append({
                        "request_id": request_id,
                        "error": response.get("error"),
                        "raw_response": None,
                        "parsed_json": None,
                        "parse_success": False
                    })

            except json.JSONDecodeError as e:
                print(f"Failed to parse line {line_num}: {e}")
                results.append({
                    "line_number": line_num,
                    "error": str(e),
                    "parse_success": False
                })

    return results
```
