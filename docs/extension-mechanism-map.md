# Extension mechanism map: what ships, what scopes, what crosses the Task boundary

> Verified facts (2026-07-29) about Claude Code's extension mechanisms, gathered while assessing
> whether the workflows could collapse onto a shared runtime. Companion to
> `docs/common-infra-candidates.md` (compiled-runner seams) — that file covers *execution*
> extraction; this one covers *context and enforcement* delivery.
>
> Every claim below was checked against the docs or measured in this repo. Where something is
> inferred rather than confirmed, it says so.

## 1. What a plugin can ship

Manifest component fields: `skills`, `commands`, `agents`, `workflows`, `hooks`, `mcpServers`,
`outputStyles`, `lspServers`, `experimental.themes`, `experimental.monitors`, `dependencies`.

**There is no `rules` field.** `.claude/rules/` is user-level (`~/.claude/rules/`) or project-level
only. A plugin cannot ship rules.

**Consequence:** the hand-rolled `references/constraints/*.md` + `applies-to:` + `load-constraints.py`
system is not a reinvention of `rules/` — it is the *only* way to ship rule-like content in a plugin.
It earns its existence.

`skills` **adds to** the default `skills/` scan. `commands`, `agents`, `workflows`, `outputStyles`,
`experimental.*` **replace** their defaults. `hooks`, `mcpServers`, `lspServers` have their own merge
rules.

## 2. The Task boundary — the fact that drives everything

| Mechanism | Reaches subagents? |
|---|---|
| skills, constraints, CLAUDE.md, rules, output styles | **No** — subagent gets a fresh context |
| hooks from **settings / managed policy / plugin `hooks.json`** | **Yes** — confirmed |
| hooks in **agent frontmatter** | **Yes, for that agent's own tool calls** — confirmed |
| hooks in **skill frontmatter** | **Unconfirmed.** The docs' list of what runs inside subagents names settings, policy, and plugins — skill frontmatter is absent from it, but its exclusion is never stated. Settle by execution |

Docs, verbatim: *"Hooks from settings files, managed policy settings, and plugins also run inside
subagents. When a subagent calls a tool, tool events such as PreToolUse and PostToolUse fire the same
configured hooks as in the main conversation, and the input carries the `agent_id` and `agent_type`
common input fields."*

`agent_id` is **present only when the hook fires inside a subagent** — it is the way to tell subagent
calls from main-thread calls.

This single fact explains three things previously diagnosed separately:

- Why `ds-delegate` hand-copies constraint `Read` lines into its prompt templates (auto-load reaches
  main chat, not the subagent).
- Why ds enforces "no analysis code in main chat" with a hook rather than prose.
- Why the constraint auto-load premise is false for all *real* work, given ds mandates that real work
  happen in subagents.

### Open risk: no hook checks `agent_id`

Zero of 48 hooks read `agent_id` or `agent_type`. `hooks/ds-no-main-chat-code-guard.py` denies any
Write to `.py/.ipynb/.R/.sas/.qmd` with "delegate to a subagent" — advice a subagent cannot follow,
because it *is* the subagent.

