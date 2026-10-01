# API boundaries and measured gotchas

## APIs and SDK

[Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview.md.txt) is GA and recommended; generateContent is legacy but supported. Batch is generateContent-only. Flex is synchronous and uses general API limits, not an Interactions Batch endpoint.

Use [`google-genai`](https://ai.google.dev/gemini-api/docs/libraries.md.txt), `from google import genai`, and a shared `genai.Client`. The older `google.generativeai` SDK is deprecated and does not implement these examples' current Client/Batch methods. Do not call `genai.batches` at module scope.

## Request shapes

| Path | Input / config | Output |
|---|---|---|
| Developer Batch JSONL | `key` + `request` (generateContent), `src=uploaded.name`, `config={"display_name": ...}` | `job.dest.file_name`; correlate downloaded JSONL by key |
| Developer inline Batch | `src=[{contents, config}, ...]` under 20MB | `job.dest.inlined_responses`; check every error/response |
| Cloud batch | GCS/BigQuery; `vertexai=True`, project, location, publisher model; GCS `dest` inside config | Cloud output prefix / tables; Cloud metadata correlation |
| Interactions | `input`, `generation_config`, `service_tier`, `tools=[{"type": ...}]`, `response_format` | `output_text`, `steps`, `usage` |

Use current [Batch examples](https://ai.google.dev/gemini-api/docs/batch-api.md.txt) and [migration guide](https://ai.google.dev/gemini-api/docs/migrate-to-interactions.md.txt). Plain dictionaries are convenient, not a prohibition on documented SDK config types. `dest` is not a top-level create kwarg in the current google-genai Cloud pattern; it is not an Interactions field. Do not infer that every historic wrapper/parameter form works across versions.

[May 2026 Interactions changes](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026.md.txt): `steps` replaces `outputs`; `response_format` replaces separate Interactions output-format fields. Do not read legacy candidates/groundingMetadata from an Interactions response.

## Grounding: measured, not inferred from format

3.8 Flash founder lookups, 2026-09-30:

| Route / prompt | Observed grounded rows |
|---|---|
| Batch / JSON | 0/138 |
| Batch / markdown | 2/10 |
| Batch / short current-CEO question | 3/3 |
| Synchronous Standard / markdown | 92/138 |
| Flex / markdown smoke test | 8/8 successful calls grounded and returned tier=flex (10-row test, two user-reported HTTP 400 refusals) |

The user reports two HTTP 400 copyright/recitation refusals in the 10-row Flex test; the captured report independently records one unassigned 400 after 503 retries. Its 138-row pilot did not finish. Full citations and quality scores were not recovered. Do not call 8/10 a completed pilot or attribute 92/138 to markdown Batch. Route per-entity web lookups to Flex and inspect search/citations; see [flex-inference.md](flex-inference.md).

[Search docs](https://ai.google.dev/gemini-api/docs/google-search.md.txt) say the model determines whether search improves the answer. A configured tool does not force search. JSON does not universally disable it. [Legacy search](https://ai.google.dev/gemini-api/docs/generate-content/google-search.md.txt) returns groundingMetadata; Interactions returns google_search_call/result steps and url_citation annotations.

## Thinking and sampling

Omit temperature, top_p and top_k for Gemini 3.x. Current 3.8 migration removes these parameters, not merely a low-temperature override. Thinking is exact-model-specific: 3.8/3.7 Flash low/medium/high; 3.5 Flash-Lite minimal/low/medium/high; 3.1 Pro Preview low/medium/high. See [models-and-pricing.md](models-and-pricing.md).

A MAX_TOKENS response can spend its whole output budget on thinking. Check content and finish reason, adjust a model-supported thinking level/output budget, and retest. Default high is not universal; 2.5 does not universally reject thinking configuration.

## Cloud batch (historical identifiers retained)

The current product is **Gemini Enterprise Agent Platform**, formerly Vertex AI. `vertexai=True`, `aiplatform.googleapis.com`, `roles/aiplatform.user` and publisher resource paths are still identifiers, not names to rewrite. [Cloud batch](https://cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-prediction-gemini) supports global for base Gemini models and regional endpoints; global does not satisfy data residency requirements. us-central1 is this runbook's bucket default, not the Developer API's only region.

Observed 2026-08-30 with google-genai 2.20.0: a bare Cloud batch model ID 404'd; the publisher-qualified path and global endpoint worked for the tested 3.5 Flash-Lite job. models.list availability was not sufficient to establish batch serviceability in the requested region. Keep the correct backend/resource path, consult current model availability, and probe the same model/endpoint before production. Never silently downgrade the model to clear a 404.

Cloud metadata flattening was a production workaround for BigQuery-backed results: store scalar domain IDs/model/prompt hashes, serialize complex metadata if necessary. This is not a Developer key requirement or proof that every backend forbids nested JSON.

## Client lifetime and result parsing

Observed inline/per-call clients failed with `Cannot send a request, as the client has been closed`. Keep one client for the process, and close it only after all work completes.

Batch JS results may be raw JSON without a hydrated `.text` getter; read candidate parts, concatenate text blocks, and inspect errors/finishReason. Do not treat the first thought part as the answer. Structured JSON validates shape, not the truth of an extraction.

## Files and File Search observations

PDF parsing allows up to 50MB / 1,000 pages; Files storage is 2GB/file and 20GB/project with 48h expiry. Uploading media does not remove PDF/model/context limits. When layout/scanned pages matter, send the relevant PDF; for text-only field extraction, pre-cut the relevant section and never truncate off target evidence. See [files-api.md](files-api.md).

April 2026 File Search observations: uploadToFileSearchStore returned 503 for some files over 10KB; files.upload then importFile worked. A pager stopped after one page; explicit hasNextPage/nextPage worked. imported displayName could be a random ID; use customMetadata for domain IDs. These are recorded SDK/service observations, not permanent Google limits. Reconcile expected document counts, poll Files until ACTIVE, and inspect import errors. See [file-search.md](file-search.md).

Embedding inline output order scrambled on a 21K-text production job while a three-row test passed. Use keyed file input and fresh-embedding sentinels; see [embeddings.md](embeddings.md).

## PDF splitting utility

The 50MB / 1,000-page cap is the documented limit, not a universal 100-page failure threshold. Splitting into smaller page windows is optional for context/latency; preserve enough context for the extraction.

```python
from pathlib import Path

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

## Prompt-only JSON fallback

For free-text/prompt-only responses, try direct JSON parsing then code-fence/object extraction; reject parse failures rather than fabricating an empty success. Inspect finish reasons first; this does not repair truncated JSON.

```python
import json
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
```

## Endpoint probe evidence

Verified 2026-08-30 with google-genai 2.20.0, using the same Cloud JSONL:

| Endpoint | Model | Submission |
|---|---|---|
| global | gemini-3.5-flash-lite | ACCEPTED |
| global | gemini-2.5-flash-lite | ACCEPTED |
| us-central1 | gemini-3.5-flash-lite | REJECTED (404) |
| us-central1 | gemini-2.5-flash-lite | ACCEPTED |

Global accepted us-central1 src/dest. In that incident, downgrading to 2.5 silently coerced an out-of-enum statute into an in-enum value where 3.5 returned `other`. Fix the endpoint, not the model; a model swap invalidates earlier prompt evaluations. This probe is historical evidence, not a permanent availability matrix. Current Cloud docs allow global for base models and regional endpoints where supported.
