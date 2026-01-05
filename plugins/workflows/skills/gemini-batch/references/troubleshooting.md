# Troubleshooting

## Contents

- [Job Stuck in PENDING State](#job-stuck-in-pending-state)
- ["Permission Denied" Errors](#permission-denied-errors)
- [Empty or Truncated Responses](#empty-or-truncated-responses)
- [JSON Parsing Failures](#json-parsing-failures)
- [Rate Limit Errors](#rate-limit-errors)
- [Debugging Request Format](#debugging-request-format)
- [Cost Monitoring](#cost-monitoring)

Common issues and solutions for Gemini Batch API.

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
