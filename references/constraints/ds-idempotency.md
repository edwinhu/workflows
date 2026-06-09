---
name: idempotency
description: Running pipeline N times on same input must equal running it once — no append, no increment, no accumulate
applies-to: [ds-delegate]
---

## Rule

Running the pipeline N times on the same input must produce the same output as running it once. Non-idempotent operations create invisible state bugs.

| Anti-Pattern | Fix |
|-------------|-----|
| `df.to_sql(if_exists='append')` | Use `if_exists='replace'` or deduplicate |
| Incrementing counters | Reset counters at pipeline start |
| File append mode | Write mode with overwrite |
| Global state mutation | Pure functions, no side effects |

## Rationale

**Why this exists** — Non-idempotent pipelines accumulate state across runs. Re-running to "fix" an issue doubles the data. The user can't tell if the output is from one run or five.

## Examples

### Correct
```python
# Idempotent: safe to re-run
df.to_sql("results", engine, if_exists="replace")  # Overwrites, not appends
```

### Incorrect
```python
# Non-idempotent: each run adds more rows
df.to_sql("results", engine, if_exists="append")  # Re-run = double data
```
