---
name: writing-validate
description: "Validate canonical writing-plan claims against draft outputs before review; records live gaps in TaskList and returns coverage results."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, TaskCreate, TaskList, TaskUpdate
---

# Claim Validation

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts writing-validate`

Validate each canonical writing-plan claim against its mapped draft output before prose review. The receipt-selected immutable `{planFile, planHash}` contains claims, structure, claim-to-section mapping, source plan, section outputs, and review surfaces. `TaskList` contains live validation gaps and resolution work. Do not create or consume retired writing planning ledgers.

## Iron Law

**NO REVIEW WITHOUT CANONICAL CLAIM VALIDATION.** Authenticate and read the receipt-selected plan; parse its deterministic section index; read each mapped draft; then capture every missing or partial claim as TaskList work before review begins.

A legacy-only layout may be converted into a fresh approved plan, but it cannot enter this validation flow as authority.

## Process

1. Authenticate the selected `{planFile, planHash}` and verify the canonical writing grammar/index. Missing or malformed canonical state fails closed.
2. Load writing constraints, the style selected in `## Writing Intent`, and `ai-anti-patterns`.
3. Read `## Claims`, `## Counterarguments`, `## Claim → Section Map`, `## Section Outputs`, and the corresponding `drafts/` deliverables.
4. For every claim, assess: mapped output exists, substantive argument, source/evidence support, thesis threading, domain compliance, and AI-pattern compliance.
5. Classify each claim as `COVERED`, `PARTIAL`, or `MISSING`. Create one TaskList item for every PARTIAL or MISSING finding, tied to the current plan hash and exact draft path.
6. Return the coverage result to the caller. If no gaps are open, review may proceed. If gaps remain, present them for the user’s decision: revise through TaskList or explicitly proceed with known gaps.

## Return contract

```text
Claim validation result
- Plan: receipt-selected `{planFile, planHash}`
- Coverage: [covered]/[total]
- Covered claims: [CLAIM-NN list]
- Open findings: [TaskList IDs, CLAIM-NN, draft path, exact gap]
- Mechanical checks: [commands and results]
- Review admission: READY | USER_DECISION_REQUIRED
```

## Red flags

| About to | Stop because | Do instead |
|---|---|---|
| Read retired précis or master-outline files | Canonical PLAN is the approved writing specification | Read the receipt-selected plan and deterministic index. |
| Use an active-workflow marker for style | Stable configuration belongs in the plan | Read `## Writing Intent`. |
| Write `VALIDATION.md`, phase summaries, or learning ledgers | They become competing lifecycle authority | Use TaskList and return the result. |
| Claim full coverage without reading drafts | Mentioning is not arguing | Verify each mapped draft. |
| Silently pass partial or missing claims | The user must decide whether gaps are acceptable | Create TaskList findings and return them. |
