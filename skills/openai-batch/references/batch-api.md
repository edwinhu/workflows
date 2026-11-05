# OpenAI Batch API: limits, statuses, prices

Checked 2026-11-04. Sources:
[Batch guide](https://developers.openai.com/api/docs/guides/batch),
[ChatGPT API credits](https://developers.openai.com/api/docs/guides/chatgpt-api-credits),
[pricing](https://developers.openai.com/api/docs/pricing.md). Re-fetch before a large run.

## Endpoints accepted in a batch

`/v1/responses`, `/v1/chat/completions`, `/v1/embeddings`, `/v1/completions`, `/v1/moderations`,
`/v1/images/generations`, `/v1/images/edits`. One endpoint per batch, one model per input file.

## Limits

| Limit | Value |
|---|---|
| Requests per input file | 50,000 |
| Input file size | 200 MB (Files API, `purpose=batch`) |
| `completion_window` | `24h` only |
| Batch creations | 2,000 per hour |
| Enqueued tokens | per model, on the org limits page (platform.openai.com/settings/organization/limits) |
| Output retention | deleted 30 days after completion |

## Statuses

`validating` → `in_progress` → `finalizing` → `completed`; or `failed` (input rejected), `expired`
(24h window closed; unfinished rows have code `batch_expired`), `cancelling` → `cancelled`.

## Output

One line per successful request in `output_file_id`; failed requests in `error_file_id`. Lines are not in
input order: match on `custom_id`.

## Batch prices (USD per MTok, short context ≤272K input tokens)

| Model id | Input | Output | Long-context input / output |
|---|---|---|---|
| `gpt-6-luna` | $0.05 | $0.25 | $0.10 / $0.375 |
| `gpt-6.1-terra` | $0.50 | $2.50 | $1.00 / $3.75 |
| `gpt-6.1-sol` | $1.00 | $5.00 | $2.00 / $7.50 |
| `gpt-6-astra` | $5.00 | $25.00 | $10.00 / $37.50 |

## ChatGPT Pro API credits

- $100 / $200 / $500 per month for Pro 100 / 200 / 500, from 2026-10-28.
- Linked by the subscriber to an API org they own under the same email; issued per renewal, first prorated.
- Expire at cycle end, no rollover; spend before purchased credit.
- Exhausted: HTTP 429, error code `credit_balance_exhausted`.
- Coverage: Responses, Agents, Realtime, Images "and other APIs on API Platform"; Codex excluded. Batch is
  not named.
