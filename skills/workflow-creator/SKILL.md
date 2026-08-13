---
name: workflow-creator
description: "Use when creating or designing a new multi-phase workflow, including its entry points, phases, gates, constraints, compiler manifest, verification, and human review surfaces. Fresh creation entry; use workflow-creator-improve for audits, redesigns, repairs, or migrations of existing workflows."
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

# Workflow Creator — Fresh Entry

Create a new workflow through the shared-v1 lifecycle. This entry orchestrates; it never directly writes target workflow files.

## Write surface: main chat does not do the work

**You may Write/Edit only under `.planning/` and `.claude/`. Every target workflow file — skills,
hooks, scripts, tests — is written by a dispatched agent.** `orchestrator-mutation-guard` is
registered in this skill's frontmatter, so the attempt is REFUSED, not corrected: a write you try
anyway costs a turn and produces nothing. Reach for `Agent` first, not after a denial. Bash is held
to the same line — only the named read-only checks and compilers are permitted from main chat.

Two narrow exceptions: the generated plan while you are IN Plan mode, and `.claude-workflows.json`
when adopting governance.

## Compatibility boundary

If legacy `.planning/wc/` state exists, stop. Legacy Mode 1/2/3 state, numeric steps, review markers, and HANDOFF files are not resumable or convertible; a shared-v1 marker does not convert them. Start a fresh episode with a new receipt-selected generated plan.

## Shared lifecycle

```text
CLARIFY → planning evidence → native Plan approval → independent plan review
        → deterministic plan compiler → beat-implement → independent workflow-creator-verify verification
        → shared beat-review / HUMAN_REVIEW.md
```

The diagram is authoritative.

## What a workflow IS: a set of constraints, discovered

A workflow is not a phase sequence with a domain glued on. It is **the set of constraints the work
must satisfy**, plus the machinery that decides them. CLARIFY and PLAN are where the constraints are
discovered; every beat after is enforcement. If you cannot list the constraints, you do not yet have
a workflow — you have a shape.

**First-best: a mechanical constraint.** A command with an exit code — tests, linters, compilers, a
schema/lint rule over the plan's own structured fields, an anchored grep. Deterministic, identical
for every agent and every iteration, free to re-run, and it *settles* the question instead of
opening it. These are `mechanicalChecks`.

**Second-best: a lens.** A subagent's subjective reading, scored by the `.js` — `verifyLenses` and
`reviewLenses`. A lens is the fallback for a constraint that is genuinely a judgement. It is
second-best because it is nondeterministic, costs a dispatch, and cannot be re-run to the same
answer.

**The conversion duty.** Every lens stands under one question: why is this not a command? Most
lenses that survive an audit turn out to be mechanical constraints the plan left implicit — "every
acceptance clause names a command", "`writablePaths` contains the artifact", "the deck compiles" are
lint rules wearing a reviewer's clothes. When a lens flags the same *shape* twice, that shape is a
lint rule you have not written yet: write it, and delete the lens. This is `PHILOSOPHY.md`'s
graduation, applied at design time instead of after the failure — a workflow that gets more
mechanical over its life is being maintained; one that grows lenses is drifting.

What remains is the residue that is actually judgement. Keep it few and run it as advisory scoring,
**once**. Never build a loop whose exit depends on a fresh prose critique — it does not terminate,
because the fix for round *n* adds text that round *n+1* finds real new defects in.

**One entry point.** All of a workflow's mechanical checks are reachable from a SINGLE command whose
exit code is the mechanical verdict — one `check` script, one `make check`. The plan names it, the
Manifest's evidence rows call it, and the VERIFY gate runs it. `mechanicalChecks` may list
sub-checks for legibility, but the FIRST entry is that entry point and every other entry's `how`
must be reachable through it. A list of independent commands that a verifier is trusted to run each
of, in order, is a list that quietly stops being run in full — and the check that fell off is
invisible, because nothing reports a check it never knew about.

