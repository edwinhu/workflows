# Common-infra candidates: the shared run-core seams (CAPTURE — do NOT extract yet)

> **Canonical** cross-workflow seam list for the compiled-runner pattern. Owned here (ds vantage);
> `dev`'s DESIGN §9 holds the dev-side view and points to this file. **GUARDRAIL: this records
> candidate seams; it does NOT authorize extraction.** Extraction is pass #9. **As of writing's GATE
> step landing, EVERY seam is now confirmed across three instances spanning both trust-classes
> (exit-code + semantic) and both compile-outputs (codegen + data).** No seam remains design-gated. The
> only thing before pass #9 is writing's A/B parity run — a *validation* step, not a design unknown.

## Instances (what we're generalizing from)

| Instance | Status | Gate trust-class | Compile output | Intra-level |
|----------|--------|------------------|----------------|-------------|
| **ds** | shipped (PR#7, merged) | exit-code (Verify cmd) | codegen `run.js` | parallel (disjoint parquet outputs) |
| **dev** | shipped (v5.56.0, PR#8), parity-proven on hylo-tauri | exit-code (test RED→GREEN) | codegen `run.js` | sequential (shared tree, no isolation v1) |
| **writing** | **GATE step landed + tested** (`writing_gate_probe.py`); compile=data, spec-layer backstop, AND emitter-canonical all confirmed live | judgment+empirical — ✅ **confirmed** (deterministic floor in runner + semantic authority outside) | **data work-list** (section-index) — ✅ **confirmed live** | — |

**Critical caveat for extraction — NOW RESOLVED:** ds and dev were *close cousins* (same exit-code
trust-class, same codegen compile-output), so they could not validate a seam along an axis where they
were identical. **Writing is the third instance that broke that symmetry, and all of its axes have now
landed:** compile=DATA (section-index), the spec-layer stale-gate backstop, the born-canonical emitter
(doctrine #6), and now the GATE step. **Every seam below is confirmed across three instances spanning
both trust-classes and both compile-outputs.** The only thing between here and pass #9 is writing's
A/B parity run — a *validation* step, not a design unknown.

## SHARED seams (candidate common-infra)

| # | Seam | Confidence | Notes |
|---|------|-----------|-------|
| **S1** | Deterministic table parser + DAG/topo/cycle logic (columns via a column-map) | ✅ ds+dev proven | Python; shared by compiler AND guard. The single best decision (makes "compiles ⇔ passes gate" a property). |
| **S2** | Run-template DRIVER: topo + level-iteration + gate-first idempotent skip + pause(declared ⏸ + dynamic R4) + uniform result + **intra-level execution as a CORE compiler-derived flag** | ✅ ds+dev proven | `intraLevel` is **derived by the compiler, not a domain seam**: parallel IFF the level's tasks write provably-disjoint DECLARED outputs, else sequential (safe default). ds's disjoint parquets qualify automatically; dev's shared tree never does → sequential **by construction, not convention**. Runtime-computed output paths → not statically provable → sequential. (This kills the earlier `D5` proposal.) |
| **S3** | Pause/resume protocol: `args.decisions` + `clearedPauses`; two-kinds-of-decision routing; **stale-gate backstop (LAYER-AGNOSTIC: data \| spec)** | ✅ ds+dev+writing proven live | Backstop shape is constant — *a gate-changing decision leaves a stale UPSTREAM artifact; the deterministic checker fails loud rather than the implementer bending to satisfy it* — at whatever LAYER the gate lives. **data layer** (ds/dev): the decision leaves a stale Verify ASSERTION; implementer re-blocks (dev: a `readwiseSync` signature decision → code changed, stale Verify stayed RED). **spec layer** (writing): a thesis reframe leaves a stale `*_REVIEWED.md` whose claim/Part count disagrees with live `OUTLINE.md` → the deterministic section-index compile fails loud. Gate-changing routing is likewise layer-agnostic: edit the stale upstream artifact *at its layer* (Verify cmd / OUTLINE+re-approve) + recompile. |
| **S4** | Result/payload schema: `overallPass, tasksThatFailed, findings{deviations, numbered summary/evidence}, reviews, scoreTable, tasksRemaining` — **a first-class TYPE, not a literal** | ✅ ds+dev proven | The catch-channel: the gate caught **zero** bugs in BOTH instances; the payload caught them. Make it fixed from day 1. |
| **S4-art** | Gate result MUST include **`artifactsPresent`** (the artifact is corroborated INDEPENDENTLY of the pass signal — a pass can be stale OR gamed in every domain) | ✅ ds+dev proven; concept domain-general | The *return contract* `{pass, artifactsPresent, evidence}` is shared; the *body* that computes it is injected (`D1`). dev proof: `tsc --noEmit` passes before the file exists (filesPresent guards); a faked/absent failing test (testPresent guards). |
| **S5** | Compile = **produce the work-list**; the EMIT representation is per-domain (codegen `run.js` for ds/dev vs a data work-list artifact for writing) | ✅ **CONFIRMED across both forms** | codegen (ds/dev) + **data section-index (writing, parity-passed live)** — the code-vs-data split now has a proven instance on each side. The shared part is "produce the work-list"; the emit step is the `S5` injected interface. |
| **S6** | Guard↔parser reconciliation discipline: ONE format spec; **strict-at-emitter / tolerant-at-parser**; the guard asserts ONLY structural validity (cycles/missing cells/dangling), NEVER format | ✅ ds+dev proven | All tolerance lives in the parser, one place. |
| **S7** | Compile-step language straddle (intrinsic, not an -ism): PARSER+COMPILER+GUARD = Python (portable data+DAG); RUN-TEMPLATE = JS (runtime-bound — Workflow can't exec shell) | ✅ ds+dev identical | Name it so a porter doesn't fight it. |

## INJECTED per-domain seams (the real fork)

| # | Seam | Shared contract? | Per-instance |
|---|------|------------------|--------------|
| **D1** | `gateProbe(t)` body | **YES** — returns `{pass, artifactsPresent, evidence, scope}` (S4-art). **SHARPENED by writing: `probe.pass` is ALWAYS deterministic** — exit-code OR mechanical floor, never a returned judgment. **ADDENDUM (writing): a floor must DISCLOSE its blind spot** — a clean `pass:true` must NEVER imply the floor verified tokens/quantities it couldn't check, so the contract carries a coverage **`scope` (checked / not-checked)** and `evidence` states it. | ds: run Verify (exit-code, sufficient) · dev: run test + filesPresent + testPresent (exit-code, sufficient) · writing: a deterministic floor (section-index/structure present, sources pinned) that is **necessary-not-sufficient** AND **scope-disclosing** — e.g. a Bluebook regex floor false-positived on `§ 78mm` and was blind to spelled-out numbers, so it must SAY it didn't check those; the SEMANTIC verdict (writing-review + source-verify) is the **PRIMARY arbiter OUTSIDE `run.js`**, never inside the probe |
| **D2** | `implementerPrompt(t)` | partial (output-first vs TDD failing-test-first; no-phantom-RED clause) | per-domain |
| **D3** | Task-spec COLUMNS | column-map feeds S1 | ds: Outputs/Expected/Verify · dev: Files/Failing Test/Verify Command |
| **D4** | tier/effort policy | no | ds: heuristic by task weight · dev: inherit session model (TDD needs capability) · **pull out of the shared compiler** |

*(The earlier `D5` "intra-level executor" is NOT a per-domain seam — it folded into `S2` as a
compiler-derived disjointness flag. If a domain later adds per-task worktree isolation, that becomes a
second input to the same derivation — parallel-safe even on a shared tree — without re-architecture.)*

## DOCTRINE (domain-agnostic — lives in the core, never re-typed per domain)

1. **Payload > pass/fail** — surface `deviations` + a numbered `summary`/`evidence` at every pause; it is the catch-channel.
2. **Mandatory R4** — grain/sample/schema/interface/methodology changes BLOCK and pause; never silent auto-resolve.
3. **Probe corroborates the artifact** (S4-art) — never trust the pass signal alone; a pass can be stale or gamed in every domain. **And a deterministic FLOOR must disclose its blind spot:** a clean `pass:true` must not imply coverage it doesn't have, so the floor's evidence SCOPES what it actually checked (checked / not-checked). This is the floor's analog of the semantic-gate lesson ("vague-evidence pass = the failure mode in a judge's robe") — it keeps *necessary-not-sufficient* honest about WHERE the sufficiency boundary lies. (writing: a regex floor that false-positives or is blind to a token form must say so, not pass silently.)
4. **Adversarial review stays OUTSIDE the runner** — and is the *primary arbiter* (not a backstop) when the real gate is semantic. Writing's sharpening makes this exact: the runner's `gateProbe` only ever returns a **deterministic floor** (necessary, never a returned judgment); the **semantic authority lives entirely outside `run.js`**. So "judgment trust-class" = *deterministic-floor-in-runner + semantic-authority-outside* — there is no LLM judge *inside* the probe to game. (This also kills the "haiku judging prose" failure mode by construction.)
5. **No LLM between a structured producer and a strict checker** — it silently absorbs drift and masks spec bugs (the ds sleeper: `docs/investigations/2026-06-26_llm-discovery-masked-spec-drift.md`). Parse deterministically.
6. **Emitter-canonical** — ONE format spec shared by emitter, parser, and guard; strict-at-emitter / tolerant-at-parser. The plan EMITTER writes canonical so plans are born canonical; the parser's tolerance is then a back-compat shim, not the primary defense.

> ✅ **Doctrine #6 now has a WORKED INSTANCE (writing).** Writing closed the emitter gap *first*:
> born-canonical `OUTLINE` from writing-setup + per-section source-pinning from writing-outline, so
> **tolerance is eliminated, not relocated** — the model for what "born-canonical" looks like end-to-end.
> ⚠ **Still open in ds and dev:** both built a tolerant parser + reconciled guard but left the *producer*
> free-form (tolerance lives in regex — exactly what doctrine #5's investigation warns relocates rather
> than removes the risk). Their next increment is to follow writing's pattern. (ds DESIGN §8b; dev §9.)

## Orthogonal axes (record separately so extraction doesn't conflate them)

- **PAUSE kind** (a *human-decision* return): declared (`⏸ PAUSE:` in the plan) vs dynamic (R4 block at runtime).
- **DECISION kind:** gate-changing vs behavior-only (`args.decisions`). Gate-changing is **layer-agnostic** — edit the stale upstream artifact *at its layer* + recompile (data layer: the Verify cmd; spec layer: `OUTLINE.md` + re-approve `*_REVIEWED.md`). See S3.
- **gateProbe TRUST-CLASS:** the *runner-side probe is ALWAYS deterministic* — what varies is whether that deterministic result is **sufficient** (exit-code: ds/dev — the gate IS the probe) or merely a **necessary floor** (semantic domains: writing — the probe checks structure/source-pinning, and the sufficient authority is the adversarial review OUTSIDE `run.js`, doctrine #4). There is no judgment *returned by* the probe — so nothing inside the runner to game.
- **RETURN-REASON** — the authoritative frame for *why the runner yields to the skill*, and the one the core should model explicitly:

  `RETURN-REASON = { done | hard-fail | pause-human(declared | dynamic-R4) | yield-for-recheck(fullsuite | coverage | …) }`

  **`pause-human` is the human-decision SUBSET only** (the PAUSE-kinds above). **`yield-for-recheck` is automated — NO human decides:** the runner returns control so the skill runs a cross-cutting gate, then green → auto-resume (`clearedFullSuite`/`clearedRecheck`), red → fix via `onlyChecks`. dev's **`fullsuite`** (yield when a level re-touches an earlier level's file AND did real work) and ds's **`coverage`** (`ds-validate-coverage`, run once-at-end today rather than mid-run) are both `yield-for-recheck`, NOT pause-kinds. **Extraction note:** dev's current impl MUXES recheck onto the pause channel (`paused:true, pauseKind:"fullsuite"`) as a shortcut; the extracted core should give `yield-for-recheck` its **own return channel**, separate from human pause, so "human must decide" and "skill must re-check" never conflate.

## Hindsight adopted into the core (from ds, agreed by dev)

- **Probe-authoritative skip by default**; the PLAN `[x]` blind-skip is an explicit opt-in fast-path flag, not the default (ds's `reverifyDone` was a bolt-on).
- **Payload schema is a fixed first-class TYPE from day 1** (S4), not an evolved literal.
- **Per-domain forcing fixture for the stale-gate backstop** (ds: `ds-grain-pause`; dev: signature-canary) — the fixture is per-domain, the backstop logic (S3) is shared.

## Extraction readiness (pass #9) — ALL SEAMS CONFIRMED (3 instances)

- **Firm to extract (✅ proven across 3 instances):** S1, S2 (incl. the intra-level flag), S3 (backstop
  layer-agnostic across ds+dev+writing), S4, S5 (code↔data emit, both forms proven), S6, S7, and the
  helpers `collect()/scoreTable()/pausePayload()`.
- **`D1` is now confirmed too** — its third (semantic) instance landed with writing's GATE step, and it
  came with a *sharper* contract than we'd specified: the runner-side `probe.pass` is **always
  deterministic** (exit-code OR a necessary mechanical floor); the semantic authority is the adversarial
  layer OUTSIDE `run.js`, never a judgment returned by the probe. So `D1`'s shared return contract
  `{pass, artifactsPresent, evidence}` holds across all three, and the injected body is always
  deterministic — no LLM judge inside the runner to game.
- **No design-gated seam remains.** The only thing before pass #9 is writing's **A/B parity run** — a
  validation step, not a design unknown.
- **Run-core gateProbe CONTRACT item (pass #9):** the gate return contract gains a coverage **`scope`**
  (checked / not-checked) — a clean `pass` must not over-claim (doctrine #3 addendum). The wc-creator
  birther `GATE_SCHEMA` should add it too (it's the floor's analog of the semantic "vague-evidence" guard
  the template already carries). Worked regex-fix lives in writing.
- **Extraction cleanup items (impl, not seam):** give `yield-for-recheck` its own return channel + a
  durable (args-tracked) recheck trigger so it survives a resume on a co-located level (documented as a
  compile-time constraint for now — see the wc-creator birther template); pull `D4` tier policy out of
  the shared compiler.
- **Recommendation:** once writing's A/B parity lands, pass #9 extracts the full firm core; `D1`'s body
  stays an injected interface (now with all three trust-class shapes as reference), not because it's
  under-determined but because its computation is intrinsically per-domain.

---
*Maintainers: ds-refactor (owner of this file) · dev-refactor (DESIGN §9, dev view) · writing-refactor (third instance — all axes now landed; A/B parity pending).*
