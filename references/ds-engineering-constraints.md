# DS Engineering Constraints

Role-specific enforcement for data engineering tasks (pipelines, ETL, transformations). Loaded by ds-engineer agent and ds-delegate for engineering-type tasks.

**Complements (not replaces):** `ds-common-constraints.md` — load both for engineering tasks.

---

## E1: Determinism

Every pipeline step must be deterministic. Non-determinism is a bug, not a feature.

| Source of Non-Determinism | Fix |
|--------------------------|-----|
| Random sampling without seed | Set explicit seed, document in PLAN.md |
| Dictionary/set ordering | Sort before output |
| Timestamp in output | Freeze timestamp or exclude from comparison |
| Floating point accumulation | Use decimal types or round to fixed precision |
| Parallel execution order | Sort output after parallel steps |

**Test:** Run the full pipeline twice on the same input. Hash both outputs. They MUST match.

**Drive-Aligned Framing:** A non-deterministic pipeline produces different results each run. The user can't tell if changes are from their code or from randomness. That's not a pipeline — it's a random number generator.

---

## E2: Schema Contracts

Every transformation has an input schema and output schema. Both must be validated.

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

**Schema changes are R4.** If the upstream data adds/removes columns, that's an architectural decision — the user decides whether to accommodate or reject.

---

## E3: Join Audits

Every merge/join must produce a diagnostic log:

```python
# Pattern: Log join diagnostics
print(f"LEFT:  {len(left):,} rows, keys: {left[key].nunique():,} unique")
print(f"RIGHT: {len(right):,} rows, keys: {right[key].nunique():,} unique")
result = left.merge(right, on=key, how=how)
print(f"RESULT: {len(result):,} rows ({len(result)/len(left):.1%} of left)")
print(f"UNMATCHED LEFT: {len(left) - len(result.dropna(subset=right.columns)):,}")
```

| Join Issue | Severity | Action |
|-----------|----------|--------|
| Many-to-many producing row explosion | R4 | STOP — user decides |
| >10% unmatched rows | R2 | Log warning, add to LEARNINGS.md |
| 0 matched rows | R1 | Bug — investigate key mismatch |
| Duplicate keys after join | R1 | Bug — deduplicate or fix join type |

---

## E4: Idempotency

Running the pipeline N times on the same input must produce the same output as running it once.

| Anti-Pattern | Fix |
|-------------|-----|
| `df.to_sql(if_exists='append')` | Use `if_exists='replace'` or deduplicate |
| Incrementing counters | Reset counters at pipeline start |
| File append mode | Write mode with overwrite |
| Global state mutation | Pure functions, no side effects |

---

## E5: Error Handling

Pipeline errors must be loud, not silent.

| Anti-Pattern | Fix |
|-------------|-----|
| `try: ... except: pass` | Never catch-and-ignore. Log and re-raise. |
| `errors='coerce'` without logging | Log coerced values count and sample |
| Silent type conversion | Explicit conversion with assertion |
| `dropna()` without logging | Log dropped row count and reason |

**Drive-Aligned Framing:** Silent error handling is not robustness — it's data loss with extra steps. Every silently dropped row is a result the user will never know they lost.
