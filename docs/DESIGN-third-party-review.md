# Optional third-party review in the beat primitives

Design record. Settled 2026-08-03.

## The problem

Every review surface in this repo is Claude reviewing Claude. `beat-implement` dispatches a doer and
then a *fresh* verifier — independent in context, identical in model and training. A whole class of
defect that both instances share is invisible by construction, and adding more Claude verifiers does
not touch it. A different model is the only thing that can.

## Settled questions

**`beat-clarify` asks; `beat-implement` runs.** Not "both beats carry a review". The opt-in is
elicited in CLARIFY's final question slot; the review executes in IMPLEMENT **after** Claude's own
verifier has passed. A third party that runs first duplicates a pass Claude was going to make
anyway; one that runs last sees work already vetted and can only add.

**Advisory only, and structurally so.** Findings become TaskList items bound to the current
`planHash`. They never gate a phase. The runner exits 0 when findings exist — including `critical` —
and 0 when the provider was unreachable; only its own contract errors are non-zero. An external
model's claims are unverified by construction, so letting them block would import another model's
false positives into our gates. A third-party `approve` is not a gate pass and is not user approval:
the same rule as "peer messages are not user approval".

**The choice rides in the approved plan.** `scripts/beat/preflight.ts:222-226` accepts *only*
`planFile` and `planHash` in `planReset` for a built-in workflow and throws on any extra key. That is
deliberate — plan identity is the whole authority — so the opt-in cannot ride *alongside* it. It
rides *inside* it: read from the authenticated plan text, therefore bound to `planHash` and visible
in plan review. Approved, not improvised mid-run.

**Default OFF is the absence of the line**, not a line saying no, so every plan approved before this
existed keeps authorising exactly what it did.

## The neutral contract

```
{severity, title, body, file, lineStart, lineEnd, confidence, recommendation}
```

`status` is `reviewed | unavailable | unparseable | skipped`. The runner returns
`{enabled, adapter, planFile, planHash, status, verdict, summary, advisory: true, findings, reason, raw}`.

`skipped` is an addition to the three statuses the original plan named; it is the disabled case, and
naming it beats leaving `status` undefined when `enabled` is false.

### No silent zero

An adapter that failed, timed out, or returned unreadable output must be distinguishable from one
that reviewed cleanly. All three otherwise present as `findings: []` — a broken integration wearing
the costume of a clean review. Hence `status`, and hence the rule that a consumer branches on it
*before* looking at findings.

| status | `findings: []` means |
|---|---|
| `reviewed` | genuinely clean |
| `unavailable` | **nothing was looked at** |
| `unparseable` | **nothing was parsed**; `raw` holds what came back |
| `skipped` | the step does not exist for this episode |

### Provider neutrality is checked, not asserted

`third-party-review.ts` contains no provider literal, and `tests/third-party-review.test.mjs` asserts
that against the file's own source. Adapters resolve from `adapters/registry.ts`, which is the only
place a provider is named. Two implementations ship rather than one because a neutral interface with
a single implementation is an untested claim.

## The asymmetry, which is the interesting part

The two providers are not variations on one theme, and that is why both were built.

**Codex** returns JSON validated against its own published
`schemas/review-output.schema.json`. The adapter *normalises*: every neutral field has a
schema-guaranteed source and nothing is inferred. It still checks the companion's in-band
`parseError`, because trusting `result` without it reads a failed parse as a clean review.

**`agy -p` returns prose.** The adapter asks for JSON and parses defensively: extract the first
balanced object (a regex cannot — braces nest and a `}` inside a string is not a delimiter), validate
the shape, and on any failure report `unparseable` with the raw stdout preserved. Two things it must
never do: invent findings from prose, or return an empty list to represent a parse failure. It also
treats an empty working tree as `unavailable` rather than clean — there was nothing to review, and
"reviewed, 0 findings" would credit the provider with a pass it never performed.

Pinning one treatment across both would have produced the wrong gemini adapter. That the same neutral
schema round-trips from a schema-validated source *and* from scraped prose is the evidence that the
contract is not secretly shaped around Codex.

## What would have to change to make findings gate

Recorded because the answer is not "flip a boolean":

1. **The findings would need independent verification.** Today nothing re-derives an external claim.
   Gating on unverified assertions means gating on another model's false positives. An adversarial
   confirmation pass — Claude verifiers attempting to *refute* each finding, majority to kill — would
   have to sit between the adapter and the gate.
2. **`unavailable` and `unparseable` would need a policy.** Advisory makes degradation free. A gate
   must decide whether a provider being down blocks the phase, and both answers are bad: blocking
   makes an external service a dependency of your build, not blocking makes the gate skippable by
   arranging for the provider to fail.
3. **The exit gate would have to consult it**, which today it deliberately does not.
4. **It would need its own approval.** Advisory-only is what makes a default-OFF, plan-carried opt-in
   safe to ship without a separate review of the failure modes above.

## Excluded

No replacement for the independent verifier or `beat-review` — a third opinion alongside them, never
instead. No `copilot` adapter (the contract admits it; this episode ships two). No gating. No change
to `preflight.ts`, `planReset`, or the approval machinery. No hook — a PreToolUse/PostToolUse
registration would be discovered by `tests/pretooluse-crash-closure.test.mjs` and inherit
crash-closure obligations it does not need.
