---
name: ds
description: "This skill should be used when the user asks to 'start data analysis', 'plan a data project', 'explore this dataset', 'what should I analyze', 'set up a new study', or needs the data-science workflow."
hooks:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow ds"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow ds"
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow ds"
  PostToolUse:
    - matcher: "AskUserQuestion"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/episode-phase.ts --workflow ds"
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow ds"
---

# Data Science Workflow

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/ensure-plans-directory.ts ${CLAUDE_SESSION_ID}`

## Write surface: main chat does not do the analysis

**You may Write/Edit only under `.planning/`, `.claude/`, `scripts/`, `hooks/`, `references/`,
`skills/` and `CLAUDE.md` — and NEVER a `.py`, `.ipynb`, `.R`, `.sas`, `.sql` or `.qmd` file, not
even inside those directories.** Analysis runs in a dispatched agent.
`orchestrator-mutation-guard` is registered in this skill's frontmatter, so the attempt is REFUSED,
not corrected: a write you try anyway costs a turn and produces nothing. Reach for `Agent` first,
not after a denial. Bash is held to the same line — `python3 -c`, `pixi run python` and inline
pandas/numpy imports are refused from main chat too.

Two narrow exceptions: the generated plan while you are IN Plan mode, and `.claude-workflows.json`
when adopting governance.

`/ds` is the DS router. It runs the same five beats every workflow in this plugin runs, supplying the
DS specifics at each one: clarify the research question, gather only the profile and domain facts
needed to plan responsibly, use native Plan mode, implement through the shared runner, verify
independently, and take the result to the user. Claude Code owns the live task list; the native
plan-persistence hook authenticates the exact generated plan selected by its hidden receipt. The
receipt supplies the only `{planFile, planHash}` planning identity.

```
CLARIFY → PLAN (read-only profile / domain discovery → native Plan mode → ExitPlanMode approval
       → receipt-selected generated plan → independent plan review)
       → IMPLEMENT → VERIFY → REVIEW
```

This flowchart is authoritative. There is no DS `SPEC.md`, `STATE.md`, `LEARNINGS.md`, compiler,
generated runner, or custom task-table schema, and no verification phase outside the shared VERIFY
beat below.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Planning

**ASK BEFORE YOU LOOK; PLAN ONLY FROM EVIDENCE YOU ACTUALLY GATHERED. This is not negotiable.**

Loading a dataset or proposing a method before the user has stated the outcome anchors the work to
whatever data happens to be nearby. Skipping a necessary profile replaces evidence with a convenient
guess. Neither shortcut is helpful: it creates an analysis that is fast to start and expensive to
correct.
</EXTREMELY-IMPORTANT>

## 1. CLARIFY

Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md` and follow it before examining task files, data,
code, or prior analysis artifacts. Reconnaissance unlocks when the phase is recorded, so the only way
through the guard is to genuinely ask.

**Write no sentinel.** `.planning/DS_CLARIFIED.json` is retired, and with it the two `printf`
commands that used to live here. A hook records the clarify phase into
`.planning/.state/episode.json` when it OBSERVES your `AskUserQuestion` call, which is direct
evidence the user was actually asked. The sentinel was this skill telling the guard that it had
clarified — a claim the guard had a special Bash exemption to let through, and one that could be
made without ever asking a question.

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
Record the user-approved intent and evidence criteria in the native plan when entering Plan mode —
not in a preliminary DS artifact.

**Gate:** the hook has recorded the clarify phase from an observed `AskUserQuestion`, and every axis
above has an answer from the user rather than an inference from nearby files.

## 2. PLAN

Read `${CLAUDE_SKILL_DIR}/../beat-plan/SKILL.md` and follow it. It owns receipt binding, the
declared-grammar rule, the whole-plan review boundary, and the fan-out check. The DS specifics follow.

### Gather planning evidence without implementing

After clarification, gather the minimum evidence needed to choose a feasible plan. This is
reconnaissance, not analysis implementation.

**Read-only data profile.** For each source that materially affects the plan, collect or dispatch a
read-only profile covering:

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

**Domain and example discovery.** When the plan will use another workflow skill or data provider,
discover its relevant references and examples before choosing an approach. Read
`${CLAUDE_SKILL_DIR}/../../references/constraints/ds-external-skill-discovery.md` and follow it.
Record the resulting ADOPT, PATCH, or GREENFIELD decision in the native plan itself.

