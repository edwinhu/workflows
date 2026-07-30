---
name: ds
description: "This skill should be used when the user asks to 'start data analysis', 'plan a data project', 'explore this dataset', 'what should I analyze', 'set up a new study', or needs the data-science workflow."
hooks:
  PreToolUse:
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow ds"
  PostToolUse:
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow ds"
---

# Data Science Workflow

`/ds` is the DS planning adapter: clarify the research question, gather only the profile and domain
facts needed to plan responsibly, use native Plan mode, then independently review the approved plan.
Claude Code owns the live task list; the native plan-persistence hook owns the immutable approved
copy at `.planning/PLAN.md`.

```
clarify with user → read-only profile / domain discovery → native Plan mode
       → ExitPlanMode approval → immutable PLAN.md copy → independent plan review
       → /ds-implement
```

This flowchart is authoritative. There is no DS `SPEC.md`, `STATE.md`, `LEARNINGS.md`, compiler,
generated runner, custom task-table schema, or custom verification phase.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Planning

**ASK BEFORE YOU LOOK; PLAN ONLY FROM EVIDENCE YOU ACTUALLY GATHERED. This is not negotiable.**

Loading a dataset or proposing a method before the user has stated the outcome anchors the work to
whatever data happens to be nearby. Skipping a necessary profile replaces evidence with a convenient
guess. Neither shortcut is helpful: it creates an analysis that is fast to start and expensive to
correct.
</EXTREMELY-IMPORTANT>

## 1. Clarify

At `/ds` entry, before asking any question, overwrite the narrow session sentinel with this exact
non-authorizing JSON (create `.planning/` if needed):

