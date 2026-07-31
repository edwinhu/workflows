---
name: workshop
description: "Create an academic workshop presentation and speaker notes from a research paper."
hooks:
  PreToolUse:
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow workshop"
    - matcher: "Edit|Write|Bash|Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow workshop"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow workshop"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-phase-gate-guard.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-outline-executable-guard.ts"
  PostToolUse:
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow workshop"
---

# Workshop

**Announce:** "I'm using workshop to create academic presentation slides and speaker notes."

## Iron Laws

- **NO GENERATION WITHOUT A RECEIPT-SELECTED, INDEPENDENTLY REVIEWED WORKSHOP PLAN.**
- **NO FIXED PLAN FILE OR PLANNING FRAGMENT AUTHORITY.** Source Paper, Source Inventory, the seven-column Slide Spec, Outputs and Verification, and Review Surfaces live only in the authenticated generated PLAN.
- **NO LLM OR DIRECTORY-DISCOVERY FALLBACK.** Missing, stale, pending, conflicting, or malformed plan state blocks.
- **NO SELF-REVIEW.** Plan review, generation, verification, and human review remain distinct.

Load constraints before implementation:

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts workshop`

## Native plan contract

Clarify paper, audience, duration, proportions, visual expectations, outputs, and review evidence. Then enter native Plan mode. The exact receipt-selected plan must contain these exact H2 headings:

1. `## Presentation Intent`
2. `## Audience, Venue, Duration, and Proportions`
3. `## Source Paper` — source path and extracted metadata.
4. `## Source Inventory` — complete F/T/R/A inventory.
5. `## Slide Spec` — `Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes`; every cell is required and Inventory has at least one declared F/T/R/A ID.
6. `## Outputs and Verification` — section-granular Typst generation, compilation, constraints, semantic fidelity, and visual checks.
7. `## Review Surfaces` — rendered deck and notes review.

After approval, retain the exact generated `planPath` and `planHash`; run `${CLAUDE_SKILL_DIR}/../workshop-plan-reviewer/SKILL.md`. A fresh reviewer must make the receipt state `APPROVED`. Never choose a plan by listing `.planning/` or infer a replacement name.

## Implementation

1. Compile the deterministic index in memory:
   ```bash
   bun ${CLAUDE_SKILL_DIR}/../../scripts/workshop/workshop-slide-table.ts "<absolute project root>" --json
   ```
   Require no `violations`, `reviewStatus: "APPROVED"`, and the exact returned `planPath` and `planHash`.
2. Invoke the generator:
   ```text
   Workflow(name="workshop-generate", args={
     "projectDir": "<absolute project root>",
     "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
     "planPath": "<index.planPath>", "planHash": "<index.planHash>",
     "slideIndex": <parsed index>
   })
   ```
   It keeps the seven-column specifications pinned, produces both Typst deliverables, and gates both compilations. Its temporary section fragments are outside planning state.
3. Verify the built deck independently:
   ```text
   Workflow(name="workshop-verify", args={
     "projectDir": "<absolute project root>", "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
     "planPath": "<index.planPath>", "planHash": "<index.planHash>", "slideIndex": <parsed index>
   })
   ```
   The verifier enumerates built slides and makes the PLAN-to-slide join semantically, without injecting a candidate menu. It applies the parser's Source Inventory whitelist after the join.
4. If `overallPass` is false, fix reported findings and re-run selectively with the same path and hash. A replacement plan invalidates carry-forward review state. If true, proceed immediately to `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md` and record user dispositions in `.planning/HUMAN_REVIEW.md`.

Typst deliverables remain `presentation/slides.typ`, `presentation/notes.typ`, and their rendered PDFs. Preserve F/T/R/A fidelity, seven-column Slide Spec semantics, unbiased joins, and both compile gates.
