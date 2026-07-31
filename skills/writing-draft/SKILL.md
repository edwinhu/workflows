---
name: writing-draft
description: Internal writing phase that expands authenticated PLAN-bound section outlines into prose.
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash|Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow writing"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow writing"
    - matcher: "Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-outline-guard.ts"
    - matcher: "Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-mechanical-gate.ts"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-suggest-verify.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-claim-id-guard.ts"
---

# Writing Draft

Expand each PLAN-bound detailed outline into prose through `workflows/writing-draft.js`. The workflow receives the authenticated `planPath` and deterministic section index; it never discovers canonical structure through an LLM or retired planning file.

## Iron Laws

- **NO PROSE WITHOUT AN AUTHENTICATED, INDEPENDENTLY REVIEWED WRITING PLAN.**
- **NO PROSE WITHOUT THE MATCHING DETAILED OUTLINE.**
- **NO LLM OR LEGACY DISCOVERY FALLBACK.** Missing or malformed canonical inputs block.
- **NO STRUCTURAL PLAN CHANGES DURING DRAFTING.** Replace and re-review the plan instead.

## Inputs

1. Run approved-artifact admission for `writing`.
2. Dispatch a read-only agent to run `python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_section_index.py "<absolute project root>"` and return stdout without creating a file. The orchestrator does not create `.planning/.state` content or use shell redirection.
3. Parse the returned JSON in memory. Require `ok: true`, `reviewStatus: APPROVED`, the current generated `planFile`, exact `planPath`/`planHash`, and every plan section. Do not pass a partially valid index.
4. Load the domain skill from index `style` and load `workflows:ai-anti-patterns`.
5. Reconcile draft tasks in TaskList by `(planHash, section name, item_kind=draft)`.

## Invocation

```text
Workflow({
  scriptPath: "${CLAUDE_SKILL_DIR}/../../workflows/writing-draft.js",
  args: {
    projectDir: "<absolute project root>",
    pluginRoot: "${CLAUDE_SKILL_DIR}/../../workflows",
    planPath: "<index.planPath>",
    planHash: "<index.planHash>",
    sectionIndex: <parsed in-memory index>,
    outputSubdir: "drafts"
  }
})
```

On selective retry, pass `onlyChecks` and `priorReviews` only when they carry the same `planHash`. A replacement plan invalidates prior retries and review records.

## Drafting Contract

- Expand every outline claim in proportion to its weight; avoid stubs and uniform one-paragraph-per-point padding.
- Lead units with topic sentences and preserve explicit bridges across dependency order.
- Use only real sources from Source Plan and the section outline. Leave `[CITE-NEEDED: ...]` rather than inventing authority.
- Preserve exact mapped `CLAIM-NN` identifiers and current `plan_hash` in draft frontmatter; `implements` must equal the mapping exactly, including `[]` for claimless sections.
- Introduction and Conclusion use continuous prose; only body Parts receive domain-appropriate subsection headings.
- Record workflow results, blockers, and retry fingerprints in TaskList rather than PLAN or a Markdown status ledger.

## Mechanical and Semantic Verification

For every draft, dispatch a read-only verifier agent to run the deterministic floor against PLAN with `python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_gate_probe.py "<exact section.draftFile from Section Outputs>" --bib "<index.bibPath>" --plan "<index.planPath>" --plan-hash "<index.planHash>"` and return its JSON without writing files. The orchestrator does not run this Bash command directly.

A false result returns to the same current-hash draft task. Numeric consistency is advisory and explicitly not dataset provenance. Then run `workflows:source-verify`; citation existence is not source support.

## Exit Gate

Read the workflow result, not a self-report. `overallPass` must be true, `underGranular` empty, the generated plan hash unchanged, every reviewed outline unchanged after asynchronous verification, exact draft frontmatter valid, the deterministic probe clean, and semantic source verification clean. Store the evidence and result in TaskList. These checks replace the retired marker-based validation phase; continue directly to independent `writing-review` without creating a completion marker.
