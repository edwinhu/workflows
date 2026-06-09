---
name: determinism
description: Every pipeline step must be deterministic — non-determinism is a bug, not a feature
applies-to: [ds-delegate]
---

## Rule

Every pipeline step must be deterministic. Non-determinism is a bug, not a feature. Run the full pipeline twice on the same input. Hash both outputs. They MUST match.

| Source of Non-Determinism | Fix |
|--------------------------|-----|
| Random sampling without seed | Set explicit seed, document in PLAN.md |
| Dictionary/set ordering | Sort before output |
| Timestamp in output | Freeze timestamp or exclude from comparison |
| Floating point accumulation | Use decimal types or round to fixed precision |
| Parallel execution order | Sort output after parallel steps |

## Rationale

**Why this exists** — A non-deterministic pipeline produces different results each run. The user can't tell if changes are from their code or from randomness. That's not a pipeline — it's a random number generator.

## Examples

### Correct
```python
import numpy as np
np.random.seed(42)  # Explicit seed, documented
sample = df.sample(n=1000, random_state=42)
result = sample.sort_values("id")  # Deterministic output order
```

### Incorrect
```python
sample = df.sample(n=1000)  # No seed — different results each run
result = dict_output  # Dict ordering not guaranteed in older Python
```
