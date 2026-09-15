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

- **Auto-loading `references/*.md`** — a bang that `cat`s a file from the skill's own `references/` directory beats a
  `Read()` instruction the model may skip, and beats pasting the content into `SKILL.md`, which
  then has two copies to keep in sync.
- **Listing a directory** so an added file announces itself — and made to EXIT 2 when it finds
  nothing, because a search exiting 1 is tolerated: the bang renders "(Bash completed with no
  output)", the skill loads, and the reader takes an empty list for a clean scope. Measured: the
  two exit codes are handled differently, `rg` exit 1 loads and exit 2 aborts. A hand-written list of what is in
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

## `skills:` frontmatter — documented to preload, measured not to

`code.claude.com/docs/en/sub-agents` says the field injects "the complete skill content into the
subagent's context immediately at startup". On 2.1.257 it did not, in four probes:

| dispatch | agent | `skills:` | result |
|---|---|---|---|
| `claude -p --agent` | `workshop-reviewer` | `typst:typst` | NOT PRESENT |
| farm-out proxy | `workshop-reviewer` | `typst:typst` | NOT PRESENT |
| `claude -p --agent` | throwaway | `typst` (bare) | NOT PRESENT |
| `claude -p --agent` | throwaway | `typst:typst` | NOT PRESENT |

Neither name form reaches it, so this is not the plugin-qualified spelling. The docs also say a
missing or policy-disabled skill is "skipped silently", with a warning only in the debug log —
`--debug` under `-p` emitted nothing, so the skip is not observable from here either way.

**What is NOT established:** every probe went through the CLI `--agent` path, because the
main-thread guard routes delegation to farm-out and farm-out shells out to the same CLI. The
in-session `Agent` tool path is untested, and `farm.sh`'s own header already records an SDK-vs-CLI
divergence in agent preloading. So the honest rule is not "the field does nothing" but: **do not
assume a preload you have not seen in the dispatch path you actually use.** Ask the agent whether
the content is present; it is one probe.

An agent with no `Skill` tool has no fallback if the preload does not land.

## The consequence for agents

An agent definition cannot compute anything, and per the section above it cannot be handed a
computed set by frontmatter either. An agent that must have one either holds the `Skill` tool and
is TOLD to invoke it, or reads the corpus itself, or has the index inlined into its prompt by the
orchestrator. Which is also why an agent
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
- **`${CLAUDE_SKILL_DIR}` is substituted BEFORE the command runs, into the command TEXT.** The bare
  form `$CLAUDE_SKILL_DIR` is NOT — there is no shell variable of that name, so it expands to the
  empty string and the script is handed nothing. Measured 2026-09-15 on claude@2.1.257: braced
  echoed the real path, bare echoed `[]`. That empty argument is how a first attempt at the
  degrading TOC bang passed `.` to `skill-toc`, which exited 2 and aborted 53 skill loads.

## Where a written-out bang fires

A bang in documentation EXECUTES, and the markdown around it mostly does not matter. Measured
2026-09-15 on claude@2.1.257 by loading a probe skill carrying one bang per shape:

| the bang sits in | fires? |
|---|---|
| a bare line, or mid-sentence | **yes** |
| a ``` fenced block | **yes** |
| a ~~~ fenced block | **yes** |
| a four-space indented block | **yes** |
| an inline code span, anywhere inside it | **no** |

An inline code span is the only protection, which is the reverse of what the markdown suggests — a
fenced example reads as the safe way to show one and is not. To document a bang, put it in an inline
span, or write the placeholder `<bang>`. `sc-probe.ts` computes this.
