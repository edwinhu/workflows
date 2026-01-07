# Best Practices

## Contents

- [1. Implement Idempotent Request IDs](#1-implement-idempotent-request-ids)
- [2. Track Processing State](#2-track-processing-state)
- [3. Validate Before Submission](#3-validate-before-submission)
- [4. Handle Partial Failures Gracefully](#4-handle-partial-failures-gracefully)
- [5. Use Appropriate Batch Sizes](#5-use-appropriate-batch-sizes)

Production-tested patterns for reliable Gemini Batch API usage.

---

## 1. Implement Idempotent Request IDs

Use deterministic request IDs based on file content and prompt version to enable:
- Safe retries without duplicate processing
- Result caching and deduplication
- Incremental processing of new files only

```python
def get_idempotent_request_id(file_path: str, prompt: str) -> str:
    """Generate idempotent request ID."""
    with open(file_path, 'rb') as f:
        content_hash = hashlib.sha256(f.read()).hexdigest()[:12]
    prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()[:8]
    return f"{Path(file_path).stem}_{content_hash}_{prompt_hash}"
```

---

## 2. Track Processing State

Maintain a manifest of processed files to avoid reprocessing:

```python
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

---

## 3. Validate Before Submission

Always validate JSONL files before submitting to catch errors early:

```python
def validate_batch_file(jsonl_path: str) -> tuple[bool, list[str]]:
    """Validate batch JSONL file.

    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []
    request_ids = set()

    with open(jsonl_path, 'r') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()

            # Check for empty lines
            if not line:
                errors.append(f"Line {line_num}: Empty line")
                continue

            # Parse JSON
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"Line {line_num}: Invalid JSON - {e}")
                continue

            # Check required fields
            if "request" not in data:
                errors.append(f"Line {line_num}: Missing 'request' field")
                continue

            request = data["request"]
            if "contents" not in request:
                errors.append(f"Line {line_num}: Missing 'contents' in request")

            contents = request.get("contents", [])
            if not contents or contents[0].get("role") != "user":
                errors.append(f"Line {line_num}: First content must have role='user'")

            # Check for file URI format
            parts = contents[0].get("parts", []) if contents else []
            for part in parts:
                if "fileData" in part:
                    uri = part["fileData"].get("fileUri", "")
                    if not uri.startswith("gs://"):
                        errors.append(f"Line {line_num}: fileUri must start with 'gs://'")

            # Check request ID uniqueness
            request_id = data.get("metadata", {}).get("request_id")
            if request_id:
                if request_id in request_ids:
                    errors.append(f"Line {line_num}: Duplicate request_id '{request_id}'")
                request_ids.add(request_id)
            else:
                errors.append(f"Line {line_num}: Missing request_id in metadata")

    return len(errors) == 0, errors
```

---

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

---

## 5. Use Appropriate Batch Sizes

Balance between job overhead and failure isolation:

| Scenario | Recommended Batch Size |
|----------|------------------------|
| Testing/Development | 10-50 requests |
| Production (small files) | 1,000-5,000 requests |
| Production (large PDFs) | 100-500 requests |
| Critical data | 100-200 requests |

```python
def optimal_batch_size(
    file_count: int,
    avg_file_size_mb: float,
    criticality: str = "normal"
) -> int:
    """Calculate optimal batch size.

    Args:
        file_count: Total number of files
        avg_file_size_mb: Average file size in MB
        criticality: "low", "normal", or "high"

    Returns:
        Recommended batch size
    """
    # Base limits
    max_size = 10000  # API limit

    # Adjust for file size
    if avg_file_size_mb > 10:
        max_size = min(max_size, 500)
    elif avg_file_size_mb > 5:
        max_size = min(max_size, 1000)

    # Adjust for criticality
    criticality_factors = {"low": 1.0, "normal": 0.5, "high": 0.2}
    factor = criticality_factors.get(criticality, 0.5)
    max_size = int(max_size * factor)

    # Don't create too many small batches
    min_batches = max(1, file_count // max_size)
    optimal = file_count // min_batches

    return min(optimal, max_size)
```
