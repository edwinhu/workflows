# DESIGN: `spec → plan → compiled run.js` for the ds workflow

Status: **DRAFT — awaiting sign-off before any engine change.**
Companion to `docs/ds-refactor-spec-plan-js.md` (the muni-pennying handoff brief).

---

## 0. TL;DR

Replace the **generic interpreter** (`ds-implement.js` re-parses `PLAN.md` with an LLM
"discovery" agent every invocation, runs one level, then a heavyweight re-analysis verifier)
with a **per-plan compiled runner**:

```
SPEC ──▶ PLAN ──▶ [ds-compile: deterministic, no LLM] ──▶ .planning/run.js ──▶ Workflow(run.js)
 (gated)  (gated)                                          (lean, project-specific)
```

Three concrete wins, each traceable to a muni pain point:

1. **Zero discovery LLM calls.** The Task Breakdown table is *already* parsed deterministically
   by `hooks/ds-plan-executable-guard.py`. `ds-compile` reuses that exact parser to emit a `run.js`
   with the task DAG inlined as a literal. (Kills the per-call re-parse **and** the one misparse
   that cost a wasted round-trip.)
2. **One topo-run with real parallelism, not ~13 level round-trips.** `run.js` topo-sorts the whole
   DAG and runs independent tasks concurrently, pausing only at decision points.
3. **Cheap gate, no double-work.** A single cheap probe agent runs the `Verify` command and reports
   its exit code; the JS gates on that. The heavyweight re-analysis verifier is deleted.

**What does NOT change:** brainstorm / plan / review / verify stay conversational and human-gated;
`ds-validate-coverage.js` stays as the per-requirement adversarial fan-out; the human decision gates
(the muni R4 escalations) are preserved as explicit `pause` points. **We do not build a monolithic
"one JS for the whole workflow."**

---

## 1. Audit findings (current state)

### 1.1 `workflows/ds-implement.js` (210 lines) — the generic interpreter

Four phases per invocation, **once per dependency level**:

| Phase | What it does | Cost / problem |
|-------|--------------|----------------|
| **Discover** | An LLM agent (`sonnet`) reads `PLAN.md`, re-parses the Task Breakdown table into `{num, deps, outputs, expectedOutput, verify, implements, kind, done}`, computes topo levels, picks `levelToRun`. | **Redundant + fragile.** This parse is pure regex (see §1.4). Re-run every level (~13× in muni). Misparsed once → false "all done". |
| **Transform** | One implementer agent per task **in the level, sequential**; output-first (produce Outputs, run `Verify`, self-report `verifyPassed`). | The implementer is real work and must stay. But "sequential within level + one level per call" throws away cross-level parallelism and pays a main-loop round-trip per level. |
| **Verify** | A **second** LLM agent (`sonnet`) per task re-loads the data and re-checks outputs. | **Double-work.** The brief: it "did not catch a single substantive bug." It recomputes a gate the `Verify` exit code already gives. |
| **Gate** | Pure JS: `pass = implemented && outputsProduced && verifyPassed && verifyReproduced`. | Correct shape — keep. But its inputs are two LLM self-reports, not a real exit code. |

Returns `{ overallPass, level, tasksRemaining, tasksThatFailed, reviews, ... }`. The **skill** drives
the level loop and re-invokes with `onlyChecks` + `priorReviews`. The workflow never decides "done".

### 1.2 `workflows/ds-validate-coverage.js` (180 lines) — KEEP AS-IS

Per-SPEC-requirement read-only fan-out (DQ1–DQ5 + M1), JS-computed COVERED/PARTIAL/MISSING gate,
`validated | gaps_found` status. This is the adversarial review the brief says to keep. It runs
**once** (not per-level), is already JS-gated, and the human fix/accept loop lives in the
`ds-validate` skill. *Minor, optional later:* its own discovery agent could be made deterministic,
but it is low-frequency and lower priority — **out of scope for v1.**

### 1.3 The skill chain

- `ds` (brainstorm) → `ds-plan` → `ds-implement` → `ds-validate` → `ds-review` → `ds-verify`.
- **Human-gated, conversational, stay in main loop:** `ds` (brainstorm), `ds-plan`, `ds-validate`
  (fix/accept), `ds-review` (adversarial reviewers, max-3 cycles), `ds-verify` (reproducibility +
  user acceptance). These are where every real muni bug was caught. **Untouched by this refactor.**
- **`ds-implement` skill** is the only one that drives `ds-implement.js`. It becomes a **thin
  runner** (§5).
