# Scale-up testing

## Same-model, same-tier checks

1. Read existing project request builders and outputs before writing another pipeline. Choose Batch for independent document extraction; Flex for per-entity web lookups. Do not substitute a different model or format in the test.
2. Pre-cut relevant sections for text extraction; retain relevant PDF pages for layout/scans. Protect target evidence from character caps and truncation.
3. Make **one synchronous same-model smoke request**, inspect schema, source evidence, finish reason and token usage. This is a paid API request, not a free/local prototype.
4. Run **5–10 rows through the actual production tier/backend**, including long/short and difficult inputs. For Batch, inspect each row after downloading; for Flex, inspect search steps, annotations, returned tier and errors. Reconcile keys end to end.
5. Run an intermediate sample (~100 rows) only after the end-to-end sample passes. Measure failure/truncation/ungrounded rates and review outputs against independent ground truth. Reserve model-family comparisons for a fixed held-out sample; never show the scored system's answers to the gold coder.
6. Scale when acceptance criteria pass; keep failures visible and retry only the relevant rows. A succeeded job or syntactically valid JSON is not correctness evidence.

## Costs and concurrency

Compute input/output/thinking/cached tokens from actual usage; use current [model/tier prices](models-and-pricing.md), and budget search separately. Input-dominated work may not save much by changing only output prices. Keep one Client and bound I/O concurrency by project quotas; Flex uses general limits, not Batch enqueued-token limits.

Persist each completed row before another future can fail. The Flex smoke test recovered only eight responses from ten inputs after a 400 aborted the process, losing full citations and input/output splits; a 138-row pilot and scaled cost estimate were therefore not available.

## Changes require retesting

A new model, thinking level, schema, tool, backend, endpoint, tier or prompt is a new end-to-end test, not a cosmetic change. Schema/retry examples must be checked against current Google docs. Do not assume a third-party extraction wrapper has a Batch mode or executes locally without model calls.

### Gate Design: a verbatim-quote gate rewards under-extraction

Gating a batch job on "do the model's quoted snippets appear verbatim in the source" is a good anti-fabrication check, but it is **structurally biased**: a model that finds nothing stakes no verbatim claims and passes trivially. Optimizing on it alone selects for the quietest model, not the most accurate one.

- Pair it with a **recall measure** — ideally against human-coded ground truth, otherwise against a known-positive subset.
- **Report the number of testable rows next to the rate.** "97.9% verified" over 48 rows is a weaker claim than "94.3%" over 70 (2026-08-03, `realpage`: those were Pro and Flash on the same 100 documents).

The same asymmetry applies to any precision-only gate. Every gate should have a counterweight that a null output fails.

### Cost Extrapolation

Before comparing model tiers on price, work out whether the job is **input- or output-dominated** — the answer decides whether a tier switch saves anything:

```python
# From the Stage 2 sample, per document
input_side  = mean_input_tokens  * input_price_per_token
output_side = mean_output_tokens * output_price_per_token
print(f"input ${input_side:.5f} vs output ${output_side:.5f}")
```

If input dominates (e.g. ~16,700 in / ~350 out), a Pro → Flash switch moves almost nothing — Flash's big discount is on output. Only Flash-Lite cuts the input price materially. See [models and prices](models-and-pricing.md) for the measured numbers.

For a larger (~1,000-row) test, confirm quality, failure rates and measured cost remain consistent with the intermediate sample before full submission. Define acceptance thresholds for the task in advance; a model judge is advisory, not ground truth. An optional judge rubric is: correct/complete/source-grounded=1.0, partial or missing=0.5, wrong/empty/hallucinated=0.0. Score against complete relevant evidence, not arbitrary 2,000-character truncations.
