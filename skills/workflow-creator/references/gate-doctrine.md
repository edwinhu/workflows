# Gate Doctrine — self-grading workflows

## WHEN IT APPLIES

Any workflow whose gate is **computed in JS** and returns:
- `overallPass` (or `substratePass`/`gate` — a boolean the skill trusts without recomputing),
- a `findings` list, and
- a **re-run selector** (`*ThatFailed`, `reviewersThatFlagged`, `sectionsThatFailed`, etc.) that a
  `/goal` fix-loop consumes as `onlyChecks` on the next iteration, alongside `priorReviews` for
  carry-forward.

This is the shape of `wc-audit.js`, `wc-generate.js`, and every compiled-runner / review-fan-out
workflow this skill scaffolds (`workshop-verify`, `dev-verify`, teaching's exam/lecture gates,
etc.). If a workflow you are creating or auditing matches this shape, the laws below are
**mandatory reading** — they are lessons paid for twice, once in this repo (PRs #50-#55) and once
in a sibling course-materials campaign, and they recur because the failure mode is structural, not
accidental.

**Cross-references, not duplicates** — these laws build on doctrine already in this SKILL.md;
don't re-derive what's already there:
- The `matcher` vs `GATE_BLOCKED_TOOLS` landmine (SKILL.md ~line 358) and the P20 mechanical
  sub-probe (~line 1695) already cover hook/matcher mismatches for `Agent`/`Workflow` fan-outs. L7
  below extends this to the `Workflow`-dispatch case explicitly — it does not restate it.
- D1's `gateProbe` contract (~line 669) already requires `pass ⊥ artifactsPresent` as two
  independent booleans, never trusting `pass` alone. L4/L5 below generalize this beyond the
  compiled-runner D1 seam to every self-report field on any gate.
- The compiled-runner principles P22-P30 (a CONDITIONAL cluster in `wc-audit.js`) already audit
  the `gateProbe`/parser/emitter machinery for the DAG-of-mechanical-work case. This doctrine is
  broader: it applies to ANY self-grading gate, compiled-runner or not (a pure review fan-out like
  `wc-audit` itself is in scope and is NOT a compiled runner).
- `tests/workflow_return_shape_test.py` already exists in this repo and mechanically checks L1's
  return-shape contract. **Run it, don't rewrite it.**

---

## L1 — Return shape is a compiled contract, not hand-written

**Invariant:** the SKILL's `returns { ... }` documentation line, the script's actual
`return { ... }` keys, and the re-run selector's id-namespace must all agree.

**What it prevents:** a mismatch never errors. `onlyChecks: result.<wrongKey>` evaluates to
`undefined`, the re-run selector reads as `null`, and the loop falls back to re-running
*everything* — a **silent full regeneration** that looks like a working incremental loop.

**Evidence:**
- This repo: a workshop SKILL documented `slidesThatFailed`; the JS actually returned
  `sectionsThatFailed`. Every "targeted re-run" silently regenerated the full deck.
- course-materials: the same defect, third cross-repo sighting — `lecturesThatFailed` in the doc
  vs `sectionsThatFailed` in the return.

Also round-trip the **selector namespace**, not just the key name: the ids inside
`*ThatFailed` must be the same id-space the script's `ONLY` filter matches against (dimension
keys, section slugs, file paths — whichever the workflow uses). A key-name match with a
namespace mismatch is the same silent-full-regen bug wearing a different hat.

**Author it right:** run `python3 tests/workflow_return_shape_test.py` against any workflow you
generate or audit. It cross-references every `returns {...}` doc line against the workflow's real
`return {...}` keys and fails loud on drift — this is the deterministic lint that would have
caught all three sightings above. Do not hand-verify this; run the lint.

---

## L2 — The selective re-run is a second execution path — audit it as first-class

`ONLY` / `onlyChecks` / `priorReviews` is not a convenience shortcut on top of the full-run code
path — it is a **second, less-tested execution path** through the same workflow, and defects hide
there because the full-run path is what gets eyeballed during authoring.

**(a) No empty-collection vacuous pass.** `[].every(...) === true` must never render `✅` when the
underlying set was non-empty in the full run or was skipped this time — render "skipped / carried"
with a visibly distinct status, never a bare pass.

