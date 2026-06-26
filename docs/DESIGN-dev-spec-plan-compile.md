# DESIGN: `spec → plan → compiled run.js` for the dev workflow

Status: **SIGNED OFF 2026-06-26 ("go").** Decisions resolved to the recommended options:
D-dev-1 = sequential v1, D-dev-2 = **hybrid** cadence, D-dev-3/4/5/6 as recommended.

**Parity harness confirmed live (hylo-parity, 2026-06-26):** the hylo `browserStore` slice has a clean
RED→GREEN today via `node --test` (node 24 strips TS, shims `window`+a Map-backed `localStorage`,
`isTauri()→false` so it runs the real browserStore path; test imports repo source read-only). 3 pass
(CRUD round-trip, scoped delete, list-by-file) / 1 RED canary: `readwiseSync result carries the document
title` fails (`got: 1`) because `browserStore.readwiseSync(file)` drops its 2nd arg — goes GREEN only by
changing the signature to `(file,title)`, i.e. the §4.3 **gate-changing R4** worked example, live and
runnable. **Type-sensitivity trap to encode in the gate (hylo finding):** `Highlight.id` is a *string*;
a Verify Command fed mistyped fixtures (numeric id) manufactures a *phantom RED* that "goes GREEN" for
the wrong reason — the implementer prompt MUST require the RED to fail because the BEHAVIOR is absent,
not because of a fixture/type bug (see §3.4).
Companion to `docs/DESIGN-ds-spec-plan-compile.md` (the proven first instance) and
`docs/ds-generalization-assessment.md` (which says: **port dev next** — closest sibling, same
exit-code gate, existing table, existing guard; highest-value proof the core is not ds-specific.
Extract the shared core *after* dev, not before.)

---

## 0. TL;DR

Do to **dev** exactly what was done to **ds**: replace the generic interpreter
(`dev-implement.js` re-parses `PLAN.md` with an LLM "discovery" agent **once per dependency level**,
runs one level, then a heavyweight read-only verifier) with a **deterministic compiler + a per-plan
compiled runner**:

```
SPEC ──▶ PLAN ──▶ [dev-compile: deterministic, no LLM] ──▶ .planning/run.js ──▶ Workflow(run.js)
 (gated)  (gated)                                          (lean, project-specific)
```

This is a **second concrete instance**, deliberately built parallel to ds (its own
`scripts/dev/` parser+compiler, its own `dev-run-template.js`) — **NOT** a shared `run-core`
extraction. The assessment is explicit: one instance picks the wrong seams; port dev as a 2nd
exit-code domain first, *then* extract the genuine core empirically.

Three wins, same as ds:

1. **Zero discovery-LLM calls.** The Implementation Order table is already regex-parseable; a new
   `scripts/dev/dev_plan_table.py` (the tolerant parser) replaces the discovery agent. The compiler
   inlines the task DAG as a literal into `run.js`.
2. **One topo-run across the whole DAG, not N level round-trips.** The skill currently re-invokes the
   workflow once per level; the compiled runner walks every level in one invocation, pausing only at
   decisions / R4 blocks.
3. **Cheap, honest gate.** A single cheap probe agent runs each task's `Verify Command` and reports
   the real exit code (+ that the declared Files/test exist). The heavyweight re-analysis verifier is
   deleted.

**The dev twist (TDD).** dev's implementer is **failing-test-first**: write the test, see RED, write
code, see GREEN. This is a *variant of ds's output-first*, **not a new gate type** — the gate is still
an exit code. Concretely: dev's "artifact present" check (ds's `outputsPresent`) becomes
**`testPresent` + `filesPresent`** (the failing test and the declared files actually exist), and the
implementer prompt carries the RED→GREEN protocol. Nothing about the driver/pause/probe machinery
changes shape.

**What does NOT change:** explore / clarify / design / plan-review stay conversational and
human-gated; the **full test suite** + **`dev-test-gaps`** + **`dev-review`** stay the adversarial
ground-truth layer **OUTSIDE** `run.js` (the ds lesson: the JS gate caught zero bugs; the deviation
note + adversarial review did). The hook-enforced phase gates (`PLAN_REVIEWED.md` APPROVED,
`VALIDATION.md` validated) are preserved.

---

## 1. Audit findings (current state)

### 1.1 `workflows/dev-implement.js` (~234 lines) — the generic interpreter

Four phases per invocation, **once per dependency level** (the skill loops):

| Phase | What it does | Cost / problem |
|-------|--------------|----------------|
| **Discover** | An LLM agent (`sonnet`) reads `PLAN.md`, re-parses the Implementation Order table into `{num,deps,files,failingTest,verifyCmd,implements,done,taskText,interfaces}`, parses `## Global Constraints`, computes topo levels, picks `levelToRun`. | **Redundant + fragile** — pure regex (see §1.4). Re-run every level. The discovery LLM silently tolerates plan/guard format drift (the ds disease). |
| **Transform** | One `dev-implementer` per task **in the level, sequential** (each writes the shared tree in turn); TDD test-first; runs the per-task `Verify Command`. | The implementer is the real work and must stay. Sequential-within-level is intentional (shared tree, no worktree-merge in v1). |
| **Verify** | A **second** LLM agent (`sonnet`) per task, read-only, checks `testPresent` + `verifyReproduced` (the tree backs the self-report). | **Double-work** that re-derives a gate the exit code already gives — but it *does* encode a real concern (test actually written, not faked). That concern moves into the probe's `testPresent`. |
| **Gate** | Pure JS: `pass = implemented && tested && verified`. | Correct shape — keep. **But the wc-audit found its inputs are NOT a real exit code:** `verified = tr.verifyPassed===true && v.verifyReproduced!==false` — `verifyPassed` is a boolean the *implementer types*, and `verifyReproduced` is a *non-executing* corroboration (it checks files-present, never re-runs the command). So despite the meta claiming "real exit codes, not self-judgment", **no component ever runs the Verify Command into the gate.** The probe (§3.3) makes that claim true for the first time — this is the single highest-value fix, not a mere simplification. |