For multi-output work that shares a sample, read
`${CLAUDE_SKILL_DIR}/../../references/constraints/ds-master-datasets.md`. Plan the minimal canonical
analysis dataset(s), their grain and keys, and which planned outputs consume each one. For analytic
filters or tunable thresholds, read
`${CLAUDE_SKILL_DIR}/../../references/constraints/ds-parameter-transparency.md`; name one
configuration location, rationale, and treatment of convenience choices in the native plan.

**Boundary.** Do not write production analysis code, create task trackers, or claim findings in this
step. If an answer depends on implementation, state it as a planned evidence task rather than
pretending the profile established it.

### Use native Plan mode

Enter native Plan mode after the clarification and planning evidence are sufficient. The plan must
express, in the user's terms:

1. the goal, scope, exclusions, and evidence criteria;
2. the source/access strategy and profile-derived data-quality or scale risks;
3. ordered, dependency-aware native tasks with concrete outputs and completion evidence;
4. reproducibility decisions appropriate to the work (source vintages, seeds, environments, and
   config);
5. a **Review Surfaces** section naming the concrete tables, figures, notebook exports, diagnostics,
   or decisions the user will inspect during human review;
6. a **Data Outputs** section in the required grammar below; and
7. any domain-example decision, canonical dataset/grain, parameter rationale, or large-source
   decision required by the planning evidence above.

Use the native plan's natural structure. Do not manufacture a DS-specific executable table, a
`SPEC.md`, or a second task list. Native Plan mode and `TaskList` are the sources of intent and
live progress respectively.

### Required plan grammar: `## Data Outputs`

`## Data Outputs` is the ONE deterministic table `/ds` requires, and it is required because
`scripts/checks/ds-dq.py` CONSUMES it during VERIFY. Outputs named only in prose cannot be checked:
a runner given prose does not know what artifact to open, at what grain, against which key, or over
what period. Every other executable-looking table remains forbidden by the paragraph above — the
refusal to manufacture them is not weakened by this one exception, it is the reason this exception
has to be stated explicitly.

```markdown
## Data Outputs

| Path | Grain | Key Columns | Required Window |
|---|---|---|---|
| data/processed/panel.parquet | one row per firm-fiscal-year | pk: gvkey, fyear; event: gvkey, datadate | datadate: 2005-01-01..2025-12-31 |
| data/processed/industry_xwalk.csv | one row per SIC code | sic | n/a |
```

- **Path** — the produced artifact, relative to the project root. `.parquet`, `.csv`, or `.tsv`; one
  row per artifact the plan promises to produce.
- **Grain** — the declared row grain, in words. This is the claim `DQ3` verifies rather than assumes.
- **Key Columns** — the declared primary key `DQ3a` tests for uniqueness. Write `a, b` for a bare
  primary key, or `pk: a, b; event: c, d` to also declare the coarser business/event key `DQ3c` needs
  to catch amendments and restatements. Without an `event:` clause `DQ3c` reports `N/A`, and the
  runner says why.
- **Required Window** — the sample period `COV` checks, as `[column: ]YYYY-MM-DD..YYYY-MM-DD`. Write
  `n/a` for an unwindowed output; `COV` then reports `N/A` with that as its reason. Naming the column
  is optional only when exactly one date column exists; an ambiguous window is a `FAIL`, not a pass.

Declaring an output here is what makes it verifiable. An artifact absent from this table is one the
VERIFY beat will not check and cannot be claimed as verified.

### Approval and independent review

Before `ExitPlanMode`, ensure the user has had the opportunity to approve the approach. On exit, the
native plan-persistence hook binds the exact generated plan and creates its hook-owned receipt at
`.planning/.state/review.json`. That private receipt selects exactly one direct-child generated plan and
contains its authenticated `{plan_file, plan_hash}`, workflow, approval identity, and review status.

Never inspect the state directory to choose a plan, write or patch its receipt, or recreate the generated
plan yourself. If the plan changes, re-enter native Plan mode, obtain approval through `ExitPlanMode`, and
let the hook bind the replacement atomically.

Immediately read `${CLAUDE_SKILL_DIR}/../ds-plan-reviewer/SKILL.md` and follow its dispatch
instructions. It dispatches a fresh `workflows:plan-checker` reviewer with the DS domain, concrete
reference root, receipt-selected immutable plan, and authenticated approval receipt. The planner reads the
reviewer-owned outcome but never self-approves. One reviewer produces one durable hash-bound verdict for
the complete plan.

- If any reviewer returns **ISSUES_FOUND**, re-enter native Plan mode, revise there, obtain fresh
  approval through `ExitPlanMode`, and review the newly persisted copy. Repeat at most five times;
  then show the unresolved issues to the user and ask how to proceed.
