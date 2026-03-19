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

## User Commands (12)

These are the skills you invoke directly with `/name`:

### Core Workflows

Three primary workflows, each with a fresh-start entry and a midpoint re-entry:

| Start Fresh | Midpoint Re-entry | Domain |
|-------------|-------------------|--------|
| `/dev` | `/dev-debug` | 7-phase feature development with TDD enforcement |
| `/ds` | `/ds-fix` | 6-phase data science with output-first verification and DQ validation |
| `/writing` | `/writing-revise` | 6-phase writing with claim validation and deviation rules |

### Document Formats

| Skill | Purpose |
|-------|---------|
| `/docx` | Word document creation, editing, tracked changes |
| `/pdf` | PDF extraction, creation, form filling |
| `/pptx` | Presentation creation and editing |
| `/xlsx` | Spreadsheet creation and analysis |

> Office format skills sourced from [anthropics/skills](https://github.com/anthropics/skills) via git submodule.

### Meta

| Skill | Purpose |
|-------|---------|
| `/skill-creator` | Skill creation with superpowers enforcement patterns |
| `/workflow-creator` | Design structured multi-phase LLM workflows |

---

## Auto-Invoked Skills (60+)

These skills have `user-invocable: false` — Claude loads them automatically when relevant. You don't call them directly.

### Legal & Citation
`bluebook`, `bluebook-audit`, `docx-footnotes`, `source-verify`

### Data Access
`wrds`, `lseg-data`, `gemini-batch`

### Knowledge Management
`nlm`, `google-scholar`, `readwise`, `readwise-chat`, `readwise-search`, `readwise-docs`, `readwise-prune`, `reading-add`

### Scheduling
`scheduling-poll`

### Notebook Tools
`marimo`, `jupytext`, `notebook-debug`

### Utilities
`look-at`, `visual-verify`, `visual-mockup`, `data-context`, `continuous-learning`, `pattern-capture`, `ai-anti-patterns`, `dev-tools`, `ds-tools`, `dev-worktree`, `obsidian-organize`, `pptx-render`, `audit-fix-loop`

### Internal Workflow Phases
Dev: `dev-clarify`, `dev-explore`, `dev-design`, `dev-delegate`, `dev-implement`, `dev-ralph-loop`, `dev-tdd`, `dev-review`, `dev-verify`, `dev-handoff`, `dev-spec-reviewer`, `dev-plan-reviewer`, `dev-test`, `dev-test-*`

DS: `ds-plan`, `ds-delegate`, `ds-implement`, `ds-review`, `ds-validate`, `ds-verify`, `ds-handoff`, `ds-spec-reviewer`, `ds-plan-reviewer`

Writing: `writing-setup`, `writing-outline`, `writing-outline-reviewer`, `writing-precis-reviewer`, `writing-draft`, `writing-econ`, `writing-general`, `writing-legal`, `writing-review`, `writing-validate`, `writing-handoff`

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

## Hooks (10)

Hooks auto-run at specific lifecycle events:

| Script | Event | Trigger | Purpose |
|--------|-------|---------|---------|
| `session-start.py` | SessionStart | startup/resume/clear/compact | Inject using-skills meta-skill |
| `session-end.py` | Stop | * | Update LEARNINGS.md timestamp |
| `pre-compact.py` | PreCompact | * | Preserve state before compaction |
| `suggest-compact.py` | PreToolUse | Edit/Write | Suggest compaction when context is large |
| `readwise-guard.py` | PreToolUse | Readwise MCP calls | Enforce librarian delegation |
| `image-read-guard.py` | PreToolUse | Read | Redirect to look-at for media files |
| `writing-outline-guard.py` | PreToolUse | Write (writing-draft) | Warn when drafting without matching outline |
| `writing-suggest-verify.py` | PostToolUse | Edit/Write | Suggest visual verification for writing |
| `lint-check.py` | PostToolUse | Edit/Write | Lint after file changes (ESLint, ruff, lintr) |
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
├── skills/                     # All skills (12 user-facing + 60+ internal)
│   ├── dev/, ds/, writing*/    # Core workflow entry points
│   ├── docx, pdf, pptx, xlsx  # Document formats (symlinks)
│   └── ...                     # Internal phases and auto-invoked skills
├── hooks/                      # Hook scripts (10)
│   ├── hooks.json              # Hook configuration
│   └── *.py                    # Hook implementations
├── references/                 # Shared constraint and reference docs
├── contexts/                   # Example context modes (see below)
├── rules/                      # Example rules (see below)
├── external/
│   └── anthropic-skills/       # Git submodule for document skills
├── .opencode/                  # OpenCode integration
└── PHILOSOPHY.md               # Workflow design philosophy
```

**Key Points:**
- `skills/` contains both user-facing and internal phase skills (auto-discovered; internal skills use `user-invocable: false`)
- `agents/` contains specialized subagents (18, auto-discovered by Claude Code)
- `hooks/` contains hook entry points called directly by hooks.json
- `references/` contains shared constraint and enforcement docs

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
