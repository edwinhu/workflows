---
name: farm-out
description: "Run ALL delegated agent work through the CLIProxyAPI wrappers. Use INSTEAD OF the Agent tool, subagents, the Workflow tool, and in-session agent teams — for any \"delegate this\", \"run these in parallel\", \"fan out\", \"have an agent review/investigate/search\", \"use a subagent\", \"spawn a team\", \"get a second opinion\", \"run this workflow script\", or any task you were about to hand to a background agent. Also use for explicit mentions of cliproxy, codex-code, gemini-code, claude-code, farm out, or delegating work to another model. NEGATIVE ROUTING: anything phrased as a new, background, separate or companion SESSION — 'spawn an agent', 'spawn a background claude', 'kick off claude in <dir>' — belongs to agent-spawn, which fires first and carries this work inside its prompt; messaging a session that already exists is agent-msg; designing, repairing or auditing a workflow is workflow-creator; and a `work`, dev or ds dispatch goes through work-dispatch.sh, never a hand-written farm.sh --workflow line."
---

# farm-out

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Delegation runs in a **separate process** on a CLIProxyAPI wrapper, not in this
session. This session keeps its own auth, Remote Control, and connectors; the
work runs on proxy models.

**There is no default runner: each `--tasks` row is routed by its `kind`** (see
Provider routing below). Name a provider only when the task calls for a specific
model family, or when cross-checking one family against another.

## Supersedes the built-in tools

| Instead of | Use |
|---|---|
| `Agent` tool / subagents | `scripts/farm.sh` (single or fan-out) |
| `Workflow` tool | `scripts/farm.sh --workflow <abs script> --args <file> --out <file>` |
| in-session agent team | `scripts/farm-team.sh` |
| persistent / remote agents | the `agent-spawn` skill (it reaches other machines; this skill does not) |

A description cannot carry this on its own — three rewrites all plateaued near
40% recall, so the routing is enforced by `~/.claude/hooks/main-thread-guard.sh`
(PreToolUse on `Agent|Task|Workflow|Edit|Write|NotebookEdit`). It denies with a
reason that names the runner, which a bare `permissions.deny` rule cannot do. The
hook exempts `FARM_OUT_CHILD=1` (our own runners' children, else farm-team.sh
blocks itself) and named agent types like Explore/Plan/librarian. Add to its
`case` to exempt another one.

**Delegating is a choice the hook cannot make for you** — the `Agent|Workflow`
branch only redirects delegation you already chose. To make a project refuse
main-thread implementation outright, set `"farmOutOnly": true` in its committed
`.claude-workflows.json`; every `Edit`/`Write` there is then denied unless it
targets that file, `.claude/plans/`, or `.work/`. Without it the `Edit` branch
allows unconditionally whenever no work dispatch is owed — measured 2026-08-20:
313 main-thread writes in mail-bridge over 28 hours with the hook enabled, the
user objecting three times.

## Two rules that are not optional

**1. A returned result is not evidence.** A delegated run reports
`is_error: false` and a confident summary whether or not it did the work.
Observed twice: two runs quoted invented teammate output, with zero tool calls
and zero filesystem trace. Always give the task a checkable artifact and pass
`--expect <path>`; the runners exit non-zero when an expected artifact is
missing. Never relay a delegated summary you did not verify.

**2. Every delegated prompt carries the anti-simulation clause.** The runners
append it automatically. Do not hand-roll a delegation that skips it.

## One watcher per SESSION, not one per dispatch

**Do NOT arm a `Monitor` or an `until test -s` loop to be woken.** The watcher mod
(`hooks/register.ts`) reads every farm run, work round and grind loop this session launches from
`$TMPDIR/farm-events/<session>/`, keeps one status line while any runs (`farm: 2 running (ds-rules
43m, …) · work <run> round 2/3 2/5 checks`), and wakes YOU — not the user — ONCE per run on `DONE`
and on a run whose process is gone with no verdict (`GONE`), naming its report path. `/farm` prints
the table: label, state, elapsed, artifact, report. Its timer restarts with every session start and
reload, which the retired `farm-runs` monitor never did — a finished run once woke nobody for hours.

**Arm a task-specific wait ONLY when a run's finish must trigger a follow-up COMMAND** — a wake is
not your next step. Background that step: `until test -s <expect>; do sleep 20; done; <next step>`.
Never with an unbracketed `pgrep -f`; the v6.26.3 guard denies a pattern matching its own checker.

**A `--workflow` run prints an hourly `CronCreate` backstop** — it survives `--resume`/`--continue`
and a session that was not running (`--no-cron` opts out; `--tasks` prints none). Arm it the turn you see it. When
you launch that run DETACHED (`setsid nohup … > log`) the printout lands in the log, not in front of
you, so create the cron yourself at launch: `7 * * * *`, recurring, non-durable, prompt
`and? (farm <run-dir name>)`.

## Pick the shape first: sealed worker, or orchestrator

`--agent <name>` runs the delegation AS one of your agents — its real system prompt,
its preloaded skills, its declared toolset. That last part is the whole decision,
because every persona agent is sealed against DELEGATION: `ds` is
`Read/Grep/Glob/Edit/Write/Bash/Skill` with **no `Agent` and no `Workflow`**, so it can
do the work and load a domain skill, but it cannot fan out or dispatch a run.

`Skill` is deliberately NOT withheld. Withholding `Agent`/`Workflow` prevents recursive
fan-out; withholding `Skill` only blinded the persona to its own domain library — `ds`
gets the constraint aggregates it is graded against as task `refs`, while `wrds`,
`crsp-v2`, `dewey`, `bmll`, `marimo` and ten more sat unreachable. `teaching` always
carried `Skill`; the others not carrying it was drift, not policy.