Returns `{ overallPass, level, levelTasks, levelsTotal, tasksRemaining, tasks, findings,
tasksThatFailed, reviews }`. The **skill** drives the level loop, runs the **full suite** between
levels, marks `[x]`, and re-invokes with `onlyChecks` + `priorReviews`. The workflow never decides the
phase is "done".

### 1.2 The skill chain (`skills/dev-implement/SKILL.md`, ~688 lines)

`dev` (explore) → `dev-clarify` → `dev-design` (+ `dev-plan-reviewer`) → **`dev-implement`** →
`dev-test-gaps` → `dev-review` → `dev-verify`. Only `dev-implement` drives `dev-implement.js`; it
becomes a **thin compile→run/pause runner** (§5). Everything that catches real bugs — the full suite,
`dev-test-gaps` (requirement-level coverage), `dev-review` — stays **outside** `run.js`, unchanged.

### 1.3 Key discovery: the parse is already deterministic

The discovery agent's entire job — split the table, parse `Deps` (`---`→[], `after N,M`→[N,M]), read
`done`, topo-sort, lift `## Global Constraints` and `## Task Interfaces` `### Task N` blocks — is
regex. `hooks/dev-plan-executable-guard.py::find_task_table()` **already** does the table split + DAG
+ cycle check with no LLM. The discovery agent is 100% replaceable by deterministic code we mostly
already have. **This is the linchpin: `dev-compile` is a script, not an LLM step.**

### 1.4 The guard/plan format-drift gap (the ds disease, confirmed for dev)

`hooks/dev-plan-executable-guard.py` requires task ids matching `^(\d+)\.` and deps matching
`^---$` or `^after\s+([\d,\s]+)$`. The plan-template uses exactly that (`0.`, `1.`, `after 0`), so
dev's drift is *narrower* than ds's `**T1**`/em-dash mess — but the structural risk is identical: the
discovery LLM bridges any divergence the guard would otherwise block, so the guard's strictness is
**invisible** as long as an LLM re-parses. The fix is the same: a single **shared tolerant parser**
(`dev_plan_table.py`) that BOTH `dev-compile` and the guard import, so "compiles" ⇔ "passes the gate".
(The audit subagent is checking whether any *real* reviewed dev plan drifted from `N.`/`after N`; if
so it is logged, not silently tolerated.)

### 1.5 Hard runtime constraint (same as ds)

Workflow scripts have **no filesystem/Bash access** — only `agent()`, `parallel()`, `pipeline()`,
`log()`, `phase()`, `args`, `return`. Therefore: implementers MUST be `agent()` calls (so `run.js` is
a Workflow script run via `Workflow({ scriptPath })`), and the gate is a **cheap probe agent** that
runs the `Verify Command` and reports exit code + tail (we cannot `exec` in-JS). Identical to ds.

---

## 2. The task-spec schema (the compile target)

