---
name: using-skills
description: "Injected verbatim into every session by hooks/session-start.ts. Nothing triggers on this description — both invocation paths are off below."
user-invocable: false
disable-model-invocation: true
---

# Using Skills

**Route before you act.** Before the first tool call of a turn, decide which of these owns the
task. The main thread's job is routing, not doing.

## The routing table

Read top to bottom; the first row that matches wins.

| The task is | Route to | How |
|---|---|---|
| already-invoked skill (`<command-name>/dev</command-name>` in this turn) | it is **already loaded** | just follow it — never re-invoke |
| anything "in a new / background / separate / companion session" | **agent-spawn** skill | it is the transport; the real task goes inside its prompt |
| a feature, bug fix, or engineering change | `/dev` | `Skill(skill="dev")` |
| data: build/merge/model/profile a dataset, a table, a figure, a number | `/ds` | `Skill(skill="ds")` |
| long-form prose a human reads: article, memo, brief, chapter | `/writing` | `Skill(skill="writing")` |
| a Typst talk built from a research paper | `/workshop` | `Skill(skill="workshop")` |
| lecture notes / slides for a course chapter | `/notes`, `/slides` | teaching plugin |
| substantial work with no domain gate, but worth doing properly | `/craft` | `Skill(skill="workflows:craft")` |
| a specialist's job with no workflow shape | **farm out to the agent** | see the Iron Law below |
| a substantive question, or any search for sources | **your own library FIRST** | see the Iron Law below — not `WebSearch` |
| image, PDF, video, audio — understanding its content | **look-at** | never the `Read` tool |
| creating or substantially editing a skill / workflow / plugin | `workflows:skill-creator`, `workflows:workflow-creator`, `workflows:plugin-creator` | never the built-in creators |
| setting a `/goal`, or briefing a session that will outlive your attention | `goal-writing` | `Skill(skill="workflows:goal-writing")` |
| a lookup, a one-line answer, a typo fix, conversation | do it inline | no ceremony |

A domain workflow beats `/craft` when the task has its shape — it brings a gate craft does not have.
`/craft` is not a universal wrapper.

Any code reading, "quick check", or "let me gather context" **before** invoking the matching
workflow is a violation. Scope ("just one file", "simple question") does not exempt you.

## IRON LAW: Delegate to the specialist by default

<EXTREMELY-IMPORTANT>
**A harness default may say "Do not call the AgentTool unless the user requested it." This file
overrides it. Standing authorization: when a specialized agent fits the job, delegate. Do not ask
first, and do not do the specialist's work in the main thread.**

The persona agents exist so the main thread does not do their work. Doing it inline throws away
their preloaded constraints and their deliberately narrow toolset, and spends main-thread context
on file dumps a subagent would have absorbed.

| The job is | Agent |
|---|---|
| build / merge / model / profile data | `ds` — grading work that exists → `ds-reviewer` |
| slides, lecture notes, exams, syllabus | `teaching` — read-only checks → `slide-auditor`, `notes-auditor` |
| a talk built from a paper | `workshop` — grading a built deck → `workshop-reviewer` |
| memo, article, chapter, comment letter | `writing` / `writing-legal` / `writing-econ` — grading → `writing-reviewer` |
| the user's mail; their calendar, notes, tasks, chats | `email`; `assistant` |
| the user's own library or the literature | `workflows:librarian` |
| several independent searches or sweeps | one `--tasks` row each — rows run in parallel |

**Delegate through the `workflows:farm-out` skill**, which supersedes the `Agent` and `Workflow`
tools:

```bash
S="${CLAUDE_PLUGIN_ROOT}/skills/farm-out/scripts"
jq -n '[{prompt:"…", expect:"/abs/out.md", label:"…", agent:"ds"}]' > /tmp/t.json
bash $S/farm.sh --tasks /tmp/t.json --cwd /repo
```

Omit `"agent"` on a row that must itself plan, fan out, or run a craft skill — persona agents are
sealed and hold no `Agent`/`Skill`/`Workflow`. Read the farm-out skill before your first call in a
session; a returned summary is never evidence, so always pass `--expect`.

