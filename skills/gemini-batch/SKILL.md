---
name: gemini-batch
version: 1.0
description: "Use when the user says 'run this prompt over all the documents', 'process thousands of PDFs', 'extract fields from every filing', 'bulk LLM job', 'submit a batch job', 'Gemini Batch API', 'upload files to Gemini', 'flex', 'flex tier', 'Interactions API', 'cheap async Gemini', or 'grounded lookups at scale', 'hand-code these', 'gold set', 'gold standard', 'code each filing', 'label / annotate these documents', 'have agents read each document', or 'coders', or needs large-scale Gemini extraction, classification or enrichment."
user-invocable: false
---

# Gemini Batch and Inference Tiers

## Choose the tier

| Tier | Latency / availability | Token price vs Standard | Tools and grounding | Rate limits / per-row volume |
|---|---|---|---|---|
| Batch | Async; target up to 24h | 50% discount | generateContent tools supported, but search rarely grounded the measured entity tasks | Separate Batch quotas; large independent document volumes, keyed JSONL |
| Flex (Recommended for grounded lookups) | Synchronous calls; 1–15 min target, best-effort capacity | 50% discount | Interactions tools, including Google Search; validate search steps and citations per row | General API quotas, not expanded Batch quotas; bounded concurrency for entity lookups and dependent chains |
| Standard | Seconds to minutes | Full price | Interactions tools and grounding | General API quotas; one-row smoke tests and interactive work |
| Priority | Low latency (seconds), prioritized capacity | Premium; model-specific (75–100% more in tier overview) | Interactions tools and grounding | Own limit: default 0.3× Standard per model/tier, also counts toward interactive limits; latency-critical rows, not cheap bulk extraction |

Sources: [Batch](https://ai.google.dev/gemini-api/docs/batch-api.md.txt), [Flex](https://ai.google.dev/gemini-api/docs/flex-inference.md.txt), [Priority](https://ai.google.dev/gemini-api/docs/priority-inference.md.txt), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits.md.txt). Search charges are separate from token discounts; check [pricing](https://ai.google.dev/gemini-api/docs/pricing.md.txt).

**Measured routing rule:** web-grounded per-entity lookups go to Flex, not Batch. On Gemini 3.8 Flash: Batch JSON 0/138 grounded, Batch markdown 2/10, synchronous Standard markdown 92/138. The 10-row Flex test had 8/8 successful calls grounded and all returned tier=flex; the user reports two HTTP 400 copyright/recitation refusals. The captured report identifies one 400 without a row ID, so it cannot independently assign both refusals. The 138-row pilot did not finish. Successful-call latency was 5–377 s; roughly 17 searches/row makes search charges material, so cap searches in the prompt. JSON does not categorically block search; enabling a tool does not force its use.

**Interactions is Google's recommended API; generateContent is legacy but supported. Batch is not yet available in Interactions.** Use generateContent request shapes for Batch, and Interactions for Flex/Standard/Priority. Read [API boundaries and gotchas](references/gotchas.md) before mixing them.

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

## Before writing code

**NO BULK SUBMISSION WITHOUT A SAME-MODEL SMOKE TEST AND A 5–10-ROW END-TO-END TEST.** Skipping these checks scales bad prompts, misaligned keys and ungrounded answers into a bad dataset.

**READ EXAMPLES BEFORE WRITING ANY CODE. NO EXCEPTIONS.** Skipping the working patterns creates preventable backend/parameter errors.

1. Read the matching reference/example: [Flex + search](references/flex-inference.md), [Developer Batch](references/best-practices.md), or [Cloud batch](references/vertex-ai.md) plus `examples/batch_processor.py` / `examples/icon_batch_vision.py`. Copy the backend's documented shape, not a different API's parameters.
2. Fetch current [models](https://ai.google.dev/gemini-api/docs/models.md.txt), [pricing](https://ai.google.dev/gemini-api/docs/pricing.md.txt) and [thinking](https://ai.google.dev/gemini-api/docs/thinking.md.txt). New-project defaults: `gemini-3.5-flash-lite` for cheap extraction, `gemini-3.8-flash` for harder extraction/search. Pin the chosen model explicitly; existing project pins and embeddings must not silently change.
3. **For Gemini 3.x, omit temperature, top_p and top_k.** Older 3.x guidance keeps defaults; current 3.8 migration removes those sampling parameters. Control effort with model-supported thinking levels, not copied constants. 3.8 Flash accepts low/medium/high, not minimal; see [models and prices](references/models-and-pricing.md).
4. For PDFs, **send the PDF, not pdftotext output**; see the measured cost/layout evidence in [Files](references/files-api.md). Pre-cut relevant sections from text-native filings or select relevant native PDF pages, never truncate away evidence.
5. Run one synchronous test on the exact model/input/schema, then 5–10 requests through the actual selected tier. Check content, errors, finish reasons, usage, keys, and search/citations if required. Read [scale-up testing](references/scale-up-testing.md) before the full run.

## Execution and acceptance

- Bulk per-document extraction is one Gemini Batch job over pre-cut inputs, **never an interactive-agent fan-out or improvised proxy/model scripts**. A 297-prospectus coder run consumed all three shared Claude accounts; it belonged in Batch.
- Keep **one shared `genai.Client`** alive across submissions, polling and retries. Developer API uses API keys and Files; Gemini Enterprise Agent Platform (formerly Vertex AI) Cloud batch uses ADC, a project, and GCS/BigQuery. SDK `vertexai=True`, API/service names and IAM roles keep their historical identifiers.
- Developer JSONL rows use unique `key` + `request`; join outputs by key, never order. Cloud metadata and request formats are separate. Validate with `scripts/validate_jsonl.py --backend developer|cloud`.
- Flex: retry 429/503 with bounded exponential backoff; record row failures, persist successful rows, and never silently fall back to full-price Standard. A 400 recitation error is not a capacity retry.
- After submission, use the harness's background execution/notification mechanism for monitoring, with the same client. Treat terminal job state as distinct from per-row success; reconcile every input key before claiming completion.
- Reject ungrounded entity rows, but distinguish search-query evidence from recoverable citations. Interactions uses `steps`/`url_citation`; legacy Batch uses `candidates[].groundingMetadata`. See [Flex](references/flex-inference.md) and [structured output](references/structured-output.md).
- Embeddings: read [embeddings](references/embeddings.md) and use `examples/embeddings_batch.py`; file-based keys and sentinel verification protect alignment. Embedding 2 does not accept `task_type`.

## STOP flags

| About to | Do instead |
|---|---|
| Put Batch requests into `interactions.create` | Batch still uses generateContent; Flex is synchronous, not an Interactions Batch API |
| Fix Batch grounding by demanding markdown | Use Flex and inspect search steps/citations; markdown Batch only grounded 2/10 in the measured test |
| Copy minimal thinking to every Flash model | Check the exact model; 3.8/3.7 Flash reject minimal |
| Claim a succeeded job means every row succeeded | Inspect errors, truncation, key coverage and grounding row by row |
| Change model, region, schema or tier to clear an error | Re-run the same-model/tier end-to-end sample before scaling |

Setup/operations: [Cloud setup runbook](references/gcs-setup-runbook.md), [GCS](references/gcs-setup.md), [CLI](references/cli-reference.md), [troubleshooting](references/troubleshooting.md), [File Search](references/file-search.md). The Cloud examples retain the shared model-role resolver; pass an explicit current model for a new project rather than changing all plugin roles.
