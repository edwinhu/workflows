# Assessment: is wc-creator still correct after the ds/dev compiled-runner refactors?

> **Status:** assessment only — NO engine changes made. Findings for USER direction.
> **Author:** wc-creator-review session (2026-06-26), dispatched by host-dispatch.
> **Inputs:** direct reading of the wc-creator surface on `main` (post PR#7 ds, PR#8 dev);
> structured interviews with the two sessions that did the real refactors
> (`ds-refactor`/0010c649 — original ds work; `dev-refactor`/69f34326 — in-flight dev port, shipped v5.56.0).

---

## 0. TL;DR

**The machinery is fine; the doctrine is one generation behind.**

- wc-creator's *execution engines* — `wc-generate.js` (file-gen transform) and `workflow-creator-verify.js` (audit review) — work and should NOT be ripped out. The ds generalization assessment already (correctly) rates porting them "low priority."
- But what wc-creator **teaches authors to build** — its decomposition model (SKILL.md Step 3), its fan-out migration playbook (`references/dynamic-workflow-migration.md`), and its audit rubric (P01–P21 in `workflow-creator-verify.js`) — still scaffolds the **generic-interpreter shape** that ds and dev just spent two refactors *removing*: an in-workflow LLM "discovery" agent that re-parses the plan every invocation → per-level/per-item fan-out → heavyweight re-analysis verifier → JS gate keyed on self-reports.
- The compiled-runner pattern (`spec → plan → deterministic compile → run.js` with a shared parser, a run-template, a pause/resume protocol, and four safety invariants) appears **nowhere** in the creator surface. Grep for `spec→plan`, `compile`, `run-template`, `run.js`, `topo-sort`, `two-kinds`, `stale-gate`, `gateProbe`, `run-core` across `skills/workflow-creator/**`, `workflows/wc-*.js`: **zero hits** (the single "compile" match is an unrelated Typst widow guard).
- **Net:** wc-creator will *birth new workflows in the exact anti-pattern this whole effort removed, and its audit will bless them 9.5+.* That is a real defect — not "the old workflows just predate the pattern." The fix is to the **doctrine** (SKILL.md + the migration reference + the audit principle set), not to the engines.

**Verdict: wc-creator is PARTIALLY INCORRECT going forward.** Correct as a file-generator/auditor; incorrect as a *teacher of workflow architecture* for the class of workflow ds/dev exemplify (a DAG of mechanical work between human gates).

---

## 1. What wc-creator scaffolds today (quoted from the actual surface)

### 1.1 The decomposition model (SKILL.md Step 3, lines 264–420)

A workflow = **a chain of skill-phase `SKILL.md` files**, each with ONE responsibility and a structural (hook-enforced) gate, chained by prompt transitions, plus a shared `references/constraints/` dir with co-located `.md`/`.py` pairs and a `check-all.py` runner. The model is sound *as far as it goes* — phased decomposition, hook-enforced gates, two entry points, 4-level verification depth. But its unit of execution is **"a phase skill the LLM reads and interprets at runtime."** There is no notion of a *compiled* execution artifact.

Tellingly, the word **"runner"** in wc-creator means `check-all.py` — the constraint auto-discovery checker (`wc-generate.js:108`, KIND_GUIDE `runner`) — **not** a compiled `run.js` execution driver. The creator has no vocabulary for the thing ds/dev built.

### 1.2 The fan-out playbook (`references/dynamic-workflow-migration.md`)

This is where Step 3's "Ultracode-workflow check" sends authors. It teaches the **first-generation** dynamic-workflow pattern explicitly. The canonical skeleton (§3, lines 82–145) hardcodes the very steps ds/dev deleted:

- **§3 item 4 (line 71):** *"**Discovery agent** (`model:'sonnet'`) — resolves check/agent files and **enumerates the items** to review. Never hardcode a count."* → This is the LLM-discovery phase ds calls "the sleeper."
- **§3 lines 105–110:** the skeleton literally opens with `const disc = await agent('Enumerate items in ${PROJECT}...')`.
- **The transform variant (§3 lines 147–154):** `discover → transform → verify`, where "Discover enumerates the work-list AND the per-item spec" via an LLM agent, and a per-item **verify stage** is the gate.
- **The gate** is computed from reviewer-returned counts (good — JS owns arithmetic) but the *discovery* and *per-item verify* LLM layers are baked in as mandatory.

Nowhere does it mention: a deterministic parser shared with the guard, compiling the plan to a `run.js`, topo-sort with cross-item parallelism, gate-first idempotent skip, a pause/resume protocol, or the payload>pass/fail invariant.

### 1.3 The audit rubric (`workflow-creator-verify.js`, P01–P21)

The 22 principles (`workflow-creator-verify.js:375–381`) score: phased decomposition, gates, structural enforcement, independent verification, artifact review, two entry points, cross-skill consistency, constraint coverage, iteration strategy, post-subagent enforcement, deviation rules, state, handoff, checkpoints, context monitoring, summary frontmatter, agent tool restrictions, traceability, autonomous chaining, visual output, hooks-over-prompt, auto-loader.

**None of them detect or reward any compiled-runner property.** There is no principle for:
- deterministic compile (no discovery LLM);
- a parser shared by compiler + guard (single source of truth);
- a gate keyed on a real exit code / artifact-exists, not a self-report;
- pause/resume (two-kinds-of-decision + stale-gate backstop);
- gate-first idempotent short-circuit;
- payload > pass/fail (deviations + numbered summary on every pause/finding);
- adversarial review layer *outside* the runner.

A generic-interpreter workflow — including the **exact** `ds-implement.js`/`dev-implement.js` shape the refactors retired — scores 9.5+ on this rubric and gets blessed. The audit is blind to the anti-pattern.

### 1.4 The self-confirming smoking gun

`docs/DESIGN-ds-spec-plan-compile.md` §1.5 names the family directly: *"`dev-implement.js` is the same pattern (discovery LLM → per-level → heavyweight verifier)... `wc-generate.js`, `workshop-generate.js`, `writing-draft.js` are domain variants."* The creator's own emitted artifacts are instances of the interpreter shape the refactors removed.

---

## 2. What the two refactor sessions said wc got wrong

Both were interviewed; both replies are reproduced in full in Appendix A. The convergent findings:

### 2.1 ds-refactor (original ds work)

1. **The LLM discovery phase is a *sleeper*, not just waste.** An LLM sitting between a structured producer (`ds-plan`) and a strict checker (the executable-guard) didn't merely add cost — it **silently tolerated plan-format drift the guard rejects** (real plans used `**T1**`/em-dash deps; the guard rejected every row; only the LLM's tolerance let them run) and misparsed once into a false "all done." *"NEVER scaffold an LLM step between a structured producer and a strict checker — it absorbs drift invisibly."* (See `docs/investigations/2026-06-26_llm-discovery-masked-spec-drift.md`.)
2. **Honor-system gate.** The scaffolded gate computes from implementer self-report + a re-analysis verifier — LLM claims, not real exit codes. The verifier *"caught ZERO bugs"*; it recomputed a gate the `Verify` exit code already gives.
3. **Wrong return boundary.** "Return after one level" framed the unit as a dependency level; the natural unit is "run to the next human decision." That one framing choice caused the ~13-round-trip blowup (→ ~5 decision pauses after the refactor).

