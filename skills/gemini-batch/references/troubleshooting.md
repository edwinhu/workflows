# Troubleshooting

## Contents

- [Authentication Errors](#authentication-errors)
- [Vertex AI API Not Enabled](#vertex-ai-api-not-enabled)
- [Job Stuck in PENDING State](#job-stuck-in-pending-state)
- ["Permission Denied" Errors](#permission-denied-errors)
- [Empty or Truncated Responses](#empty-or-truncated-responses)
- [JSON Parsing Failures](#json-parsing-failures)
- [Rate Limit Errors](#rate-limit-errors)
- [Debugging Request Format](#debugging-request-format)
- [Cost Monitoring](#cost-monitoring)

Common issues and solutions for Gemini Batch API.

---

## Authentication Errors

### Error: `DefaultCredentialsError: Could not automatically determine credentials`

**Cause:** Vertex AI requires Application Default Credentials (ADC), not just API key.

**Solution:**
```bash
# Set up ADC
gcloud auth application-default login

# Verify ADC file exists
ls ~/.config/gcloud/application_default_credentials.json
```

**Why this happens:**
- Using `vertexai=True` with only `gcloud auth login` (not enough)
- Need ADC for Python libraries to authenticate
- API key is ignored when `vertexai=True`

### Error: `API key is invalid`

**Cause:** Wrong authentication method for Vertex AI.

**Solutions:**

```python
# ❌ WRONG: API key with vertexai=True
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

### Error: `Project not set`

**Cause:** Missing GCP project configuration.

**Solution:**
```bash
# Set default project
gcloud config set project YOUR_PROJECT_ID

# Or specify in code
client = genai.Client(
    vertexai=True,
    project="your-project-id",
    location="us-central1"
)
```

### Complete Auth Checklist

```bash
# 1. User login (for gcloud commands)
gcloud auth login

# 2. ADC login (for Python libraries)
gcloud auth application-default login

# 3. Set project
gcloud config set project YOUR_PROJECT_ID

# 4. Verify current project
gcloud config get-value project

# 5. Enable Vertex AI API (see next section)
gcloud services enable aiplatform.googleapis.com
```

---

## Vertex AI API Not Enabled

### Error: `API [aiplatform.googleapis.com] not enabled`

**Cause:** Vertex AI API is not enabled for your project.

**Solution:**
```bash
# Enable Vertex AI API
gcloud services enable aiplatform.googleapis.com

# Verify it's enabled
gcloud services list --enabled | grep aiplatform
```

**What you should see:**
```
aiplatform.googleapis.com  Vertex AI API
```

### Error: `Service account lacks IAM permissions`

**Cause:** Service account needs Vertex AI permissions.

**Solution:**
```bash
# Grant aiplatform.user role
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR-SA@PROJECT.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Also grant storage permissions
gsutil iam ch serviceAccount:YOUR-SA@PROJECT.iam.gserviceaccount.com:roles/storage.objectAdmin \
  gs://your-batch-bucket
```

---

## Job Stuck in PENDING State

**Possible Causes:**
- High API load / queue backlog
- Invalid request format (job won't start)
- Bucket permissions issues

**Solutions:**
```bash
# Check job details for errors
gcloud ai batch-predictions describe JOB_ID --region=us-central1

# Verify bucket permissions
gsutil iam get gs://your-bucket

# Test with smaller batch first
head -10 requests.jsonl > test_requests.jsonl
```

---

## "Permission Denied" Errors

**Checklist:**
1. Service account has `storage.objectAdmin` on bucket
2. Bucket is in `us-central1`
3. API key/credentials are valid
4. GCS URIs use `gs://` format (not HTTPS)

```bash
# Grant permissions
gsutil iam ch serviceAccount:YOUR_SA@PROJECT.iam.gserviceaccount.com:objectAdmin gs://bucket

# Verify access
gsutil ls gs://your-bucket/
```

---

## Empty or Truncated Responses

**Causes:**
- PDF too large (>50MB or >100 pages)
- Request timeout
- Token limit exceeded

**Solutions:**
```python
# Check finish reason in results
for result in parse_results(jsonl_path):
    reason = result.get("finish_reason")
    if reason != "STOP":
        print(f"Incomplete: {result['request_id']} - {reason}")

# Split large PDFs
split_pdfs = split_pdf("large.pdf", max_pages=50)
```

---

## JSON Parsing Failures

**Use robust parsing:**
```python
# See references/gotchas.md Gotcha 9 for full implementation
parsed = extract_json_from_response(raw_text)
if parsed is None:
    # Fall back to manual extraction or retry
    print(f"Could not parse response for {request_id}")
```

---

## Rate Limit Errors

**Symptoms:**
- 429 errors
- Jobs failing immediately

**Solutions:**
```python
# Add delays between job submissions
import time

for chunk in chunks:
    submit_job(chunk)
    time.sleep(60)  # Wait between submissions

# Use exponential backoff for status checks
def wait_with_backoff(job_name, initial_interval=60, max_interval=300):
    interval = initial_interval
    while True:
        job = genai.batches.get(name=job_name)
        if job.state in ["JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED"]:
            return job
        time.sleep(interval)
        interval = min(interval * 1.5, max_interval)
```

---

## Debugging Request Format

**Validate single request before batch:**
```python
def test_single_request(gcs_uri: str, prompt: str):
    """Test extraction on single file before batch."""
    genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
    model = genai.GenerativeModel("gemini-2.0-flash-lite")

    response = model.generate_content([
        {"file_data": {"file_uri": gcs_uri, "mime_type": "application/pdf"}},
        prompt
    ])

    print(response.text)
    return response
```

---

## Cost Monitoring

```python
def estimate_batch_cost(
    file_count: int,
    avg_pages: int = 10,
    model: str = "gemini-2.0-flash-lite"
) -> float:
    """Estimate batch processing cost.

    Note: Prices as of 2024, verify current pricing.
    """
    # Approximate tokens per page
    tokens_per_page = 500

    # Price per 1M tokens (batch pricing = 50% of standard)
    prices = {
        "gemini-2.0-flash-lite": {"input": 0.0375, "output": 0.15},  # batch rate
        "gemini-2.0-flash": {"input": 0.075, "output": 0.30},
        "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
    }

    price = prices.get(model, prices["gemini-2.0-flash-lite"])

    total_input_tokens = file_count * avg_pages * tokens_per_page
    total_output_tokens = file_count * 500  # Assume ~500 tokens output

    input_cost = (total_input_tokens / 1_000_000) * price["input"]
    output_cost = (total_output_tokens / 1_000_000) * price["output"]

    return input_cost + output_cost
```
