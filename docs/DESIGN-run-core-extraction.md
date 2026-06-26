# DESIGN: `templates/run-core.js` — extracting the shared compiled-runner core (pass #9)

> **Status:** DRAFT for USER sign-off (pre-cutover). Extraction of PROVEN code across three shipped
> instances (ds PR#7, dev v5.56.0/PR#8, writing v5.57.0/PR#18). Seam list
> (`docs/common-infra-candidates.md`, CLOSED at PR#15) is the authoritative spec; this is the concrete
> plan that implements it. Corrections from the three reference authors (dev-refactor, ds-refactor —
> canonical owner, writing-refactor) + a 4th-instance input (workshop-refactor) are folded in below.
> **NO cutover lands until the USER signs off on §3 (the interface) and §8 (open questions).**

---

## IMPLEMENTED (worktree `worktree-run-core-extract`, awaiting cutover sign-off)

Steps 1–4 + the Step-3 cleanup are **built and green**; the §6 acceptance gates pass:

| Gate | Result |
|------|--------|
| ds-run-driver | 28/28 |
| ds-grain-pause (stale-gate backstop) | 17/17 |
| dev-run-driver (incl. fullsuite yield-for-recheck leg) | 35/35 |
| ds + dev Python parsers | 15/15 + 32/32 |
| writing acceptance (DESIGN-named): gate-probe / engine-discover | 23/23 + 13/13 |
| `node --check` on both compiled run.js | clean (ds modes=parallel, dev=sequential) |

- **Files added:** `workflows/templates/run-core.js` (229), `ds-task.js` (82), `dev-task.js` (117) =
  **428 lines replacing 506** (the two old templates, now dead).
- **Files modified:** `ds_compile.py`, `dev_compile.py` (splice + level-mode derivation + `node --check`),
  `ds-implement`/`dev-implement` SKILL.md (returnReason switch + flowchart), 3 driver tests (assert
  `returnReason`).
- **Canonical D1 contract live** `{pass, artifactsPresent, evidence, scope}`; `pass` ⊥ `artifactsPresent`
  with the **core** doing the conjunction (verified by the missing-test / clobbered-output gate tests).
- **`returnReason` enum live**, `paused`/`pauseKind:'fullsuite'` mux removed (0 occurrences in compiled
  output), `decision`→`declared`, both skills migrated together.
- **NOT yet done (the cutover, sign-off-gated):** delete the two old `*-run-template.js`; update the
  remaining doc-prose refs (README, `compiled-runner-template.js`, workflow-creator) — the latter is the
  **birther-convergence follow-up co-owned with wc-creator-review** (§5c), deliberately not done
  unilaterally. Step 5 (dev emitter-canonical) is a pending one-line confirm with dev-refactor.

---

## 0. TL;DR

- **What ships:** one shared `templates/run-core.js` (the ~90% identical driver + helpers + result
  schema + GATE contract + the SIX doctrine invariants + the compiler-derived `intraLevel` flag + the
  RETURN-REASON taxonomy), plus a **tiny** per-domain fragment `templates/ds-task.js` /
  `templates/dev-task.js` containing **exactly three** functions:
  `{ gateProbe(t), implementerPrompt(t), recheckTrigger(results, li) }` (the last defaults to `null`).
  The compiler **splices** core + fragment + data → a **self-contained** `.planning/run.js`.
- **Why splice, not import:** Workflow scripts have no filesystem/import at runtime (only
  `agent/parallel/log/phase/args/return`), and `run.js` is emitted into an *external* project dir with
  no path back to the plugin. Compile-time splice is the **only viable** model.
- **Canonical D1 contract** (writing's exact, tested shape — `scripts/writing/writing_gate_probe.py`):
  `gateProbe(t)` returns `{ pass, artifactsPresent, evidence, scope:{checked, notChecked} }`. **`pass`
  and `artifactsPresent` are ORTHOGONAL** — `pass` = the deterministic gate verdict alone (exit-code /
  mechanical floor); `artifactsPresent` = the independent existence check. **The CORE's `runTask` does
  the conjunction.** Keeping them separate IS doctrine #3 / the funnel-clobber catch ("gate passed but a
  declared output is missing/empty" is a *distinct* finding from "gate failed").
- **One unified driver loop:** `intraLevel` (parallel | sequential) is a **compiler-derived** per-level
  flag (output-disjointness AND a domain isolation-safety constant set upstream). ds → parallel, dev →
  sequential **by construction**.
- **`yield-for-recheck` gets its OWN return channel.** The ad-hoc `{paused, pauseKind, done}` collapse
  into one `returnReason` enum: `done | hard-fail | pause-human | yield-for-recheck`. dev's `fullsuite`
  stops being muxed onto `pauseKind`. Both skills migrate their switch in the **same pass**;
  `pauseKind:'decision'` → `'declared'`.
- **Emitter-canonical (doctrine #6) is essentially CLOSED, not a fold-in:** ds-plan already emits
  canonical (and *intentionally* keeps a tolerant parser — its PLAN is hand-editable, so tolerance is a
  feature, not relocated drift; its guard stays structure-only). The only possibly-open producer is dev
  — to be confirmed with dev-refactor; if open it's a small coordinated increment, otherwise the
  fold-in is a no-op and the canonical doc's "open for ds/dev" hedge is stale (ds-refactor is fixing it).
- **Writing & workshop are NOT driver consumers.** Both are flat `parallel()` fan-outs with no `run.js`.
  They consume the **contracts** (S1 Python parser + column-map, S4 payload, D1 gateProbe shape incl.
  `scope`) — which are already separable from the S2 JS driver by the Python/JS split (S7). The cutover
  does not touch their execute layers; we re-run their parity to prove the shared contract didn't move.

---

## 1. Empirical basis (the diff that proves the seams)

`diff` of the two shipped codegen templates (`ds-run-template.js` 228 ln, `dev-run-template.js` 278 ln):

**Byte-identical or trivially unifiable (→ CORE):** args-parse block, `byId`, `toposort`, `runTask`
skeleton (gate-first skip → implement → fresh gate → conjunction), `scoreTable`, `collect` skeleton,
`pausePayload` skeleton, the driver loop. The `collect` failure-detail strings (ds "outputs not
produced" / dev "failing test not present") **both reduce to the canonical fields** — once `gateProbe`
returns `{pass, artifactsPresent}`, "`artifactsPresent===false`" is the single generic
stale/clobber finding; the domain specifics live in `evidence`. So **no per-domain
`classifyFailure` is needed** — it folds into the core. Likewise `pausePayload`'s domain fields
(ds `expectedOutput`; dev `failingTest/verifyCommand/verifyOutput`) are all **DATA already on the task
spec / impl result** — the core payload spreads the relevant task columns generically; **no per-domain
`payloadExtras` function is needed** either.

**Differs by domain (→ injected, but small):**
| Injection point | ds | dev | Where it lives |
|---|---|---|---|
| `gateProbe(t)` body | run Verify + outputs-exist | run Verify + files + test-exists | **fragment** |
| `implementerPrompt(t)` | output-first | TDD test-first + Global Constraints + Interfaces | **fragment** |
| recheck trigger | none | fullsuite cross-level overlap | **fragment** `recheckTrigger` (default `null`) |
| `intraLevel` | parallel (disjoint parquets) | sequential (shared tree) | **compiler-derived → CORE flag** |
| task COLUMNS (D3) | Outputs/Expected/Verify | Files/Failing Test/Verify | **Python parser column-map → DATA** |
| tier/effort (D4) | heuristic | inherit session model | **Python compiler sets `t.tier` → DATA** |
| `GLOBAL_CONSTRAINTS` | — (empty) | present | **CORE hole, `""` for ds** |

This matches the seam list S1–S7 + D1–D4 exactly. **No new abstraction is required.**

---

## 2. The consumption model (compile-time splice) — load-bearing

```
run-core.js (template, holes)        ds-task.js / dev-task.js  (CODE FRAGMENT: 3 fns)
        \                                   /
       scripts/<domain>/<domain>_compile.py   ← reads BOTH, parses PLAN.md (shared S1 parser)
                          |
   splice fragment into __TASK_BODIES__  ·  fill data holes (__META__/__PROJECT__/__TASKS__/__GC__)
   exactly-once hole-count assertion over the SPLICED text  ·  node --check the result
                          |
              .planning/run.js   ← SELF-CONTAINED, uses only agent/parallel/log/phase + return
```

**Splice rules (from dev-refactor's compiler experience — all adopted):**
1. **FRAGMENT, not module.** `<domain>-task.js` is a bare code fragment (function decls only — no
   `import`/`export`). Spliced into run-core's lexical scope so its `gateProbe`/`implementerPrompt` see
   the driver consts (`PROJECT`, `TASKS`, `agent`, `DECISIONS`, `GLOBAL_CONSTRAINTS`…). Only
   `run-core.js` carries the single `export const meta`.
2. **`const` ordering.** Any `const` in a fragment does not hoist — splice the `__TASK_BODIES__` hole
   **above first use**. (Our fragment is function decls, which hoist, but keep the hole high regardless.)
3. **Disjoint hole namespaces.** Data holes and `__TASK_BODIES__` never overlap; keep the **exactly-once
   hole-count assertion across the SPLICED result** (catches a token leaking into a comment).
4. **`node --check` the spliced output** in the compiler (a splice has more failure modes than a fill).

---

## 3. The `run-core.js` interface (FOR SIGN-OFF)

```js
// templates/run-core.js  — SHARED. Holes: __META__, __PROJECT__, __TASKS__,
//                          __GLOBAL_CONSTRAINTS__ (""/unused for ds), __TASK_BODIES__.
export const meta = /*__META__*/
const PROJECT = /*__PROJECT__*/
const TASKS   = /*__TASKS__*/                    // each spec carries: id, deps, name, implements,
const GLOBAL_CONSTRAINTS = /*__GLOBAL_CONSTRAINTS__*/   // taskText, verify, the domain COLUMNS (D3),
                                                 // tier/effort (D4), done, pauseAfter,
// ── injected domain fragment (3 fns; spliced ABOVE first use) ──   and per-LEVEL intraLevel mode.
/*__TASK_BODIES__*/
// The fragment MUST define, in scope:
//   async gateProbe(t)         -> { pass, artifactsPresent, evidence, scope:{checked,notChecked} }
//   implementerPrompt(t)       -> string
//   function recheckTrigger(results, li) -> levelIdx|null   // dev: fullsuite overlap; ds: () => null

// ── CORE (shared, verbatim) ──
//   GATE_SCHEMA  = the canonical 4-field contract above (what gateProbe RETURNS)
//   TRANSFORM_SCHEMA = shared base {task,status,filesTouched,deviations,summary} + domain-optional fields
//   cfg/DECISIONS/CLEARED/ONLY/REVERIFY_DONE/CLEARED_RECHECK
//   byId, toposort, runTask, scoreTable, pausePayload, collect, the level loop, the SIX invariants
```

### 3.1 Canonical D1 gateProbe contract — `pass` ⊥ `artifactsPresent`

```
gateProbe(t) -> {
  pass:            boolean,   // ALWAYS deterministic: the GATE VERDICT ALONE (exit0 / mechanical floor).
                              //   NEVER a returned judgment, NEVER folded with presence.
  artifactsPresent:boolean,   // INDEPENDENT existence check (a pass can be stale/gamed/clobbered).
  evidence:        object,    // domain-shaped payload (NOT a typed array): {tail} | {bibUnresolved,…}
  scope: { checked: string[], notChecked: string[] }   // a clean pass must NOT over-claim coverage
}
```

- **CORE `runTask` does the conjunction**, never the probe:
  `r.pass = gate.pass && gate.artifactsPresent !== false && impl.outputsProduced !== false`
  (the `outputsProduced` term is the implementer's self-report; `undefined` in domains that don't
  declare it → no effect). This keeps "gate passed but artifact missing/empty (stale/clobbered)" a
  **distinct** finding from "gate failed" — the funnel-clobber catch (invariant iii). **The probe
  returns two independent booleans; the core ANDs them — NO domain pre-folds `artifactsPresent` into
  `pass`** (confirmed across all instances: ds returns `exit0` + `outputsPresent` separately; writing
  returns floor-checks + `draft_path.is_file()` separately). Doctrine (iii) is therefore *purely*
  core-enforced — there is no pre-fold to reason around, and a future sloppy domain that returns raw
  `exit0` as `pass` still gets funnel-clobber protection for free.
- ds probe maps: `pass = exit0`, `artifactsPresent = outputsPresent`. dev probe maps:
  `pass = exit0`, `artifactsPresent = filesPresent && (testRequired? testPresent : true)`
  (dev's two presence checks AND **inside** the probe into the single canonical `artifactsPresent` —
  presence-into-presence, NOT presence-into-`pass`).
- **`scope`** is the new field neither ds nor dev had — the floor's analog of the semantic
  "vague-evidence" guard (doctrine #3 addendum). ds/dev declare what their exit-code + presence check
  does **not** cover (e.g. `notChecked: ["semantic correctness of outputs"]`). Already landed & tested
  in writing (`writing_gate_probe.py`); workshop's widow/overflow regex floor has the identical
  blind-spot-disclosure need.
- **Two deterministic probe-output FLAVORS (5th-instance sharpening, teaching N4 — Tier-2 contract
  clarity, NOT a structural change):** deterministic probe output comes in two kinds, and they must not
  be conflated. **(i) gate-bearing FLOOR** = `pass` (sufficient for exit-code, necessary for semantic).
  **(ii) verdict-feeding ASSIST** = a deterministic *candidate list* that narrows what the OUTSIDE
  semantic authority adjudicates — it lives in `evidence` (e.g. writing's `bibUnresolved`/`citeNeeded`;
  teaching's `uncitedCandidates[]`), is 100% reproducible/no-judgment, but **does NOT bear the gate**.
  Reading an assist as a floor is the *inverted* disguised-semantic defect (G2): pretending a
  candidate-narrowing list is a gate verdict. D1 already subsumes this structurally (`evidence` carries
  the assist; `scope.notChecked` discloses the L3 adjudication the probe does not do); the value is the
  naming so a future implementer keeps the assist OUT of `pass`. ds/dev have only flavor (i); this is a
  CONTRACT-consumer concern (writing/workshop/teaching) and changes nothing in `run-core.js`.
- **INVARIANT (preserved hard):** the runner-side probe is always deterministic; semantic authority
  lives **outside `run.js`** (doctrine #4). No LLM judge inside the probe to game.

### 3.2 Unified driver — `intraLevel` is compiler-derived (CORE, not domain)

```js
for (let li = 0; li < levels.length; li++) {
  const mode = levels[li].mode            // 'parallel' | 'sequential' — set by the COMPILER (S1/S2)
  const results = mode === 'parallel'
    ? (await parallel(todo.map(t => () => runTask(t)))).filter(Boolean)
    : await (async () => { const a = []; for (const t of todo) a.push(await runTask(t)); return a })()
  // … blocked → pause-human/R4 · hard-fail · declared-pause · yield-for-recheck (all shared) …
}
```

**Derivation (shared Python, S1/S2):** a level is `parallel` IFF (1) every task's declared outputs are
statically known (not a runtime glob/dir), (2) pairwise disjoint across the level, AND (3) the domain is
`isolationSafe` (a constant: ds `true`; dev `false` until worktree isolation — the 2nd input). ds →
parallel automatically; dev → sequential by construction (tree corruption impossible). A future dev
worktree mode flips input (3) without re-architecting.

### 3.3 RETURN-REASON — one enum, `yield-for-recheck` its own channel

`collect()` returns exactly one `returnReason`; the `paused` boolean and `pauseKind:'fullsuite'` mux are
**removed**:

```
returnReason: 'done'
            | 'hard-fail'
            | 'pause-human'       + pauseKind: 'declared' | 'R4'        + atTask, payload
            | 'yield-for-recheck' + recheckKind: 'fullsuite' | 'coverage' + atLevel, payload
```

- **`pause-human`** = a human must decide. The orthogonal DECISION axis (gate-changing vs behavior-only)
  is resolved at that branch by the human/skill — **NOT encoded in the return** (per dev-refactor).
- **`yield-for-recheck`** = automated cross-cutting gate, no human. dev's `fullsuite` lives here (driven
  by the fragment's `recheckTrigger`); ds's `coverage` has a home if it ever moves mid-run. **Keep
  `atLevel`** — the skill needs it for `clearedFullSuite += atLevel`. The `clearedFullSuite`/
  `clearedRecheck` resume arg is read into `CLEARED_RECHECK` independent of the label → resume path
  intact.
- **Atomic migration:** both `ds-implement` and `dev-implement` skill loops switch on
  `(r.paused, r.pauseKind)` today; they switch on `returnReason` in the **same commit**, incl.
  `'decision'`→`'declared'`, or label/branch mismatch breaks resume.

### 3.4 The SIX doctrine invariants — in the core preamble, never re-typed per domain
(1) payload > pass/fail · (2) mandatory R4 block · (3) probe corroborates the artifact **independently**
+ a floor **discloses its blind spot (`scope`)** · (4) adversarial review OUTSIDE the runner (primary
arbiter when the gate is semantic) · (5) no LLM between a structured producer and a strict checker ·
(6) emitter-canonical.

---

## 4. Injection surface — the COMPLETE fork is small

**`<domain>-task.js` (JS fragment) = exactly three functions:**
`gateProbe(t)` [D1] · `implementerPrompt(t)` [D2] · `recheckTrigger(results, li)` [default `null`].

**Everything else is CORE or upstream DATA:**
- CORE (run-core.js): the driver, `runTask` conjunction, `scoreTable`, `pausePayload`, `collect`,
  `toposort`, the GATE contract `GATE_SCHEMA`, the unified `TRANSFORM_SCHEMA`, the `returnReason`
  taxonomy, the `intraLevel` branch, the six invariants.
- UPSTREAM DATA (Python, on `__TASKS__`/levels): task COLUMNS (D3, parser column-map), tier/effort (D4,
  domain compiler sets `t.tier`), the per-level `intraLevel` mode (compiler disjointness derivation),
  `isolationSafe`.

---

## 5. Emitter-canonical (doctrine #6) — essentially closed, NOT a fold-in to force

- **ds:** ds-plan **already emits canonical** (`**Tn**` ids, `none`/`T1, T2` deps, `⏸ PAUSE:` markers;
  full spec `docs/ds-plan-canonical-table.md`). ds **deliberately keeps a tolerant parser** because its
  `PLAN.md` is **hand-editable** — tolerance-at-parser is a *feature for hand-edits*, not relocated
  drift; its guard stays **structure-only** (must NOT strict-reject non-canonical). So there is **no
  open ds emitter change**; the canonical doc's "open for ds" hedge is stale (ds-refactor is correcting
  it).
- **dev:** to confirm with dev-refactor whether `dev-plan` already emits born-canonical. If yes →
  fold-in is a no-op. If a gap exists → a **small coordinated increment** (dev-refactor owns the change),
  shipped with: strict guard **and** tolerant-parser back-compat shim in the same pass, golden-tested
  against a **REAL pre-canonical PLAN** (not the template — the template is already canonical and can't
  reveal the drift). Lesson (writing-refactor): emit the **join key byte-identical** across emitter +
  parser + guard + filename.

**Net:** the user-approved emitter fold-in reduces to *verify dev, do nothing for ds*. I will not strip
ds's intentional tolerance.

---

## 5b. Consumers & distribution — TWO tiers (5 instances, 2 repos)

The reference authors surfaced **five** instances across **two** repos. They split cleanly into two
consumption tiers — and conflating them is the trap to avoid:

| Instance | Repo | Shape | Tier |
|---|---|---|---|
| **ds** | workflows | codegen, topo DAG | **DRIVER** — splices `run-core.js` into `run.js` |
| **dev** | workflows | codegen, topo DAG | **DRIVER** — splices `run-core.js` into `run.js` |
| **writing** | workflows | flat `parallel()` fan-out, no run.js | **CONTRACT** — D1 + S4 + six invariants |
| **workshop** | workflows | flat fan-out by section, no run.js | **CONTRACT** (4th instance) |
| **teaching** | **course-materials** (separate repo + plugin) | flat/level fan-out + pure-JS substrate gate, no run.js | **CONTRACT** (5th instance) |

- **Tier 1 — DRIVER (`run-core.js`):** the JS S2 driver (topo / level-iteration / `runTask` /
  `intraLevel` / `returnReason` / `collect`). Consumed by **ds + dev only**, via compile-time splice
  into a self-contained `run.js`. This is the scoped deliverable of pass #9.
- **Tier 2 — CONTRACT (language-agnostic specs):** the D1 `gateProbe` return shape
  `{pass, artifactsPresent, evidence, scope}`, the S4 payload shape, the six invariants, the
  RETURN-REASON taxonomy. Flat-fan-out instances (writing today; workshop, teaching next) **implement**
  these in their own probes/gates — they do NOT import the JS driver. Writing already embodies the
  contract (`writing_gate_probe.py` returns the exact shape). The authoritative reference is
  `docs/common-infra-candidates.md` + the D1 schema in §3.1.

**Why this matters for the answers the satellite authors need (all consistent with §3):**
- *Probe shells the mechanical checks; LLM stays outside* (teaching Q2 / writing's G3'): YES — the D1
  probe body runs the deterministic exit-code/floor checks (overflow.py, widows, anchors, compile) and
  returns `{pass(floor), artifactsPresent, evidence, scope}`; the LLM reviewers remain the **semantic
  authority OUTSIDE** the probe (doctrine #4). Reading an LLM reviewer's `status:OVERFLOW` as the "floor"
  is the disguised-semantic-gate anti-pattern — move the real script into the probe.
- *yield-for-recheck has its OWN channel* (workshop, teaching Q3): YES — §3.3. A professor-approval
  declared pause and an automated `onlyChecks` re-diagnose are both "return to skill" but never conflate.
- *idempotent skip keyed on `artifactsPresent`, never a pass-signal/approval file* (teaching Q4 / S4-art):
  YES — ds/dev `runTask` already skips only when `gate.pass && artifactsPresent` corroborate the **real
  output artifact** (parquet / file+test), never an approval log. Ephemeral `*_APPROVED.md` files must
  not gate a skip.
- *`scope` field landed?* (workshop): landed & tested in writing; ds/dev gain it at §6 step 4. It is the
  cross-instance contract field for every deterministic floor's blind-spot disclosure.

**Distribution / sync discipline (NEW axis, course-refactor Q1) — flagged, not solved in this pass:**
A separate-repo plugin (teaching) cannot `require()` across into the workflows plugin at runtime, and as
a CONTRACT consumer it does not need the JS driver anyway. So:
- Tier-1 `run-core.js` is **not** distributed cross-repo — it is spliced into each project's `run.js`
  inside the owning repo's compiler.
- Tier-2 is a **CONTRACT**, not shipped code: the canonical source of truth is
  `docs/common-infra-candidates.md` + the D1 schema; each consumer implements it natively (teaching in
  its own probe). If a future pass wants shared *executable* helpers cross-repo (a tiny
  `payload/collect` contract-lib), the only runtime-safe model for a separate plugin is a **vendored
  copy pinned to a canonical version** — but that is a **follow-up**, not pass #9 (it is not part of the
  three proven driver instances, and architecting a cross-repo package now would be gold-plating).

**Scope boundary (held firm):** pass #9 lands Tier-1 `run-core.js` (ds+dev) + the Tier-2 D1/`scope`
contract as the authoritative reference. The **shared Python S1 parser** and any **cross-repo
contract-lib** are explicit follow-up passes, co-owned with workshop/writing/teaching (see §8.4).

**Constraint on the S1-parser follow-up (NEW seam datum, workshop-refactor opv-parity, measured live):**
"compile = produce the work-list" (S5) sometimes feeds a consumer whose **correspondence step is
irreducibly semantic**, not deterministic. workshop's verify joins OUTLINE-row ↔ built-slide; where
slide titles drift a *mechanical* join caps at ~72% (measured: −5 body slides read as a real regression).
**Rule for the shared parser: it owns ENUMERATION, never a drifting-identifier JOIN.** So an S5 work-list
row may be either (a) a **mechanical side-table** (deterministic key, e.g. ds parquet paths / dev file
paths) OR (b) **candidate rows for a downstream SEMANTIC join** (the LLM does the correspondence, outside
the parser). The parser-core must not assume (a). This is a refinement of S5 for the canonical seam list
(relayed to ds-refactor, the S5 owner) and a hard design input to the parser-core extraction — do not
bake a deterministic-join assumption into it.

---

## 5c. Birther convergence — the THIRD driver copy (wc-creator)

`wc-creator` (the workflow birther, v5.58.0) ships `workflows/templates/compiled-runner-template.js` —
a **reference driver** it scaffolds NEW compiled-runner workflows from. That is a **third copy of the
same driver body** alongside `ds-run-template.js` and `dev-run-template.js`. The "one source of truth"
goal is incomplete until it converges too.

**Decision (agreed with wc-creator-review + ds-refactor): `run-core.js` is the ONE canonical driver;
the birther converges to it, never keeps a parallel copy.** Concretely, after `run-core.js` lands:
- the **driver body** in `compiled-runner-template.js` is **deleted/superseded** — it does not carry its
  own copy of the topo/level/`runTask`/`returnReason` logic;
- what the birther retains is the **per-domain scaffolding**: the `<domain>-task.js` **fragment skeleton**
  (the 3 functions `gateProbe`/`implementerPrompt`/`recheckTrigger`) + a `<domain>_compile.py` skeleton
  that **splices `run-core.js` + the fragment** (the §2 splice contract). So a newly-birthed workflow
  points at the shared `run-core.js`, identical to ds/dev.
- wc-audit's P22–P26 checks then assert "splices run-core.js" rather than "matches the template body."

**Sequencing:** this is an **immediate follow-up** after `run-core.js` lands on origin, **co-owned with
wc-creator-review**, who is (correctly) holding all birther-template-body hardening until then to avoid
fighting the convergence. Their convergence-safe wc-creator work now (executionClass DATA-variant
detector fix; new audit checks for S5 join-trust-class, D1 floor/assist, emitter-canonical,
phantom-canonical; doctrine prose) does not touch the driver body and can ship independently. **Net:
pass #9 collapses the ds+dev driver copies into `run-core.js`; the birther copy converges as the
fast-follow — completing the "one driver" story across all generators.**

---

## 6. Migration plan (incremental, tested)

1. **Extract `run-core.js` + `ds-task.js`** from `ds-run-template.js`; teach `ds_compile.py` the splice
   (read 2 files, `__TASK_BODIES__`, exactly-once assertion over spliced text, `node --check`); add the
   compiler-side `intraLevel`/level-mode derivation. **Gate:** recompile a known ds PLAN; the emitted
   `run.js` is semantically equivalent to the pre-extraction one (only the canonical
   `returnReason`/`scope` additions differ, applied identically to the baseline for the diff).
2. **Extract `dev-task.js`**; teach `dev_compile.py` the same splice; `recheckTrigger` carries the
   fullsuite overlap derivation. **Gate:** re-run the hylo-tauri A/B slice incl. the hybrid fullsuite leg.
3. **Land `returnReason` + `yield-for-recheck`** in `run-core.js` AND migrate both skill switches in the
   **same commit** (incl. `decision`→`declared`). **Gate:** declared-pause + R4 + (dev) fullsuite each
   round-trip on resume.
4. **Add `scope`** to ds/dev gateProbe bodies (cheap; declare not-checked coverage). **Gate:** schema
   validates; `pass`/`artifactsPresent` orthogonality unchanged.
5. **(Conditional) dev emitter-canonical** per §5, only if dev-refactor confirms a gap.
6. **Re-run ALL consumers' acceptance** before cutover:
   - ds: recompile + run a reference study; gate green.
   - dev: hylo-tauri A/B parity green.
   - writing: section-index blind-oracle diff = 0 (tender_offers), gate-probe 23/23, engine-discover
     13/13 — proves the shared D1 contract + section-index schema didn't move.
   - workshop (if it adopts the contracts this pass): its outline-guard + floor-probe tests green.
7. **USER sign-off** → cutover commit → version bump → ship.

**Files deleted at cutover:** `ds-run-template.js`, `dev-run-template.js` (replaced by `run-core.js` +
`<domain>-task.js`) once their compilers learn the splice and parity passes.

---

## 7. Discipline note (what I will NOT do)

Extraction of proven code, not a redesign. I **stop and flag** rather than invent any abstraction the
three instances don't share. The only *new* fields are seam-list-mandated (`scope`) or seam-list-
specified cleanups (`returnReason` enum / `yield-for-recheck` own channel). The fragment shrank to 3
functions precisely because `classifyFailure`/`payloadExtras`/`GATE_SCHEMA` are NOT domain seams —
they're core or data. I will not extract the shared **Python S1 parser** in this pass unless the user
scopes it in (it's a *separate* extraction; writing + workshop are its consumers — see §8.4).

---

## 8. Open questions for USER sign-off

1. **Interface (§3).** Sign off on: `run-core.js` + 3-function `<domain>-task.js`, compile-time splice,
   the orthogonal `{pass, artifactsPresent, evidence, scope}` contract, the compiler-derived
   `intraLevel`, and the `returnReason` enum replacing `{paused, pauseKind, done}`.
2. **`TRANSFORM_SCHEMA` unification.** I propose ONE core `TRANSFORM_SCHEMA` = shared required base
   `{task, status, filesTouched, deviations, summary}` + domain fields (`outputsProduced` /
   `testWritten, verifyPassed, verifyOutput`) as **optional** properties, required-ness enforced by the
   `implementerPrompt` text. Keeps the fragment to 3 functions (no schema const in it). Confirm vs.
   putting `TRANSFORM_SCHEMA` in the fragment.
3. **Emitter-canonical scope (§5).** Agree it reduces to "verify dev; do nothing for ds" (ds is already
   canonical and intentionally tolerant)?
4. **Shared Python S1 parser — in or out of this pass?** workshop-refactor (4th instance, a flat
   fan-out like writing) wants S1 (deterministic table parser + column-map) + S4 + D1 **without** the S2
   topo driver. They're already separable (Python parser vs JS driver, S7). Question: do I *also*
   extract a shared Python parser-core in this pass (so workshop/writing import it), or keep S1
   per-domain for now and only land the **D1/S4 contracts** as the shared reference? I lean **keep S1
   per-domain this pass** (run-core.js is the scoped deliverable) and land the D1 contract + `scope` as
   the authoritative cross-instance reference, with the Python S1 extraction as an immediate follow-up
   pass owned jointly with workshop/writing. Confirm.
5. **Cutover granularity.** One reviewable PR with commits ordered as §6, or stage core+ds / dev /
   emitter separately?