| Job | Shape |
|---|---|
| one well-scoped piece of work | a one-row `--tasks` file with `"agent": "ds"` — the persona's prompt and its narrow toolset are the point |
| needs to plan, fan out, dispatch subagents, or run a `work` workflow end-to-end | same, but **omit `"agent"`** — a persona has `Skill` but no `Agent`/`Workflow`, so it cannot fan out or dispatch |
| several independent jobs at once | more rows; each carries its own `"agent"` |

Row count is orthogonal to the persona question: a fan-out of five can be five `ds`
workers. "More than one job" does not mean "generic".

An orchestrating child is a full Claude Code session, so it has `Agent` and `Workflow`
and can dispatch the persona itself — `Agent(subagent_type: "ds")` gives the subagent
the same real persona plus the same deliberate restriction. That layering is the design
the work skills already use (`skills/ds/SKILL.md` sets `implementerAgentType: "ds"`),
not a workaround.

Agents live in `~/.claude/agents/`: `ds`, `writing`, `writing-econ`, `writing-legal`,
`workshop`, `teaching` (workers); `ds-reviewer`, `workshop-reviewer`, `writing-reviewer`
(read-only).

**A `--workflow` run takes no `--agent`** — it picks agents PER LEG, which is the point:
`agent(prompt, {agentType: "ds"})` inside the script, or `implementerAgentType` /
`verifierAgentType` / `lens.agentType` in a `work` args file. One top-level
persona could only apply to every leg, when what you want is `ds` implementing and
`ds-reviewer` or `Explore` judging. Note `workflow.js` strips the `Agent` tool from every
leg regardless of agentType, so legs cannot nest further delegation; fan-out is the
workflow's own `parallel()` / `pipeline()`.

## Use

**There is one task mode, `--tasks`, and it always takes a JSON array** — one row or
fifty. There is no inline `--task`: the only caller is a model reading this file, so
an inline prompt saved nobody anything, and a machine-written prompt passed as a shell
argument has to survive quoting (backticks, nested quotes, `$`) that a JSON file
sidesteps.

```bash
S=~/.claude/skills/workflows/skills/farm-out/scripts

# Build the task file with jq, never by hand-quoting a heredoc.
jq -n '[{prompt:"…", expect:"/repo/out.md", label:"count", kind:"script", agent:"ds"}]' > /tmp/t.json
bash $S/farm.sh --tasks /tmp/t.json --cwd /repo

# Rows run in PARALLEL. Per row: prompt (required), kind (or provider/model),
# expect (string or array), label, agent. Omit "agent" when the row must orchestrate.

# workflow script — --out is REQUIRED (the structured return is the result, not the
# summary), and paths resolve against OUR cwd, not --cwd, so pass them absolute.
bash $S/farm.sh --workflow /abs/wf.js --args /abs/args.json --out /abs/result.json --cwd /repo --provider claude

# Long runs: never foreground (a Bash-tool call caps out and kills the run mid-flight).
# Detach, then wait on the artifact:
setsid nohup bash $S/farm.sh --workflow /abs/wf.js --out /abs/result.json --cwd /repo --provider claude \
  > /abs/run.log 2>&1 < /dev/null &

# team: named teammates that message each other, one result back
$S/farm-team.sh --prompt-file t.txt --cwd /repo --expect /repo/a.txt --expect /repo/b.txt
```

`--provider claude|codex|gemini` is optional on `--tasks` (omit it and every row is
routed), required on `--workflow`, and defaults to `claude` on `farm-team.sh`.

Budget defaults: `FARM_TASK_BUDGET=4000000`, `FARM_SESSION_BUDGET=20000000`,
`FARM_TASK_ESTIMATE=750000` per task (capped at its budget). `FARM_MAX_TURNS=250`
on farm and grind. The pre-launch check refuses spend plus estimate at the session cap.

Read `reference.md` before changing a runner, debugging a 429, or hand-writing
a proxy call — it holds the verified model-routing and failure-mode details.

## Provider routing

Every `--tasks` row carries a `kind` — `script`, `judgement`, `review` or `bulk`. `farm.sh` hands
each row to `scripts/lib/route.ts`, which picks the provider and a pinned model from the committed
`scripts/lib/routing.json`: the kind's pick, else its first available fallback. A row may name
`provider`/`model` itself instead. A row with neither a `kind` nor a `provider`/`model` is
**refused** — exit 2, no row runs, and it never falls through to a default.

`--provider` is the legacy whole-run override: that wrapper for every row, route.ts never consulted.

Jev scores the kind's chain in **shadow**: one Decisions call per routed row, logged, never changing
the pick and never blocking a row. Each row prints `farm: ROW <label> <rowId>` on stderr and appends
one line to `~/.local/state/workflows/farm-outcomes.jsonl` (`FARM_OUTCOMES` overrides). Once you have
verified a result, label it: `farm.sh --verdict <rowId> correct|wrong "<why>"`. Those verdicts are
the holdout Jev must clear before it may decide.

`bun scripts/lib/route.ts --refresh`, run from a checkout of this repo and never the plugin cache,
updates availability (proxy catalog) and prices (OpenRouter) and never touches `kinds` or `jev`.
Review its `routing.json` diff before committing. `route.ts --propose` reads the refreshed signals
and prints suggested `kinds` changes with reasons, plus newer same-family models the proxy serves
that beat a candidate at <= its price (`candidate C: model <old> -> <new>`), writing nothing: you
approve by editing `kinds`, or that candidate's `model` and `openrouter` then `--refresh`.
Design: `docs/DESIGN-routing.md`.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| Per-document LLM coding/extraction over many files | Use `--tasks` fan-out to have agents read each document | Use `gemini-batch` for large-scale extraction |
