# Generalization assessment: the compiled-runner pattern beyond ds

> **Superseded for DS and dev (2026-07-31).** This compiler-era assessment is retained for historical provenance, not as an implementation guide. Both current built-ins use receipt-selected native generated plans, TaskList, project auto-memory, and returned review/verification results rather than their former compilers or generated runners.

> After proving `spec → plan → compiled run.js` on ds (parity complete, engine retired). Per the brief:
> find the **shared core** (compile + run-template + pause protocol) vs the **per-domain template**, and
> **don't force a rewrite where the current shape already works.** This is an assessment, not a rewrite.

## The shared core (domain-agnostic — extract once a 2nd domain validates it)

Everything ds-specific in the new design is actually three small seams (below); the rest is reusable:

- **The deterministic table parser** (`ds_plan_table.py`) — a markdown DAG table → task specs, shared by
  the compiler and the executable-guard. The *columns* differ per domain; the parse/DAG/cycle logic does not.
- **The run-template driver** — topo-sort → level-parallel → gate-first idempotent skip → **pause** (declared
  `⏸ PAUSE:` + dynamic R4) → uniform result schema (`tasksThatFailed`, `findings`, `reviews`, `scoreTable`).
- **The pause/resume protocol** — `args.decisions` + `clearedPauses`; the **two-kinds-of-decision** routing
  (gate-changing → edit plan + recompile; behavior-only → `args.decisions`) + the stale-gate backstop.
- **The compile step** — plan table → `run.js` literal from a template; deterministic, no LLM.

## The per-domain seam (only three things change)

1. **The task-spec columns** (what the plan table carries).
2. **`implementerPrompt(t)`** — how a task is produced.
3. **`gateProbe(t)`** — how a task is gated. **This is the real fork:** ds/dev gates are a *command exit
   code*; writing/workshop gates are a *semantic judgment*. So the extracted core must treat `gateProbe` as a
   **domain-provided function returning `{pass, outputsPresent, evidence}`** — the driver stays agnostic to
   how "pass" is computed. That single abstraction is what makes the core reusable across exit-code and
   judgment gates.

## Per-domain fit

| Domain | Plan table / guard today | Gate type | Fit | Recommendation |
|--------|--------------------------|-----------|-----|----------------|
| **dev** | `dev-implement.js` (same discovery→per-level→verifier shape); `Task\|Deps\|Files\|Failing Test\|Verify Command\|Implements`; **`dev-plan-executable-guard.py` exists** | **exit code** (Verify Command) — same as ds | **★ best** | **Port FIRST.** Same gate mechanism, existing guard, existing table. TDD twist: implementer is *failing-test-first* (gate-first probe expects RED before impl, GREEN after) — a variant of output-first, not a new gate type. Lowest-risk second domain; proves the core generalizes. |
| **workshop** | `workshop-generate.js`; `workshop-outline-executable-guard.py` exists; slides | **visual/structural** (render + look-at; `workshop-verify.js`) | ◑ medium | After dev. `gateProbe` becomes render→structural/visual check (reuse `workshop-verify`), returning `{pass, evidence}`. Validates the judgment-gate abstraction. |
| **writing** | `writing-draft.js`; outline-driven; `writing-claim-id-guard.py` | **claim-id / source-fidelity** (semantic, not exit code) | ◑ medium | After workshop. `gateProbe` = source-fidelity agent. Pauses map to editorial decisions. The two-kinds finding still applies: a decision to recast a claim changes the fidelity check (gate-changing). |
| **workflow-creator** | `wc-generate.js` (+ `wc-audit.js`); file generation | structural / test | ◑ low priority | Meta-tooling; `wc-generate` already works. Port only if it earns its keep; not load-bearing. |
| **future external consumer** | **none assessed** | — | ✗ N/A | No concrete workflow is in scope. A future consumer should adopt the contract from the start. |

## Recommended sequence (disciplined, incremental)

