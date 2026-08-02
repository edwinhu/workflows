# Migrating every workflow onto the shared beats

## The rule

`CLARIFY`, `IMPLEMENT`, and `REVIEW` are shared primitives. Every workflow uses them. A per-workflow
duplicate of a beat is a bypass, and the beats exist precisely so that enforcement lives in one place
— `beat-implement` is what keeps main chat from writing, and a workflow that hand-rolls its own
dispatch inherits none of that.

## Measured state

**17/18 adopted as of 2026-08-02.** Items 1-4 below are done; item 5 is the one open decision.

Adoption = the skill **loads the beat's `SKILL.md`**, or reaches it through an adapter that does.

| workflow | CLARIFY | IMPLEMENT | REVIEW |
|---|---|---|---|
| ds | ✅ `beat-clarify` | ✅ via `ds-implement` | ✅ via `ds-review` |
| dev | ⚠️ `dev-clarify` | ✅ via `dev-implement` | ✅ via `dev-verify` |
| work | ✅ | ✅ via `goal-work` | ✅ |
| workflow-creator | ✅ | ✅ | ✅ |
| writing | ✅ `beat-clarify` | ✅ via `writing-draft` | ✅ via `writing-accept` |
| workshop | ✅ `beat-clarify` | ✅ via `workshop` | ✅ |

### Two things that look like gaps and are not

`ds-review` and `dev-verify` are **adapters**: each loads `beat-review` and adds its domain framing.
That is the intended shape, not a bypass — the beat holds the terminal-decision logic and the adapter
supplies the surfaces.

`dev-review` and `writing-review` are **not** review-beat lookalikes despite the names. Both are
*independent machine review* of authenticated artifacts ("independent /dev review over authenticated
plan identity"; "independent review phase for authenticated PLAN-bound drafts"). `beat-review`
presents verified work *to a person* and returns their decision. Different beats entirely; a merge
here would lose the machine review, not consolidate it.

An earlier audit of mine reported both as gaps by grepping for "loads the beat" and ignoring that
enforcement can arrive by hook. `clarify-before-recon-guard` is registered by writing, dev, ds,
workflow-creator, workflow-creator-improve and workshop, so the clarify **gate** is enforced in six
workflows even where the shared **beat** is not loaded. Measure the mechanism, not the reference.

## Migration

Ordered by risk. Each item states what changes and what proves it.

### 1. `workshop` → `beat-implement` (lowest risk, highest value)

`workshop-generate.js` dispatches its own write-capable agents (`:252`, `:274`, `:294`) that write
Typst fragment files. It therefore has no `writablePaths` bound to any task and no write guard.

Replace the Transform phase's own dispatch with a beat call: the slide index becomes the ready wave,
each SECTION becomes a task with `writablePaths` scoped to its fragment path, and the router decides
(a multi-section deck fans out → generated workflow; a one-section deck → one subagent).

**Proves it:** `tests/workshop-engine-discover.test.mjs` still green; a task whose agent writes
outside its fragment path is rejected by the observation hooks.

### 2. `writing` → `beat-implement`

`writing-draft.js:443` dispatches an agent told to "Write the full prose to the exact PLAN-owned path
… with the Write tool". Same shape as workshop: one task per section, `writablePaths` = that section's
draft path.

Note this **subsumes** the existing output verification: `writing-draft`'s post-step compares each
draft's bytes against the agent's `reportedContent`, which is the misreporting check the beat already
performs via `enforceTaskOutputs`. Keep one, not both.

**Proves it:** `tests/writing-engine-discover.test.mjs` still green; a drafting agent that touches a
file outside its section is caught, which today it is not.

### 3. `writing` → `beat-review`

`writing`'s flow ends "→ /writing-revise → returned human review surface" — a hand-rolled terminal
surface. It is the only workflow with no `beat-review` path. Add an adapter in the shape of
`ds-review`/`dev-verify` rather than calling the beat from `writing/SKILL.md` directly, so the domain
framing has somewhere to live.

**Proves it:** the adapter loads `beat-review`; a registration-parity style test asserts every
workflow reaches the review beat.

### 4. `writing` and `workshop` → `beat-clarify`

Both currently do clarify as inline prose under `clarify-before-recon-guard`. The gate is enforced;
the *primitive* is not used, so the evidence-bearing intent handoff the beat defines is reimplemented
per workflow. Lower risk than 1–3 because the guard already prevents skipping.

### 5. `dev-clarify` — decide, do not assume

`dev-clarify` is "conversational clarification **after** dev reconnaissance"; `beat-clarify` is "ask
the user, then carry evidence-bearing intent into the caller's flow" — positioned **before** recon.
These may be genuinely different steps rather than a duplicate. **This item is a decision, not a
migration:** either `dev-clarify` becomes an adapter over `beat-clarify`, or its divergence is
documented as deliberate. Do not collapse it silently.

## The test that makes this stick

Every item above is a configuration property, so a behaviour test cannot hold it. Add a
**beat-adoption parity test** in the shape of `tests/mutation-guard-registration.test.py`: enumerate
the workflows, require each to reach all three beats directly or through a named adapter, and fail
naming the workflow and the missing beat.

Without it this migration is a snapshot that decays — which is exactly how the current state arose.
The adoption table above was true of `beat-implement` before it was rewired, and nothing failed when
`writing` and `workshop` drifted off it.

## Sequencing note

Items 1 and 2 depended on the `beat-implement` retirement, which is **done** (2026-08-02).
`workflows/beat-implement.js` is deleted; its ~105 dispatch-policy assertions were re-homed along the
line that divides them — what can be decided before any agent runs (`scripts/beat/preflight.ts`,
asserted by `tests/beat-implement-preflight.test.mjs`) versus what can only be decided between
dispatches (`hooks/work-implement-observation.ts`, asserted by
`tests/work-implement-observation.test.mjs`). `KNOWN_NONCOMPLIANT` is now empty.

Items 1 and 2 are therefore unblocked, and they land on a boundary whose coverage is complete.