- Gates are hook-enforced: `phase-gate-guard.py` blocks each phase on a sentinel
  (`PLAN_REVIEWED.md` APPROVED, `IMPLEMENT_COMPLETE.md` COMPLETE, `VALIDATION.md` validated).
  **These sentinels and hooks are preserved.**

### 1.4 Key discovery: the parse is already deterministic

`hooks/ds-plan-executable-guard.py::find_task_table()` already, with no LLM:

- locates the Task Breakdown table (header has `Task | Deps | Verify`),
- extracts every cell, parses `Deps` (`---` → `[]`; `after N,M` → `[N,M]`),
- builds the dependency map, and **validates the DAG is acyclic** (3-color DFS).

So the only fields the discovery LLM adds beyond regex are `kind` (a `[engineer]`/`[analyst]` tag —
also regex) and `language` (a `PLAN.md` header — also regex). **The discovery agent is 100%
replaceable by deterministic code we already have.** This is the linchpin: `ds-compile` is a
deterministic script, not an LLM step.

### 1.5 The siblings share the shape

`dev-implement.js` is the same pattern (discovery LLM → per-level → heavyweight verifier), columns
`Task | Deps | Files | Failing Test | Verify Command | Implements`. `wc-generate.js`,
`workshop-generate.js`, `writing-draft.js` are domain variants. This confirms the generalization
hypothesis (§6) — **but we prove on ds first.**

### 1.6 Hard runtime constraint that shapes everything

**Workflow scripts have no filesystem/Bash access.** They can only call `agent()`, `parallel()`,
`pipeline()`, `log()`, `phase()`, read `args`, and `return` a value. Implications:

- **Implementers must be LLM agents** — only the Workflow runtime can dispatch them. So a "plain Node
  runner the skill execs via Bash" is a non-starter (it couldn't spawn implementers). **`run.js` is a
  Workflow script**, executed via `Workflow({ scriptPath: ".planning/run.js" })`. This reuses the
  existing resume (`resumeFromRunId`), progress UI, and concurrency cap for free.
- **The JS cannot itself `exec` the `Verify` command.** "Gate on the real exit code" is therefore
  implemented by a **cheap probe agent** whose only job is to run the command and report its exit
  code + output tail (§3.3). This is strictly more honest and far cheaper than today's
  implementer-self-report + re-analysis-verifier, with one documented residual: we trust that the
  probe agent actually ran the command (mitigated by requiring the output tail as proof).

---

## 2. The task-spec schema (the compile target)

`ds-compile` parses `PLAN.md` into an array of task specs and inlines it into `run.js`. Every field
is derived deterministically from the existing table, except `tier`/`effort` (heuristic) and
`pauseAfter` (an explicit, optional PLAN marker):

```js
{
  id:        "T2",                       // from `Task` cell leading token
  name:      "build dealer-inclusive master_trades …",
  kind:      "engineer",                 // [engineer]/[analyst] tag, else "unspecified"
  deps:      ["T1"],                     // parsed from Deps (--- → [], after N,M → [N,M])
  outputs:   ["data/output/master_trades/*.parquet", ...],
  expectedOutput: "dealer-inclusive, grain unique on cusip×event_ts×seqno; …",
  verify:    "pixi run python -c \"import polars as pl; …; assert …\"",  // exit 0 = pass
  implements:["MASTER-01","MASTER-02","PERF-01"],
  taskText:  "<full row text for the implementer prompt>",
  done:      false,                      // [x] / done marker

  // --- compile-derived (not in today's table) ---
  tier:      "sonnet",                   // heuristic: engineer/heavy→sonnet, trivial loader→haiku, methodology→sonnet|opus; overridable
  effort:    "medium",
  pauseAfter: null                       // or "<the decision to surface>", from an explicit PLAN marker (§4.1)
}
```

`tier`/`effort` heuristic (v1, transparent + overridable):
- `kind:"engineer"` or Outputs include large masters/parquet → `sonnet`.
- Trivial mechanical tasks (a couple of loader functions, a caption edit) → `haiku`.
- Tasks whose `taskText` carries a methodology fork / `pauseAfter` → `sonnet` (or `opus` if flagged).
- Anything ambiguous → `sonnet` (safe default). Per-task override via an optional `Tier` column later.

**No new required PLAN columns for v1.** `pauseAfter` is read from an optional marker so existing
plans compile unchanged. The executable-guard's required columns are untouched.

---

## 3. The shared template (`workflows/templates/ds-run-template.js`)