**(b) Enforcement/verification must survive the ONLY path.** An `if (ONLY) continue` that disables
adversarial verification on a re-audit is a convergence blocker — the loop appears to iterate but
never re-checks the thing that mattered.
- This repo: `wc-audit`'s own worst bug — the ONLY path disabled all verification on Mode-3
  re-audits, meaning every re-audit after iteration 1 was unverified.
- course-materials: `workshop-verify` skipped all diagram review under `ONLY` and passed
  vacuously — a violating deck could ship clean simply by having survived to a re-run.

**(c) Carry-forward is a union that writes verdicts back.** The returned `reviews` (which becomes
next iteration's `priorReviews`) must be `[...live, ...carried]`, AND any verifier correction made
during this run must be written back into the carried record.
- This repo: without the write-back, a refuted finding phantom-reflags forever — the verifier
  corrects it every run but the correction never sticks in the carried state.
- course-materials (R3-H2): without the union, results from an earlier run are silently dropped on
  the 2nd+ re-run — `priorReviews` shrinks instead of accumulating.

---

## L3 — The gate is a 3-way contract (overallPass ⇔ findings ⇔ selector), kept consistent

**(a) Invariant:** `overallPass === false ⟺ selector non-empty`. The selector is typically read as
`x?.length ? new Set(x) : null` — so an **empty** selector on a failing run means "re-run
EVERYTHING," not "nothing to fix." A whole-artifact failure (compile error, alignment check) where
every per-item row still passes yields an empty per-item selector on a `overallPass=false` run →
full regen with no target. The selector must cover **every** path that can set `overallPass=false`,
including whole-artifact-level failures that no single item owns (course-materials R3-H1, both
lecture engines hit this).

**(b) Every fail condition must emit an actionable finding attributed to the owning check.** A
binary gate that can flip `overallPass` to false but pushes nothing into `findings` leaves the
`/goal` loop with "0 findings to fix" and nothing to target (course-materials R4-J1).

**(c) The boolean that renders a status row must derive from the SAME data that produces blocking
findings.** A display-only boolean is a probe-detectable smell.
- This repo: `workshop-verify` rendered `❌` from `constraintsPassed` but the actual gate blocked
  on `constraintFailures`, which was always empty by construction — a violating deck shipped with
  `overallPass=true` while the UI showed a red X nobody was blocked by.

---

## L4 — Fail closed on an absent/nullable signal

A dimension gated as `!(x?.findings || []).some(...)` reads as vacuously clean whenever `x` is
absent — dropped by a `.filter(Boolean)`, never dispatched, or not carried forward. Every gated
dimension needs an explicit **presence guard** (`!!x`, `score !== null`) distinct from its
pass/fail logic.

Distinguish a **crash-drop** (an agent call threw or returned null unexpectedly → should fail or
mark unreliable) from an **intentional selective-skip** (this dimension wasn't dispatched this
round by design → should read `n/a`, not pass or fail). Track a `dispatchedPairs`-style set so the
gate can tell these apart (course-materials R2-G2 / R4-J2 / R4-J3 conflated the two).

Guard every **single** `await agent(...)` call (not a fan-out) with declared null semantics:
- Discover-type calls → throw with a clear re-invoke message.
- A pipeline leg → synthesize a critical finding and continue, don't crash the whole gate.

Fan-outs (`Promise.all` over N agents) stay `.filter(Boolean)` as today — this guard is
specifically for the single-call case, which this repo's `workshop-verify` TypeError'd on (a null
single agent result was dereferenced directly, no guard).

---

## L5 — Self-report is not a gate — pair every self-certified field with an independent probe

If the gate field is produced by the same agent whose work it certifies, it's decoration, not
verification. Ground every self-certified field:
- A **deterministic JS check** when the data is already in-context (cheapest, do this first).
- Else a cheap `{effort: 'low'}` probe agent — not the same agent, not the same call.
- A captured exit code (`... ; echo EXIT=$?`) plus an `rm`-stale-then-`test -s`-present probe, so
  "compiled" means *this run* produced the artifact, not a stale one left over from a prior run.
- `grep -q '^status: APPROVED'` (anchored), never bare `grep APPROVED` — the latter matches
  unrelated text like `requires: [..._APPROVED]` in frontmatter and false-passes.

**Evidence:** this repo's `workshop-generate` trusted a self-grepped `citedInventory` the JS never
independently re-checked; course-materials R2-G8/G9/G10 and R1-D's `artifactsPresent` self-report
had the same shape — a field the JS displayed but never verified.

---

## L6 — When a parser feeds both a guard and the workflow, the doc's authoring template must be exactly what the parser accepts

"Parses ⇔ passes the guard" (already doctrine #6, emitter-canonical, in this skill) only holds if
the **doc that teaches authors how to write the artifact** produces the form the parser actually
accepts. Emitter-canonical is the general fix; this is the specific failure mode to check for at
audit time.

**Evidence:** course-materials shipped an `issues.md` authoring template as a **table**; the
parser rejected tables outright. The executable guard false-denied a valid, correctly-written
spec. The parser's own docstring even admitted the table form "false-denied the real spec" — but
the authoring doc was never migrated to match what the parser accepted (R2-G5). The bug was
documented in the code and shipped anyway because nobody cross-referenced doc example ⇔ parser
acceptance.

---

## L7 — Hook matcher + trigger must match what the pipeline actually emits — REPL at authoring time

(Extends the existing line-358 landmine and the P20 sub-probe — read those first; this adds the
cases they don't already name.)

- `matcher: Agent` while the phase actually fans out via `Workflow` (a Claude Code ultracode
  workflow tool call, not an `Agent` tool call) → the hook never fires; ungated (course-materials
  R2-G1). If your workflow migrated a fan-out phase to an ultracode `Workflow` per this skill's own
  migration playbook, its gate hooks must be re-matched to `Workflow`, not left on `Agent`.
- A check keyed on the tool string `typst compile` while the pipeline actually invokes
  `tinymist compile` — a rename in the invoked tool silently orphans the hook.
- A regex requiring the target path as the first token, when the real invocation is
  `tinymist compile --input x=y file.typ` (target is not first) — the regex never matches.
- `projectDir` read from `args.projectDir`, which `Agent` tool calls never carry — read
  `hook_input.cwd` instead.

**The failure mode is always a silent exit-0 no-op** — invisible without a REPL against the real
emitted commands/paths/tool-input shapes. At authoring time, don't reason about what the hook
*should* match — dispatch one real call and inspect what the hook actually receives.

---

## L8 — Detect and fix must share one predicate

Scaffold detect/fix as one shared iterator consumed by both functions, not two independently
written passes that are supposed to "use the same rule." A count-based fixer that re-encodes a
detector's predicate by hand will drift the moment one sibling gets a guard the other lacks.

**Evidence:** this repo — a leading-tab-stripping pass silently lacked the front-matter guard its
sibling passes had, while the SKILL text claimed "same guard applies to all passes." The guard was
implicit in each hand-copied predicate, not shared.

---

## L9 — Shared-core extractions prove zero per-domain behavior change

When you extract a shared driver/core from N domain-specific copies (e.g. `run-core.js` splicing
per-domain fragments), per-domain differences must become **explicit, compiled config** — a named
hole the fragment fills — never something that survives implicitly because "that's the branch that
happened to merge cleanly." Golden-lock each domain's gate semantics (a snapshot test against real
inputs) **before** extracting, so a semantics change during extraction fails loud instead of
shipping silently.

**Evidence:** this repo — a `run-core` extraction cross-applied one domain's column-access logic
to another domain and weakened a second domain's outputs-gate, because neither domain's exact
pre-extraction behavior had been golden-locked first.

---

## L10 — Enforcement prose claims are testable assertions

Every "wired via X" / "blocks Y" / "logged, never silent" claim in a SKILL.md or workflow doc
cross-references an actual mechanism — a hook, a schema field, a JS check — not just other prose
asserting the same thing. **Audit the exemplars in workflow-creator itself first**, since authors
copy them verbatim into every workflow this skill generates; an unenforced claim in an exemplar
propagates to every workflow scaffolded from it.

---

## L11 (meta) — put these two in both checklists below

- **`node --check` is not an eval test.** A stray backtick inside a template-literal prompt string
  passes `node --check` (it's syntactically valid JS) and then crashes the Workflow runtime at
  `eval()` when the template literal is actually interpolated. The cheap REAL smoke test: launch
  each workflow with a bogus `projectDir` and confirm it reaches its **own** arg-validation error
  (not a crash inside a prompt-building template literal). Self-documenting docstring examples
  double as free regression tests — keep them runnable.
- **Adversarial verification is load-bearing and must itself be regression-tested.** Across both
  campaigns it refuted roughly a quarter of plausible finder claims — it is not a rubber stamp.
  Verify it against REAL inputs, not synthetic ones: course-materials caught 3 finder claims that
  had used fabricated inputs, which a synthetic-input verifier would have rubber-stamped.

---

## DESIGN-TIME CHECKLIST (apply when scaffolding a new self-grading gate)

- [ ] `returns {...}` doc, the script's `return {...}`, and the re-run selector's id-namespace are
      the SAME contract — plan to run `tests/workflow_return_shape_test.py` on the generated file (L1).
- [ ] The `ONLY`/`onlyChecks` path is designed as a first-class execution path: no vacuous
      empty-set pass, verification runs on the ONLY path too, carry-forward is a union that writes
      verifier corrections back (L2).
- [ ] `overallPass === false ⟺ selector non-empty` holds for EVERY fail condition, including
      whole-artifact-level failures with no single owning item; every fail condition emits a
      finding; the rendered status boolean is the same data as the blocking boolean (L3).
- [ ] Every gated dimension has an explicit presence guard, distinguishes crash-drop from
      intentional-skip, and every single (non-fan-out) `await agent()` call has declared null
      semantics (L4).
- [ ] Every self-certified field (self-grepped status, self-reported artifactsPresent) is paired
      with an independent deterministic check or a separate low-effort probe agent; status greps
      are anchored (L5).
- [ ] If a parser feeds both a guard and the workflow, the authoring doc's template is the
      EXACT form the parser accepts — verified, not assumed (L6).
- [ ] Hook `matcher` was checked against what the pipeline actually emits (tool name, path
      position, `hook_input.cwd` vs `args.*`) via a real dispatched call, not reasoned about in the
      abstract — especially after migrating a fan-out to a `Workflow` tool call (L7, extends the
      line-358 landmine + P20).
- [ ] Detect and fix share one predicate/iterator, not two hand-copied passes (L8).
- [ ] If extracting a shared core across domains, each domain's gate semantics is golden-locked
      against real inputs BEFORE extraction (L9).
- [ ] Every enforcement-prose claim in the generated SKILL.md names the actual hook/schema/check
      that backs it (L10).
- [ ] Smoke-test with a bogus `projectDir`/target and confirm the workflow's own arg-validation
      fires, not a template-literal crash; adversarial verification is planned as a permanent,
      regression-tested layer, not a launch-time-only pass (L11).

## AUDIT-TIME CHECKLIST (apply when auditing an existing self-grading gate)

- [ ] Run `python3 tests/workflow_return_shape_test.py` against the target workflow — any drift
      between documented and actual return keys is a CRITICAL finding (L1).
- [ ] Read the `ONLY`/`onlyChecks` branch of the JS by hand: does anything short-circuit past
      verification? does an empty array render a pass? is `reviews`/`priorReviews` a union with
      corrections written back, or does old state get overwritten/dropped (L2)?
- [ ] Trace every code path that can set `overallPass`/`substratePass` to false — does each one
      have a non-empty selector entry AND an emitted finding? Is the rendered status boolean
      literally the same variable as the blocking boolean, or two different fields that happen to
      usually agree (L3)?
- [ ] For every gated dimension, grep for `.filter(Boolean)` / optional-chaining defaults — does an
      absent/null result read as pass? Is there a `dispatchedPairs`-style set distinguishing
      crash-drop from intentional-skip? Are single `await agent()` calls guarded (L4)?
- [ ] For every field the gate reports (status, artifactsPresent, citedInventory, etc.) — is there
      an independent check, or is it self-reported by the same agent that produced the work?
      Are status greps anchored (`^status: APPROVED`) (L5)?
- [ ] If a parser/guard exists, does the shipped authoring doc's example actually PASS the parser
      (not just look plausible) (L6)?
- [ ] Dispatch (or trace) a real call through each gate-relevant hook and confirm `matcher` fires
      on what the pipeline ACTUALLY emits — tool name, `Workflow` vs `Agent`, path position,
      `hook_input.cwd` (L7).
- [ ] Do detect and fix functions call a shared predicate, or two independently maintained ones
      (L8)?
- [ ] If the workflow shares an extracted core with sibling domains, is each domain's gate
      semantics still correct post-extraction, or did one domain's logic leak into another's (L9)?
- [ ] Spot-check 2-3 enforcement-prose claims against the actual mechanism they cite (L10).
- [ ] Confirm `node --check` was NOT the only eval test run; check the workflow reaches its own
      arg-validation on a bogus target; confirm adversarial verification exists as a permanent
      layer and was exercised against real (not fabricated) inputs during authoring (L11).
