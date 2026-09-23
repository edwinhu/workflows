---
name: gemini-batch
version: 1.0
description: "Use when the user says 'run this prompt over all the documents', 'process thousands of PDFs', 'extract fields from every filing', 'bulk LLM job', 'submit a batch job', 'use the Gemini Batch API', 'upload files to Gemini', or 'this is too many to do one at a time' - any large-scale LLM extraction or classification over many files. ALWAYS load before writing Gemini batch code, including the small test run."
user-invocable: false
---

# Gemini Batch API Skill

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Large-scale asynchronous document processing using Google's Gemini models.

## When to Use

- Process thousands of documents with the same prompt
- Cost-effective bulk extraction (50% cheaper than synchronous API)
- Jobs that can tolerate 24-hour completion windows

## IRON LAW: Use Examples First, Never Guess API

**READ EXAMPLES BEFORE WRITING ANY CODE. NO EXCEPTIONS.**

### The Rule

```
User asks for batch API work
    ↓
MANDATORY: Read examples/batch_processor.py or examples/icon_batch_vision.py
    ↓
Copy the pattern exactly
    ↓
DO NOT guess parameter names
DO NOT try wrapper types
DO NOT improvise API calls
```

### Why This Matters

The Batch API has non-obvious requirements that will fail silently:
1. **Metadata must be flat primitives** - Nested objects cause cryptic errors
2. **`dest` is a config field, not a kwarg** - Pass via `config={"dest": "gs://..."}`. Older SDKs accepted `dest=` directly; newer ones raise TypeError.
3. **Config is plain dict** - Not a wrapper type
4. **Examples are authoritative** - Working code beats assumptions

**Rationale:** Previous agents wasted hours debugging API errors that the examples would have prevented. The patterns in `examples/` are battle-tested production code.

### Red Flags

- About to pass `dest=` as a kwarg → STOP. That works on older SDKs only; the current SDK puts `dest` inside `config={}`. Read the examples.
- About to instantiate a `CreateBatchJobConfig` object → STOP. The config is a plain dict, not a wrapper type.
- About to nest metadata like a normal API → STOP. Nested objects trigger BigQuery type errors; flatten the data.
- About to assume this works like other Google APIs → STOP. This API is different; the examples are authoritative.
- About to improvise the JSONL format → STOP. Copy the structure from the examples instead.

### MANDATORY Checklist Before ANY Batch API Code

- [ ] Read `examples/batch_processor.py` OR `examples/icon_batch_vision.py`
- [ ] Identify which example matches the use case (Standard API vs Vertex AI)
- [ ] Copy the example's API call pattern **exactly**
- [ ] Copy the example's JSONL structure **exactly**
- [ ] Copy the example's metadata structure **exactly**
- [ ] Adapt for specific needs only after copying base pattern

**Enforcement:** Writing batch API code without reading examples first violates this IRON LAW and will result in preventable errors.

## Prerequisites

**CRITICAL:** Vertex AI requires ADC (`gcloud auth application-default login`), not just an API key.
**CRITICAL:** Gemini Batch only works with buckets in `us-central1`.

Check: `LINES=1000 COLUMNS=250 GCP_PROJECT=.. BUCKET=.. upmd --ci --block verify ${CLAUDE_SKILL_DIR}/references/gcs-setup-runbook.md` (or run that block by hand without upmd).
Setup: the user runs the whole thing, `GCP_PROJECT=.. BUCKET=.. upmd --cli --all ${CLAUDE_SKILL_DIR}/references/gcs-setup-runbook.md` (idempotent; its `manual-*` logins need a human).

## Quick Start

### Standard Gemini API (API Key)

Uses the Gemini File API for input. Results returned via `batch_job.dest.file_name`.

```python
from google import genai

client = genai.Client()  # Uses GOOGLE_API_KEY env var

# Upload JSONL to File API
uploaded = client.files.upload(
    file="requests.jsonl",
    config={"mime_type": "application/jsonl"}
)

# Submit batch job
job = client.batches.create(
    model="gemini-2.5-flash-lite",
    src=uploaded.name,  # "files/..." URI
    config={"display_name": "my-batch-job"}
)

# Results available at job.dest.file_name after completion
```

### Vertex AI (Recommended for GCS workflows)