## Beats 3–5 run as one program: `workflows/work.js`

Beats 3, 4 and 5 run as a single orchestrated workflow rather than three stretches of main-chat
discipline. Two steps, in this order.

**Step 1 — get the authenticated args. One call, and it is not optional.**

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/work-args.ts <abs project> --workflow workflow-creator --session ${CLAUDE_SESSION_ID}
```

It prints `{projectDir, workflow, planPath, planHash}` read from `.planning/.state/review.json` and
re-hashed against the plan's current bytes, or refuses and names the reason — `missing-artifact`
(you have not been through PLAN), `review-pending`, `stale-receipt` (the plan was edited after
approval), or a receipt identity disagreement. **Do not hand-copy `planPath`/`planHash` instead.**
That is the step where a hash gets typed from memory and an unapproved plan gets implemented anyway.

**Step 2 — run the beats, merging in the task list.**

```
Workflow({
  scriptPath: "${CLAUDE_SKILL_DIR}/../../workflows/work.js",
  args: { ...<the JSON from step 1, verbatim>, tasks: [{ id, name, work, writablePaths: [], acceptance }] },
})
```

It returns `{ workflow, planPath, planHash, overallPass, verdict, scoreTable, implemented, verified,
findings, refutedFindings, reviews, tasksThatFlagged, carriedForward, domainRun }`. Render the gate,
drive the fix loop from `findings`, and re-invoke with `onlyChecks: tasksThatFlagged` plus
`priorReviews` to redo them. `onlyChecks` narrows EVERY beat, not just REVIEW: those tasks are
IMPLEMENTED again, so their implementers will edit files. It is a redo, not a re-judge.

**Why a program rather than three beats of instruction.** The beat machinery restrains a free agent:
guards deny reconnaissance, the mutation guard denies main-chat writes, an order gate refuses an
out-of-order wave, a Stop hook refuses a turn end while review is owed. Each exists because the
orchestrator *could* do otherwise. A workflow script has no Write tool and no shell, so delegation is
structural and the beat order is the order of its statements. CLARIFY and PLAN approval stay above,
in main chat and hook-enforced, because both are conversations with a human that a subagent cannot
hold — and `work.js` refuses to start without `planPath` and a 64-hex `planHash`, so it cannot be
used to skip them.

## Adapter — the default shape of a new workflow

**A workflow you create runs on the shared spine. That is the default, and the plan says so in a
required `## Adapter` section.** The bespoke alternative still exists (see *The escape hatch*) but it
is now the exception that has to argue for itself, because six routers that each re-derived
IMPLEMENT → VERIFY → REVIEW were six chances to disagree, and they took them.

### The Manifest is already the spine's input

`work.js` takes `tasks: [{ id, name, work, writablePaths, acceptance }]`. The
`## Workflow Output Manifest` table this skill has always required is that list with extra columns.
Do not invent a second task format; map the rows:

| Manifest column | `tasks[]` field | notes |
|---|---|---|
| `ID` | `id` | also the vocabulary of the spine's `onlyChecks` — see *Where the loop lives* |
| `Kind` + `Path` | `name` | the human label; compose it, there is no Name column |
| `Work` | `work` | |
| `Writable Paths` | `writablePaths` | array. Empty falls back to `adapter.deliverables`, which is broader than any one task should get — so never leave it empty |
| `Criteria` + `Evidence` | `acceptance` | the verifier reads only this. A criterion whose evidence command is not in it is a criterion nobody runs |
| `Depends On` | — | **not passed.** The spine implements sequentially in array order, so emit rows in topological order and the dependency is satisfied structurally |
| `Instruction Files`, `Model`, `Effort` | — | not passed; they configure the dispatched agent, not the spine |

### The `## Adapter` section, with exactly the fields `work.js` validates

Anything else in this section is ignored; anything missing is a refusal. `work.js` collects every
shape problem and throws once, so a malformed adapter costs one round trip, not five.

