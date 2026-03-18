# Workflows

A curated collection of development, data science, writing, legal, and research workflows -- available for both **Claude Code** and **OpenCode** from a single source.

## Quick Start

### Claude Code
```bash
/plugin marketplace add edwinhu/workflows
/plugin install dev
```

### OpenCode
```bash
# Clone the opencode-compatibility branch
git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git ~/.config/opencode/workflows

# Install plugin (optional, recommended)
mkdir -p ~/.config/opencode/plugin
cp ~/.config/opencode/workflows/.opencode/plugin/workflows.js ~/.config/opencode/plugin/

# In OpenCode: find_skills
```

See [.opencode/INSTALL.md](.opencode/INSTALL.md) for full details and alternatives.

---

## Skills (48)

### Core Workflows

Three primary workflows, each with a fresh-start entry and a midpoint re-entry:

| Start Fresh | Midpoint Re-entry | Domain |
|-------------|-------------------|--------|
| `/dev` | `/dev-debug` | 7-phase feature development with TDD enforcement |
| `/ds` | `/ds-fix` | 6-phase data science with output-first verification and DQ validation |
| `/writing` | `/writing-review` + `/writing-revise` | 6-phase writing with claim validation and deviation rules |

### Legal & Citation

| Skill | Purpose |
|-------|---------|
| `/bluebook` | Bluebook 21st edition citation formatting (cases, statutes, secondary sources) |
| `/bluebook-audit` | 7-phase document audit: extract, check, report, correct, verify, crossrefs, archive |
| `/docx-footnotes` | Repair DOCX footnote damage from cloud editors (Google Docs, Word Online) |

### Data Access

| Skill | Purpose |
|-------|---------|
| `/wrds` | WRDS PostgreSQL + SAS ETL patterns (Compustat, CRSP, EDGAR, ISS, ExecuComp) |
| `/lseg-data` | LSEG Data Library (Refinitiv) for market data, ESG, M&A, PE/VC |
| `/gemini-batch` | Gemini Batch API for large-scale LLM document processing |

### Knowledge Management

| Skill | Purpose |
|-------|---------|
| `/nlm` | NotebookLM CLI: notebooks, sources, audio overviews, research |
| `/google-scholar` | Google Scholar CLI: search, BibTeX export, cite, download |
| `/readwise` | Readwise highlight search and source gathering |
| `/readwise-chat` | RAG over Readwise highlights via GPT-5.1 |
| `/readwise-search` | Search highlights, quotes, annotations by keyword |
| `/readwise-docs` | Readwise Reader document management (list, save, update, delete) |
| `/readwise-prune` | Clean up stale Readwise Reader documents |
| `/reading-add` | Add file or URL to reading inbox |

### Scheduling

| Skill | Purpose |
|-------|---------|
| `/scheduling-poll` | Create Morgen scheduling polls with pre-filled availability via Firestore API |

### Document Formats

| Skill | Purpose |
|-------|---------|
| `/docx` | Word document creation, editing, tracked changes |
| `/pdf` | PDF extraction, creation, form filling |
| `/pptx` | Presentation creation and editing |
| `/xlsx` | Spreadsheet creation and analysis |

