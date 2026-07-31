# Compiled-runner templates (`spec → plan → compiled run.js`)

These are the compile **targets** for workflow-creator's compiled-runner pattern — the default execution skeleton for any workflow that runs a **DAG of mechanical work between human gates** (an implement/transform/generate phase driven by a structured plan table).

> 📊 **New here? Read `docs/compiled-runner-architecture.md` first** — a visual, code-grounded walkthrough (mermaid diagrams) of how the whole `spec → plan → compile → run.js` machinery actually runs: the splice, the driver loop, `gateProbe`, return-reasons, pause/resume.

> **Pattern reference:** `skills/workflow-creator/references/dynamic-workflow-migration.md` and `docs/compiled-runner-architecture.md`. Historical dev compiler designs remain under `docs/DESIGN-dev-spec-plan-compile.md`, but dev is no longer a live consumer of these templates.

| File | Role |
|------|------|
| `run-core.js` | **THE shared driver core (pass #9).** ONE copy of the topo/level/`runTask`/`returnReason`/`intraLevel` driver + helpers + unified `TRANSFORM_SCHEMA` + the six doctrine invariants. The compiler SPLICES it with a per-domain fragment into a self-contained `<project>/.planning/run.js`. Holes: `__META__/__PROJECT__/__TASKS__/__GLOBAL_CONSTRAINTS__/__LEVEL_MODES__/__TASK_BODIES__`. |
| `compiled-runner-template.js` | **Generic FRAGMENT skeleton (birther).** Copy to `<domain>-task.js` and fill the three injected fns (`gateProbe`/`implementerPrompt`/optional `recheckTrigger`) + write `<domain>_compile.py` per its header recipe. Carries NO driver — the driver is `run-core.js`, spliced at compile time. (Earlier monolithic run templates were deleted in the birther-convergence pass; live compiler-backed domains use `run-core.js` + `<domain>-task.js`.) |

## How a runner is born — the emitter/guard/parser triple

```
SPEC ──▶ PLAN-EMITTER phase  ← emits BORN-CANONICAL table format (doctrine #6)
            │
            ▼
          PLAN (structured task table)
            │
            ├─ hooks/<domain>-plan-executable-guard.py   ← STRICT: structure only (cycles/missing/dangling), NEVER format
            │     └─ imports ─┐
            ├─ scripts/<domain>/<domain>_plan_table.py ◀─┘  deterministic parser, SINGLE source of truth (tolerance = back-compat shim)
            │
            └─ scripts/<domain>/<domain>_compile.py       ← produce the work-list; deterministic, NO LLM
                  └─ emit CODE (<project>/.planning/run.js)  OR  DATA (a work-list a generic runner consumes)
                        └─ Workflow({ scriptPath: ".planning/run.js" })  or the generic engine reads the work-list

DS and dev no longer use this compiler/parser path. Their receipt-selected native generated plans
are adapted directly to `workflows/beat-implement.js` by their implementation skills.
```

There is **no LLM "discovery" agent** anywhere in this chain. An LLM between the structured plan and the strict guard absorbs spec-drift invisibly (the retired generic-interpreter anti-pattern; wc-audit flags it `executionClass=generic-interpreter` → critical). **Emitting only parser + guard (no canonical emitter) half-applies the rule — it relocates the tolerance into regex instead of removing it.**

## The four INJECTED seams D1-D4 (the ONLY things that change per domain)

1. **D1 `gateProbe(t)`** — how a task is gated, returning `{pass, artifactsPresent, evidence, scope}` (canonical names; `pass` ⊥ `artifactsPresent` — the core ANDs them). **`pass` is ALWAYS deterministic** (exit code or mechanical floor — never a returned judgment, so nothing in the runner to game). The fork is *sufficiency*: exit-code (for a compiler-backed domain such as the historical DS runner — the gate IS the probe) vs a **necessary-not-sufficient floor** (writing — the sufficient authority is the adversarial review OUTSIDE run.js). `scope` (`checked`/`not-checked`) discloses the floor's blind spot — a clean `pass` must not over-claim coverage it doesn't have (doctrine #3). Pick the trust-class via interview Q7.
2. **D2 `implementerPrompt(t)`** — how one task is produced (output-first vs TDD failing-test-first + the domain's R4 assumption-change list). Keep the mandatory-R4 block + stale-gate backstop verbatim.
3. **D3 `columns` / task-spec shape** — what the plan table carries (`__TASKS__`): `id, name, deps, outputs, expectedOutput, verify, implements, kind, tier, effort, done, pauseAfter, taskText`.
4. **D4 tier/effort policy** — `t.tier`/`t.effort` is supplied by the domain. Pull it out of the shared compiler.

**NOT a seam — intra-level parallel-vs-sequential is CORE, compiler-DERIVED:** parallel IFF a level's declared outputs are provably **disjoint**; a shared tree runs sequentially by construction. Never hand-set it; never ask the author. (This killed the earlier `D5` proposal.)

## The doctrine invariants (baked into the core — do NOT re-derive them)

1. **payload > pass/fail** — pauses/findings carry `deviations` + a NUMBERED `summary`, never a bare exit code.
2. **mandatory R4** — an assumption/contract/grain/schema change BLOCKS (pause); a stale-gate backstop re-blocks rather than reverting to pass a stale gate.
3. **probe corroborates the artifact** independently of the pass signal (a pass can be stale OR gamed) — **and a deterministic floor discloses its blind spot** via `scope`: a clean `pass` must not over-claim coverage it doesn't have (the floor's analog of the "vague-evidence pass = a judge's robe" guard).
4. **adversarial layer OUTSIDE run.js** — separate workflow/skill phase; PRIMARY (not a backstop) when the gate is a judgment.
5. **no LLM between a structured producer and a strict checker** — parse deterministically.
6. **emitter-canonical** — one format spec shared by emitter, parser, guard; strict-at-emitter / tolerant-at-parser; the emitter writes born-canonical so the guard can go strict.

## The runner yields on a RETURN-REASON (the skill loop branches on it)

`done` · `hard-fail` · `pause-human` (declared ⏸ or dynamic R4 — a human decision) · `yield-for-recheck` (an automated cross-cutting gate, such as a full suite; no human). Never model a `yield-for-recheck` as a human pause.

## Discipline

- **Golden-test the parser against a REAL spec**, not the template — the template can't reveal the format drift an LLM was masking.
- **Retire the old engine only after parity is proven** on a real spec.
- **Do NOT extract a shared `run-core` until a 2nd domain runs on the template** — extracting from one domain bakes in its isms. The **judgment gateProbe floor** and the **data compile-emit form** are now confirmed by writing (PR#18, parity passed) — three instances total — but they stay cleanest as **injected interfaces**, so keep them injected even post-extraction (don't fold a domain shape into the core).