| Field | Type | What it must say |
|---|---|---|
| `deliverables` | non-empty string | what the plan produces, in the plan's own words |
| `reviewSurfaces` | non-empty string | what the HUMAN will look at in beat 5 |
| `verifyLenses` | non-empty array of strings | what per-task VERIFY judges by — the judgement residue only; anything a command could decide belongs in `mechanicalChecks` |
| `mechanicalChecks` | array of `{name, how}` — **empty allowed, absent refused** | `how` is a COMMAND, not an adjective. `compiles` tells a verifier what to care about and nothing about how to establish it, so it invents a check it can pass. **The first entry is the single entry point; every later entry's `how` must be reachable through it** — see *What a workflow IS* |
| `reviewLenses` | non-empty array of `{key, ask}`, optional `agentType` | a REVIEW phase with no lens reviews nothing and still computes CLEAN, which looks reviewed and is not. Each lens carries its row in the plan's `## Constraints` ledger saying why it is not a command |
| `implementer` | optional agent type | one agent per task. Omit unless a specialised implementer exists |
| `implementWorkflow` | optional `{scriptPath}` | only when the transform is a fan-out — see *When to write a domain `.js`*. Declaring it makes `args.domainArgs` REQUIRED |
| `verifyWorkflow` | optional `{scriptPath}` | same test and the same `domainArgs` requirement, applied to verification |

A workflow you create is **external** to `work.js` — the six-entry `ADAPTERS` table is closed and no
plugin can edit it. So the adapter is passed in `args.adapter`, and passing one for a built-in
identity is refused on purpose: a caller who could hand `dev` a review table could hand it one with
no security lens and still be reported CLEAN.

### IRON LAW: NO DOMAIN WORKFLOW BY BARE NAME — `{scriptPath}` OR NOTHING

`implementWorkflow: 'my-thing'` resolves through the saved-workflow registry, which is
`<project>/.claude/workflows/` and `~/.claude/workflows/` **only**. A workflow shipped in a plugin is
registered as `<plugin>:<meta.name>`, so a script sitting in `<plugin>/workflows/` is not reachable by
its own bare `meta.name` from anywhere. The failure is a throw at the moment of delegation, deep
inside a dispatched run:

```text
workflow('my-thing'): no workflow with that name. Available: …
```

Write `implementWorkflow: { scriptPath: "<absolute path to the .js>" }`, built from the plugin root
the plan already knows. `work.js` renders either form correctly in the progress log and the score
table (`domainWorkflowLabel`), so the ref costs nothing in legibility.

### IRON LAW: NO HAND-ASSEMBLED `args` — ONE SCRIPT EMITS THE WHOLE ENVELOPE

The plan must name a **pre-step script** that emits the complete `args` object, and the skill must
call it. Not a documented shape the caller assembles; a script that prints the object.

- The AUTHENTICATED half (`projectDir`, `workflow`, `planPath`, `planHash`) comes from the published
  `beat-spine-args` capability, which re-reads the receipt and re-hashes the plan's **current** bytes.
  A plan edited after approval must fail as a stale receipt, not be implemented under a hash that no
  longer describes it.
- The DOMAIN half (`adapter`, `domainArgs`) is computed in the same script, from one table keyed by
  artifact type.

**As of v5.149.0 the spine REFUSES this rather than absorbing it.** Declaring `implementWorkflow` or
`verifyWorkflow` makes `domainArgs` REQUIRED: absent, `work.js` throws, naming both fields, what
those workflows need, and the remedy. Before that fix it was a *silent skip* — the domain workflow
never ran, the generic per-task path ran instead, and the gate reported CLEAN over work a route
nobody reviewed produced, with no score-table row for the delegation that was never attempted. The
refusal is why the envelope must be computed rather than described: a plan that cannot produce
`domainArgs` no longer fails quietly at runtime, it fails loudly, and it should have failed at PLAN.