### 2.2 dev-refactor (dev port, shipped v5.56.0)

1. **The missing load-bearing seam: a shared parser imported by BOTH compiler and guard** (single source of truth → "compiles ⇔ passes gate"). wc emits a guard with its own regex that drifts from the runner's interpretation.
2. **`gateProbe` must be a gate-kind-parameterized seam** — exit-code (ds/dev) / mechanical-floor / judgment+empirical (writing/workshop). wc assumes one shape. It must *ask* "what's your gate kind?" and emit the matching probe skeleton + return contract `{pass, <artifact>Present, evidence}`.
3. **compile-output is CODE *or* DATA.** If the domain's runner is already a generic fan-out (e.g. `writing-draft`), compile emits a **data work-list** the engine consumes, not a generated `run.js`. wc must scaffold both.
4. **Per-domain knobs wc hardcodes but must let the author SET:** sequential-vs-parallel within a level (dev = sequential shared-tree; ds = parallel disjoint-outputs — a naive `parallel()` copy corrupts dev's tree), implementer model policy (dev = inherit session model; ds = tier heuristic), and what "artifact present" means.
5. **Four safety invariants must be BAKED INTO the run-template** (they were hand-won per-domain — stop making each author rediscover them): (i) payload > pass/fail; (ii) mandatory R4 — an assumption/architecture/contract change must BLOCK, never auto-resolve to pass a gate; (iii) probe asserts artifacts-exist, not just gate-pass; (iv) adversarial/review layer stays OUTSIDE `run.js`. Plus two-kinds-of-decision routing + stale-gate backstop + gate-first short-circuit.
6. **BIGGEST META-FIX:** wc Mode 2/3 must first **DETECT generic-interpreter vs already-a-fan-out** and recommend accordingly — full compiled-runner port for the former, just spec-harden + guard-reconcile for the latter. Don't force the engine swap where a fan-out already exists (writing). And **never emit the LLM-discovery interpreter as the default again.**

---

## 3. The critical distinction (is wc-creator wrong, or do the old workflows just predate the pattern?)

The brief asks to separate these. The honest answer is **both apply, to different parts:**

| Component | Verdict | Why |
|-----------|---------|-----|
| `wc-generate.js` (the file-gen engine itself) | **FINE — leave it.** | It is a *pure transform*: its "discovery" reads an already-approved `DESIGN.md` (a real, human-gated spec), and file generation has no DAG/gate-loop/exit-code to compile. The discovery LLM here enumerates files from an approved design, not a structured table a deterministic parser could read better. The generalization assessment correctly rates a port "low priority." |
| `workflow-creator-verify.js` (the audit engine itself) | **FINE structurally, but its RUBRIC is stale.** | The review/fan-out/JS-gate machinery is sound. But P01–P21 cannot see the compiled-runner axis (§1.3), so it scores the retired anti-pattern as excellent. |
| SKILL.md Step 3 decomposition model | **INCORRECT going forward.** | Teaches "workflow = chain of interpreted phase skills"; has no compiled-execution concept. New DAG-of-mechanical-work workflows will be born interpreter-shaped. |
| `dynamic-workflow-migration.md` playbook | **INCORRECT going forward.** | Hardcodes the LLM-discovery + per-item-verify defaults (§1.2) that ds/dev deleted as harmful, not merely suboptimal. |
| The old sibling workflows (`ds-implement`, `dev-implement`, etc.) | **Predated the pattern — already being fixed.** | ds done (PR#7), dev done (PR#8). Not a wc-creator defect per se — but they were *born from* wc's doctrine, which is why fixing the doctrine matters. |

So: **wc-creator is not globally "wrong."** Its engines are fine. But it is **stale as an architecture teacher** for the specific, common workflow class ds/dev exemplify — and because it is the thing that *births* workflows, a stale teacher is more consequential than a stale instance.

---

## 4. What a corrected wc-creator should scaffold (concrete fixes)

These are **proposals for USER direction — not yet implemented.** Grouped by the surface that changes.

### 4.1 Add a compile-vs-interpret decision to Step 3 (doctrine)

Before "Ultracode-workflow check," insert a **classification gate**: does this workflow contain a *DAG of mechanical work between human gates* (an implement/transform phase driven by a structured plan table)? If yes → scaffold **spec → plan → compile → run.js**, not an interpreted phase loop. If the work is a single creative pass or a pure fan-out with no plan-table DAG → keep the existing patterns. This is the dev-refactor "META-FIX" applied at birth, not just at audit.

### 4.2 Replace the migration playbook's default with the compiled-runner skeleton

`dynamic-workflow-migration.md` should *demote* the LLM-discovery skeleton to "legacy / pure-creative-fan-out only" and *promote* a new canonical skeleton emitting, by default:

1. `scripts/<domain>/<domain>_plan_table.py` — deterministic, **prefix-tolerant** parser (handles real headers like `Failing Test (write FIRST)`; cycle/dangling/empty-row checks; lifts prose sections). **The single source of truth.**
2. `scripts/<domain>/<domain>_compile.py` — work-list producer, **CODE (`run.js`) or DATA (work-list)** depending on whether the domain already has a generic engine; deterministic, no LLM; asserts each template hole is filled exactly once.
3. `workflows/templates/<domain>-run-template.js` — the protocol with the **four safety invariants baked in as boilerplate** + two-kinds-of-decision routing + stale-gate backstop + gate-first short-circuit, and **three clearly-marked seams: columns, `implementerPrompt(t)`, `gateProbe(t)`.**
4. `hooks/<domain>-plan-executable-guard.py` whose `validate_plan()` is literally `return parse_plan(text).violations` (imports #1 — guard and compiler can never drift).
5. A **slim skill**: `COMPILE → run/pause loop` driven by a flowchart-as-spec, NOT a per-level dispatch loop.
6. **Tests:** parser golden against a **REAL spec** (not the template — the template can't reveal the drift the LLM was masking) + a driver test with mocked primitives covering topo / gate-first skip / declared+dynamic pause / resume-via-`clearedPauses`+decision-injection / R4-block-carries-deviations / artifact-missing-must-not-pass / hard-fail→`tasksThatFailed`.

### 4.3 Make `gateProbe` an interview question (seam)

The creator's interview (Step 2) must ask **"what is your gate kind?"** — exit-code, mechanical-floor, or judgment+empirical — and emit the matching `gateProbe(t) → {pass, <artifact>Present, evidence}` skeleton. For judgment gates, the scaffold must *enforce* the generalization-assessment warning: the semantic probe is **never the sole arbiter**; the adversarial review layer stays outside `run.js` and the evidence payload must be numbered/specific.

**Gate-kind sub-fork — exit-code is not monolithic (ds-refactor follow-up).** Even within "exit-code" there are two materially different sub-kinds the creator must distinguish, because they need different probes:
- **TDD / test gate (dev):** a test RED→GREEN. *Honest by construction* — code/tests don't silently go stale. The outputs-exist check is near-redundant here, so dev is likely to *under-value* it.
- **Output-first / produced-artifact gate (ds):** `Verify` runs against a produced data artifact (parquet, table). This is the **funnel-clobber class** — `Verify` can go green on a *stale or clobbered* artifact. So this sub-kind **requires the independent `outputsPresent` probe** that the TDD sub-kind can skip. The creator must emit the outputs-exist probe by default for artifact gates and treat its omission as a defect, not an optimization.

This is exactly why dev-refactor's invariant (iii) ("probe asserts artifacts-exist") must be *baked in*, not left to author judgment: the author of a TDD workflow won't feel its absence, but a later artifact-gate author inheriting the same template will be silently exposed.

### 4.4 Surface the hardcoded per-domain knobs as DESIGN.md decisions

Add to the DESIGN.md scaffold an explicit decision list: **gate-kind; sequential-vs-parallel within a level; implementer model policy; what "artifact present" means; retire-old-engine-AFTER-parity; do-NOT-extract-shared-core-until-2nd-instance.** These were silently hardcoded; the dev port shows a naive copy corrupts another domain's tree.

### 4.5 Add compiled-runner principles to the audit rubric (workflow-creator-verify P22+)

So Mode 2 stops blessing the anti-pattern. Candidate new principles (and a **detector**, per the META-FIX): 
- **P22 — Compile-vs-interpret fit:** if the workflow has a plan-table DAG, is execution *compiled* (deterministic parser → run.js/work-list) rather than re-discovered by an LLM each invocation?
- **P23 — Single-source parser:** does the guard import the same parser the compiler uses?
- **P24 — Honest gate:** is the gate a real exit code / artifact-exists check, not an LLM self-report?
- **P25 — Pause/resume + payload:** pause carries deviations + numbered summary; two-kinds-of-decision routing + stale-gate backstop present?
- **P26 — Adversarial layer outside the runner.**
- And a **Mode 2 detector** that classifies the target as `generic-interpreter | already-a-fan-out | compiled-runner | not-applicable` and recommends the right remediation (port vs spec-harden-only vs nothing) instead of forcing an engine swap.

### 4.6 The hard rule to encode everywhere

From both sessions, verbatim-worthy: **"Never scaffold an LLM step between a structured producer and a strict checker — it absorbs drift invisibly."** This belongs as an Iron Law in the creator, not just a tip.

---

## 5. Scope discipline / what NOT to do

- **Do NOT port `wc-generate.js` to a compiled runner.** It is a pure transform over an approved design; the generalization assessment rates it low-priority and it is not load-bearing. Same for leaving hypothetical external consumers alone until a concrete engine exists.
- **Do NOT extract a shared `run-core` yet** — that is the ds/dev sequence's *next* step (after a 2nd live instance), independent of the creator fix. The creator should *emit per-domain templates*; core-extraction is a separate maturity step.
- **Do NOT force the engine swap on `writing`** (already a fan-out) — the corrected creator's *detector* is precisely what prevents that.
- This document changes nothing yet. All §4 items await USER direction.

---

## 6. Recommendation to the USER

wc-creator's engines are healthy; its **architecture doctrine is one generation stale** for the DAG-of-mechanical-work workflow class. Three tiers of fix, in priority order:

1. **(Highest value, lowest risk) Add the Mode 2/3 detector + audit principles (§4.5).** Stops the audit from blessing the retired anti-pattern; surfaces existing generic-interpreter workflows as port candidates. Pure addition, no behavior change to generation.
2. **(Core fix) Rewrite the migration playbook's default skeleton + add the Step 3 compile-vs-interpret gate + the gate-kind interview question (§4.1–4.4).** This is what makes the *next* workflow born-correct. Larger, touches the most-loaded doctrine file.
3. **(Optional, later) A reference `compiled-runner` template set** in `workflows/templates/` the creator points authors at — harvestable directly from the ds + dev templates that now exist.

Suggested next step: confirm tier 1 + tier 2 scope, then I (or a fresh session) draft the SKILL.md + migration-reference + workflow-creator-verify edits as a single reviewable PR. Both refactor sessions offered to review the corrected scaffold.

---

## Appendix A — interview replies (verbatim)

### A.1 dev-refactor (69f34326), shipped v5.56.0

> A) WHERE wc's CURRENT SCAFFOLDING FOUGHT ME
> 1. It scaffolds the GENERIC-INTERPRETER shape: an in-workflow LLM "discovery" agent that re-parses the spec/plan EVERY invocation → per-level transform → heavyweight re-analysis verifier → JS gate, with the skill driving a per-level loop. Every bit of that fought me — the discovery LLM is redundant (the table is regex-parseable) AND it silently MASKS format drift between the spec and its guard (the guard's strict regex rejected real plans the LLM tolerated; the bug is invisible until you remove the LLM). The heavyweight verifier "caught zero substantive bugs" in both ds and dev.
> 2. The gate it scaffolds keys on the implementer's SELF-REPORTED verifyPassed + a NON-executing corroboration — so "real exit codes, not self-judgment" was a LIE in the emitted code (audit G1). wc should never emit a gate that trusts a self-report.
> 3. No pause/resume protocol at all. I had to hand-build args.decisions + clearedPauses + the two-kinds-of-decision routing + the stale-gate backstop. wc emits a loop that re-invokes per level; it does NOT emit a structured-early-return pause.
> 4. No gate-first idempotent short-circuit → resume/recompile re-does finished work. Had to add it.
>
> B) SEAMS wc IS MISSING
> - The SHARED PARSER imported by BOTH compiler and guard (single source of truth → "compiles ⇔ passes gate"). wc emits a guard with its own regex that drifts from the runner's interpretation. This is the load-bearing missing seam.
> - gateProbe as a GATE-KIND-PARAMETERIZED seam. It's THE real fork: exit-code (ds/dev) / mechanical-floor / judgment+empirical (writing/workshop). wc assumes one shape. It must ask "what's your gate kind?" and emit the matching gateProbe skeleton + return contract {pass-or-exit0, <artifact>Present, evidence-or-tail}.
> - compile-output-is-CODE-or-DATA (writing-refactor's pass#9 finding): if the domain's runner is ALREADY a generic fan-out (writing-draft), compile emits a DATA work-list (section index) the generic engine consumes, NOT generated run.js. wc must scaffold both.
> - Per-domain knobs wc HARDCODES but must let the author SET: sequential-vs-parallel within a level (dev=sequential shared-tree, ds=parallel disjoint-outputs — a naive parallel() copy corrupts dev's tree), implementer model policy (dev=INHERIT session model, ds=tier heuristic), and what "artifact present" means (dev=files+test, ds=outputs).
> - Prefix-tolerant column lookup (real headers carry qualifiers: "Failing Test (write FIRST)" must satisfy required col "failing test"). wc's exact-match parser breaks on real specs.
> - Golden-test-against-REAL-spec, not the template (the template can't reveal the drift the LLM was masking).
>
> C) WHAT A CORRECTED wc SHOULD EMIT (the new default skeleton)
> 1. scripts/<domain>/<domain>_plan_table.py — deterministic tolerant parser (prefix-tolerant columns; cycle/dangling/empty checks; lifts prose sections like Global Constraints/Interfaces).
> 2. scripts/<domain>/<domain>_compile.py — work-list producer (CODE→run.js OR DATA artifact); deterministic, no LLM; asserts each template hole appears exactly once.
> 3. workflows/templates/<domain>-run-template.js — the PROTOCOL with block-comment holes, and the FOUR SAFETY INVARIANTS BAKED IN as boilerplate (these were hand-won per-domain; stop making each author rediscover them): (i) payload>pass/fail — every pause/finding carries deviations + a NUMBERED summary, never a bare exit code; (ii) mandatory R4 — an assumption/architecture/contract change must BLOCK, never auto-resolve to pass a gate; (iii) probe asserts ARTIFACTS-EXIST, not just gate-pass (a Verify passes on a stale/clobbered artifact); (iv) the adversarial/full-suite/review layer stays OUTSIDE run.js. Plus the two-kinds-of-decision routing + stale-gate backstop + gate-first short-circuit, and THREE clearly-marked seams: columns, implementerPrompt(t), gateProbe(t).
> 4. hooks/<domain>-plan-executable-guard.py whose validate_plan() is literally `return parse_plan(text).violations` (imports #1).
> 5. A SLIM skill: COMPILE→run/pause loop + a flowchart-as-spec (not a per-level dispatch loop).
> 6. Tests: parser golden (REAL spec) + driver test with mocked primitives covering topo / gate-first skip / declared+dynamic pause / resume-via-clearedPauses+decision-injection / R4 block carries deviations+numbers / artifact-missing-must-not-pass / hard-fail→tasksThatFailed.
> 7. A DESIGN.md scaffold with the explicit decision list: gate-kind, sequential-vs-parallel, model policy, retire-old-engine-AFTER-parity, do-NOT-extract-shared-core-until-2nd-instance.
>
> BIGGEST META-FIX: wc Mode 2/3 must first DETECT generic-interpreter vs already-a-fan-out and recommend accordingly — full compiled-runner port for the former, just spec-harden + guard-reconcile for the latter. Don't force the engine swap where a fan-out already exists (writing). And NEVER emit the LLM-discovery interpreter as the default again — it's the anti-pattern this whole effort removed.

### A.2 ds-refactor (0010c649), original ds work

> Honesty caveat first: I did NOT run wc-creator to scaffold from scratch this session — I REFACTORED the existing ds workflow and RETIRED its engine (ds-implement.js). So I'm reasoning from the INSTANCE the creator produced back to what it emits. Also: the "workflow-creator-verify before rewriting" step I did as a MANUAL checklist (DESIGN §1.1), not a workflow-creator-verify.js run.
>
> WHAT THE SCAFFOLDED SHAPE HAD THAT I RIPPED OUT (the TRANSFORM-workflow template's defaults):
> 1. An LLM "discovery" phase as step 1 — an agent re-reads PLAN.md and returns a structured DAG every invocation. RIPPED ENTIRELY → deterministic parser+compiler. The table was already regex-parseable. #1 finding.
> 2. A heavyweight per-task "verify" subagent that re-loads data and re-runs analysis to compute a gate. RIPPED → a cheap exit-code probe. In the source run this verifier caught ZERO bugs.
> 3. Per-LEVEL round-trip control flow: "process one dependency level, return, get re-invoked by the skill." REPLACED → one topo-run with real cross-task parallelism that runs to the next HUMAN pause. ~13 round-trips → ~5 decision pauses.
> 4. Uniform model tier (no cheap routing for mechanical tasks). ADDED heuristic tiers.
>
> WHAT IT DID NOT EMIT THAT A CORRECTED CREATOR SHOULD EMIT BY DEFAULT:
> - spec → plan → COMPILE: a deterministic parser SHARED with the guard + a run-TEMPLATE the plan compiles into. NOT an LLM discovery phase. Rule: if the input is a structured table, scaffold a deterministic parser, not an agent that re-reads it.
> - a run-template carrying the protocol: topo + real parallelism, gate-first idempotent skip, GATE = real exit code (or a domain gateProbe returning {pass, outputsPresent, evidence}) NEVER self-report, a pause(label, payload) primitive, the uniform result schema.
> - the pause/resume protocol: args.decisions + clearedPauses; TWO-KINDS-OF-DECISION routing (gate-changing → edit the plan's Verify + recompile; behavior-only → args.decisions) + the STALE-GATE BACKSTOP.
> - PAYLOAD > PASS/FAIL: pause/finding payloads carry the implementer's deviations + a NUMBERED summary by default. In the source run the gate caught zero bugs; deviation notes + adversarial review did.
> - the SEAM: human-gated conversational phases (brainstorm/plan/review/verify) STAY in the main loop; only mechanical execution-between-gates is compiled. Do NOT scaffold a monolithic one-JS-for-the-whole-workflow.
> - adversarial review/verify as SEPARATE subagent layers OUTSIDE the compiled runner.
> - EMITTER-CANONICAL: plan emitter and parser/guard share ONE format spec (strictness at emitter, tolerance at parser); generate both from one definition.
>
> WHAT IT ACTIVELY LED WRONG ON (harmful defaults, not just omissions):
> 1. THE LLM DISCOVERY PHASE — the sleeper. An LLM between a structured producer (ds-plan) and a strict checker (the guard) didn't just add cost: it SILENTLY TOLERATED plan-format drift the guard rejects (real plans used **T1**/em-dash deps; the guard rejected every row; only the LLM's tolerance let them run) AND misparsed once (false "all done"). docs/investigations/2026-06-26_llm-discovery-masked-spec-drift.md. Principle: NEVER scaffold an LLM step between a structured producer and a strict checker — it absorbs drift invisibly.
> 2. HONOR-SYSTEM GATE: implementer-self-report + re-analysis-verifier computes the gate from LLM claims, not real exit codes.
> 3. WRONG RETURN BOUNDARY: "return after one level" framed the unit as a dependency level; the natural unit is "run to the next human decision." That one framing choice caused the round-trip blowup.

### A.3 ds-refactor (0010c649) — follow-up, ds-specific axes dev won't stress

> (1) What wc-generate's scaffold emitted that I RIPPED OUT: LLM "discovery" phase (re-parses PLAN.md → DAG every call) → deterministic parser+compiler; per-task re-analysis "verify" subagent → cheap exit-code probe (caught 0 bugs); per-LEVEL return boundary → one topo-run to the next human pause; uniform model tier → heuristic tiers (haiku for trivial loaders, sonnet for ETL).
>
> (2) SINGLE biggest thing wc led me wrong on: the LLM discovery phase between a structured producer (ds-plan) and a strict checker (the guard). It SILENTLY TOLERATED plan-format drift the guard rejects, so it MASKED a spec-drift bug while looking like it worked (real plans failed the guard on every row; only the LLM let them run). Worst kind of wrong: invisible.
>
> (3) ds-specific things dev likely WON'T hit the same way:
> - GATE KIND: ds is output-first exit-code on PRODUCED ARTIFACTS, so it needs the independent outputs-exist probe (funnel-clobber: Verify green on a stale/clobbered parquet). dev is TDD — the gate is a test RED→GREEN, honest by construction; code/tests don't silently go stale. dev may under-value the outputs-exist check.
> - PARALLEL vs SEQUENTIAL: ds had embarrassingly-parallel branches (per-year masters, T2∥T5) — real cross-task parallelism was a headline win. dev is mostly a serial chain, so dev won't stress the level-parallel path.
> - MODEL POLICY: ds tasks span heavy ETL → trivial loaders, so tier-routing pays. dev tasks are more uniform; tier-routing matters less.
> - R4 KINDS: ds's gate-changing decisions are grain/winsor/sample/methodology (frequent, judgment-heavy). dev's (e.g. an API signature change rewrites the test) are rarer and more mechanical — dev may under-test the two-kinds-of-decision routing and the stale-gate backstop. Worth a dev fixture that forces it.
