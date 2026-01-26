# Workflows

A curated collection of development, data science, and writing workflows—available for both **Claude Code** and **OpenCode** from a single source.

## Quick Start

### Claude Code
```bash
/plugin marketplace add edwinhu/workflows
/plugin install dev
```

### VS Code / GitHub Copilot

**One-line install:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/edwinhu/workflows/main/.copilot/install.sh)
```

Or if you have the repo cloned locally:
```bash
bash ~/projects/workflows/.copilot/install.sh
```

Then **restart VS Code**.

> **⚠️ Note:** Requires enabling experimental settings (`chat.useClaudeSkills`, `chat.customAgentInSubagent.enabled`) which are subject to change. See installation guide for details.

**Verify it works:**
In VS Code, chat with Copilot:
```
What workflows skills are available?
```

See [.copilot/INSTALL.md](.copilot/INSTALL.md) for manual installation and troubleshooting.

#### ⚠️ IMPORTANT: Skill Chaining in Copilot

Skills in Copilot work in phases. **Each phase requires manual invocation of the next phase** (unlike Claude Code, where skills auto-chain).

When a skill completes, it tells you what’s next. **You must invoke it explicitly** using `runSubagent()`.

Example workflow:
```
/dev-brainstorm completes
  → You invoke: runSubagent(..., prompt=”Continue with /dev-explore...”)
  → /dev-explore completes
  → You invoke: runSubagent(..., prompt=”Continue with /dev-clarify...”)
  [and so on through all 7 phases]
