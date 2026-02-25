# Scale-Up Testing for Gemini Batch Pipelines

Gemini-specific patterns for the incremental scale-up testing protocol defined in `ds-implement`.

## Stage 0 — Local Prototyping with LangExtract

Before submitting anything to the batch API, validate your prompt and schema locally using [LangExtract](https://github.com/google/langextract).

**Why:** Your prompt/schema is identical from prototype through production. No mismatch between "what I tested interactively" and "what I submitted to batch" — which is how you end up with 21K empty responses from a schema that uses `["type", "null"]` instead of `"nullable": true`.

```python
from langextract import Extractor

# Prototype on 2-3 representative documents
extractor = Extractor(
    instructions="Extract ...",
    examples=[...],  # few-shot examples defining expected output schema
    language_model="gemini-2.5-flash",
)

# Run locally — no batch API, no GCS, instant feedback
result = extractor.extract(document_text)

# Inspect with interactive HTML visualization
# Shows every extraction grounded to its source location
result.to_html("prototype_review.html")
```

**Gate:** Open the HTML, verify extractions are grounded correctly in source text. Iterate on prompt/schema until satisfied.

## Stage 1 — Test Batch (~10 items)

Same LangExtract config, still local, but on 10 representative documents:

```python
# Run on 10 docs — still local, no batch API
test_docs = documents[:10]
results = [extractor.extract(doc) for doc in test_docs]

# Validate every result
for i, r in enumerate(results):
    print(f"Doc {i+1}: {len(r.entities)} entities extracted")
    r.to_html(f"review_{i}.html")

# Check: any empty extractions? Any missing expected fields?
empty = sum(1 for r in results if len(r.entities) == 0)
print(f"Empty: {empty}/{len(results)}")
assert empty / len(results) <= 0.1, "Too many empty extractions — fix prompt"
```

**Gate:** Read every output. Success rate ≥ 90%. Extractions make sense.

## Stage 2 — Intermediate Batch (~100 items) via Vertex AI Batch

Now switch to the batch API — same prompt/schema, different execution mode:

```python
# Same extractor, now with Vertex AI batch enabled
extractor = Extractor(
    instructions="Extract ...",  # identical to Stage 0/1
    examples=[...],
    language_model="gemini-2.5-flash",
    language_model_params={
        "vertexai": True,
        "batch": {"enabled": True},
    },
)

results = extractor.extract_batch(documents[:100])
```

### LLM-as-Judge Quality Review

Randomly sample 10 outputs and send to a stronger model for scoring:

```python
import random
from google import genai

client = genai.Client()
JUDGE_MODEL = "gemini-3-pro"

RUBRIC = """Score this extraction output on a 0-1 scale:
- 1.0 = correct, complete, all entities grounded in source
- 0.5 = partially correct or missing entities
- 0.0 = wrong, empty, or hallucinated entities

Task: {task_description}
Expected schema: {expected_format}

Source document (excerpt): {input_text}
Extraction output: {output_text}

Respond with ONLY a JSON object: {{"score": <float>, "reason": "<one sentence>"}}"""

sample = random.sample(results, min(10, len(results)))
scores = []
for i, r in enumerate(sample):
    prompt = RUBRIC.format(
        task_description="...",
        expected_format="...",
        input_text=r.source_text[:2000],
        output_text=str(r.entities)[:2000],
    )
    response = client.models.generate_content(model=JUDGE_MODEL, contents=prompt)
    judgment = json.loads(response.text)
    scores.append(judgment["score"])
    print(f"Sample {i+1}: {judgment['score']} — {judgment['reason']}")

avg_quality = sum(scores) / len(scores)
print(f"\nJudge quality: {avg_quality:.0%} avg across {len(sample)} samples")
assert avg_quality >= 0.8, f"Judge quality {avg_quality:.0%} below 80% threshold"
```

### Cost Extrapolation

```python
# Estimate full run from Stage 2 metrics
per_item_cost = stage2_cost / len(stage2_items)
per_item_sec = stage2_duration_sec / len(stage2_items)
total_items = len(documents)
print(f"Estimated full run: {total_items} items")
print(f"  Time: {(per_item_sec * total_items) / 3600:.1f} hours")
print(f"  Cost: ${per_item_cost * total_items:.2f}")
```

**Gate:** Success rate ≥ 95%. Judge quality ≥ 80%. Cost/time acceptable. No systematic failures.

## Stage 3 — Large Test Batch (~1,000 items)

Same config as Stage 2. Focus on scale-specific issues:

```python
results = extractor.extract_batch(documents[:1000])

# Check for rate limiting
# Check judge quality is consistent with Stage 2
# Confirm cost tracking matches extrapolation
```

**Gate:** Success rate ≥ 95%. Judge quality consistent with Stage 2. No rate limit issues. Cost confirmed.

## Full Batch — Submit with Confidence

```python
# Same extractor config validated through Stages 0-3
results = extractor.extract_batch(documents)
```

## Key Principle

The prompt, schema, and extraction logic are **identical** across all stages. Only the execution mode changes:

| Stage | Execution | Items | Quality Check |
|-------|-----------|-------|---------------|
| 0 (prototype) | Local, interactive | 2-3 | HTML visualization, manual review |
| 1 (test) | Local, programmatic | ~10 | Read every output |
| 2 (intermediate) | Vertex AI batch | ~100 | LLM-as-judge on random sample |
| 3 (large test) | Vertex AI batch | ~1,000 | LLM-as-judge, compare to Stage 2 |
| Full | Vertex AI batch | All | Confidence from prior stages |
