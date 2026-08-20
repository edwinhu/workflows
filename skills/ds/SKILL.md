---
name: ds
description: Data analysis, panel construction and empirical pipelines, run through craft with a computed data-quality gate. Use when the user says "analyze this data", "build the panel", "run the regression", "profile this dataset", "/ds", or wants a data project taken through clarification, an approved plan, delegated implementation, independent data-quality verification and human review.
argument-hint: 'the dataset, analysis, or data pipeline to build'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor]
---

# ds — a data project, run through craft with a computed data-quality gate

The lifecycle is [craft](${CLAUDE_PLUGIN_ROOT}/skills/craft/SKILL.md). Read it and follow it.
This file is a **delta**: it supplies the domain — the CLARIFY axes, the plan grammar, the lenses,
the mechanical checks, the refs, the authority text. It ships no `workflow.js` and restates none of
craft's mechanics.

What makes a run `ds` rather than plain craft is one thing: **every declared data output is verified
by a computed runner, not by the agent that produced it.** `scripts/ds-dq.py` reads the approved
plan's `## Data Outputs` table and opens each artifact itself; craft's JS reads its exit code.

## Write surface

Main chat clarifies, plans and dispatches. It does not do the analysis, and it never writes a `.py`,
`.ipynb`, `.R`, `.sas`, `.sql` or `.qmd` file — not by Write/Edit, and not by Bash (`python3 -c`,
`pixi run python`, inline pandas/numpy). Analysis runs in a dispatched agent. Craft's dispatch is
already structural and its judges are pinned to `Explore`, so this line is a rule on you, not a hook;
reach for the workflow first rather than after a refusal.

## Phase 1 — CLARIFY

Craft's Phase 1, on these axes.

<EXTREMELY-IMPORTANT>
**ASK BEFORE YOU LOOK; PLAN ONLY FROM EVIDENCE YOU ACTUALLY GATHERED. This is not negotiable.**

Loading a dataset or proposing a method before the user has stated the outcome anchors the work to
whatever data happens to be nearby. Skipping a necessary profile replaces evidence with a convenient
guess. Neither shortcut is helpful: it creates an analysis that is fast to start and expensive to
correct.
</EXTREMELY-IMPORTANT>

| Axis | Establish with the user |
|---|---|
| Outcome | Question, audience, decision the analysis informs, and deliverables |
| Universe | Unit of observation, entity inclusion rule, sample period, and authoritative source when sources disagree |
| Sources | Available data, access/location, expected refresh/vintage, and known restrictions |
| Constraints | Replication target, required methods, deadline, compute/cost limits, and reproducibility needs |
| Evidence | What makes each planned output credible: a check, an inspectable exhibit, a source comparison, or user judgment |

Ask in one `AskUserQuestion` call when answers are independent. Ask cascading questions separately:
a source choice that determines available variables must be answered before variable questions.

Three facts decide these axes, and each prevents a defect that is expensive to find later:

- A sample period and an entity universe are **research choices**, not properties inferred from the
  first query result. A rate at the wrong grain is a different statistic with a familiar label.
- The universe predicate belongs where scope is decided. Applying it to a lookup or a denominator
  can turn available values into nulls; a 43.7% null-denominator incident came from exactly that
  duplicate filtering mistake.
- A criterion that **cannot name evidence** is a wish. The explicit `TBD (<phase>)` convention is
  legitimate only when profiling is the scheduled evidence-producing phase; never invent coverage.

Craft's remaining axes are taken as craft states them, with two domain bindings: craft axis 4
(observable success criteria) is answered with the DQ runner over the plan's `## Data Outputs` plus
the target project's own test and lint commands **when the project has them**, and those strings
become `mechanicalChecks` verbatim; craft axis 5 (review surface) is answered by the plan's
`## Review Surfaces` section. The `ds-dq` entry is never conditional. The `tests` and `lint` entries
are **omitted entirely when the project has no such command** — craft's probe runs a `cmd` verbatim,
so an unsubstituted `<the project's lint command>` placeholder blocks the gate on a placeholder
instead of on data quality.

Then gather planning evidence — **a read-only profile, never implementation**. For each source that
materially affects the plan, collect or dispatch a profile covering: location/access, approximate
shape, columns/types, date coverage, and likely row grain/key; nulls, duplicates, type drift,
category/distribution anomalies, and likely join risks; raw size and whether source-side filtering,
caching, partitioning, or server-side computation is needed; and a small representative sample only
when access and project policy permit it. Use direct read-only inspection for one small local source;
for independent sources, dispatch read-only profilers in parallel and consolidate. Do not make a
profiling agent implement a pipeline, mutate project files, or spawn further agents. Do not pull a
full source merely to estimate it. If an answer depends on implementation, state it as a planned
evidence task rather than pretending the profile established it.

