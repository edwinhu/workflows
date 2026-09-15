---
name: join-audits
description: Every merge/join must produce diagnostic log — row counts, match rates, key uniqueness
applies-to: [ds-delegate]
---

## Rule

Every merge/join must produce a diagnostic log showing row counts, match rates, and key uniqueness.

```python
# Pattern: Log join diagnostics
print(f"LEFT:  {len(left):,} rows, keys: {left[key].nunique():,} unique")
print(f"RIGHT: {len(right):,} rows, keys: {right[key].nunique():,} unique")
result = left.merge(right, on=key, how=how)
print(f"RESULT: {len(result):,} rows ({len(result)/len(left):.1%} of left)")
print(f"UNMATCHED LEFT: {len(left) - len(result.dropna(subset=right.columns)):,}")
# KEYED dup check — result.duplicated() across all columns reports ZERO on
# fan-out (fanned rows differ in the joined columns); only subset=key reveals it
print(f"POST-JOIN KEY DUPES: {result.duplicated(subset=key).sum():,}")
```

| Join Issue | Severity | Action |
|-----------|----------|--------|
| Many-to-many producing row explosion | R4 | STOP — user decides |
| >10% unmatched rows | R2 | Log warning in the implementation report; return it for project auto-memory curation |
| 0 matched rows | R1 | Bug — investigate key mismatch |
| Duplicate keys after join | R1 | Bug — deduplicate or fix join type |

## Rationale

**Why this exists** — Joins are the #1 source of silent data errors. A many-to-many join can silently multiply your dataset 10x. A key mismatch can silently drop 90% of rows. Without diagnostics, these errors are invisible.

## Examples

### Correct
```python
print(f"LEFT: {len(prices):,} rows, keys: {prices['ticker'].nunique():,}")
print(f"RIGHT: {len(fundamentals):,} rows, keys: {fundamentals['ticker'].nunique():,}")
merged = prices.merge(fundamentals, on='ticker', how='left')
print(f"RESULT: {len(merged):,} rows ({len(merged)/len(prices):.1%} of left)")
# RESULT: 50,000 rows (100.0% of left) — no row explosion ✓
```

### Incorrect
```python
merged = prices.merge(fundamentals, on='ticker')
# No diagnostics — was this 1:1? 1:many? many:many?
# Did we lose rows? Gain rows? No idea.
```

## Facts

- `result.duplicated()` across all columns reports ZERO on join fan-out — fanned rows differ in the joined columns, so only `duplicated(subset=key)` reveals it. Reporting "no duplicates" from the all-columns check is a false clean signal, not a verification.
- "The merge worked fine" without printed numbers is an unverified claim — show the counts. Pre-join key checks don't substitute: the fan-out happens at the join, so post-join diagnostics catch what pre-checks miss.
- A row count that increased after a join is a many-to-many signature until proven otherwise.
