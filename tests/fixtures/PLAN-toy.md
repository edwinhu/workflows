# PLAN: toy analysis (compile/runner fixture)

Implementation Language: python

## Task Breakdown

| Task | Deps | Outputs | Expected Output | Verify | Implements |
|------|------|---------|-----------------|--------|------------|
| **A1** [engineer] — build the base parquet | — | `data/base.parquet` | non-empty | `python -c "assert 1"` | DATA-01 |
| **A2** — left branch loader | A1 | `src/io.py` | importable loader | `python -c "assert 1"` | PERF-01 |
| **A3** — right branch panel ⏸ PAUSE: confirm the panel definition before downstream | A1 | `data/panel.csv` | 3 cols | `python -c "assert 1"` | STAT-01 |
| **A4** — join branches | A2, A3 | `data/final.parquet` | merged | `python -c "assert 1"` | OUT-01 |
