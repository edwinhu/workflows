# Refactor brief: `spec → plan → compiled run.js`

> **Superseded (2026-07-29).** This refactor brief records a retired DS architecture. In the current architecture, the copied `PLAN.md` is immutable, native `TaskList` is the live state, auto-memory holds reusable facts, and `REVIEW.md` is the human review ledger. No compiler or generated `run.js` remains.

> Handoff from a full `/ds` run (muni-pennying: materialize masters + parallelize, then a
> figures/analysis enhancement round). This brief distills the lived experience into a concrete
> refactor direction for the ds workflow, and a hypothesis for generalizing to dev / writing /
> workshop / workflow-creator / course-materials.

## The core insight

Today `ds-implement.js` is a **generic interpreter**: every invocation re-reads `PLAN.md`, re-parses
its task table into a DAG **with an LLM "discovery" agent**, then runs a uniform implementer +
verifier per task. That genericity is the source of the overhead.

**Flip it: the plan phase should _compile_ the DAG into a bespoke, lean `run.js` from a shared
template — not be re-interpreted by a fixed engine each call.**

```
SPEC  (what / why)            ── conversational, human-gated
PLAN  (the DAG + decisions)   ── conversational, human-gated
  └─ compile ──▶ run.js       ── generated from a template, project-specific
run.js                        ── executes mechanical work between gates, pauses at decisions
```

The plan stops being a doc an engine interprets and becomes the thing that **emits** the engine.

## Pain points this fixes (all observed in the muni run)

- **Discovery re-parse every call** — an LLM agent re-parsed `PLAN.md` on each of ~13 `ds-implement`
  invocations. It also **misparsed once** (returned "all done" while T8/T6 were pending), costing a
  wasted round-trip + an `onlyChecks` workaround.
- **Per-level round-trips** — ~13 main-loop invocations for one phase, mostly serial, many trivial
  (adding two loader functions paid the same implementer+verifier+discovery overhead as building
  70M-row masters).
- **Per-task verifier double-work** — a second LLM subagent re-loaded data and re-ran checks the
  implementer already ran, just to compute a gate that the `Verify` command's exit code already gave.
- **Uniform model tier** — no cheap-model routing for mechanical tasks.

## Where the value actually came from (keep these)

The JS gate only checks "did `Verify` exit 0." **It did not catch a single substantive bug.** Every
real problem was caught by (a) me reading the implementer's **deviation notes**, or (b) the
**adversarial review/verify subagents** (plain `Agent` dispatches, not workflows):

- 8.8% trades-grain dedup — gate *passed*; caught in the deviation note.
- Table 3b sample mismatch & the Pillar-2 capture inconsistency ($1.05B vs $0.99B) — *passed* their
  per-task gates; the **3-reviewer research-grade review** caught them.
- The capture driver turned out to be the winsorization **target** (dollars vs points), not the
  sample or per-year-vs-pooled — surfaced by an agent that **refused a wrong premise**.

→ Keep adversarial review/verify as subagents. Keep human gates. The compile only replaces the
**mechanical execution-and-gating between gates**.

## Architecture

- **Conversational, human-gated (stay in main loop):** brainstorm, plan, review, verify, and the
  in-flight methodology decisions. The muni run's R4 escalations are the proof these matter —
  grain (+seqno), winsor scope (per-year), dealer-inclusive redesign, the capture sample
  (cover-required), points-vs-dollars winsor, Table 3b population. Each was a human call; several
  reversed a wrong path. **A monolithic "one JS for the whole workflow" would autopilot past exactly
  these.** Do NOT build that.
- **Compiled (the new `run.js`):** topo-run the task DAG, **real parallelism for independent tasks**
  (not per-level round-trips), `Verify` exit-code as the gate, structured returns. One invocation
  runs to the next **pause point**, returns the data the human needs, and resumes (resume already
  exists via `resumeFromRunId`). For the muni run that's ~5 decision pauses instead of ~13 level
  round-trips, and **zero** discovery LLM calls.

## What the shared template bakes in (so generated scripts stay honest)

- output-first (produce artifact → run `Verify` → structured return),
- gate computed from **real exit codes**, never self-report,
- the uniform result schema (`tasksThatFailed`, `findings`, `reviews`),
- a `pause(label, payload)` primitive that returns control to the main loop with the data a human
  needs to decide,
- cheap **existence/schema** corroboration for artifact-producing tasks (NOT a full re-analysis);
  skip the LLM verifier entirely where `Verify` is deterministic.

## What the plan fills in (the compile target — a task-spec schema)

```
{ id, deps:[...], kind:'engineer|analyst', outputs:[...], verify:'<cmd, exit0=pass>',
  tier:'haiku|sonnet|opus', effort, pauseAfter?:'<what to surface for the human decision>' }
```

The plan already produces ~this today (the executable Task Breakdown table). The compile step turns
that table into a `run.js` literal + the template's loop.

## Suggested execution plan for the refactor

1. **ds first (prove the pattern):**
   - Define the task-spec schema above.
   - Write the shared **template** (e.g. `workflows/templates/run-template.js`) carrying the protocol.
   - Add a **`ds-compile`** step (end of ds-plan, or a thin phase) that emits `run.js` from PLAN + template.
   - Slim `ds-implement.js` to a **thin runner** of the generated `run.js` (or retire it).
   - Keep ds-brainstorm / plan / review / verify conversational; keep `ds-validate-coverage` as a
     review-style subagent fan-out.
2. **Then assess generalizing** to dev, writing, workshop, workflow-creator, course-materials. Same
   shape (human-gated boundaries + mechanical execution between), different template per domain
   (dev: TDD failing-test-first; writing: section draft+source-fidelity; workshop: slides+visual
   verify; workflow-creator: file generation; course-materials: ?). Find the **shared core**
   (compile + run-template + pause protocol) vs the domain-specific template. Don't force a rewrite
   where the current shape already works.
3. **Discipline:** use workflow-creator's own conventions; **audit before rewriting** (wc-audit);
   don't break working workflows; incremental + tested; write a `DESIGN.md` and get sign-off before
   touching the engines.

## Worked example to read first

- This session's muni-pennying `.planning/*` (SPEC, PLAN, LEARNINGS, VALIDATION, REVIEW_STATE,
  VERIFICATION) — the current ds flow end-to-end, including the executable Task Breakdown table that
  is the compile input, and the R4 escalations that are the natural pause points.
- `workflows/ds-implement.js` and `workflows/ds-validate-coverage.js` — the current engines.
- The ds skill chain: `skills/ds`, `skills/ds-plan`, `ds-implement`, `ds-validate`, `ds-review`,
  `ds-verify`.

## North star

Same correctness, a fraction of the wall-clock: replace the generic implement **interpreter** with a
per-plan **compiled** script from a shared template; keep the human gates and the adversarial review
where the actual rigor lives.
