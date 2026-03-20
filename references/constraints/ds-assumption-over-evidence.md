---
name: assumption-over-evidence
description: Treating assumptions as evidence — profile/verify fresh every time
applies-to: [ds, ds-fix, ds-plan, ds-implement, ds-review, ds-verify, ds-delegate]
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

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I already know what this data looks like" | Your knowledge is stale or wrong. Data changes, schemas drift, nulls appear. | Profile/verify fresh every time |
| "Results look roughly right" | "Roughly" means you didn't check. Roughly right is precisely wrong. | Compare against specific expected values from SPEC.md or PLAN.md |
| "I can see the issue from the output" | You see a symptom, not a cause. Pattern-matching from output is not diagnosis. | Trace backwards to the first divergence point |
| "It should reproduce / be the same" | "Should" is not evidence. Run it and compare. | Execute fresh, hash outputs, compare |
| "I trust the analyst / prior step" | Trust is not verification. Claims require evidence. | Run independent checks yourself |

## Red Flags

- **"I already know what this data looks like"** → STOP. Your knowledge is stale. Profile it fresh.
- **"Results look roughly right"** → STOP. Compare against specific expected values.
- **"It should be the same"** → STOP. Run it and compare.
- **"I trust the prior step"** → STOP. Trust is not verification.

## Drive-Aligned Framing

Every time you substitute assumption for evidence, you choose YOUR confidence over the USER's correctness. The user doesn't experience your certainty — they experience your errors.
