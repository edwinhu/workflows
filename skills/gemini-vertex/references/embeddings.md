# Embedding batches — production boundary and alignment

**Production stays on Vertex (Gemini Enterprise Agent Platform), ADC and GCS. Never use Developer `create_embeddings` / the File API as a production fallback.** Check current Cloud model support and the exact endpoint before choosing a batch route; if the pinned model has no verified Cloud route, stop and report that blocker. Do not invent support by changing a Developer client to `vertexai=True` while retaining its File API calls.

Sources: [Cloud embedding batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/batch-prediction-genai-embeddings), [Cloud batch models](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference), [Cloud quotas](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/quotas). Gemini generation-batch quotas are not proof of embedding-model support or quotas.

## Current Cloud embedding batch (checked 2026-10-01)

Cloud now documents both Gemini embedding models; the April rejection is no longer a support matrix.

| Model | Batch locations |
|---|---|
| gemini-embedding-001 | us-central1, us-east4, us-west1, us-west4, europe-west1, europe-west4 |
| gemini-embedding-2 | global, us, eu |

GCS JSONL input/output only (no BigQuery), up to **1,000,000 rows / 1 GB** per job, no predefined concurrency quota, up to 72h queued and under-24h target. Generation batch's 200K row limit is not the embedding limit. Use the documented REST `batchPredictionJobs` model `publishers/google/models/<embedding-id>`, `inputConfig.instancesFormat="jsonl"` with `gcsSource.uris`, and `outputConfig.predictionsFormat="jsonl"` with `gcsDestination.outputUriPrefix`. Authenticate through ADC; do not transfer Developer Files/create_embeddings parameters.

Cloud -001 input:

```json
{"key":"doc-1","request":{"content":{"parts":[{"text":"Risk Factors"}]},"embed_content_config":{"task_type":"SEMANTIC_SIMILARITY","output_dimensionality":3072}}}
```

Cloud -2 input:

```json
{"key":"doc-1","request":{"content":{"parts":[{"text":"title: none | text: Risk Factors"}]},"embed_content_config":{"output_dimensionality":3072}}}
```

Use the task-prefix format appropriate to the task, identically for entries and sentinel embeds. Cloud -2 ignores task_type/title config values; include task/title in text. `key` is optional in the service schema but strongly recommended and required by this skill for reliable alignment; join output vectors by key, not position. Inspect per-row status/errors and verify the vector output shape on 5–10 rows before scaling. The disabled legacy CLI below does not implement this new Cloud schema.

## Choosing a model without changing an existing analysis

[Developer API, not for production: embedding docs](https://ai.google.dev/gemini-api/docs/embeddings.md.txt) describe `gemini-embedding-2` and `gemini-embedding-001`; that is not evidence of a Vertex batch route for either model. A 2026-04 Cloud probe rejected `gemini-embedding-*` with `Do not support publisher model ...`; this historical observation neither establishes current rejection nor authorizes Developer production.

Developer API PPM TOC benchmark, 2026-04-26: on 21,796 short titles and 17 anchors with sentinel-verified alignment, -001's mean cosine to the top anchor was 0.872 versus -2's 0.751; assignments agreed only 52.5%. This is project-specific evidence for preserving the pinned -001 geometry, not a universal model-quality claim.

- Do not switch models mid-project: re-embed entries and anchors and recalibrate thresholds if a model change is explicitly chosen.
- -001 task types must match the canonical anchors; -2 omits task_type and uses identical task-prefixed text in batch and sentinels.
- Do not silently switch to `text-embedding-005` solely to obtain a Cloud job.

## Alignment facts

Historical Developer inline embeddings preserved order in a three-text test but scrambled a 21K-text production job; output had no per-row key. Healthy norms did not detect wrong identity. Scaling positional alignment silently corrupts downstream labels.

For any verified Cloud embedding route:
1. Establish unique identity recovery in a same-model 5–10-row end-to-end pilot; never join by output order.
2. Reconcile missing/duplicate IDs and per-row errors before building the matrix.
3. Fresh-embed five sampled inputs on the same Vertex model/task configuration and assert saved-versus-fresh cosine ≥0.99 before downstream use.
4. If any sentinel fails, stop and recheck identity recovery and parsing.

Embedding 2's synchronous multi-text call returns one aggregate vector by design in the Developer docs, unlike -001. Do not assume identical aggregation semantics across models/backends.

## Legacy example

`examples/embeddings_batch.py` is disabled before any upload or model call: its Developer-only route violates the production boundary, and it does not implement the newly documented Cloud embedding schema. It is not a supported production CLI. Use existing project code only after verifying a documented Vertex route for the pinned model; do not run a Developer batch to work around missing Cloud support.
