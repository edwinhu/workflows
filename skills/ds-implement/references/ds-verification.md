# DS Technical Verification

Use this reference for the single independent **VERIFY** operation required by
`beat-implement`. It replaces the former standalone DS validation and verification phases. It does
not ask the user for acceptance; human acceptance belongs to `ds-accept` after technical `OVERALL: PASS`.

Read `${CLAUDE_SKILL_DIR}/../ds-verify/references/ds-checks.md` with this reference. The approved native plan is the authority for objectives,
criteria, sources, output paths, grain, constraints, and required windows. `TaskList` is the source
of live completion status. Do not create or read `SPEC.md`, `STATE.md`, `LEARNINGS.md`,
`VALIDATION.md`, or a separate verifier state file.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS technical verification

**NO TECHNICAL PASS WITHOUT A FRESH, INDEPENDENT RE-RUN OR INSPECTION OF EVERY APPLICABLE CRITERION.**

The implementer’s report is evidence to investigate, not a verdict. A plausible table can be built on
a truncated source, a duplicate-producing join, a stale output, or an unseeded fit. Calling it verified
without testing its actual evidence is anti-helpful: it transfers the debugging cost to the user.
</EXTREMELY-IMPORTANT>

## Verifier boundary

Dispatch a fresh, read-only verifier after the latest implementation change. It receives only:

- the approved native-plan task criteria, constraints, declared outputs, source/vintage requirements,
  grain/key decisions, and review-relevant claims;
- the completed task IDs from `TaskList`;
- the completed output paths and the project configuration needed to run them; and
- this reference and `${CLAUDE_SKILL_DIR}/../ds-verify/references/ds-checks.md`.

It must not receive the doer’s reasoning transcript, mutable planning artifacts, or prior agent memory.
It may read code, notebooks, configuration, provenance, and outputs; it may execute declared scripts or
notebooks in a fresh/read-only manner. It must not edit project files, repair defects, regenerate a
canonical output in place, or downgrade a failed check because the task report claimed success.

## Verification flow

```text
completed ready wave
        │
        ▼
fresh verifier reads approved criteria + declared artifacts
        │
        ▼
run static / output / data-quality / methodology / reproducibility checks
        │
        ├─ any unchecked, FAIL, or unaccounted applicable check → OVERALL: FAIL
        │       └─ return concrete evidence → targeted implementation retry → resume same verifier
        │
        └─ all applicable checks pass and ENUM accounts for the rest → OVERALL: PASS
                └─ next ready wave, or ds-accept after every native task passes
```

This flowchart is authoritative. A check that is inapplicable is not silently omitted: record `N/A` and
its reason in `ENUM`.

## Required technical checks

### 1. Artifact and criterion checks

For every declared output:

- Confirm it exists, is non-empty where applicable, opens/renders, and is the current artifact rather
  than an unrelated stale file.
- Run or inspect the exact task-local evidence named by the approved criterion.
- Compare the produced schema, row count, statistic, figure, or rendered surface to that criterion.
- Confirm that each approved task criterion maps to a concrete output. A missing output is `MISSING`; an
  existing output that does not answer its task is `PARTIAL`.

### 2. Static and engineering checks

Run `bash "${CLAUDE_SKILL_DIR}/../../../scripts/check-all-ds.sh" "<project>"` when analysis code is
present. It checks the retained DS mechanical rules for determinism, joins, idempotency, error handling,
schema contracts, standard errors, and visualization integrity.

A non-zero result is a technical `FAIL`. Report the raw failing rule and location. Do not conceal it in a
summary or treat a warning-free output as a substitute for a static check.

### 3. Data-quality checks

Select the applicable checks from `${CLAUDE_SKILL_DIR}/../ds-verify/references/ds-checks.md` for every final artifact and every cross-task handoff:

| Check | Run when | Minimum evidence |
|---|---|---|
| DQ1/DQ2 | tabular final data | constant/empty and high-null results |
| DQ3 | a grain or key is declared | duplicate and event-key collision results |
| DQ4/DQ6 | transform, filter, join, aggregate, or model task | input → operation → output count/shape evidence |
| DQ5 | categoricals are analyzed | cardinality result and interpretation |
| COV | any source has a required date/window span | actual min/max versus native-plan required span |
| UNI | multiple sources define the same universe | entity-universe comparison |
| DEN | a rate/share/percentage is presented | stated numerator and denominator |
| DEL | an apparent coverage improvement follows filtering | base before/after and explanation |
| ENUM | always | every applicable check, or `N/A` with reason |
| M1 | always | task criterion → output → evidence trace |

A duplicate, null, coverage, or cardinality signal is not automatically a defect; test it against the
approved grain and criterion. But an unexplained signal is not a pass. A gap may be accepted only by the
user during human review, never by the technical verifier.