Uses GCS URIs directly. `dest` is a **field of the `config` dict** in the
current SDK (older SDKs accepted `dest=` as a kwarg — that now raises
`TypeError: Batches.create() got an unexpected keyword argument 'dest'`).

```python
from google import genai

# Use Vertex AI with ADC (not API key)
client = genai.Client(
    vertexai=True,
    project="your-project-id",
    location="us-central1"
)

# Submit batch job with GCS paths.
# Current SDK signature: create(*, model, src, config)
job = client.batches.create(
    model="gemini-2.5-flash-lite",
    src="gs://bucket/requests.jsonl",     # GCS input
    config={
        "display_name": "my-job",
        "dest": "gs://bucket/outputs/",   # GCS output (Vertex AI only!)
    },
)
```

Verify your SDK before changing: `inspect.signature(client.batches.create)`.
If `dest` is in the kwargs, the kwarg form works; otherwise use config.

**Key difference:** Standard API uses File API (`files/...`), Vertex AI uses GCS (`gs://...`) with `dest` (now a config field).

## Core Workflow

**Standard API:**
1. **Create JSONL** request file with prompts
2. **Upload JSONL** to File API via `client.files.upload()`
3. **Submit batch job** via `client.batches.create(src=uploaded.name)`
4. **Monitor for completion** — use Monitor tool (jobs expire after 24 hours)
5. **Download results** from `job.dest.file_name`

**Vertex AI:**
1. **Upload files** to GCS bucket (us-central1 region required)
2. **Create JSONL** request file with document URIs and prompts
3. **Submit batch job** via `client.batches.create(src=..., config={"dest": ...})`
4. **Monitor for completion** — use Monitor tool (jobs expire after 24 hours)
5. **Download and parse** results from GCS output URI
6. **Handle failures** gracefully (partial failures are common)

### Monitoring Batch Jobs with Monitor Tool

After submitting a batch job, use Monitor instead of sleep-polling in Python:

```
Monitor(
  description="Gemini batch job progress",
  persistent=true,
  timeout_ms=3600000,
  command="while true; do uv run python3 -c \"import google.genai as genai; j=genai.batches.get(name='$JOB_NAME'); print(f'{j.state} | {j.name}'); exit(0 if j.state in ('JOB_STATE_SUCCEEDED','JOB_STATE_FAILED','JOB_STATE_CANCELLED') else 1)\" && break; sleep 60; done"
)
```

This frees the conversation to continue working while the batch runs. You get notified when the job completes or fails — no polling loop blocking your context.

## Key Gotchas (API Structure)

**Metadata must be flat primitives** (no nested objects — BigQuery-backed storage). **`dest` is a config field, not a top-level kwarg** in the current SDK (Vertex AI only). **Config is a plain dict** (not a wrapper type).

See the Red Flags in the first Iron Law section above — the same gotchas apply here. The Key Gotchas table below summarizes all critical issues.

## Key Gotchas

| Issue | Solution |
|-------|----------|
| **Nested metadata fails** | **Use flat primitives or `json.dumps()` for complex data** |
| **TypeError: unexpected keyword `dest`** | **Move `dest` inside `config={}` (Vertex AI; current SDK)** |
| **Mixing API patterns** | **Standard API: File API + no dest. Vertex AI: GCS + dest** |
| Auth errors with Vertex AI | Run `gcloud auth application-default login` |
| vertexai=True requires ADC | API key is ignored with vertexai=True |
| Missing aiplatform API | Run `gcloud services enable aiplatform.googleapis.com` |
| Region mismatch (Vertex) | Use `us-central1` bucket only |
| Wrong URI format (Vertex) | Use `gs://` not `https://` |
| Invalid JSONL | Use `scripts/validate_jsonl.py` |
| Image batch: inline data | Use `fileData.fileUri` for batch, not inline |
| Duplicate IDs | Hash file content + prompt for unique IDs |
| Large PDFs fail | Split at 1,000 pages / 50MB max (the per-file limit) |
| JSON parsing fails | Use robust extraction (see gotchas.md) |
| Output not found (Vertex) | Output URI is prefix, not file path |
| **`uploadToFileSearchStore` 503 for files >10KB** | **Use two-step: `files.upload()` then `fileSearchStores.importFile()`** |
| **File stuck in PROCESSING state** | **Poll `files.get()` until state is ACTIVE before importing** |
| **SDK Pager stops after first page** | **Use `pager.hasNextPage()` + `pager.nextPage()`, NOT `for await`** |
| **Batch `inlinedResponse.response.text` is undefined** | **Response is raw JSON, not hydrated class. Use `candidates[0].content.parts[0].text`** |
| **Store document displayName is random ID after importFile** | **Read bibkey from `customMetadata`, not `displayName`** |
| **`responseMimeType` + tools in batch = error code 3** | **Omit responseMimeType when using tools; use prompt-based JSON instructions** |
| **RuntimeError: Cannot send a request, as the client has been closed** | **Hold ONE `genai.Client` for the process; an inline/per-call client is GC'd mid-request** |
| **Vertex batch: 404 `The PublisherModel <id> does not exist`** | **Qualify it: `publishers/google/models/<id>` — the bare id works only on the Standard API** |
| **Vertex batch 404 on a model `models.list()` SHOWS in the region** | **Listing ≠ batch-servable. Fix the LOCATION, not the model: `location="global"` for 3.x — it accepts a us-central1 src/dest. Downgrading a tier silently changes output** |

