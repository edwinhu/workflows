# Ultracode-Workflow Migration Playbook

> **For Claude:** Load this during shared-v1 native planning when deciding whether a closed fan-out belongs in a dynamic Workflow, or from `/workflow-creator-improve` when migrating an existing fan-out. Two kinds qualify: **read-only review/diagnosis** and **write/transform/generate** over an already-decided item set. The conversational skill retains clarification, plan approval, independent verification, and human review; the Workflow owns only the bounded fan-out and returns results. Grounded in a shipped migration (teaching plugin: `lecture-verify` + siblings).

A **dynamic Workflow** is a JS script that orchestrates subagents at scale: it holds the bounded loop, fan-out, and intermediate results in script variables, computes gates in code, runs in the background, and is resumable. Workflows may review or mutate; mutation requires approved task-local authority and filesystem isolation where parallel writes could collide. It is not the outer lifecycle. The shared-v1 skill remains the conversational shell and calls a Workflow only for the closed fan-out stage.

This connects directly to the **Iron Law of Flat Dispatch**: "an agent that spawns other agents is a dispatcher — and dispatchers fail." An ultracode workflow is the structural answer — it is a *script*, not a middle dispatcher agent, so reviewer results land in variables and can never be lost to a sub-sub-agent.

---

## 0. Two execution shapes — COMPILE vs INTERPRET (read FIRST)

> 📊 For a visual, code-grounded walkthrough of how the compiled-runner machinery actually runs (the splice, the driver loop, `gateProbe`, return-reasons, pause/resume — with mermaid diagrams), see **`docs/compiled-runner-architecture.md`**.

There are **two** kinds of ultracode workflow, and picking the wrong one is the most expensive mistake this playbook can cause. Decide this before anything else:

```
Does the workflow execute a DAG of MECHANICAL work between human gates
(an implement/transform/generate phase driven by a structured PLAN TABLE)?
        │                                         │
       YES                                        NO
        │                                         │
  COMPILED RUNNER                          FAN-OUT / CONVERSATIONAL
  spec → plan → deterministic compile      §1-§6 below (review or
  → run.js (§A) — NOT an LLM discovery     transform fan-out over a
  agent, NOT a per-phase interpret loop    known list; no plan DAG)
```

