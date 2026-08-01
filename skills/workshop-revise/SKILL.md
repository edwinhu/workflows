---
name: workshop-revise
description: "Revise an approved workshop presentation or its speaker notes."
hooks:
  PreToolUse:
    - matcher: "Read"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/image-read-guard.ts"
    - matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash|Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow workshop"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow workshop"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-phase-gate-guard.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-outline-executable-guard.ts"
---

# Workshop Revise

**Announce:** "I'm using workshop-revise to apply changes to the workshop presentation."

## Iron Laws

- **NO REVISION WITHOUT THE RECEIPT-SELECTED, APPROVED WORKSHOP PLAN.**
- **NO RETIRED PLANNING FILES.** The generated PLAN alone supplies paper evidence, inventory, slide specs, verification, and review surfaces.
- **NO PLAN CHANGE DURING A DECK EDIT.** Replace and independently re-review the generated plan first.
- **NO DECLARED CLEAN DECK WITHOUT THE COMPUTED VERIFY GATE.**

Load constraints:

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts workshop-revise`

## Entry

Compile the index and require its exact authenticated identity:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/workshop/workshop-slide-table.ts "<absolute project root>" --json
```

Require no violations, `reviewStatus: "APPROVED"`, and retain `planPath`/`planHash`. Read the PLAN plus both current Typst files before edits. For a structural request, STOP and request a replacement plan rather than mutating its Slide Spec.

## Edit and verify

Apply synchronized slide/notes changes with Typst conventions. Then invoke the independent verifier with the exact parser result:

```text
Workflow(name="workshop-verify", args={
  "projectDir": "<absolute project root>", "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
  "planPath": "<index.planPath>", "planHash": "<index.planHash>",
  "slideIndex": <parsed index>, "onlyChecks": [<changed built-slide IDs>]
})
```

Preserve its unbiased semantic PLAN-to-built-slide join and Source Inventory whitelist. Fix critical and major findings, recompile slides and notes, then rerun with the same plan identity. A new plan invalidates prior reviews. When `overallPass` is true, proceed immediately to `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`; retain rendered Typst deliverables for the human review surface.