**Top 3 mistakes** (bolded above):
1. Using nested objects in metadata instead of flat primitives
2. Mixing Standard API and Vertex AI patterns
3. Passing `dest=` as a kwarg instead of inside `config={}` (Vertex AI; current SDK)

See `references/gotchas.md` for detailed solutions (now with Gotchas 10-20; 18-20 are Vertex-batch specific).

## Red Flags — STOP If You Catch Yourself:

| About to | Why Wrong | Do Instead |
|---|---|---|
| Write `genai.Client().batches.get(...)` inline, or a `def client(): return genai.Client(...)` factory | The client owns an httpx pool and closes it on `__del__`; the request dies mid-flight with `Cannot send a request, as the client has been closed`. Fatal in polling loops. | Hold a module-level singleton for the life of the process |
| Run `pdftotext` and send the string because "text is cheaper" | It is not: 258 tokens/page vs ~4 chars/token, and native PDF text is unbilled. Measured 22% *more* expensive, plus truncation and manual OCR | Send the PDF via `fileData.fileUri` |
| Pass a bare model id to `batches.create` on a Vertex client | Batch needs the publisher path; the bare id 404s even though `generate_content` accepts it | `publishers/google/models/<id>` |
| Conclude a model is unavailable — or available — from `models.list()` | Listing is not a batch-availability check: `us-central1` lists 3.x models that batch then 404s, because 3.x is `location: global` | Submit a probe job (~20s). Fix the LOCATION; never downgrade a tier to clear a 404 — that swaps the model your evals were run on |
| Reuse one `generationConfig` across model tiers | 3.x needs `thinkingConfig` pinned or it returns empty on MAX_TOKENS; 2.5 rejects the field outright | Set `thinkingConfig` only for `gemini-3*`, per Gotcha 17/20 |
| Debug a Vertex 404 by reading docs instead of listing + submitting | The error text names the model, never the region or the availability rule — it is the same string for three different causes | Check Gotchas 19 and 20 before assuming the id is wrong |

## Send the PDF, not extracted text

<EXTREMELY-IMPORTANT>
**When the source is a PDF, send the PDF. Do NOT run `pdftotext` and send the string.**

