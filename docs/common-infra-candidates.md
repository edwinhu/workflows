# Common-infra candidates: the shared run-core seams (CAPTURE — do NOT extract yet)

> **Canonical** cross-workflow seam list for the compiled-runner pattern. Owned here (ds vantage);
> `dev`'s DESIGN §9 holds the dev-side view and points to this file. **GUARDRAIL: this records
> candidate seams; it does NOT authorize extraction.** Extraction is pass #9. As of writing's step-1
> landing, the firm core has THREE proven instances; the **only** remaining writing-gated seam is the
> `D1` gateProbe **judgment** body (writing's compile=data and spec-layer backstop are now confirmed
> live). A seam confirmed only inside the ds+dev quadrant is not yet a seam — see Confidence.

## Instances (what we're generalizing from)

| Instance | Status | Gate trust-class | Compile output | Intra-level |
|----------|--------|------------------|----------------|-------------|
| **ds** | shipped (PR#7, merged) | exit-code (Verify cmd) | codegen `run.js` | parallel (disjoint parquet outputs) |
| **dev** | shipped (v5.56.0, PR#8), parity-proven on hylo-tauri | exit-code (test RED→GREEN) | codegen `run.js` | sequential (shared tree, no isolation v1) |
| **writing** | **step-1 landed, blind-oracle parity-passed** (compile=data + spec-layer backstop confirmed live); GATE/judgment step still pending | judgment (semantic) — *pending* | **data work-list** (section-index) — ✅ **confirmed live** | — |

**Critical caveat for extraction:** ds and dev are *close cousins* — **same trust-class (exit-code)
and same compile-output (codegen)**. Two cousins cannot validate a seam along an axis where they are
identical. Writing is the third instance that breaks that symmetry, and it is **landing in steps**:
its **compile=DATA** form (section-index, not codegen) and its **spec-layer stale-gate backstop** are
now **parity-confirmed live** — so the compile-output axis is resolved. The **judgment trust-class**
gate body is the **only** remaining axis where ds+dev are identical and writing has not yet proven a
third point — it awaits writing's GATE step.

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
| **D1** | `gateProbe(t)` body | **YES** — returns `{pass, artifactsPresent, evidence}` (S4-art) | ds: run Verify + outputs-exist · dev: run test + filesPresent + testPresent · writing: semantic judge, evidence-IS-corroboration |
| **D2** | `implementerPrompt(t)` | partial (output-first vs TDD failing-test-first; no-phantom-RED clause) | per-domain |
| **D3** | Task-spec COLUMNS | column-map feeds S1 | ds: Outputs/Expected/Verify · dev: Files/Failing Test/Verify Command |
| **D4** | tier/effort policy | no | ds: heuristic by task weight · dev: inherit session model (TDD needs capability) · **pull out of the shared compiler** |

*(The earlier `D5` "intra-level executor" is NOT a per-domain seam — it folded into `S2` as a
compiler-derived disjointness flag. If a domain later adds per-task worktree isolation, that becomes a
second input to the same derivation — parallel-safe even on a shared tree — without re-architecture.)*

## DOCTRINE (domain-agnostic — lives in the core, never re-typed per domain)

1. **Payload > pass/fail** — surface `deviations` + a numbered `summary`/`evidence` at every pause; it is the catch-channel.
2. **Mandatory R4** — grain/sample/schema/interface/methodology changes BLOCK and pause; never silent auto-resolve.
3. **Probe corroborates the artifact** (S4-art) — never trust the pass signal alone; a pass can be stale or gamed in every domain.
4. **Adversarial review stays OUTSIDE the runner** — and becomes *primary* (not a backstop) when the gate trust-class is *judgment* (it can lie where an exit code can't).
5. **No LLM between a structured producer and a strict checker** — it silently absorbs drift and masks spec bugs (the ds sleeper: `docs/investigations/2026-06-26_llm-discovery-masked-spec-drift.md`). Parse deterministically.
6. **Emitter-canonical** — ONE format spec shared by emitter, parser, and guard; strict-at-emitter / tolerant-at-parser. The plan EMITTER writes canonical so plans are born canonical; the parser's tolerance is then a back-compat shim, not the primary defense.

> ⚠ **DEFERRED FOLLOW-UP (open in BOTH ds and dev):** neither instance has hardened its plan EMITTER to
> write born-canonical — both built a tolerant parser + reconciled guard but left the producer
> free-form. Until the emitter is canonical and the guard goes strict, tolerance lives in regex —
> exactly what doctrine #5's investigation warns relocates (not removes) the silent-tolerance risk.
> (ds DESIGN §8b; dev DESIGN §9.) This is the next increment for both, not a per-domain miss.

## Orthogonal axes (record separately so extraction doesn't conflate them)

- **PAUSE kind** (a *human-decision* return): declared (`⏸ PAUSE:` in the plan) vs dynamic (R4 block at runtime).
- **DECISION kind:** gate-changing vs behavior-only (`args.decisions`). Gate-changing is **layer-agnostic** — edit the stale upstream artifact *at its layer* + recompile (data layer: the Verify cmd; spec layer: `OUTLINE.md` + re-approve `*_REVIEWED.md`). See S3.
- **gateProbe TRUST-CLASS:** exit-code (honest, can't lie) vs judgment (can be gamed → evidence must be richest; doctrine #4 promotes adversarial review to primary).
- **RETURN-REASON** — the authoritative frame for *why the runner yields to the skill*, and the one the core should model explicitly:

  `RETURN-REASON = { done | hard-fail | pause-human(declared | dynamic-R4) | yield-for-recheck(fullsuite | coverage | …) }`

  **`pause-human` is the human-decision SUBSET only** (the PAUSE-kinds above). **`yield-for-recheck` is automated — NO human decides:** the runner returns control so the skill runs a cross-cutting gate, then green → auto-resume (`clearedFullSuite`/`clearedRecheck`), red → fix via `onlyChecks`. dev's **`fullsuite`** (yield when a level re-touches an earlier level's file AND did real work) and ds's **`coverage`** (`ds-validate-coverage`, run once-at-end today rather than mid-run) are both `yield-for-recheck`, NOT pause-kinds. **Extraction note:** dev's current impl MUXES recheck onto the pause channel (`paused:true, pauseKind:"fullsuite"`) as a shortcut; the extracted core should give `yield-for-recheck` its **own return channel**, separate from human pause, so "human must decide" and "skill must re-check" never conflate.

## Hindsight adopted into the core (from ds, agreed by dev)

- **Probe-authoritative skip by default**; the PLAN `[x]` blind-skip is an explicit opt-in fast-path flag, not the default (ds's `reverifyDone` was a bolt-on).
- **Payload schema is a fixed first-class TYPE from day 1** (S4), not an evolved literal.
- **Per-domain forcing fixture for the stale-gate backstop** (ds: `ds-grain-pause`; dev: signature-canary) — the fixture is per-domain, the backstop logic (S3) is shared.

## Extraction readiness (pass #9) — what's firm vs writing-pending

- **Firm to extract now (✅ proven):** S1, S2 (incl. the intra-level flag), S3 (backstop now proven
  layer-agnostic across ds+dev+writing), S4, S6, S7, and the helpers `collect()/scoreTable()/pausePayload()`
  (~90% identical across ds+dev). **S5** is now firm too — the code↔data emit split has a proven instance
  on each side (ds/dev codegen, writing data section-index); the emit STEP is an injected interface but
  the split itself is confirmed.
- **Still awaiting writing's GATE step (the LAST under-determined axis):**
  - `D1` gateProbe **judgment** body + S4-art evidence-as-corroboration. Exit-code bodies (ds/dev) are
    proven; the judgment body is the only place ds+dev are still identical and writing hasn't yet landed a
    third point (writing's compile + spec-backstop are done; its GATE is pending).
- **Extraction cleanup items (impl, not seam):** give `yield-for-recheck` its own return channel
  (dev currently muxes it onto the pause channel); pull `D4` tier policy out of the shared compiler.
- **Recommendation:** pass #9 extracts the firm core now and ships `D1`'s gateProbe body as the one
  injected interface still pending its third (judgment) instance; promote it once writing's GATE step is
  parity-proven.

---
*Maintainers: ds-refactor (owner of this file) · dev-refactor (DESIGN §9, dev view) · writing-refactor (the third instance that resolves the ◑ rows).*
