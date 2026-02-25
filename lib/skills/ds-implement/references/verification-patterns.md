# Verification Patterns

Code patterns for output-first verification in data science workflows.

## Data Loading

```python
df = pd.read_csv(path)
print(f"Loaded: {df.shape}")
print(f"Columns: {df.columns.tolist()}")
print(f"Dtypes:\n{df.dtypes}")
df.head()
```

## Filtering

```python
before = len(df)
df = df[df['col'] > threshold]
after = len(df)
print(f"Filtered: {before} -> {after} ({100*(before-after)/before:.1f}% removed)")
```

## Merging

```python
left_size = len(df1)
right_size = len(df2)
merged = df1.merge(df2, on='key', how='left')
print(f"Merge: {left_size} x {right_size} -> {len(merged)}")
print(f"New nulls: {merged[df2.columns].isnull().sum().sum()}")
```

## Aggregation

```python
result = df.groupby('category').agg({'value': 'mean'})
print(f"Groups: {len(result)}")
print(f"Stats:\n{result.describe()}")
result.head(10)
```

## Model Training

```python
model.fit(X_train, y_train)
train_score = model.score(X_train, y_train)
val_score = model.score(X_val, y_val)
print(f"Train score: {train_score:.4f}")
print(f"Val score: {val_score:.4f}")
print(f"Gap: {train_score - val_score:.4f}")
```

## Batch Pipeline (Scale-Up Testing)

Generic patterns for any batch/ETL pipeline. For task-specific patterns, see:
- **Gemini batch:** `${CLAUDE_PLUGIN_ROOT}/skills/gemini-batch/references/scale-up-testing.md`

### Response Validation

```python
# Verify responses are non-empty and structurally correct
success, empty, parse_errors = 0, 0, 0
for r in results:
    if not r.get("response"):
        empty += 1
    else:
        try:
            parsed = parse_response(r["response"])
            success += 1 if parsed else (empty := empty + 1)
        except Exception:
            parse_errors += 1

total = len(results)
print(f"Success: {success}/{total} ({100*success/total:.0f}%)")
print(f"Empty: {empty}, Parse errors: {parse_errors}")
assert success / total >= 0.9, f"Success rate {success/total:.0%} below 90% threshold"
```

### Quality Review

- **Stage 1 (~10 items):** Read every output yourself.
- **Stage 2+ (~100+ items):** Randomly sample 10-20 outputs. Use an LLM-as-judge (a stronger model than the one that produced the outputs) to score each on a rubric. See task-specific references for concrete judge patterns.

### Cost Extrapolation

```python
per_item_sec = elapsed_seconds / len(test_items)
est_minutes = (per_item_sec * total_items) / 60
est_cost = cost_per_item * total_items
print(f"Estimated full run: {total_items} items in {est_minutes:.0f} min (${est_cost:.2f})")
```

## Quick Reference Table

| Operation | Required Output |
|-----------|-----------------|
| Load data | shape, dtypes, head() |
| Filter | shape before/after, % removed |
| Merge/Join | shape, null check, sample |
| Groupby | result shape, sample groups |
| Transform | before/after comparison, sample |
| Model fit | metrics, convergence info |
| Prediction | distribution, sample predictions |
| Batch/ETL submit | test batch success rate, random sample quality scores, cost extrapolation |
