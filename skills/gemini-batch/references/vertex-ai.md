# Gemini Enterprise Agent Platform production batch

**NEVER use AI Studio / Gemini Developer API for production runs.** Use ADC, an explicit `vertexai=True` client, a project/location, and private GCS input/output. Technical identifiers (`aiplatform.googleapis.com`, `roles/aiplatform.*`, publisher model paths) retain their spelling; see [name changes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/vertex-ai-name-changes).

Sources checked 2026-10-01: [batch overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference), [GCS input/output](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference/new-job-from-cloud-storage), [BigQuery](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference/new-job-from-bigquery), [REST](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/batch-prediction-api), [quotas](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/quotas), [pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing).

## Setup and client

Follow [gcs-setup-runbook.md](gcs-setup-runbook.md): enable `aiplatform.googleapis.com`, configure project and ADC (`gcloud auth application-default login` for local development; workload identity/service-account ADC for unattended runs), and grant required API/storage permissions. gcloud user login and ADC are separate. Use `roles/aiplatform.user` and the required bucket read/write permissions; never make source files public to fix IAM.

```python
from google import genai

client = genai.Client(vertexai=True, project="your-project-id", location="global")
job = client.batches.create(
    model="publishers/google/models/gemini-3.5-flash-lite",
    src="gs://your-bucket/requests.jsonl",
    config={"display_name": "extraction", "dest": "gs://your-bucket/outputs/"},
)
# Poll with this same client; retrieve output only after inspecting job state.
job = client.batches.get(name=job.name)
```

`dest` is inside the job config, and is a prefix, not a single filename. SDK config types such as `CreateBatchJobConfig` are also documented; they are not forbidden. Hold one Client until submissions/polling/retries finish. Existing `google.cloud.aiplatform.BatchPredictionJob` deployments can retain their SDK/REST workflow; do not use the deprecated `google.generativeai` module API.

## GCS JSONL format

One JSONL file, one complete GenerateContentRequest in `request` per line:

```json
{"request":{"contents":[{"role":"user","parts":[{"text":"Extract the dates"},{"fileData":{"fileUri":"gs://your-bucket/documents/doc-1.pdf","mimeType":"application/pdf"}}]}],"generationConfig":{"responseMimeType":"application/json","responseSchema":{"type":"OBJECT","properties":{"dates":{"type":"ARRAY","items":{"type":"STRING"}}},"required":["dates"]}}},"metadata":{"request_id":"doc-1","prompt_version":"v1"}}
```

`metadata.request_id` is the bundled examples' **local correlation convention**, not a mandatory Cloud API field. Use unique stable domain IDs; verify metadata round-trip in the 5–10-row Cloud sample before scaling. Do not assume Developer `key` semantics apply to generative Cloud output. Keep metadata scalar or serialize complex values; BigQuery column restrictions are described below. Validate the examples' convention with `scripts/validate_jsonl.py --backend cloud`.

Raw JSONL uses `generationConfig`, `responseMimeType`, `responseSchema`, and `thinkingConfig.thinkingLevel` if set. Do not put SDK/Pydantic classes or Developer Interactions `response_format` in JSONL. Omit Gemini 3 sampling controls; exact thinking levels are model-specific. See [structured-output.md](structured-output.md).

## Output and acceptance

The GCS docs show output rows with `request`, `response`, `status`, and `processed_time`: `status` is empty for a successful row and contains error details for failures. Completed rows are continuously exported during long jobs, and completed work remains when a job is terminated. A terminal job state is not per-row success.

- Read `job.dest.gcs_uri` for this job's output destination and enumerate that prefix's JSONL shards. Do not download the shared parent prefix and mix other jobs into the results.
- Check top-level `status` and any `error`; extract candidate text parts while excluding thoughts; check finishReason and schema/evidence. Treat missing/invalid text as failure, not `{}` success.
- Join by verified domain ID, never line order. Reject missing IDs/duplicates and reconcile every input. Retry failed/missing rows with the original identifiers.
- For grounded rows inspect `candidates[].groundingMetadata` and citations. Search tooling and schema compatibility must pass the exact Cloud batch sample; configuring a tool does not prove it ran. Batch explicitly excludes RAG.

## Limits and locations

| Item | Cloud Gemini generative batch |
|---|---|
| Requests per job | Up to 200,000 |
| GCS source | One JSONL file, up to 1 GB |
| Fixed concurrency / enqueued tokens | No predefined Gemini quota; shared capacity, dynamically scheduled |
| Queued | Up to 72h before expiry |
| Running | Most finish within 24h; incomplete work cancelled after 24h running |
| Billing | Completed requests only; 50% off real-time token rates; cache-hit 90% discount takes precedence, not stacked |
| Global | Base Gemini models, no residency guarantee; not tuned models |
| Tuned Gemini 3+ | Batch unsupported |
| Other exclusions | Provisioned Throughput, explicit caching, RAG; generated images only default 1K |

The current support list includes 3.8/3.7/3.6 Flash, 3.5 Flash-Lite/Flash, 3.1 Pro Preview, and 2.5 models. Pin a real model from its Cloud card; verify the exact [location](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations). A historic `us-central1` rejection for 3.5 Flash-Lite was fixed by global, not a model downgrade. `models.list()` alone is not a batch availability probe. GCS in us-central1 with a global endpoint worked in that probe; there is no universal us-central1-only bucket rule.

## BigQuery alternative

Cloud also accepts `bq://project.dataset.table` input/output. A valid JSON `request` column is required, matching GenerateContentRequest. Extra supported scalar columns are copied to output; array, struct, range, datetime and geography columns are unsupported. `response` and `status` are reserved. Input/output datasets must meet the documented same-region requirements; multi-region input datasets are unsupported. Verify region compatibility before substituting BigQuery for this skill's GCS production path.

[Cloud ADC](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment): service-account ADC can use `GOOGLE_APPLICATION_CREDENTIALS` when already provisioned, but prefer workload identity rather than adding key files. Never commit credentials. Developer API keys/Files and `job.dest.file_name` belong to a different backend and are not production fallbacks.
