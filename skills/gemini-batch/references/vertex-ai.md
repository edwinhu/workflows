# Gemini Enterprise Agent Platform Cloud batch

Google renamed Vertex AI Platform to **Gemini Enterprise Agent Platform** and Generative AI on Vertex AI to **Generative AI on Gemini Enterprise Agent Platform**. Source: [name changes](https://cloud.google.com/gemini-enterprise-agent-platform/vertex-ai-name-changes). This filename is retained for existing links; SDK `vertexai=True`, `aiplatform.googleapis.com` and IAM `roles/aiplatform.*` are still technical identifiers.

[Batch inference with Gemini](https://cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-prediction-gemini) still exists, separate from Developer Batch. [REST reference](https://cloud.google.com/gemini-enterprise-agent-platform/reference/models/batch-prediction-api).

## Choose a backend

| Feature | Developer Batch | Cloud batch prediction |
|---|---|---|
| Input/output | Files or inline requests; keyed output file or inline responses | Cloud Storage or BigQuery; Cloud output prefix/tables |
| Setup | API key | Project, ADC for these GCS examples, Cloud API and IAM |
| Limits | 100 concurrent requests, 2GB input, model/tier enqueued tokens | 200,000 requests/job, 1GB GCS input; shared capacity pool |
| Endpoint | Developer API | Global for base Gemini models; regional endpoints for residency |
| Token pricing | 50% off Developer Standard | 50% off Cloud real-time; verify Cloud pricing separately |

Cloud requests can queue for up to 72h before expiring; most running jobs finish within 24h, after which incomplete work is cancelled. Do not call queue time part of a universal 24h expiry. Global improves availability but does not meet data residency requirements. There is no universal us-central1-only rule.

## google-genai GCS example

The current SDK uses `create(model, src, config)`; for Cloud GCS output, `dest` is in config. Keep one client for the entire workflow. The ADC/GCS setup is in [gcs-setup-runbook.md](gcs-setup-runbook.md).

```python
from google import genai

client = genai.Client(
    vertexai=True, project="your-project-id", location="global"
)
job = client.batches.create(
    model="publishers/google/models/gemini-3.5-flash-lite",
    src="gs://your-bucket/requests.jsonl",
    config={"display_name": "extraction", "dest": "gs://your-bucket/outputs/"},
)
```

This is not Developer JSONL: Cloud examples use `request` plus scalar metadata for row correlation. Consult current Cloud input formats and verify output metadata end to end; do not transfer Developer `key` semantics blindly. `dest` is an output prefix, not a single result filename.

[Cloud authentication](https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment): user gcloud login and Application Default Credentials are separate. These examples use ADC, project and location, not Developer API-key authentication. Do not infer that every other Cloud inference offering ignores API keys.

Existing examples resolve shared plugin model roles. Pass an explicit current model for a new project and verify that model's Cloud batch support/endpoint; models.list alone is not a successful Batch probe. See [gotchas.md](gotchas.md) for the measured publisher-path/global-endpoint failures.

## Existing aiplatform SDK deployments

The Cloud REST batchPredictionJobs path remains available; an existing aiplatform deployment can retain its SDK instead of rewriting to google-genai. Verify the model/endpoint on the same 5–10-row sample.

```python
from google.cloud import aiplatform
from datetime import datetime

def submit_vertex_batch(
    project: str,
    location: str,
    input_uri: str,
    output_uri: str,
    model: str = "gemini-3.5-flash-lite"
) -> aiplatform.BatchPredictionJob:
    """Submit batch job via Gemini Enterprise Agent Platform.

    Args:
        project: GCP project ID
        location: GCP region
        input_uri: GCS input JSONL URI
        output_uri: GCS output prefix
        model: Model resource name

    Returns:
        BatchPredictionJob object
    """
    aiplatform.init(project=project, location=location)

    job = aiplatform.BatchPredictionJob.create(
        model_name=f"publishers/google/models/{model}",
        job_display_name=f"batch-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
        gcs_source=input_uri,
        gcs_destination_prefix=output_uri,
        sync=False
    )

    return job
```

Service-account ADC may also be supplied via `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`; do not add a credential file to version control.
