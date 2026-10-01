# Cloud models, thinking and prices

Verify the current [Cloud model cards](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models), [batch availability](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference), [locations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations), [thinking](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking) and [Cloud pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing). Snapshot checked 2026-10-01; never use Developer prices/availability as production evidence.

## Current extraction choices

- [`gemini-3.5-flash-lite`](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite): cheap high-volume extraction/classification, minimal thinking default. Use the exact model card's supported levels, not a generic Flash rule.
- [`gemini-3.8-flash`](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash): harder extraction/search; LOW/MEDIUM(default)/HIGH, **not MINIMAL**.
- Cloud batch also lists 3.7/3.6/3.5 Flash, 3.1 Pro Preview and 2.5 models. Preserve existing project pins; do not invent an ID or infer regional batch support from models.list.
- Default to Flash/Flash-Lite for extraction; Pro only when measured quality justifies it. The [Developer API Pro-vs-Flash benchmark](model-selection.md) is historical task evidence, not a universal accuracy ranking or current Cloud tariff.

[Cloud 3.8 migration](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash): omit temperature, top_p and top_k (Cloud says ignored by the backend); candidate_count, frequency_penalty and presence_penalty cause errors. **For Gemini 3.x, keep sampling defaults.** Earlier default-temperature/loop observations were measured on the Developer API; do not set 0.0 for production extraction. Control effort with model-supported thinking levels.

## Cloud thinking configuration

Raw batch JSONL uses `generationConfig: {"thinkingConfig": {"thinkingLevel": "LOW"}}`; SDK synchronous config uses `thinking_config`. Interactions `generation_config` is not the Cloud batch wire shape. `max_output_tokens` includes thinking and final answer tokens; inspect finish reasons and content. A too-small budget can yield MAX_TOKENS without an answer. Gemini 2.5 has model-specific thinkingBudget support; it does not universally reject thinking configuration.

## Cloud global USD per 1M tokens (input / output including reasoning)

| Model / date | Standard PayGo | Batch / Flex PayGo |
|---|---|---|
| 3.5 Flash-Lite | $0.30 / $2.50 | $0.15 / $1.25 |
| 3.8 Flash through 2026-12-31 | $0.75 / $3.75 | $0.375 / $1.875 |
| 3.8 Flash from 2027-01-01 | $1.50 / $7.50 | $0.75 / $3.75 |

Source: [Cloud pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing). These are global, non-cached rates; non-global pricing differs. Priority has its own higher model-specific tariff. Do not apply another 50% discount to displayed Batch/Flex prices.

For Gemini 3, Google Search includes 5,000 Grounding Queries/month aggregated across Gemini 3 models, then $14/1,000 **individual queries**, not rows. One row can issue many queries; cap search effort in the prompt and measure actual usage. Token discounts do not imply discounted search. Allowance availability is account-dependent; Gemini 2.5's grounding tariff is different.

Estimate input/output separately from the same-backend pilot's usage; token rates exclude storage, network and other service charges. Input-dominated extraction may save less than expected when only output prices differ. See [scale-up testing](scale-up-testing.md) and the full measured comparison in [model-selection.md](model-selection.md).

## Batch caching boundary

[Cloud Batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference) enables implicit caching for Gemini 2.5/3. Cache-hit 90% input discount takes precedence over the Batch discount; they do **not** stack. Explicit caching and RAG are unsupported in Batch. Similar prefixes may help but do not guarantee a cache hit. Inspect the actual response usage rather than assuming all shared text was cached.
