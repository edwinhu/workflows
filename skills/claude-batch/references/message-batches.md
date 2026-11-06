# Message Batches: limits, prices, result types

Checked 2026-11-04. Sources:
[batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing.md),
[API credits for subscribers](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers.md),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing.md),
[models overview](https://platform.claude.com/docs/en/about-claude/models/overview.md).
Re-fetch before a large run; the script's price table (`../../batch-router/scripts/batchlib.py`) is a
snapshot.

## Batch prices (50% of standard), USD per MTok

| Model id | Input | Output |
|---|---|---|
| `claude-haiku-5-5` (prompt ≤100k tokens) | $0.05 | $0.25 |
| `claude-haiku-5-5` (prompt >100k tokens) | $0.25 | $1.25 |
| `claude-sonnet-5-5` | $1 | $5 |
| `claude-opus-5-5` | $2 | $10 |
| `claude-fable-5-1` | $5 | $25 |

Web search: $10 per 1,000 searches plus the search-result tokens as input. All server tools work in
batch; the batch worker throttles `web_search` per org, so a large search batch runs slower, not failed.

## Limits

| Limit | Value |
|---|---|
| Requests per batch | 100,000 |
| Bytes per batch | 256 MB |
| `custom_id` | `^[a-zA-Z0-9_-]{1,64}$`, unique within the batch |
| Typical completion | under 1 hour |
| Expiry | requests not processed within 24 hours become `expired` |
| Result retention | 29 days from creation |
| Rejected params | `stream: true`, `speed`, `fallbacks`, `max_tokens: 0` |

Params are validated asynchronously: a malformed `params` object comes back as an `errored` row when the
batch ends, not as an error at create time. That is why `verify` sends the first row synchronously.

## Result types

| `result.type` | Billed | Action |
|---|---|---|
| `succeeded` | yes | `result.message` is a normal Messages response |
| `errored` | no | `invalid_request` needs a fixed row; a server error can be resubmitted as is |
| `canceled` | no | the batch was cancelled before this row ran |
| `expired` | no | the 24h window closed; resubmit the row |

Results come back in any order: match on `custom_id`, never position.

## Status

`processing_status`: `in_progress` → `ended`; after `cancel`, `canceling` → `ended` with partial results.
`request_counts` holds `processing`, `succeeded`, `errored`, `canceled`, `expired`.

## Credits

- Ultra plan: $200 per month to one linked Console org; linked orgs get at least the Start usage tier.
- Expires at the end of each billing cycle, no rollover. Included credit spends before purchased credit.
- Exhausted with no other credit: `Your credit balance is too low to access the Anthropic API`.
- Balance and expiry appear only at Console Billing > Promotional credits
  (`platform.claude.com/settings/billing`); there is no balance endpoint for a normal API key.
- Spend counts toward the org's monthly spend cap, which resets on the 1st.

## Files API: documents by `file_id`

Inline base64 counts against the 256 MB batch cap; a `file_id` reference does not carry the bytes.
Source: [Files API](https://platform.claude.com/docs/en/build-with-claude/files) (checked 2026-11-05).

```bash
uv run $S upload a.pdf b.pdf --account uva [--expires 86400]   # one JSON line per path with file_id
uv run $S delete-file file_... --account uva
```

Row content block: `{"type": "document", "source": {"type": "file", "file_id": "file_..."}}` (PDF,
text/plain), or an `image` block with the same `source`.

**Proven 2026-11-05** (`msgbatch_01UhRBRVc6iAv55AcbeLXVa4`, org `uva`, `claude-haiku-5-5`): a
10.5 KB PDF uploaded with `upload --expires 86400`, referenced by `file_id` in 2 batch rows; both
`succeeded`, `results --input` exit 0, row 1 answered the PDF's code word (`HERON-42`), each row billed
~1,650 input tokens, total $0.000172, ended 2 min 42 s after submit. No beta header was needed.

**Account scoping, proven the same day:** `GET /v1/files/<id>` under the uploading `uva` key returned
the file; under the `gmail` key it returned `404 not_found_error`. Files are workspace-scoped, so an id
uploaded under one `--account` does not resolve in a batch submitted under another: upload with the
account that submits, and do not move a pilot to a different org without re-uploading.

**Gotcha seen in that pilot:** `claude-haiku-5-5` spent all 20 `max_tokens` of row 2 on thinking
(`thinking_tokens: 20`) and returned no text. Budget headroom above the expected answer length.

From the docs, not tested here: 500 MB per file and 1 TB per org; upload, list and delete are free,
the content bills as input tokens each time a row references it; files persist until deleted, or until
`expires_in_seconds` (3600–7,776,000) set at upload. Delete files after the batch's results are in.
