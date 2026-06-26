# Common-infra candidates: the shared run-core seams (CAPTURE — do NOT extract yet)

> **Canonical** cross-workflow seam list for the compiled-runner pattern. Owned here (ds vantage);
> `dev`'s DESIGN §9 holds the dev-side view and points to this file. **GUARDRAIL: this records
> candidate seams; it does NOT authorize extraction.** Extraction is pass #9 and is **gated on
> writing parity** for the seams marked writing-pending below (a seam confirmed only inside the
> ds+dev quadrant is not yet a seam — see Confidence).

## Instances (what we're generalizing from)

| Instance | Status | Gate trust-class | Compile output | Intra-level |
|----------|--------|------------------|----------------|-------------|
| **ds** | shipped (PR#7, merged) | exit-code (Verify cmd) | codegen `run.js` | parallel (disjoint parquet outputs) |
| **dev** | shipped (v5.56.0, PR#8), parity-proven on hylo-tauri | exit-code (test RED→GREEN) | codegen `run.js` | sequential (shared tree, no isolation v1) |
| **writing** | **design data-point only — NOT parity-proven** | judgment (semantic) | **data work-list** (runner is already a generic fan-out) | — |

**Critical caveat for extraction:** ds and dev are *close cousins* — **same trust-class (exit-code)
and same compile-output (codegen)**. Two cousins cannot validate a seam along an axis where they are
identical. Every "generalized" form below whose generality comes from the *judgment* gate or the
*data* compile-output rests on **writing**, which is a design data-point, not a proven instance.

## SHARED seams (candidate common-infra)

| # | Seam | Confidence | Notes |
|---|------|-----------|-------|
| **S1** | Deterministic table parser + DAG/topo/cycle logic (columns via a column-map) | ✅ ds+dev proven | Python; shared by compiler AND guard. The single best decision (makes "compiles ⇔ passes gate" a property). |
| **S2** | Run-template DRIVER: topo + level-iteration + gate-first idempotent skip + pause(declared ⏸ + dynamic R4) + uniform result + **intra-level execution as a CORE compiler-derived flag** | ✅ ds+dev proven | `intraLevel` is **derived by the compiler, not a domain seam**: parallel IFF the level's tasks write provably-disjoint DECLARED outputs, else sequential (safe default). ds's disjoint parquets qualify automatically; dev's shared tree never does → sequential **by construction, not convention**. Runtime-computed output paths → not statically provable → sequential. (This kills the earlier `D5` proposal.) |
| **S3** | Pause/resume protocol: `args.decisions` + `clearedPauses`; two-kinds-of-decision routing; **stale-gate backstop** | ✅ ds+dev proven (backstop verified live in BOTH) | dev: a `readwiseSync` signature decision → code changed, stale Verify stayed RED, implementer re-blocked. Verbatim translation. |
| **S4** | Result/payload schema: `overallPass, tasksThatFailed, findings{deviations, numbered summary/evidence}, reviews, scoreTable, tasksRemaining` — **a first-class TYPE, not a literal** | ✅ ds+dev proven | The catch-channel: the gate caught **zero** bugs in BOTH instances; the payload caught them. Make it fixed from day 1. |
| **S4-art** | Gate result MUST include **`artifactsPresent`** (the artifact is corroborated INDEPENDENTLY of the pass signal — a pass can be stale OR gamed in every domain) | ✅ ds+dev proven; concept domain-general | The *return contract* `{pass, artifactsPresent, evidence}` is shared; the *body* that computes it is injected (`D1`). dev proof: `tsc --noEmit` passes before the file exists (filesPresent guards); a faked/absent failing test (testPresent guards). |
| **S5** | Compile = **produce the work-list**; the EMIT representation is per-domain (codegen `run.js` for ds/dev vs a data work-list artifact for writing) | ◑ ds+dev proven for codegen; **data form writing-pending** | Generalized form rests on writing's design, not a proven instance. |
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
- **DECISION kind:** gate-changing (edit the plan's Verify + recompile) vs behavior-only (`args.decisions`).
- **gateProbe TRUST-CLASS:** exit-code (honest, can't lie) vs judgment (can be gamed → evidence must be richest; doctrine #4 promotes adversarial review to primary).
- **RETURN-REASON** (the cleaner frame for *why the runner yields to the skill*): `pause-human` (the PAUSE-kinds above) · `done` · `hard-fail` · **`yield-for-recheck`**. dev's new **`fullsuite`** checkpoint (yield when a level re-touches an earlier level's file AND did real work, so the skill runs its full suite) is a `yield-for-recheck`, **NOT** a third human-pause-kind — it returns control for an *automated cross-cutting gate*, not a human decision. ds's analog is running `ds-validate-coverage` (it does so once at the end rather than mid-run). Candidate-for-core, generalization **TBD** — record under return-reasons, do not fold into the human-pause taxonomy.

## Hindsight adopted into the core (from ds, agreed by dev)

- **Probe-authoritative skip by default**; the PLAN `[x]` blind-skip is an explicit opt-in fast-path flag, not the default (ds's `reverifyDone` was a bolt-on).
- **Payload schema is a fixed first-class TYPE from day 1** (S4), not an evolved literal.
- **Per-domain forcing fixture for the stale-gate backstop** (ds: `ds-grain-pause`; dev: signature-canary) — the fixture is per-domain, the backstop logic (S3) is shared.

## Extraction readiness (pass #9) — what's firm vs writing-pending

- **Firm to extract now (✅ ds+dev, two proven instances):** S1, S2′, S3, S4, S6, S7, and the helpers
  `collect()/scoreTable()/pausePayload()` (~90% identical across ds+dev).
- **Leave as injected interfaces until writing parity (◑ one quadrant / design-only):**
  - `D1` gateProbe **judgment** body + S4-art evidence-as-corroboration (only exit-code bodies are proven).
  - `S5` **data** work-list emit (only codegen is proven).
  - These two are under-determined precisely because ds+dev are identical on the trust-class and
    compile-output axes. **Recommendation:** pass #9 extracts the firm core (incl. S2's intra-level
    flag) and ships `D1` (gateProbe body) + `S5`'s emit step as injected interfaces; revisit promoting
    the judgment/data forms once writing is parity-proven.

---
*Maintainers: ds-refactor (owner of this file) · dev-refactor (DESIGN §9, dev view) · writing-refactor (the third instance that resolves the ◑ rows).*
