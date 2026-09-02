# Workflows

A curated collection of development, data science, writing, workshop, legal, and research workflows for **Claude Code**.

## Quick Start

```bash
# 1. Install the plugin
/plugin marketplace add edwinhu/workflows

# 2. (Optional) Install CLI dependencies for knowledge management, email, and calendar
bash ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/bin/install-deps.sh

# 3. (Optional) Live marimo kernel work — only needed by the `marimo` skill
claude plugin marketplace add marimo-team/marimo-pair
claude plugin install marimo-pair@marimo-pair
```

`marimo-pair` is a separate upstream plugin, deliberately not declared as a hard dependency: an
uninstalled dependency stops the *whole* plugin from loading, and one skill should not be able to
take the other sixty with it. The `marimo` skill routes live-kernel work to
`Skill(skill="marimo-pair:marimo-pair")` and works for notebook authoring without it.

The install script is only needed for skills that use the external tools below. The plugin's own TypeScript hooks and JavaScript/TypeScript workflow runners use Bun; the core workflows do not require the optional CLIs installed by this script.

The script recognizes macOS, Linux, and Windows-like environments on x64 or arm64 and attempts to download matching pre-built binaries from GitHub Releases. If a tool does not publish an asset for the detected platform, the script warns and skips it:

| Tool | Purpose | Used by |
|------|---------|---------|
| [nlm](https://github.com/edwinhu/nlm) | NotebookLM CLI | `librarian` agent, internal `nlm` skill |
| [readwise-custom](https://github.com/edwinhu/readwise-cli) | Readwise RAG/chat/upload | `librarian` agent, internal `readwise-chat` skill |
| [scholar](https://github.com/edwinhu/google-scholar-cli) | Google Scholar search | `librarian` agent, internal `google-scholar` skill |
| [consensus](https://github.com/edwinhu/consensus-cli) | Academic paper search | `librarian` agent, internal `consensus` skill |
| [morgen](https://github.com/edwinhu/morgen-cli) | Calendar & tasks | Direct Bash, or session in `~/areas/assistant/` |
| [superhuman](https://github.com/edwinhu/superhuman-cli) | Email | `email-handling` skill (via Bash) |

Requires `gh` (GitHub CLI). Tools already on your `$PATH` are skipped.

---

## User Commands

These are the skills you invoke directly with `/name`:

### Core Workflows

`/craft` is the spine: clarify with the user, draft a plan they edit and approve, self-set a goal,
run `workflow.js` to implement and independently verify, then put the result in front of a human in
tuicr. Human rejection routes back to CLARIFY. The domain workflows dispatch through it and add
their own computed gate.

| Workflow | Adds to the craft loop |
|----------|------------------------|
| `/craft` | nothing — the generic loop for any task worth doing properly |
| `/dev` | TDD discipline: a failing test before the change, and lens reviews for security, performance and test coverage |
| `/ds` | a computed data-quality gate (DQ1-DQ6, M1, R1) over the panel the run builds |
| `/writing` | a computed plan-grammar and citation gate, plus the domain style register the plan's `Domain:` selects |
| `/workshop` | a computed deck gate over the Typst slides and speaker notes built from a paper |
| `/workflow-creator` | designs, repairs and audits workflows themselves |

Plan review is **computed and happens before dispatch**: `plan-lint.ts` over the built args and
`plan-preflight.ts` executing their commands at baseline, enforced by `craft-dispatch.sh` while the
run is still armed. No agent reads the plan markdown looking for defects.

### Document Formats

Part of the **[document skill group](references/document-skills.md)** — one
pipeline (extract → create → repair → build → render → verify) bundling the
Anthropic Office skills with this project's repair/build/render tooling.

| Skill | Purpose |
|-------|---------|
| `/docx` | Word document creation, editing, tracked changes |
| `/pdf` | PDF extraction, creation, form filling |
| `/pptx` | Presentation creation and editing |
| `/xlsx` | Spreadsheet creation and analysis |
| `/docx-render` | Faithful Word export to PDF/PNG |
| `/law-review-docx` | Markdown/legal draft → law-review-styled Word doc |
| `/law-econ-docx` | Markdown law-and-economics manuscript → author-date, journal-ready Word doc |

> Office format skills sourced from [anthropics/skills](https://github.com/anthropics/skills) via git submodule. Shared converters + the Google-export **OOXML package repair** (`scripts/docx_repair.py`) live in `scripts/`. See **[references/document-skills.md](references/document-skills.md)** for the full group and how the stages decouple.

### Data

| Skill | Purpose |
|-------|---------|
| `/ds-tables` | Publication tables in Python — `pyfixest.etable()` regression tables and `great_tables` GT formatting |
| `/ds-figures` | Publication-ready, accessible figures for papers, slides, and notebooks |
| `/crsp-lseg-splice` | Extend stale CRSP stock panels with current LSEG data |
| `/npx-ownership-panel` | Build the WRDS proxy-voting × ownership panel |
| `/fuzzy-name-matching` | Entity resolution / record linkage by name — char n-gram TF-IDF + `sparse_dot_topn` top-k cosine, normalize-first, scoped + global two-pass |

### Writing, Research & Citation

| Skill | Purpose |
|-------|---------|
| `/cite-check` | Verify academic citations against source PDFs |
| `/de-ai-revise` | Revise flagged prose to remove corpus-validated AI writing tics |

### Meta

| Skill | Purpose |
|-------|---------|
| `/skill-creator` | Skill creation with superpowers enforcement patterns |
| `/plugin-creator` | Plugin-level creation and editing across manifests, hooks, and skills |
| `/workflow-creator` | Create a new structured workflow through shared-v1 |
| `/workflow-creator-improve` | Audit, repair, redesign, or migrate an existing workflow |

---

## Auto-Invoked and Internal Skills

These skills have `user-invocable: false` — Claude loads them automatically when relevant or a workflow dispatches them internally. You don't call them directly.

### Legal & Citation
`bluebook`, `bluebook-audit`, `docx-repair`, `source-verify`

### Data Access
`wrds`, `lseg-data`, `gemini-batch`

### Knowledge Management
`nlm`, `google-scholar`, `readwise`, `readwise-chat`, `readwise-search`, `readwise-docs`, `readwise-prune`

### Research
`consensus`, `research`

### Notebook Tools
`marimo`, `jupytext`, `notebook-debug`

### Utilities
`farm-out`, `look-at`, `visual-verify`, `visual-mockup`, `data-context`, `continuous-learning`, `pattern-capture`, `ai-anti-patterns`, `obsidian-organize`, `pptx-render`, `headline-card`

`farm-out` is the dispatcher craft runs its agents through — `craft-dispatch.sh` uses the sibling copy
by default, so the plugin dispatches without an outside install. It fetches its own SDK on first run.

### Internal Workflow Phases

None. The craft spine has no sub-skills: the phases are beats inside `skills/craft/workflow.js`,
dispatched as agents, so there is nothing to invoke by name and nothing to keep in sync.

---

## Agents

Specialized subagents. The directory states the scope: `agents/` is auto-discovered by Claude Code
and registers plugin-scoped (`workflows:<name>`), while `user-agents/` is not auto-discovered and
registers user-scoped (bare name, `hooks:` honoured) via a symlink into `~/.claude/agents/`:

| Agent | Role | Scope | Hooks |
|-------|------|-------|-------|
| `librarian` | Knowledge management orchestration (NLM, Readwise, Scholar, Workspace) | plugin | — |
| `ds` | Empirical implementer — datasets, tables, figures, numbers; C/V/A/E constraints arrive as task `refs` | user | — |
| `ds-reviewer` | Read-only grading of existing empirical work against C/V/A/E constraints | user | — |
| `workshop` | Talk implementer — Typst deck and speaker notes from a paper; preloads `typst:typst` | user | — |
| `workshop-reviewer` | Read-only grading of `slides.typ` and `notes.typ` against the canonical Typst modules | user | — |
| `writing` | General long-form prose — memos, letters, briefs, reports | user | source-first `PreToolUse` guard |
| `writing-legal` | Law review prose — footnotes, Bluebook short forms | user | source-first `PreToolUse` guard |
| `writing-econ` | Finance and accounting journal prose | user | source-first `PreToolUse` guard |
| `writing-reviewer` | Read-only prose grading against the preloaded register and the tic table | user | — |

The craft spine's per-beat verifiers are still dispatched from `skills/craft/workflow.js` with the
prompt the run needs, so no agent file exists for them. Implementers are the exception: `/ds`,
`/writing` and `/workshop` each set `implementerAgentType` to the matching agent above, and the
teaching plugin sets it to its own `lecture-impl`. `/dev` and `/workflow-creator` deliberately leave
it unset.

## Why subagents

Claude Code's system prompt tells the model what kind of work it is doing. Its `# Doing tasks`
section opens with "The user will primarily request you to perform software engineering tasks", and
instructs that an unclear instruction be read in that context. A separate `# Tone and style` section
asks for short, concise responses and `file_path:line_number` references. Neither is wrong for code.
Both are wrong for a law review article, a lecture, or a seminar deck, where the deliverable is long
and the reader is a person rather than a terminal.

An output style can remove the first of those and cannot remove the second. Setting a style drops
`# Doing tasks` entirely unless the style's frontmatter sets `keep-coding-instructions: true`;
`# Tone and style` is emitted unconditionally. So a custom style does not replace the framing — it
competes with what survives, and the surviving half is precisely the half that shortens prose and
formats references for an editor.

A subagent replaces the prompt instead of arguing with it. A custom subagent's body *is* its entire
system prompt: Anthropic's documentation says a subagent receives that prompt plus environment
details, not the full Claude Code system prompt, and `claude --agent <name>` applies the same to a
main session. Asking one confirms it — it reports neither the software-engineering sentence nor a
`# Tone and style` section at all. That is the whole reason this plugin routes prose, decks,
teaching material and empirical work through agents rather than tuning a style.

The directory split follows from a second quirk. A `hooks:` block in agent frontmatter is ignored
for plugin-shipped agents and honoured for user-scoped ones, so any agent that needs a blocking
guard has to be user-scoped. `user-agents/` is not a discovery location, so a symlink into
`~/.claude/agents/` registers each file user-scoped under its bare name with its hooks live, while
`agents/` stays auto-discovered and plugin-scoped. It is one file either way, and the plugin still
ships both.

Judging is not writing, and the roster's shape follows from that. A review lens only reads, so the
built-in `Explore` plus a good prompt and the right reference paths is sufficient and cheaper; an
agent earns a file only when it needs a custom prompt, hooks, or preloaded skills. The three domain
reviewers exist because grading against a constraint set needs a body this repo controls — a
built-in judge's prompt is predefined, so the modules it grades against have to reach it as task
`refs` rather than as anything the lens can skip — and no exam reviewer exists because a prompt
covers it. Constraint prose itself is never a skill: it has one canonical home under
`references/constraints/` (Typst modules under `~/.claude/skills/typst/references/constraints/`),
reaches dispatched agents as `refs`, and reaches interactive ones through the `typst:typst` bang
line. The same test explains the two workflows that set no implementer override: `/dev` and
`/workflow-creator` produce code and workflow definitions, where the software-engineering framing is
correct rather than a defect.

The register skills — `writing-general`, `writing-legal`, `writing-econ`, `ai-anti-patterns` — are
`user-invocable: false` for the same reason. Loading a register into the main chat stacks it on top
of the framing it is meant to displace;
routing the work to an agent that preloads it replaces that prompt instead. They deliberately do not
set `disable-model-invocation: true`, which would break both the `skills:` preload and the Skill
tool path a persona session needs.

---

## Workflow lifecycle architecture

Every workflow runs the same loop, in `skills/craft/workflow.js`. The plan's `<!-- craft:dispatch -->`
block is the sole authority and its canonical `specHash` is verified by each dispatched agent; the
gate is computed in JS from raw counts, fails closed on a dead agent, and returns the selector that
drives the fix loop. A domain workflow contributes its own mechanical checks and review lenses — it
does not get its own lifecycle.

## Hooks

Hooks auto-run at specific lifecycle events. The table has one row per command target registered in `hooks/hooks.json`:

| Script | Event | Trigger | Purpose |
|--------|-------|---------|---------|
| `session-start.ts` | SessionStart | startup/resume/clear/compact | Inject using-skills meta-skill; report an unfinished craft run |
| `session-end.ts` | Stop | * | Update LEARNINGS.md timestamp |
| `suggest-compact.ts` | PreToolUse | Edit/Write | Suggest compaction when context is large |
| `image-read-guard.ts` | PreToolUse | Read | Redirect to look-at for media files |
| `lint-check.ts` | PostToolUse | Edit/Write | Lint after file changes (ESLint, ruff, lintr) |
| `atomic-constraint-guard.ts` | PostToolUse | Edit/Write | Validate atomic constraint file structure |
| `writing-prose-check.ts` | PostToolUse | Edit/Write | Check edited prose for writing-quality violations |
| `cite-fidelity-lint.ts` | PostToolUse | Edit/Write | Check edited writing for citation-ledger fidelity |
| `pr-url-logger.ts` | PostToolUse | Bash | Log PR URLs and GitHub Actions status |
| `overflow-check.ts` | PostToolUse | Bash | Detect Typst content overflow after compilation |
| `pattern-scan.ts` | SessionEnd | clear/logout/prompt_input_exit/other | Scan session for reusable patterns |

---

## Session Continuity

A craft run keeps two records, one owner each: the approved plan at `.claude/plans/<slug>.md` is the
run's authority and the file craft hashes in place, and `.craft/<run-id>/` holds the args, the
verdict JSON and the plan bytes each round actually ran under. Project auto-memory retains reusable
facts; project directories retain real inputs and deliverables.

For cross-session task persistence, set `CLAUDE_CODE_TASK_LIST_ID` in `.envrc`:

```bash
export CLAUDE_CODE_TASK_LIST_ID="my-project"
```

---

## Repository Structure

```
workflows/
├── .claude-plugin/             # Plugin manifest
│   ├── plugin.json             # Version and metadata
│   └── marketplace.json        # Marketplace listing
├── agents/                     # Plugin-scoped subagents (auto-discovered)
├── user-agents/                # User-scoped subagents (symlinked into ~/.claude/agents/)
├── skills/                     # User-facing and internal skills
│   ├── craft/                  # The spine: workflow.js, plan-lint, dispatch, gate
│   ├── dev/, ds/, writing/, workshop/, workflow-creator/  # Domain workflows
│   ├── farm-out/               # The dispatcher craft farms agents out through
│   ├── docx, pdf, pptx, xlsx  # Document formats (symlinks)
│   └── ...                     # Internal phases and auto-invoked skills
├── bin/                        # Optional dependency installer
├── docs/                       # Architecture and investigation records
├── hooks/                      # Hook scripts
│   ├── hooks.json              # Hook configuration
│   └── *.ts                    # Hook implementations run with Bun
├── references/                 # Shared constraint and reference docs
├── scripts/                    # Compilers, checks, renderers, and support tools
├── tests/                      # Contract and regression tests
├── workflows/                  # Shared and domain workflow runners
│   ├── lib/                    # Runner libraries and task contracts
│   └── templates/              # Dynamic workflow templates
├── external/
│   └── anthropic-skills/       # Git submodule for document skills
└── PHILOSOPHY.md               # Workflow design philosophy
```

**Key Points:**
- `skills/` contains both user-facing and internal phase skills (auto-discovered; internal skills use `user-invocable: false`)
- `agents/` contains plugin-scoped subagents, auto-discovered by Claude Code as `workflows:<name>`
- `user-agents/` contains user-scoped subagents; they reach Claude Code only through the symlink
  into `~/.claude/agents/` that `~/dotfiles/scripts/setup-claude-symlinks.sh` creates
- `hooks/` contains TypeScript hook entry points called directly by `hooks.json`
- `workflows/` contains the shared runner plus writing, workshop, and workflow-creator adapters
- `scripts/` contains deterministic compilers, validation checks, renderers, and support tools
- `references/` contains shared constraint and enforcement docs

## Updating External Skills

The office format skills come from Anthropic's official skills repo. To update:

```bash
git submodule update --remote external/anthropic-skills
```

## Acknowledgments

This project was heavily inspired by [obra/superpowers](https://github.com/obra/superpowers), particularly:
- The SessionStart hook pattern for injecting meta-skills
- The "using-skills" approach that teaches HOW to use skills rather than listing WHAT skills exist
- The philosophy that skills should be invoked on-demand, not dumped into every session

Office format skills (docx, pdf, pptx, xlsx) are from [anthropics/skills](https://github.com/anthropics/skills).

## License

MIT

## Author

Edwin Hu
