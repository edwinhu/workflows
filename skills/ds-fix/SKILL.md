---
name: ds-fix
version: 2.0
description: "This skill should be used when the user asks to 'fix analysis', 'wrong results', 'notebook error', 'reviewer feedback', 'data changed', 'debug notebook', or needs mid-analysis course-correction."
hooks:
  PostToolUse:
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow ds"
  PreToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow ds"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow ds"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow ds"
---

# DS Fix

Use this adapter only after diagnosing a concrete issue against the current approved native plan.
`TaskList` is live work state; project auto-memory holds reusable facts. There is no DS `SPEC.md`,
`LEARNINGS.md`, investigation team, or direct task-agent implementation path.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Fixes

**DIAGNOSE AND CLASSIFY BEFORE CHANGING IMPLEMENTATION. This is not negotiable.**

A symptom is not a root cause and a local patch may invalidate the approved analysis contract. Skipping
classification to appear fast is anti-helpful: it turns a visible failure into silent wrong results.
</EXTREMELY-IMPORTANT>

## Flow

```
current native plan + TaskList + project auto-memory
                    ↓
       reproduce and identify root cause
                    ↓
       R4 (plan contract changes)? ── yes → /ds native replanning
                    │ no
                    ↓
 ordinary tactical repair → ds-implement ready-wave → independent VERIFY → ds-review
```

## 1. Load and diagnose

1. Resolve the authenticated receipt-selected generated plan; call `TaskList`; consult project
   auto-memory for reusable technical facts.
2. Load applicable constraints:

   !`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts ds-fix`

3. Reproduce the concrete symptom and trace to its first divergence point. For a changed input,
   profile shape, types, coverage, nulls, duplicates, distributions, and keys before proposing a fix.
4. Classify the deviation under the DS deviation rules. Record each distinct user/reviewer issue with
   `TaskCreate` before acting.

### Classification gate

- **R4 — replanning required:** the research question, scope/exclusions, universe, source/access
  strategy, canonical grain, methods, evidence criteria, expected outputs, review surfaces, or any
  approved task/dependency must change.
- **Ordinary tactical repair:** the current approved plan remains valid and the fix can be stated as a
  complete ready-wave task with concrete criteria and writable outputs.
- **Blocked/uncertain:** do not guess. Gather the minimum read-only evidence, then classify again; if
  the uncertainty changes the approved contract, treat it as R4.

### Red flags

| About to | Stop because | Do instead |
|---|---|---|
| Edit a generated plan or the hook-owned receipt | It falsifies the approved native plan identity | Route R4 to `/ds` and obtain a new native approval |
| “Quickly” patch code in the orchestrator | It bypasses the shared ready-wave and independent verifier | State a tactical task, then use `ds-implement` |
| Treat changed data as automatically tactical | Schema, grain, or coverage changes often change the contract | Profile first; route R4 when the plan changes |
| Spawn a team to investigate or implement | Nested/direct delegation breaks the flat shared runner | Use one caller-curated `ds-implement` ready wave |

## 2. Route the result

### R4: return to native replanning

Immediately invoke `/ds`. Re-enter native Plan mode with the diagnosis and evidence, obtain user
approval through `ExitPlanMode`, and let the persistence hook atomically bind a replacement generated
plan and reset its receipt to `PENDING`. Run independent plan review again,
then reconcile `TaskList` in a genuinely separate implementation session.

### Ordinary tactical fix: use the shared implementation loop

Turn the diagnosis into a concrete TaskList item tied to the current `planHash`: include scope,
criteria, evidence, dependencies, `writablePaths`, and outputs. Then read
`${CLAUDE_SKILL_DIR}/../ds-implement/SKILL.md` and follow it immediately.

The adapter selects a complete ready wave, invokes `workflows/beat-implement.js`, and independently
verifies the changed work using the same technical verifier loop. A failure returns only the affected
ready-wave task to repair; do not change plan intent or criteria to make it pass. After technical PASS,
continue to `ds-review` for the existing human acceptance contract.

## Gate: claim a fix

1. **IDENTIFY:** Read the exact symptom, diagnosis, current native plan hash, and affected TaskList ID.
2. **RUN:** Run the chosen route: `/ds` for R4, or `ds-implement` shared ready wave for tactical work.
3. **READ:** Inspect independent technical verification evidence.
4. **VERIFY:** The result satisfies the current plan criteria; TaskList reflects the actual state.
5. **CLAIM:** Only then report the fix. Return reusable facts for main-orchestrator project auto-memory
   curation; never create a DS learnings ledger.

After one issue passes this gate, immediately take the next open diagnosed TaskList item. Do not pause
between ready tasks.
