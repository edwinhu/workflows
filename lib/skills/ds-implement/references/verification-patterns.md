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

### LLM-as-Judge Quality Review

Use a stronger model to evaluate output quality on a random sample.
Stage 1 (10 items): read every output yourself — no judge needed.
Stage 2+ (100+ items): send random sample to judge model with scoring rubric.

```python
import random
from google import genai

# Configure judge model — use a stronger model than the one that produced the outputs
client = genai.Client()
JUDGE_MODEL = "gemini-3-pro"

RUBRIC = """Score this LLM output on a 0-1 scale:
- 1.0 = correct, complete, well-structured
- 0.5 = partially correct or incomplete
- 0.0 = wrong, empty, or hallucinated

Task description: {task_description}
Expected output format: {expected_format}

Input: {input_text}
Output to evaluate: {output_text}

Respond with ONLY a JSON object: {{"score": <float>, "reason": "<one sentence>"}}"""

n_sample = min(10, len(test_results))
sample = random.sample(test_results, n_sample)
scores = []
for i, r in enumerate(sample):
    prompt = RUBRIC.format(
        task_description="...",  # describe what the batch operation does
        expected_format="...",   # describe expected output structure
        input_text=str(r["request_id"]),
        output_text=json.dumps(r["parsed"], indent=2)[:2000],
    )
    response = client.models.generate_content(model=JUDGE_MODEL, contents=prompt)
    judgment = json.loads(response.text)
    scores.append(judgment["score"])
    print(f"Sample {i+1}/{n_sample}: {judgment['score']} — {judgment['reason']}")

avg_quality = sum(scores) / len(scores)
print(f"\nJudge quality: {avg_quality:.0%} avg across {n_sample} samples")
print(f"Scores: {scores}")
assert avg_quality >= 0.8, f"Judge quality {avg_quality:.0%} below 80% threshold"
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
| Batch/ETL submit | test batch success rate, random sample quality scores, cost extrapolation |