### 4. Code-quality lens

Inspect final analysis code for correctness and reliability, not style preference. Report only findings
with confidence at least 80:

- missing values, duplicates, outliers, types, filters, and row drops are handled or evidenced;
- no off-by-one date/index error, unchecked denominator, hidden exception, or unhandled empty/single-row
  case affects the result;
- expensive loops, unnecessary copies, or quadratic work are reported only when their measurable cost
  threatens correctness or practical reproducibility;
- unclear names, missing comments, or magic numbers are findings only if they mislead execution or hide
  an unapproved analytic parameter.

Run independent final-data checks where data are available. A warning is a finding to investigate, not
proof that the whole analysis is invalid. Include the actual warning output.

### 5. Methodology lens

Review statistical soundness only to the extent the approved plan makes it relevant. Report only findings
with confidence at least 80 and identify the violated principle plus its impact:

- method fits the data type and claim; required assumptions, sample adequacy, and multiple-comparison
  treatment are checked where applicable;
- selection, survivorship, confounding, aggregation/Simpson’s paradox, leakage, incomplete periods,
  shifting denominators, averages of averages, joins, and time zones are handled where relevant;
- causal language is supported by a causal design, or the output clearly limits itself to association.

“Unusual” is not a failure. A possible bias is not a finding until it is measured or otherwise established
against the actual analysis.

### 6. Reproducibility lens

Attempt a fresh reproduction where the approved task and environment allow it:

1. Identify stochastic operations (`random`, sampling, shuffle, train/test splits, model initialization).
2. Confirm a fixed, recorded seed precedes every applicable operation.
3. Confirm package/environment versions, data locations and vintages, transformation entry points, and
   configuration are available from project files or approved task evidence.
4. Run scripts with their documented arguments, or execute notebooks top-to-bottom in a disposable output.
5. Where feasible, run twice with the same inputs/seed and compare stable output hashes, row counts, or
   stated numerical tolerances.

Do not report “seems hard to reproduce.” Report a high-confidence reproducibility finding only when a
missing prerequisite or observed run failure prevents regeneration or changes results. Absolute local paths,
hidden notebook state, unseeded stochasticity, and missing input provenance are defects when they actually
block the approved task’s reproduction.

## Verdict and report

Return exactly one report for the verified wave:

```markdown
## DS Technical Verification

**Scope:** [native task IDs and declared outputs]
**Static checks:** PASS | FAIL | N/A — [raw result or reason]

### Criterion map
| Task | Criterion / output | Evidence run or inspected | Result |
|------|--------------------|---------------------------|--------|

### Data-quality and cross-task checks
| Check | Scope | PASS / FAIL / N/A | Raw evidence or N/A reason |
|-------|-------|------------------|----------------------------|

### Code-quality findings (confidence >=80)
- [location, evidence, impact, recommended repair]

### Methodology findings (confidence >=80)
- [location, violated principle, evidence, impact, recommended repair]

### Reproducibility attempt
- Fresh run: PASS | FAIL | N/A — [command and result]
- Repeat comparison: [hash/count/tolerance evidence or N/A reason]
- Seed, environment, source/vintage evidence: [evidence]

### ENUM
- Ran: [checks]
- N/A: [check — task-specific reason]

### Verdict
**OVERALL: PASS | FAIL**

[For FAIL: task IDs to repair and the concrete failed/unchecked evidence.]
```

`OVERALL: PASS` requires every criterion to be checked, every applicable check to pass, and `ENUM` to
account for the rest. An unavailable check is `FAIL` unless it is genuinely inapplicable and has a specific
`N/A` reason.

## Remediation loop

On `OVERALL: FAIL`, target only the affected native tasks. Re-run `beat-implement` with the preceding
attempt records, then resume the **same** verifier with: “assume nothing landed; re-check from scratch;
do not soften because you raised the finding.” Cap a repeated unresolved technical finding at three repair
cycles; then report the raw blocker to the user rather than repeatedly making the same unverified change.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Call technical PASS because outputs exist | Existence does not establish correct values, grain, or reproducibility | Run the declared criterion and applicable DS checks |
| Reuse a cached result as a reproduction attempt | It cannot expose changed data, code, or environment | Run fresh and compare evidence |
| Treat an unrun check as benign | An unchecked requirement is an unknown, not a pass | Mark FAIL or record a specific N/A reason |
| Report a methodology/style concern without evidence | Speculation dilutes real findings and creates needless work | Report only ≥80-confidence, impact-bearing defects |
| Ask the user to waive a technical failure here | Human acceptance is separate and cannot make an unknown check pass | Return FAIL; take any later acceptance through ds-accept |