Four discovery rules run in this same planning step, each governed by its own constraint file:

- **Large sources.** If a source may be large (roughly 50M rows, 500 MB to ship, or described as
  bulk/large/uncertain), read
  `${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-data-pull-profile.md` and follow it. The
  profile must compare filtered raw and candidate aggregate/server-side paths before planning commits
  to one. Do not pull a full source merely to estimate it.
- **External-skill discovery.** When the plan will use another skill or data provider, discover its
  relevant references and examples before choosing an approach: read
  `${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-external-skill-discovery.md` and follow it.
  Record the resulting ADOPT, PATCH, or GREENFIELD decision in the plan itself.
- **Master datasets.** For multi-output work that shares a sample, read
  `${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-master-datasets.md`. Plan the minimal
  canonical analysis dataset(s), their grain and keys, and which planned outputs consume each one.
- **Parameter transparency.** For analytic filters or tunable thresholds, read
  `${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-parameter-transparency.md`; name one
  configuration location, rationale, and treatment of convenience choices in the plan.

## Phase 2 — PLAN

Craft's Phase 2. Five domain requirements on the plan:

- **The source/access strategy and the profile-derived risks.** The plan states how each source is
  reached, and the data-quality and scale risks the read-only profile actually surfaced. A risk found
  at CLARIFY that reaches no plan section is a risk nothing acts on.
- **Reproducibility decisions**, appropriate to the work: source vintages, seeds, environments and
  config. `R1` (fresh re-run reproducibility) is judged by the `data-quality-judgement` lens, so a
  plan recording none of these leaves `R1` with nothing to judge against.
- **A `## Data Outputs` table**, in exactly this grammar, because `scripts/ds-dq.py` parses it and an
  output absent from it is one nothing will check:

  ```markdown
  ## Data Outputs

  | Path | Grain | Key Columns | Required Window |
  |---|---|---|---|
  | data/processed/panel.parquet | one row per firm-fiscal-year | pk: gvkey, fyear; event: gvkey, datadate | datadate: 2005-01-01..2025-12-31 |
  | data/processed/industry_xwalk.csv | one row per SIC code | sic | n/a |
  ```

  - **Path** — the produced artifact, relative to the project root. `.parquet`, `.csv`, or `.tsv`;
    one row per artifact the plan promises to produce.
  - **Grain** — the declared row grain, in words. This is the claim `DQ3` verifies rather than
    assumes.
  - **Key Columns** — the declared primary key `DQ3a` tests for uniqueness. Write `a, b` for a bare
    primary key, or `pk: a, b; event: c, d` to also declare the coarser business/event key `DQ3c`
    needs to catch amendments and restatements. Without an `event:` clause `DQ3c` reports `N/A`, and
    the runner says why.
  - **Required Window** — the sample period `COV` checks, as `[column: ]YYYY-MM-DD..YYYY-MM-DD`.
    Write `n/a` for an unwindowed output; `COV` then reports `N/A` with that as its reason. Naming
    the column is optional only when exactly one date column exists; an ambiguous window is a `FAIL`,
    not a pass.

- **A `## Review Surfaces` section** naming the concrete tables, figures, notebook exports,
  diagnostics, or decisions the user will inspect during human review.
- **`refs` per task row and per lens** — required, may be empty. Craft's spine does not validate it;
  `wc-probe` P7 refuses an absent key in THIS file, so a live run assembled from an approved plan is
  unchecked. Write `refs: []` to state "no domain rules" rather than omitting the key.

## Phase 3 — GOAL

Craft's Phase 3 unchanged.

## Phase 4 — the craft call

