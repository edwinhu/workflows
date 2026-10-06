---
name: gemini-batch
version: 1.0
description: "Use when the user says 'run this prompt over all the documents', 'process thousands of PDFs', 'extract fields from every filing', 'bulk LLM job', 'submit a batch job', 'Gemini Batch API', 'upload files to Gemini', 'flex', 'flex tier', 'Interactions API', 'cheap async Gemini', 'grounded lookups at scale', 'hand-code these', 'gold set', 'gold standard', 'code each filing', 'label / annotate these documents', 'have agents read each document', or 'coders', or needs Gemini extraction, classification or enrichment — large-scale through Cloud Batch, or a few documents (≤10) through Cloud Flex."
user-invocable: false
---

# Gemini production batch

<EXTREMELY-IMPORTANT>
## IRON LAW: NEVER use AI Studio for production runs

**NEVER USE AI STUDIO / THE GEMINI DEVELOPER API FOR PRODUCTION RUNS.** Production batch runs use **Gemini Enterprise Agent Platform (formerly Vertex AI)**: `genai.Client(vertexai=True, project=..., location=...)`, Application Default Credentials (ADC), and GCS input/output. Substituting API-key/Files batch is not a shortcut: it sends the production workload to the wrong service.

- **2026-10-01, Developer API:** a 2,111-row grounded batch returned 1,307 `code 9 "Precondition check failed"` rows; its retry queue stalled over 40 minutes. Tier 1's `gemini-3.8-flash` queue cap was 3M tokens. Repeating that production route recreates the failure, not a cheaper solution. These are Developer limits, not Cloud quotas.
</EXTREMELY-IMPORTANT>

