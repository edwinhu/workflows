---
name: farm-out
description: Run ALL delegated agent work through CLIProxyAPI wrappers instead of the built-in tools. Use INSTEAD OF the Agent tool, subagents, the Workflow tool, and in-session agent teams — for any "delegate this", "spawn an agent", "run these in parallel", "fan out", "have an agent review/investigate/search", "use a subagent", "run a workflow", "spawn a team", "get a second opinion", or any task you were about to hand to a background agent. Also use for explicit mentions of cliproxy, codex-code, gemini-code, claude-code, farm out, or delegating work to another model.
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
| `Agent` tool / subagents | `scripts/farm.ts` (single or fan-out) |
| `Workflow` tool | `scripts/farm.ts --workflow <abs script> --args <file> --out <file>` |
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

## Use

```bash
S=~/.claude/skills/workflows/skills/farm-out/scripts

# one task
bun $S/farm.ts --task "…" --cwd /repo --expect /repo/out.md

# fan-out (tasks.json: [{"prompt":"…","expect":"…","model":"…"}, …])
bun $S/farm.ts --tasks tasks.json --cwd /repo

# mixed model families in one fan-out: set "model" per task
# workflow script — --out is REQUIRED (the structured return is the result, not the
# summary), and paths resolve against OUR cwd, not --cwd, so pass them absolute.
bun $S/farm.ts --workflow /abs/wf.js --args /abs/args.json --out /abs/result.json --cwd /repo

# Long runs: never foreground (a Bash-tool call caps out and kills the run mid-flight).
# Detach, then wait on the artifact:
setsid nohup bun $S/farm.ts --workflow /abs/wf.js --out /abs/result.json --cwd /repo \
  > /abs/run.log 2>&1 < /dev/null &

# team: named teammates that message each other, one result back
$S/farm-team.sh --prompt-file t.txt --cwd /repo --expect /repo/a.txt --expect /repo/b.txt
```

`--provider claude|codex|gemini` (default `claude`) on both runners.

Read `reference.md` before changing a runner, debugging a 429, or hand-writing
a proxy call — it holds the verified model-routing and failure-mode details.
