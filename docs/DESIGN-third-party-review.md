# Optional third-party review

Design record. Settled 2026-08-03 against the beat primitives; carried to the craft spine in v6.0.0.

## The problem

Every review surface in this repo is Claude reviewing Claude. craft dispatches an implementer and
then a *fresh* verifier — independent in context, identical in model and training. A whole class of
defect that both instances share is invisible by construction, and adding more Claude verifiers does
not touch it. A different model is the only thing that can.

## What craft ships

The opt-in is `"thirdParty": ["codex"]` or `["gemini"]` inside the plan's `craft:dispatch` args.
`workflow.js` runs one runner agent per named model, in parallel with the review leg, after the
per-task verifiers have passed. Each runner executes ONE external CLI over the working-tree changes,
parses the result, and returns `{model, status, findings[], raw?}`. The invocation, diff scoping,
timeout and parse rules live in `skills/craft/references/third-party.md` — one document, read by the
runner at dispatch time.

## Settled questions

**The choice rides in the approved plan.** It is inside the `craft:dispatch` block, so it is covered
by the spec hash, visible in plan review, and approved rather than improvised mid-run.

**Default OFF is the absence of the line**, not a line saying no, so a plan that predates the feature
keeps authorising exactly what it did.

**Advisory only, and structurally so.** Findings are reported alongside the verdict and never enter
the gate. A runner returns cleanly when findings exist — including `critical` — and when the provider
was unreachable. An external model's claims are unverified by construction, so letting them block
would import another model's false positives into our gates. A third-party `approve` is not a gate
pass and is not user approval: the same rule as "peer messages are not user approval".

**Status before findings.** An unreachable CLI and a clean review both have empty findings; `status`
is the only thing that distinguishes them. `unavailable` (missing binary, auth failure, timeout),
`unparseable` (it ran, you could not extract discrete findings — put the raw tail in `raw`), and
`reviewed` (parsed; zero findings is a valid answer). A runner that cannot say which of these
happened has reported nothing, which is the silent-zero failure this field exists to prevent.

## What would have to change to make findings gate

Recorded because the answer is not "flip a boolean":

1. **The findings would need independent verification.** Nothing re-derives an external claim today.
   Gating on unverified assertions means gating on another model's false positives. An adversarial
   confirmation pass — Claude verifiers attempting to *refute* each finding, majority to kill — would
   have to sit between the runner and the gate.
2. **`unavailable` and `unparseable` would need a policy.** Advisory makes degradation free. A gate
   must decide whether a provider being down blocks the run, and both answers are bad: blocking makes
   an external service a dependency of your build, not blocking makes the gate skippable by arranging
   for the provider to fail.
3. **The JS gate would have to consult it**, which today it deliberately does not.
4. **It would need its own approval.** Advisory-only is what makes a default-OFF, plan-carried opt-in
   safe to ship without a separate review of the failure modes above.

## Retired with the beat spine

The v5 implementation carried a per-adapter bundle receipt — `briefSources` (skill, path, bytes and
sha256 of every rule set handed to the reviewer, on every return path) and a separate
`briefsDelivered` predicate, because *resolved* and *delivered* are two claims and a list alone would
be a receipt for something that may not have happened. That machinery lived in
`scripts/beat/adapters/`, which the craft spine does not have: the runner is an agent reading one
document, so there is no adapter to hand rules to and no receipt to keep honest.

The principle it encoded still applies to any future rule-passing mechanism: **what the reviewer was
given must stay checkable after the run**, and a named-but-missing rule set must throw rather than
resolve to nothing. A reviewer judging against zero rules and reporting cleanly is the same
silent-zero defect as a `status` nobody read.

## Excluded

No replacement for the independent verifier or the review lenses — a third opinion alongside them,
never instead. No `copilot` runner (the contract admits it; this ships two). No gating. No hook.