`ds-compile` produces `.planning/run.js` by substituting three holes in this template:
`/*__TASKS__*/`, `/*__PROJECT__*/`, `/*__META__*/`. The template carries the **protocol**; the
compile output carries the **data**. Honesty invariants are baked into the template so generated
scripts cannot drift.

### 3.1 Driver (fixed in the template)

```js
const TASKS    = /*__TASKS__*/    // injected literal
const PROJECT  = /*__PROJECT__*/  // injected abs path
const DECISIONS = (args && args.decisions) || {}        // human answers from prior pauses
const CLEARED   = new Set((args && args.clearedPauses) || [])  // pauses already resolved
const ONLY      = (args && args.onlyChecks) ? new Set(args.onlyChecks) : null  // re-run subset

const levels = toposort(TASKS)        // same algorithm as the guard; DAG already validated at plan time
const state = {}                      // id -> { pass, impl, gate }

for (const level of levels) {
  const todo = level.filter(t => ONLY ? ONLY.has(t.id) : true)
  const results = await parallel(todo.map(t => () => runTask(t)))  // REAL cross-task parallelism
  for (const r of results.filter(Boolean)) state[r.id] = r

  // dynamic pause: any task blocked on an R4 escalation returns control immediately
  const blocked = results.filter(Boolean).find(r => r.impl && r.impl.status === 'blocked')
  if (blocked) return paused('R4', blocked.id, blocked.impl.deviations, state)

  // declared pause: a planned decision point not yet cleared by the human
  const gate = todo.find(t => t.pauseAfter && !CLEARED.has(t.id))
  if (gate) return paused('decision', gate.id, surfaceFor(gate, state), state)
}
return finish(state)   // { done:true, overallPass, scoreTable, findings, tasksThatFailed, reviews }
```

### 3.2 `runTask` — gate-first, output-first, idempotent

```js
async function runTask(t) {
  // 1. Idempotent short-circuit (makes resume / recompile cheap): if outputs already satisfy Verify
  //    and the task isn't being force-re-run, skip the implementer entirely.
  if (!ONLY || !ONLY.has(t.id)) {
    const probe = await gateProbe(t)
    if (probe.exit0) return pass(t, null, probe)
  }
  // 2. Implement (the real work — tiered model)
  const impl = await agent(implementerPrompt(t, DECISIONS),
                           { label: `task:${t.id}`, schema: TRANSFORM_SCHEMA,
                             model: t.tier, effort: t.effort })
  if (!impl || impl.status === 'blocked') return { id: t.id, impl, pass: false }
  // 3. Authoritative gate: a fresh cheap probe runs Verify and reports the real exit code.
  const gate = await gateProbe(t)
  return { id: t.id, impl, gate, pass: gate.exit0 && impl.outputsProduced }
}
```

### 3.3 `gateProbe` — the cheap, separate, honest gate

```js
async function gateProbe(t) {
  return agent(
    `Run EXACTLY this command from ${PROJECT} and report the result. Do NOT create, edit, fix, or
     analyze anything — only run it and report.\n\n    ${t.verify}\n\n
     Return { exit0: <true iff exit code 0>, tail: "<last ~25 lines, as proof>" }.`,
    { label: `gate:${t.id}`, schema: GATE_SCHEMA, model: 'haiku', effort: 'low' })
}
```

- Separate process from the implementer → still catches "claimed done, produced nothing."
- `haiku` + a single deterministic job → cheap.
- Replaces the per-task re-analysis verifier. Deeper per-requirement coverage stays in
  `ds-validate-coverage` (unchanged).

### 3.4 Baked-in honesty invariants (why generated scripts stay honest)

- Gate = the probe's reported `exit0`, never the implementer's self-report.
- Output-first: implementer must produce the artifact, then the probe asserts it.
- Uniform result schema (`tasksThatFailed`, `findings`, `reviews`, `scoreTable`) — identical to
  today's return so the skill's rendering is unchanged.
- `pause()` is the only way the script yields to a human; it returns the decision payload.
- Skip the LLM verifier where `Verify` is deterministic (always, now) — corroboration is the probe.

---

## 4. The pause / resume protocol

Two pause kinds, both faithful to the muni run (some forks were planned, some emerged at R4):

| Kind | Trigger | Maps to (workflow-creator vocab) |
|------|---------|-------------------------------|
| **declared** | a task carries `pauseAfter` (a known methodology fork, e.g. muni T4 "Table 3 diverges → improve vs match?") | `decision` checkpoint |
| **dynamic** | an implementer returns `status:"blocked"` (R4a data assumption / R4b methodology) | `decision` checkpoint, runtime |

