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

## User Commands (17)

These are the skills you invoke directly with `/name`:

### Core Workflows

Four primary workflows, each with a fresh-start entry and a midpoint re-entry:

| Start Fresh | Midpoint Re-entry | Domain |
|-------------|-------------------|--------|
| `/dev` | `/dev-debug` | 7-phase feature development with TDD enforcement |
| `/ds` | `/ds-fix` | 6-phase data science with output-first verification and DQ validation |
| `/writing` | `/writing-revise` | 6-phase writing with claim validation and deviation rules |
| `/workshop` | `/workshop-revise` | 4-phase workshop presentations from research papers |

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
| `/workflow-creator` | Design structured multi-phase LLM workflows |
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

DS: `ds-plan`, `ds-delegate`, `ds-implement`, `ds-review`, `ds-validate`, `ds-verify`, `ds-handoff`, `ds-spec-reviewer`, `ds-plan-reviewer`

Writing: `writing-setup`, `writing-outline`, `writing-outline-reviewer`, `writing-precis-reviewer`, `writing-draft`, `writing-econ`, `writing-general`, `writing-legal`, `writing-review`, `writing-validate`, `writing-handoff`

Workshop: (no internal phase skills — `workshop` and `workshop-revise` are both user-facing entry points)

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
| `dev-plan-checker` | Plan review before implementation |
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

Workflows use a `.planning/` state folder (SPEC.md, PLAN.md, LEARNINGS.md, HANDOFF.md, VALIDATION.md) for cross-session persistence. The `/continuous-learning` skill extracts reusable patterns, and hooks automatically save session state.

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
├── agents/                     # Specialized subagents (19)
├── skills/                     # All skills (15 user-facing + 60+ internal)
│   ├── dev/, ds/, writing*/, workshop*/  # Core workflow entry points
│   ├── docx, pdf, pptx, xlsx  # Document formats (symlinks)
│   └── ...                     # Internal phases and auto-invoked skills
├── hooks/                      # Hook scripts (11)
│   ├── hooks.json              # Hook configuration
│   └── *.py                    # Hook implementations
├── references/                 # Shared constraint and reference docs
├── external/
│   └── anthropic-skills/       # Git submodule for document skills
└── PHILOSOPHY.md               # Workflow design philosophy
```

**Key Points:**
- `skills/` contains both user-facing and internal phase skills (auto-discovered; internal skills use `user-invocable: false`)
- `agents/` contains specialized subagents (19, auto-discovered by Claude Code)
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
