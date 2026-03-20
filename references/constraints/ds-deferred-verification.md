---
name: deferred-verification
description: Planning to verify "later" which means never — verify after EVERY step
applies-to: [ds, ds-fix, ds-plan, ds-implement, ds-review, ds-verify, ds-delegate]
---

## Rule

Verify after EVERY step. Never defer verification to "later" — later means never. Errors compound silently, and by the end the root cause is buried under layers of transformations.

## Rationale

**Why this exists** — Deferred verification is the second most common failure in DS workflows. Agents combine steps "for efficiency," then can't diagnose which step failed. A 30-second check after each step prevents hours of debugging later.

## Examples

### Correct
```python
# Verify after each step
df = pd.read_csv("data.csv")
print(f"Loaded: {df.shape}")

df = df.dropna(subset=["key_col"])
print(f"After dropna: {df.shape}")  # Verify rows dropped as expected

df = df.merge(other, on="key_col")
print(f"After merge: {df.shape}")   # Verify merge didn't explode/collapse
```

### Incorrect
```python
# Combining steps without intermediate verification
df = pd.read_csv("data.csv").dropna().merge(other, on="key").groupby("cat").mean()
# If result is wrong, which step caused it?
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'll check at the end" | Errors compound silently. By the end, the root cause is buried under 10 transformations. | Verify after EVERY step |
| "I'll fix it and check later" | Later never comes. Your unverified fix is a guess. | Fix AND verify in the same step |
| "I just ran it" | Your prior run is not a current verification. Code, data, or environment may have changed. | Run it again NOW |
| "I'll combine these steps to save time" | Combined steps hide which one failed. Your efficiency creates undiagnosable bugs. | One operation per verification cycle |

## Red Flags

- **"I'll check at the end"** → STOP. Verify now, not later.
- **"I'll fix it and check later"** → STOP. Fix AND verify in the same step.
- **"I just ran it"** → STOP. Your prior run is not current verification.
- **"I'll combine these steps to save time"** → STOP. Combined steps hide failures.

## Drive-Aligned Framing

Deferred verification is not efficiency — it's debt. The user pays for your deferred check with hours of debugging when the silent error surfaces downstream.
