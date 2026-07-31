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

`/work` is the lightweight generic entry point; the domain workflows retain their specialized
planning and execution guarantees:

| Start Fresh | Midpoint Re-entry | Domain |
|-------------|-------------------|--------|
| `/work` | Resume the receipt-selected generated plan (`{planFile, planHash}`) with TaskList | Bounded cross-domain work: clarify, approve a proportional plan, execute under `/goal`, independently verify, and obtain human review |
| `/dev` | `/dev-debug` | 7-phase feature development with TDD enforcement |
| `/ds` | `/ds-fix` | Native-plan data science: plan, implement, independently review, and correct wrong results or notebook failures |
| `/writing` | `/writing-revise` | 6-phase writing with claim validation and deviation rules |
| `/workshop` | `/workshop-revise` | 4-phase workshop presentations from research papers |

`/work` composes the shared clarify, generated-plan authentication, implementation/verification, and
human-review doctrine. It reconciles the receipt-selected plan into TaskList and dispatches approved
ready waves through `beat-implement.js`.

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
`look-at`, `visual-verify`, `visual-mockup`, `data-context`, `continuous-learning`, `pattern-capture`, `ai-anti-patterns`, `dev-tools`, `ds-tools`, `dev-worktree`, `obsidian-organize`, `pptx-render`, `headline-card`, `audit-fix-loop`

### Internal Workflow Phases
Dev: `dev-clarify`, `dev-explore`, `dev-design`, `dev-delegate`, `dev-implement`, `dev-tdd`, `dev-review`, `dev-verify`, `dev-handoff`, `dev-spec-reviewer`, `dev-plan-reviewer`, `dev-test`, `dev-test-*` (cross-turn iteration uses Claude Code's built-in `/goal`)

DS: `/ds` is the user-facing planning entry; internal `ds-implement` executes the approved tasks and internal `ds-review` handles terminal review. `/ds-fix` is the user-facing corrective re-entry for wrong results and notebook failures.

Writing: `writing-setup`, `writing-outline`, `writing-outline-reviewer`, `writing-precis-reviewer`, `writing-plan-reviewer`, `writing-draft`, `writing-econ`, `writing-general`, `writing-legal`, internal `writing-review`, `writing-validate`, `writing-handoff`; `/writing-revise` is the corrective midpoint.

Workshop: `workshop-plan-reviewer` plus internal `workshop-generate`/`workshop-verify`; `/workshop-revise` is the corrective midpoint.

---

## Agents

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
| `workflow-auditor` | Read-only workflow architecture and enforcement auditing |
| `writing-prose-reviewer` | Read-only prose-quality grading against domain style rules |
| `writing-source-fidelity-reviewer` | Read-only verification of citations against the writing source ledger |

---

## Workflow lifecycle architecture

Shared lifecycle enforcement is documented in [Workflow lifecycle architecture](docs/workflow-lifecycle-architecture.md). It separates reusable clarification, receipt-selected generated-plan identity (`{planFile, planHash}`), reviewer finalization, mutation boundaries, and human review from the execution and verification adapters used by DS, writing, workshop, and workflow-creator. Dev retains its legacy SPEC/compiler path, while `/work` remains lightweight and procedural.

## Hooks

Hooks auto-run at specific lifecycle events. The table has one row per command target registered in `hooks/hooks.json`:

| Script | Event | Trigger | Purpose |
|--------|-------|---------|---------|
| `session-start.ts` | SessionStart | startup/resume/clear/compact | Inject using-skills meta-skill |
| `session-end.ts` | Stop | * | Update LEARNINGS.md timestamp |
| `pre-compact.ts` | PreCompact | * | Preserve state before compaction |
| `suggest-compact.ts` | PreToolUse | Edit/Write | Suggest compaction when context is large |
| `image-read-guard.ts` | PreToolUse | Read | Redirect to look-at for media files |
| `lint-check.ts` | PostToolUse | Edit/Write | Lint after file changes (ESLint, ruff, lintr) |
| `writing-suggest-verify.ts` | PostToolUse | Edit/Write | Suggest visual verification for writing |
| `atomic-constraint-guard.ts` | PostToolUse | Edit/Write | Validate atomic constraint file structure |
| `writing-prose-check.ts` | PostToolUse | Edit/Write | Check edited prose for writing-quality violations |
| `cite-fidelity-lint.ts` | PostToolUse | Edit/Write | Check edited writing for citation-ledger fidelity |
| `pr-url-logger.ts` | PostToolUse | Bash | Log PR URLs and GitHub Actions status |
| `overflow-check.ts` | PostToolUse | Bash | Detect Typst content overflow after compilation |
| `pattern-scan.ts` | SessionEnd | clear/logout/prompt_input_exit/other | Scan session for reusable patterns |
| `subagent-start.ts` | SubagentStart | * | Inject role-specific context when subagents start |

---

## Session Continuity

Modern native-plan workflows separate durable records by purpose: a hook-owned receipt authenticates and selects one immutable generated plan by `{planFile, planHash}`, Claude Code's `TaskList` is the live task and review-finding record, project auto-memory retains reusable facts, project directories retain real inputs and deliverables, and `.planning/.state/` holds only narrow machine-owned state such as the hash-bound review verdict. Legacy dev keeps its descriptor-v1 artifacts in its isolated compatibility path.

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
