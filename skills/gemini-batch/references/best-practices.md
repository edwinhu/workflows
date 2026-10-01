# Developer Batch API patterns

Source: [Batch API](https://ai.google.dev/gemini-api/docs/batch-api.md.txt), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits.md.txt). This is the Gemini Developer API, **not** Cloud batch prediction. Batch still uses generateContent; Interactions Batch is not yet available.

## Keyed file input

Each JSONL row contains a unique `key` and a complete generateContent `request`. Inline `src` requests are also supported when the total request stays under 20MB. Input JSONL files can be up to 2GB; Files project storage is 20GB. Shard by token quotas and retry isolation rather than assuming a universal 10,000-row limit.

```json
{"key":"doc-1","request":{"contents":[{"role":"user","parts":[{"text":"Extract the dates from this excerpt..."}]}],"generationConfig":{"responseMimeType":"application/json"}}}
```

```python
from google import genai

client = genai.Client()
uploaded = client.files.upload(
    file="requests.jsonl", config={"mime_type": "application/jsonl"}
)
job = client.batches.create(
    model="gemini-3.5-flash-lite",
    src=uploaded.name,
    config={"display_name": "extraction-v1"},
)
# Later, using the SAME client:
job = client.batches.get(name=job.name)
if job.state == "JOB_STATE_SUCCEEDED":
    output = client.files.download(file=job.dest.file_name)
```

For structured schemas use the documented pattern in [structured-output.md](structured-output.md). Uploaded source media may be referenced within each JSONL request; a GCS URI is not mandatory for Developer Batch. Do not supply a Cloud `config.dest` here.

## Correlation and retries

- Build keys from the domain identifier plus content/prompt/model/schema version; join outputs by `key`, never line order. A repeated key is a local validation error, not guaranteed server-side idempotency.
- Reconcile missing/duplicate output keys and per-row errors even if the job succeeds. Preserve original keys when retrying failed rows.
- Use the existing project job/result store; audit existing state before adding another manifest. Derive pending rows from outputs and errors rather than recording competing status files.
- Validate JSONL locally with `scripts/validate_jsonl.py --backend developer`; run a same-model synchronous request, then 5–10 rows through Batch before scaling.
- Keep one Client alive for upload, create, get and download. Use the harness's background notification mechanism for long monitoring, not a model session spending tokens on repeated status narration.

## Quotas

Developer Batch: 100 concurrent batch requests, 2GB input file, 20GB file storage, plus per-model/tier enqueued-token limits across active jobs. As checked 2026-09-30, Tier 1 enqueued limits include 10M tokens for 3.5 Flash-Lite, 3M for 3.8 Flash and 5M for 3.1 Pro Preview. Recheck your actual project tier before sizing a job. Flex/Standard/Priority use non-Batch limits; Flex does not inherit these expanded quotas.

Cloud batch has separate limits (200,000 requests, 1GB GCS input), regional/global endpoints and a shared capacity pool: see [vertex-ai.md](vertex-ai.md).

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
