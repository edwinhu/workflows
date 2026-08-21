# Output styles

**One style ships: `general-prose.md`.** It is structural, not a register. Its job is to replace the
part of Claude Code's system prompt that frames the session as software engineering (`# Doing
tasks`, "the user will primarily request you to perform software engineering tasks") and to set
prose shape for the **main conversation**. See
<https://code.claude.com/docs/en/output-styles.md>.

It carries no corpus tables. Those are main-chat token cost on every session for content only
subagents need.

## Where the registers live

`../skills/writing-register/SKILL.md` — one skill, three sections (general / legal / econ) plus the
shared Strunk/Volokh/McCloskey base, all of it measured against the two control corpora
(`/data/eh2889/aitic_corpus{,_law}` on rjds).

A subagent receives only its agent `.md` body as its system prompt plus environment details. It does
**not** inherit the output style, so a style can never reach the drafting or reviewing agents. The
`skills:` frontmatter field does: it preloads the skill's full content at subagent startup,
deterministically.

| surface | channel | artifact |
|---|---|---|
| main conversation | plugin output-style auto-discovery | `output-styles/general-prose.md` |
| writing subagents | `skills:` frontmatter preload | `skills/writing-register/SKILL.md` |

**A preloaded skill must NOT set `disable-model-invocation: true`** — one that does is skipped with a
warning to the debug log only: the agent launches, the guidance never arrives, and the review reads
as if it did. `../tests/agent-contract.test.mjs` fails if any `skills:` entry in any
`agents/*.md` stops resolving or starts setting that field.

## No generator, no map

The generator and the per-domain register sources under `../references/` are gone. There is one copy of the register
text and one output style, so there is nothing to generate and no `style -> style name` mapping:
`../scripts/set-output-style.ts` writes the single constant `General prose`, still only for a
project whose writing plan is APPROVED.

The domain axis survives everywhere it is actually load-bearing: `../scripts/prose-audit.py` keeps
its own `--style legal|econ|general` rule data, and `../hooks/writing-prose-check.ts` and
`../hooks/cite-fidelity-lint.ts` still derive the domain from the plan.

## Install

Nothing to install. `output-styles/` is an auto-discovered plugin component directory, so the style
appears in `/config` wherever the `workflows` plugin is enabled. Output styles are picked up at
session start, and plugin changes outside `skills/` need `/reload-plugins` or a restart.

## Changing things

- Prose shape or formatting rules for the main chat → `general-prose.md`, and keep it short.
- A register fact, a new tic, a vindicated phrase → `../skills/writing-register/SKILL.md`. When
  `ai-tic` accepts a new tic, add it to the shared base's prohibited-constructions table; when it
  *rejects* one, add it to VINDICATED.
