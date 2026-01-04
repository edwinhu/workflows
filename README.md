# Claude Code Workflows

A curated collection of development, data science, and writing plugins for Claude Code.

## Installation

To add this marketplace to your Claude Code installation:

```bash
/plugin marketplace add edwinhu/workflows
```

Then install individual plugins:

```bash
/plugin install dev
/plugin install ds
/plugin install writing
```

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

**Hooks:**
- Main chat sandbox enforcement
- Grep test detector (prevents grepping source as tests)
- Ralph Wiggum validation

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

### writing (v0.1.0)

**Writing workflow with Elements of Style and AI anti-pattern detection**

A writing plugin providing style guidance and automatic detection of AI writing patterns.

**Skills:**
- `/writing` - General writing guidance using Strunk & White's Elements of Style
- `/ai-anti-patterns` - Detect and revise AI writing indicators (12 pattern categories)

**Hooks:**
- PostToolUse hook on Write/Edit that warns on AI anti-patterns

**Tags:** `writing`, `editing`, `style`, `ai-detection`

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

## Repository Structure

```
workflows/
├── external/
│   └── anthropic-skills/       # git submodule → github.com/anthropics/skills
├── plugins/
│   ├── dev/                    # Development plugin
│   │   ├── .claude-plugin/
│   │   ├── commands/
│   │   ├── hooks/
│   │   └── skills/
│   ├── ds/                     # Data science plugin
│   │   ├── .claude-plugin/
│   │   ├── commands/
│   │   ├── hooks/
│   │   └── skills/
│   ├── writing/                # Writing plugin
│   │   ├── .claude-plugin/
│   │   ├── hooks/
│   │   └── skills/
│   └── shared/                 # Shared skills
│       ├── hooks/
│       └── skills/
│           ├── docx → external/anthropic-skills/skills/docx
│           ├── pdf  → external/anthropic-skills/skills/pdf
│           ├── pptx → external/anthropic-skills/skills/pptx
│           └── xlsx → external/anthropic-skills/skills/xlsx
└── README.md
```

## Updating External Skills

The office format skills come from Anthropic's official skills repo. To update:

```bash
git submodule update --remote external/anthropic-skills
```

## Acknowledgments

This project was heavily inspired by [anthropics/superpowers](https://github.com/anthropics/superpowers), particularly:
- The SessionStart hook pattern for injecting meta-skills
- The "using-skills" approach that teaches HOW to use skills rather than listing WHAT skills exist
- The philosophy that skills should be invoked on-demand, not dumped into every session

## License

MIT

## Author

Edwin Hu
