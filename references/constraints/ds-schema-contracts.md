---
name: schema-contracts
description: Every transformation has input/output schema contracts — schema changes are R4
applies-to: [ds-delegate]
---

## Rule

Every transformation has an input schema and output schema. Both must be validated. Schema changes are R4 (architectural decision — user decides).

```python
# Pattern: Assert schema at every boundary
def transform(df: pd.DataFrame) -> pd.DataFrame:
    # Input contract
    assert set(EXPECTED_INPUT_COLS).issubset(df.columns), f"Missing: {set(EXPECTED_INPUT_COLS) - set(df.columns)}"
    assert len(df) > 0, "Empty input"

    # ... transformation ...

    # Output contract
    assert set(EXPECTED_OUTPUT_COLS).issubset(result.columns), f"Missing: {set(EXPECTED_OUTPUT_COLS) - set(result.columns)}"
    assert len(result) > 0, "Empty output"
    return result
```

## Rationale

**Why this exists** — Without schema contracts, upstream data changes propagate silently through the pipeline. A column rename breaks downstream joins, but the error surfaces 5 steps later as wrong results instead of at the schema boundary.

## Examples

### Correct
```python
EXPECTED_COLS = {"firm_id", "date", "returns", "market_cap"}
assert EXPECTED_COLS.issubset(df.columns), f"Missing: {EXPECTED_COLS - set(df.columns)}"
```

### Incorrect
```python
df = pd.read_csv("data.csv")
# No schema validation — proceeds even if columns changed
result = df["returns"] / df["market_cap"]  # KeyError 5 steps later
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The schema won't change" | It will. Data sources evolve. | Assert schema at every boundary. |
| "Schema checks slow things down" | Schema violations crash the pipeline anyway — just later and harder to debug. | Fail fast at the boundary. |
| "I'll add schema checks later" | Later never comes. The pipeline runs unvalidated. | Add schema contracts when writing the transform. |

## Red Flags

- **No column assertions at data load** → STOP. Add schema contract.
- **Schema changed upstream** → STOP. This is R4. User decides how to adapt.
- **`KeyError` in transformation** → STOP. Missing schema contract at input.
