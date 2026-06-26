# Compiled-runner templates (`spec → plan → compiled run.js`)

These are the compile **targets** for workflow-creator's compiled-runner pattern — the default execution skeleton for any workflow that runs a **DAG of mechanical work between human gates** (an implement/transform/generate phase driven by a structured plan table). See `skills/workflow-creator/references/dynamic-workflow-migration.md` §0 for the doctrine and `docs/DESIGN-ds-spec-plan-compile.md` / `docs/DESIGN-dev-spec-plan-compile.md` for the rationale.

| File | Role |
|------|------|
| `compiled-runner-template.js` | **Generic reference.** Copy to `<domain>-run-template.js` and fill ONLY the three seams. The driver + the four safety invariants are baked in — leave them alone. |
| `ds-run-template.js` | Live instance — **output-first / produced-artifact** gate (needs the outputs-exist probe), parallel within-level, tiered model. |
| `dev-run-template.js` | Live instance — **TDD / exit-code** gate (RED→GREEN), sequential shared-tree. |

## How a runner is born

```
SPEC ──▶ PLAN (structured task table)
            │
            ├─ scripts/<domain>/<domain>_plan_table.py   ← deterministic, prefix-tolerant parser (SINGLE source of truth)
            │     └─ imported verbatim by hooks/<domain>-plan-executable-guard.py  (compiles ⇔ passes gate)
            │
            └─ scripts/<domain>/<domain>_compile.py       ← fills the template's holes; deterministic, NO LLM
                  └─ writes <project>/.planning/run.js  ──▶  Workflow({ scriptPath: ".planning/run.js" })
```

There is **no LLM "discovery" agent** anywhere in this chain. An LLM between the structured plan and the strict guard absorbs spec-drift invisibly (the retired generic-interpreter anti-pattern; wc-audit flags it `executionClass=generic-interpreter` → critical).

## The three seams (the ONLY things that change per domain)

1. **`columns` / task-spec shape** — what the plan table carries (`__TASKS__`): `id, name, deps, outputs, expectedOutput, verify, implements, kind, tier, effort, done, pauseAfter, taskText`.
2. **`implementerPrompt(t)`** — how one task is produced (domain role + the domain's R4 assumption-change list). Keep the mandatory-R4 block + stale-gate backstop verbatim.
3. **`gateProbe(t)`** — how a task is gated, returning `{pass, outputsPresent, evidence}`. The real fork: exit-code (ds/dev) vs mechanical-floor vs semantic judgment. Pick via interview Q7.

## The four safety invariants (baked into the driver — do NOT re-derive them)

1. **payload > pass/fail** — pauses/findings carry `deviations` + a NUMBERED `summary`, never a bare exit code.
2. **mandatory R4** — an assumption/contract/architecture change BLOCKS (pause); a stale-gate backstop re-blocks rather than reverting to pass a stale gate.
3. **probe asserts artifacts-exist** — `outputsPresent` is checked independently of the gate (a gate can pass on a stale/clobbered artifact).
4. **adversarial layer OUTSIDE run.js** — the full-suite/review/verify layer is a separate workflow or skill phase, never inside the compiled runner. For semantic gates this is load-bearing, not a backstop.

## Discipline

- **Golden-test the parser against a REAL spec**, not the template — the template can't reveal the format drift an LLM was masking.
- **Retire the old engine only after parity is proven** on a real spec.
- **Do NOT extract a shared `run-core` until a 2nd domain runs on the template** — extracting from one domain bakes in its isms.