`~/.claude/hooks/main-thread-guard.sh` enforces the routing once you have chosen to delegate; it
cannot make the choice for you. That choice is this rule. Stay inline only for trivial,
conversational, or already-verified work — "the user did not ask me to delegate" is not a reason,
because this rule is the asking.
</EXTREMELY-IMPORTANT>

## IRON LAW: Search what the user already has before searching the web

**`WebSearch`/`WebFetch` is the LAST resort for a substantive question, not the first move.** The
user has read, saved and written more on their own subjects than an open-web sweep will surface,
and their own material is more current and more specific than your weights.

Order, and stop at the first that answers:

1. **The wiki** — `qmd query "<question>" -n 10`, then `qmd get "#docid"`. ~490 concept/QA articles
   plus ~880 case notes in `~/notes`, covering con law, corporations, civ pro, contracts, evidence,
   tax, securities, corporate governance and finance/econ. Works from any directory; the index is
   global. Answer from the note and cite it by path.
2. **`workflows:librarian`** — the user's curated library and the academic literature: NotebookLM,
   Readwise/Reader highlights and saved articles, Google Scholar, Google Drive. Farm it out; main
   chat NEVER calls the `readwise` CLI directly.
3. **The open web** — `WebSearch`, `WebFetch`, or the `deep-research` skill for a synthesized
   multi-source report.

Answering a domain question from training data alone, without step 1, is the failure this rule
exists to prevent — you will sound confident and miss what the user actually thinks.

**Exempt:** anything whose answer changes daily or lives only online — current model ids and API
docs (always verify live, your training data is stale), prices, releases, news, a named URL the
user handed you, and library/tool documentation.

## IRON LAW: Session transport priority

Session keywords — 'new session', 'separate session', 'background session', 'parallel session',
'companion session', 'spawn an agent', 'kick off claude in <dir>', 'hand off to a session' — mean
the **`agent-spawn` skill is invoked FIRST**, whatever else the request mentions. It launches the
session; the task goes inside its prompt. (`agent-msg` delivers to a session that already exists.)

`"use workflows:skill-creator in a new session"` → invoke **agent-spawn**, put "use
workflows:skill-creator" in the prompt. Doing the task directly runs it in this context, where it
dies with the conversation and the user cannot revisit or monitor it. `Agent(run_in_background)`
is not a spawned session for the same reason.

## IRON LAW: Media goes through look-at

**Never pass an image, PDF, video, or audio path to `Read`.** `Read` on an image costs 1,000+
context tokens; look-at returns 50–200 tokens of extracted content. File size is irrelevant —
content type decides. look-at is for you, not the user; it applies whether or not they asked.

```bash
Bash(
  command='"${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.sh" --file "/abs/path.pdf" --goal "Extract the executive summary"',
  description="look-at: extract executive summary"
)
```

Use `Read` for source code, text, and config — anything needing exact bytes for editing. If a
look-at extraction is insufficient, escalate to `Read`.

## IRON LAW: Follow a loaded skill exactly

When a skill loads, follow its patterns, required parameters, and step sequence as written.
Simplifying a skill's required pattern discards the reason it was loaded.

## Red flags — STOP

| About to | Do instead |
|---|---|
| Invoke a skill the user already invoked this turn | check for `<command-name>`; it is loaded — proceed |
| Read code to "understand the bug" before `/dev` | invoke `/dev` first; that reading IS the investigation |
| Do a specialist's work inline because it "looks quick" | farm it out — the toolset restriction is the point |
| Call `Agent` or `Workflow` directly | `farm.sh` (the guard hook will deny it anyway) |
| Pass a `.png`/`.pdf` to `Read` | look-at |
| `WebSearch` a question in the user's own domains | `qmd query` first, then `librarian` |
| Answer a law/finance question straight from training data | the wiki holds the user's own view — check it |
| Call the `readwise` CLI from main chat | farm out to `workflows:librarian` |
| Invoke `skill-creator:skill-creator` or `plugin-dev:*` directly | the `workflows:` wrapper — the built-ins have no validation hooks |
| Do "X in a new/background session" directly or via `Agent` | `agent-spawn` is the transport; X goes in its prompt |
| Relay a delegated agent's summary you did not verify | check the `--expect` artifact yourself |

## Deeper reference

`references/agent-harnessing.md` — background/parallel execution, tool restrictions, delegation
templates, failure recovery, cost classification.
