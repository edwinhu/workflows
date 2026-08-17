# t7 — hook reach experiment (observed, not reasoned)

<!-- wc-probe: ignore-paths -->
<!-- This file QUOTES ${CLAUDE_SKILL_DIR}/${CLAUDE_PLUGIN_ROOT} as evidence ABOUT those
     placeholders — the apparatus lived at /tmp/wc-hook-reach/, and the finding IS that the
     unsubstituted form did not resolve. Rewriting the paths to resolve would destroy the
     result being recorded, so P2 is declared off for this file only. -->

Date: 2026-08-06. Claude Code `2.1.224`. Platform: Linux.

## Method

Everything below was produced by dispatching real calls and reading the log files the hooks
themselves wrote. Nothing here is inferred from documentation.

**Apparatus** (all under `/tmp/wc-hook-reach/`):

- `skill/SKILL.md` — a scratch skill `wc-hook-reach-probe` carrying `PostToolUse` `Write|Edit` hooks
  that append the hook's full stdin JSON to `skill-hook.log` (absolute command) and to
  `skill-hook-rel.log` (`${…}`-interpolated command). Installed as
  `~/.claude/skills/wc-hook-reach-probe` → symlink to `/tmp/wc-hook-reach/skill`.
- `agent.md` — a scratch agent `wc-hook-reach-probe` whose **own frontmatter** carries a `PostToolUse`
  `Write|Edit` hook appending stdin JSON to `agent-hook.log`. Installed as
  `~/.claude/agents/wc-hook-reach-probe.md` → symlink to `/tmp/wc-hook-reach/agent.md`.
- `wf.js` — a minimal Workflow script: one `phase('Write')`, one `agent(...)` told to use the Write
  tool to create a file; takes an optional `agentType` arg that it spreads into the `agent()` options
  exactly as craft's `workflow.js` does.

**Driver.** The agent running t7 has no `Agent` and no `Workflow` tool of its own (subagents cannot
fan out further), so each cell was driven from a **fresh headless session**:
`claude -p --permission-mode bypassPermissions --output-format json '<prompt>'` run from
`/tmp/wc-hook-reach`. A fresh session also removes the "newly added skill/agent needs a session
restart to register" problem — every cell ran in a session started *after* the skill and agent were
installed. Confirmed available there: `Agent` and `Workflow` are both in the headless tool list.

Each cell wrote a `##### CELL <x> start <timestamp>` marker into all three logs first, so a null
result is distinguishable from "the log was never touched".

## Control (not one of the four cells, but the cell that makes the nulls readable)

**skill-hook × the main session's own Write, skill active.** Without this, "no log entry" in cells A
and B could just mean the skill or its hook never registered.

Verbatim, from `/tmp/wc-hook-reach/skill-hook.log`:

```
=== SKILL-HOOK-ABS 2026-08-06T23:24:00-04:00 argv0=/tmp/wc-hook-reach/skill/scripts/log-abs.sh ===
{"session_id":"209202cb-f922-47e4-b196-c638a809fdbc","transcript_path":"/home/eh/.claude/projects/-tmp-wc-hook-reach/209202cb-f922-47e4-b196-c638a809fdbc.jsonl","cwd":"/tmp/wc-hook-reach","prompt_id":"772b4724-9aac-47ca-912b-7556f65968ec","permission_mode":"bypassPermissions","effort":{"level":"medium"},"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/wc-hook-reach/out-CONTROL.txt","content":"hello-control\n"},"tool_response":{"type":"create","filePath":"/tmp/wc-hook-reach/out-CONTROL.txt","content":"hello-control\n","structuredPatch":[],"originalFile":null,"userModified":false},"tool_use_id":"toolu_01HmfqajvsgdyFdQSfuQCye1","duration_ms":2}
```

So the skill hook is registered and does fire — on the main session's own writes.

## The four cells

### Cell A — skill-hook × direct `Agent` call that writes a file

Driver: invoke `Skill(wc-hook-reach-probe)`, then, with the skill active, dispatch a general-purpose
subagent told to Write `/tmp/wc-hook-reach/out-A.txt`. The driver wrote nothing itself.