```

**See [.copilot/QUICK_START.md](.copilot/QUICK_START.md) for the full skill chaining protocol.**

**Multi-Agent Coordination:** If you run multiple agents before invoking a skill (e.g., Plan agent → then /dev skill), read the “MULTI-AGENT COORDINATION” section in `~/.config/Code/User/prompts/workflows.instructions.md` for how to pass context between them. This is a known gap in Copilot that requires manual workaround.

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

## Available Plugins

### dev (v0.5.0)

**Full feature development workflow with TDD enforcement**

A comprehensive development plugin that enforces test-driven development practices through structured phases: brainstorm, plan, implement, review, and verify.

**Commands:**
- `/dev` - Full feature development workflow with TDD enforcement
- `/dev-brainstorm` - Socratic design exploration before implementation
- `/dev-plan` - Codebase exploration and task breakdown
- `/dev-implement` - TDD implementation with RED-GREEN-REFACTOR cycle
- `/dev-debug` - Systematic debugging with root cause investigation
- `/dev-review` - Code review combining spec compliance and quality checks
- `/dev-verify` - Verification gate requiring fresh runtime evidence
- `/dev-tools` - List available development plugins and MCP servers

**Tags:** `development`, `tdd`, `testing`, `code-review`

---

### ds (v0.5.0)

**Data science workflow with output-first verification**

A data science plugin focused on reproducibility and output verification, with specialized skills for academic and financial data access.

**Commands:**
- `/ds` - Data science workflow with output-first verification
- `/ds-brainstorm` - Clarify analysis objectives through Socratic questioning
- `/ds-plan` - Data profiling and analysis task breakdown
- `/ds-implement` - Output-first implementation with verification at each step
- `/ds-review` - Methodology and statistical validity review
- `/ds-verify` - Reproducibility verification before completion
- `/ds-tools` - List available data science plugins and MCP servers

**Data Access Skills:**
- `/wrds` - WRDS PostgreSQL access for Compustat, CRSP, EDGAR data
- `/lseg-data` - LSEG Data Library (Refinitiv) for market data and fundamentals
- `/gemini-batch` - Gemini Batch API for large-scale LLM document processing

**Notebook Skills:**
- `/marimo` - Marimo reactive Python notebooks
- `/jupytext` - Jupyter notebooks as text files for version control

**Hooks:**
- Data quality checker
- Output verifier
- Reproducibility checker

**Tags:** `data-science`, `wrds`, `lseg`, `jupyter`, `analysis`

---

### writing (v0.4.0)

**Writing workflow with style guides, brainstorming, and AI anti-pattern detection**

A writing plugin providing style guidance, topic discovery from Readwise highlights, and automatic detection of AI writing patterns.

**Skills:**
- `/writing` - General writing guidance using Strunk & White’s Elements of Style
- `/writing-econ` - Economics and finance writing using McCloskey’s Economical Writing
- `/writing-legal` - Academic legal writing using Volokh’s Academic Legal Writing
- `/writing-brainstorm` - Discover topics and gather sources from Readwise highlights
- `/ai-anti-patterns` - Detect and revise AI writing indicators (12 pattern categories)

**MCP Servers:**
- `readwise` - Readwise MCP for highlight search and source gathering

**Hooks:**
- PostToolUse hook on Write/Edit that warns on AI anti-patterns

**Tags:** `writing`, `editing`, `style`, `ai-detection`, `readwise`

---

### shared

**Shared skills and utilities across plugins**

Contains common skills used by multiple plugins, including office document format skills.

**Skills:**
- `/docx` - Word document creation, editing, tracked changes
- `/pdf` - PDF extraction, creation, form filling
- `/pptx` - Presentation creation and editing
- `/xlsx` - Spreadsheet creation and analysis
- `/using-skills` - Meta-skill teaching how to use skills

**Note:** Office format skills are sourced from [anthropics/skills](https://github.com/anthropics/skills) via git submodule.

## Session Continuity Commands

The plugin includes commands for session state management:

- `/checkpoint` - Save session state to LEARNINGS.md
- `/learn` - Extract reusable patterns from the current session
- `/verify` - Run verification checklist (build, types, lint, tests)

These commands integrate with the PLAN.md + LEARNINGS.md system. For cross-session task persistence, set `CLAUDE_CODE_TASK_LIST_ID` in your `.envrc`:

```bash
# .envrc
export CLAUDE_CODE_TASK_LIST_ID=”my-project”
```

---

## Repository Structure

```
workflows/
├── .claude-plugin/             # Claude Code plugin manifest
│   ├── plugin.json
│   └── marketplace.json
├── agents/                     # Specialized subagents (10 agents)
│   ├── planner.md              # Implementation planning
│   ├── architect.md            # System design decisions
│   ├── tdd-guide.md            # TDD workflow enforcement
│   ├── code-reviewer.md        # Code quality review
│   ├── security-reviewer.md    # Security vulnerability analysis
│   ├── build-error-resolver.md # Fix build errors
│   ├── e2e-runner.md           # Playwright E2E testing
│   ├── refactor-cleaner.md     # Dead code cleanup
│   ├── doc-updater.md          # Documentation sync
│   └── data-explorer.md        # EDA and data profiling
├── commands/                   # Slash commands
│   ├── dev.md, ds.md, writing.md  # Workflow entry points
│   ├── learn.md                # Pattern extraction
│   ├── verify.md               # Verification checklist
│   └── checkpoint.md           # Session state save
├── contexts/                   # Example context modes (see note below)
│   ├── dev.md                  # Development mode
│   ├── data-science.md         # Data science mode
│   └── writing.md              # Writing mode
├── rules/                      # Example rules (see note below)
│   ├── security.md, coding-style.md, testing.md
│   ├── git-workflow.md, hooks.md, agents.md
│   └── performance.md, patterns.md
├── skills/                     # User-facing skills
│   ├── continuous-learning/    # Cross-project pattern extraction
│   └── [28+ skills...]
├── hooks/                      # Hook entry points
│   ├── hooks.json              # Hook configuration
│   ├── session-start.py        # SessionStart hook
│   ├── session-end.py          # Stop hook (LEARNINGS.md timestamp)
│   ├── pre-compact.py          # PreCompact hook (state preservation)
│   ├── suggest-compact.py      # PreToolUse hook (compaction suggestions)
│   ├── pr-url-logger.py        # PostToolUse hook (log PR URLs)
│   ├── lint-check.py           # PostToolUse hook (linting)
│   └── image-read-guard.py     # PreToolUse hook
├── .mcp.json                   # MCP server configurations
├── lib/
│   ├── skills/                 # Internal phase skills
│   ├── hooks/                  # Shared Python libraries
│   └── references/             # Reference documentation
├── scripts/                    # Utility scripts
├── external/
│   └── anthropic-skills/       # Git submodule for document skills
├── .opencode/                  # OpenCode integration
├── .copilot/                   # VS Code Copilot integration
└── README.md
```

**Key Points:**
- `agents/` contains specialized subagents (auto-discovered by Claude Code)
- `skills/` contains user-facing skills (auto-discovered)
- `commands/` contains slash commands (auto-discovered)
- `hooks/` contains hook entry points called directly by hooks.json
- `lib/skills/` contains internal phase skills (dev-implement, ds-verify, etc.)
- `lib/hooks/` contains shared Python libraries for hooks

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

See [everything-claude-code examples](https://github.com/anthropics/everything-claude-code/tree/main/examples) for full CLAUDE.md templates.

## Updating External Skills

The office format skills come from Anthropic’s official skills repo. To update:

```bash
git submodule update --remote external/anthropic-skills
```

## Acknowledgments

This project was heavily inspired by [obra/superpowers](https://github.com/obra/superpowers), particularly:
- The SessionStart hook pattern for injecting meta-skills
- The “using-skills” approach that teaches HOW to use skills rather than listing WHAT skills exist
- The philosophy that skills should be invoked on-demand, not dumped into every session

Office format skills (docx, pdf, pptx, xlsx) are from [anthropics/skills](https://github.com/anthropics/skills).

## License

MIT

## Author

Edwin Hu