```bash
mkdir -p .planning && printf '%s\n' '{"status":"pending"}' > .planning/DS_CLARIFIED.json
```

Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md` and follow it before examining task files,
data, code, or prior analysis artifacts. Immediately after the user responds to the first
clarification questions, overwrite the sentinel with this exact strict JSON; it contains only the
current session identity and authorization status, never user requirements:

```bash
printf '%s\n' "{\"status\":\"clarified\",\"sessionId\":\"${CLAUDE_SESSION_ID}\"}" > .planning/DS_CLARIFIED.json
```

Supply the DS-specific axes the primitive needs:

| Axis | Establish with the user |
|---|---|
| Outcome | Question, audience, decision the analysis informs, and deliverables |
| Universe | Unit of observation, entity inclusion rule, sample period, and authoritative source when sources disagree |
| Sources | Available data, access/location, expected refresh/vintage, and known restrictions |
| Constraints | Replication target, required methods, deadline, compute/cost limits, and reproducibility needs |
| Evidence | What makes each planned output credible: a check, an inspectable exhibit, a source comparison, or user judgment |

Ask in one `AskUserQuestion` call when answers are independent. Ask cascading questions separately:
a source choice that determines available variables must be answered before variable questions.

### DS clarification facts

- A sample period and an entity universe are research choices, not properties inferred from the first
  query result. A rate at the wrong grain is a different statistic with a familiar label.
- The universe predicate belongs where scope is decided. Applying it to a lookup or denominator can
  turn available values into nulls; a 43.7% null-denominator incident came from exactly that duplicate
  filtering mistake.
- A criterion that cannot name evidence is a wish. Use the primitive's explicit `TBD (<phase>)`
  convention only when profiling is the scheduled evidence-producing phase; never invent coverage.

Record the user-approved intent and evidence criteria in the native plan when entering Plan mode —
not in a preliminary DS artifact.

## 2. Gather planning evidence without implementing

After clarification, gather the minimum evidence needed to choose a feasible plan. This is
reconnaissance, not analysis implementation.

### Read-only data profile

For each source that materially affects the plan, collect or dispatch a read-only profile covering:

- location/access, approximate shape, columns/types, date coverage, and likely row grain/key;
- nulls, duplicates, type drift, category/distribution anomalies, and likely join risks;
- raw size and whether source-side filtering, caching, partitioning, or server-side computation is
  needed;
- a small representative sample only when access and project policy permit it.

Use direct read-only inspection for one small local source. For independent sources, dispatch all
read-only profilers directly in parallel and consolidate their reports. Do not make a profiling agent
implement a pipeline, mutate project files, or spawn further agents.

If a source may be large (roughly 50M rows, 500 MB to ship, or described as bulk/large/uncertain),
read `${CLAUDE_SKILL_DIR}/../../references/constraints/ds-data-pull-profile.md` and follow it. The
profile must compare filtered raw and candidate aggregate/server-side paths before native planning
commits to one. Do not pull a full source merely to estimate it.

### Domain and example discovery

When the plan will use another workflow skill or data provider, discover its relevant references and
examples before choosing an approach. Read
`${CLAUDE_SKILL_DIR}/../../references/constraints/ds-external-skill-discovery.md` and follow it.
Record the resulting ADOPT, PATCH, or GREENFIELD decision in the native plan itself.

For multi-output work that shares a sample, read
`${CLAUDE_SKILL_DIR}/../../references/constraints/ds-master-datasets.md`. Plan the minimal canonical
analysis dataset(s), their grain and keys, and which planned outputs consume each one. For analytic
filters or tunable thresholds, read
`${CLAUDE_SKILL_DIR}/../../references/constraints/ds-parameter-transparency.md`; name one
configuration location, rationale, and treatment of convenience choices in the native plan.

### Boundary

Do not write production analysis code, create task trackers, or claim findings in this step. If an
answer depends on implementation, state it as a planned evidence task rather than pretending the
profile established it.

## 3. Use native Plan mode

Enter native Plan mode after the clarification and planning evidence are sufficient. The plan must
express, in the user's terms:

1. the goal, scope, exclusions, and evidence criteria;
2. the source/access strategy and profile-derived data-quality or scale risks;
3. ordered, dependency-aware native tasks with concrete outputs and completion evidence;
4. reproducibility decisions appropriate to the work (source vintages, seeds, environments, and
   config);
5. a **Review Surfaces** section naming the concrete tables, figures, notebook exports, diagnostics,
   or decisions the user will inspect during human review; and
6. any domain-example decision, canonical dataset/grain, parameter rationale, or large-source
   decision required by the planning evidence above.

Use the native plan's natural structure. Do not manufacture a DS-specific executable table, a
`SPEC.md`, or a second task list. Native Plan mode and `TaskList` are the sources of intent and
live progress respectively.

Before `ExitPlanMode`, ensure the user has had the opportunity to approve the approach. On exit, the
native plan-persistence hook writes `.planning/PLAN.md` as a byte-for-byte copy of the approved native
body and writes its approval identity separately to `.planning/PLAN.meta.json`:

```json
{
  "schemaVersion": 1,
  "planHash": "<SHA-256 of exact PLAN.md bytes>",
  "approvedSession": "<ExitPlanMode payload session_id>",
  "approvedAt": "<strict ISO-8601 UTC timestamp ending in .sssZ>"
}
```

The hook deletes any prior hash-bound review when it replaces the plan.

Never write, patch, or regenerate this copy yourself. If the plan changes, re-enter native Plan mode,
obtain approval through `ExitPlanMode`, and let the hook replace it atomically.

## 4. Independent plan review

Immediately read `${CLAUDE_SKILL_DIR}/../ds-plan-reviewer/SKILL.md`, then dispatch a **fresh,
read-only** `general-purpose` reviewer. Give the reviewer the skill, `.planning/PLAN.md`, and only
read-only inspection tools; it must have no planning or implementation transcript and may use Bash
solely to compute the SHA-256 body hash. The planner reads the verdict but never self-approves.

Dispatch one fresh reviewer for the complete current plan and require its one durable hash-bound
verdict to approve. Dispatch the reviewer directly, never through a dispatcher agent.

- If any reviewer returns **ISSUES_FOUND**, re-enter native Plan mode, revise there, obtain fresh
  approval through `ExitPlanMode`, and review the newly persisted copy. Repeat at most five times;
  then show the unresolved issues to the user and ask how to proceed.
- If every reviewer returns **APPROVED**, immediately read
  `${CLAUDE_SKILL_DIR}/../ds-implement/SKILL.md` and follow it. Do not ask a redundant
  “should I continue?” question: approval is the transition.

## Gate: ready for implementation

1. **IDENTIFY:** `.planning/PLAN.md`, `.planning/PLAN.meta.json`, and `.planning/PLAN_REVIEWED.md`
   exist after `ExitPlanMode` and independent review.
2. **RUN:** Recompute SHA-256 over exact `PLAN.md` bytes and compare it with metadata `planHash`.
3. **READ:** Verify `approvedSession` and strict UTC-Z `approvedAt`; then read the actual plan and the
   hash-bound reviewer verdict. This is fail-closed workflow provenance based on session IDs, not
   cryptographic attestation.
4. **VERIFY:** The review artifact is `APPROVED` for the exact plan hash, records a strict-Z timestamp
   and a reviewer session distinct from approval and implementation, and profile-derived risks and every
   declared output have a concrete task/evidence path. Implementation begins only in a new session
   distinct from approval and review. PreCompact state supports recovery, not authorization.
5. **CLAIM:** Only then invoke `/ds-implement`.

## Red flags

| About to | Stop because | Do instead |
|---|---|---|
| Explore data before the user answers | Existing files will frame the question for the user | Run the CLARIFY beat first |
| Treat a head sample as a data profile | Nulls, grain failures, and type drift often live outside the head | Profile shape, tail/coverage, keys, and quality signals |
| Pull a huge source to see how big it is | The transfer is the failure you are supposed to prevent | Profile filtered counts and aggregate candidates read-only |
| Write `SPEC.md`, `STATE.md`, `LEARNINGS.md`, or a custom plan | It creates competing state and makes progress ambiguous | Use native Plan mode, immutable `PLAN.md`, TaskList, and project auto-memory |
| Patch `.planning/PLAN.md` after review finds a gap | That falsifies the approved record and its hash | Re-enter Plan mode and obtain a new approved copy |
| Infer live progress from plan checkboxes | The copied plan is immutable | Read `TaskList` |
