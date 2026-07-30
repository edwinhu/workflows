# Workflows

A curated collection of development, data science, writing, workshop, legal, and research workflows for **Claude Code**.

## Quick Start

```bash
# 1. Install the plugin
/plugin marketplace add edwinhu/workflows

# 2. (Optional) Install CLI dependencies for knowledge management, email, and calendar
bash ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/bin/install-deps.sh
```

The core workflows (`/dev`, `/ds`, `/writing`, `/workshop`, document formats) work without any CLI dependencies. The install script is only needed for skills that use external tools.

This downloads pre-built binaries for your platform (macOS arm64, Linux x64, Windows x64) from GitHub Releases:

| Tool | Purpose | Used by |
|------|---------|---------|
| [nlm](https://github.com/edwinhu/nlm) | NotebookLM CLI | `librarian` agent, `/nlm` |
| [readwise-custom](https://github.com/edwinhu/readwise-cli) | Readwise RAG/chat/upload | `librarian` agent, `/readwise-chat` |
| [scholar](https://github.com/edwinhu/google-scholar-cli) | Google Scholar search | `librarian` agent, `/google-scholar` |
| [consensus](https://github.com/edwinhu/consensus-cli) | Academic paper search | `librarian` agent, `/consensus` |
| [morgen](https://github.com/edwinhu/morgen-cli) | Calendar & tasks | Direct Bash, or session in `~/areas/assistant/` |
| [superhuman](https://github.com/edwinhu/superhuman-cli) | Email | `email-handling` skill (via Bash) |

Requires `gh` (GitHub CLI). Tools already on your `$PATH` are skipped.

---

## User Commands

These are the skills you invoke directly with `/name`:

### Core Workflows

`/work` is the lightweight generic entry point; the domain workflows retain their specialized
planning and execution guarantees:

| Start Fresh | Midpoint Re-entry | Domain |
|-------------|-------------------|--------|
| `/work` | Resume `.planning/WORK.md` | Bounded cross-domain work: clarify, approve a proportional plan, execute under `/goal`, independently verify, and obtain human review |
| `/dev` | `/dev-debug` | 7-phase feature development with TDD enforcement |
| `/ds` | `/ds-implement` | Native-plan data science: plan, implement, and independent review |
| `/writing` | `/writing-revise` | 6-phase writing with claim validation and deviation rules |
| `/workshop` | `/workshop-revise` | 4-phase workshop presentations from research papers |

`/work` composes the shared clarify, implementation/verification, and human-review doctrine but stays
prompt-procedural: it does not use the native-plan hooks shared by DS, writing, and workshop, or the `beat-implement.js` runner.

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
| `/docx-render`, `/pptx-render` | Faithful export to PDF/PNG (Word/x2t/LibreOffice) |
| `/docx-repair` | Repair a Google Docs / Word Online-damaged .docx — package/XML wiring + footnote markup |
| `/law-review-docx` | Markdown/legal draft → law-review-styled Word doc |

> Office format skills sourced from [anthropics/skills](https://github.com/anthropics/skills) via git submodule. Shared converters + the Google-export **OOXML package repair** (`scripts/docx_repair.py`) live in `scripts/`. See **[references/document-skills.md](references/document-skills.md)** for the full group and how the stages decouple.

### Data

| Skill | Purpose |
|-------|---------|
| `/ds-tables` | Publication tables in Python — `pyfixest.etable()` regression tables and `great_tables` GT formatting |
| `/fuzzy-name-matching` | Entity resolution / record linkage by name — char n-gram TF-IDF + `sparse_dot_topn` top-k cosine, normalize-first, scoped + global two-pass |

### Meta

| Skill | Purpose |
|-------|---------|
| `/skill-creator` | Skill creation with superpowers enforcement patterns |
| `/workflow-creator` | Create a new structured workflow through shared-v1 |
| `/workflow-creator-improve` | Audit, repair, redesign, or migrate an existing workflow |
| `/headline-card` | LWT-style headline cards for Typst presentations |

---

## Auto-Invoked Skills (60+)

These skills have `user-invocable: false` — Claude loads them automatically when relevant. You don't call them directly.

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
`look-at`, `visual-verify`, `visual-mockup`, `data-context`, `continuous-learning`, `pattern-capture`, `ai-anti-patterns`, `dev-tools`, `ds-tools`, `dev-worktree`, `obsidian-organize`, `pptx-render`, `audit-fix-loop`, `plugin-creator`

### Internal Workflow Phases
Dev: `dev-clarify`, `dev-explore`, `dev-design`, `dev-delegate`, `dev-implement`, `dev-tdd`, `dev-review`, `dev-verify`, `dev-handoff`, `dev-spec-reviewer`, `dev-plan-reviewer`, `dev-test`, `dev-test-*` (cross-turn iteration uses Claude Code's built-in `/goal`)

DS: `/ds` plans, `/ds-implement` executes native tasks, and `/ds-review` independently reviews the resulting analysis.

Writing: `writing-setup`, `writing-outline`, `writing-outline-reviewer`, `writing-precis-reviewer`, `writing-plan-reviewer`, `writing-draft`, `writing-econ`, `writing-general`, `writing-legal`, internal `writing-review`, `writing-validate`, `writing-handoff`; `/writing-revise` is the corrective midpoint.

Workshop: `workshop-plan-reviewer` plus internal `workshop-generate`/`workshop-verify`; `/workshop-revise` is the corrective midpoint.

---

## Agents (20)

Specialized subagents auto-discovered by Claude Code from `agents/`:

| Agent | Role |
|-------|------|
| `planner` | Implementation planning for complex features |
| `architect` | System design and technical decisions |
| `tdd-guide` | TDD workflow enforcement |
| `dev-implementer` | Feature implementation with automatic linting |
| `dev-debugger` | Hypothesis-driven debugging with serial iteration |
| `dev-verifier` | Goal-backward verification (4-level: exists, substantive, wired, functional) |
| `plan-checker` | Generic domain-loaded plan review before implementation |
| `test-gap-auditor` | Requirement-to-test coverage mapping and gap filling |
| `ds-analyst` | Data analysis with output-first verification |
| `ds-engineer` | Data engineering pipelines, ETL, and transformations |
| `code-reviewer` | Code quality, security, and maintainability review |
| `security-reviewer` | Security vulnerability detection |
| `build-error-resolver` | Fix build/type errors with minimal diffs |
| `e2e-runner` | Playwright E2E testing |
| `refactor-cleaner` | Dead code cleanup and consolidation |
| `doc-updater` | Documentation sync and codemap updates |
| `data-explorer` | EDA and data profiling |
| `librarian` | Knowledge management orchestration (NLM, Readwise, Scholar) |

---

## Workflow lifecycle architecture

Shared lifecycle enforcement is documented in [Workflow lifecycle architecture](docs/workflow-lifecycle-architecture.md). It separates reusable clarification, exact approved-plan identity, reviewer verdicts, mutation boundaries, and human-review ledgers from DS, writing, and workshop execution/verification adapters; dev retains its compiler path.

## Hooks (11)

Hooks auto-run at specific lifecycle events:

| Script | Event | Trigger | Purpose |
|--------|-------|---------|---------|
| `session-start.py` | SessionStart | startup/resume/clear/compact | Inject using-skills meta-skill |
| `session-end.py` | Stop | * | Update LEARNINGS.md timestamp |
| `pre-compact.py` | PreCompact | * | Preserve state before compaction |
| `suggest-compact.py` | PreToolUse | Edit/Write | Suggest compaction when context is large |
| `image-read-guard.py` | PreToolUse | Read | Redirect to look-at for media files |
| `lint-check.py` | PostToolUse | Edit/Write | Lint after file changes (ESLint, ruff, lintr) |
| `writing-suggest-verify.py` | PostToolUse | Edit/Write | Suggest visual verification for writing |
| `atomic-constraint-guard.py` | PostToolUse | Edit/Write | Validate atomic constraint file structure |
| `pr-url-logger.py` | PostToolUse | Bash | Log PR URLs and GitHub Actions status |
| `overflow-check.py` | PostToolUse | Bash | Detect Typst content overflow after compilation |
| `pattern-scan.py` | SessionEnd | clear/logout | Scan session for reusable patterns |

---

## Session Continuity

Native-plan workflows separate durable records by purpose: `.planning/PLAN.md` is the immutable approved plan, Claude Code's `TaskList` is the live task record, project auto-memory retains reusable facts, automated findings use domain-specific artifacts such as `.planning/AUTOMATED_REVIEW.md`, and terminal user dispositions live in `.planning/HUMAN_REVIEW.md`.

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
│   ├── work/, dev/, ds/, writing*/, workshop*/  # Workflow entry points
│   ├── beat-clarify/, beat-implement/, beat-review/  # Shared lifecycle primitives
│   ├── docx, pdf, pptx, xlsx  # Document formats (symlinks)
│   └── ...                     # Internal phases and auto-invoked skills
├── hooks/                      # Hook scripts
│   ├── hooks.json              # Hook configuration
│   └── *.py                    # Hook implementations
├── references/                 # Shared constraint and reference docs
├── external/
│   └── anthropic-skills/       # Git submodule for document skills
└── PHILOSOPHY.md               # Workflow design philosophy
```

**Key Points:**
- `skills/` contains both user-facing and internal phase skills (auto-discovered; internal skills use `user-invocable: false`)
- `agents/` contains specialized subagents, auto-discovered by Claude Code
- `hooks/` contains hook entry points called directly by hooks.json
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
