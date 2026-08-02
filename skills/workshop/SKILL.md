---
name: workshop
description: "Create an academic workshop presentation and speaker notes from a research paper."
hooks:
  PreToolUse:
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow workshop"
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

Clarify paper, audience, duration, proportions, visual expectations, outputs, and review evidence.
Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md` and follow it — it owns the question set, the
stop condition, and how confirmed intent is carried forward as evidence. The
`clarify-before-recon-guard` hook enforces that clarification happens; the beat defines what it
is, which is why the gate alone was not adoption. Then enter native Plan mode. The exact receipt-selected plan must contain these exact H2 headings:

1. `## Presentation Intent`
2. `## Audience, Venue, Duration, and Proportions`
3. `## Source Paper` — source path and extracted metadata.
4. `## Source Inventory` — complete F/T/R/A inventory.
5. `## Slide Spec` — `Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes`; every cell is required and Inventory has at least one declared F/T/R/A ID.
6. `## Outputs and Verification` — section-granular Typst generation, compilation, constraints, semantic fidelity, and visual checks.
7. `## Review Surfaces` — rendered deck and notes review.

After approval, retain the exact generated `planPath` and `planHash`; run `${CLAUDE_SKILL_DIR}/../workshop-plan-reviewer/SKILL.md`. A fresh reviewer must make the receipt state `APPROVED`. Never choose a plan by listing `.planning/` or infer a replacement name.

## Implementation

**NO WORKFLOW WITHOUT AN AUTHENTICATE PRE-STEP AND A `--verify` POST-STEP.** Both
workshop workflow scripts are pure control flow — the Workflow runtime forbids
`import()`, `import.meta`, `process`, and `Buffer`, so an orchestrator cannot open,
hash, or re-stat a file. Receipt/plan authentication and drift detection therefore
run in the deterministic authenticator on either side of every dispatch. They are
never delegated to an agent: asking a dispatched agent to vouch for its own inputs
is not authentication.

1. Compile the deterministic index in memory:
   ```bash
   bun ${CLAUDE_SKILL_DIR}/../../scripts/workshop/workshop-slide-table.ts "<absolute project root>" --json
   ```
   Require no `violations`, `reviewStatus: "APPROVED"`, and the exact returned `planPath` and `planHash`.
2. Authenticate the receipt and the receipt-selected plan (pre-step). It snapshots
   both under TOCTOU discipline — `O_NOFOLLOW` open, fstat-vs-lstat identity
   comparison before AND after the read, realpath containment, sha256 of the bytes
   actually opened — and rejects a symlinked `.planning`, `.planning/.state`,
   receipt, or plan:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/../../scripts/workshop/workshop_plan_auth.py \
     --authenticate "<absolute project root>" --plan-hash "<index.planHash>" > /tmp/workshop-auth.json
   ```
   Non-zero exit or `ok !== true` blocks generation — read `violations` and stop. The
   bundle carries `projectReal`, `planPath`, `planHash`, and `artifacts`, keyed
   `receipt` and `plan`. ONE bundle serves both workflows; re-authenticate before
   `workshop-verify` so its entry hashes describe the post-generation state.
3. Run the shared IMPLEMENT beat's pre-step. **This is what binds each generating agent to the
   fragment files it is allowed to write** — read `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md`
   for the full contract. Build one task per SECTION from the index (`id` = `section-<n>`, matching
   the `TASK` marker the workflow emits), plus one for the assembler:

   ```bash
   echo "$PREFLIGHT_REQUEST_JSON" | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/preflight.ts
   ```

   `PREFLIGHT_REQUEST_JSON` is `{projectDir, workflow: "workshop", planReset: {planFile, planHash},
   dispatchOwnership: "caller", readyWave: [...]}`. Each section task declares
   `writablePaths: ["<fragmentsDir>/section-<n>.typ", "<fragmentsDir>/notes-section-<n>.typ"]` and the
   same two as `outputs`; the assembler task (`id: "assemble"`) declares the deck and notes paths
   **and their compile artifacts** — `tinymist compile` writes a PDF beside each `.typ`, and a
   compile output nobody declared is an undeclared change, which adjudicates as a violation by an
   agent that did exactly what it was told. Declare what the step actually writes, not just what you
   think of as its deliverable.

   `dispatchOwnership: "caller"` is correct here and not a shortcut: this workflow owns an
   orchestration richer than a dispatch loop (Discover, Sections, Assemble, Gate), so the beat must
   not route it or emit a script. Everything that enforces — approval authentication, task-contract
   validation, writable-path canonicalisation, and the expectation the observation hooks adjudicate
   against — is identical to a beat-owned dispatch.

   **A non-zero exit blocks generation.** Skipping this step does not fail: the workflow runs, the
   hooks find no expectation, and every section agent writes with no bounds checked at all. That is
   the state workshop was in before this step existed.

4. Invoke the generator, passing the bundle's fields straight through:
   ```text
   Workflow(name="workshop-generate", args={
     "projectDir": "<absolute project root>",
     "projectReal": <bundle.projectReal>,
     "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
     "planPath": <bundle.planPath>, "planHash": <bundle.planHash>,
     "slideIndex": <parsed index>,
     "artifacts": <bundle.artifacts>
   })
   ```
   It re-runs the strict receipt parse over `artifacts.receipt.text` itself, keeps the
   seven-column specifications pinned, produces both Typst deliverables, and gates both
   compilations. Its temporary section fragments are outside planning state.
5. Verify the built deck independently — re-authenticate first (step 2 again), then:
   ```text
   Workflow(name="workshop-verify", args={
     "projectDir": "<absolute project root>", "projectReal": <bundle.projectReal>,
     "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
     "planPath": <bundle.planPath>, "planHash": <bundle.planHash>, "slideIndex": <parsed index>,
     "artifacts": <bundle.artifacts>
   })
   ```
   The verifier enumerates built slides and makes the PLAN-to-slide join semantically, without injecting a candidate menu. It applies the parser's Source Inventory whitelist after the join.
6. Finalize each return value (post-step). Both workflows return `verifyRequired: true`
   and `driftVerified: false` — the verdict is provisional until the plan and receipt
   are re-snapshotted against the entry bundle. Write the return value to disk and run:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/../../scripts/workshop/workshop_plan_auth.py \
     --verify /tmp/workshop-auth.json --findings /tmp/workshop-result.json > /tmp/workshop-final.json
   ```
   If the plan or receipt moved during the asynchronous run, the post-step zeroes
   `finalPlanHash`, prepends a critical `artifact-integrity` finding, and forces
   `overallPass: false` with `verdict: "ISSUES FOUND (artifact drift)"`. Drift means the
   planning authority changed under the agents: re-authenticate and re-run, do not patch.
6. If `overallPass` is false, fix reported findings and re-run selectively with the same path and hash. A replacement plan invalidates carry-forward review state. If true, proceed immediately to `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md` and record user dispositions in `.planning/HUMAN_REVIEW.md`.

Read every gate from the **finalized** post-step output, never from the raw workflow
return: `verifyRequired: true` means the drift check has not run and the verdict is not
yet trustworthy.

Typst deliverables remain `presentation/slides.typ`, `presentation/notes.typ`, and their rendered PDFs. Preserve F/T/R/A fidelity, seven-column Slide Spec semantics, unbiased joins, and both compile gates.