[Product name](https://docs.cloud.google.com/gemini-enterprise-agent-platform/vertex-ai-name-changes); current SDK docs use `enterprise=True` / `GOOGLE_GENAI_USE_ENTERPRISE=True`; `vertexai=True` remains compatible. Check [SDK spelling and precedence](references/gotchas.md#sdk-backend-spelling-and-precedence) before changing pins. `aiplatform.googleapis.com` and IAM `roles/aiplatform.*` retain their identifiers. Developer examples retained in references are **not for production**.

## Choose the Cloud tier

**Route by row count: ≤10 documents/rows → Cloud Flex PayGo; more → Cloud Batch.** This is a judgment default from Flex throughput (~9 rows/hour at peak, measured on Developer Flex). Flex gives the same 50% discount as one direct `generate_content` call per row: no GCS JSONL, no queue, no import-format failures. A bulk-guard redirect for a few documents lands on Flex, not a Batch job; recipe in [Flex](references/flex-inference.md#few-document-extraction).

| Tier | Use | Price / availability | Request path |
|---|---|---|---|
| Cloud Batch (Recommended for >10 rows) | Independent extraction/classification and tested grounded lookups | 50% off real-time; shared capacity; up to 72h queued, then most jobs finish within 24h running | GCS JSONL → `client.batches.create`; `config.dest` → GCS |
| Cloud Standard PayGo | Same-model synchronous smoke tests; interactive search | Standard Cloud tariff; capacity/model-dependent | `client.models.generate_content` with ADC |
| Cloud Flex PayGo (Preview) (Recommended for ≤10 rows) | Few-document extraction; small, synchronous, latency-tolerant lookups | 50% off Standard; higher throttling; global only; timeout up to 30 min | Vertex header `X-Vertex-AI-LLM-Shared-Request-Type: flex` |
| Cloud Priority PayGo | Latency-sensitive work, not cheap bulk | Higher model-specific tariff; global and supported us/eu multi-regions, not regional endpoints | Same Vertex header, value `priority` |

Sources: [Batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference), [Flex](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/flex-paygo), [Priority](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/priority-paygo), [Cloud pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing). Cloud Flex/Priority are documented equivalents, **not** the Developer Interactions `service_tier` recipe or its quotas; read [tier request patterns](references/flex-inference.md).

Cloud [Interactions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/interactions) is Preview; `generateContent` remains fully supported. Production batch uses GenerateContentRequest JSONL, not `interactions.create` or an Interactions background task.

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

## Before writing code

**READ EXAMPLES BEFORE WRITING ANY CODE. NO EXCEPTIONS.**

**NO BULK SUBMISSION WITHOUT A SAME-MODEL CLOUD SMOKE TEST AND A 5–10-ROW CLOUD END-TO-END TEST.** Skipping these scales bad prompts, lost identifiers and ungrounded answers into a bad dataset.

1. Read [Cloud batch](references/vertex-ai.md), the [ADC/GCS setup runbook](references/gcs-setup-runbook.md), and `examples/batch_processor.py` or `examples/icon_batch_vision.py`. Verify project, API enablement, ADC, IAM and readable input/writable output GCS paths. gcloud user login alone is not ADC. Flex route (≤10 rows): read [Flex](references/flex-inference.md) instead of the GCS runbook.
2. Fetch current Cloud [model cards](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models), [locations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations), [batch support](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference), [thinking](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking) and [pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing). New-project extraction defaults: `gemini-3.5-flash-lite` for cheap extraction, `gemini-3.8-flash` for harder extraction/search. Preserve existing model pins; Flash/Flash-Lite is the measured extraction default, not Pro. See [model-selection evidence](references/model-selection.md).
3. **For Gemini 3.x, omit temperature, top_p and top_k.** Use exact-model-supported thinking levels: 3.8 Flash supports low/medium/high, not minimal. See [Cloud model guidance](references/models-and-pricing.md).
4. Send relevant native PDF pages via GCS `fileData.fileUri`; preserve layout/scans. For text-native filings, pre-cut relevant sections without truncating target evidence. Historical PDF cost observations are in [Files](references/files-api.md), not a universal tokens/page tariff.
5. Run one synchronous Cloud request with the exact model/input/schema, then 5–10 rows through the actual Cloud batch/tier. Inspect content, per-row `status` errors, finish reasons, usage, identifier round-trip and grounding if required. Follow [scale-up testing](references/scale-up-testing.md). A ≤10-row Flex job has no separate pilot: its first row is the smoke test.

## Production request pattern

```python
from google import genai

client = genai.Client(vertexai=True, project="your-project-id", location="global")
job = client.batches.create(
    model="publishers/google/models/gemini-3.5-flash-lite",
    src="gs://your-bucket/requests.jsonl",
    config={"display_name": "extraction", "dest": "gs://your-bucket/outputs/"},
)
```

Keep this client alive through submission, polling and retries. `dest` is a GCS prefix **inside config**, not a filename or top-level kwarg; after completion use the job's returned destination. Cloud input has `request` plus the examples' scalar correlation metadata, not Developer Files semantics. Validate with `scripts/validate_jsonl.py --backend cloud`; see [request/output format](references/vertex-ai.md) and [schema](references/structured-output.md).

## Cloud batch limits

| Limit | Current Cloud Gemini batch |
|---|---|
| Requests/job | 200,000 |
| GCS JSONL input | One file, up to 1 GB |
| Concurrent Gemini jobs / enqueued tokens | No predefined quota; dynamically shared model capacity (not Developer Tier 1 caps) |
| Queue expiry | Up to 72h before starting |
| Running time | Most complete within 24h; incomplete jobs cancelled after 24h running, charged for completed requests |
| Endpoint | Global for base models; supported regional endpoints for residency; global does not satisfy residency |
| Unsupported batch features | Provisioned Throughput, explicit caching, RAG; tuned Gemini 3+ models |

Sources: [batch limits](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference), [quotas](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/quotas). Embedding batch has separate [Cloud limits/schema](references/embeddings.md). BigQuery is a documented alternative, with regional constraints; GCS is this skill's production default.

## Grounding and acceptance

- Configure Google Search through the Cloud GenerateContentRequest tool shape and inspect `candidates[].groundingMetadata` per row. [Cloud grounding](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search) and model support are not a promise that every batch+search+schema combination works; the exact Cloud end-to-end sample must prove it. Read [measured Cloud gotchas](references/gotchas.md#cloud-batch-facts--measured-2026-10-01) before grounded submission: empty `googleSearch` fails import; M100 grounded 97/100 on 3.8 Flash/global. Cloud batch excludes RAG/File Search.
- **Measured on Developer API, not a Cloud availability claim:** past-tense founder framing grounded 0/138; fresh framing (“Search the web NOW for current pages… report what they say TODAY”) grounded **10/10**, 1.9 searches/row. Flex shed load with 503s at peak, about 9 rows/hour. Prefer fresh framing and verify the Cloud sample; do not route bulk to Flex merely because an old prompt failed. More evidence: [gotchas](references/gotchas.md).
- Bulk (>10-row) per-document extraction is one Cloud Batch job over pre-cut inputs, **never an interactive-agent fan-out**. A 297-prospectus coder run consumed all three shared Claude accounts; it belonged in Batch.
- Reconcile every input identifier, duplicate/missing output and row error; preserve IDs on retry. A succeeded job or valid JSON is not correctness evidence. Budget input/output and search separately; a prompt search cap is not an enforced quota. Before a full grounded run, measure about 100 Cloud rows and project query cost from usage, not the requested cap.
- **NO GROUNDED RUN OVER ~100 ROWS WITHOUT A USER-APPROVED COST PROJECTION:** rows × pilot-measured queries/row × $14/1,000, minus the remaining free allowance; set a budget alert first. Searches were $390 of a $421 bill and every alert arrived after the spend. Formula, SKUs and the Billing → Reports URL: [search cost gate](references/gotchas.md#search-cost-gate--the-real-bill-sep-28--oct-2).
- Use the harness's background notification mechanism for long monitoring, not a model session repeatedly narrating status. Do not switch backend, model, schema or location to clear an error without retesting.

## Red flags — STOP

| About to | Do instead |
|---|---|
| Use `genai.Client()` without `vertexai=True` for a production batch | **STOP.** Use explicit Cloud client, project/location and ADC |
| File API upload for a production job | **STOP.** Use private GCS input and output |
| Pass `dest=` to create, or use a filename as output | **STOP.** Put the GCS output prefix in `config.dest`; retrieve this job's actual destination |
| Use a bare model resource after a Cloud batch 404 | **STOP.** Use `publishers/google/models/<id>` and verify the exact endpoint |
| Infer batch availability from `models.list()` or downgrade to clear 404 | **STOP.** Check Cloud support and run the same-model Cloud batch sample |
| Put Batch requests into `interactions.create` | **STOP.** Batch uses GenerateContentRequest JSONL and `client.batches.create` |
| Switch platforms or abandon a batch approach | **STOP.** Cancel every job and runner of the old approach — list its batches, stop the poller/farm — and confirm none are pending. An unstopped AI Studio retry runner billed searches for ~8h after the move to Vertex |
| Accept a succeeded job without row reconciliation | **STOP.** Inspect status, content, finish reason, identifiers and grounding |

Operations: [GCS](references/gcs-setup.md), [CLI](references/cli-reference.md), [troubleshooting](references/troubleshooting.md), [production patterns](references/best-practices.md). Historical [Developer File Search](references/file-search.md) and Files/Interactions/embedding examples are **not for production**; never use them as production fallbacks.