**Point authors at a thing that runs.** `~/projects/teaching/scripts/spine-args.ts` is the working
reference for this pre-step: ONE script emitting the complete args object including `adapter` and
`domainArgs`, with `verifyWorkflow: {scriptPath}`, both `onlyChecks` vocabularies kept in separate
namespaces, and an `import.meta.main` guard so importing it does nothing. Its tests are green. Do
**not** copy `writing` — see *Facts*.

### Declaring a domain workflow: three things, or do not declare it

For EACH `implementWorkflow` / `verifyWorkflow` the plan declares, the `## Adapter` section must
state all three. A declaration missing any one of them is not executable and must not be written.

| Must state | Concretely | What it forecloses |
|---|---|---|
| **Ref form** | `{ scriptPath: "<abs path>" }`, and one line on why a bare name is wrong here | a domain workflow referenced by a name that does not resolve |
| **Pre-step** | the exact command that produces this workflow's `domainArgs`, by path | a domain workflow declared but never invoked because its inputs were never threaded |
| **Named fields** | the field names that pre-step emits — the actual list, e.g. `sectionIndex`, `projectReal`, `artifacts` — not "its inputs" | a SKILL whose code block cannot produce the args its own prose requires |

**If the plan cannot name the pre-step, the workflow must not be declared.** Drop the declaration and
let the adapter's per-task agents do the work. That single check is what would have caught all three
failure modes above, each of which shipped, each of which was a declaration nobody could execute.
Naming the pre-step is cheap at PLAN time and is the only moment the omission is visible: after
approval it is a throw inside a dispatched run, or — before v5.149.0 — a clean gate over nothing.

### Where the loop lives, and the two `onlyChecks` vocabularies

**`work.js` runs ONE pass.** It does not iterate. Selective re-run is the caller's: re-invoke with
`onlyChecks: tasksThatFlagged` (spine TASK IDS) plus `priorReviews` for the rest. `onlyChecks`
narrows EVERY beat, not just REVIEW — those tasks are IMPLEMENTED again and their implementers edit
files. It is a redo, not a re-judge, and `priorReviews` is the only thing carrying the other tasks'
results forward. A domain that genuinely iterates — diagnose → fix → re-diagnose — owns that loop in
its entry skill, around the spine, not inside it.

A domain workflow may carry its OWN `onlyChecks` vocabulary, and it is a different set of strings:

| Level | Lives at | Vocabulary | Example |
|---|---|---|---|
| Spine | top-level `args.onlyChecks` | task IDs from the Manifest `ID` column | `["t2"]` |
| Domain | inside `args.domainArgs` | whatever that script defines | `["20:tm-fidelity"]` (`notes-diagnose.js` uses `"NN:check"` pairs) |

`work.js` forwards `domainArgs` **unread**, so nothing downstream catches a swap. Put a spine ID in
the domain list and the domain re-runs nothing while reporting success; put a domain pair in the
spine list and the spine implements nothing. Either way `priorReviews` carries forward results for
work that was silently never redone. The pre-step script is the one place both are threaded, so it
is the place to keep them in separate namespaces and reject a value that looks like the other one.

### When to write a domain `.js` — and when the adapter alone is the implementation

**Default: no script.** The adapter's per-task agents ARE the implementation. One `agent()` per
Manifest row, bounded by that row's `Writable Paths`, verified against that row's `Criteria`.

Write an `implementWorkflow` or `verifyWorkflow` script only when the transform is genuinely **a
fan-out with its own gate over its own authenticated index** — expanding N section outlines into
prose, rendering a Slide Spec into a deck, running five reviewer lenses per lecture and computing a
composite from raw counts. The test is whether re-expressing it as Manifest rows would LOSE
structure. If it would merely be longer, it is not a fan-out; it is a task list, and the spine
already runs task lists.