The write happened (`/tmp/wc-hook-reach/out-A.txt` exists, content `hello-A`).

**Result: no log entry produced.** `skill-hook.log` between `##### CELL A start
2026-08-06T23:23:19-04:00` and the next marker contains nothing. Same for `skill-hook-rel.log`.

The driver session independently reported that the subagent saw no `PostToolUse` hook output on its
Write.

### Cell B — skill-hook × `Workflow`-dispatched agent that writes a file

Driver: invoke `Skill(wc-hook-reach-probe)`, then, with the skill active,
`Workflow({scriptPath: "/tmp/wc-hook-reach/wf.js", args: {outFile: "/tmp/wc-hook-reach/out-B.txt"}})`
— no `agentType`, so the dispatcher default applies.

The workflow returned, verbatim:

```json
{"result":{"path":"/tmp/wc-hook-reach/out-B.txt","wrote":true},"agentTypeUsed":null}
```

and `/tmp/wc-hook-reach/out-B.txt` exists.

**Result: no log entry produced.** `skill-hook.log` and `skill-hook-rel.log` contain nothing between
`##### CELL B start 2026-08-06T23:24:39-04:00` and `##### CELL D start …`.

### Cell C — agent-hook × direct `Agent` call

Driver: `Agent` with `subagent_type: "wc-hook-reach-probe"`, told to Write
`/tmp/wc-hook-reach/out-C.txt`. No Skill invoked in this session.

**Result: log entry produced.** Verbatim, from `/tmp/wc-hook-reach/agent-hook.log`:

```
=== AGENT-HOOK 2026-08-06T23:24:24-04:00 argv0=/tmp/wc-hook-reach/agent-log.sh ===
{"session_id":"df2b39b3-cbfd-4803-a652-8786b9efd857","transcript_path":"/home/eh/.claude/projects/-tmp-wc-hook-reach/df2b39b3-cbfd-4803-a652-8786b9efd857.jsonl","cwd":"/tmp/wc-hook-reach","prompt_id":"3f217438-1cc9-42e4-8927-c9deed74c573","permission_mode":"bypassPermissions","agent_id":"af01f138ec9869b1b","agent_type":"wc-hook-reach-probe","effort":{"level":"medium"},"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/wc-hook-reach/out-C.txt","content":"hello-C\n"},"tool_response":{"type":"create","filePath":"/tmp/wc-hook-reach/out-C.txt","content":"hello-C\n","structuredPatch":[],"originalFile":null,"userModified":false},"tool_use_id":"toolu_01QShaTrWEfCzPphepB4Kr9f","duration_ms":2}
```

Note the payload carries `agent_id` and `agent_type` — fields absent from the main-session control
entry.

### Cell D — agent-hook × `Workflow`-dispatched agent

Driver: `Workflow({scriptPath: "/tmp/wc-hook-reach/wf.js", args: {outFile:
"/tmp/wc-hook-reach/out-D.txt", agentType: "wc-hook-reach-probe"}})`. No Skill invoked.

The workflow returned, verbatim:

```json
{"result":{"path":"/tmp/wc-hook-reach/out-D.txt","wrote":true},"agentTypeUsed":"wc-hook-reach-probe"}
```

**Result: log entry produced.** Verbatim, from `/tmp/wc-hook-reach/agent-hook.log`:

```
=== AGENT-HOOK 2026-08-06T23:25:17-04:00 argv0=/tmp/wc-hook-reach/agent-log.sh ===
{"session_id":"aa9c1d75-0a18-47e5-a515-c8a043a860e5","transcript_path":"/home/eh/.claude/projects/-tmp-wc-hook-reach/aa9c1d75-0a18-47e5-a515-c8a043a860e5.jsonl","cwd":"/tmp/wc-hook-reach","prompt_id":"75cce9e3-8827-4a29-ad2e-5b874f83f863","permission_mode":"bypassPermissions","agent_id":"ae5c660352801ff6a","agent_type":"wc-hook-reach-probe","effort":{"level":"medium"},"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/wc-hook-reach/out-D.txt","content":"hello-from-workflow-agent\n"},"tool_response":{"type":"create","filePath":"/tmp/wc-hook-reach/out-D.txt","content":"hello-from-workflow-agent\n","structuredPatch":[],"originalFile":null,"userModified":false},"tool_use_id":"toolu_01JUtjqq9SNJj1y988cUnu6k","duration_ms":2}
```

