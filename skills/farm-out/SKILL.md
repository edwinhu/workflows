---
name: farm-out
description: "Run ALL delegated agent work through the CLIProxyAPI wrappers. Use INSTEAD OF the Agent tool, subagents, the Workflow tool, and in-session agent teams — for any \"delegate this\", \"run these in parallel\", \"fan out\", \"have an agent review/investigate/search\", \"use a subagent\", \"spawn a team\", \"get a second opinion\", \"run this workflow script\", or any task you were about to hand to a background agent. Also use for explicit mentions of cliproxy, codex-code, gemini-code, claude-code, farm out, or delegating work to another model. NEGATIVE ROUTING: anything phrased as a new, background, separate or companion SESSION — 'spawn an agent', 'spawn a background claude', 'kick off claude in <dir>' — belongs to agent-spawn, which fires first and carries this work inside its prompt; messaging a session that already exists is agent-msg; designing, repairing or auditing a workflow is workflow-creator; and a craft, dev or ds dispatch goes through craft-dispatch.sh, never a hand-written farm.sh --workflow line."
---

# farm-out

Delegation runs in a **separate process** on a CLIProxyAPI wrapper, not in this
session. This session keeps its own auth, Remote Control, and connectors; the
work runs on proxy models.

**Default runner is `claude-code`** (Claude models via the proxy). Use
`codex-code` or `gemini-code` only when the task calls for a different model
family, or when cross-checking one family against another.

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
targets that file, `.claude/plans/`, or `.craft/`. Without it the `Edit` branch
allows unconditionally whenever no craft dispatch is owed — measured 2026-08-20:
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
| needs to plan, fan out, dispatch subagents, or run a craft workflow end-to-end | same, but **omit `"agent"`** — a persona has `Skill` but no `Agent`/`Workflow`, so it cannot fan out or dispatch |
| several independent jobs at once | more rows; each carries its own `"agent"` |

Row count is orthogonal to the persona question: a fan-out of five can be five `ds`
workers. "More than one job" does not mean "generic".

An orchestrating child is a full Claude Code session, so it has `Agent` and `Workflow`
and can dispatch the persona itself — `Agent(subagent_type: "ds")` gives the subagent
the same real persona plus the same deliberate restriction. That layering is the design
the craft skills already use (`skills/ds/SKILL.md` sets `implementerAgentType: "ds"`),
not a workaround.

Agents live in `~/.claude/agents/`: `ds`, `writing`, `writing-econ`, `writing-legal`,
`workshop`, `teaching` (workers); `ds-reviewer`, `workshop-reviewer`, `writing-reviewer`
(read-only).

**A `--workflow` run takes no `--agent`** — it picks agents PER LEG, which is the point:
`agent(prompt, {agentType: "ds"})` inside the script, or `implementerAgentType` /
`verifierAgentType` / `reviewLenses[].agentType` in a craft args file. One top-level
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
jq -n '[{prompt:"…", expect:"/repo/out.md", label:"count", agent:"ds"}]' > /tmp/t.json
bash $S/farm.sh --tasks /tmp/t.json --cwd /repo

# Rows run in PARALLEL. Per row: prompt (required), expect (string or array),
# label, agent, model. Omit "agent" when the row must orchestrate.

# workflow script — --out is REQUIRED (the structured return is the result, not the
# summary), and paths resolve against OUR cwd, not --cwd, so pass them absolute.
bash $S/farm.sh --workflow /abs/wf.js --args /abs/args.json --out /abs/result.json --cwd /repo

# Long runs: never foreground (a Bash-tool call caps out and kills the run mid-flight).
# Detach, then wait on the artifact:
setsid nohup bash $S/farm.sh --workflow /abs/wf.js --out /abs/result.json --cwd /repo \
  > /abs/run.log 2>&1 < /dev/null &

# team: named teammates that message each other, one result back
$S/farm-team.sh --prompt-file t.txt --cwd /repo --expect /repo/a.txt --expect /repo/b.txt
```

`--provider claude|codex|gemini` (default `claude`) on both runners.

Read `reference.md` before changing a runner, debugging a 429, or hand-writing
a proxy call — it holds the verified model-routing and failure-mode details.