Minting a script per workflow by reflex is how a shared spine becomes six spines again, one
delegation at a time.

### The escape hatch: a bespoke spine, with the reason written down

A workflow may still emit its own phase machine instead of calling `work.js`. The plan must then
carry, in the `## Adapter` section, **a written justification naming the specific property of the
shared spine that does not fit** — not "the domain is unusual". Candidates that have actually held:
the domain needs human sign-off mid-run (a workflow script cannot hold one), or its phases are not
IMPLEMENT → VERIFY → REVIEW at all.

This path is kept because `work.js` has three successful runs of evidence and no more. Betting every
generated workflow on it would be the same mistake as retiring working machinery for an unproven
replacement — which is the mistake this whole lifecycle exists to prevent.

### Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Write `implementWorkflow: 'name'` | The registry is `.claude/workflows/`; plugin scripts register as `<plugin>:<name>` and no bare name reaches them | `{ scriptPath: "<abs>" }` |
| Document the `args` shape in the skill for the caller to assemble | A hash gets typed from memory and `domainArgs` gets forgotten; the spine now throws, and before v5.149.0 it skipped the delegation in silence | One pre-step script emits the whole envelope |
| Declare a domain workflow whose pre-step you cannot name | The declaration cannot be executed by anyone, including you | Drop the declaration; per-task agents do the work |
| Emit a domain `.js` for a workflow whose tasks are just tasks | That is six spines again | Per-task agents under the adapter |
| Put a `"NN:check"` pair in top-level `onlyChecks` | Two vocabularies, two levels; the spine implements nothing and `priorReviews` carries forward unjudged work | Domain pairs go in `domainArgs` |
| Loop inside the plan's spine call | `work.js` runs one pass | Loop in the entry skill, re-invoking with `onlyChecks` + `priorReviews` |
| Choose a bespoke spine because it feels cleaner | The shared spine's enforcement is structural — no Write tool, no shell, beat order is statement order | Justify in writing which spine property does not fit, or adopt it |
| Add a lens for something an exit code could decide | A lens is nondeterministic, costs a dispatch, and re-opens the question every run | Write the lint rule; put it behind the single mechanical entry point |
| List N mechanical commands with no single entry point | The one that falls off the list is invisible — nothing reports a check it never knew about | One `check` command; `mechanicalChecks` entries reachable through it |
| Loop until a prose reviewer stops finding defects | Non-terminating: each fix grows the surface the next round reviews | Loop on the mechanical gate; run lenses once, advisory |

### Facts

- Measured 2026-08-06: the `writing` adapter is the most complete entry in `work.js`'s table —
  `implementWorkflow: 'writing-draft'` AND `verifyWorkflow: 'writing-verify'` — and **has never run**.
  All three failure modes at once. Its refs are bare names that resolve nowhere (plugin workflows
  register as `<plugin>:<meta.name>`, and no `.claude/workflows/` exists in the repo). Its SKILL
  mentions `domainArgs` in prose but its step-1 script emits only the four authenticated fields, so a
  caller following it produces `domainArgs: undefined`. And the fields those workflows actually need
  — `sectionIndex`, `projectReal`, `artifacts`, all from `writing_section_index.py --authenticate` —
  are named nowhere in the SKILL at all. Declaration was mistaken for conversion because nothing
  between the two was checked. Copy `teaching/scripts/spine-args.ts`, not this.
- The silent skip was fixed in v5.149.0; the bare names were NOT fixed at the same time and are still
  live in `writing`, `workshop` and `workflow-creator`'s own `verifyWorkflow`, plus three
  `Workflow(name=…)` call sites in the workshop skills. So a plan reviewer cannot assume the shipped
  adapters model the rule — read this section, not the table.
- `work.js` refuses `args.adapter` for a built-in identity and REQUIRES it for an external one. The
  asymmetry is the security property, not an inconsistency.
