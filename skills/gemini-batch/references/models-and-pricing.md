# Models, thinking and prices

Verify [models](https://ai.google.dev/gemini-api/docs/models.md.txt), [pricing](https://ai.google.dev/gemini-api/docs/pricing.md.txt), [thinking](https://ai.google.dev/gemini-api/docs/thinking.md.txt) and the exact model card before submitting. Snapshot below checked 2026-09-30; model aliases, capabilities and prices can change.

## Current extraction choices

- `gemini-3.5-flash-lite`: cheap high-volume extraction/classification. Default thinking minimal; supports minimal/low/medium/high.
- `gemini-3.8-flash`: harder extraction, multimodal work and grounded lookups. Default thinking medium; supports low/medium/high, **not minimal**.
- `gemini-3.7-flash`: default medium; low/medium/high, not minimal.
- `gemini-3.6-flash` / `gemini-3.5-flash`: default medium; minimal/low/medium/high.
- `gemini-3.1-pro-preview`: complex reasoning when measured quality justifies cost. Default high; low/medium/high.
- Gemini 2.5 remains served to existing active users; Google's models page recommends 3.5 Flash-Lite or 3.8 Flash for new projects. Do not use 1.5/2.0-era defaults or invent a model by version-number parity.

[Current 3.8 migration](https://ai.google.dev/gemini-api/docs/latest-model.md.txt): remove temperature, top_p, top_k, thinking_budget and candidate_count; minimal thinking is unsupported. For all Gemini 3.x examples, omit sampling controls. The [older 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3.md.txt) recommends temperature's default 1.0 and warns about loops/degradation below it; use the newer exact-model guidance where defaults differ.

## API-specific thinking configuration

Interactions: `generation_config={"thinking_level": "low"}`. Legacy Batch JSONL: `generationConfig: {"thinkingConfig": {"thinkingLevel": "LOW"}}`. Do not move one API's spelling into the other. Do not infer accepted levels merely from `"pro" in model`.

`max_output_tokens` includes thinking and answer tokens. Check finish reasons and output before accepting a row; a too-small budget can yield MAX_TOKENS and no usable answer. Gemini 2.5 has thinking support too; it does not universally reject thinking configuration. Legacy 2.5 uses model-specific `thinkingBudget`, not a 3.x `thinkingLevel` recipe.

## USD per 1M tokens (input / output including thinking)

| Model / date | Standard | Batch | Flex | Priority |
|---|---|---|---|---|
| 3.5 Flash-Lite | $0.30 / $2.50 | $0.15 / $1.25 | $0.15 / $1.25 | $0.54 / $4.50 |
| 3.8 Flash through 2026-12-31 | $0.75 / $3.75 | $0.375 / $1.875 | $0.375 / $1.875 | $1.35 / $6.75 |
| 3.8 Flash from 2027-01-01 | $1.50 / $7.50 | $0.75 / $3.75 | $0.75 / $3.75 | $2.70 / $13.50 |

Google Search: 5,000 free search requests/month shared across Gemini 3.x, then $14/1,000; do not assume the token discount applies to search. Multiple search queries can be emitted by one row; budget from the current pricing definition and usage, not row count alone. Account allowance is not known merely from the rate table.

Estimate input and output costs separately from pilot token usage, not character counts or a generic tokens/page constant. Token prices do not include storage, search, cache storage or network charges. The 2026-08-03 realpage benchmark found no measured Pro advantage on a 20-row held-out human sample (all tested models 85% exact agreement); detection differed without ground truth on the disputed rows. That result supports testing cheaper tiers, not claiming Flash is universally more accurate.

## Caching boundary

[Interactions caching](https://ai.google.dev/gemini-api/docs/caching.md.txt) is implicit only, enabled by default for 2.5 and newer models. Read `usage.total_cached_tokens`; similar prefixes may help but do not guarantee a hit. Explicit cache objects remain [generateContent-only](https://ai.google.dev/gemini-api/docs/generate-content/caching.md.txt). Check model-specific minimum tokens and date-specific cache prices.

Measured 2026-08-03 on the `realpage` project (SEC IPO prospectus extraction; ~16,700 input tokens/doc, ~350-600 output; identical prompt, identical 100 documents):

| model | finds the target provision | quote-verification | judge | cost/doc | 1,926-doc run |
|---|---|---|---|---|---|
| `gemini-3.1-pro-preview` | 47% | 97.9% | 1.00 | $0.0187 | ~$36 |
| `gemini-3.6-flash` | 62% | 95.2% | 0.85 | $0.0151 | ~$29 |
| `gemini-3.5-flash` | 70% | 94.3% | 1.00 | $0.0149 | ~$29 |

**Pro was the most conservative extractor, not the best one.** It found the target provision in 47% of documents where Flash found 62-70% of the *same* documents. On an extraction task Pro's extra reasoning showed up as under-extraction — the failure mode that silently biases a research dataset. Scored against **held-out human hand-coding** (20 rows the research team coded before the pipeline existed, never having seen a machine output), **all four models were identical** — 85.0% exact agreement, 90% recall on real entitlements, 80% exact on those — and they failed on the *same three rows*. So Pro's extra reasoning bought nothing measurable, while its conservatism cost 15-23 points of detection.

Two honest caveats. The human sample was small (20 rows, 11 companies), and identical failures on identical rows says the *residual* errors were structural — a provision filed in an exhibit rather than the prospectus, a right held through a GP entity — not model quality. And the detection gap itself stayed **unresolved**: on the documents where models disagreed there was no ground truth, so which model is right on that 23-point spread was still open. Do not read this table as "Flash is more accurate"; read it as "Pro was not measurably better, and was measurably quieter."

**Cost savings from Pro → Flash are smaller than people expect when the task is input-dominated.** Here it was only ~20%, because Flash input is $0.75/1M against Pro's $1.00, while output — where Flash is much cheaper — was a rounding error at ~350 tokens. **In that measured lineup, Flash-Lite was the only tier that cut input price materially** ($0.15/1M, ~85% saving). Work out whether the job is input- or output-dominated *before* assuming a Flash switch saves real money: compute `mean_input_tokens * input_price` vs `mean_output_tokens * output_price` from a Stage 2 sample (see [scale-up testing](scale-up-testing.md)).

Historical prices/costs above belong to the measured 2026-08-03 run, not the current tariff. The comparison involved four models on the human sample, but the table reports the three listed models only.
