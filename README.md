# Workflows

A curated collection of development, data science, writing, workshop, legal, and research workflows for **Claude Code**.

## Quick Start

```bash
# 1. Install the plugin
/plugin marketplace add edwinhu/workflows

# 2. (Optional) Install CLI dependencies for knowledge management, email, and calendar
bash ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/bin/install-deps.sh
```

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

Specialized subagents auto-discovered by Claude Code from `agents/`:

| Agent | Role |
|-------|------|
| `librarian` | Knowledge management orchestration (NLM, Readwise, Scholar) |
| `writing-prose-reviewer` | Read-only prose-quality grading against the preloaded register |

The craft spine's implementers, verifiers and reviewers are dispatched from
`skills/craft/workflow.js` with the prompt the run needs; they are not named subagent types, so the
per-role agent files the beat spine required are gone.

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
├── agents/                     # Specialized subagents
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
- `agents/` contains specialized subagents, auto-discovered by Claude Code
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