### Summary of the four cells (observations only)

| cell | hook lives in | write performed by | log entry? |
|---|---|---|---|
| A | skill frontmatter | direct `Agent` subagent | none |
| B | skill frontmatter | `Workflow`-dispatched agent | none |
| C | agent frontmatter | direct `Agent` subagent | yes — quoted above |
| D | agent frontmatter | `Workflow`-dispatched agent | yes — quoted above |
| control | skill frontmatter | main session itself | yes — quoted above |

No cell was left untested.

## Does `${CLAUDE_SKILL_DIR}` substitute inside `hooks:` frontmatter?

**Observed answer: no.**

Two forms were registered side by side on the same `Write|Edit` matcher in the same skill:

| form | command string in `hooks:` | observed |
|---|---|---|
| absolute | `bash /tmp/wc-hook-reach/skill/scripts/log-abs.sh` | **executed** — every entry in `skill-hook.log` above, `argv0=/tmp/wc-hook-reach/skill/scripts/log-abs.sh` |
| `${CLAUDE_SKILL_DIR}` | `bash ${CLAUDE_SKILL_DIR}/scripts/log-rel.sh` | **never executed** — `skill-hook-rel.log` stayed empty across every main-session write (markers `CELL A` … `SKILLDIR-ARG`) |

To see *what* the unsubstituted form resolved to rather than only that it failed, a third hook was
added whose command is absolute but passes the token as an argument:
`bash /tmp/wc-hook-reach/skill/scripts/probe-skilldir.sh ${CLAUDE_SKILL_DIR}`. Verbatim, from
`/tmp/wc-hook-reach/skilldir-probe.log`:

```
=== SKILLDIR-ARG-PROBE 2026-08-06T23:26:25-04:00 ===
argv1_raw=[]
env_CLAUDE_SKILL_DIR=[<UNSET>]
env_CLAUDE_PLUGIN_ROOT=[/home/eh/.claude/skills/wc-hook-reach-probe]
env_CLAUDE_PROJECT_DIR=[/tmp/wc-hook-reach]
```

`${CLAUDE_SKILL_DIR}` reached the hook process as an **empty** argument and the variable is **unset**
in the hook's environment, so `bash ${CLAUDE_SKILL_DIR}/scripts/log-rel.sh` ran as
`bash /scripts/log-rel.sh` — a path that does not exist. That is why the relative form produced no
log line: it was dispatched and failed to find its script, not skipped.

### Unplanned but load-bearing side observation: `${CLAUDE_PLUGIN_ROOT}` *does* substitute here

**Scope: a SKILL's `hooks:`.** Nothing here measures an AGENT's. The docs define the placeholder as
"the plugin's installation directory, for scripts bundled with a plugin", so outside a plugin it has
no defined value and this cell is the only evidence it is populated at all — for a skill.

The same probe output shows `CLAUDE_PLUGIN_ROOT` **is** set in the hook environment, and for this
personal (non-plugin) skill it points at the skill's own installed directory,
`/home/eh/.claude/skills/wc-hook-reach-probe`. A fourth hook was then registered as
`bash ${CLAUDE_PLUGIN_ROOT}/scripts/log-rel.sh` and it **executed**. Verbatim, from
`/tmp/wc-hook-reach/skill-hook-rel.log` (the only entry that file ever received):

