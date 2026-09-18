---
name: ds-failure-loudness
applies-to: [ds-delegate]
---

**What a script already decides:** `constraints/ds-error-handling.py` decides the syntactic cases — a bare `except`, a swallowed error. Whether a handled error is reported loudly enough to act on is this rule.

## Rule

Pipeline errors must be loud, not silent. Every error, coercion, or data drop must be logged with counts and samples.

| Anti-Pattern | Fix |
|-------------|-----|
| `try: ... except: pass` | Never catch-and-ignore. Log and re-raise. |
| `errors='coerce'` without logging | Log coerced values count and sample |
| Silent type conversion | Explicit conversion with assertion |
| `dropna()` without logging | Log dropped row count and reason |

The `coerce` and `dropna` checkers accept a log only if it states a quantity (`len()`, `.shape`, `dropped`/`coerced`/`rows`) AND names a variable from the operation's statement or one derived from it in the window — a neighbouring `print()` is proximity, not a diagnostic.

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
