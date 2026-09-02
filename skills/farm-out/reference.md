# farm-out reference

Everything here was verified against the live setup, not taken from docs.

## Wrappers and the proxy

One CLIProxyAPI instance on `127.0.0.1:8317` serves all three providers, so
model IDs alone route across families:

| `owned_by` | wrapper | OPUS / SONNET / HAIKU slots |
|---|---|---|
| `anthropic` | `claude-code` | `claude-opus-5` / `claude-sonnet-5` / `claude-haiku-4-5-20251001` |
| `openai` | `codex-code` | `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` |
| `antigravity` | `gemini-code` | `gemini-pro-agent` / `gemini-3.7-flash-high` / `gemini-3.1-flash-lite` |

`<wrapper> --settings-json` starts the proxy **and** prints the env block
(`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, the three
`ANTHROPIC_DEFAULT_*_MODEL` slots). That is the whole integration; the SDK needs
nothing else. `<wrapper> --models` lists that provider's live catalog.

## Model IDs

- Aliases (`opus`/`sonnet`/`haiku`) resolve through the `ANTHROPIC_DEFAULT_*`
  vars, so they are **wrapper-relative**: under `codex-code`, "sonnet" is a GPT
  model. For cross-family work use full model IDs.
- The `[1m]` suffix is required for Claude Code and the SDK, and **rejected by
  the proxy on a direct HTTP call** (`unknown provider for model …[1m]`). Strip
  it when debugging with curl; keep it everywhere else.

## Failure modes

- **429 `All credentials for model X are cooling down via provider Y`** is
  transient and **per-model**, not per-account: `gemini-3-flash` returned 200 in
  the same second `gemini-3.6-flash-high` was exhausted, and that model
  recovered ~20 minutes later. Retry, or substitute a sibling model. Do not
  conclude the config is stale, and do not throttle parallelism as the first
  response.
- A workflow `agent()` returns **`null`** when its subagent dies on a terminal
  API error (e.g. a 429). `null` in results is a dead agent, not an empty answer.
- `total_cost_usd` in the result envelope is **fiction** under the proxy — it
  prices tokens as API usage when billing is against a subscription. Ignore it.
- Delegated runs always print `⚠ claude.ai connectors are disabled because
  ANTHROPIC_API_KEY or another auth source is set` on stderr. Noise, not failure.
- Proxy-backed sessions are local-only: no Remote Control, no claude.ai MCP
  connectors. Farm work out from a native session to keep both.

## Fabrication

Two separate delegated runs returned `is_error: false`, `num_turns: 1`, ~5s, and
a confident report — one quoting invented teammate output verbatim — with zero
tool calls and no filesystem trace. The prompt had explicitly told them to
report the error and stop if the spawn was rejected.

A third run, with the anti-simulation clause, behaved correctly and even
volunteered its own limits ("Alpha has not yet reported completion, so I am not
claiming the full task is complete", "No separate read-back verification was
performed").

So: the clause helps and is not sufficient. `toolCalls: 0` on a task that should
have done work is the tell, and an artifact check is the proof.

## Teams

Verified working under `-p` (Agent tool accepted `name`, teammates spawned,
`SendMessage` delivered, files written):

- Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Off by default, and a run
  without it silently spawns nobody — which looks like a passing test if you
  trust the summary.
- Requires a non-interactive permission mode: teammate permission prompts bubble
  to a lead with no human attached.
- Teammates do **not** inherit the lead's model (it comes from a `/config`
  setting unreachable headless), so name models in the spawn prompt.
- No nested teams, one team per session: a farmed-out lead can run a team, but a
  teammate cannot.
- The team config dir is removed at session exit; `~/.claude/tasks/` persists.
  Absence of a team dir afterwards is not evidence a team never formed.

## Boundary

This skill runs work on **this** machine. For persistent agents, or agents on
another machine, use `agent-spawn` — it reaches remote hosts, which this does not.