`dev-compile` parses `PLAN.md` into task specs and inlines them into `run.js`. Columns differ from ds
(this is **per-domain seam #1**):

| dev column | spec field | parse rule |
|------------|-----------|-----------|
| `Task` | `id` | leading int `N.` (canonical key `"N"`); `[x]` anywhere in cell → `done` |
| `Deps` | `deps` | `---`/`—`/empty → []; `after N,M` / bare `N, M` → `["N","M"]` |
| `Files` | `files` | split on `,` |
| `Failing Test` | `failingTest` | verbatim; `N/A` → none-required |
| `Verify Command` | `verify` | verbatim; exit 0 = pass (the gate) |
| `Implements` | `implements` | split on `,` |

Plus two **section** parses dev needs that ds lacks (per-domain seam, but deterministic):

- `## Global Constraints` → `globalConstraints` (verbatim body) — a **PROJECT-level** constant
  injected into *every* implementer prompt.
- `## Task Interfaces` → per-task `interfaces` (the `### Task N` Consumes/Produces sub-block) —
  injected into that task's implementer prompt only.

Compile-derived fields:

```js
{
  id:"2", name:"Service method", deps:["1"], files:["src/auth/service.ts","…test.ts"],
  failingTest:"test_validate_session()", verify:"pytest tests/test_auth.py -v",
  implements:["AUTH-01","AUTH-02"], done:false, pauseAfter:null,
  interfaces:"- Consumes: src/auth/types.ts (Session)\n- Produces: validateSession(...)",
  taskText:"<full row>",
  // NO tier/effort heuristic — see D-dev-5: dev implementers inherit the session model.
}
```

**No new required PLAN columns.** Global Constraints + Task Interfaces are already
recommended-optional sections (plan-template §); absence parses fine. `pauseAfter` is read from an
optional `⏸ PAUSE:` marker (rare for dev — see §4) so existing plans compile unchanged.

---

## 3. The template (`workflows/templates/dev-run-template.js`)

`dev-compile` fills four holes — `/*__META__*/`, `/*__PROJECT__*/`, `/*__TASKS__*/`,
`/*__GLOBAL_CONSTRAINTS__*/` — and writes `.planning/run.js`. The template carries the protocol; the
compile output carries the data. Built parallel to `ds-run-template.js`, diverging only at the three
seams (columns, `implementerPrompt`, `gateProbe`).

### 3.1 Driver — **sequential within level**, across the whole DAG (per-domain seam #4 / D-dev-1)

ds runs each level's tasks via `parallel()` because ds tasks write **disjoint parquet outputs** and
share no test runner. dev tasks write a **shared working tree** (no worktree isolation in v1) and
share test infrastructure, so v1 runs a level's tasks **sequentially** (a `for`-await loop) — exactly
matching today's `dev-implement.js`. The win is still real: the **whole DAG runs in one invocation**
(not N skill round-trips), pausing only at decisions/R4.

```js
const levels = toposort(TASKS)
const state = {}
for (let li = 0; li < levels.length; li++) {
  const todo = levels[li].map(id => byId[id]).filter(t => REVERIFY_DONE || !t.done || (ONLY && ONLY.has(t.id)))
  const results = []
  for (const t of todo) results.push(await runTask(t))   // SEQUENTIAL: shared tree, write in turn
  for (const r of results.filter(Boolean)) state[r.id] = r
  const blocked = results.find(r => r && r.impl && r.impl.status === 'blocked')
  if (blocked) return collect(state, { paused:true, pauseKind:'R4', atTask:blocked.id, payload: pausePayload(blocked, …) })
  const failed = results.find(r => r && !r.pass && !(r.impl && r.impl.status === 'blocked'))
  if (failed) return collect(state)                       // hard gate failure → skill's fix loop
  const gate = results.find(r => r && !r.skipped && byId[r.id].pauseAfter && !CLEARED.has(r.id))
  if (gate) return collect(state, { paused:true, pauseKind:'decision', atTask:gate.id, payload: … })
}
return collect(state, { done:true })
```

### 3.2 `runTask` — gate-first (TDD: RED→GREEN), output-first, idempotent

```js
async function runTask(t) {
  // 1. Idempotent short-circuit (resume): a NOT-done task whose Verify already exits 0 AND whose
  //    declared files + test already exist is genuinely complete — skip the implementer.
  if (!(ONLY && ONLY.has(t.id))) {
    const probe = await gateProbe(t)
    if (probe.exit0 && probe.filesPresent && probe.testPresent) return { id:t.id, impl:null, gate:probe, pass:true, skipped:true }
  }
  // 2. Implement — TDD test-first. Model: INHERIT the session model (omit), per D-dev-5.
  const impl = await agent(implementerPrompt(t), { label:`task:${t.id}`, phase:'Implement', schema: TRANSFORM_SCHEMA })
  if (!impl || impl.status === 'blocked') return { id:t.id, impl, gate:null, pass:false }
  // 3. Authoritative gate — fresh independent probe: real Verify exit code AND test+files exist.
  const gate = await gateProbe(t)
  return { id:t.id, impl, gate, pass: !!gate.exit0 && gate.testPresent !== false && gate.filesPresent !== false && impl.verifyPassed === true }
}
```

The TDD "RED before impl" lives in the implementer prompt (§3.4); the driver does not separately gate
on RED, because a not-yet-done task's `Verify Command` is naturally non-zero (test missing/failing) —
which is exactly what makes the gate-first short-circuit *fail to skip* and triggers the implementer.
This is the brief's "variant of output-first, not a new gate type."

### 3.3 `gateProbe` — cheap, separate, honest (TDD-aware)

```js
async function gateProbe(t) {
  // run ONLY the Verify Command; then independently confirm the declared Files exist AND
  // (unless Failing Test is N/A) the failing test file exists — the dev analog of ds outputsPresent.
  return agent(
    `Run EXACTLY this command from ${PROJECT} and report. Do NOT create/edit/fix/analyze — only run + report.
     ${t.verify}
     Then independently confirm: each declared file exists & non-empty: ${t.files.join(', ')};
     ${t.failingTest !== 'N/A' ? `the failing test '${t.failingTest}' exists in the tree` : '(no test required — N/A)'}.
     Return { exit0, filesPresent, testPresent, tail:"<last ~25 lines, proof>" }.`,
    { label:`gate:${t.id}`, phase:'Gate', schema: GATE_SCHEMA, model:'haiku', effort:'low' })
}
```

- Separate process from the implementer → catches "claimed GREEN, wrote nothing / faked the test".
- `testPresent` absorbs the old read-only Verify phase's core check; `filesPresent` mirrors ds.
- **Deep fake-test detection (`.skip()`, mock-only, doesn't exercise code) stays OUTSIDE `run.js`** —
  it is `dev-test-gaps` + `dev-review` (§3.5). The probe is the cheap deterministic gate, not the
  semantic authority. (ds doctrine: adversarial layer outside the runner.)

### 3.4 `implementerPrompt` — TDD, Global Constraints, Interfaces, stale-gate backstop

Carries, baked into the template so generated scripts can't drift:
- **TDD protocol** (RED→GREEN), the dev-tdd Iron Law, no `any`/`@ts-ignore`/suppression.
- **Global Constraints** (injected verbatim — binds every task).
- **This task's Interfaces** (Consumes/Produces boundary).
- **R4 = architectural** (new DB table, schema change, new service, lib swap, breaking API): set
  `status:"blocked"`, put the decision + impact in `deviations` — **never** silently make it.
- **STALE-GATE BACKSTOP** (the two-kinds-of-decision finding, §4.3): if a human decision changes the
  **Verify Command itself** (e.g. an API signature) but the row's `Verify Command` still encodes the
  old contract, do NOT bend the code to pass the stale gate — re-block and state the Verify must be
  updated + recompiled.
- **summary MUST carry key numbers**: the test result (`N passed / M failed`), files touched, SPEC
  IDs. The dev analog of ds's row-count rule — this is the human's catch-channel at every pause.
- **No phantom RED** (hylo finding): the failing test must go RED because the *behavior under test is
  absent*, NOT because of a fixture/type bug (e.g. a numeric id where `Highlight.id` is a string makes
  `delete(file,'1')` miss `id:1` — a false RED that "goes GREEN" by fixing the fixture, not the code).
  The implementer must confirm the RED is for the asserted behavior before writing code; a test that
  passes by correcting its own fixture implemented nothing.

### 3.5 Baked-in honesty invariants (why generated scripts stay honest)

- Gate = the probe's reported `exit0` + `testPresent`/`filesPresent`, never the implementer's word.
- Output-first / test-first: produce the test + code, then the probe asserts.
- Uniform result schema (`overallPass`, `tasksThatFailed`, `findings`, `reviews`, `scoreTable`,
  `tasksRemaining`) — identical shape to today's return, so the skill's rendering is unchanged.
- `pause()` is the only yield to a human.
- The full suite, `dev-test-gaps`, `dev-review` are NOT folded into the probe — they stay the skill's
  adversarial ground-truth.

---

## 4. Pause / resume protocol (identical machinery to ds)

| Kind | Trigger | Maps to |
|------|---------|---------|
| **declared** | a task carries `⏸ PAUSE:` (rare for dev — most dev decisions emerge at impl) | `decision` checkpoint |
| **dynamic** | an implementer returns `status:"blocked"` (R4 architectural) | `decision` checkpoint, runtime |

`pause()` is a **structured early return**; the script is a pure function of `(compiled DAG,
args.decisions, on-disk tree state)`. The **skill** presents `payload`, gets the decision, and
re-invokes `Workflow({ scriptPath, resumeFromRunId, args:{ decisions, clearedPauses } })`. Two resume
layers compose: `resumeFromRunId` (fast in-session cache) + the gate-first short-circuit (robust to
recompiles / fresh sessions — already-built tasks pass their probe and skip).

### 4.3 Two kinds of R4 decision (carried verbatim from ds)

- **Gate-changing** (the decision changes the `Verify Command` itself — e.g. *the `readwiseSync`
  signature should be `(file, title)` everywhere*, which changes what the test asserts): the decision
  MUST be edited into `PLAN.md` (the `Verify Command` + affected `Files`/`Failing Test` cells) and
  **recompiled**. `args.decisions` alone is insufficient; the implementer correctly RE-BLOCKS on the
  stale gate. (This is exactly the hylo `api.readwiseSync(file,title)` vs `browserStore.readwiseSync(file)`
  canary — a signature decision that reshapes the test, not a silent fix.)
- **Behavior-only** (a choice the `Verify Command` doesn't assert — gate unchanged): resume via
  `args.decisions[atTask]`; no PLAN edit.
- **Backstop:** a mis-routed gate-changing decision fails LOUD (the implementer re-blocks), never
  silent. Codified in the template's STALE-GATE BACKSTOP clause + the skill's resume routing.

---

## 5. `dev-implement.js` retires; the skill drives compile→run/pause

The skill changes from "drive a per-level loop, run the full suite between levels" to "compile once,
then run/pause, then full-suite + test-gaps once":

```
0. /goal: All PLAN tasks [x], each Verify Command exits 0, full suite green, VALIDATION.md=validated. (unchanged)
1. COMPILE (once, deterministic, no LLM):
     dev_compile.py .planning/PLAN.md --project "$(pwd)"  →  .planning/run.js   (re-run only when PLAN changes)
LOOP under /goal:
2. r = Workflow({ scriptPath:".planning/run.js", resumeFromRunId?, args:{ projectDir, pluginRoot, decisions, clearedPauses, onlyChecks? } })
3. if r.paused: present r.payload (decision + deviations + test numbers); get the call;
     - gate-changing (signature/contract change) → edit PLAN.md's Verify Command (+ Files/Failing Test) → recompile (step 1) → resume
     - behavior-only / declared-approved → add atTask to clearedPauses, decisions[atTask]=answer → resume
     - architectural R4 the user must design → hand back to dev-design, then recompile
4. if r.done && r.overallPass:
     - GROUND-TRUTH (outside run.js): run the FULL suite + lint; then dev-test-gaps (VALIDATION.md);
       then mark PLAN rows [x], progress.md ledger, LEARNINGS.md → dev-review
5. if r.done && !overallPass: read r.findings, fix, re-invoke with onlyChecks=r.tasksThatFailed
```

**Full-suite cadence (D-dev-2):** today the skill runs the full suite *per level*; the compiled
runner collapses levels into one invocation, so the full suite runs **once after `overallPass`**
(the ds-validate-coverage cadence). Each task's own `Verify Command` still gates per-task inside the
runner; the once-at-end full suite catches cross-level regressions, and a regression routes to the
`onlyChecks` fix loop. (Trade-off: a cross-level regression surfaces at end-of-DAG, not mid-DAG. See
D-dev-2 for the alternative.)

All existing hooks (`dev-delegation-guard`, `phase-gate-guard` on `PLAN_REVIEWED.md`) and the
progress ledger stay. The skill still NEVER writes project code; the implementers do.

---

## 6. Decisions for USER sign-off

**Signed off in ds, carried verbatim (calling out for visibility, not re-litigating):** probe-agent
gate (D1), `⏸ PAUSE:` inline marker (D2), retire the engine (D3), heuristic out-of-scope, ds-only
adversarial layer stays outside. **New dev-specific decisions below need your call:**

- **D-dev-1 — Intra-level execution: SEQUENTIAL within a level (recommended).** Faithful to today's
  `dev-implement.js` (shared tree, no worktree-merge) → clean A/B parity, zero merge risk. Parallel
  *across* levels is N/A (deps serialize them). *Alternative:* parallel-within-level with
  `isolation:'worktree'` per task + a merge step — true intra-level parallelism (ds-like), but adds a
  merge/conflict layer the assessment flags as dev-specific and risky. **Recommendation: sequential
  for v1; worktree-parallel as a fast-follow once parity is proven.**
- **D-dev-2 — Full-suite cadence: GENUINELY OPEN (your call).** The wc-audit flags the **per-level
  full suite** as a load-bearing dev invariant (B7): each task's `Verify Command` runs in isolation, so
  only the full suite catches a *cross-level integration regression* — and catching it after level *k*
  (not after the whole DAG) is materially better for a long plan. But the per-level cadence only exists
  because today's design is one-Workflow-call-per-level; the compiled runner's headline win is
  collapsing those calls into one. The two options genuinely trade off:
  - **(2a) Once after overallPass** — matches ds, maximizes the one-invocation win; a cross-level
    regression surfaces at end-of-DAG and routes to the `onlyChecks` fix loop. Simpler.
  - **(2b) Per-level pause** — the runner returns at each level boundary so the skill runs the full
    suite before advancing; preserves B7's early detection but reintroduces ~one round-trip per level
    (still no LLM re-parse — the runner resumes via `resumeFromRunId`, so it's cheaper than today).
  - **(2c) Hybrid** — once-at-end by default, but the runner pauses for a full-suite check at any level
    whose tasks touched files an *earlier-level* task also declared (the only place a cross-level
    regression can originate). Early detection only where it can matter; one invocation otherwise.

  **My recommendation: 2c** (keeps B7's protection exactly where regressions are possible, keeps the
  one-invocation win everywhere else). Fall back to **2b** if you want B7 preserved unconditionally,
  or **2a** if you want maximum simplicity and trust the onlyChecks loop. **Needs your decision —
  this is the one place the audit and my first draft disagreed.**
- **D-dev-3 — Probe shape: `{ exit0, filesPresent, testPresent, tail }` (recommended).** `testPresent`
  absorbs the retired read-only verifier's core "did you actually write the test" check; `filesPresent`
  mirrors ds `outputsPresent`. Deep fake-test detection stays in dev-test-gaps/dev-review.
- **D-dev-4 — Retire `dev-implement.js` AFTER hylo parity passes (recommended).** Keep it as the A/B
  reference until the compiled runner is proven on the hylo `browserStore` slice + the `readwiseSync`
  signature canary. Mirror ds D3/Q3.
- **D-dev-5 — Implementer model: INHERIT the session model (omit `model`); probe = haiku
  (recommended).** dev-implement.js deliberately omits `model` on the implementer (multi-step TDD
  needs capability) and pins mechanical stages to a floor. So — unlike ds, which tiers implementers via
  a heuristic — **dev does NOT tier implementers.** No `_tier()` in `dev_compile.py`.
- **D-dev-6 — Build parallel `scripts/dev/` instance, do NOT extract `run-core` yet (recommended,
  per the assessment).** `scripts/dev/dev_plan_table.py` + `dev_compile.py` +
  `workflows/templates/dev-run-template.js`, largely mirrored from ds but with dev's columns/sections.
  Extraction to a shared core happens *after* dev proves out, with two instances to triangulate the
  real seams.

---

## 7. Incremental, tested implementation plan

Discipline: **wc-audit before rewriting**; **don't break working workflows**; **each step tested
before the next**; **hylo-parity stress-tests every claim** before retirement.

**Build status (2026-06-26):** steps 1–8 DONE; step 9 (shared-core extraction) is a separate pass.
- ✅ dev parser `tests/dev_plan_table_test.py` 32/32 · dev driver `tests/dev-run-driver.test.mjs` 35/35
- ✅ ds suites still green (15/15, 28/28, grain-pause 12/12) — no regression
- ✅ guard reconciled to the shared parser (compiles ⇔ passes gate; rejects cycle/empty/dangling)
- ✅ skill slimmed to compile→run/pause; G6 doc drift fixed (guard docstring + plan-template)
- ✅ step 7 parity PASSED on the real hylo-tauri repo (§8c) — AB1/AB2/AB3 green
- ✅ step 8: `workflows/dev-implement.js` retired (parity-proven; no live `Workflow(name="dev-implement")` caller remained)

1. **wc-audit `dev-implement.js`** (Mode 2, delegated) — baseline 7.5/10 + B1–B15 invariants (§8). ✅
2. **`scripts/dev/dev_plan_table.py`** — tolerant deterministic parser (dev columns + `## Global
   Constraints` + `## Task Interfaces`). **Tests** (`tests/dev_plan_table_test.py`): the plan-template
   golden, `after N,M` fan-in, `N/A` Failing Test, missing-column rejection, cycle/dangling-dep
   rejection, Global-Constraints/Interfaces extraction, `done` `[x]` detection.
3. **`workflows/templates/dev-run-template.js`** — the protocol template (sequential driver +
   gate-first TDD skip + declared/dynamic pause + `{exit0,filesPresent,testPresent}` probe + uniform
   schema + Global-Constraints/Interfaces injection). **Tests** (`tests/dev-run-driver.test.mjs`,
   mocked primitives): topo order, sequential-within-level, gate-first idempotent skip, declared pause
   only on implemented tasks, resume via `clearedPauses`+decision injection, dynamic R4 pause carrying
   deviations+numbered summary, hard-fail → `tasksThatFailed`, "claimed GREEN but testPresent=false
   must not pass".
4. **`scripts/dev/dev_compile.py`** — PLAN→`run.js`, deterministic, NO tier heuristic (D-dev-5).
   **Golden:** compile the plan-template → correct tasks/levels/deps, Global Constraints + Interfaces
   inlined, valid JS (`node --check`).
5. **Reconcile `hooks/dev-plan-executable-guard.py`** to import `dev_plan_table.py` (single source of
   truth). Verify it still rejects cycles/empty-cells/dangling-deps and that "compiles ⇔ passes gate".
6. **Slim `skills/dev-implement/SKILL.md`** to compile→run/pause (§5). Keep the TDD Iron Law,
   deviation rules, recovery protocol, test-gap gate, phase-complete (they describe what the runner's
   implementers do + the skill's outside-run.js layer). Keep `dev-implement.js` in place (no break).
   **Also reconcile the doc/engine drift the audit flagged (G6):** the guard docstring + plan-template
   §Implementation-Order describe "worktree-isolated implementer per task, merges, runs in parallel,"
   but the engine is **sequential, shared-tree, no merge**. Under D-dev-1 (sequential) the docs must be
   corrected to match; if D-dev-1 later flips to worktree-parallel, the docs finally become true. Don't
   leave readers planning for parallelism that doesn't exist.
7. **PARITY (hylo-parity drives it):** A/B the compiled `run.js` vs old `dev-implement.js` on the
   `browserStore` CRUD slice (clean RED→GREEN gate), then the `readwiseSync` signature canary (must
   surface as a **PAUSE**, not a silent fix). Only after parity passes:
8. **Retire `dev-implement.js`** (D-dev-4). Update doc references.
9. **THEN** the shared-`run-core` extraction assessment (ds + dev as the two instances) — separate
   pass, not this one.

`dev-test-gaps`, `dev-review`, `dev-verify` are untouched.

---

## 8. Invariants the port must preserve (from the wc-audit — baseline score 7.5/10)

The audit enumerated 15 baseline invariants (B1–B15). Every one is preserved or improved by the
template + slimmed skill; **none is dropped.**

| # | Invariant (old engine) | Where it lives now | Status |
|---|---|---|---|
| B1 | TDD failing-test-FIRST (RED before code) | template `implementerPrompt` (dev-tdd Iron Law); `TRANSFORM_SCHEMA.testWritten` | preserved |
| B2 | "claimed done, did nothing" catch (testPresent) | template `gateProbe.testPresent` (independent probe) | **improved** (was a 2nd sonnet verifier) |
| B3 | JS gate, not honor-system | template `collect()` JS gate | preserved |
| B4 | R4 architectural block surfaces, never auto-piloted | template dynamic pause + skill routing | **improved** (explicit pause + decision injection) |
| B5 | Global Constraints injected into every implementer | compiled `GLOBAL_CONSTRAINTS` → every implementer prompt | preserved |
| B6 | Task Interfaces (Consumes/Produces) injected per task | per-task `interfaces` → implementer prompt | preserved |
| B7 | **Full-suite ground-truth between levels** | skill — **cadence is D-dev-2 (OPEN)**; once-at-end / per-level / hybrid | preserved (cadence is the open decision) |
| B8 | Skill drives the loop; workflow never self-declares done | skill run/pause loop; runner returns `paused`/`done`/`tasksRemaining` | preserved |
| B9 | `onlyChecks` + `priorReviews` re-run | template `ONLY` | preserved |
| B10 | Uniform result schema (byte-stable for the skill) | template `collect()` | preserved (same shape) |
| B11 | **Sequential-within-level, shared tree (NO worktree/merge)** | template `for`-await driver (NOT `parallel()`) — D-dev-1 | preserved |
| B12 | Refuse an unparseable plan | `dev_compile.py` fails loudly; guard shares the parser | **improved** (guard+runner agree on the DAG — see G2) |
| B13 | progress.md ledger + delegation guard | skill frontmatter + loop (untouched) | preserved |
| B14 | **Model floor: implementer OMITS model (inherits session); mechanical=floor** | template implementer omits `model`; probe=haiku — D-dev-5 | preserved (NO `_tier()` for dev) |
| B15 | Test-Gap + VALIDATION.md requirement-coverage gate | skill, unchanged (outside run.js) | preserved |

Gaps the refactor closes (audit G1–G6): **G1** the gate finally runs the real command (today it does
not — §1.1); **G2** one tolerant parser feeds both guard and runner, killing the format-drift mask and
the guard-vs-runner DAG divergence; **G3** the heavyweight sonnet verifier is deleted (it "caught no
substantive bug" in ds); **G4** gate-first idempotent skip makes resume cheap; **G5** decision
injection + declared-pause resume; **G6** reconcile the worktree/parallel doc drift (§7 step 6).

**Three load-bearing dev divergences a naïve ds copy would break (the audit's #3, locked into this
design):** the **sequential shared-tree driver** (B11 — NOT `parallel()`), the **implementer omitting
model** (B14 — NOT ds's `_tier()`), and **Global-Constraints + Task-Interfaces injection** (B5/B6);
plus keep the **per-level full-suite** question honest (B7 → D-dev-2).

## 8c. Parity log (run on the live hylo-tauri repo by the hylo-parity session, 2026-06-26)

**Setup.** Isolated git worktree `parity-browserstore-slice` off `origin/main`. A 2-task PLAN (3 Global
Constraints incl. the CON-2 numeric-id phantom-RED trap; Task Interfaces for both) compiled cleanly via
`dev_compile.py` → 2 tasks / 2 levels, all four holes injected correct (a 23 KB `run.js`). 3 workflow
runs, 8 agents, ~194k tokens. **All three checks PASS — the compiled runner behaves correctly on real
code.**

- **AB1 — idempotent gate-first skip: PASS.** A pre-seeded-green Task 1 → `↳ 1: already satisfied (skip
  implement)`: ONE haiku gate probe, ZERO implementers; the authoritative gate independently re-ran the
  REAL `node --test` (not a self-report). The old engine has no gate-first skip → it would spend an
  implementer for identical tree state.
- **AB2 — gate-changing R4 + stale-gate backstop: PASS (load-bearing).** Run via path (A) (§4.3):
  - *(a) cold run, title asserted in Verify* → GREEN, no block. **Correct** — the signature change is the
    *planned* task scope; the opus implementer even reasoned it in deviations ("explicitly mandated by
    INTERFACES → pinned task scope, not an unauthorized R4"). Logged as planned-change-implemented, not
    a fail. (Confirms R4 is for *unplanned* architecture, not planned work.)
  - *(b) stale-gate leg* — Verify asserts the OLD title-agnostic contract (`res===2`); resumed with
    `onlyChecks:['2']` + `decisions{'2':'readwiseSync MUST carry the title…'}`. The implementer **honored
    the decision in code** (added `ReadwiseSyncResult{count,title}`, widened the signature + forwarder)
    **then `status='blocked'`, R4=1**, deviations spelling out "update Verify + Failing Test, recompile."
    It did NOT bend code back to a bare number for the stale gate and did NOT silently rewrite the test
    green. Driver returned `{paused:true, pauseKind:'R4', atTask:'2'}`. Independently tree-verified:
    `src/api.ts` changed (+14/-3) BUT the stale Verify stays RED (exit 1, `{count:2,title:…}` vs `2`).
    **The non-divergence invariant proven live: a mis-routed gate-changing decision fails LOUD.**
  - *(c) green resume* — edited PLAN Task 2 Verify + Failing Test to assert `{count,title}`, RECOMPILED,
    re-ran plain → both tasks skip, `overallPass=true`. Round-trip closed.
- **AB3 — payload > pass/fail: PASS.** The R4 pause payload carried the full decision channel: `summary`
  WITH test numbers (`0 passed / 1 failed`), verbatim `deviations`, `verifyCommand`, and `verifyOutput`
  = the real `AssertionError` (`+ {count:2,title:"ignored title"} - 2  EXIT:1`), `failingTest`,
  `filesTouched`. The readwiseSync analog of muni's row-counts — present, not a boolean.

**Mechanics confirmed on real code:** independent probe RE-RUNS the command (a separate haiku agent
fires AFTER implement); implementer INHERITS the session model (`claude-opus-4-8[1m]`), probe pinned
haiku; SEQUENTIAL within level (driver never called `parallel()`, logs say `(sequential)`); `testPresent`
works (cold first probe returned `testPresent:false "could not find …test.mjs"` before the implementer
wrote it); the **hybrid FULLSUITE** correctly detected level-1 cross-level overlap on `src/api.ts` but did
NOT pause because level 1 is terminal (`li < levels.length-1` false) — the cadence holds.

**Divergence vs old `dev-implement.js` (final tree state):** for equivalent *planned* tasks the final
tree is IDENTICAL. The real divergence is **gate-authority + pause structure, not tree**: OLD gate =
implementer self-reported `verifyPassed` + a NON-executing corroboration; OLD R4 = a critical finding.
NEW gate = an independent re-run of the command; NEW R4 = a structured `pauseKind:'R4'` + payload with
the live `AssertionError`. Strictly more on the decision channel — at lower cost.

**Bonus parity finding (live evidence FOR the design).** CON-1 ("don't touch tauriStore") forced a
split-brain return type: `browserStore.readwiseSync→ReadwiseSyncResult` while `tauriStore` stays
`Promise<number>`, so `api.readwiseSync` becomes a union and `App.tsx`'s `Synced ${n} highlights` renders
`[object Object]` on the browser path. **tsc-CLEAN, unit-GREEN, integration-BROKEN** — the "JS gate
caught zero integration bugs" lesson reproduced on real code. NOT a runner defect (it faithfully built
the plan); it is direct evidence FOR keeping the full-suite / dev-review layer OUTSIDE `run.js`, exactly
as this design does.

### Hybrid FULLSUITE leg — PROVEN live (2nd hylo-parity slice, 2026-06-26)

A 3-level DAG (`src/stats.ts` total@L0 → `src/stats.ts` re-edited +byColor@L1 → `src/statsReport.ts`
consumes it@L2; compile-time `FULLSUITE_LEVELS=[1]`, non-terminal). 11 agents / 2 runs.

- **Run 1 (cold) PAUSED correctly:** L0+L1 implemented (RED→GREEN each), then the driver returned
  `{paused:true, pauseKind:'fullsuite', atLevel:1, payload:{decision:"Cross-level file overlap at level
  1: run the full suite before advancing…", levelTasks:['2'], filesThisLevel:[…]}}`. Independently
  tree-verified it **HALTED before L2** (`src/statsReport.ts` absent, Task3 `·`) — a real early return,
  not cosmetic. The skill (hylo-parity) ran the **real full suite** at the checkpoint (5/5 green — the
  cross-level edit did not regress L0's `total`) and cleared.
- **Run 2 (resume, `clearedFullSuite:[1]`) ADVANCED + completed:** L0/L1 gate-first SKIP, advanced to
  `Level 2/2: [3]`, Task3 wrote its test RED→GREEN, `overallPass=true`. Final tree: 6/6 green;
  `statsReport.ts` does a type-only import of `HighlightStats` from `./stats` (real cross-level
  integration, CON-1 honored); `stats.ts` carries both `total`(L0) and `byColor`(L1).

**Correctness detail worth keeping:** on resume the fullsuite pause did **not** re-fire even though
`FULLSUITE_LEVELS` still contains 1 — because L1 was a pure gate-first SKIP, so `levelDidWork=false`
and the checkpoint guard suppressed it. So `clearedFullSuite` is belt-and-suspenders, **not** load-
bearing for advance; the "a skipped level changed no code → no regression possible" reasoning holds on
real code, and an all-done resume is a genuine 0-pause no-op.

**All hybrid-cadence cases now exercised live:** terminal overlap → SUPPRESS (browserStore slice),
non-terminal overlap → PAUSE→resume→advance (this slice). Combined with AB1 (skip), AB2 (R4 stale-gate
backstop + round-trip), AB3 (payload-with-numbers), **every mechanic of the compiled dev runner is
parity-proven on the real hylo-tauri repo.** The declared `⏸ PAUSE` row remains the only path proven
only by the dev driver unit test (+ ds) — lowest-risk, deferred.

## 9. Future extraction candidates (pass #9 — DO NOT extract yet)

> **CONVERGED** via the host-dispatch cross-pollination (dev-refactor × ds-refactor, 2026-06-26;
> writing-refactor input folded in). **Canonical list:** `docs/common-infra-candidates.md` (owned by
> ds-refactor; commit `2835591`, which records the authoritative RETURN-REASON taxonomy). This section
> is the **dev-side view** that fed that convergence — kept here for the dev port's record; **the
> canonical doc governs pass #9.**
>
> Guardrail stands: **brainstorm written down; NO shared `run-core` extracted in this pass.** ds + dev
> are two exit-code instances; writing is a 3rd (judgment gate). After writing's step-1, **only ONE
> seam remains under-determined** (the D1 judgment-gate body) — see 9.5.

### 9.1 SHARED (core candidates — ds + dev agree, mostly verbatim)
- **S1 — deterministic table parser + DAG/topo/cycle logic** (columns differ via a column-map; mechanics identical).
- **S2 — the run-template DRIVER:** topo → level-iteration → gate-first idempotent skip → structured early-return → uniform result. **`intraLevel` is a CORE FLAG, default `sequential`, that the COMPILER sets to `parallel` only when it can PROVE the level's tasks write DISJOINT artifacts** (output-disjointness derivation — ds-refactor's refinement, conceded; better than my first "per-domain strategy" framing). **Provability is from the DECLARED outputs** — a runtime-computed path (glob/dir) is not statically provable → sequential. **Worktree isolation is a 2nd input to the same derivation** (parallel-safe even on a shared tree). So dev is "**sequential UNTIL disjoint-provable OR isolated**," not sequential-forever — future-proof without re-arch. ds's disjoint parquets qualify automatically; dev's shared tree (today) doesn't → sequential, so **tree-corruption is impossible by construction.**
- **S3 — pause/resume protocol:** `args.decisions` + `clearedPauses`; the two-kinds-of-decision routing + **STALE-GATE BACKSTOP** (proven live in dev: implementer honored a decision then re-blocked on a stale gate).
- **S4 — result schema + a FIRST-CLASS payload TYPE** `{deviations, numbered summary/evidence}` (ds-refactor hindsight: make it a fixed type from day 1, not a payload literal — it's the catch-channel). `tasksThatFailed` / `findings` / `reviews` / `scoreTable` / `tasksRemaining`.
- **S5 — compile = "produce the work-list"; emit representation per-domain:** inlined codegen `run.js` (ds/dev) OR a data work-list artifact (writing's already-generic runner). Not "emit code."
- **S6 — parser/compiler/guard split:** one parser imported by both compiler and guard → "**compiles ⇔ passes gate**" is a property. **The guard asserts STRUCTURE only** (cycles / missing cells / dangling deps); **all format tolerance lives in the parser, one place.** (Aged best; keep verbatim.)
- **`collect()` / `scoreTable()` / `pausePayload()`** — ~90% identical ds↔dev → strong shared helpers.

### 9.2 SHARED DOCTRINE — now SIX (domain-agnostic; baked into the core, not re-typed per domain)
(i) payload > pass/fail, (ii) mandatory R4 block, (iii) probe asserts artifacts-exist, (iv)
adversarial/review layer OUTSIDE `run.js`, (v) **NO LLM between a structured producer and a strict
checker** (the root cause of the discovery-mask), (vi) **emitter-canonical** (one format spec,
strict-at-emitter / tolerant-at-parser). The **stale-artifact backstop is LAYER-AGNOSTIC** (S3 / 9.5):
a gate-changing decision leaves a stale UPSTREAM artifact and the deterministic checker catches it loud
— at the *data* layer (ds/dev: a stale `Verify` assertion) **or** the *spec* layer (writing: a stale
`*_REVIEWED.md` vs live `OUTLINE.md` — confirmed live by writing-refactor's step-1).

### 9.3 INJECTED (per-domain — the real fork)
- **D1 — `gateProbe(t)`, OPAQUE.** Returns `{pass, corroboration, evidence}` where `pass` may be an
  exit code OR a judgment; **`corroboration` is required** (safety inv. iii — corroborate the artifact
  INDEPENDENTLY of the pass signal, because a pass can be stale OR gamed) but its SHAPE is per-domain
  (ds: outputs exist; dev: files+test exist; writing: evidence-is-the-corroboration). **TRUST-CLASS
  axis:** exit-code (can't lie) vs judgment (can be gamed) — the core's evidence handling assumes the
  judgment case (richest) so it degrades gracefully to exit-code, and when trust-class=judgment the
  adversarial-layer-outside-`run.js` invariant flips from backstop to **PRIMARY** authority.
- **D2 — `implementerPrompt(t)`** (carries the TDD/output-first/no-phantom-RED discipline for dev).
- **D3 — task-spec COLUMNS.**
- **D4 — tier/effort policy** (ds heuristic; dev = inherit session model; do NOT put in the shared compiler).

### 9.4 RETURN-REASON taxonomy + two orthogonal decision/pause axes
The runner yields to the skill for one of several **return-reasons** — `done | hard-fail |
pause-human | yield-for-recheck` (ds-refactor's framing, adopted). Keep these separate so extraction
doesn't conflate "a human must decide" with "the skill must re-check":
- **`pause-human`** (the human-decision subset) has its own **PAUSE axis:** declared (`⏸` in plan) vs
  dynamic (R4 block); and an orthogonal **DECISION axis:** gate-changing (edit the gate + recompile) vs
  behavior-only (`args.decisions`).
- **`yield-for-recheck`** is an AUTOMATED cross-cutting gate — **no human decides.** dev's `fullsuite`
  checkpoint is this (the skill runs the full suite, green→auto-resume, red→`onlyChecks`); ds's analog
  is `ds-validate-coverage` (once at end rather than mid-run). **NOTE:** my dev impl currently *muxes*
  the recheck onto the pause return channel (`paused:true, pauseKind:'fullsuite'`) as a shortcut — but
  it is **not** a human pause; the core should model `yield-for-recheck` as its own return-reason, not a
  3rd pause-kind. (My earlier draft mis-labeled it a "3rd pause kind" — corrected here.)

### 9.5 Extraction timing + the honest open gap
- **Extract the PROVEN core now** (S2 driver / S3 pause / S4 schema+helpers — two instances agree).
  **Update (writing step-1 landed, blind-oracle parity-passed):** `compile`=worklist-vs-codegen (S5) is
  now **CONFIRMED** — writing's data section-index emit is a real 2nd shape, not a prediction. The
  layer-agnostic stale-gate backstop (S3, spec layer) is likewise confirmed. So of the two seams once
  under-determined, **only ONE remains: `gateProbe`-opaque (D1) at the JUDGMENT trust-class** — it
  awaits writing's GATE step (writing's gate is semantic, not yet built). Keep **D1's judgment body** an
  injected interface pending that; everything else (incl. S5's data-emit branch) is extraction-ready.
  Also an **extraction-cleanup item** (ds-refactor): give `yield-for-recheck` its OWN return channel —
  my dev impl muxes it onto `pauseKind:'fullsuite'` as a shortcut (impl, not seam). Target shape:
  `templates/run-core.js` (driver + pause + schema + the SIX invariants + helpers, with D1–D4 + the
  `intraLevel` flag injected) + `templates/<domain>-task.js`.
- **OPEN GAP (honest, shared, deferred — ds-refactor catch A):** the dev port hardened the **parser +
  guard** but did NOT harden the **emitter** (`dev-design`/`dev-plan`) to write born-canonical. So the
  tolerant parser currently *relocates* the LLM's silent tolerance into regex — the exact thing
  `docs/investigations/2026-06-26_llm-discovery-masked-spec-drift.md` warns against. Same deferred
  increment ds flagged (DESIGN-ds §8b "emitter, not parser — next increment"). **Follow-up:**
  born-canonical emitter → guard goes strict → parser tolerance becomes a back-compat shim, not the
  primary defense. Applies to both ds and dev.
