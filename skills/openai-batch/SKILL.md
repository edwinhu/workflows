---
name: openai-batch
version: 1.0
description: "Use when the user says 'OpenAI batch', 'GPT batch', 'OpenAI Batch API', 'submit an OpenAI batch', 'run this through GPT in bulk', 'use my ChatGPT Pro API credits', or when batch-router picked the OpenAI account."
user-invocable: false
---

# OpenAI Batch API

Billed to the org that owns the API key in the batch-router accounts config (`$BATCH_ACCOUNTS`, default
`~/.config/batch-router/accounts.toml`). Treat it as **pay-per-token** unless that account says
`credit_linked = true`, which means the ChatGPT Pro credit is linked to the key's org; Batch draws it.

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

<EXTREMELY-IMPORTANT>
## IRON LAW: NO `verify` OR `submit` WHILE `credit_linked = false` WITHOUT A YES FROM EDDY IN THIS SESSION

`accounts` prints `pay-per-token` for such an account: both commands then bill his card at list batch
price. Only `validate`, `accounts` and `list` are free. Running a "tiny" paid test because it costs a cent
decides a billing question that is his. The full run also waits for `validate`, `verify` and the pilot's
`results --input` to exit 0.
</EXTREMELY-IMPORTANT>

## The sequence

```bash
S=${CLAUDE_SKILL_DIR}/scripts/openai_batch.py
uv run $S accounts                         # billing mode per account; free
uv run $S validate requests.jsonl          # one model + one endpoint per file, limits; free
uv run $S list                             # existing batches; free
uv run $S verify requests.jsonl            # ONE sync request at full price (go-ahead required)
uv run $S submit pilot.jsonl --run         # Files upload + create; 5-10 rows first
uv run $S status <batch_id> --wait         # in a background Bash
uv run $S results <batch_id> --input pilot.jsonl --out pilot.out.jsonl
```

Rows are `{"custom_id", "method": "POST", "url": "/v1/responses", "body": {...}}`. `results` merges the
output and error files and reconciles every `custom_id`; it exits 1 unless all succeeded. Check current
model ids and batch prices on the [pricing page](https://developers.openai.com/api/docs/pricing.md) at use
time; the snapshot is in [batch API reference](references/batch-api.md).

## Facts

- **Pro credit (since 2026-10-28):** $100 / $200 / $500 per month for the Pro 100/200/500 tiers. Eddy's
  Codex auth reports `prolite`, inferred to be the $100 tier, unconfirmed. The credit must be LINKED by
  him to an API org he owns under the same email; issued per renewal, first one prorated, expires at cycle
  end, no rollover, spends before purchased credit.
- **Batch draws the credit** (Eddy confirmed from the billing page, 2026-11-08: the Terra batches of
  2026-11-06 came off it). The credits page itself never names Batch; for any other endpoint, check the
  billing page before calling it free.
- **Exhausted credit** returns HTTP 429 `credit_balance_exhausted`; the script names it. Stop there and
  report it; a retry loop on 429 just re-sends to an empty balance.
- **Limits:** 50,000 requests and 200 MB per input file, one model and one endpoint per file;
  `completion_window` is only `24h`; 2,000 batch creations per hour; per-model enqueued-token caps on the
  org limits page. Over a limit: shard. PDFs past the cap: `upload` (purpose `user_data`) under the
  SAME `--account` as `submit` and reference it as `input_file` (proven in a batch 2026-11-06) —
  [Files API](references/batch-api.md#files-api-documents-by-file_id).
- **Output:** out of order (match on `custom_id`); failures go to `error_file_id`; expired rows carry
  code `batch_expired`; output files are deleted 30 days after completion.
- **Web search works in Batch:** `tools=[{"type":"web_search"}]` in a `/v1/responses` row searched and
  returned `url_citation` annotations (verified live 2026-11-05, $10/1k searches); the router offers OpenAI
  for `--needs web-search`.
- **Turnaround is variable, and every job waits twice** (pilot, then full batch): 2026-11-05 saw a 1-row
  batch take ~4.8 h and, later, an 8-row pilot and a 79-row gpt-6.1-terra batch take ~40 min each; Claude's
  finished in 2.5 min. Budget hours, not minutes; under ~100 rows, sync calls at 2x price or a Claude batch
  are faster.

## Red flags — STOP

| About to | Do instead |
|---|---|
| `verify` or `submit --run` while `credit_linked = false` | Ask Eddy first; it bills his card |
| Mix two models or two endpoints in one file | One file per model and endpoint |
| Read only `output_file_id` | `results --input`, which reads `error_file_id` too; done only on exit 0 |
| Set `credit_linked = true` because the Pro plan includes credit | Only once the API org's billing page shows the credit applied |
| Poll status from the model turn by turn | `status --wait` in a background Bash, notified on exit |
