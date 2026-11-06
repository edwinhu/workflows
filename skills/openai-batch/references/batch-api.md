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

## Files API: documents by `file_id`

Inline base64 counts against the 200 MB input-file cap; a `file_id` reference does not carry the bytes.
Source: [Files API create](https://developers.openai.com/api/reference/resources/files/methods/create)
(checked 2026-11-05).

```bash
uv run $S upload a.pdf b.pdf [--purpose user_data] [--expires 86400]   # one JSON line per path
uv run $S delete-file file-...
```

Row content part in a `/v1/responses` body: `{"type": "input_file", "file_id": "file-..."}`.

**Proven 2026-11-05:** `upload --expires 86400` of a 10.5 KB PDF returned a `file-...` id with
`purpose: user_data` and an `expires_at` 24 h out, and `delete-file` removed it (`deleted: true`). A
synchronous `verify` of a `/v1/responses` row referencing it (`gpt-6-luna`) answered the PDF's code
word (`HERON-42`) on 48 input tokens. A 2-row batch referencing it
(`batch_6aeca58ee50c8190bc9f1cab3909ec77`) was accepted and completed with HTTP 200 per row, each
billing the same 48–51 input tokens — but `max_output_tokens: 16` all went to reasoning, so both rows
came back `status: incomplete` with no text. **Batch answer proven 2026-11-06:**
`batch_6aed3afa492081909ce551971397ada4` (same file, `max_output_tokens: 4000`,
`reasoning.effort: low`) returned both rows `completed`, answering `HERON-42` and `42` from the PDF
on 48 / 51 input tokens; `results --input` exit 0; created 02:27 UTC, completed 04:47 UTC (2 h 20 min).

**Gotchas from that pilot:** (1) reasoning models spend a small `max_output_tokens` on reasoning
first, so budget hundreds of tokens even for a one-word answer; (2) a 200 row can still be
`status: incomplete` with no text; `results` lists it under `incomplete`, keeps it out of `--out`, exits 1;
(3) the 2-row batch sat `in_progress` 8 h 27 min (created 15:49 UTC, completed 00:17 UTC).

**Account scoping:** files belong to the key's project, so upload with the same `--account` as
`submit`. UNVERIFIED here — only one OpenAI account is configured, so a cross-project 404 was not tested.

From the docs, not tested here: 512 MB per file, 2.5 TB per project; `user_data` files persist until
deleted unless `expires_after` (3600–2,592,000 s) is set; `batch`-purpose files expire after 30 days
by default. The pricing page lists storage charges only for file search / vector stores, containers and
ChatKit, none for plain Files.
