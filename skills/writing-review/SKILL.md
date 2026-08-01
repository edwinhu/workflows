---
name: writing-review
description: Internal independent review phase for authenticated PLAN-bound writing drafts.
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Agent, Skill, Workflow, TaskCreate, TaskUpdate, TaskList, TaskGet
hooks:
  PreToolUse:
    - matcher: "Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow writing"
    - matcher: "Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-mechanical-gate.ts"
---

# Writing Review

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts writing-review`

Run independent, evidence-grounded review against the authenticated PLAN's claims, counterarguments, source plan, section outputs, dependencies, and review surfaces. Findings live in TaskList; this phase does not create a competing planning or review ledger.

## Iron Laws

- **NO REVIEW WITHOUT READING THE DRAFT AND ITS PLAN-BOUND OUTLINE.**
- **NO PASS WITHOUT QUOTED EVIDENCE.**
- **NO SELF-REVIEW.** Fresh reviewer agents must be distinct from drafting agents.
- **NO CANONICAL FALLBACK.** Missing `planPath`, hash mismatch, malformed index, or retired-file input blocks review.

## Inputs

1. Authenticate the exact generated writing `plan_file` and `plan_hash` from the approved combined `review.json` receipt; the compiler exposes them as index `planFile` and `planHash`.
2. Compile the deterministic section index through a read-only agent and parse its stdout in memory; require index `planFile`, `planHash`, and `reviewStatus` to equal receipt `plan_file`, `plan_hash`, and `status`.
3. Verify every Section Outputs row has its exact outline and draft path and exact `implements` frontmatter, including `[]` for claimless sections.
4. Load the domain skill and `workflows:ai-anti-patterns`.
5. Run mechanical writing constraints and the PLAN-based gate probe before semantic review.

## Invocation

```text
Workflow({
  scriptPath: "${CLAUDE_SKILL_DIR}/../../workflows/writing-review.js",
  args: {
    projectDir: "<absolute project root>",
    pluginRoot: "${CLAUDE_SKILL_DIR}/../../workflows",
    planPath: "<index.planPath>",
    planHash: "<index.planHash>",
    sectionIndex: <parsed in-memory index>
  }
})
```

Selective re-review may pass `onlyChecks` and `priorReviews` only for the same plan hash. A structural replacement invalidates all prior review carry-forward.

## Required Review Layers

1. **Section structure:** every paragraph and subsection executes the mapped claims and section role.
2. **Prose quality:** domain register, topic-sentence argument, clarity, rhythm, and AI-pattern checks.
3. **Source fidelity:** every citation resolves and supports the proposition attributed to it, using Source Plan context.
4. **Transitions:** adjacent dependency boundaries connect.
5. **Whole document:** claim coverage, counterarguments, scope, hook, conclusion, concept order, and repetition.
6. **Review Surfaces:** explicitly inspect every surface listed in PLAN.

Every normalized finding includes severity, location or review area, diagnosis, `planHash`, stable retry identity, and affected section/claim IDs where applicable. Section findings also retain verbatim quotes and proposed fixes when supplied. Mechanical quote verification drops fabricated or misattributed evidence, marks the section unreliable, and emits its own critical TaskList-ready finding.

## TaskList Contract

Create or update current-hash review items rather than writing a review Markdown file:

- one whole-document review item;
- section findings bound to section name and mapped `CLAIM-NN` IDs;
- transition findings bound to both adjacent sections;
- source findings bound to bibkey/authority and draft location;
- disposition (`open`, `fixed`, `accepted`, or `superseded`) and retry linkage.

`critical` and `major` findings block. Minor polish is advisory. Unreliable reviewer output blocks a clean verdict.

## Gate

Read `result.overallPass`, normalized `findings`, raw counts, unreliable sections, quoted evidence, and final artifact hashes. A clean substrate requires zero critical, zero major, no unreliable sections, unchanged plan/outline/draft bytes after asynchronous review, and completed Review Surfaces. Reconcile every finding into TaskList before routing to `/writing-revise`; a clean result proceeds to the returned human review surface. Neither path creates a mutable planning ledger.
