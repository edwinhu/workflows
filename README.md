# Claude Code Plugins Marketplace

A curated collection of development and data science plugins for Claude Code.

## Installation

To add this marketplace to your Claude Code installation:

```bash
/plugin marketplace add edwinhu/claude-plugins
```

Then install individual plugins:

```bash
/plugin install dev
/plugin install ds
```

## Available Plugins

### dev (v0.3.0)

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
- Test detector for TDD validation
- Ralph Wiggum validation

**Tags:** `development`, `tdd`, `testing`, `code-review`

---

### ds (v0.3.0)

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

## Usage Examples

### Development Workflow

```
# Start a new feature with full TDD workflow
/dev add user authentication

# Just brainstorm a design
/dev-brainstorm how should we structure the auth module?

# Debug an issue systematically
/dev-debug tests are failing in the auth module
```

### Data Science Workflow

```
# Run a full analysis workflow
/ds analyze quarterly earnings surprises

# Access WRDS data
/wrds query Compustat for tech sector fundamentals

# Work with reactive notebooks
/marimo create analysis notebook
```

## Repository Structure

```
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json    # Marketplace configuration
├── plugins/
│   ├── dev/                # Development plugin
│   │   ├── .claude-plugin/
│   │   ├── commands/
│   │   ├── hooks/
│   │   └── skills/
│   └── ds/                 # Data science plugin
│       ├── .claude-plugin/
│       ├── commands/
│       ├── hooks/
│       └── skills/
└── README.md
```

## License

MIT

## Author

Edwin Hu