**Not confirmed live.** Skill-frontmatter hooks are "scoped to the component's lifetime and only run
when that component is active", and whether a skill counts as active inside a subagent it dispatched
is unresolved. Settle by execution, not reading (see the enforcement checklist's hook-output rule).
The fix is correct either way and is two lines: a guard meaning "main chat" should `allow()` when
`agent_id` is present.

## 3. Scoping axes

| | *when* it applies | *what* it applies to |
|---|---|---|
| `rules/` with `paths:` | always | file glob |
| `applies-to:` constraint | while that skill is loaded | the whole skill |
| **skill-frontmatter hook** | **only while that skill is active** | matcher + whatever the script checks |
| plugin `hooks/hooks.json` | whenever the plugin is enabled | matcher + script |

Phase-scope is the axis `rules/` lacks — and it is exactly the axis `applies-to:` was invented to
provide.

**But the two axes cannot come from one declaration**, because of §2: skill frontmatter gives phase
scope and probably *not* subagent reach; plugin `hooks.json` gives subagent reach but is on whenever
the plugin is enabled. You get one or the other.

**Agent frontmatter resolves it.** Hooks in an agent's frontmatter fire for that agent's own tool
calls — confirmed. So:

| Declared in | Scope you get |
|---|---|
| `agents/ds-analyst.md` frontmatter | fires on the analysis agent's own Write/Edit — **per-role by construction** |
| `agents/ds-engineer.md` frontmatter | same, for engineering |
| plugin `hooks.json` | always-on; must derive phase itself (e.g. from `.planning/` state) |
| skill frontmatter | phase-scoped main-chat work only |

This is the answer to the role-axis problem in §5: the split that `applies-to:` cannot express is
exactly the split that having two agent definitions already expresses. The constraints belong in the
agent that needs them, delivered by a hook on that agent's own tool calls — not hand-copied into a
prompt template by the dispatching skill.

## 4. Measured cost of the current constraint mechanism

`uv run python3 scripts/load-constraints.py <skill> | wc -c`, 2026-07-29:

| Skill | Bytes | ≈ tokens |
|---|---:|---:|
| `ds` | 94,325 | ~23,600 |
| `ds-delegate` | 70,252 | ~17,600 |
| `ds-review` | 54,557 | ~13,600 |
| `ds-fix` | 54,041 | ~13,500 |
| `ds-plan` | 51,122 | ~12,800 |
| `ds-verify` | 38,368 | ~9,600 |
| `ds-implement` | 29,965 | ~7,500 |
| `ds-validate` | 19,147 | ~4,800 |
| **8 skills** | **411,777** | **~103,000** |

**Invoking `/ds` spends ~23.6k tokens on constraints before the user states the task**, all of it
unconditionally.

Two cheaper mechanisms, complementary:

1. **Index at load, full text on demand.** Load a manifest (name, one-line description, path); read
   the file when relevant. ~23.6k → ~1–2k. No new machinery — `ds-analysis-constraints.md` is already
   *described* as "the constraint index, then load:", it just isn't used as one.
2. **Hook-injected `additionalContext`, glob-triggered.** `PreToolUse` on `Write|Edit` matching a path
   glob emits the relevant constraint at the moment it becomes relevant. Zero cost until then, ships
   in a plugin, and reaches subagents. `hooks/_gate_common.py` already exposes `context(event, text)`
   for this shape.

## 5. The role axis (correcting an earlier misdiagnosis)

`ds-delegate` hand-writes constraint `Read` lines into two prompt templates; the analysis template
loads `ds-visualization-integrity` + `ds-table-figure-pairing`, the engineering one loads neither.

This was **twice described as drift. It is not.** All four constraints declare a flat
`applies-to: [ds-delegate]`, so the loader would give every one of them to *both* roles — including
figure-integrity rules to an ETL agent. The hand-written split is **correct scoping the loader cannot
express**: `applies-to:` keys on *skill*, the need is per *agent role*.

"Fixing the drift" by making the loader emit a paste-able block would have shipped a regression.

Glob-triggered injection dissolves this without a new axis: an engineering agent writing `etl.py`
never touches a figure, so the visualization constraint simply never fires.

## 6. Output styles — wrong shape for workflow conventions

- They modify the **system prompt**: *"change how Claude responds, not what Claude knows."* Plot
  conventions (serif, colorblind-safe, 300dpi) are knowledge.
- **Session-global.** One `outputStyle` setting; competing `force-for-plugin` plugins resolve by load
  order. No per-phase or per-domain use.
- **Do not reach subagents** — a subagent runs its own system prompt (a *fork* is the exception).
- Changes need `/clear` or a new session.

The only fit is a whole-session role change where Claude is not doing software engineering at all
(`keep-coding-instructions: false`) — e.g. a writing/research assistant persona.

## 7. Monitors — a real win for marimo

Plugin monitors run a shell command for the session lifetime and deliver each stdout line to Claude
as a notification. Location `monitors/monitors.json` or inline `experimental.monitors`.

`when: "on-skill-invoke:<skill-name>"` starts the monitor the first time that skill is dispatched.

**This deletes an existing footgun.** Mini beat 5 currently tells you to record the marimo-pair PID at
launch and `pkill -f` at teardown, and documents the failure when missed ("the next session's server
discovery finds a stale one serving a notebook nobody is reviewing"). A monitor tears down with the
session.

Caveats: interactive CLI only, unsandboxed at hook trust level, skipped where the Monitor tool is
unavailable — so the launch/pkill path stays as a headless fallback. And every stdout line becomes a
notification, so the command must filter to actionable lines (including failure signatures, or a dead
kernel reads as silence).

## 8. Runtime self-containment — do not convert hooks to TS

AST scan of `hooks/` + `scripts/`, 2026-07-29:

- **Every hook is stdlib-only.** The only non-stdlib imports are local sibling modules
  (`_gate_common`, `footnote_mask`, `wc_file_set`, `workshop_slide_table`, `writing_section_index`).
- Third-party deps exist only in `scripts/`: `lxml`, `pikepdf`, `fontTools`, `uharfbuzz` — PDF/font
  tooling with no TS equivalent worth having.
- Shebang is `#!/usr/bin/env -S uv run python3`; hook `command:` fields use the same form.

So hooks currently require **nothing installed** beyond `uv`. Converting them to TS would *reduce*
self-containment by adding a node/bun runtime. `phase-gate-guard.py` is additionally 568 lines of
hardened YAML edge-case handling (it rejects `'APPROVED'' # invalid'` as a passing value) — rewriting
it re-introduces bugs it already documents.

**The actual gap:** 0 of 48 Python files declare PEP 723 inline dependencies, so the scripts that do
need `lxml` etc. rely on the caller passing `--with`. That is a three-line fix per file, not a
language migration.

Existing TS surface, for reference: `skills/cite-check/*.ts` (5 files), `skills/deep-research/*.ts`,
and 7 `workflows/*.js`. TS is appropriate where the runtime is already JS (workflow scripts).

## 9. Refactor backlog, ordered by evidence

| # | Work | Evidence | Size |
|---|---|---|---|
| 1 | Constraint delivery: index-at-load + agent-frontmatter injection hooks | ~103k tokens across 8 ds skills; ~23.6k on `/ds` alone | large |
| 2 | `agent_id` guard fix | 0 of 48 hooks check it; correct either way | 2 lines |
| 3 | Gate invalidation enforcement | write side is prose in 7 skills, enforced nowhere | 1 hook |
| 4 | marimo-pair as a plugin monitor | deletes mini beat 5's PID/`pkill` teardown | small |
| 5 | PEP 723 inline deps on `scripts/` that need them | 0 of 48 declare; callers must pass `--with` | 3 lines/file |
| 6 | File-type knowledge → `~/.claude/rules/` in dotfiles | typst/qmd/sas knowledge currently needs a skill invocation | small |
| 7 | Dedup: `course-materials` consumes the loader via plugin dependency | it maintains a fork that has already diverged | medium |
| 8 | Collapse 6 inline Context Monitoring copies into the existing constraint | `applies-to:` merely omits `ds-*` | small |
| 9 | **Convert everything to `.ts`** — requested 2026-07-29 | `bun 1.3.14` runs `.ts` directly, so this is *not* a self-containment loss as §8 originally claimed (that argument assumed no JS runtime; correction recorded there). Existing TS: `cite-check/*.ts`, `deep-research.ts`, run via `bun x.ts` | large |

**On #9, the tradeoffs as measured** — recorded so the decision is made with them, not against them:

- **48 hooks are stdlib-only Python.** No `node_modules`, no bundler, no lockfile today. TS needs a dependency story even if bun removes the build step.
- **`phase-gate-guard.py` is 568 lines of hardened YAML edge-case handling** that documents its own past bugs (it must reject `'APPROVED'' # invalid'` as a passing value). Rewriting it re-opens closed bugs in the code that gates every phase transition.
- **Two frontmatter parsers that must agree is a new drift surface** — the same class of bug as the `ds-delegate` template split, and this repo has now been bitten by that twice.
- **Migration order matters if pursued:** integrations first (already TS), then `scripts/` (where the third-party deps live and TS has real ecosystem wins), and hooks last or never — they are the highest-risk, lowest-reward leg.
- The PEP 723 gap (#5) is independent: fix it regardless, since it bites today and a migration would take time.

**Rejected on evidence:** output styles for domain conventions (§6) — wrong category, session-global,
does not reach subagents. Adopting it would be feature-use that makes things worse.

**Not yet assessed:** Artifacts as a review surface.

## 10. Open decisions

- **v0 for the runtime plugin**: glob-triggered constraint injection (measured ~23.6k/invocation win,
  fixes role axis + Task boundary) vs gate invalidation (real correctness hole, unmeasured incidence).
- Whether rules shipped as plugin data get symlinked into `~/.claude/rules/` by a setup skill or
  `SessionStart` hook — there is no native install step for rules.
- Whether `mini` moves into a plugin (deferred until after v0).
- Artifacts as a review surface — not yet assessed.
