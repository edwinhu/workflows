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

### Test Batch Submission

```python
# Submit small test batch
test_items = items[:10]
test_results = submit_batch(test_items)
print(f"Test batch: {len(test_items)} submitted, {len(test_results)} returned")
```

### Response Validation

```python
# Verify responses are non-empty and structurally correct
success = 0
empty = 0
parse_errors = 0
for r in test_results:
    if not r.get("response"):
        empty += 1
    else:
        try:
            parsed = parse_response(r["response"])
            if parsed and len(parsed) > 0:
                success += 1
            else:
                empty += 1
        except Exception as e:
            parse_errors += 1

total = len(test_results)
print(f"Success: {success}/{total} ({100*success/total:.0f}%)")
print(f"Empty: {empty}/{total}")
print(f"Parse errors: {parse_errors}/{total}")
assert success / total >= 0.9, f"Success rate {success/total:.0%} below 90% threshold"
```

### Spot-Check

```python
# Inspect individual outputs for quality
import random
sample = random.sample(test_results, min(3, len(test_results)))
for i, r in enumerate(sample):
    print(f"\n--- Sample {i+1} ---")
    print(f"Input: {r['request_id']}")
    print(f"Output: {json.dumps(r['parsed'], indent=2)[:500]}")
```

### Cost Extrapolation

```python
# Estimate full batch cost/time from test batch
test_duration_sec = (end_time - start_time).total_seconds()
per_item_sec = test_duration_sec / len(test_items)
total_items = len(items)
est_duration_min = (per_item_sec * total_items) / 60
est_cost = cost_per_item * total_items
print(f"Test: {len(test_items)} items in {test_duration_sec:.0f}s")
print(f"Estimated full run: {total_items} items in {est_duration_min:.0f} min (${est_cost:.2f})")
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
| Batch/ETL submit | test batch success rate, spot-check outputs, cost extrapolation |
