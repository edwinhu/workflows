# Production API boundaries and measured gotchas

**Production uses Gemini Enterprise Agent Platform, `vertexai=True`, ADC and GCS. NEVER use AI Studio / Gemini Developer API for production runs.** Synchronous smoke tests also use the Cloud backend/model; historical Developer formats are not production fallbacks.

## APIs and request shapes

Use `google-genai`, `from google import genai` and one shared Client. Cloud [Interactions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/interactions) is Preview, and generateContent remains fully supported. Batch uses GenerateContentRequest, not an Interactions background task.

| Path | Input / config | Output |
|---|---|---|
| Cloud generation batch | GCS JSONL `request`; publisher model path; `config.dest` GCS prefix | `job.dest.gcs_uri`; JSONL `request`/`response`/`status`; verify correlation |
| Cloud embedding batch | GCS JSONL `key` + `request.content`/`request.embed_content_config` | Keyed vectors; [embedding schema](embeddings.md) |
| Cloud Standard / Flex / Priority | generate_content; Flex/Priority use Vertex request-type header | candidates/groundingMetadata, not Developer Interactions steps |
| Developer API, not for production | Files / inline batches and Interactions service_tier | Different keys, dest.file_name or steps; never copy into production |

Sources: [GCS batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference/new-job-from-cloud-storage), [Cloud tiers](flex-inference.md). `dest` belongs inside config. Both dictionaries and documented SDK config types work; do not reinstate the old ban on CreateBatchJobConfig.

## Cloud batch facts — measured 2026-10-01

Founder web-search pilots and M100 used `gemini-3.8-flash`, location `global`, on Gemini Enterprise Agent Platform. These observations establish that tested combination, not every model/schema/location.

| Fact | Consequence |
|---|---|
| Empty `{"googleSearch": {}}` failed import: `Query error: Cannot store struct 'request.tools.googleSearch' with no fields`; job FAILED before inference | Give the tool a field: `{"googleSearch": {"excludeDomains": ["example.invalid"]}}` was accepted and grounding ran |
| M100 SUCCEEDED with 97/100 grounded rows; three returned RECITATION with no answer | Inspect finish reasons and usable content; job success does not mean every row has an answer |
| Extra top-level JSONL fields such as `key` passed through to output; M100 reconciled all keys | Key rows outside `request` and reconcile by key, not content matching |
| Uncapped pilot rows made 2, 23 and 47 queries. “Use at most 3 Google searches; stop searching as soon as you have found who founded the company.” yielded M100 mean 2.98, median 3, p90 5, max 7; 27/100 exceeded 3 | This is a soft cap, not a hard limit. Always measure about 100 rows and project search cost before a full grounded run |
| Search tariff used in M100: 5,000 free queries/month, then $14/1,000 queries, billed per query | Budget queries separately from model tokens; observed query counts on failed rows may omit searches before failure, so projections are not billing reconciliation |
| 2/5 pilot rows returned code 4 DEADLINE_EXCEEDED, `Request deadline exceeded before prefill finished`; the same keys succeeded on M100 resubmission | Plan a retry pass for failed keys; preserve identifiers rather than dropping rows |
| A new project returned 403 `aiplatform.batchPredictionJobs.create` denied `(or it may not exist)` immediately after enabling aiplatform; a later submission succeeded without IAM grants | Wait a few minutes after enablement and retry before diagnosing missing IAM; `testIamPermissions` needs `cloudresourcemanager.googleapis.com` enabled |
| google-genai 2.26.0 rejected `labels` in `batches.create` config with pydantic `extra_forbidden` | If labels are needed, use REST `batchPredictionJobs.create` rather than an unsupported SDK config field |

Run attributable work in a per-payer project (for example, a generic research project), not AI Studio's default `gen-lang-client-*` project.

### SDK backend spelling and precedence

