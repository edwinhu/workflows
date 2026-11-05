# Routing rules, limits and prices

The script is the spec: `scripts/route_batch.py` (ranking) and `scripts/batchlib.py` (price table,
limits, capabilities, accounts). This page explains what they encode. Prices checked 2026-11-04.

## Ranking

| Group | Condition | Order within group |
|---|---|---|
| 1 prepaid, covers | `credit_linked = true`, `monthly_credit_usd > 0`, usable key, balance ≥ cost × 1.2, ≥1 day to expiry | soonest `cycle_renews` first |
| 2 prepaid, short | as above but balance < cost × 1.2, or expiry within 24h | soonest expiry first |
| 3 pay-per-token | usable key, no confirmed prepaid credit; Gemini Vertex needs no entry | cheapest; Gemini wins a tie |
| 4 blocked | no key, unknown model at the tier, or a needed capability missing on that batch path | listed last |

Balance: the `--balance` value when given (verified), else `monthly_credit_usd` (UNVERIFIED, an upper
bound). A `cycle_renews` date in the past means the config is stale: the row says so and the balance is
treated as unknown.

## Turnaround

OpenAI batch can sit queued for hours (4.8 h for 1 row on 2026-11-05); Claude finished in ~2.5 min. Prefer
Claude or Gemini when results are needed the same day.

## Tiers

| Tier | Anthropic | OpenAI | Gemini (Vertex) |
|---|---|---|---|
| cheap | `claude-haiku-5-5` | `gpt-6-luna` | `gemini-3.5-flash-lite` |
| mid | `claude-sonnet-5-5` | `gpt-6.1-terra` | `gemini-3.8-flash` |
| top | `claude-opus-5-5` | `gpt-6.1-sol` | — |
| frontier | `claude-fable-5-1` | `gpt-6-astra` | — |

A tier names a price class, not equal quality. Verify the ids against the provider's model page at use
time and update `batchlib.MODELS` when they move.

## Batch prices, USD per MTok (input / output)

| Model | Price | Long-context price |
|---|---|---|
| `claude-haiku-5-5` | 0.05 / 0.25 | 0.25 / 1.25 above 100k input tokens |
| `claude-sonnet-5-5` | 1 / 5 | — |
| `claude-opus-5-5` | 2 / 10 | — |
| `claude-fable-5-1` | 5 / 25 | — |
| `gpt-6-luna` | 0.05 / 0.25 | 0.10 / 0.375 above 272k |
| `gpt-6.1-terra` | 0.50 / 2.50 | 1.00 / 3.75 above 272k |
| `gpt-6.1-sol` | 1.00 / 5.00 | 2.00 / 7.50 above 272k |
| `gpt-6-astra` | 5 / 25 | 10 / 37.50 above 272k |
| `gemini-3.5-flash-lite` | 0.15 / 1.25 | — |
| `gemini-3.8-flash` (through 2026-12-31) | 0.375 / 1.875 | — |

Sources: [Claude batch](https://platform.claude.com/docs/en/build-with-claude/batch-processing.md),
[OpenAI pricing](https://developers.openai.com/api/docs/pricing.md),
[Gemini Cloud pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)
(snapshot in `skills/gemini-vertex/references/models-and-pricing.md`).

## Per-batch limits

| Provider | Requests | Size |
|---|---|---|
| Anthropic | 100,000 | 256 MB |
| OpenAI | 50,000 | 200 MB per input file, one model per file |
| Gemini Cloud Batch | 200,000 | one JSONL up to 1 GB |

Without `--jsonl` the size is estimated as requests × (in-tokens × 4 + 400) bytes.

## Capabilities on the batch path

| Need | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| vision, pdf | yes | yes | yes |
| web-search | yes, $10/1k searches | yes, $10/1k searches (verified live 2026-11-05) | yes, $14/1k after 5k free per month |
| long-context | 1M tokens | long-context tier above 272k | yes |

## Credit facts the config encodes

- Claude Ultra: $200/month to one linked org; expires at cycle end, no rollover; balance only in the
  Console (Billing > Promotional credits). [Source](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers.md)
- ChatGPT Pro: $100/$200/$500 per month by tier, linked by the subscriber to an API org; Batch not named
  in coverage. [Source](https://developers.openai.com/api/docs/guides/chatgpt-api-credits)
- Gemini on Vertex: pay-per-token on GCP, no credit to route around.