Everything else **auto-advances** (the workflow-creator rule: only `decision`/`human-action`
checkpoints pause; `human-verify` auto-advances). So a clean run with no forks runs end-to-end with
zero pauses; muni's ~5 decision points become ~5 pauses instead of ~13 level round-trips.

### 4.1 Declaring a pause in PLAN.md (no schema break)

A task declares a planned decision pause with an inline marker in its row, e.g. a trailing
`⏸ PAUSE: <the decision to surface>` in the Expected Output cell (today muni wrote this as prose:
"STOP and flag R4b/METHOD-01"). `ds-compile` lifts it into `pauseAfter`. Plans without the marker
compile with `pauseAfter:null` — **fully backward compatible.**

### 4.2 The mechanism (functional, resume-safe)

`pause()` is **a structured early return**, not a runtime suspension:

```js
function paused(kind, atId, payload, state) {
  return { paused:true, kind, atTask:atId, payload, partial:scoreTable(state), tasksRemaining:… }
}
```

The script is a **pure function of (compiled DAG, `args.decisions`, on-disk state).** State that must
survive a pause is carried in `args` (Workflow scripts can't touch disk), so resume is deterministic:

- The **skill** (thin runner, §5) receives `{paused, atTask, payload}`, presents `payload` to the
  user, gets the decision.
- It re-invokes `Workflow({ scriptPath, resumeFromRunId: <last>, args: { …, clearedPauses:[…,atTask],
  decisions:{…, [atTask]: answer } } })`.
- `resumeFromRunId` replays the cached prefix instantly; the gate-first short-circuit (§3.2) means
  even a *fresh* run (after a recompile from a methodology change) is cheap, because already-built
  outputs pass their probe and skip the implementer.
- `decisions[atTask]` is injected into downstream implementer prompts, so the human's call ("improve,
  don't match the original Table 3") actually steers the code.

### 4.3 Why two resume layers

- **`resumeFromRunId`** — fast, in-session, same-script cache hit.
- **gate-first short-circuit** — robust to recompiles and new sessions (keys on real disk state, not
  a run id). A methodology change edits PLAN → recompile → new `run.js`; upstream outputs still on
  disk pass their probes and are skipped. Both layers compose.

---

## 5. `ds-implement.js` slims to a thin runner; the skill drives pauses

`ds-implement.js` **(retired in its current form)** — its discovery+transform+verify+gate logic moves
into the template. What remains as an engine is essentially nothing ds-specific; the generated
`.planning/run.js` *is* the engine. We keep a tiny `ds-implement.js` only if we want a stable
`Workflow(name:"ds-implement")` entry that `scriptPath`-delegates to `.planning/run.js` (decision
**D3** below).

The **`ds-implement` skill** changes from "drive a per-level loop" to "compile once, then run/pause":

```
0. /goal: All PLAN tasks [x], each Verify exits 0, VALIDATION.md = validated. (unchanged)
1. COMPILE (once, deterministic, no LLM):
     run scripts/ds-compile.py  .planning/PLAN.md  →  .planning/run.js
     (re-run only when PLAN changes)
LOOP under /goal:
2. r = Workflow({ scriptPath: ".planning/run.js", resumeFromRunId?: last,
                  args: { projectDir, decisions, clearedPauses } })
3. if r.paused:
     - present r.payload (the decision + the implementer's deviation notes + key numbers)
     - get the user's call
     - if methodology change → hand back to ds-plan to edit PLAN.md → re-run ds-compile (step 1)
     - else → record decision, add atTask to clearedPauses, re-invoke (step 2, resume)
4. if r.done && r.overallPass:
     - run ds-validate-coverage (ground truth, unchanged) ; mark PLAN rows [x] ; LEARNINGS.md
     - write IMPLEMENT_COMPLETE.md sentinel ; proceed to ds-validate
5. if r.done && !overallPass: read r.findings, fix, re-invoke with onlyChecks=r.tasksThatFailed
```

All existing hooks (`ds-no-main-chat-code-guard`, `phase-gate-guard`, the subagent guards) and
sentinels stay. The skill still NEVER writes analysis code; the implementers do.

---

## 6. Generalization (assess after ds proves out — NOT v1)

The shared core vs the per-domain seam:

| Shared core (extract once ds is proven) | Per-domain template |
|---|---|
| `toposort`, the level/parallel driver, `pause()`/resume, `args.decisions`, the gate-first short-circuit, the uniform result schema | `implementerPrompt(t)` and `gateProbe(t)` — the only domain-specific pieces |

- **dev** (`dev-implement.js`): TDD — `gateProbe` runs the `Verify Command`; implementer is
  failing-test-first. Same DAG table (`Task|Deps|Files|Failing Test|Verify Command|Implements`).
- **writing** (`writing-draft.js`): gate = claim-id / source-fidelity check (a hook already exists:
  `writing-claim-id-guard.py`); implementer = section draft.
- **workshop** (`workshop-generate.js`): gate = visual/structural verify; implementer = slide build.
- **workflow-creator / course-materials**: file generation; gate = structural.

Proposed end state (only if ds validates the pattern): `workflows/templates/run-core.js` (driver +
pause + schema) and `templates/<domain>-task.js` (the two prompts), composed by a shared
`compile` with a per-domain column map. **We do not refactor the siblings in this pass** — the brief
is explicit: prove on ds, then assess; don't force a rewrite where the current shape works.

---

## 7. Incremental, tested implementation plan

Discipline (per the brief + `.claude/CLAUDE.md`): **wc-audit before rewriting; don't break working
workflows; each step tested before the next.**

**Build status (2026-06-26):** steps 2–3 done + tested; steps 1, 4–7 pending.

- ✅ **`scripts/ds/ds_plan_table.py`** — tolerant deterministic parser (the LLM-discovery replacement).
  Handles `**T1**`/`1.` ids, `—`/`---`/`after N,M`/bare-list deps, `⏸ PAUSE:` markers, cycle/dangling/
  empty-cell detection. `tests/ds_plan_table_test.py`: **18/18** (incl. muni's real plan, T2∥T5 parallel).
- ✅ **`workflows/templates/ds-run-template.js`** — the protocol template (driver + gate-first skip +
  declared/dynamic pause + probe gate + uniform result schema).
- ✅ **`scripts/ds/ds_compile.py`** — PLAN→`.planning/run.js`, deterministic, heuristic tiers.
  Golden: compiles muni's real plan → 10 tasks/9 levels, valid `run.js` (`node --check`).
  `tests/ds-run-driver.test.mjs` executes the compiled body with mocked primitives: **18/18**
  (topo order, real parallelism, gate-first idempotent skip, declared pause only on implemented tasks,
  resume via `clearedPauses` + decision injection, dynamic R4 pause, hard-fail → `tasksThatFailed`).
- ✅ **Guard reconciliation (§7b)** — `ds-plan-executable-guard.py` now imports the shared parser.
  Verified: it **now accepts muni's real plan** (previously rejected every row) and the toy fixture,
  still rejects cycles/empty-cells/dangling-deps, and the PreToolUse deny-path is intact.
- ✅ **Step 4 (slim the `ds-implement` skill)** — the Delegation block, flowchart (the authoritative
  spec), strategy-choice, Step 1/2, and the Agent-Team section now describe COMPILE → run/pause. No
  dangling anchors. The deeper sections (output-first facts, deviation rules R1–R4, ETL enforcement,
  scale-up) are intact — they describe what the runner's implementers do (now embedded in the template
  prompt), not a main-chat dispatch loop.
- ✅ **Step 1 (wc-audit / invariants)** — audited the retired engine's guarantees and confirmed each
  is preserved or improved by the template + slimmed skill (table below).
- ⏳ **Steps 5–7** — e2e on a small real analysis, muni parity re-run, then retire the dormant
  `ds-implement.js`. These need a live project + real agents; `ds-implement.js` is left in place
  (now unreferenced by the skill) until parity is proven.

### Invariants preserved (ds-implement.js → template + slimmed skill)

| Invariant (old engine) | Where it lives now | Status |
|---|---|---|
| Output-first (produce artifact, then verify) | template `implementerPrompt` protocol | preserved |
| Gate from real `Verify` exit code, never self-report | template `gateProbe` (independent probe) | **improved** (was implementer self-report + re-analysis verifier) |
| Uniform result schema (`overallPass`, `tasksThatFailed`, `findings`, `reviews`, `scoreTable`, `tasksRemaining`) | template `collect()` | preserved |
| R4 escalation surfaces (don't autopilot a methodology pivot) | template dynamic pause + skill loop step 2 | **improved** (explicit pause + decision injection, was a critical finding) |
| Skill drives the loop; engine never self-declares "done" | skill run/pause loop; runner returns `paused`/`done` | preserved |
| `onlyChecks` re-run support | template `ONLY` | preserved |
| Hooks/sentinels (`ds-no-main-chat-code-guard`, `phase-gate-guard`, `IMPLEMENT_COMPLETE.md`) | skill frontmatter + loop step 3 | preserved (untouched) |
| Discovery DAG parse | `ds_compile.py` (deterministic) | **improved** (no LLM, no misparse, tolerant of real formats) |

1. **wc-audit** `ds-implement.js` (Mode 2) — baseline score + the gates it must preserve. Record in
   `.planning/wc/ds/`.
2. **`scripts/ds-compile.py`** — deterministic PLAN→run.js compiler. Reuse `find_task_table()` from
   `ds-plan-executable-guard.py` (extract the parser into a shared module both import). **Tests:**
   golden-file test compiling the muni `PLAN.md` → assert the emitted `run.js` has all 11 tasks,
   correct deps, `pauseAfter` lifted from T4, and is valid JS (`node --check`). Edge cases: empty
   table, malformed deps, missing marker.
3. **`workflows/templates/ds-run-template.js`** — the protocol template + holes. **Tests:** compile a
   2-task toy PLAN, run it against a fixture project; assert (a) topo order, (b) parallel independent
   tasks, (c) gate-first skip when outputs exist, (d) declared pause returns the payload, (e) resume
   with `clearedPauses` continues past it, (f) dynamic pause on a blocked implementer.
4. **Slim the `ds-implement` skill** to the compile-then-run/pause loop (§5). Keep the old
   `ds-implement.js` in place until step 5 proves out (no break).
5. **End-to-end on a small real analysis** (5–10 tasks), then re-run the muni plan to confirm
   parity: same outputs, same gates, fewer round-trips, the METHOD-01 forks surface as pauses.
6. **Retire / thin `ds-implement.js`** (decision D3). Update the executable-guard doc references.
7. **Then** write a short generalization assessment (§6) and stop — no sibling rewrites this pass.

`ds-validate-coverage.js`, `ds-review`, `ds-verify` are untouched.

---

## 7b. Audit finding: the guard and real plans have diverged (the LLM was bridging it)

Running the executable guard on the **actual** muni `PLAN.md` rejects **every row**:

```
$ uv run python3 hooks/ds-plan-executable-guard.py muni/.planning/PLAN.md
PLAN NOT EXECUTABLE:
- Task row '**T1** `[x]` — …' has no leading 'N.' number.   (×10)
- Task Breakdown table has no task rows.
```

Muni used `**T1**` ids and `—` / bare `T1` / `T2, T3` deps — **not** the guard's documented `1.`
ids and `---` / `after N` deps. ds-implement ran it fine anyway, because the **LLM discovery agent
tolerated the drift**. So the LLM wasn't just re-parsing redundantly — it was silently papering over a
format mismatch the guard would otherwise have blocked. Two consequences for this refactor:

1. **`ds-compile`'s parser must be tolerant** (the deterministic replacement for the LLM's tolerance):
   accept ids `**T1**` / `T1` / `1.`; deps `—` / `---` / `-` / empty (→ none) and `after N,M` /
   bare `T1, T2` lists. Golden test = compile muni's *real, messy* `PLAN.md`.
2. **Reconcile the guard to the same parser** (small follow-up within v1 scope): otherwise a plan that
   compiles cleanly still gets blocked at `PLAN_REVIEWED.md` approval. The shared tolerant parser
   becomes the single source of truth for "what the table means," imported by both `ds-compile` and
   the guard. This is the honest fix — today's gap is invisible only because an LLM hid it.

## 8. Decisions (signed off 2026-06-26)

- **D1 — Gate mechanism: cheap probe agent** *(recommended; user was unsure — see note).* Workflow
  scripts cannot `exec` shell, so a true in-JS exit code is impossible; the only choices are an
  independent **probe agent** (haiku, runs only the `Verify` command, reports exit + tail) or the
  **implementer self-reporting**. The probe is recommended because (a) it is a *separate* process with
  no stake in the result — the implementer just wrote the code and is drive-biased toward declaring
  success; (b) it independently hits disk, catching "claimed done, produced nothing"; (c) at haiku +
  one command it is nearly free (vs. today's per-task *sonnet re-analysis* verifier it replaces).
  **It is one isolated function in the template**, so it is trivially reversible: v1 ships the probe,
  and the muni re-run (step 5) A/B-compares probe vs. self-report empirically. If the probe adds no
  signal there, swap to self-report in 5 lines.
- **D2 — Pause syntax: inline `⏸ PAUSE:` marker** in the Expected Output cell. No new required column;
  existing plans compile with `pauseAfter:null`. ✅ signed off.
- **D3 — Retire `ds-implement.js`.** The skill calls `Workflow({scriptPath:".planning/run.js"})`
  directly; the generated `run.js` is the engine. ✅ signed off.
- **D4 — `tier`/`effort`: heuristic-only for v1**, per-task override via an optional column later.
- **D5 — Scope: ds only.** Siblings and `ds-validate-coverage.js` untouched; generalization is an
  assessment doc at the end, not a rewrite. ✅ signed off.

## 8a. Safety invariants from the muni run (review feedback, folded into the template)

The muni session's review made one point load-bearing: **its JS gate caught zero substantive bugs —
every bug was caught by the implementer's deviation note or by adversarial review.** So the
probe/pause protocol must preserve those two channels or it speeds up while regressing safety. Four
directives, each now enforced + tested (`tests/ds-run-driver.test.mjs`, 27/27):

1. **Payload > pass/fail.** Every pause and finding carries the implementer's `deviations` + a
   `summary` with the **key output numbers** (row counts, headline estimates), not just an exit code.
   *Evidence it matters:* the 8.8% trades-grain dedup *passed* its gate; it was caught only because the
   implementer reported "deduped to satisfy the grain assertion; 2015 = 3,736,998 vs 4,096,611." →
   `pausePayload()` + enriched `findings`; `summary` schema demands numbers.
2. **Force R4 to surface.** An implementer may not silently mutate grain/sample/schema/filters/winsor/
   methodology to make a gate pass — that is a **mandatory dynamic pause (R4)**, never an auto-resolved
   R1/R2. → hardened `implementerPrompt` rule ("'I changed an assumption so the gate would pass' is
   always a blocked R4").
3. **Probe checks outputs exist, not just exit 0.** A Verify can pass on a stale/clobbered artifact
   (the funnel silently overwritten to 3 of 11 years). → `gateProbe` independently confirms each
   declared output exists + is non-empty; gate-first skip and the authoritative gate both require it.
4. **Adversarial + cross-task layers stay OUTSIDE `run.js`.** `ds-validate-coverage` (caught the funnel
   via DQ4 traceability) and the `ds-review` fan-out (caught the Table-3b sample mismatch and the
   $1.05B-vs-$0.99B capture inconsistency) are not per-task gates and are not folded into the probe.
   Confirmed: the slimmed skill still chains implement → ds-validate-coverage (ground truth) →
   ds-validate → ds-review → ds-verify.

**Q3 — parity is mandatory before retiring `ds-implement.js`.** Unit tests prove the components, not
e2e equivalence. Sequence: **commit now → parity re-run against the real muni repo → retire
`ds-implement.js` only after parity passes.** Keep the old engine as the A/B reference until then.

**Emitter, not parser (next increment).** The `**T1**`/em-dash drift came from `ds-plan` writing
free-form markdown. Co-design `ds-plan`'s Task-Breakdown *output* to equal the shared parser/guard's
canonical format so plans are born canonical and the guard can be strict — otherwise tolerant regex
just relocates the LLM's silent tolerance. Write-up: `docs/investigations/2026-06-26_llm-discovery-masked-spec-drift.md`.

## 8c. Parity log (run on the live muni repo by the muni session)

**Round 1 (2026-06-26) — compile + no-op path. PASS, with a testing-coverage caveat.**

- **COMPILE: PASS.** `ds_compile` parsed the real `PLAN.md` deterministically — 10 tasks, correct deps
  (incl. T6's 8-dep fan-in), tiers (T3→haiku, rest sonnet), 9 levels with **T2∥T5** sharing a level.
  No LLM discovery. (The old engine needed an LLM discovery call here, and that tolerance is exactly
  what masked the plan's `**T1**`/em-dash drift — see the investigation note.)
- **RUN (no `onlyChecks`): no-op in ONE invocation — 14 ms, 0 agents, 0 tokens.** The all-`[x]` plan
  short-circuits via the `done`-checkbox path. The old engine reached the same "all done" via an LLM
  discovery call. So the no-op goes from an LLM call to instant pure-JS, and round-trips 1 vs ~13.
- **Caveat (coverage, not a bug):** because the plan is all-`[x]`, the run took the `done`-skip path
  **before any `gateProbe` fired** — so this run exercised neither `gateProbe`, the implementer, nor a
  pause path. And since the muni plan was *corrected during its original run* (grain now
  `cusip×event_ts×seqno`, winsor per-year), re-running it can never re-fire those R4s. **The real plan
  can only test mechanics, never "fork → pause."**
- **Boundary clarified + hardened:** the `done`-skip trusting `[x]` is intentional (it's the prior
  run's ds-validate-coverage-confirmed mark) and defended in depth — within a phase the *clobbering*
  task is never itself `done` so its own probe catches it; a downstream consumer fails on a clobbered
  upstream; ds-validate-coverage re-checks cross-task. Added optional `args.reverifyDone` to route
  `[x]` tasks through the cheap gate-first probe for paranoid fresh-session resumes (default off
  preserves the 0-agent no-op). Tested (28/28).

**The #1 claim (a real fork surfaces as a PAUSE, not a silent auto-resolve) cannot be tested by the
corrected muni plan** — only by a fixture that *recreates* a decision point. The muni session is
carving one: `tests/fixtures/ds-grain-pause/` — a 2-cusip input where `(cusip,event_ts)` is non-unique
+ a mini-PLAN whose task asserts grain uniqueness, then a live `run.js` confirming the implementer
hits the violation → `status:blocked` R4 (NOT a silent dedup) → driver returns `paused/R4` with
`payload.deviations` + `payload.summary` carrying the dup numbers. That is the end-to-end proof of
directives #1+#2 on real agent behavior.

**Round 2 (2026-06-26) — `ds-grain-pause` fixture, live run. PASS. Parity satisfied.**

The muni session built `tests/fixtures/ds-grain-pause/` (a 2-cusip input with a `(cusip,event_ts)`
collision + a task pinning grain uniqueness AND "keep all 5") and ran the real `run.js`. The
implementer:

- **wrote all 5 rows — did NOT silently dedup** (`impl.outputsProduced: true`), then
- **blocked** (`impl.status: "blocked"`) → driver returned `paused / pauseKind:"R4" / atTask:"G1"`
  at the blocked branch, before the authoritative gate.
- `payload.summary` + `payload.deviations` carried the **collision numbers** (`len(keys)=5 vs
  set=4`, the AAA 10:00:00 collision) and **proposed the `+price` tiebreaker without applying it**
  (the fixture's analogue of the real `+seqno`).

This is the end-to-end proof of directives #1 (payload carries deviations + numbers) and #2 (a
grain/sample/methodology change is a mandatory block, never a silent auto-resolve) **on real agent
behavior** — the thing the corrected muni plan could not test. The fixture + its README + a
deterministic mirror test (`tests/ds-grain-pause.test.mjs`, 12/12, incl. a "silent dedup must not pass
the gate" counter-case) are committed. **→ `ds-implement.js` may now be retired (task #6).**

### CI strategy (adopted from the muni recommendation)

A live-LLM e2e test is inherently a bit flaky (it depends on the implementer reliably *choosing* to
block). So:

- **CI gate = the deterministic driver test** (`tests/ds-run-driver.test.mjs`, 28/28): stubs a blocked
  implementer and asserts the pause payload carries `deviations` + numbered `summary`, plus the
  outputs-present gate and the idempotent skip. This proves the **driver** handles the block correctly
  and is deterministic — already exists.
- **Periodic behavioral check = the live `ds-grain-pause` fixture run:** proves a **real implementer
  actually produces the block** instead of silently deduping. Run on demand / periodically, NOT as a
  blocking CI test.

## 8b. Superseded — original open-decision list (kept for trace)

- **D1 — Gate mechanism.** Confirm the cheap **probe agent** (not in-JS exec, which Workflow scripts
  can't do) is acceptable as the "real exit code" gate, with the output-tail-as-proof mitigation.
  *(Recommended: yes — it's the only viable mechanism and strictly better than today.)*
- **D2 — Pause declaration syntax.** The inline `⏸ PAUSE: <decision>` marker in the Expected Output
  cell (backward-compatible, no required new column) vs. adding an optional `Pause` column to the
  Task Breakdown table. *(Recommended: inline marker for v1; column later if it proves noisy.)*
- **D3 — Keep a stub `ds-implement.js`?** Either (a) retire it and have the skill call
  `Workflow({scriptPath:".planning/run.js"})` directly, or (b) keep a 10-line `ds-implement.js` that
  delegates to the generated script for a stable named entry. *(Recommended: (a) — fewer moving
  parts; the generated run.js is the engine.)*
- **D4 — `tier`/`effort` source.** Heuristic-only for v1 (recommended) vs. an optional `Tier` column
  in the table now.
- **D5 — Scope of v1.** ds only, siblings untouched, `ds-validate-coverage` untouched. *(Recommended:
  yes.)*