- An empty `mechanicalChecks: []` is a statement that the domain has no toolchain. An absent key is
  an omission nobody can tell apart from a forgotten one, and is refused.

## 1. CLARIFY

**Write no sentinel.** `.planning/WC_CLARIFIED.json` is retired — a hook records the clarify phase
into `.planning/.state/episode.json` when it observes your `AskUserQuestion` call, which is evidence
rather than self-assertion. Reconnaissance unlocks when that phase is recorded. Initialize:

```yaml
---
workflow: workflow-creator
lifecycle: shared-v1
entry: fresh
phase: clarify
target: pending
---
```

Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md`. Ask in one batched interaction:

- workflow outcome and target repository/plugin;
- fresh and corrective entry behavior;
- phase responsibilities and common failure modes;
- **the constraints — what must be true of the output for it to be done.** Elicit these as a list,
  not as adjectives, and for each one ask what command would decide it. A failure mode the user
  names is a constraint; a constraint with a command is mechanical, and one without is a lens
  candidate that must argue for itself at PLAN;
- which existing toolchain already decides some of them (test runner, linter, compiler, schema);
- mutation owners and required outputs;
- verification commands and human review surfaces;
- explicit exclusions and completion evidence.

Nothing is written after the user answers: the observed phase is the evidence. Only then inspect the target and build planning evidence.

**Gate:** the clarify phase is recorded in `.planning/.state/episode.json`, and outcome, entries,
phase responsibilities, the constraint list with each constraint marked mechanical-or-lens, mutation
owners, verification commands, review surfaces, exclusions, and completion evidence are all
explicit.

## 2. PLAN

Read `${CLAUDE_SKILL_DIR}/../beat-plan/SKILL.md`. Create an executable native plan containing:

- intent, exclusions, target slug, and no-legacy policy;
- fresh/corrective entries and ordered internal phases;
- a canonical `## Workflow Output Manifest` table with columns:

```text
ID | Kind | Path | Depends On | Work | Criteria | Evidence | Writable Paths | Instruction Files | Model | Effort
```

- a required `## Constraints` ledger — one row per constraint discovered in CLARIFY:

```text
Constraint | Kind (mechanical|lens) | Decided by | Why not mechanical
```

  `Decided by` is a COMMAND for every mechanical row, and the name of the `verifyLenses` /
  `reviewLenses` key for every lens row. `Why not mechanical` is empty for mechanical rows and, for a
  lens row, must name the specific judgement no exit code can make — "quality", "correctness" and
  "it's subjective" are not answers, and a row that cannot fill this column is a lint rule that has
  not been written yet. The ledger names the **single mechanical entry point** and every mechanical
  row is reachable through it. Every `mechanicalChecks`, `verifyLenses` and `reviewLenses` entry in
  the `## Adapter` section traces to exactly one ledger row, and vice versa;

- a required `## Adapter` section — see **Adapter — the default shape of a new workflow** above for
  the exact fields, the Manifest → `tasks[]` mapping, and the two `onlyChecks` vocabularies. A plan
  that omits it is not executable. A plan that opts OUT of the shared spine still carries the section
  and uses it to name which spine property does not fit;
- exact hooks, scripts, and review artifacts;
- the single mechanical entry point, by path, and the compiler/check commands behind it;
- independent semantic verification and human Review Surfaces.

Every row is a complete task specification. No duplicate IDs or outputs, unsafe paths, globs, directory authority, missing evidence, or undeclared dependencies.

Enter native Plan mode only when this manifest is executable. `ExitPlanMode` binds exact approved generated bytes to a hook-owned receipt. Never edit a selected generated plan or `.planning/.state/review.json` directly.

Read `${CLAUDE_SKILL_DIR}/../workflow-creator-plan-reviewer/SKILL.md` and dispatch the independent plan checker. Issues return to native Plan mode for fresh approval.