1. **Port `dev` next.** It shares the exit-code gate and already has the table + guard, so it's a near-drop-in
   and the **highest-value validation that the core is not ds-specific**. Carry over: the deterministic parser
   (new columns), the run-template (TDD implementer prompt + the Verify-Command probe), the pause protocol, the
   two-kinds-of-decision routing, and reconcile `dev-plan-executable-guard.py` to the shared parser (dev likely
   has the same born-canonical drift ds did).
2. **THEN extract the shared `run-core`.** Not before — extracting an abstraction from a single domain (ds)
   risks baking in ds-isms. With ds + dev both running on it, the genuine core vs seam is empirical, not guessed.
   Target shape: `workflows/templates/run-core.js` (driver + pause + schema, `gateProbe`/`implementerPrompt`
   injected) + `templates/<domain>-task.js` (the two prompts + the columns), composed by a shared `compile`.
3. **Then assess `workshop`/`writing`** against the judgment-gate abstraction (`gateProbe → {pass, evidence}`).
   These are the real test of whether the core spans exit-code *and* semantic gates. Do them only if the core
   stays clean; if a domain's gate doesn't fit, that's a finding, not a forcing function.
4. **Leave `wc` and hypothetical external consumers alone** unless they earn a port.

## What carries over for free (lessons already paid for)

- **Deterministic compile kills the discovery-LLM spec-drift mask** — every domain with an LLM "discovery"
  re-parse (dev has one) is hiding the same gap ds was. Reconcile each guard to its shared parser.
- **The gate caught zero bugs; the deviation note + adversarial review did** — so every domain's pause/finding
  payload must carry `deviations` + a numbered/evidence `summary`, and keep its adversarial layer (dev's full
  suite, writing's review, workshop's verify) **outside** `run.js`.
- **Two kinds of decision + stale-gate backstop** — any domain whose gate a decision can change (dev: an API
  signature decision changes the test; writing: recasting a claim changes the fidelity check) needs the same
  routing: bake gate-changing decisions into the plan + recompile; the implementer re-blocks on a stale gate.

## ⚠ Semantic gates raise the stakes on the central lesson (carry into writing/workshop)

When `gateProbe` becomes a semantic domain function (`{pass, evidence}`), **the gate itself becomes an LLM
judgment — which can be wrong or gamed in a way an exec exit-code cannot.** An exit-code gate can't lie; a
"does this section cover its outline / cite only its sources" judge can. So for semantic-gate workflows the
effort's central finding — *the gate caught zero bugs; the deviation note + adversarial review caught them* —
gets **STRONGER, not weaker**:

- **Never let the semantic `gateProbe` be the sole arbiter.** Keep the domain's adversarial review layer
  (writing's review, workshop's verify) robust and OUTSIDE `run.js` — it is the real correctness authority, more
  so than in ds/dev where the exit-code gate is at least honest.
- **`{evidence}` must carry the same numbered/specific detail the muni payloads did.** The evidence IS the
  human's catch-channel (exactly as `deviations` + numbered `summary` were for ds). A semantic gate that returns
  `pass:true` with vague evidence is the funnel-clobber / 8.8%-dedup failure mode wearing a judge's robe.
- **Both generalizing invariants apply unchanged:** payload > pass/fail, and two-kinds-of-decision + stale-gate
  backstop (a writing decision to recast a claim changes the fidelity check = gate-changing → edit plan +
  recompile). Semantic gates don't relax these; they make them load-bearing.

## Bottom line

The core **does** generalize, but the honest unit of generalization is `gateProbe` as a domain function, not a
single template. **Port dev next to prove it on a second exit-code domain, then extract the core, then test it
against a judgment-gate domain** — where the gate becomes an LLM judgment and the adversarial-review +
evidence-rich-payload disciplines become the primary safety net, not a backstop. Do not rewrite working siblings
on spec; let each port earn itself.