Gemini bills a document at **258 tokens per page**, and native text extracted from the PDF is
**not charged at all** (Google's document-processing docs, verified 2026-08-31). Extracted text is
billed as ordinary input at roughly 4 chars/token, so for text-heavy documents the string is the
*more* expensive representation. Measured on a 1,313-document legal corpus — 21,393 pages,
28.2M extracted characters:

| representation | tokens |
|---|---|
| the PDFs | **5,519,394** |
| pdftotext output | 7,050,563 |

**Extracting first cost 22% more and bought nothing.** It also created three problems that do not
exist when you send the document:

- **You will truncate.** A char cap drops whatever sits at the end — in that corpus, counsel's
  signature block, which silently blanked a required field on every long document until it was
  caught by hand.
- **You will OCR scans yourself.** 99 image-only PDFs were run through tesseract at real
  wall-clock cost; Gemini reads scanned pages natively at the same 258/page.
- **You lose layout.** Tables, exhibits and signature blocks arrive as flattened text, and the
  model can no longer see the structure it would use to disambiguate them.

Reach for `pdftotext` only to *triage* locally (is this file a scan? how long is it?) — never as
the transport into the model.
</EXTREMELY-IMPORTANT>

Limits: **50 MB or 1,000 pages** per file, for both inline data and Files API uploads. Batch
requests reference the document with `fileData.fileUri` (a GCS URI on Vertex); never inline the
bytes in a batch JSONL.

## Rate Limits

| Limit | Value |
|-------|-------|
| Max requests per JSONL | 10,000 |
| Max concurrent jobs | 10 |
| Max job size | 100MB |
| Job expiration | 24 hours |

## Recommended Models

### ALWAYS verify model IDs and pricing against the live docs

**Never recall a model ID or a price from training data — it is always stale.** Fetch the `.md.txt` variants (LLM-optimized, far easier to parse than the HTML):

- Models: `https://ai.google.dev/gemini-api/docs/models.md.txt`
- Pricing: `https://ai.google.dev/gemini-api/docs/pricing.md.txt`

Real failures this prevents (encountered 2026-08-03):

- A plan specified `gemini-3-pro` — **that ID does not exist.**
- A config carried `gemini-3.1-flash-lite` priced at `{input 0.125, output 0.75}`; the current lineup has `gemini-3.5-flash-lite` at `{input 0.30, output 2.50}` standard, `{0.15, 1.25}` batch.
- **Version numbers do not stay in parity across lines.** As of 2026-08-03 there is a `gemini-3.6-flash` but **no** `gemini-3.6-flash-lite`; the newest Flash-Lite is `gemini-3.5-flash-lite`.

Batch API pricing is 50% of standard across models.

### Model selection: default to Flash / Flash-Lite for extraction

**For structured information extraction — schema-constrained JSON pulled out of documents — default to Flash or Flash-Lite. Reserve Pro for tasks needing genuine reasoning.** Do not reach for Pro by default just because the task feels important.

Measured 2026-08-03 on the `realpage` project (SEC IPO prospectus extraction; ~16,700 input tokens/doc, ~350-600 output; identical prompt, identical 100 documents):

| model | finds the target provision | quote-verification | judge | cost/doc | 1,926-doc run |
|---|---|---|---|---|---|
| `gemini-3.1-pro-preview` | 47% | 97.9% | 1.00 | $0.0187 | ~$36 |
| `gemini-3.6-flash` | 62% | 95.2% | 0.85 | $0.0151 | ~$29 |
| `gemini-3.5-flash` | 70% | 94.3% | 1.00 | $0.0149 | ~$29 |

**Pro was the most conservative extractor, not the best one.** It found the target provision in 47% of documents where Flash found 62-70% of the *same* documents. On an extraction task Pro's extra reasoning showed up as under-extraction — the failure mode that silently biases a research dataset. Scored against **held-out human hand-coding** (20 rows the research team coded before the pipeline existed, never having seen a machine output), **all four models were identical** — 85.0% exact agreement, 90% recall on real entitlements, 80% exact on those — and they failed on the *same three rows*. So Pro's extra reasoning bought nothing measurable, while its conservatism cost 15-23 points of detection.

Two honest caveats. The human sample was small (20 rows, 11 companies), and identical failures on identical rows says the *residual* errors were structural — a provision filed in an exhibit rather than the prospectus, a right held through a GP entity — not model quality. And the detection gap itself stayed **unresolved**: on the documents where models disagreed there was no ground truth, so which model is right on that 23-point spread was still open. Do not read this table as "Flash is more accurate"; read it as "Pro was not measurably better, and was measurably quieter."

**Cost savings from Pro → Flash are smaller than people expect when the task is input-dominated.** Here it was only ~20%, because Flash input is $0.75/1M against Pro's $1.00, while output — where Flash is much cheaper — was a rounding error at ~350 tokens. **Flash-Lite is the only tier that cuts input price materially** ($0.15/1M, ~85% saving). Work out whether the job is input- or output-dominated *before* assuming a Flash switch saves real money: compute `mean_input_tokens * input_price` vs `mean_output_tokens * output_price` from a Stage 2 sample (see `references/scale-up-testing.md`).

| Model | Use Case | Cost | Location | Thinking default |
|-------|----------|------|----------|------------------|
| `gemini-2.5-flash-lite` | Most batch jobs | Lowest | us-central1 | OFF |
| `gemini-2.5-flash` | Complex extraction | Medium | us-central1 | OFF |
| `gemini-2.5-pro` | Highest accuracy | Highest | us-central1 | ON (cannot disable) |
| `gemini-3-flash-preview` | New gen, larger context | 5× flash-lite | **global** | **HIGH (set MINIMAL!)** |
| `gemini-3.1-flash-lite-preview` | Cheapest gen-3 | ~2× 2.5 flash-lite | **global** | **HIGH (set MINIMAL!)** |
| `gemini-embedding-001` | **Default for text-only** (short titles, classification, retrieval over text) | Low | Standard API | n/a |
| `gemini-embedding-2` | Multimodal (text+image) inputs | Low | Standard API | n/a |
| `text-embedding-005` | Need Vertex Batch console visibility (legacy) | Low | us-central1 | n/a |

**Critical for Gemini 3.x:** Always pin `thinkingConfig: {thinkingLevel: ...}` in `generationConfig` or batch responses will silently fail with `MAX_TOKENS` and empty content. **The level is not the same across tiers:** Flash and Flash-Lite accept `MINIMAL`, but **Pro rejects it** ("Thinking level MINIMAL is not supported for this model", verified 2026-08-03) and needs `LOW`. Use a helper that picks the level per model — a single hardcoded constant breaks when you switch tiers. See `references/gotchas.md` Gotcha 17.

**Critical for embedding batches:** Embedding work has its own rules and failure modes — use **file-based JSONL with per-row `key`** on the Standard API; never `inlined_requests` (scrambles order at scale). Default to `gemini-embedding-001` for text-only tasks. **See [`references/embeddings.md`](references/embeddings.md) and [`examples/embeddings_batch.py`](examples/embeddings_batch.py).**

## Additional Resources

### References
- `references/embeddings.md` - **NEW:** Dedicated reference for embedding batches (model choice, file-based + keyed pattern, sentinel verification)
- `references/gcs-setup-runbook.md` - One-time GCP setup as an upmd runbook (install, auth, APIs, bucket) with a `verify` block
- `references/gcs-setup.md` - GCS usage: uploads, permissions, lifecycle, troubleshooting
- `references/gotchas.md` - 20 critical production gotchas (Gemini 3.x thinking_level per tier, location='global'; embedding gotcha now lives in embeddings.md)
- `references/best-practices.md` - Idempotent IDs, state tracking, validation
- `references/scale-up-testing.md` - Incremental scale-up testing (LangExtract prototyping, LLM-as-judge, Vertex AI batch, gate design, input- vs output-dominated cost)
- `references/troubleshooting.md` - Common errors and debugging
- `references/vertex-ai.md` - Enterprise alternative with comparison
- `references/cli-reference.md` - gsutil and gcloud commands
- `references/files-api.md` - Files API: upload, poll-until-ACTIVE, 48h expiry, size limits
- `references/file-search.md` - File Search (managed RAG): store creation, metadata filtering, grounding metadata
- `references/structured-output.md` - `responseJsonSchema` / `responseSchema`: the supported schema subset, enums

### Examples
- `examples/icon_batch_vision.py` - **NEW:** Batch vision analysis with Vertex AI
- `examples/batch_processor.py` - Complete GeminiBatchProcessor class
- `examples/embeddings_batch.py` - **NEW:** `gemini-embedding-2` via `client.batches.create_embeddings()` (the only supported production path; Vertex Batch rejects this model)
- `examples/pipeline_template.py` - Customizable pipeline template

### Scripts
- `scripts/validate_jsonl.py` - Validate JSONL before submission
- `scripts/test_single.py` - Test single request before batch

## External Documentation

- [Gemini Batch API Guide](https://ai.google.dev/gemini-api/docs/batch)
- [Google Cloud Storage](https://cloud.google.com/python/docs/reference/storage/latest)
- [Vertex AI Batch Prediction](https://cloud.google.com/vertex-ai/docs/predictions/batch-predictions)

## Date Awareness

Gemini API evolves rapidly. For API features or model names with uncertainty, verify against current documentation.
