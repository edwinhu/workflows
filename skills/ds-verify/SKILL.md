---
name: ds-verify
description: "Internal /ds VERIFY beat — independent data-quality verification over the approved plan's declared Data Outputs. Invoked by the workflow; not user-invocable."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Agent, TaskList, TaskCreate, TaskUpdate
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
---

# DS verification — the verify beat

Read `${CLAUDE_SKILL_DIR}/../beat-verify/SKILL.md` first and follow it. It owns the shared invariants:
the verifier is never the doer, the recorded round bound to `planHash`, verifier continuity across
rounds, and named evidence per criterion. Everything below is the DS specific.

**This beat is dispatched independently of `ds-implement`.** It has no Write, Edit, MultiEdit, or
NotebookEdit tool, so it cannot repair what it grades. `ds-implement` used to host the VERIFY operation
inside itself; a doer that also runs the checks cannot see the assumption it made in both places.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS verification

**NO CHECK RESULT WITHOUT THE RUNNER'S OWN OUTPUT. This is not negotiable.**

A mechanical check reported from reading the code, or an `N/A` justified by a reason the model composed,
is the model certifying its own enumeration. That is not evidence, and presenting it as one is not
helpful: it produces an analysis that passed nothing while reading as verified. Every mechanical result
in this beat is a line `scripts/checks/ds-dq.py` emitted, quoted as emitted.
</EXTREMELY-IMPORTANT>

## The checks

Read `${CLAUDE_SKILL_DIR}/references/ds-checks.md`. It is the canonical definition of all thirteen
checks and this skill owns it. Never inline a check definition — inlined copies drift, which is that
file's own Iron Law.

### Computed — the runner decides

`DQ1`, `DQ2`, `DQ3` (all three levels), `DQ5`, `COV`, and `ENUM` are COMPUTED by
`scripts/checks/ds-dq.py` over every output declared in the approved plan's `## Data Outputs` table.
Each emitted result carries `PASS`, `FAIL`, or `N/A` **plus a reason the runner generated**. You may
quote those reasons. You may not write one.

`DQ4` and `DQ6` are emitted by the runner but are **always `N/A`**, and that is a third category
rather than a quiet pass. DQ4 needs the input → transform → output count chain and DQ6 needs a
before/after shape; the runner sees only the finished artifact and can compute neither. Disposition
both against task-local evidence exactly as you would a model-evaluated check, and never read their
`N/A` as "the runner checked this.

### Model-evaluated — you decide, and you say so

`M1` (approved-plan criterion compliance), `UNI` (universe agreement), `DEN` (every rate states its
denominator), `DEL` (coverage improved because the base shrank), and `R1` (fresh re-run reproducibility)
are **judgements**. The runner enumerates them with the literal status `MODEL-EVALUATED` and computes
nothing for them, precisely so a reader cannot mistake a judgement for a computation. Report them the
same way:

```text
M1  MODEL-EVALUATED — <verdict> — <evidence you actually read>
UNI MODEL-EVALUATED — <verdict> — <evidence you actually read>
```

Never report one of these five as `PASS`. A runner or a report that presents a judgement as computed
recreates the self-certification this beat exists to remove.

## Gate: DS verification complete

1. **IDENTIFY:** the receipt-selected `{planFile, planHash}` and its `## Data Outputs` table. That table
   is the complete list of artifacts under verification. An output not in the table was not planned.
2. **RUN:** execute the runner and capture its exit code:

   ```bash
   uv run --with polars python3 ${CLAUDE_SKILL_DIR}/../../scripts/checks/ds-dq.py \
     --plan <planFile> --project-dir <absolute project path>
   ```

3. **READ:** read the emitted JSON. Do not summarise from the run's absence of errors.
4. **VERIFY:** all four conditions hold —
   - the JSON contains a key for **every** row of `## Data Outputs`, and no output was skipped;
   - every computed check under every output is `PASS` or `N/A`, and each `N/A` carries the reason the
     runner emitted (`"reason_source": "runner"`);
   - `ENUM` is `PASS` for every output — the runner asserts it emitted a line for all thirteen matrix
     checks;
   - `M1`, `UNI`, `DEN`, `DEL`, and `R1` appear as `MODEL-EVALUATED` and each carries your judgement
     with the evidence you read.

   Exit code 0 means no computed check failed. A non-zero exit is a `FAIL`, full stop.
5. **CLAIM:** only then record the round per `beat-verify` with a bare `OVERALL: PASS`, and continue
   immediately to `${CLAUDE_SKILL_DIR}/../ds-accept/SKILL.md`. Verification is not acceptance.

On `FAIL`, capture each failing check as one TaskList finding with the runner's verbatim line, and send
repairs through `${CLAUDE_SKILL_DIR}/../ds-implement/SKILL.md`. Resume this same verifier afterwards;
do not spawn a replacement.

## Facts

- The thirteen checks lived in `ds-implement` with no runner anywhere in `scripts/checks/`, so `ENUM` —
  "every applicable check ran or is N/A with a reason" — was satisfied by the model asserting it had
  enumerated. The runner exists to make that one claim mechanical.
- A pipeline's own SKILL.md said timed runs should include the detector sweep; nothing referenced the
  detector module at all. Once wired, the sweep ran 7 of 17 available detectors, and four of the other
  ten fired immediately. Silence is indistinguishable from a pass.
- An ownership panel applied its universe predicate to the share-count lookup as well as the entity
  selection: 401,002 of 787,178 rows (50.9%) carried a null denominator, and every one had a real
  numerator. `UNI` is model-evaluated because no runner can know where scope was supposed to be decided.
- `DQ3` is three levels, not `df.duplicated()`. An all-columns dup check reports ZERO duplicates after a
  join fan-out, because the fanned rows differ in the joined columns.

## Red flags

| About to | Stop because | Do instead |
|---|---|---|
| Report a DQ result you reasoned out from the code | It is the doer's claim wearing a check's name | Run `ds-dq.py` and quote its line |
| Write your own `N/A` reason for a computed check | That is the ENUM self-certification defect | Quote the runner's `reason`; if it has none, the check is a `FAIL` |
| Report `M1`/`UNI`/`DEN`/`DEL`/`R1` as `PASS` | It presents a judgement as a computation | Report `MODEL-EVALUATED` with the evidence you read |
| Verify an output the plan's `## Data Outputs` never declared | The table is the scope; an undeclared output has no grain or key to check against | Return to planning for a replacement plan |
| Fix a failing check here | This beat has no edit tools and the verifier is never the doer | File the finding and route it to `ds-implement` |
| Treat a clean run with no output rows as a pass | An empty table means nothing was checked | Require a key per declared output before claiming |