```
=== SKILL-HOOK-REL 2026-08-06T23:26:49-04:00 argv0=/home/eh/.claude/skills/wc-hook-reach-probe/scripts/log-rel.sh ===
{"session_id":"3af44af8-3399-405e-af4b-43ecd1f599a4","transcript_path":"/home/eh/.claude/projects/-tmp-wc-hook-reach/3af44af8-3399-405e-af4b-43ecd1f599a4.jsonl","cwd":"/tmp/wc-hook-reach","prompt_id":"58439515-c752-490a-8b25-cc5dabbaca43","permission_mode":"bypassPermissions","effort":{"level":"medium"},"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/wc-hook-reach/out-PLUGINROOT.txt","content":"hello-pluginroot\n"},"tool_response":{"type":"create","filePath":"/tmp/wc-hook-reach/out-PLUGINROOT.txt","content":"hello-pluginroot\n","structuredPatch":[],"originalFile":null,"userModified":false},"tool_use_id":"toolu_016xjbLSZhmxcuMrP61USe4J","duration_ms":1}
```

Note it resolved through the **`~/.claude/skills/…` symlink path**, not the `/tmp` real path.

## Re-measured 2026-08-08 on 2.1.226 — headless, and delivery to the writer

An earlier caveat here claimed no `PostToolUse` hook fires under `claude -p`. **That was a
measurement artifact and is retracted.** Those probes matched `Write` while the model satisfied
"write a word to a file" with `Bash`, so the matcher never matched and a hook that was firing
correctly read as a hook that never fired. Re-run with matcher `.*` logging `.tool_name`:

| claim | result |
|---|---|
| `PreToolUse` / `PostToolUse` from `settings.local.json` under `claude -p` | both FIRE (`Bash`) |
| agent-frontmatter `hooks:` on a `~/.claude/agents/` agent, dispatched as a subagent | FIRES (`PostToolUse`/`Bash`, `PreToolUse`/`Write`) |
| settings-file hooks inside a subagent (`hooks.md:264`) | FIRE — logged the subagent's `Bash` and the parent's `Agent` |
| a blocking guard (`exit 2` + stderr) reaches the writing model | YES — write blocked, file never created, and the agent quoted the rejection **verbatim** |

The workspace-trust reading (`sub-agents.md:636`, gating added in v2.1.218) explained nothing here:
`dotfiles` is trusted and no skip ever occurred, which is also why `--debug` logged no trust error.
Both documented behaviours reproduce as written.

Only tool-name matchers were wrong; the cells above stand. A matcher is now the first thing to
suspect when a hook "does not fire".

## What was NOT tested

- Hooks declared in `~/.claude/settings.json` (user-level) or project `settings.json` — outside the
  four named cells. Whether *those* reach a `Workflow`-dispatched agent is unmeasured here.
- Whether a skill hook reaches a subagent when the subagent itself invokes the skill.
- Behavior in a long-lived interactive session (all runs were fresh `claude -p` sessions).
- **Advisory** output — a `systemMessage`, or anything a hook prints while exiting 0. Only the
  blocking form (`exit 2` + stderr) was shown to reach the writer.
- Note on the payloads above: each is the hook's **stdin**, read back out of the log file the hook
  itself wrote — none of those cells captured the writing agent's side. (Cell A's note that the
  subagent saw no `PostToolUse` output is about a hook that never fired, so it measures reach of the
  *hook*, not delivery from one that did.) The 2026-08-08 run above is the one that captured the
  writer's side, and only for the blocking form.
- What `${CLAUDE_PLUGIN_ROOT}` resolves to in an AGENT's `hooks:` command. The cell above measured a
  SKILL's. P1 refuses the token in an agent on the documented definition, not on a measurement.
- Whether an agent-frontmatter guard's output reaches the dispatched implementer. Cells C and D
  establish exactly one thing — a log entry was produced, i.e. the hook process ran — and are not
  evidence that the agent was told anything.

## Raw evidence retained

- `/tmp/wc-hook-reach/skill-hook.log`, `skill-hook-rel.log`, `agent-hook.log`, `skilldir-probe.log`
- `/tmp/wc-hook-reach/skill/`, `agent.md`, `wf.js`, `out-*.txt`

The installed copies (`~/.claude/skills/wc-hook-reach-probe`, `~/.claude/agents/wc-hook-reach-probe.md`)
were removed after the experiment; both were symlinks into `/tmp/wc-hook-reach/`, so the apparatus
above is intact.