- If every reviewer returns **APPROVED**, continue immediately to IMPLEMENT. Do not ask a redundant
  "should I continue?" question: approval is the transition.

**Gate:** ready for implementation.

1. **IDENTIFY:** the hook-owned receipt selects one generated `planFile` and records its `planHash`.
2. **RUN:** resolve that receipt; recompute SHA-256 over the selected generated plan and require an exact
   match. Never infer a filename from `.planning/`.
3. **READ:** verify approval identity, strict UTC-Z approval time, and the reviewer-finalized receipt.
   This is fail-closed workflow provenance based on session IDs, not cryptographic attestation.
4. **VERIFY:** receipt status is `APPROVED`, review identity/time are distinct and chronological, and
   profile-derived risks and declared outputs have concrete TaskList/evidence paths. Implementation begins
   only in a new session distinct from approval and review.
5. **CLAIM:** Only then invoke `/ds-implement`.

## 3. IMPLEMENT

Read `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md`, then
`${CLAUDE_SKILL_DIR}/../ds-implement/SKILL.md` and follow it. The adapter reconciles the approved plan
into `TaskList`, selects one complete ready wave, and dispatches its doers through the shared runner.
The approved plan is immutable input: never reinterpret, compile, or patch it while implementing it.

**Gate:** every task in the current ready wave has returned, its declared outputs exist at the paths
the plan named, and no open `TaskList` item for the current `planHash` remains unaccounted for.
The doer does not grade its own work — that belongs to the next beat.

## 4. VERIFY

Read `${CLAUDE_SKILL_DIR}/../beat-verify/SKILL.md`, then `${CLAUDE_SKILL_DIR}/../ds-verify/SKILL.md`.

`ds-verify` is dispatched independently of `ds-implement` and has no edit tools. It runs
`scripts/checks/ds-dq.py` over every row of `## Data Outputs`, and it reports `M1`, `UNI`, `DEN`,
`DEL`, and `R1` as MODEL-EVALUATED judgements rather than computed passes.

**Gate:** a verification round is recorded against the current `planHash` after the last mutation,
the runner's JSON covers every declared output with each computed check `PASS` or `N/A` carrying the
runner's own reason, `ENUM` is `PASS`, the five model-evaluated checks each carry a judgement with
evidence, and `OVERALL: PASS`.

## 5. REVIEW

Read `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`, then `${CLAUDE_SKILL_DIR}/../ds-accept/SKILL.md`
and follow it. Present the plan's **Review Surfaces** to the user and ask for acceptance, tactical
feedback, or `REJECT:`. A clean technical verification is evidence for that conversation, not human
acceptance.

**Gate:** every feedback item has a disposition (`addressed`, `answered`, or user-authorized
`waived`) recorded in the returned result and `TaskList`, and no `REJECT:` is outstanding.

## DS clarification facts

- A sample period and an entity universe are research choices, not properties inferred from the first
  query result. A rate at the wrong grain is a different statistic with a familiar label.
- The universe predicate belongs where scope is decided. Applying it to a lookup or denominator can
  turn available values into nulls; a 43.7% null-denominator incident came from exactly that duplicate
  filtering mistake.
- A criterion that cannot name evidence is a wish. Use the primitive's explicit `TBD (<phase>)`
  convention only when profiling is the scheduled evidence-producing phase; never invent coverage.

## Red flags

| About to | Stop because | Do instead |
|---|---|---|
| Explore data before the user answers | Existing files will frame the question for the user | Run the CLARIFY beat first |
| Treat a head sample as a data profile | Nulls, grain failures, and type drift often live outside the head | Profile shape, tail/coverage, keys, and quality signals |
| Pull a huge source to see how big it is | The transfer is the failure you are supposed to prevent | Profile filtered counts and aggregate candidates read-only |
| Write `SPEC.md`, `STATE.md`, `LEARNINGS.md`, or a custom plan | It creates competing state and makes progress ambiguous | Use native Plan mode, the receipt-selected immutable generated plan, TaskList, and project auto-memory |
| Patch a receipt-selected generated plan after review finds a gap | That falsifies the approved record and its hash | Re-enter Plan mode and obtain a new approved generated plan |
| Infer live progress from plan checkboxes | The copied plan is immutable | Read `TaskList` |
| Name a produced artifact only in prose | A runner given prose cannot open it, key it, or window it | Add its row to `## Data Outputs` before approval |
| Let the implementer report its own DQ results | The doer cannot see the assumption it made in both places | Dispatch `ds-verify` independently |