> Office format skills sourced from [anthropics/skills](https://github.com/anthropics/skills) via git submodule.

### Notebook Tools

| Skill | Purpose |
|-------|---------|
| `/marimo` | Marimo reactive Python notebooks |
| `/jupytext` | Jupyter notebooks as text files for version control |
| `/notebook-debug` | Debug runtime errors in Jupyter/marimo notebooks |

### Utility & Meta

| Skill | Purpose |
|-------|---------|
| `/look-at` | Multimodal file analysis (PDFs, images, diagrams, charts) via Gemini |
| `/visual-verify` | Render-vision-fix loops via Gemini vision |
| `/skill-creator` | Skill creation with superpowers enforcement patterns (wraps built-in skill-creator) |
| `/workflow-creator` | Design structured multi-phase LLM workflows |
| `/data-context` | Extract dataset knowledge into reusable skills |
| `/continuous-learning` | Cross-project pattern extraction |
| `/ai-anti-patterns` | Detect 12 categories of AI writing indicators |
| `/dev-tools` | Discover available dev plugins and MCP servers |
| `/ds-tools` | Discover available DS plugins and MCP servers |
| `/dev-worktree` | Git worktree isolation with automatic dependency setup |
| `/companion` | Launch and correctly frame companion (host Claude Code) sessions |

---

## Agents (18)

Specialized subagents auto-discovered by Claude Code from `agents/`:

| Agent | Role |
|-------|------|
| `assistant` | Personal productivity (email, calendar, tasks, notes, Google Workspace) |
| `planner` | Implementation planning for complex features |
| `architect` | System design and technical decisions |
| `tdd-guide` | TDD workflow enforcement |
| `dev-implementer` | Feature implementation with automatic linting |
| `dev-debugger` | Hypothesis-driven debugging with serial iteration |
| `dev-verifier` | Goal-backward verification (4-level: exists, substantive, wired, functional) |
| `dev-plan-checker` | Plan review before implementation |
| `test-gap-auditor` | Requirement-to-test coverage mapping and gap filling |
| `ds-analyst` | Data analysis with output-first verification |
| `code-reviewer` | Code quality, security, and maintainability review |
| `security-reviewer` | Security vulnerability detection |
| `build-error-resolver` | Fix build/type errors with minimal diffs |
| `e2e-runner` | Playwright E2E testing |
| `refactor-cleaner` | Dead code cleanup and consolidation |
| `doc-updater` | Documentation sync and codemap updates |
| `data-explorer` | EDA and data profiling |
| `librarian` | Knowledge management orchestration (NLM, Readwise, Scholar) |

---

## Hooks (9)

Hooks auto-run at specific lifecycle events:

| Script | Event | Trigger | Purpose |
|--------|-------|---------|---------|
| `session-start.py` | SessionStart | startup/resume/clear/compact | Inject using-skills meta-skill |
| `session-end.py` | Stop | * | Update LEARNINGS.md timestamp |
| `pre-compact.py` | PreCompact | * | Preserve state before compaction |
| `suggest-compact.py` | PreToolUse | Edit/Write | Suggest compaction when context is large |
| `readwise-guard.py` | PreToolUse | Readwise MCP calls | Enforce librarian delegation |
| `image-read-guard.py` | PreToolUse | Read | Redirect to look-at for media files |
| `lint-check.py` | PostToolUse | Edit/Write | Lint after file changes (ESLint, ruff, lintr) |
| `writing-suggest-verify.py` | PostToolUse | Edit/Write | Suggest visual verification for writing |
| `pr-url-logger.py` | PostToolUse | Bash | Log PR URLs and GitHub Actions status |

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
├── agents/                     # Specialized subagents (18)
│   ├── planner.md, architect.md, tdd-guide.md
│   ├── dev-implementer.md, ds-analyst.md
│   ├── code-reviewer.md, security-reviewer.md
│   ├── build-error-resolver.md, e2e-runner.md
│   ├── refactor-cleaner.md, doc-updater.md
│   ├── data-explorer.md, librarian.md, assistant.md
├── skills/                     # User-facing skills (48)
│   ├── dev/, ds/, writing*/    # Core workflow entry points
│   ├── bluebook/, bluebook-audit/, docx-footnotes/  # Legal
│   ├── wrds/, lseg-data/, gemini-batch/  # Data access
│   ├── nlm/, google-scholar/, readwise*/, reading-add/  # Knowledge management
│   ├── scheduling-poll/           # Scheduling
│   ├── docx, pdf, pptx, xlsx  # Document formats (symlinks)
│   ├── marimo/, jupytext/, notebook-debug/  # Notebooks
│   └── look-at/, visual-verify/, ...  # Utilities
├── hooks/                      # Hook scripts (9)
│   ├── hooks.json              # Hook configuration
│   └── *.py                    # Hook implementations
├── lib/
│   ├── skills/                 # Internal phase skills (37)
│   └── references/             # Reference docs and templates
├── contexts/                   # Example context modes (see below)
├── rules/                      # Example rules (see below)
├── external/
│   └── anthropic-skills/       # Git submodule for document skills
├── .opencode/                  # OpenCode integration
└── PHILOSOPHY.md               # Workflow design philosophy
```

**Key Points:**
- `agents/` contains specialized subagents (18, auto-discovered by Claude Code)
- `skills/` contains user-facing skills (48, auto-discovered)
- `hooks/` contains hook entry points called directly by hooks.json
- `lib/skills/` contains internal phase skills (dev-implement, ds-verify, etc.)

**Example Content (not auto-loaded):**

The `rules/` and `contexts/` directories contain **example content** for users to copy to their own configuration. These are NOT auto-loaded by the plugin.

To use rules and contexts, copy them to your user-level config and reference in your CLAUDE.md:

```bash
# Copy to user config
cp -r rules/ ~/.claude/rules/
cp -r contexts/ ~/.claude/contexts/
```

Then in `~/.claude/CLAUDE.md`, reference them:

```markdown
## Modular Rules
Detailed guidelines are in `~/.claude/rules/`:
- security.md - Security checks, secret management
- coding-style.md - File organization, error handling
- testing.md - TDD workflow, coverage requirements
```

See the [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code) for CLAUDE.md best practices.

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