Current [SDK docs](https://github.com/googleapis/python-genai#api-selection) use `genai.Client(enterprise=True)` and `GOOGLE_GENAI_USE_ENTERPRISE=True`; `vertexai=True` remains a compatibility alias. Check the installed SDK before changing existing pins: legacy SDKs such as 1.0.0 only accept `vertexai`, while 2.20.0 already accepts both.

Verified locally with `uv run --with google-genai`, version 2.26.0, without any API call. Source excerpts:

```text
client.py:404-410
if enterprise is not None and vertexai is not None and enterprise != vertexai:
  raise ValueError(
      'enterprise and vertexai flags have conflicting values, please set'
      ' enterprise value only.'
  )
resolved_vertexai = enterprise if enterprise is not None else vertexai

_api_client.py:653-657
self.vertexai = vertexai
self.custom_base_url = None
if self.vertexai is None:
  env_enterprise_str = os.environ.get('GOOGLE_GENAI_USE_ENTERPRISE', None)
  env_vertexai_str = os.environ.get('GOOGLE_GENAI_USE_VERTEXAI', None)

_api_client.py:678-681
if env_enterprise is not None:
  self.vertexai = env_enterprise
elif env_vertexai is not None:
  self.vertexai = env_vertexai
```

The enterprise environment variable wins over the legacy environment variable when both are set; an explicit constructor flag takes precedence over either. Conflicting constructor flags raise, so use one spelling, not both.

## Grounding: measured, not inferred from format

**Measured on the Developer API**, 3.8 Flash founder lookups, 2026-09-30 to 2026-10-01:

| Route / prompt | Observed grounded rows |
|---|---|
| Developer Batch / past-tense JSON question | 0/138 |
| Developer Batch / “search NOW for current pages… what they say TODAY” + system search instruction | 10/10 |
| Batch / markdown | 2/10 |
| Batch / short current-CEO question | 3/3 |
| Synchronous Standard / markdown | 92/138 |
| Flex / markdown smoke test | 8/8 successful calls grounded and returned tier=flex (10-row test, two user-reported HTTP 400 refusals) |

The user reports two HTTP 400 copyright/recitation refusals in the 10-row Flex test; the captured report independently records one unassigned 400 after 503 retries. Its 138-row pilot did not finish. Full citations and quality scores were not recovered. Do not call 8/10 a completed pilot or attribute 92/138 to markdown Batch. These Developer observations do not establish Vertex batch grounding support. Require a same-model grounded Vertex pilot; never route production to Developer Flex.

[Cloud Search docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search) say the model determines whether search improves the answer. A configured tool does not force search. JSON does not universally disable it. [Developer API, not for production: Legacy search](https://ai.google.dev/gemini-api/docs/generate-content/google-search.md.txt) returns groundingMetadata; Interactions returns google_search_call/result steps and url_citation annotations.

Prompt framing, not markdown alone, changed the observed search behavior: past-tense 0/138 versus fresh framing 10/10. Scaling the stale question would manufacture ungrounded answers, not recover history. Ask for current sources that establish the historical fact, add a system search instruction, and inspect queries/citations. This measurement is Developer-side; it does not prove Vertex batch + Search support.

2026-10-01 founder-ceo-ipo: 1,307/2,111 Developer rows failed with code 9, while the same five failed requests succeeded unchanged in a tiny batch; a 100-row retry stayed 100 pending for over 40 minutes. Developer Flex shed load at peak (503 high demand, about 9 rows/hour). Small successes are not production-capacity evidence.

## Thinking and sampling

Omit temperature, top_p and top_k for Gemini 3.x. Current 3.8 migration removes these parameters, not merely a low-temperature override. Thinking is exact-model-specific: 3.8/3.7 Flash low/medium/high; 3.5 Flash-Lite minimal/low/medium/high; 3.1 Pro Preview low/medium/high. See [models-and-pricing.md](models-and-pricing.md).

A MAX_TOKENS response can spend its whole output budget on thinking. Check content and finish reason, adjust a model-supported thinking level/output budget, and retest. Default high is not universal; 2.5 does not universally reject thinking configuration.

## Cloud batch (historical identifiers retained)

The current product is **Gemini Enterprise Agent Platform**, with historical SDK/service identifiers. `vertexai=True`, `aiplatform.googleapis.com`, `roles/aiplatform.user` and publisher resource paths are still identifiers, not names to rewrite. [Cloud batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference) supports global for base Gemini models and regional endpoints; global does not satisfy data residency requirements. us-central1 is this runbook's bucket default, not the Developer API's only region.

Observed 2026-08-30 with google-genai 2.20.0: a bare Cloud batch model ID 404'd; the publisher-qualified path and global endpoint worked for the tested 3.5 Flash-Lite job. models.list availability was not sufficient to establish batch serviceability in the requested region. Keep the correct backend/resource path, consult current model availability, and probe the same model/endpoint before production. Never silently downgrade the model to clear a 404.

Cloud metadata flattening was a production workaround for BigQuery-backed results (current BigQuery docs exclude array/struct/range/datetime/geography columns): store scalar domain IDs/model/prompt hashes, serialize complex metadata if necessary. This is not a Developer key requirement or proof that every backend forbids nested JSON.

### Current Vertex Gemini batch limits (2026-10-01)

| Limit | Vertex value |
|---|---|
| Concurrent jobs / usage quota | No predefined quota limits; shared capacity can queue jobs |
| Requests per job | 200,000 |
| GCS input file size | 1GB |
| Queue / running deadlines | Up to 72h queue; cancel incomplete work after 24h running |

Sources: [batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference), [quotas](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/quotas). No fixed 10-job/100MB batch cap applies here. Developer Tier 1 3.8 Flash's 3M queued-token cap is not a Vertex quota.

The [3.8 Flash model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash) lists batch and Search separately. Their combination is not established by those lists: test the exact grounded batch before production, stop on failure, and never fall back to Developer Flex.

## Client lifetime and result parsing

Observed inline/per-call clients failed with `Cannot send a request, as the client has been closed`. Keep one client for the process, and close it only after all work completes.

Cloud per-row failures are reported in top-level `status`; inspect it even when the overall job succeeds. GCS output is a job-specific prefix, not a single filename.

Batch JS results may be raw JSON without a hydrated `.text` getter; read candidate parts, concatenate text blocks, and inspect errors/finishReason. Do not treat the first thought part as the answer. Structured JSON validates shape, not the truth of an extraction.

## Files and File Search observations

Historical Developer PDF parsing guidance allowed up to 50MB / 1,000 pages; check the Cloud model card for production document limits; Developer Files storage is 2GB/file and 20GB/project with 48h expiry. Uploading media does not remove PDF/model/context limits. When layout/scanned pages matter, send the relevant PDF; for text-only field extraction, pre-cut the relevant section and never truncate off target evidence. See [files-api.md](files-api.md).

April 2026 Developer API File Search observations: uploadToFileSearchStore returned 503 for some files over 10KB; files.upload then importFile worked. A pager stopped after one page; explicit hasNextPage/nextPage worked. imported displayName could be a random ID; use customMetadata for domain IDs. These are recorded SDK/service observations, not permanent Google limits. Reconcile expected document counts, poll Files until ACTIVE, and inspect import errors. See [file-search.md](file-search.md).

Developer API embedding inline output order scrambled on a 21K-text production job while a three-row test passed. Use keyed file input and fresh-embedding sentinels; see [embeddings.md](embeddings.md).

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
