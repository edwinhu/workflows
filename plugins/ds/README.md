# DS Plugin

Data science workflow plugin for Claude Code with output-first verification, data quality checks, and specialized data access skills.

## Overview

This plugin provides a structured workflow for data science projects, emphasizing verification, reproducibility, and data quality at every step.

## Skills

### Core Workflow Skills

| Skill | Description |
|-------|-------------|
| `ds` | Main orchestration skill for data science workflows |
| `ds-brainstorm` | Explore and refine data science questions through Socratic dialogue |
| `ds-plan` | Create detailed analysis plans with data requirements and methodology |
| `ds-implement` | Implement analysis with output-first verification and data quality checks |
| `ds-review` | Review implementations for correctness, reproducibility, and best practices |
| `ds-verify` | Verification gate ensuring fresh evidence before completion claims |

### Data Access Skills

| Skill | Description |
|-------|-------------|
| `wrds` | WRDS (Wharton Research Data Services) data access and query building |
| `gemini-batch` | Gemini Batch API for large-scale LLM processing of datasets |
| `lseg-data` | LSEG Data Library access (formerly Refinitiv) |

## Directory Structure

```
ds/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── ds/                 # Main orchestration
│   ├── ds-brainstorm/      # Design exploration
│   ├── ds-plan/            # Analysis planning
│   ├── ds-implement/       # TDD implementation
│   ├── ds-review/          # Code review
│   ├── ds-verify/          # Verification gate
│   ├── wrds/               # WRDS data access
│   │   └── modules/        # WRDS-specific modules
│   ├── gemini-batch/       # Gemini Batch API
│   └── lseg-data/          # LSEG Data Library
│       └── modules/        # LSEG-specific modules
├── hooks/
│   └── scripts/            # Hook implementation scripts
└── README.md
```

## Principles

1. **Output-first verification**: Always verify outputs exist and are correct before claiming success
2. **Data quality checks**: Validate data at ingestion and throughout the pipeline
3. **Reproducibility**: All analysis should be reproducible with clear documentation
4. **Incremental development**: Build and verify in small, testable increments
