---
name: claude-batch
version: 1.0
description: "Use when the user says 'Claude batch', 'Anthropic batch', 'Message Batches API', 'submit a Claude batch', 'run this through the Claude API in bulk', 'use my Ultra API credits', 'spend the Claude credit before it expires', 'which Claude org has credit', or when batch-router picked an Anthropic account."
user-invocable: false
---

# Claude Message Batches

Paid from the prepaid API credit an Ultra plan grants one linked Console org. Every action goes through
one script; the accounts it can bill are in the batch-router accounts config
(`$BATCH_ACCOUNTS`, default `~/.config/batch-router/accounts.toml`, shape in
`../batch-router/references/accounts.example.toml`).

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

<EXTREMELY-IMPORTANT>
## IRON LAW: NO FULL `submit --run` UNTIL FOUR EXITS ARE 0 AND EDDY SAID YES

The full run waits for: `validate` exit 0 on the full file, `verify` exit 0, the 5–10 row pilot's
`results --input` exit 0, and a message from Eddy approving the cost `route_batch.py` printed. A batch
that is wrong is wrong 100,000 times, and the credit it burns expires at cycle end with no rollover:
skipping the pilot spends the month's credit on a bad dataset.
</EXTREMELY-IMPORTANT>

## The sequence

```bash
S=${CLAUDE_SKILL_DIR}/scripts/claude_batch.py
uv run $S accounts                                    # which orgs have a key; free
uv run $S validate requests.jsonl                     # schema, custom_id, limits; free
uv run $S verify requests.jsonl --account gmail       # ONE sync request at full price; prints its cost
uv run $S submit pilot.jsonl --account gmail --run    # 5-10 rows first; refuses without --run
uv run $S status <batch_id> --account gmail --wait    # run in the background, not a narrated poll
uv run $S results <batch_id> --account gmail --input pilot.jsonl --out pilot.out.jsonl
```

Input is one `{"custom_id": "...", "params": {<Messages API body>}}` per line. `results` writes the
succeeded rows and prints every errored, canceled, expired, missing or unexpected `custom_id`; it exits 1
unless all of them reconciled. Pick the model from the current
[models overview](https://platform.claude.com/docs/en/about-claude/models/overview.md) at use time,
never from memory; the price table the script uses is in [limits and prices](references/message-batches.md).

## Facts

- **Credit:** $200/month per Ultra plan to ONE linked org; covers the Claude API including Message
  Batches, not Claude Code. Expires at the end of each billing cycle, no rollover; included credit spends
  before purchased credit. Spending the soonest-expiring org first is free money; spending a purchased
  card balance while an idle credit expires is the waste this skill exists to stop.
- **No balance API:** balance and expiry show only in Console Billing > Promotional credits. Never write a
  balance into config; report it as UNVERIFIED unless Eddy or the Console gave a number today.
- **Exhausted credit** fails the request with `Your credit balance is too low to access the Anthropic API`.
  Record that text verbatim and stop; switching to another org's key without saying so bills an account
  Eddy did not pick.
- **Keys are per org, and batches are per workspace:** `status`, `results` and `cancel` must use the
  account that submitted. A UVA or NYU account with `key = "none"` exits with "no key"; never create a key.
- **Limits:** 100,000 requests or 256 MB per batch; most finish within 1h; unfinished requests expire at
  24h; results kept 29 days; only `succeeded` rows are billed. `stream`, `speed`, `fallbacks` and
  `max_tokens: 0` are rejected in batch. PDFs past the cap: `upload` under the SAME `--account` as
  `submit` and reference the `file_id` (proven in a batch 2026-11-05; another org's key gets 404) —
  [Files API](references/message-batches.md#files-api-documents-by-file_id).
- **Shared prefix:** use 1-hour prompt caching (`cache_control` with `ttl: "1h"`); a 5-minute cache entry
  expires before most batch rows run.
- **Spend counts toward the org's monthly spend cap** (resets on the 1st), and a batch can overshoot the
  workspace spend limit slightly.

## Red flags — STOP

| About to | Do instead |
|---|---|
| `submit --run` without a verify and a 5–10 row pilot on the same model and params | Run them; a paid full batch needs Eddy's go-ahead |
| Create an API key for the UVA or NYU org | Ask Eddy; record the key source in accounts.toml once he has made one |
| Loop `messages.create` over many rows | Build JSONL and submit a batch: 50% off and no rate-limit fight |
| Accept `processing_status: ended` as success | `results --input`; done only on exit 0, else resubmit the custom_ids it lists |
| Poll status from the model turn by turn | `status --wait` in a background Bash, notified on exit |
