# Scale-Up Testing Protocol (Batch/ETL Operations)

**Triggers when PLAN.md includes a Scale-Up Testing Plan table** (created by ds-plan when tasks involve batch APIs, irreversible operations, or >500 items through external services).

<EXTREMELY-IMPORTANT>
### The Iron Law of Scale-Up Testing

**NO FULL BATCH WITHOUT A SUCCESSFUL TEST BATCH. This is not negotiable.**

This is TDD for ETL: fail at 10 items in minutes, not at 21,000 items in hours. Before submitting production workloads, you MUST validate at small scale and verify outputs are correct — not just "successful."
</EXTREMELY-IMPORTANT>

### The Protocol

For each task with a scale-up plan in PLAN.md:

**Stage 1 — Test Batch (~10 items). ALWAYS required.**
1. Submit a batch of ~10 representative items
2. Wait for completion
3. Parse ALL responses — verify non-empty, correct schema, expected structure
4. **Quality review: read EVERY output yourself** (it's only 10 — no sampling needed, no judge needed)
5. **Gate:** Success rate >= 90% AND outputs parse correctly AND quality review passes

**Stage 2 — Intermediate Batch (~100 items). Required if total > 500.**
1. Submit ~100 items (include edge cases: large files, unusual formats, boundary conditions)
2. Check error rate distribution — are failures random or systematic?
3. **LLM-as-judge quality review:** randomly sample 10 outputs, send each to a stronger model (e.g., Gemini 3 Pro) with scoring rubric. Score: 1 = correct & complete, 0.5 = partially correct, 0 = wrong/empty. Log all scores.
4. Extrapolate cost and time for full batch
5. **Gate:** Success rate >= 95% AND judge avg quality >= 80% AND cost/time extrapolation acceptable AND no systematic failures

**Stage 3 — Large Test Batch (~1,000 items). Required if total > 5,000.**
1. Submit ~1,000 items
2. Verify rate limits are not hit
3. **LLM-as-judge quality review:** randomly sample 20 outputs, judge with same rubric as Stage 2. Compare quality distribution to Stage 2 — any degradation at scale?
4. Confirm cost tracking matches extrapolation
5. **Gate:** Success rate >= 95% AND judge quality consistent with Stage 2 AND no rate limit issues AND cost confirmed

**Full Batch — Submit with confidence.**
- Only after all required stages pass their gates
- Document final batch parameters in LEARNINGS.md

### Scale-Up Facts

- Interactive testing is not batch testing: schema, format, and parameters differ, and batch-specific bugs only appear in batch. A 10-item batch test takes 5 minutes; resubmitting 21K items after a schema error takes hours — skipping the test is counterproductive on its own terms.
- Stages catch different failures: Stage 1 catches format errors; edge cases and error-rate patterns only emerge at ~100 items (Stage 2). Skipping stages hides systematic failures until they surface at maximum cost — errors compound silently at scale.
- HTTP 200 means the *request* succeeded, not the *output*: empty responses, malformed JSON, and hallucinated content all return 200. Likewise, parsing checks structure, not content — structurally valid output can be factually wrong, incomplete, or hallucinated. Reporting success from status codes or parse success alone is an unverified claim presented as fact; randomly sample and actually READ outputs at every stage.
- The full batch can cost 10x what you expected — extrapolate before scaling: (stage cost / stage items) × total items.

### Red Flags

- About to submit the full batch without a passing test batch → submit 10 items first.
- About to skip Stage 2 because Stage 1 passed → follow the scale-up plan from PLAN.md.
