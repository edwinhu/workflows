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

Apply synchronized slide/notes changes with Typst conventions.

**NO VERIFY WITHOUT AN AUTHENTICATE PRE-STEP AND A `--verify` POST-STEP.**
`workshop-verify.js` is pure control flow — the Workflow runtime forbids `import()`,
`import.meta`, `process`, and `Buffer`, so it cannot open, hash, or re-stat the
receipt or the plan. Authenticate them in the deterministic authenticator first
(`O_NOFOLLOW` open, fstat-vs-lstat identity comparison across the read, realpath
containment, sha256, and rejection of a symlinked `.planning`, `.planning/.state`,
receipt, or plan):

```bash
python3 ${CLAUDE_SKILL_DIR}/../../scripts/workshop/workshop_plan_auth.py \
  --authenticate "<absolute project root>" --plan-hash "<index.planHash>" > /tmp/workshop-auth.json
```

Non-zero exit or `ok !== true` blocks verification — read `violations` and stop. Then
invoke the independent verifier with the exact parser result and the bundle:

```text
Workflow(name="workshop-verify", args={
  "projectDir": "<absolute project root>", "projectReal": <bundle.projectReal>,
  "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
  "planPath": <bundle.planPath>, "planHash": <bundle.planHash>,
  "slideIndex": <parsed index>, "artifacts": <bundle.artifacts>,
  "onlyChecks": [<changed built-slide IDs>]
})
```

Its return is provisional (`verifyRequired: true`, `driftVerified: false`). Write it to
disk and finalize against the entry bundle:

```bash
python3 ${CLAUDE_SKILL_DIR}/../../scripts/workshop/workshop_plan_auth.py \
  --verify /tmp/workshop-auth.json --findings /tmp/workshop-result.json > /tmp/workshop-final.json
```

Read the gate only from the finalized output. If the plan or receipt moved during the
run, it zeroes `finalPlanHash`, prepends a critical `artifact-integrity` finding, and
forces `overallPass: false` — re-authenticate and re-run rather than patching.

Preserve its unbiased semantic PLAN-to-built-slide join and Source Inventory whitelist. Fix critical and major findings, recompile slides and notes, then rerun with the same plan identity. A new plan invalidates prior reviews. When `overallPass` is true, proceed immediately to `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`; retain rendered Typst deliverables for the human review surface.
