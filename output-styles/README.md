# Output styles

**One style ships: `general-prose.md`.** It is structural, not a register. Its job is to replace the
part of Claude Code's system prompt that frames the session as software engineering (`# Doing
tasks`, "the user will primarily request you to perform software engineering tasks") and to set
prose shape for the **main conversation**. See
<https://code.claude.com/docs/en/output-styles.md>.

It carries no corpus tables. Those are main-chat token cost on every session for content only
subagents need.

## Where the registers live

Three skills, all measured against the two control corpora (`/data/eh2889/aitic_corpus{,_law}` on
rjds):

- `../skills/writing-general/SKILL.md` — the BASE every writing agent loads: the shared
  Strunk-derived layer, the tic table, the vindicated phrases, the formatting rules, and the
  `general` register (comment letters, memos, briefs, email).
- `../skills/writing-legal/SKILL.md` — what is ADDITIONAL for T14 law review prose (Volokh).
- `../skills/writing-econ/SKILL.md` — what is ADDITIONAL for finance/accounting prose (McCloskey).

The two domain skills restate nothing from the base and are loaded alongside it, never instead of
it.

A subagent receives only its agent `.md` body as its system prompt plus environment details. It does
**not** inherit the output style, so a style can never reach the drafting or reviewing agents. The
`skills:` frontmatter field does: it preloads the skill's full content at subagent startup,
deterministically.

| surface | channel | artifact |
|---|---|---|
| main conversation | plugin output-style auto-discovery | `output-styles/general-prose.md` |
| writing subagents | `skills:` frontmatter preload | `skills/writing-general/SKILL.md` (+ `skills/writing-legal/` or `skills/writing-econ/`) |

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
- A register fact, a new tic, a vindicated phrase → `../skills/writing-general/SKILL.md` for
  anything shared, `../skills/writing-legal/SKILL.md` or `../skills/writing-econ/SKILL.md` for a
  fact that holds in one domain only. When `ai-tic` accepts a new tic, add it to the base's
  prohibited-constructions table; when it *rejects* one, add it to VINDICATED.
