---
name: writing-outline
description: Internal writing phase that expands approved PLAN sections into detailed domain outlines.
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow writing"
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-outline-executable-guard.ts"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-suggest-verify.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-claim-id-guard.ts"
---

# Writing Outline

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts writing-outline`

Create detailed section outlines under `outlines/` from the authenticated writing PLAN. Detailed outlines are domain artifacts; they elaborate the plan but cannot replace or amend its stable structure.

## Iron Law

**NO PROSE WITHOUT A DETAILED OUTLINE, AND NO STRUCTURAL EDIT DISGUISED AS OUTLINING.**

If outlining reveals that the thesis, claim set, section order, claim homes, outputs, dependencies, or source configuration must change, stop and replace the native plan. Fresh approval and independent whole-plan review are required before continuing.

## Inputs

1. Authenticate the exact generated `plan_file` and `plan_hash` selected by `.planning/.state/review.json` through the writing admission gate; require `APPROVED` status. The compiler exposes these as index `planFile` and `planHash`.
2. Compile `scripts/writing/writing_section_index.py` against that exact path.
3. Read the generated plan's Writing Intent, Claims, Counterarguments, Document Structure, Claim → Section Map, Source Plan, Section Outputs, and Review Surfaces.
4. Load the domain skill named by Writing Intent `Domain:`.
5. Reconcile current-hash outline work in TaskList. Do not infer progress from a mutable planning ledger.

## Process

For each Section Outputs row, in dependency order, dispatch an authorized implementation agent with exclusive write authority over that row's exact `Outline` path. The orchestrating skill remains read-only and reconciles returned evidence into TaskList.

Each delegated outline task must:

1. Use the exact `Outline` path and exact section heading from the generated plan.
2. Put exactly the section's mapped `CLAIM-NN` identifiers in frontmatter, in mapped order with no additions or omissions. A claimless section must use exact `implements: []`:

   ```yaml
   ---
   implements: [CLAIM-01, CLAIM-02] # use [] only when the mapped claim list is empty
   plan_hash: <current planHash>
   ---
   ```

3. Write one top-level topic-sentence bullet per planned paragraph; sub-bullets carry evidence, authorities, counterarguments, and transitions.
4. Pin a real `[@bibkey]` or named primary authority to each substantive point. Use `[CITE-NEEDED: ...]` rather than inventing a citation.
5. Preserve the role and ordering specified in Document Structure and dependency edges in Section Outputs.
6. Record completion, blockers, and deviations in TaskList under the current `planHash` and section name.
7. Continue immediately to the next unblocked section. Same-hash resume reuses completed items and never duplicates them.

A detailed outline may refine paragraph ordering within a section. It may not add or remove a section, move a claim's primary home, alter dependencies, or change the planned output path.

## Outline Shape

```markdown
---
implements: [CLAIM-XX]
plan_hash: <current planHash>
---
# [Exact PLAN Section Name] — Detailed Outline

## Section Goal
[the PLAN role and claim payoff]

## Opening
- [topic-sentence claim]
  - [evidence / prior-section bridge]

## Body
- [topic-sentence claim]
  - [@bibkey or named authority]
  - [counterargument and response where applicable]

## Closing
- [payoff and bridge to the next PLAN dependency]

## Sources Used in This Section
- [@bibkey] — [use]
```

Opening, Body, and Closing are outline scaffolding, not prose headings. Introduction and Conclusion remain continuous prose; Parts may use domain-appropriate subsections.

## Gate

Recompile the deterministic section index. Every PLAN section must have its exact output path, `implements` must equal its mapped claims exactly (including `[]`), dependencies must remain unchanged, and each existing outline must be paragraph-granular. Parser or authentication failure blocks drafting; there is no retired-file or LLM-discovery fallback.