The args go in the plan's `<!-- craft:dispatch -->` arming block, and the dispatch is **craft's own
`craft-dispatch.sh`** — never a hand-written `farm.ts` line. That script owns the TIER 1 plan-lint
gate, which refuses to dispatch on a `major`/`critical` plan finding and fails CLOSED on a verdict it
cannot count; hand-rolling the invocation silently drops it. Craft owns the wait, the result handling
and the return shape too, and `craft-result.sh` reads the verdict. This run's `projectDir` is the
session repo, so craft's own run directory is already inside it and no `--run-dir` override applies.
There is no built-in `Workflow` call — the guard at
`~/.claude/hooks/main-thread-guard.sh` denies that tool outright.

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-dispatch.sh   # armed plan; or pass one
```

```js
{
  projectDir,
  goal: "<one sentence>",

  // The plan's table verbatim. Every task carries refs, empty or not. The four constraint
  // aggregates are UNCONDITIONAL — every implementation task carries all four, alongside
  // whichever vendored references that task's own work needs.
  tasks: [
    { id: "T1",
      name: "<data pull or pipeline task>",
      work: "<what to build>",
      writablePaths: ["<narrow>"],
      acceptance: "<the criterion the verifier checks>",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-constraints.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-conventions.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-analysis-constraints.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-engineering-constraints.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/etl-enforcement.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/sql-patterns.md"] },

    { id: "T2",
      name: "<task whose acceptance is evidentiary>",
      work: "<what to build>",
      writablePaths: ["<narrow>"],
      acceptance: "<the criterion the verifier checks>",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-constraints.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-conventions.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-analysis-constraints.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-engineering-constraints.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/ds/references/verification-patterns.md"] },
  ],

  // The DS gate: the runner reads the approved plan's ## Data Outputs and opens each artifact
  // itself. ds-dq is never conditional. tests and lint are the TARGET project's own commands,
  // collected at CLARIFY, and are included ONLY when the project has them — a probe runs cmd
  // verbatim, so an unsubstituted placeholder blocks the gate on a placeholder. Omit the entry.
  mechanicalChecks: [
    { name: "ds-dq", cmd: "uv run --with polars python3 ${CLAUDE_PLUGIN_ROOT}/skills/ds/scripts/ds-dq.py --plan <planPath> --project-dir <projectDir>" },
    { name: "tests", cmd: "<the project's full test command — omit this entry when it has none>" },
    { name: "lint",  cmd: "<the project's lint command — omit this entry when it has none>" },
  ],

  // Judged BEFORE any implementer is dispatched; a surviving critical|major returns FAIL having
  // built nothing. Cheap: a spec defect costs a few read-only agents instead of a whole round.
  // Passing reviewLenses REPLACES craft's defaults, so the two defaults are spelled out here
  // rather than elided — an array of two would silently drop them.
  reviewLenses: [
    { key: "criteria-vs-artifacts",
      agentType: "Explore",
      refs: [],
      prompt: "Judge the deliverable strictly against the success criteria in the plan and goal: for each criterion, is there an artifact in the working tree that satisfies it? Missing or partial satisfaction is a finding." },

    { key: "scope-fidelity",
      agentType: "Explore",
      refs: [],
      prompt: "Judge scope fidelity: did the changes stay inside the plan's task table and writable paths? Out-of-scope edits, unrequested features, and silently skipped plan items are findings." },

    { key: "data-quality-judgement",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-checks.md"],
      prompt: "Judge ONLY the seven checks no runner can settle, against the definitions in the refs. Read them in full first. Five are MODEL-EVALUATED: M1 (approved-plan criterion compliance), UNI (universe agreement), DEN (every rate states its denominator), DEL (coverage improved because the base shrank), R1 (fresh re-run reproducibility). Report each of those five as MODEL-EVALUATED with the evidence you actually read — never as PASS, which presents a judgement as a computation. Two more are yours as well: DQ4 (row-count traceability) and DQ6 (output-first shape before/after). The runner emits a line for them only because ENUM requires one; it computes neither and emits `always N/A`, and an N/A never sets its non-zero exit — so if you do not judge them, nothing does. `always N/A` is not a third kind of pass. Report DQ4 and DQ6 as dispositioned against task-local evidence — the input → transform → output count chain for DQ4, the before/after shape for DQ6 — never as checked. Findings: a check whose judgement you cannot support with evidence you actually read, since unsupported is a finding and never a pass; M1 — a plan criterion the outputs do not meet; UNI — sources admitting different entities; DEN — a reported rate with no stated denominator; DEL — a coverage improvement not attributable to the base shrinking; R1 — reproducibility not established by the vintages, seeds, environment and config the plan records; DQ4 — a row-count chain that cannot be traced input → transform → output; DQ6 — no before/after shape for the transform. Severity: a failed or unsupported judgement on any of the seven is `major` at minimum, and `critical` where the defect invalidates the output's stated grain, universe or inference — never `minor`, which would leave the gate passing over a real universe defect." },

    { key: "methodology",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/ds/references/verification-patterns.md"],
      prompt: "Judge only the method and the evidence behind it, against the patterns in the refs. Read them in full first. Findings: a statistic computed at a grain other than the one the plan declared, a universe predicate applied where scope was not meant to be decided, a claim whose evidence is read from code rather than observed from a run, and an output the plan promised that nothing checks. Severity: each of these four is `major` at minimum, and `critical` where the defect invalidates the output's stated grain, universe or inference — never `minor`, which would leave the gate passing over a real methodology defect." },
  ],

  authorityExtra: [
    "IRON LAW OF DS PLANNING — ask before you look; plan only from evidence you actually gathered.",
    "IRON LAW OF DS VERIFICATION — no check result without the runner's own output. A mechanical check reported from reading the code, or an N/A justified by a reason the model composed, is the model certifying its own enumeration. Every mechanical result is a line ${CLAUDE_PLUGIN_ROOT}/skills/ds/scripts/ds-dq.py emitted, quoted as emitted.",
    "Never report M1, UNI, DEN, DEL or R1 as PASS. They are MODEL-EVALUATED judgements and are reported as such, with the evidence read.",
    "DQ4 and DQ6 are `always N/A` from the runner, and `always N/A` is not a third kind of pass — the runner emits a line for them only because ENUM requires one, and an N/A never sets its non-zero exit. Both are dispositioned against task-local evidence, exactly like the MODEL-EVALUATED rows: the input → transform → output count chain for DQ4, the before/after shape for DQ6. Never read their N/A as `the runner checked this`.",
    "An artifact absent from the plan's ## Data Outputs table is one nothing will check and cannot be claimed as verified. Do not verify an output the table never declared.",
    "The analysis is done by dispatched agents. Main chat writes no .py, .ipynb, .R, .sas, .sql or .qmd file, by any tool.",
    "Standing DS doer authority — every implementation task loads all four aggregates and follows their indexed constraints: ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-constraints.md; ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-conventions.md (V1-V9: assumption-over-evidence, deferred verification, statistical validity, P-hacking prevention, sample-selection documentation); ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-analysis-constraints.md (A1-A6: robustness checks, standard-error specification, visualization integrity, table-figure pairing, chart typography, chart colour); ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-engineering-constraints.md (E1-E5: determinism and seeds, schema contracts, join audits with row counts and match rates, idempotency, loud error handling).",
    "Rules: ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-checks.md defines all thirteen checks; ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/etl-enforcement.md governs pipelines; ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/sql-patterns.md governs data pulls; ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/verification-patterns.md governs evidence; ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/competing-hypothesis.md governs debugging.",
  ].join("\n"),

  verifierAgentType: "Explore",
}
```

`verifierAgentType` and every lens `agentType` pin `Explore` because it has no Edit and no Write: a
judge that structurally cannot modify the tree beats a prompt asking it not to.

Add `${CLAUDE_PLUGIN_ROOT}/skills/ds/references/competing-hypothesis.md` to a task's `refs` when
that task is a diagnosis rather than a build. `authorityExtra` names it; `refs` is what makes an
implementer read it in full.

The runner's own contract suite lives at
`${CLAUDE_PLUGIN_ROOT}/skills/ds/scripts/ds_dq_test.py`; add it as a `mechanicalChecks` entry on
any run that touches the runner.

## Phase 5 — HUMAN REVIEW

Craft's Phase 5 unchanged, over the plan's `## Review Surfaces`. A clean technical verification is
evidence for that conversation, not human acceptance.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| Sizing a source | pull the whole thing to see how big it is | the transfer is the failure you are meant to prevent — profile filtered counts and aggregate candidates read-only |
| Profiling a source | treat a head sample as the profile | nulls, grain failures and type drift live outside the head — profile shape, tail/coverage, keys and quality signals |
| Naming a produced artifact | name it in prose | a runner given prose cannot open it, key it, or window it — add its row to `## Data Outputs` before approval |
| The DQ result | let the implementer report it | the doer cannot see the assumption it made in both places — the runner is a `mechanicalCheck` and the JS reads its exit code |
| `M1`/`UNI`/`DEN`/`DEL`/`R1` | report them as `PASS` | that presents a judgement as a computation — `MODEL-EVALUATED` with the evidence read |
| `DQ4`/`DQ6` reported `N/A` | read the `N/A` as the runner having checked them | `always N/A` is not a third kind of pass — the runner computes neither and an `N/A` never sets its non-zero exit; disposition both against task-local evidence, exactly like the MODEL-EVALUATED rows |
| Project state | write a `SPEC.md`, `STATE.md` or `LEARNINGS.md` | competing state makes progress ambiguous — the approved plan is the authority and craft hashes it |
| Something craft does not obviously do | write a `ds/workflow.js` | ask which craft parameter is missing — `mechanicalChecks` is what makes the DQ runner the gate |
