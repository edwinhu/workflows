---
name: batch-router
version: 1.0
description: "Use when the user says 'bulk LLM job', 'batch job', 'submit a batch job', 'run this prompt over all the documents', 'process thousands of PDFs', 'extract fields from every filing', 'code each filing', 'label / annotate these documents', 'hand-code these', 'have agents read each document', 'which batch provider', 'cheapest way to run this over N rows', 'spend my API credits', 'Claude or OpenAI or Gemini for this batch', or needs any per-row LLM extraction, classification or enrichment over many inputs."
user-invocable: false
---

# Batch router

Picks the provider for one batch job and hands off. It never submits: the handoff is to
`claude-batch`, `openai-batch` or `gemini-vertex`, which own the request format, the pilot and the
submission.

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

<EXTREMELY-IMPORTANT>
## IRON LAW: BATCH BY DEFAULT, NEVER SYNC — AND NO FULL PAID RUN WITHOUT EDDY'S YES

Every bulk LLM job goes through a provider's Batch API (half price), never a loop of synchronous calls
and never an interactive-agent fan-out; one synchronous `verify` per job is the only sync call. The full
run waits for the pilot's `results --input` exit 0 and a message from Eddy approving the cost this
router printed. A sync loop that "already works" still costs double, and a fan-out of agents bills the
shared Claude accounts per document.
</EXTREMELY-IMPORTANT>

## Route

```bash
uv run ${CLAUDE_SKILL_DIR}/scripts/route_batch.py --requests 5000 --in-tokens 3000 --out-tokens 300 \
  [--tier cheap|mid|top|frontier | --model <id>] [--needs vision|pdf|web-search|long-context] \
  [--balance uva=200 --balance nyu=200] [--json]
uv run ${CLAUDE_SKILL_DIR}/scripts/route_batch.py --jsonl requests.jsonl --out-tokens 300   # measured
```

It prints a ranked table with a reason per row and the next command. The ranking:

1. **Prepaid credit that expires soonest**, covers the estimated cost +20%, and has a usable key.
2. Other prepaid credit (short balance, or expiry within 24h).
3. **Pay-per-token, cheapest model that fits**; Gemini Vertex wins a tie and is the default fallback.
4. Blocked: no key, or the batch path lacks a needed capability. Listed, with why.

Over a provider's per-batch limit (Claude 100k / 256 MB, OpenAI 50k / 200 MB, Gemini 200k) the row says
how many shards. Details, prices and limits: [routing rules](references/routing.md).

Then invoke the skill the top row names (`workflows:claude-batch`, `workflows:openai-batch` or
`workflows:gemini-vertex`) and follow it: `validate` exit 0 → one `verify` → 5–10 row pilot whose
`results --input` exits 0 → Eddy's yes to the printed cost → full run → `results --input` exit 0.

## Facts

- **Balances are never stored.** There is no balance API for Claude credits; the Console is the only
  source. Pass `--balance <account>=<usd>` from what Eddy or the Console reported today; without it the
  router assumes at most the monthly credit and prints `balance UNVERIFIED`. Writing a balance into
  `accounts.toml` creates a number that is silently wrong a day later.
- **Accounts are config**, at `$BATCH_ACCOUNTS` (default `~/.config/batch-router/accounts.toml`; shape in
  `references/accounts.example.toml`). This repo is public: org ids, emails and key paths never go in it.
- **OpenAI is pay-per-token** until its account says `credit_linked = true`: the ChatGPT Pro credit page
  never names Batch. Its batches can queue for hours; not for same-day results.
- **Credits expire at cycle end with no rollover.** An org whose credit lapses in four days with $200
  unspent is worth more than any per-token discount, which is why expiry outranks price.
- **Web search is priced per search, not per row:** Claude and OpenAI $10/1k, Gemini $14/1k after 5k free a
  month. The router assumes 2 searches per row (`--searches-per-row`); a grounded Gemini run once cost
  $390 in searches against $30 in tokens.

## Red flags — STOP

| About to | Do instead |
|---|---|
| Send bulk work straight to gemini-vertex out of habit | Run the router; a prepaid Claude credit may be expiring unused |
| Loop synchronous API calls over the rows | Batch; the only sync call is the one `verify` |
| Fan out agents or farm rows, one per document | One batch job over pre-cut inputs |
| Submit on the router's word alone | The router never submits; follow the provider skill's pilot and get the go-ahead |
| Quote an UNVERIFIED balance as the real one | Say it is assumed, or ask Eddy for the Console figure |
| Create an API key for an org that shows `no key` | Ask Eddy; he adds the key source to accounts.toml |
