# Where `` !`cmd` `` reaches, and where it is dead text

**A bang fires in a file that is INVOKED. It is inert in a file that is INJECTED as ambient
context.** Measured 2026-09-14 on Claude Code 2.1.257, `disableSkillShellExecution` unset, by
placing a nonce bang in each file and having a session quote its own instructions back:

| File | `` !`cmd` `` |
|---|---|
| `SKILL.md`, loaded via `Skill()` | **expands** |
| `.claude/commands/*.md`, invoked as a slash command | **expands** |
| agent `.md` (probed via `claude -p --agent`) | literal |
| project `CLAUDE.md` | literal |
| `~/.claude/CLAUDE.md` | literal |
| a skill reached by `Read()` rather than `Skill()` | literal — it is a file being read, not loaded |

`code.claude.com/docs/en/slash-commands.md` lists CLAUDE.md and agent files among the supported
types. On this version they are not; the doc is wrong and a bang written there is silently dead —
no error, no placeholder, just backticks reaching the model.

## What this is for

Two things, both of which live beside the skill:

- **Auto-loading `references/*.md`** — `` !`cat ${CLAUDE_SKILL_DIR}/references/rules.md` `` beats a
  `Read()` instruction the model may skip, and beats pasting the content into `SKILL.md`, which
  then has two copies to keep in sync.
- **Running `scripts/*.{py,ts,sh}`** whose OUTPUT is the context — an index, a count, a live status.
  This is the case a static file cannot cover: `typst/skills/typst/SKILL.md` renders its constraint
  index from `rule-index.py`, so a rule renamed minutes earlier is already correct in the index. A
  hand-written list of the same rules drifts, and nothing shows it.

Anything else is better as a normal tool call. A bang is not a way to run work; it is a way to make
a file's content computed rather than typed.

## The consequence for agents

An agent definition cannot compute anything. A bang there does nothing, so an agent needing live
context reaches it through a skill named in its `skills:` frontmatter — which is also why an agent
carrying a hand-written list of rules (`workshop-reviewer` said "the fifteen canonical constraint
modules" while the corpus declared 21) cannot fix that in its own file. Name the skill whose index
is computed.

## Failure modes

- **Non-zero exit aborts the invocation.** `grep` and `git diff` treat exit 1 as normal; everything
  else needs `|| true` when a non-zero exit is expected.
- **A denied or unmatched permission rule aborts it too**, with no prompt. Pre-approve with
  `allowed-tools` if the command is not already allowed.
- **2-minute timeout**, stderr merged into stdout, output subject to the Bash tool's limits.
- **Output is not rescanned**, so a bang cannot emit another bang.
- `${CLAUDE_SKILL_DIR}` and friends are substituted AFTER the commands run.
