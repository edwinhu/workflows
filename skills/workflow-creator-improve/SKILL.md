---
name: workflow-creator-improve
description: "Use when auditing, repairing, redesigning, migrating, or applying feedback to an existing workflow. Corrective shared-v1 entry; audit-only requests remain read-only."
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Skill, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Workflow
hooks:
  PreToolUse:
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow workflow-creator"
    - matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow workflow-creator"
    - matcher: "Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow workflow-creator"
  PostToolUse:
    - matcher: "AskUserQuestion"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/episode-phase.ts --workflow workflow-creator"
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow workflow-creator"
---

# Workflow Creator Improve — Corrective Entry

Correct an existing workflow through shared-v1. Audit-only requests never receive mutation authority.

## Write surface: main chat does not do the work

**You may Write/Edit only under `.planning/` and `.claude/`. Every target workflow file — skills,
hooks, scripts, tests — is written by a dispatched agent.** `orchestrator-mutation-guard` is
registered in this skill's frontmatter, so the attempt is REFUSED, not corrected: a write you try
anyway costs a turn and produces nothing. Reach for `Agent` first, not after a denial. Bash is held
to the same line — only the named read-only checks and compilers are permitted from main chat.

Two narrow exceptions: the generated plan while you are IN Plan mode, and `.claude-workflows.json`
when adopting governance.

## Entry and compatibility

Reject legacy `.planning/wc/**` lifecycle state. A resumable episode must have `.planning/ACTIVE_WORKFLOW.md` with `workflow: workflow-creator`, `lifecycle: shared-v1`, and a semantic phase. Otherwise start a fresh corrective episode.

Initialize or update the marker:

```yaml
---
workflow: workflow-creator
lifecycle: shared-v1
entry: corrective
phase: clarify
target: <workflow slug>
---
```

Read `beat-clarify` and ask desired correction, exclusions, whether the request is audit-only or mutation-bearing, required evidence, and human review surface before inspecting the target.

## Branch

```text
CLARIFY → read-only workflow-creator-verify diagnosis
  ├─ audit-only → HUMAN REVIEW
  └─ repair/redesign/migrate → native Plan → plan review → compiler → beat-implement
                              → independent workflow-creator-verify verification → HUMAN REVIEW
```

### Audit-only

Set `phase: diagnosis`. Invoke `workflow-creator-verify` with `auditOnly: true`, `readOnly: true`, a deterministic `targetFiles` manifest, semantic `phases`, approved `criteriaRows`, and `mechanicalProbes: []`. Pre-approval diagnosis dispatches only the `workflow-auditor` agent profile, whose tools are structurally limited to `Read`, `Grep`, and `Glob`; it never executes caller-supplied commands or project scripts. Hook-contract and mechanical-probe execution are explicitly deferred to an approved verification run. Render evidence-bearing findings into `.planning/AUTOMATED_REVIEW.md`, then set `phase: human-review` and load `beat-review`. Do not create a generated plan or receipt, dispatch an implementation workflow, or mutate target files.

### Repair, redesign, or migration

Use the diagnosis as planning evidence. Enter native Plan mode with the canonical `Workflow Output Manifest` required by the fresh entry. Structural changes, output-set changes, or altered criteria require a replacement plan and fresh approval; immutable plans are never patched.

After independent plan review:

1. Compile the exact approved plan with `scripts/wc/workflow-plan-compiler.ts`.
2. Dispatch the returned ready wave through `beat-implement` with `workflow: workflow-creator`.
3. Re-run the deterministic compliance probe and `workflow-creator-verify` independently, selectively carrying authenticated prior reviews where valid:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/wc/compliance-probe.ts --target "<plugin repo root>"
```

The probe is safe pre-approval — it only reads files — and its findings are deterministic, so they are evidence rather than a score. Carry them as a mechanical probe result, never as a reviewer dimension.
4. Continue until every approved criterion has evidence and no blocking finding remains, within the active `/goal` budget.
5. Return to shared human review in `.planning/HUMAN_REVIEW.md`.

## Boundaries

- Main chat may write only administrative `.planning`/`.claude` state.
- Read-only pre-plan agents are allowed; generic Agent and every Workflow require current approved-plan admission.
- Bash is fail closed to named read-only checks; it may not edit, redirect, compile, or generate target artifacts.
- Compiler failure blocks; never hand-enumerate files or fall back to the retired generator.
- Tactical feedback loops here. `REJECT:` returns to clarification and replaces intent/criteria.
