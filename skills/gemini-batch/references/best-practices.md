# Vertex batch production patterns

Production uses Gemini Enterprise Agent Platform, ADC and GCS, never AI Studio / the Gemini Developer API. Read [Cloud batch](vertex-ai.md) for setup, model availability, quotas and pricing.

## GCS input and output

Each JSONL line wraps a GenerateContentRequest in `request`. Upload the file to GCS using the existing project storage tooling; do not use the File API.

```json
{"request":{"contents":[{"role":"user","parts":[{"text":"Extract dates from this excerpt..."}]}],"generationConfig":{"responseMimeType":"application/json"}}}
```

```python
from google import genai

client = genai.Client(vertexai=True, project="your-project-id", location="global")
job = client.batches.create(
    model="publishers/google/models/gemini-3.5-flash-lite",
    src="gs://your-bucket/requests.jsonl",
    config={"display_name": "extraction-v1", "dest": "gs://your-bucket/outputs/"},
)
# Poll with the SAME client; read output objects from GCS, not client.files.
job = client.batches.get(name=job.name)
```

Source: [GCS batch format and output](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference/new-job-from-cloud-storage). Successful rows have `response`; failed rows have `status`. Do not assume Developer `key` passthrough. Recover domain IDs by matching canonical echoed requests to the original inputs, verify uniqueness and recovery in the pilot, and never join by output order. BigQuery documents scalar-column passthrough separately; see [Cloud formats](vertex-ai.md).

## Correlation and retries

- Build local IDs from domain identifier plus content/prompt/model/schema version; IDs are not guaranteed server-side idempotency.
- Reconcile missing/duplicate outputs and per-row errors even if the job succeeds. Retry only failed rows, retaining their original local identity.
- Use the existing project job/result store; audit existing state before adding another manifest. Derive pending rows from outputs and errors rather than recording competing status files.
- Validate locally with `scripts/validate_jsonl.py --backend cloud`; run a same-model synchronous Vertex request, then 5–10 Vertex batch rows before scaling.
- Keep one client alive across create/get. Use the harness's background notification mechanism for long monitoring, not repeated model status narration.

## Quotas

Vertex Gemini batch: no predefined concurrent-job quota, shared capacity; 200,000 requests/job and 1GB GCS input. Queue expiry is up to 72h; incomplete jobs are cancelled after 24h running. Sources: [batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference), [quotas](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/quotas).

Developer limits (historical comparison, not a production route): 100 concurrent batch requests, 2GB input file, 20GB Files storage; Tier 1 3.8 Flash queued tokens 3M ([Developer API, not for production: Developer limits](https://ai.google.dev/gemini-api/docs/rate-limits.md.txt)). These are not Vertex quotas.

## Deterministic keys and optional existing-store adapter

Use deterministic request IDs based on file content and prompt version to enable:
- Safe retries without duplicate processing
- Result caching and deduplication
- Incremental processing of new files only

```python
import hashlib
from pathlib import Path

def get_idempotent_request_id(file_path: str, prompt: str) -> str:
    """Generate idempotent request ID."""
    with open(file_path, 'rb') as f:
        content_hash = hashlib.sha256(f.read()).hexdigest()[:12]
    prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()[:8]
    return f"{Path(file_path).stem}_{content_hash}_{prompt_hash}"
```

---

### Existing SQLite store adapter

If the project already uses SQLite, adapt its existing store; do not add a competing state file. Keys aid correlation/caching, not server-side exactly-once execution:

```python
import json
import sqlite3

class ProcessingTracker:
    """Track batch processing state."""

    def __init__(self, db_path: str = "batch_state.db"):
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS processed (
                request_id TEXT PRIMARY KEY,
                file_path TEXT,
                job_name TEXT,
                status TEXT,
                result_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

    def mark_submitted(self, request_id: str, file_path: str, job_name: str):
        self.conn.execute(
            "INSERT OR REPLACE INTO processed (request_id, file_path, job_name, status) VALUES (?, ?, ?, ?)",
            (request_id, file_path, job_name, "submitted")
        )
        self.conn.commit()

    def mark_completed(self, request_id: str, result: dict):
        self.conn.execute(
            "UPDATE processed SET status = ?, result_json = ? WHERE request_id = ?",
            ("completed", json.dumps(result), request_id)
        )
        self.conn.commit()

    def get_pending(self) -> list[str]:
        cursor = self.conn.execute(
            "SELECT request_id FROM processed WHERE status = 'submitted'"
        )
        return [row[0] for row in cursor]

    def is_processed(self, request_id: str) -> bool:
        cursor = self.conn.execute(
            "SELECT 1 FROM processed WHERE request_id = ? AND status = 'completed'",
            (request_id,)
        )
        return cursor.fetchone() is not None
```

## 4. Handle Partial Failures Gracefully

Some requests may fail while others succeed. Always handle mixed results:

```python
def process_results_with_retry(
    results: list[dict],
    retry_callback: callable = None
) -> tuple[list[dict], list[dict]]:
    """Separate successful and failed results.

    Args:
        results: List of parsed results
        retry_callback: Optional callback for failed items

    Returns:
        Tuple of (successful_results, failed_results)
    """
    successful = []
    failed = []

    for result in results:
        if result.get("success") and result.get("parsed_data"):
            successful.append(result)
        else:
            failed.append(result)
            if retry_callback:
                retry_callback(result)

    print(f"Results: {len(successful)} successful, {len(failed)} failed")

    return successful, failed
```

### Shard sizing

Operational starting points, not API limits: small-file production 1,000–5,000 rows; large PDFs 100–500; critical data 100–200. Prefer token-quota/byte-aware sharding with retry isolation; test on 5–10 rows first.
