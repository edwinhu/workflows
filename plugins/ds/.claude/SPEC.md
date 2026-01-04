# Spec: /ds Plugin (Data Science Workflow)

## Problem

AI claims "done" on data science tasks without verifying outputs. Unlike software dev where unit tests prove correctness, DS work requires verifying data quality, output shapes, and reproducibility at each step.

## Requirements

1. **Output-first verification**: After each code step, output must be displayed and verified before proceeding
2. **Mirror /dev structure**: Familiar workflow (brainstorm → plan → implement → review → verify)
3. **Multi-language support**: Works with Python, R, Stata, SAS (tool-agnostic)
4. **Data quality checks**: Comprehensive verification including:
   - Nulls/missing values (patterns, counts, impact)
   - Duplicates (exact and fuzzy matching)
   - Schema validation (expected columns, types)
   - Distribution anomalies (outliers, unexpected values)
   - Type consistency (mixed types in columns)
5. **Reproducibility enforcement**: Seeds, environment tracking, data versioning awareness
6. **Works with modern notebooks**: jupytext, marimo (.py-based), not just .ipynb

## Success Criteria

- [ ] AI cannot claim "step complete" without showing output
- [ ] Data quality issues (unexpected nulls, wrong shape) are caught
- [ ] Reproducibility concerns are flagged (missing seeds, unversioned data)
- [ ] Works across Python/R/Stata/SAS without language-specific assumptions

## Chosen Approach: Output-First Verification

After each code cell/step:
1. Code MUST produce visible output (print, display, summary)
2. AI MUST examine output for quality issues
3. AI MUST explicitly state what was verified before proceeding
4. If no output shown, hook blocks with "show your work"

### Key Difference from /dev TDD

| /dev (TDD) | /ds (Output-First) |
|------------|-------------------|
| Write failing test first | Write code that produces output |
| See RED, then implement | See output, verify quality |
| Test proves correctness | Output inspection proves quality |
| "Tests pass" = done | "Output verified" = done |

### Skills Structure

| Skill | Purpose | Outputs |
|-------|---------|---------|
| `/ds` | Main orchestrator | Workflow coordination |
| `/ds-brainstorm` | Clarify analysis goals | `.claude/SPEC.md` |
| `/ds-plan` | Explore data, plan steps (includes basic exploration: shape, dtypes, head, describe, data profiling) | `.claude/PLAN.md` |
| `/ds-implement` | Code with output verification | Analysis code + outputs |
| `/ds-review` | Review analysis quality | Issues or approval |
| `/ds-verify` | Final verification (interview about constraints, e.g. replicating existing analysis; reproducibility checks) | Reproducibility + quality check |

### Hooks

1. **output-verifier**: Blocks "done" claims without visible output
2. **data-quality-checker**: Warns on common issues (df without .head(), no null checks)
3. **reproducibility-checker**: Warns on missing seeds, untracked data sources
4. **duplicate-checker**: Warns on df without .drop_duplicates() or duplicate checks

## Data Access Skills

Skills for accessing external data sources:

| Skill | Purpose | Backend |
|-------|---------|---------|
| `/wrds` | PostgreSQL access to WRDS (Wharton Research Data Services) | PostgreSQL |
| `/gemini-batch` | Batch document processing | Gemini API |
| `/lseg-data` | Financial market data (LSEG Data Library) | LSEG API |

## Modular Documentation Pattern

Skills should follow lseg-data's modular documentation structure:

```
skill-name/
├── SKILL.md           # Main entry point
├── TROUBLESHOOTING.md # Common issues and solutions
└── modules/           # Specialized topics
    ├── topic-a.md
    └── topic-b.md
```

This pattern allows:
- Quick reference via main SKILL.md
- Deep-dives into specific modules
- Separation of troubleshooting from core docs

## Rejected Alternatives

- **Assertion-driven**: Too restrictive for exploratory work, not all languages have pandera
- **Checkpoint-based**: Too rigid, doesn't match iterative exploration flow
- **DS-specific phases (explore/clean/model)**: Less familiar than mirroring /dev

## Open Questions

- How to handle large outputs (truncation, sampling)?
- Language-specific output patterns (Python print vs R print vs Stata display)?
