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

## Editing a SKILL.md mid-session proves nothing

Skill bodies are snapshotted when the session starts. Edit a `SKILL.md` and re-invoke it in the
same session and you get the PRE-EDIT body — a bang added that way appears neither expanded nor
literal but absent, which reads exactly like the mechanism failing. Verify in a fresh session
(`farm.sh --tasks` with a row that invokes the skill and quotes the line back).

## What this is for

Two things, both of which live beside the skill:

- **Auto-loading `references/*.md`** — `` !`cat ${CLAUDE_SKILL_DIR}/references/rules.md` `` beats a
  `Read()` instruction the model may skip, and beats pasting the content into `SKILL.md`, which
  then has two copies to keep in sync.
- **Listing a directory** so an added file announces itself. A hand-written list of what is in
  `references/` falls behind the moment someone adds one, and nothing shows it: measured
  2026-09-14, 16 reference files across 10 skills were named by no SKILL.md, including both of
  `look-at`'s. Where each entry carries a judgement the listing cannot compute (which module
  enforces it, say), the fix is a lint that fails on an unlisted file, not a bang.
- **Running `scripts/*.{py,ts,sh}`** whose OUTPUT is the context — an index, a count, a live status.
  This is the case a static file cannot cover: `typst/skills/typst/SKILL.md` renders its constraint
  index from `rules-for`, so a rule renamed minutes earlier is already correct in the index. A
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

- **No backtick may appear inside the command, escaped or not.** The parser ends the span at the
  first one, hands bash the fragment, and the unterminated quote kills the skill load outright —
  measured 2026-09-14 on a `printf` format that wrapped a filename in backticks. Keep the command
  backtick-free; there is no escape that works.
- **Non-zero exit aborts the invocation.** `grep` and `git diff` treat exit 1 as normal; everything
  else needs `|| true` when a non-zero exit is expected.
- **A denied or unmatched permission rule aborts it too**, with no prompt. Pre-approve with
  `allowed-tools` if the command is not already allowed.
- **2-minute timeout**, stderr merged into stdout, output subject to the Bash tool's limits.
- **Output is not rescanned**, so a bang cannot emit another bang.
- `${CLAUDE_SKILL_DIR}` and friends are substituted AFTER the commands run.
