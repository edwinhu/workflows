# Troubleshooting

## Authentication and backend

- Developer API: use `google-genai` with API-key credentials; inputs use Files/inline requests. Cloud GCS batch: use ADC, project, the model's supported location, Cloud API/IAM and GCS paths. See [Cloud setup](gcs-setup-runbook.md).
- Cloud product name is Gemini Enterprise Agent Platform; `vertexai=True`, `aiplatform.googleapis.com` and IAM roles keep their spelling. gcloud user login alone does not supply ADC.
- A 404 can mean model resource or endpoint support, not simply an unavailable model. Use the publisher path, consult current batch support, then test that exact model/endpoint. Never downgrade silently.
- A closed-client error calls for one long-lived shared Client, not a new client factory on every retry.

## Quota and capacity

Developer Batch uses separate enqueued-token and job limits; Cloud batch uses shared capacity and may queue before its run starts. Flex uses general limits and is sheddable. See [Batch patterns](best-practices.md) and [Flex retry logic](flex-inference.md). Retry 429/503 with bounded backoff; log other failures as rows, and never silently switch to full-price Standard.

## Empty, truncated or invalid outputs

Inspect each row's error and finish reason. MAX_TOKENS includes thinking plus output; use a supported thinking level/adequate output budget and re-test. Do not assume default high or minimal works on every Gemini 3 model. Omit Gemini 3 sampling controls.

PDF parsing limit is 50MB or 1,000 pages, not a universal 100-page ceiling. Files storage limits do not override model/context limits. Pre-cut relevant input sections/pages without dropping evidence; large files and long context need a sample.

Use the correct [structured-output shape](structured-output.md). A schema-valid JSON object may still be wrong; validate business logic and citations. Inspect raw Batch candidates/content/parts, or Interactions steps/output_text, never mix them. Reject missing/duplicate keys and ungrounded required lookups.

## Grounding and cost

Markdown is not a Batch-grounding fix: the measured Batch markdown test grounded only 2/10. Use Flex and inspect search steps plus citation annotations. All eight successful Flex calls were grounded and returned tier=flex; two refusals were reported by the user. The 138-row pilot did not finish.

Estimate costs from actual input/output/thinking/cache usage and current [pricing](https://ai.google.dev/gemini-api/docs/pricing.md.txt). Do not fall back to an obsolete model's fixed price or infer dollars from total tokens alone. Search, cache storage and Cloud storage/network charges are separate.

## Cloud pending-job diagnostics

```bash
CLOUD_LOCATION=global  # use the endpoint selected for this job
gcloud ai batch-predictions describe JOB_ID --region="$CLOUD_LOCATION"
gsutil iam get gs://your-bucket
gsutil ls gs://your-bucket/
head -10 requests.jsonl > scratch/test_requests.jsonl
```

For API/IAM setup commands use [the runbook](gcs-setup-runbook.md) and [GCS permissions](gcs-setup.md); for request validation use [the CLI reference](cli-reference.md).
