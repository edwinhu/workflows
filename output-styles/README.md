# Register output styles

**These three files are GENERATED. Do not edit them.** The source of truth is
`../references/registers/{general,legal,econ}.md`; `../scripts/emit-registers.py` builds these
styles and `../skills/writing-register/SKILL.md` from it, and `--check` fails on drift.

| style | register | corpus behind it |
|---|---|---|
| `law-review` | T14 flagship law reviews | 6,563 articles / 5,560,816 sentences |
| `econ-journal` | JF, JFE, RFS, JAR, TAR, JAE, CAR, RAST | 11,198 articles / 8,733,332 sentences |
| `general-prose` | comment letters, memos, briefs, white papers | both, contrastively |

An output style **replaces part of Claude Code's system prompt** — the right home for "how should
this prose sound," where CLAUDE.md is the right home for "what is this project." See
<https://code.claude.com/docs/en/output-styles.md>.

## Three surfaces, one source, and why the split is not optional

An output style shapes the **main conversation only**. A subagent runs its own system prompt, so a
style reaches no subagent — which means it cannot shape the prose the drafting agents craft
dispatches actually generate, and cannot inform `writing-prose-reviewer`'s grading. That gap is what the
generated skill closes:

| surface | channel | artifact |
|---|---|---|
| main conversation | plugin output-style auto-discovery | `output-styles/*.md` (these three) |
| the drafting subagent | `skills:` frontmatter preload | `skills/writing-register/SKILL.md` |
| the reviewing subagent | `skills:` preload — its **only** channel, since its `tools` omit `Skill` | same |

The preloaded artifact is **one combined file, not three**, for two reasons. The register facts are
contrastive by construction (every rule carries both columns), so an agent that sees both sides is
better informed than one that sees half. And `skills:` frontmatter is static — it cannot vary by the
plan's `style` at dispatch time — so three files would mean three near-identical agent files per
role.

## Everything in them is measured

The two corpora are the ones the `ai-tic` skill gates rules against
(`/data/eh2889/aitic_corpus{,_law}` on rjds). The sharpest contrasts, share of sentences:

| feature | law | finance | ratio |
|---|---|---|---|
| `we find / show / document` | 0.02% | 0.58% | **29× finance** |
| `regression / coefficient` | 0.05% | 2.25% | **45× finance** |
| `we` | 0.87% | 7.75% | 8.9× finance |
| `supra / infra / id.` | 1.91% | 0.00% | law only |
| `court / holding / statute` | 6.41% | 0.73% | 8.8× law |
| quotation marks | 8.36% | 1.68% | 5.0× law |

**Each style also records what is NOT a register marker**, which matters as much. Passive voice is
7.91% law vs 8.55% finance; `however,` is 1.08% vs 1.01%; em dashes 0.51% vs 0.46%. Advice keyed on
those is preference, not evidence, and saying so in the style stops it being re-invented.

Two measurements are **confounded and excluded**: sentence length (PDF extraction breaks lines
mid-sentence, so the mean of ~10.5 words is a floor, not a distribution) and contractions (the regex
catches possessive `'s`, which law prose is dense with).

## The guide rules are filtered, in three buckets

Strunk, Volokh and McCloskey were run through the same corpora and split. The buckets are in every
generated artifact with the measured rate beside each rule:

- **ship** — cost-free (`at this point in time` 1.8/M, `skyrocket` 2.9/M, `time frame` 37/M,
  `different than` 48.7/M). Enforcing these costs nothing because nobody writes them.
- **advisory** — constant in real prose (`However,` 6,666/M, `the X process` 4,482/M,
  `very <adj>` 3,277/M, `in order to` 2,472/M, `the fact that` 2,176/M). A hard rule here fires on
  ~1 sentence in 15, so it is noise.
- **dropped** — register mistakes. McCloskey's `agents`→`people` (1,728/M in finance) and
  `hypothesize`→`suppose` (683/M), Volokh's `pursuant to` (837/M in law, 26× finance). These are
  terms of art and the legal register itself; applying them damages the draft.

There is also a **VINDICATED** list (`To be sure,` 194/M in law, `Of course,` 523.7/M,
`we acknowledge that` 72.3/M in finance, `cuts against` 13.1/M). Those read as AI to almost everyone
and are in fact standard scholarship, so without the list a reviewer keeps "fixing" them.

## Install

Nothing to install. `output-styles/` is an auto-discovered plugin component directory, so these
appear in `/config` wherever the `workflows` plugin is enabled. A per-project copier used to live
here and is gone — it was redundant once the styles shipped with the plugin.

**Output styles are picked up at session start**, and plugin changes outside `skills/` need
`/reload-plugins` or a restart.

## Changing them

1. Edit `../references/registers/{general,legal,econ}.md`. `general.md`'s `SHARED-BASE` block is
   appended to all three registers; everything outside it is that register's own.
2. Run `python3 ../scripts/emit-registers.py`.
3. `bun ../tests/writing-register-contract.test.mjs`.

When `ai-tic` accepts a new tic, add it to the shared base's prohibited-constructions table. When it
*rejects* one, add it to VINDICATED.
