---
name: assumption-over-evidence
description: Treating assumptions as evidence — profile/verify fresh every time
applies-to: [ds, ds-fix, ds-implement, ds-delegate]
---

## Rule

Never treat your assumptions as evidence. Every data claim requires fresh verification — profiling, comparing against expected values, or independent checks.

## Rationale

**Why this exists** — The most common failure across ALL ds phases: agents pattern-match from prior knowledge instead of checking current data. Data changes, schemas drift, nulls appear. "I already know what this data looks like" is the start of every silent data bug.

## Examples

### Correct
```python
# Fresh verification before proceeding
print(f"Shape: {df.shape}")
print(f"Nulls: {df.isnull().sum()}")
print(f"Dtypes: {df.dtypes}")
assert df.shape[0] > 0, "Empty dataframe"
```

### Incorrect
```python
# Assuming data looks the same as last time
df = pd.read_csv("data.csv")  # No shape/null check
result = df.groupby("category").mean()  # Assumes categories haven't changed
```
