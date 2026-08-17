# Gate laws — getting a JS-computed gate right

Applies to any workflow whose gate is computed **in JS** and returns a boolean the skill trusts without
recomputing (`overallPass`), a `findings` list, and a **re-run selector** the fix loop feeds back as
`onlyTasks`/`onlyChecks` alongside carried prior results. Each failure mode below is structural, and silent.

## L1 — The return shape is a contract, and drift is silent

The documented `returns { ... }` line, the script's actual `return { ... }` keys, and the selector's
**id-namespace** must all agree. **Failure mode:** a mismatch never errors. `onlyTasks: result.<wrongKey>`
evaluates to `undefined`, the selector reads as `null`, and the loop falls back to re-running *everything* — a
silent full regeneration wearing the costume of a working incremental loop.

**Incidents:** a workshop skill documented `slidesThatFailed` while the JS returned `sectionsThatFailed`; every
"targeted re-run" quietly regenerated the whole deck. A consumer repeated the defect with a different key pair.

Round-trip the **namespace**, not just the key name: the ids inside the selector must be the same id-space the
script's filter matches against (task ids, section slugs, file paths). A key-name match with a namespace
mismatch is the same bug in a different hat. Check with a deterministic lint, never by eye.

## L2 — The selective re-run is a second execution path

`onlyTasks`/`priorResults` is not a shortcut layered on the full run — it is a second, less-tested path
through the same script. **Failure mode:** defects hide there because the full path is what gets eyeballed
while authoring, so the loop looks like it iterates while the selective path quietly does less each round.

**(a) No vacuous empty-set pass.** `[].every(...) === true`. Never render a pass for a set that was non-empty
in the full run or skipped this time; render "skipped / carried" with a visibly distinct status.

**(b) Verification must survive the selective path.** An `if (ONLY) continue` that disables adversarial
verification on a re-run is a convergence blocker: the loop appears to iterate but never re-checks the thing
that mattered. **Incident:** a verifier's own worst bug disabled all verification under `onlyChecks`, so every
re-audit after iteration 1 was unverified. Another skipped a review dimension the same way and passed
vacuously, letting a violating artifact survive.

**(c) Carry-forward is a union that writes corrections back.** Returned results (next iteration's
`priorResults`) must be `[...live, ...carried]`, with any correction made this run written into the carried
record. **Incident:** without the write-back a refuted finding phantom-reflags forever — corrected every run,
never sticking. Omitting the union instead shrank prior results on each re-run.

## L3 — `overallPass === false` must imply a non-empty selector

The selector is typically read as `x?.length ? new Set(x) : null`, so an **empty** selector on a failing run
means "re-run everything," not "nothing to fix." **Failure mode:** a whole-artifact failure — a compile error,
an alignment check, a mechanical probe — flips `overallPass` false while every per-item row still passes,
yielding an empty per-item selector and a full regen with no target. This recurred in multiple engines.

The selector must cover **every** path that can set `overallPass` false, including whole-artifact failures no
single item owns. Such a path needs its own selector channel alongside the per-item one, and the fix loop must
consume both.

Two corollaries. Every fail condition emits an actionable finding attributed to its owning check — a gate that
flips false but pushes nothing into `findings` leaves the fix loop with "0 findings" and nothing to target.
And the rendered status boolean must derive from the **same data** as the blocking findings. **Incident:** a
verifier rendered a red X from `constraintsPassed` while the gate blocked on `constraintFailures`, empty by
construction — a violating deck shipped with `overallPass=true` under a red X that blocked nobody.

## L4 — Fail closed on an absent or null agent result

A dimension gated as `!(x?.findings || []).some(...)` reads as vacuously clean whenever `x` is absent —
dropped by `.filter(Boolean)`, never dispatched, or not carried forward. **Failure mode:** an agent that
crashed and returned null is indistinguishable from one that found nothing, so a dead leg reads as a pass.

Every gated dimension needs a **presence guard** (`!!x`, `score !== null`) distinct from its pass/fail logic,
and the gate must distinguish a **crash-drop** (threw or returned null unexpectedly → fail, or mark
unreliable) from an **intentional skip** (not dispatched this round by design → `n/a`, neither pass nor fail).
Track a dispatched-set so the two are separable; several independent incidents conflated them. Guard every
**single** `await agent(...)` call with declared null semantics — a pipeline leg synthesizes a critical finding
and continues rather than crashing the gate. **Incident:** a verifier TypeError'd dereferencing a null
single-agent result. Fan-outs may keep `.filter(Boolean)`; the single call is where this bites.

## L5 — Self-report is not a gate

If a gate field is produced by the same agent whose work it certifies, it is decoration. **Failure mode:** the
gate reports what the worker claims, so a worker that silently did nothing still passes.

Ground every self-certified field: a **deterministic JS check** when the data is already in context (cheapest,
do this first), else a cheap low-effort probe agent — not the same agent, not the same call. For artifacts,
capture the exit code (`... ; echo EXIT=$?`) and pair it with a remove-stale-then-test-present probe, so
"compiled" means *this run* produced the artifact rather than a leftover. **Anchor status greps:**
`grep -q '^status: APPROVED'`, never bare `grep APPROVED` — the latter matches unrelated frontmatter like
`requires: [..._APPROVED]` and false-passes. **Incidents:** a generator trusted a self-grepped inventory the JS
never re-checked; a consumer displayed a self-reported "artifacts present" field it never verified.

## L6 — `node --check` is not an eval test, and adversarial verification is load-bearing

**Failure mode:** a stray backtick inside a template-literal prompt string passes `node --check` — it is
syntactically valid JS — and then crashes the runtime at `eval()` when the template is actually interpolated.
A syntax check tells you nothing about whether the script runs.

The cheap real smoke test: launch the script with a bogus target and confirm it reaches its **own**
arg-validation error, not a crash inside prompt construction. Keep runnable docstring examples; they double as
free regression tests.

Adversarial verification is not a rubber stamp — across two campaigns it refuted roughly a quarter of
plausible finder claims. **Failure mode:** verified against synthetic inputs it rubber-stamps; one campaign
caught three finder claims built on fabricated inputs a synthetic-input verifier would have waved through.
Exercise it against **real** inputs, and keep it permanent rather than launch-time-only.