**The compiled-runner shape is the DEFAULT for plan-table workflows (dev, ds, and the like).** It is the pattern the ds + dev refactors proved (PR#7/PR#8), replacing the **generic interpreter** — an in-workflow LLM "discovery" agent that re-parses the plan every invocation → per-level fan-out → a heavyweight re-analysis verifier. That interpreter is a **retired anti-pattern**, not a starting point. wc-audit flags it as `executionClass=generic-interpreter` → **critical**.

### Why the interpreter is wrong (not just slow)

> **Iron Law — NO LLM STEP BETWEEN A STRUCTURED PRODUCER AND A STRICT CHECKER.** An LLM "discovery" agent sitting between a structured producer (the plan emitter) and a strict checker (the executable-guard) **silently tolerates format drift the guard rejects** — it runs plans the guard would reject on every row, masking a spec-drift bug while looking like it works. It also adds a re-analysis verifier that, in both ds and dev, *caught zero substantive bugs*. Delete both. If the input is a structured table, scaffold a **deterministic parser**, not an agent that re-reads it.

### What a COMPILED RUNNER emits by default (§A — the new canonical skeleton)

> **Canonical seam list (source of truth): `docs/common-infra-candidates.md`** — shared core **S1-S7**, injected seams **D1-D4**, the **6 doctrine invariants**, and the **return-reason taxonomy**. The list below is the wc-creator emit checklist; that doc holds the full rationale + confidence tags.

0. **A born-canonical plan EMITTER** (doctrine #6 — **the biggest fix, do NOT skip**). The plan-producing phase emits the EXACT canonical table format, so plans are *born canonical*. Emitting only a tolerant parser + guard (#1/#3) **relocates** the LLM's silent tolerance into regex — the same `2026-06-26_llm-discovery-masked-spec-drift` anti-pattern — instead of eliminating it. The full triple is **emitter (canonical) + guard (STRICT) + parser (back-compat shim)**. (ds + dev both left this open; writing closed it first — PR#18, parity passed.)
1. **`scripts/<domain>/<domain>_plan_table.py`** (S1) — a deterministic plan-table parser (tolerant of real headers like `Failing Test (write FIRST)`; cycle/dangling/empty-row checks; lifts prose sections). **The single source of truth.** Once the emitter is canonical, this tolerance is a back-compat **shim**, not the primary defense.
2. **`scripts/<domain>/<domain>_compile.py`** (S5) — **produce the work-list**, emit **CODE** (`run.js` from a template) **or** **DATA** (a work-list a generic fan-out engine consumes, if one exists — writing's case, confirmed live). Deterministic, no LLM; asserts each template hole is filled exactly once. Don't hardcode codegen.
3. **The shared driver is `workflows/templates/run-core.js`** (S2/S3/S4/S7) — ONE copy (pass #9), carrying the topo/level/`runTask`/return-reason driver + helpers + the unified `TRANSFORM_SCHEMA` + the **six doctrine invariants baked in** (authors must stop rediscovering them). **You do NOT copy or re-emit the driver** — the compiler **splices** `run-core.js` with a per-domain **FRAGMENT** (`workflows/templates/<domain>-task.js` — copy `compiled-runner-template.js`) that defines ONLY the injected interfaces:
   - **(i) payload > pass/fail** · **(ii) mandatory R4** · **(iii) probe corroborates ARTIFACTS-EXIST independently of pass** (`pass` ⊥ `artifactsPresent`, run-core ANDs them) · **(iv) adversarial layer OUTSIDE `run.js`** (PRIMARY for a judgment gate) — all live in `run-core.js`.
   - The fragment defines the **four INJECTED seams D1-D4**: `gateProbe(t)` → `{pass, artifactsPresent, evidence, scope}`, `implementerPrompt(t)`, columns (D3, via the parser column-map), tier (D4, in the compiler). **Intra-level parallel-vs-sequential is NOT a seam** — the compiler **DERIVES** `LEVEL_MODES` (parallel IFF a level's declared outputs are statically known + pairwise-disjoint + isolation-safe; ds's parquets qualify, dev's shared tree never does → sequential by construction). Kills the earlier `D5` proposal; makes shared-tree corruption impossible by construction.
   - **Splice contract** (dev-supplied, in `run-core.js` + `<domain>_compile.py`): the fragment is a FRAGMENT not a module (no import/export, function decls only, runs in run-core's lexical scope); splice it into `__TASK_BODIES__` FIRST, then assert every data hole appears **exactly once** over the spliced text, then `node --check` the emitted `run.js`.
4. **`hooks/<domain>-plan-executable-guard.py`** (S6) — `validate_plan()` imports parser #1 and asserts **STRUCTURE only** (cycles / missing cells / dangling deps), NEVER format. It can be strict because the emitter is canonical. ("compiles ⇔ passes gate" by construction.)
5. **A SLIM skill** — `COMPILE → run/pause` loop driven by a flowchart-as-spec, NOT a per-level dispatch loop. It **branches on the runner's RETURN-REASON**: `done` · `hard-fail` · `pause-human` (declared ⏸ or dynamic R4) · `yield-for-recheck` (an AUTOMATED cross-cutting gate — dev's full-suite, ds's validate-coverage; NO human). Never model a `yield-for-recheck` as a human pause.
6. **Tests** — a parser golden against a **REAL spec** (not the template — the template can't reveal the drift the LLM was masking) + a driver test with mocked primitives covering topo / gate-first skip / declared+dynamic pause / resume-via-`clearedPauses`+decision-injection / R4-block-carries-deviations / artifact-missing-must-not-pass / hard-fail→`tasksThatFailed`.

**Reference implementations already in this repo** — copy from them, do not reinvent:
- `workflows/templates/run-core.js` (the ONE shared driver — never copied, always spliced)
- `workflows/templates/ds-task.js`, `workflows/templates/dev-task.js` (live per-domain FRAGMENTS)
- `workflows/templates/compiled-runner-template.js` (the annotated GENERIC fragment skeleton to copy → `<domain>-task.js`)
- `scripts/ds/ds_plan_table.py` + `scripts/ds/ds_compile.py` (the splice compiler), `scripts/dev/dev_plan_table.py` + `scripts/dev/dev_compile.py`
- `docs/DESIGN-ds-spec-plan-compile.md`, `docs/DESIGN-dev-spec-plan-compile.md` (the design rationale + the explicit per-domain decision list)
- `docs/ds-generalization-assessment.md` (gateProbe as a domain fn; semantic gates raise the stakes on payload>pass/fail)

**`gateProbe` is THE per-domain fork.** Treat it as a domain-provided function returning `{pass, outputsPresent, evidence, scope}` — and **`pass` is ALWAYS deterministic** (exit code or mechanical floor, never a returned judgment, so nothing in the runner can be gamed). The fork is *sufficiency*: an exit-code gate is sufficient (the gate IS the probe); a semantic domain's probe is a **necessary-not-sufficient floor**, and the sufficient authority is the adversarial review robust and OUTSIDE `run.js`. `scope` (`checked`/`not-checked`) discloses the floor's blind spot — a clean `pass` must not over-claim coverage it doesn't have (doctrine #3); keep `evidence` numbered/specific and stating its scope.

**Do NOT extract a shared `run-core` until a 2nd domain runs on the template** — extracting from one domain bakes in its isms. **Do NOT retire the old engine until parity is proven on a real spec.**

Everything in §1-§6 below is the **FAN-OUT / conversational** path (the "NO" branch) — review or transform fan-out over a known list with no plan-table DAG. If you are building a compiled runner, use §A above and the reference impls; §1-§6 still apply to any *separate* fan-out review/transform phase the runner's skill wraps (e.g. an adversarial coverage pass).

### §A.1 — Deepenings from the DATA-variant ports (writing / workshop / teaching)

The first three compiled runners (ds/dev) emit **CODE** (`run.js`). Writing, workshop, and teaching proved the **DATA variant** — the compiler emits a work-list/index a *generic* fan-out engine consumes via `args`, with **no `run.js` by design**. These are the lessons that variant + its semantic gates added (all in `docs/common-infra-candidates.md`); scaffold/score them:

1. **Compile = CODE or DATA — don't key anything on `run.js`.** `executionClass=compiled-runner` is defined by "a deterministic compile/parser replaced the LLM Discover AND the guard imports it" — NOT by a `run.js` file. Absent `run.js` is the data-variant emit form, never a gap (wc-audit P22).
2. **JOIN trust-class (the predictive test).** A work-list row's downstream join (work-item ↔ produced artifact) is **mechanical** (a deterministic key) only when the work-list enumerates from a **single source**. **If it enumerates from >1 source** (generate←spec AND verify←built-artifact) **the join is semantic** — an LLM does it OUTSIDE the parser. The parser owns **enumeration, never a drifting-identifier join**. **Do NOT feed the deterministic artifact as a candidate MENU into the join-agent** — post-filter in JS *outside* the agent. **Menu vs assist (they look alike — both hand a deterministic list to an outside LLM; the line is per-item-judgment vs closed-set-matching):** an **assist** (§A.1.6) hands candidates for **per-item adjudication** (each judged independently — good); a **join-MENU** constrains a **correspondence to a closed set** ("match X to one of these") → risks **force-matching** (the agent always picks one, masking a dropped/−5-slides item). The menu bias is **workshop-measured**: appendix over-match n=3 [25,20,38] vs truth [21,21,21]. Resolution: a **born-canonical byte-stable join-key anchor** (doctrine #6 applied to the join key) converts semantic→mechanical for net-new artifacts (tolerate legacy). (wc-audit P27.)
3. **Emitter-canonical has two valid shapes — pick by producer** (doctrine #6): a **machine producer** *eliminates* tolerance (writing's born-canonical OUTLINE → a **strict** guard); a **hand-editable producer** keeps a *canonical emitter + intentional back-compat tolerance* (ds), whose guard correctly stays **structure-only + tolerant** (do NOT expect it to go strict). **Trap (both shapes):** golden-test the guard against a **REAL pre-canonical artifact**, not the template — the template is already canonical and can't reveal the drift. (wc-audit P28.)
4. **Phantom-canonical — run the guard against the REAL repo artifacts.** A guard can encode a canonical format the real authoring never used, false-denying shipped specs. The single highest-value check: *does existing shipped data PASS its own guard?* (wc-audit P29 — a default.)
5. **Gate only what you compile** — every declared first-class output's compile/validation is gated, not just the primary (workshop once shipped malformed notes). (wc-audit P30.)
6. **Floor vs ASSIST (D1).** Deterministic probe output has two roles: a gate-bearing **floor** (→`pass`) and a verdict-feeding **assist** (a candidate-narrowing list in `evidence`+`scope.notChecked` that feeds the OUTSIDE authority for **per-item adjudication** but does NOT gate). Mistaking an assist for a floor and failing the gate on candidates meant for review = the **inverted-G2 defect** (a *false-negative gate* — the inverse of the funnel-clobber false-positive). *(An assist's per-item adjudication is the legit case; it is NOT a join-menu's closed-set correspondence — §A.1.2.)*
7. **Variance for judgment seams.** A judgment-flavored gate/parity needs **n≥3** (single-sample shipped a false PASS). For a boundary-noisy semantic **binary** gate that can flip UNSAFE, re-adjudicate the same candidate list K times and **fail if any run flags** (cost short-circuits: 0 candidates→pass; first-run fail→fail; only first-run-pass-with-candidates re-votes).
8. **Scaffolding rules every birthed workflow inherits:** set `applies-to` on each constraint (`.md` frontmatter **and** the `.py`'s `APPLIES_TO`) — `check-all.py` honors it and otherwise runs every workflow's constraints on every project; keep `ACTIVE_WORKFLOW.md` at **PROJECT-ROOT/`.planning`** (check-all walks up to it). Each authoring-lint must assert a **live mechanism**, not a defunct inline-string ref. A gate's `pass` derives from **ERROR-severity only** (warnings inform, never gate). Checks over **rendered output** operate on **logical units** (collapse consecutive-identical physical repeats — e.g. `#pause` animation sub-pages).

---

## 1. Decision rubric — MIGRATE vs LEAVE

**Migrate a phase when the SHAPE qualifies AND it gets a meaningful win from at least ONE value driver. The dividing line is `deterministic + parallelizable over a list` (→ workflow, read OR write) vs `judgment + user-input + cross-cutting` (→ skill) — NOT `read-only vs writes`.**

| Test | Migrate | Leave conversational |
|------|---------|----------------------|
| Shape (required) | Fan-out: "one agent per X" over a known list (section, lecture, question, source, footnote, **file, call-site**), whose results the skill consumes OR whose per-item **mutations are independent** | Single pass / single agent, or a few dependent steps |
| Worker mode | **Read-only reviewer** (verify/audit/diagnose) **OR write/transform agent** (migration, codemod, spec-driven generation). Write agents pass `isolation:'worktree'` so parallel mutations don't collide. | n/a — mode doesn't decide migrate-vs-leave |
| Output | A computed gate / structured findings (review) **OR** transformed/generated artifacts + a verify pass (write) | Prose judgment with no structure, a *creative* artifact, a routing decision |

**Value drivers — a qualifying fan-out needs a real win from AT LEAST ONE:**
1. **Parallelism** — many items processed concurrently (wall-clock).
2. **Context isolation** — the fan-out's transcripts would otherwise blow the main conversation's context (e.g. a 40-section paper, a 100-item chapter). *This alone justifies migration even with no numeric gate.*
3. **Deterministic gate** — eliminates honor-system score inflation. **Strongest review signal**, but NOT required.
4. **Independent per-item mutation at scale** — N files/items each transformed in isolation (worktree), then verified. The docs' flagship case: a **500-file migration**, a **codemod**, **"make the change."** This is *write* fan-out, not review — do not overlook it.

**Strong "migrate" smell (driver 3):** the phase tells the model to **self-report a score and then "recompute it yourself"** / "verify the arithmetic." A JS gate eliminates it — the reviewer returns *raw counts*, the script computes the score.

**The generation/drafting line — SPLIT it, do not blanket-leave:**
- **Mechanical / spec-driven generation or transformation over a known list → MIGRATE** (write workflow, worktree). The "what each item should contain" is already pinned (an inventory, an outline, a transform rule), so per-item work is deterministic. Examples: per-lecture slide/notes creation from a 15–20-item inventory, per-section assembly from an outline, codemods, file migrations, regenerating N artifacts from a spec.
- **Creative / judgment generation → LEAVE.** Brainstorming a thesis, choosing an argument, drafting novel prose where voice/judgment *is* the work, with no fixed per-item spec. Conversational.

**A mid-run user *strategy* choice is NOT a disqualifier.** "Review sequentially or in parallel?" stays in the skill (it decides, then invokes the always-parallel workflow). Only a user *approval/judgment* gate on the phase's *content* keeps it conversational.

**Anti-patterns — STOP if you catch yourself:**
1. Migrating a "fan-out" that is actually a *single* agent (no parallelism/gate win).
2. Deciding migrate-vs-leave from a one-line summary — **read the actual phase file** (a phase summarized "single coverage agent" actually fanned out one auditor *per lecture* — nearly skipped).
3. **Assuming workflows are read-only.** They are NOT. The *strongest* candidates are often write/transform fan-outs (migrations, codemods, per-item spec-driven generation) — the read-only lens wrongly dumps these into "leave." If a phase fans out per-item *creation/transformation* from a fixed spec, that's a prime workflow, not a skill-only phase.

---

## 2. The hybrid split (non-negotiable)

| The WORKFLOW owns | The SKILL keeps |
|-------------------|-----------------|
| Deterministic fan-out over a list — read-only review OR write/transform (worktree-isolated) | **Creative/judgment** drafting, brainstorming, argument choice |
| Result collection / per-item mutation in script variables or worktrees | The `/goal`-driven fix loop |
| The computed gate (review) or the verify pass (transform), in code | R4 / user escalation, approval gates, user interviews |
| Returning structured findings the skill renders | Cross-cutting synthesis needing whole-context judgment |

A workflow **cannot host `/goal`** (no mid-run user input; the evaluator lives in the session), and never does *creative* drafting. Two workflow shapes:
- **Review workflow** — fan out read-only reviewers → computed gate / structured findings. Name `*-verify` / `*-diagnose` / `*-audit`.
- **Transform workflow** — fan out write-agents (one per item, `isolation:'worktree'`) → **discover → transform → verify** (a read-only verify stage confirms each mutation). Name `*-migrate` / `*-transform` / `*-generate`. The skill keeps only the creative/judgment "what" (the inventory/outline/spec) and the approval.

Either shape: the skill wraps it — run workflow → read gate/verify → (if fail) `/goal` fix loop → re-run selectively → repeat.

---

## 3. Script conventions (copy from the canonical skeleton below)

1. **`export const meta`** — pure literal (no variables/calls): `name`, `description`, `whenToUse`, `phases[]`.
2. **Args normalization** — the harness may deliver `args` as a JSON *string*:
   ```js
   let cfg = args
   if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
   cfg = cfg || {}
   const PROJECT = cfg.projectDir
   if (!PROJECT) throw new Error(`<name> requires args.projectDir. Got type "${typeof args}": ${JSON.stringify(args)?.slice(0,200)}`)
   ```
3. **Selective re-run** — accept `cfg.onlyChecks` (array of `"ID:check"`) + `cfg.priorReviews` (array of prior REVIEW objects). On a selective run, re-run only flagged pairs live; carry the rest forward from priorReviews so the gate still sees every check.
4. **Discovery agent** (`model:'sonnet'`) — resolves check/agent files and **enumerates the items** to review. Never hardcode a count. **Scope limit (Iron Law):** a discovery agent is for enumerating a *fuzzy* work-list (sections of a paper, lectures, sources) — NOT for re-parsing a *structured plan table that already has a strict checker*. If the items come from a plan-table DAG, that is the COMPILED-RUNNER path (§0/§A): use a deterministic parser shared with the guard, never an LLM that re-reads the table (it absorbs spec-drift invisibly).
5. **Workers** — `model:'sonnet'`, schema-validated structured output. Two kinds:
   - **Read-only reviewer** (review workflow): prompt opens *"You are a READ-ONLY reviewer. Do NOT create, edit, or overwrite any files."*
   - **Write/transform agent** (transform workflow): edits/creates files per a fixed spec; pass `isolation:'worktree'` on the `agent()` call so parallel mutations don't collide, and return a structured summary of what it changed (files touched, status) for the verify stage. NEVER give write agents creative latitude — the "what" comes from the discovered spec, not the agent's judgment.
   Optional `cfg.use*Agents`-style flag routes to a real `agentType`.
6. **Fan-out via `parallel()`** (barrier — the gate needs all results); flatten `(item × check)` into a task list.
7. **Gate in pure JS** — the script computes every score/threshold from the **raw counts** the reviewers return. Reviewers MUST return counts, not scores. Reliability flag: a check is unreliable only if `itemsChecked === 0` (NEVER a findings/items ratio — a clean check has few findings and would false-positive). *(Divergence note: the shipped `lecture-verify.js` schema still carries a per-check `score` field for display, but the gate recomputes the composite from counts regardless. If you copy that example, drop or ignore the reviewer-supplied score — never let it feed the gate. This skeleton's counts-only contract is the stricter, preferred form.)*
8. **Return shape:** `{ overallPass, scoreTable (markdown w/ Gate column), findings (non-pass, severity-ordered), reviews (raw, for priorReviews), reviewersThatFlagged ("ID:check" pairs, for onlyChecks) }`.
9. **Mechanical checks that already exist** (shell scripts, linters) run inside a reviewer/discovery agent's Bash — do NOT reimplement them in the script.
10. `node --check <script>` MUST pass.

### Canonical annotated skeleton

```js
export const meta = {
  name: 'X-verify',
  description: 'Review fan-out + scored gate. Read-only; does NOT fix.',
  whenToUse: 'Run during/after <phase>. The <skill> drives the /goal fix loop and re-invokes this to re-verify.',
  phases: [{ title: 'Discover' }, { title: 'Review' }, { title: 'Gate' }],
}

let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`X-verify requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0,200)}`)
const SCOPE = Array.isArray(cfg.items) ? cfg.items.map(String) : null
const ONLY  = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(r => [`${r.item}:${r.check}`, r]))

const DISCOVERY_SCHEMA = { /* enumerate items + resolve file paths */ }
const REVIEW_SCHEMA   = { /* REQUIRED fields: item, check, itemsChecked, findings[], reportMarkdown + RAW COUNT fields — NOT scores.
                             item/check MUST echo the dispatched values so PRIOR (line above) and the gate can key on `${r.item}:${r.check}`. */ }

phase('Discover')
const disc = await agent(`Enumerate items in ${PROJECT}; resolve check files. Return DISCOVERY_SCHEMA. Absolute paths.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' })
let items = disc.items
if (SCOPE) items = items.filter(i => SCOPE.includes(String(i.id)))
if (!items.length) throw new Error('No items in scope')

phase('Review')
const CHECKS = [ /* {key, agentType, ...} per dimension */ ]
const tasks = []; const carried = []; let reran = 0, carriedCount = 0
for (const it of items) for (const c of CHECKS) {
  const pair = `${it.id}:${c.key}`
  if (ONLY && !ONLY.has(pair)) { if (PRIOR.has(pair)) { carried.push(PRIOR.get(pair)); carriedCount++ } continue }
  reran++
  tasks.push(() => agent(
    `You are a READ-ONLY reviewer. Do NOT create, edit, or overwrite any files.\n`
    + `Set item="${it.id}" and check="${c.key}" verbatim in your returned record (the gate keys on them).\n`
    + `Return RAW COUNTS per REVIEW_SCHEMA (the script computes scores). itemsChecked = items verified (0 ⇒ unreliable).`,
    { label: pair, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet', agentType: c.agentType }))
}
const reviews = [...(await parallel(tasks)).filter(Boolean), ...carried]
if (ONLY) log(`Selective re-run: ${reran} live, ${carriedCount} carried`)

phase('Gate')   // pure JS — compute scores from counts; NEVER trust a score the agent reports
const rows = [], findings = []
for (const r of reviews) {
  const score = /* compute from r's raw counts */ 0
  const unreliable = !(r.itemsChecked > 0)
  const pass = /* binary gates */ true && score >= 9.5 && !unreliable
  rows.push({ item: r.item, check: r.check, score, pass, unreliable })
  for (const f of (r.findings || [])) if (f.status !== 'MATCH') findings.push({ item: r.item, check: r.check, ...f })
}
findings.sort(/* severity, then check */)
const overallPass = rows.length > 0 && rows.every(r => r.pass)
const scoreTable = /* markdown table with a Gate ✅/❌ column */ ''
log(overallPass ? '✅ gate PASSED' : `❌ gate FAILED — ${findings.length} finding(s)`)
return {
  overallPass, scoreTable, findings, reviews,
  reviewersThatFlagged: rows.filter(r => !r.pass).map(r => `${r.item}:${r.check}`),
}
```

### Transform-workflow variant (write fan-out)

For a *write* migration (codemod / file migration / spec-driven per-item generation), keep the same skeleton spine but:
- **Discover** enumerates the work-list AND the per-item spec (the call-sites to change + the rule; the lectures + their inventories; the sections + their outlines).
- **Transform stage** dispatches one write-agent per item with `isolation:'worktree'` — the agent edits/creates files per the spec and returns `{item, filesTouched[], status}`. Because each runs in its own worktree, parallel writes don't collide. Worktrees that the runtime sees unchanged are auto-cleaned; changed ones are surfaced for the skill to merge.
- **Verify stage** (read-only, parallel) confirms each transform did what the spec required — this is the gate. A transform without a verify stage is unsafe; the docs' migrate pattern is literally `discover → transform → verify`.
- The gate is "all items transformed AND all verifies pass"; `findings` = items that failed transform/verify; selective re-run keyed by item (re-transform only the failures).
- Name it `*-migrate` / `*-transform` / `*-generate`. The skill keeps the creative "what" (writing the spec/inventory) and final approval; the workflow owns the mechanical per-item execution.

---

## 4. Packaging & invocation

- The script lives in the plugin's **`workflows/` asset dir** (e.g. `workflows/X-verify.js`). It is NOT a distributable plugin component and NOT a `/command`; it ships in the plugin cache like any other file.
- **Do NOT put it in dotfiles or `~/.claude/workflows/`** — that decouples it from the plugin version it depends on.
- The skill invokes it by resolving the cached path (same glob convention the plugin already uses) and calling the `Workflow` tool with `scriptPath`:
  ```bash
  WF=$(command ls -d ~/.claude/plugins/cache/<owner>/<plugin>/*/workflows/X-verify.js 2>/dev/null | sort -V | tail -1)
  ```
  ```
  Workflow({ scriptPath: "<WF>", args: { projectDir: "<abs>", items: [...], useTeachingAgents: true } })
  ```
- **Local-plugin edge case:** when the plugin runs from its source dir (not installed to the cache), the `~/.claude/plugins/cache/...` glob resolves empty and `WF` is blank → the `Workflow` call fails. Guard it: if the glob is empty, fall back to the in-repo path (`<plugin-root>/workflows/X-verify.js`) or instruct the user to install/refresh the plugin. The `<owner>/<plugin>` slug is the plugin's marketplace identifier (e.g. `edwinhu-plugins/workflows`), not its display name.
- Ships via the normal version-bump procedure (no nix rebuild). New workflow + skill wiring = minor bump.

---

## 5. Wiring the skill

In the target phase/SKILL file, **replace** (a) the section that hand-dispatches the parallel reviewers and (b) the section that computes/states the gate, with:
1. **"Run the X-verify workflow"** — resolve the cached path + `Workflow({scriptPath, args})`.
2. **"Read the gate"** — print `result.scoreTable`; the gate is `result.overallPass`, computed in JS — *do not recompute or rationalize it*.
3. **Rewrite the `/goal` fix loop** so each iteration calls the workflow: full pass first, then on re-runs pass `onlyChecks: <prev result.reviewersThatFlagged>` + `priorReviews: <prev result.reviews>`.

**Preserve verbatim:** drafting/creation steps, Iron Laws, fact-row sections and red flags (or legacy rationalization tables), deviation rules, R4 escalation, and the `/goal` primitive. Only the reviewer dispatch + gate computation move into the workflow. **If a self-report-then-recompute gate step existed, DELETE it** — note in the rewrite that the JS now owns the arithmetic. If a parent SKILL.md describes the phase as "spawn N agents," update that prose too (and reframe any Flat-Dispatch Iron Law: a workflow is a script, not a dispatcher agent).

---

## 6. Migration facts

- Workflow self-report ≠ ground truth: a script once wrote to `workflows/workflows/` because a spec carried a stray prefix — and its own verifier passed the *doubled* path. "Logged 4/4 passed" is an unverified claim; verify artifacts exist at the **expected** path and `node --check` them yourself.
- Audit summaries under-describe fan-out — read the actual phase file and count the agents before deciding migrate/leave.
- Self-reported composite scores inflate — that is the smell that justified migrating in the first place. The reviewer returns counts; the JS computes the score. Trusting the composite reintroduces the failure the migration removed.
- Returning only the final verify stage loses the generate stage's wiring guide and artifacts — thread every stage's output through the pipeline return.
- One agent = no fan-out = no win — leave it conversational rather than wrapping it in a workflow.
- "This phase *writes* files, so it must stay in the skill" is FALSE — workflows do write work (500-file migrations, codemods, "make the change"); write agents use `isolation:'worktree'`. Migrate it as a transform workflow if the per-item "what" is spec-driven; only *creative* generation stays.

---

## 7. Migration gate (exit checklist)

Before claiming a migration complete, ALL must hold:
1. `node --check workflows/X.js` exits 0.
2. The script meets every convention in §3 (args-normalize, onlyChecks/priorReviews, read-only reviewers, JS gate from raw counts, `itemsChecked===0` reliability, return shape, no `/goal` inside).
3. **Field-key consistency:** the key the loop builds (`${item.id}:${check.key}`) matches the fields each reviewer returns (`item`, `check`) and the fields PRIOR + the gate read (`r.item`, `r.check`). A mismatch silently breaks `priorReviews` carry-forward on re-run — the reviewer prompt MUST inject the dispatched `item`/`check` into its record.
4. The artifact exists at the **expected** path (not a doubled/typo path) — confirmed by `ls`, not by the build's self-report.
5. The wired skill references the correct script, keeps `/goal`, drafting, and R4, and any self-report-recompute gate step was removed.
6. Decision rubric (§1) was applied from the **actual file**, not a summary.
