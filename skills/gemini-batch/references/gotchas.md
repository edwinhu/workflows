# Critical Gotchas from Production

## Contents

- [Gotcha 1: GCS Bucket Must Be in us-central1](#gotcha-1-gcs-bucket-must-be-in-us-central1)
- [Gotcha 2: File URIs Must Use gs:// Protocol](#gotcha-2-file-uris-must-use-gs-protocol)
- [Gotcha 3: JSONL Format is Strict](#gotcha-3-jsonl-format-is-strict)
- [Gotcha 4: Request ID Must Be Unique Per Job](#gotcha-4-request-id-must-be-unique-per-job)
- [Gotcha 5: Large PDFs May Timeout or Fail](#gotcha-5-large-pdfs-may-timeout-or-fail)
- [Gotcha 6: API Key vs Service Account Authentication](#gotcha-6-api-key-vs-service-account-authentication)
- [Gotcha 7: Output URI Must Be a Prefix, Not a File](#gotcha-7-output-uri-must-be-a-prefix-not-a-file)
- [Gotcha 8: Rate Limits and Quotas](#gotcha-8-rate-limits-and-quotas)
- [Gotcha 9: JSON Response Parsing Requires Careful Handling](#gotcha-9-json-response-parsing-requires-careful-handling)
- [Gotcha 10: Metadata Must Be Flat Primitives](#gotcha-10-metadata-must-be-flat-primitives)
- [Gotcha 11: API Parameter Names (dest= not destination=)](#gotcha-11-api-parameter-names-dest-not-destination)

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

## Gotcha 6: API Key vs Application Default Credentials (ADC)

**Problem:** Vertex AI requires ADC authentication, not just API keys.

**Symptom:** `DefaultCredentialsError: Could not automatically determine credentials`

**Two Authentication Modes:**

### Standard Gemini API (API Key)

```python
import google.generativeai as genai

# Simple API key auth
genai.configure(api_key=os.environ["GOOGLE_API_KEY"])

# Works for standard batch API
client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
```

### Vertex AI (ADC Required)

```python
import google.generativeai as genai

# CRITICAL: vertexai=True requires ADC, not API key
client = genai.Client(
    vertexai=True,
    project="your-project-id",
    location="us-central1"
)

# API key is IGNORED when vertexai=True
```

**Setup ADC:**

```bash
# Step 1: User login (for gcloud commands)
gcloud auth login

# Step 2: ADC login (for Python libraries)
gcloud auth application-default login

# Step 3: Enable Vertex AI API
gcloud services enable aiplatform.googleapis.com

# Verify ADC location
ls ~/.config/gcloud/application_default_credentials.json
```

**When to Use Each:**

| Feature | API Key | ADC (Vertex AI) |
|---------|---------|-----------------|
| Setup | Simple (just key) | Requires gcloud SDK |
| Use Case | Development, demos | Production, enterprise |
| Regions | us-central1 only | Multiple regions |
| VPC Support | No | Yes |
| Required API | Gemini API | Vertex AI API |
| Cost | Standard | Volume discounts available |

**Common Mistakes:**

```python
# ❌ WRONG: Passing API key with vertexai=True (ignored)
client = genai.Client(
    api_key=os.environ["GOOGLE_API_KEY"],
    vertexai=True  # API key is ignored!
)

# ✓ CORRECT: Use ADC with vertexai=True
client = genai.Client(
    vertexai=True,
    project="your-project-id",
    location="us-central1"
)

# ✓ CORRECT: Use API key without vertexai
client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
```

**Service Account (Production Alternative):**

For automated systems without user interaction:

```python
from google.oauth2 import service_account

# Load service account credentials
credentials = service_account.Credentials.from_service_account_file(
    'service-account.json',
    scopes=['https://www.googleapis.com/auth/cloud-platform']
)

# Use with genai library
client = genai.Client(
    vertexai=True,
    project="your-project-id",
    location="us-central1",
    credentials=credentials
)
```

**Service Account Requirements:**
- `roles/storage.objectAdmin` on GCS bucket
- `roles/aiplatform.user` for Vertex AI
- Bucket must have IAM bindings for the service account

**Troubleshooting Auth Errors:**

```bash
# Check if ADC exists
ls ~/.config/gcloud/application_default_credentials.json

# Re-authenticate if missing
gcloud auth application-default login

# Check current project
gcloud config get-value project

# Verify API is enabled
gcloud services list --enabled | grep aiplatform

# If not enabled:
gcloud services enable aiplatform.googleapis.com
```

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

---

## Gotcha 10: Metadata Must Be Flat Primitives

**Problem:** Vertex AI Batch API only accepts primitive types (STRING, INTEGER, FLOAT, BOOLEAN, TIMESTAMP, DATE, DATETIME, NUMERIC) for metadata values. Nested objects or arrays cause job failures.

**Symptom:** Job fails with error:
```
The column or property "metadata" in the specified input data is of unsupported type.
Supported types for this column are: [STRING, INTEGER, FLOAT, BOOLEAN, TIMESTAMP, DATE, DATETIME, NUMERIC].
```

**Wrong:**
```python
# ❌ Nested object - NOT SUPPORTED
{
    "request": {...},
    "metadata": {
        "request_id": "icon_123",
        "file_info": {              # This breaks!
            "name": "copy.svg",
            "size": 1024
        }
    }
}
```

**Correct Option 1: Flatten**
```python
# ✓ Flat structure with primitives only
{
    "request": {...},
    "metadata": {
        "request_id": "icon_123",
        "file_name": "copy.svg",
        "file_size": 1024
    }
}
```

**Correct Option 2: Serialize to JSON String**
```python
# ✓ Complex data as JSON string
import json

{
    "request": {...},
    "metadata": {
        "request_id": "icon_123",
        "file_info": json.dumps({"name": "copy.svg", "size": 1024})  # String!
    }
}
```

**When to Use Each:**
- **Flatten**: When you need to filter/query by metadata fields
- **Serialize**: When you just need to preserve context for result processing

**Why:** Vertex AI stores metadata in BigQuery-compatible format, which doesn't support nested types.

**Validation:**
```python
def validate_metadata(metadata: dict) -> bool:
    """Check metadata contains only primitive types."""
    for key, value in metadata.items():
        if isinstance(value, (dict, list)):
            raise ValueError(
                f"Metadata value for '{key}' is {type(value).__name__}. "
                f"Only primitives (str, int, float, bool) are allowed. "
                f"Use json.dumps() to serialize complex data."
            )
        if not isinstance(value, (str, int, float, bool, type(None))):
            raise ValueError(f"Unsupported metadata type for '{key}': {type(value)}")
    return True
```

---

## Gotcha 11: API Parameter Names (dest= not destination=)

**Problem:** The Batch API parameter for output location is `dest=`, not `destination=`. Additionally, you pass plain strings/dicts, not wrapper types.

**Symptom:** TypeError about unexpected keyword arguments

**Wrong Attempts:**
```python
# ❌ WRONG: destination= doesn't exist
job = client.batches.create(
    model="gemini-2.5-flash-lite",
    src="gs://bucket/input.jsonl",
    destination="gs://bucket/output/"  # This parameter doesn't exist!
)

# ❌ WRONG: Overly complex with wrapper types
from google.genai import types
job = client.batches.create(
    model="gemini-2.5-flash-lite",
    src="gs://bucket/input.jsonl",
    config=types.CreateBatchJobConfig(  # Don't instantiate this manually!
        dest="gs://bucket/output/"
    )
)
```

**Correct:**
```python
# ✓ CORRECT: Use dest= parameter with plain string
job = client.batches.create(
    model="gemini-2.5-flash-lite",
    src="gs://bucket/input.jsonl",
    dest="gs://bucket/output/",         # Plain string!
    config={"display_name": "my-job"}   # Plain dict (optional)
)
```

**API Signature:**
```python
def create(
    *,
    model: str,                    # Model name
    src: str,                      # Input GCS/BigQuery URI or file name
    dest: str = None,              # Output GCS URI prefix (optional)
    config: dict = None            # Optional config as plain dict
) -> BatchJob:
    ...
```

**Key Points:**
1. **Parameter is `dest=`** (not destination, output, or output_uri)
2. **Pass plain string** (not a URI object or wrapper type)
3. **Config is plain dict** (not CreateBatchJobConfig instance)
4. **SDK handles conversion** internally to proper types

**Why the Confusion:**
- `CreateBatchJobConfig` exists in SDK types for internal use
- You see it in type hints/autocomplete
- But you **don't instantiate it yourself**
- Just pass a plain dict to `config=`

**Think of it like:**
- Type hints show `config: CreateBatchJobConfig`
- But you pass `config={"display_name": "job"}`
- SDK converts dict → CreateBatchJobConfig internally

**Verification:**
```python
# Check parameter names without executing
import inspect
from google import genai

client = genai.Client(vertexai=True, project="...", location="us-central1")
sig = inspect.signature(client.batches.create)
print(sig.parameters.keys())  # Shows: model, src, dest, config
```

**Examples from Skill:**
- Standard API: `examples/batch_processor.py` line 229-234
- Vertex AI: `examples/icon_batch_vision.py` line 139-166

Both show the same pattern: `dest=` parameter with plain strings and dicts.