**Gate:** the receipt-selected `planFile` and `planHash` are `APPROVED` for workflow
`workflow-creator` by a distinct reviewer session, the Workflow Output Manifest compiles with no
duplicate IDs or outputs, unsafe paths, globs, directory authority, missing evidence, or undeclared
dependencies, the `## Constraints` ledger covers every adapter check and lens one-for-one with a
command on every mechanical row and a named judgement on every lens row, and the `## Adapter` section
is present with the five required fields — or, if the plan opts out of the shared spine, with the
written justification naming the spine property that does not fit.

## 3. IMPLEMENT

In a distinct implementation session:

1. Set `phase: compile` in `ACTIVE_WORKFLOW.md`.
2. Run the read-only compiler:
   ```bash
   bun ${CLAUDE_SKILL_DIR}/../../scripts/wc/workflow-plan-compiler.ts ".planning/<receipt-selected-planFile>" --project "<absolute target root>" --json
   ```
3. Parser/compiler failure blocks. There is no LLM, Python, or legacy enumeration fallback.
4. Pass the returned `readyWave` and immutable plan identity to `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md` with `workflow: "workflow-creator"`.
5. Set one budgeted `/goal` pinned to compiler success, all implementation records, focused checks, independent verification, and human review.
6. Main chat may read results and update planning state; only delegated implementation agents mutate target files.

**Gate:** the compiler succeeded on the authenticated plan identity, every manifest row has a
completed implementation record produced by a delegated agent, and exactly one budgeted `/goal` is
active.

## 4. VERIFY

Read `${CLAUDE_SKILL_DIR}/../beat-verify/SKILL.md`. Set `phase: verification`. **First run the deterministic compliance probe**, and pass its command as one of the required mechanical probes:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/wc/compliance-probe.ts --target "<plugin repo root>"
```

It checks three CONFIGURATION properties no reviewer agent can hold, because the characteristic way to get each one wrong is to measure the reference instead of the mechanism: every workflow reaches every beat; every hook file is registered on some matcher; every hook that fails open has a gate that treats its silence as failure. Exit 1 with findings is a blocking result.

**Point `--target` at the plugin under audit, including this one.** `workflow-creator` is a meta workflow, so it must be able to audit the workflows plugin itself — an auditor that only inspects generated workflows catches the next workflow's version of a defect and never its own host's, and every defect this probe encodes was in the host. `tests/compliance-probe.test.mjs` runs it against this repo on every test run, with an asserted `KNOWN_FINDINGS` registry.

Then invoke `workflow-creator-verify` with the deterministic compiler manifest and required mechanical probes. It is read-only and independently verifies architecture, enforcement, paths, hooks, and the approved criteria. A composite score is diagnostic only; completion requires no blocking finding and every evidence row passing.

Failures re-enter `/workflow-creator-improve`; retries preserve approved plan identity and only re-run proven attempted work.

**Gate:** the compliance probe exits 0, the created workflow's single mechanical entry point exits 0
on its own repo, `workflow-creator-verify` returns no blocking finding, and every evidence row passes
on the command the plan named for it.

## 5. REVIEW

After independent PASS, set `phase: human-review`, read `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`, present the diff and any rendered surfaces named by the plan, and record dispositions in `.planning/HUMAN_REVIEW.md`.

Tactical feedback routes through `/workflow-creator-improve`. `REJECT:` invalidates the criteria and returns to CLARIFY.

**Gate:** every disposition is recorded in `.planning/HUMAN_REVIEW.md`, the final review relaunch has
no new annotations, and no `REJECT:` remains.

## Iron laws

- A constraint a command can decide is never delegated to a lens.
- Every mechanical check is reachable from one entry point, and that entry point is what the gate runs.
- No task reconnaissance before clarification.
- No implementation without exact approved-plan identity and independent current-hash review.
- No direct main-chat mutation of target workflow artifacts.
- No fallback enumerator when the compiler rejects the manifest.
- The verifier is never the implementer.
- Automated PASS is not human acceptance.
