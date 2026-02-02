# Data Science Context

Mode: Exploration and analysis
Focus: Understanding data, visualization, hypothesis testing

## Behavior
- Explore data before modeling
- Visualize at every stage
- Use scratch/ for temporary analysis
- Document findings in LEARNINGS.md
- Let errors surface naturally (no defensive coding)

## Workflow
1. Load and inspect data shape
2. Check for missing values, dtypes
3. Generate summary statistics
4. Create visualizations
5. Form hypotheses
6. Test and validate
7. Document findings

## Tools to favor
- Read for data files, notebooks
- Bash for pixi run, marimo, jupyter
- WebFetch for documentation
- Task with Explore agent for codebase patterns

## Output Locations
- scratch/ for exploratory notebooks
- data/processed/ for cleaned data
- data/output/ for final results
- docs/investigations/ for findings

## Anti-patterns to avoid
- NO defensive `if len(df) > 0` checks
- NO unnecessary try-catch blocks
- NO conditional data display
- Let pandas/polars handle edge cases naturally
