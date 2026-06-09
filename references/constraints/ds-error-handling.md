---
name: error-handling
description: Pipeline errors must be loud, not silent — no catch-and-ignore, no silent coercion, no undocumented drops
applies-to: [ds-delegate]
---

## Rule

Pipeline errors must be loud, not silent. Every error, coercion, or data drop must be logged with counts and samples.

| Anti-Pattern | Fix |
|-------------|-----|
| `try: ... except: pass` | Never catch-and-ignore. Log and re-raise. |
| `errors='coerce'` without logging | Log coerced values count and sample |
| Silent type conversion | Explicit conversion with assertion |
| `dropna()` without logging | Log dropped row count and reason |

## Rationale

**Why this exists** — Silent error handling is not robustness — it's data loss with extra steps. Every silently dropped row is a result the user will never know they lost. Every silently coerced value is a lie in the output.

## Examples

### Correct
```python
# Loud error handling
n_before = len(df)
df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
n_coerced = df["amount"].isna().sum() - original_nulls
print(f"Coerced {n_coerced} non-numeric values to NaN")
if n_coerced > 0:
    print(f"Sample coerced values: {df[df['amount'].isna()].head()}")
```

### Incorrect
```python
# Silent error handling — data loss hidden
try:
    df["amount"] = df["amount"].astype(float)
except:
    pass  # Silently ignores conversion failures

df = df.dropna()  # How many rows? Which columns? Nobody knows.
```
