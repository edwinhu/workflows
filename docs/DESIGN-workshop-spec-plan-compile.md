# DESIGN: the `spec → plan → compiled run.js` pattern applied to the **workshop** workflow

Status: **DRAFT — assessment first, awaiting USER sign-off before any engine change.**
Companions: `docs/DESIGN-ds-spec-plan-compile.md` (1st instance, exit-code gate, shipped),
`docs/DESIGN-dev-spec-plan-compile.md` (2nd instance, exit-code gate, v5.56.0/PR#8),
`docs/DESIGN-writing-spec-plan-compile.md` (**3rd instance, judgment gate — workshop's TWIN**),
`docs/common-infra-candidates.md` (the canonical seam list; pass #9 extraction in flight).

> The brief asked for an **honest assessment, not code**. Headline finding:
> **workshop is writing's structural twin, and is in fact MORE ready than writing was.** Its execute
> layer (`workshop-generate.js`) is already a flat-parallel fan-out and its verify layer
> (`workshop-verify.js`) is already a substrate-split JS gate with semantic authority outside
> (independently confirmed: a `wc-audit` of the workshop workflow scored **9.64 / PASS, 0 critical**,
> §9). What ports is narrow, the same shape writing took: it is about the **spec** (the slide table),
> the **one shared parser**, and **honest fidelity/scope**, NOT a per-project `run.js`.

---

## 0. TL;DR

ds/dev replaced a **generic interpreter** (an LLM "discovery" agent re-parsing `PLAN.md` once per
dependency level) with a **deterministic compiler + a per-project compiled `run.js`** that topo-sorts
a task DAG and gates each task on a real **exit code**.

**Workshop already did the parts that mattered most.** `workflows/workshop-generate.js` and
`workflows/workshop-verify.js` are *already* ultracode workflows with a `Discover → fan-out → gate`
shape that runs the **whole deck in ONE invocation** with **genuine per-section parallelism**. There
is **no task DAG** — workshop sections are deliberately independent (linear narrative; the only
coupling is shared *read-only* inventory IDs, a shared resource, never producer→consumer; confirmed on
the real 38-slide opv deck). So the three ds/dev wins land as:

| ds/dev win | Workshop status |
|---|---|
| Kill ~N LLM-discovery round-trips → 1 topo-run | **N/A** — already 1 invocation, already flat-parallel; no DAG to topo-sort |
| Kill the per-call LLM discovery re-parse | **The real win — DOUBLED.** `workshop-generate` AND `workshop-verify` EACH carry their own LLM `Discover` re-parsing the same OUTLINE → two drift masks, not one (§3) |
| Cheap honest gate via real exit code | **Workshop is RICHER than writing here** — `typst compile` + `check-all.py` give genuine **exit codes** (a rich-mechanical floor), with a semantic *ceiling* (per-slide convention/notes/fidelity + visual). The substrate-split JS gate already encodes this (§4) |

The honest, high-value port for workshop is **two surgical moves + one emitter move**, not a run.js
rewrite:

1. **Extract ONE shared parser** (`scripts/workshop/workshop_slide_table.py`) out of
   `hooks/workshop-outline-executable-guard.py`'s `find_slide_table`, and point its consumers at it —
   the guard (`validate = parse().violations`), `workshop-generate`'s Discover (**fully** replaced),
   and the **OUTLINE-reading PART** of `workshop-verify`'s Discover (an inventory/section **side-table**
   only — see §3a, the cardinality correction). Output = **DATA** (a slide work-list + a side-table).
   This kills the doubled drift mask and makes "compiles ⇔ passes the gate" a property.
2. **Ground the self-reported fidelity + disclose floor scope.** `workshop-generate`'s
   `fidelityOk = citedInventory ⊆ allowed` trusts the section agent's **self-reported** `citedInventory`
   — grep the fragment `.typ` files for `F/T/R/A` tokens instead (the writing-G1 fix). And give
   `workshop-verify`'s deterministic floor a `scope:{checked, notChecked}` disclosure (doctrine #3
   addendum) so a clean mechanical pass never implies it verified the visual/semantic ceiling.
3. **Born-canonical emitter (same pass).** Phase 2 emits the canonical Slide Spec **table** going
   forward; the shared parser stays **tolerant** of the real **prose** form as a back-compat shim.

**What does NOT change:** gather / structure (outline) stay conversational + human-gated; the
**workshop-verify → workshop-revise `/goal` loop stays OUTSIDE** any runner as the real correctness
authority; the **substrate-split JS gate** (blocking = critical+major, minors advisory) is preserved
byte-for-byte. **We do NOT generate a per-project `.planning/run.js`** (§7 — same divergence writing
recorded; workshop is the *second* "compile = data" instance, validating that branch).

---

## 1. The PARITY REGRESSION constraint (top-level — drives every decision below)

The parity partner (`opv-parity`) stress-tested the real, shipped, last-scored-9.5 deck at
`~/projects/opv` (projectDir holds BOTH `.planning/` and `presentation/`; **`presentation/.planning/`
is STALE/superseded — ignore it**). Findings that shape the design:

- **The real `OUTLINE.md` is free-form PROSE, NOT a table.** It carries the same semantic fields
  (`- Slide: "Takeaway." — bullets → [A2, R1, ...]`, sections via `=`/`==`) but as bullet lines, not
  `|`-table rows. **Zero `|`-tables.**
- **The strict guard `workshop-outline-executable-guard.py` FAILS (exit 1) on it** ("No executable
  Slide Spec table found … prose … which workshop-generate cannot fan out"). Same FAIL on
  `OUTLINE_APPROVED.md`.
- **The OUTLINE is also INCOMPLETE relative to the built deck** (§3a): 21 OUTLINE rows vs **38**
  `#slide[` blocks — the Appendix drifted 3 specced → 19 built (Q&A backups added directly in
  slides.typ, never in OUTLINE).
- **This IS the drift mask, caught live.** The LLM `Discover` in both engines silently tolerates the
  prose form (workshop-verify already degrades: prose/absent OUTLINE → `inventoryRefs` empty → slides
  classified `PARTIAL`). A naïve strict parser would reject **every** real slide — exactly ds's "the
  guard rejected every real muni row" moment.

**Therefore the #1 design rule:** the executable-table contract must **NOT** become a precondition for
**VERIFY** or **REVISE** — only for net-new **GENERATE**. The deterministic parser **replaces** the
LLM Discover where an OUTLINE parses **in either form**; where it is prose/absent, verify degrades
**exactly as today** (`inventoryRefs` empty → `PARTIAL`). **Zero regression on existing decks.** This
is why move (1) ships the parser **tolerant** and the emitter **canonical** in the *same* pass (the
writing resolution: tender_offers used `<Name>.md` not the documented `<Name> (Outline).md`; tolerant
parser + canonical emitter).

**Second preserved invariant (opv-parity):** the **advisory-minor substrate split** in
`workshop-verify.js` is an *encoded judgment* (compile/constraints/widows/overflow/fidelity/notes/visual
crit+major BLOCK; per-slide convention/style minors are ADVISORY, non-blocking — the wc-asymptote
"over-enforcement treadmill" lesson). The compiled parser is **upstream** of the gate; the port must
not flatten this. Gate computation is untouched.

---

## 2. Mapping workshop onto the ds "spec → plan → compiled run.js" model

| ds/dev concept | Workshop analog | Notes |
|---|---|---|
| **SPEC** (`SPEC.md`) | `SOURCES.md` (paper inventory: `F/T/R/A` IDs) | human-gated, look-at-extracted — unchanged |
| **PLAN** (`PLAN.md` Task table) | `OUTLINE.md` **Slide Spec table** (per-slide rows) | **the spec to harden + the parser's input** (§3) |
| **compile** (`ds_plan_table.py` → `run.js` literal) | `workshop_slide_table.py` → a **DATA** artifact (slide work-list + side-table) | **divergence:** workshop emits DATA, not code (§7) — *second* data instance after writing |
| **run.js** (per-project compiled runner) | `workshop-generate.js` / `workshop-verify.js` (**already generic dynamic workflows**) | already exist; feed them compiled DATA instead of an LLM `Discover` |
| **task** | **section** (a `=`/`==` run of slides; slide = sub-row) | no inter-section deps → no DAG, flat-parallel + a final **assembly barrier** (trivial 2-level, expressed directly in JS — not topo) |
| **`implementerPrompt(t)`** | the per-**section** write-agent prompt (workshop-generate) | already exists; unchanged in shape |
| **`gateProbe(t)`** | **two gates** (§4): generate = `{fragmentsWritten, deckCompiles}` (rich-mechanical); verify = substrate-split `{pass, evidence, scope}` | RICH-mechanical floor (real exit codes) + semantic ceiling — a **4th gate-type point** for pass #9 |
| **adversarial layer OUTSIDE run.js** | **workshop-verify + visual-verify + the `/goal` revise loop** | stays outside; the per-slide reviewers are the writing-review L1/L2/L3 analog |
| **two-kinds-of-decision + stale-gate backstop** | **slide-edit vs spec-changing editorial decision** (§5) | structure/proportion reframe = gate-changing → edit OUTLINE + re-index |
| **declared/dynamic PAUSE** | **R4 (structure reorder / proportion change)** — already in workshop Phase 3/4 | unchanged |

**What a "gate" is in workshop.** Two tiers, like writing — but the floor is *thicker*:
- a **rich deterministic floor** (necessary, mostly sufficient at its layer): `typst compile` exit code,
  `check-all.py` exit code + raw FAIL lines, `detect_widows.py` count, overflow page-count delta,
  inventory-fidelity (`[@F/T/R/A]` grep ⊆ allowed — **once move (2) lands**). Genuine exit-code /
  mechanical signals — *richer* than writing's grep-only floor.
- the **semantic ceiling** (sufficient for content quality): per-slide convention/style, notes-coverage
  adequacy, source-fidelity (claim→inventory **judgment**), and **visual-defect** scoring via
  `look_at.py`. **Irreducibly LLM**, lives in `workshop-verify` (the verify engine = OUTSIDE the
  execute runner), trusted only because each finding carries `{severity, file:line, verbatim quote,
  detail}`.

---

## 3. Move 1 — extract the ONE shared parser (the doubled drift-mask kill)

The highest-value work and the doctrine-#5 sleeper, **doubled**: the Slide Spec parser already exists
as `find_slide_table` **inside** `hooks/workshop-outline-executable-guard.py` — but
`workshop-generate.js` *Discover* AND `workshop-verify.js` *Discover* **each re-parse the same OUTLINE
with an independent LLM agent**. Three readers of one spec, only one deterministic; the two LLM readers
can silently disagree with the guard **and with each other**.

**`scripts/workshop/workshop_slide_table.py`** (single source of truth, mirrors
`writing_section_index.py`):
- **parse BOTH forms** (tolerant — the back-compat shim the real opv deck forces):
  - canonical **table** (`| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |`), via
    the existing `find_slide_table` logic lifted verbatim;
  - real **prose** (`### Part N` / `= Section` / `== Subsection` + `- Slide: "Takeaway." — bullets →
    [A2, R1, …]`) — extract Takeaway (quoted), Bullets (after em-dash), Inventory (`→ [...]`), Section
    (nearest `=`/`==`).
- emit per **slide**: `num`, `section` (the `=`+`==` grouping key), `takeaway`, `bullets`,
  `inventory[]`, `visual`, `notes`; and per **section**: ordered slide list + `sectionOrder` (document
  order).
- **prefix-tolerant column lookup** (dev's gotcha: real headers carry parentheticals) and **cell
  tolerance** (ds's gotcha: em-dash / `---` / empty ⇒ `none`).
- **Unicode-safe slugs** (section titles carry em-dashes).
- **byte-identical join key** (writing-refactor's gotcha a): emit each row's key (slide num + title)
  identical to what the parser keys on AND to the slides.typ title it pairs to (the verify side-table
  join) — zero fuzzy matching is the goal.
- **golden-tested against the REAL opv `OUTLINE.md` (prose), NOT `custom-outline.typ`** — *the TRAP*
  (writing-refactor's #1 gotcha): the template is already canonical so it cannot reveal the drift; only
  the real hand-emitted deck does.

### 3a. THE CARDINALITY CORRECTION — parser is the GENERATE enumerator, only a VERIFY side-table

opv-parity's per-section ground truth (OUTLINE rows vs slides.typ `#slide` blocks):

| Section | OUTLINE rows | slides.typ |
|---|---|---|
| Motivation & Background | 3 | 3 |
| Framework / Three-Stage | 7 | 7 |
| Re-evaluating Criticisms | 5 | 6 *(robo-voting split into 2)* |
| Policy Proposals | 3 | 3 |
| Appendix | 3 | **19** *(Q&A backups added in slides.typ, never in OUTLINE)* |
| **TOTAL** | **21** | **38** |

The OUTLINE (21 rows) and slides.typ (38 blocks) are **two different work-lists of different
cardinality**. The two engines consume them differently, so the parser plays **two different roles**:

- **GENERATE** (`workshop-generate`): the parser **IS the enumerator.** Its 21 OUTLINE rows == the
  generate work-list (one fragment-agent per row). The LLM Discover is **fully replaced.** Direct
  parity.
- **VERIFY** (`workshop-verify`): slide enumeration **MUST stay sourced from `slides.typ` (38).** The
  parser supplies the canonical **OUTLINE-side rows** (21: section/takeaway/bullets/inventory); the
  **JOIN** of an OUTLINE row to a built slide stays **semantic** (§3a-join). ~18–19 body slides get
  inventory once joined; the 17 unspecced (appendix) slides get **empty `inventoryRefs` → PARTIAL** =
  the current degraded behavior, **zero regression.**

**HARD push-back baked into the design (opv-parity):** the parser must **NEVER** become the verify
*enumerator* — doing so would under-count this real deck by 17 slides (38→21) and **silently drop the
entire appendix from review.** So `workshop-verify`'s Discover **splits**: (a) *enumerate slides from
`slides.typ`* — **KEEP** (it reads the built deck, the source of truth for what is actually on screen,
incl. the 19 drifted appendix slides); (b) *attach `inventoryRefs` from the OUTLINE rows* — the parser
hands the LLM the **canonical candidate rows**, but the **correspondence stays semantic** (§3a-join).

### 3a-join. THE JOIN IS SEMANTIC, not a string op (opv-parity, measured)

opv-parity measured the OUTLINE-takeaway ↔ `slides.typ`-`===`-title correspondence on the 18 body
slides (em-dash/quote/case normalized): **exact 6/18 (33%) · +prefix 7/18 · +token-overlap≥0.6 13/18
(72%) · MISS 5/18** — five body takeaways are *paraphrased* in the built deck (e.g. outline "The three
stages work together as a governance system." → deck "We decompose the proxy voting decision into a
three-stage framework.", overlap 0.22). **A deterministic title-join caps at ~72% even with generous
fuzzy matching and drops 5 body slides' inventory → those flip to `PARTIAL`.** The current LLM Discover
matches these paraphrases *semantically* and attaches inventory → marks them `COVERED`.

**So a pure-mechanical join is NOT zero-regression — it is a ~5-slide downgrade of the verify coverage
map vs today.** The "degraded = same as no-OUTLINE" claim holds only for the 17 appendix slides; for the
body, a mechanical join actively *loses* attachments the LLM recovers. **A mechanical join is a judgment
masquerading as a string op** — the doctrine-#5 lesson *inverted* (don't put a deterministic checker
where the task is irreducibly semantic).

**This is the SAME "deterministic core + semantic authority outside" shape as the gateProbe trust-class
(D1 / doctrine #4) — it simply recurs at the JOIN instead of the GATE** (ds-refactor / S5 owner,
recorded canonical PR#21–22). A work-list row is therefore either **(a) mechanically-keyed** (ds parquet
/ dev file-path → key-match — and workshop's *born-canonical* `// slide-id:` anchor, going forward) or
**(b) candidate rows for a semantic join the LLM does OUTSIDE the parser** (legacy prose decks). The
shared-Python-S1 parser-core follow-up therefore **must NOT bake a deterministic-key-match join
assumption** into the core — that would be silently wrong for any drifting-identifier domain.

Two generalizations this surfaced (canonical, ds-refactor):
- **Predictive rule:** *a join turns semantic exactly when the work-list enumerates from MORE THAN ONE
  SOURCE.* Workshop is the first multi-source instance (generate ← OUTLINE spec; verify ← built
  `slides.typ`), so its join drifts; ds/dev are single-source (the plan), so their join is mechanical by
  construction. The design test for any new domain is simply **"does it enumerate the work-list from
  more than one source?"** — no need to discover the semantic join the hard way.
- **The (a)/(b) split is not fixed — a born-canonical anchor converts (b)→(a).** The `// slide-id:`
  stamp is **doctrine #6 ("emit the key byte-identical") applied to the JOIN KEY** (the same move
  writing made for plan ids, now for slides). Canonical guidance: *where you want a mechanical join, add
  a born-canonical anchor — do not teach the parser to guess.*

**Contract fix (keeps semantic authority outside `run.js` — the invariant):**
- The parser **deterministically emits the OUTLINE-side table** (21 rows) + the **canonical SOURCES
  inventory** (the full valid-id universe). KEEP — this is the real, drift-killing win.
- ⚠ **CORRECTED by a parity variance study (opv-parity, n=3) — do NOT feed candidates INTO the join.**
  My first cut injected the parser's rows as a candidate MENU into the verify Discover prompt ("match
  each built slide to the BEST candidate"). The n=3 study showed this **contaminates the semantic join**:
  the agent greedily forces **unspecced appendix slides onto the nearest row** → false COVERED (COVERED
  count `[25,20,38]` vs free-read's stable `[21,21,19]`; appendix over-match `[5,0,16]` vs `[0,0,0]` —
  once **all 16** appendix tables forced COVERED). A single sample had masked it (looked like 20/21 PASS).
  **The lesson is the §3a-join lesson one level deeper: feeding the deterministic artifact *into* the
  semantic step biases it — the same "no deterministic thing contaminating the judgment" rule, now at the
  PROMPT.** So:
  - **The JOIN stays a FREE OUTLINE read — byte-identical to the current LLM Discover** (correct,
    unbiased, returns `[]` for appendix slides with no row). The parser does **not** feed the join.
  - **The parser's contribution to verify is a deterministic WHITELIST applied in JS, AFTER Discover,
    OUTSIDE the agent:** drop any `inventoryRef` not in the canonical SOURCES inventory (the
    no-hallucination guard) — it cannot bias the join because the agent never sees it. *(This is the
    achievable determinism win for verify; the big determinism wins are GENERATE (full) + the GUARD.)*
  - **Meta-lesson (record for pass #9):** for a **judgment-flavored** seam, **single-sample parity is
    not sufficient — variance (n≥3) is required.** A lean single sample would have shipped a false PASS.
- **Born-canonical escape hatch (net-new decks only):** the GENERATE emitter stamps a stable
  slide-anchor comment (e.g. `// slide-id: M-3`) into each `#slide[` block that the OUTLINE row shares
  → the join becomes **mechanical by construction** for decks this workflow generates. Legacy prose
  decks (opv) still take the semantic join. This is the join-layer analog of the born-canonical emitter
  (move 3): kill the fuzzy match going forward, tolerate it backward.
- **The join is many-built-to-one-outline, NOT a bijection** (opv-parity: S11/S12 both ⟵ one outline
  row; S13/S14 both ⟵ one row — a deck 1→2 split). Parser candidates are 1 row per outline entry; the
  join must allow **N built slides → 1 outline row.** Do not model it as a bijection.
- **The port is not strictly lossy — the parser FIXES an LLM over-attach** (opv-parity: baseline S21
  "Key findings" over-attaches `R1–R8` (8 IDs); the outline tail is only `→ [R1, R8]`; a deterministic
  parser reading the `→ [...]` tail emits exactly `[R1, R8]`). So the trade is precise: **the parser
  fixes LLM over-attach; the semantic join preserves LLM paraphrase-recall.**

**Golden test (b) — concrete acceptance criterion (opv-parity baseline `discover_baseline_38.json`,
21 COVERED / 17 PARTIAL):** parser-candidates + the semantic join must reproduce **COVERED on all 21
baseline-COVERED slides**, especially the 5 paraphrase / 1→2-split cases the LLM recovers semantically —
**S4, S9, S14, S18, S19.** Any of those landing `PARTIAL` is a measurable regression. *(A pure-mechanical
fuzzy-join scores only **16/21** recall on this deck — the quantified proof that the join must stay
semantic for legacy decks.)*

*(Bonus signal, future enhancement only — NOT this pass: the OUTLINE(21) ↔ slides.typ(38) drift is
itself a coverage finding verify could surface — "deck drifted 17 slides past spec; appendix unspecced."
Record, don't build.)*

### 3b. Guard reconciliation (S6)

`workshop-outline-executable-guard.py` imports the new module and sets
`validate = parse(outline).violations`. ONE format spec; strict-at-emitter / tolerant-at-parser; the
guard asserts only structural validity (every row complete, every inventory ID exists in `SOURCES.md`),
never format. Because the parser is tolerant of prose, **the guard now PASSES on the real opv deck** (it
parses) — which is what removes the parity regression §1 flagged. The guard also fails loudly on a stale
`OUTLINE_APPROVED.md` whose slide/section count disagrees with the live `OUTLINE.md` (the stale-approval
catch, §5).

**Both engines' OUTLINE-reading drops to the shared parser** (the skill runs the parser → passes
`args.slideIndex`; back-compat fallback to the LLM Discover only if the index is absent — writing's
pattern), with verify keeping its independent slides.typ enumeration per §3a.

---

## 4. Move 2 — honest fidelity + scope-disclosure (the two-tier gate, made honest)

Workshop's gate is already two-tier and substrate-split; move (2) closes the two *honesty* gaps:

**4a. Ground self-reported fidelity (writing-G1, workshop form).** In `workshop-generate.js` the gate
computes `fidelityOk = (citedInventory ⊆ allowed)` from the section agent's **self-reported**
`citedInventory` — an LLM assertion presented as a mechanical check. Fix: after the section writes its
fragment, **grep the fragment `.typ` for inventory tokens** (`F\d+|T\d+|R\d+|A\d+`) and compute
`⊆ allowed` from the *file*, not the report. Exactly as compilable as ds deps-resolution; currently
not done.

**4b. Scope-disclosure on the verify floor (doctrine #3 addendum / D1 `scope`).**
`workshop-verify.js`'s mechanical leg returns raw counts but does not say **what it could not check**.
Per the D1 contract the gate result must carry `scope:{checked, notChecked}` so a clean mechanical pass
never implies the visual/semantic ceiling was verified. Workshop's `checked` is genuinely **larger**
than writing's (compile + constraints are real exit codes); `notChecked` = the per-slide semantic
judgments + the visual leg when `look_at.py` is unresolved (already surfaced as "skipped (NOT silently
passed)" — formalize it into `scope.notChecked`).

**Formalize `gateProbe` as the seam (no behavior change to the gate):** name the deterministic floor a
`gateProbe`-shaped `{pass, artifactsPresent, evidence, scope}` (the D1 contract), with the semantic
authority (per-slide reviewers + visual-verify) staying the **primary arbiter OUTSIDE** the execute
runner. There is no LLM judge *inside* the execute runner's probe to game — `workshop-generate`'s gate
is pure mechanical (fragment written ∧ compiles).

**4c. Pre-existing mechanical-floor noise (opv-parity, on the stub fixture) — preserve for parity,
fix SEPARATELY.** The "deterministic floor is clean" assumption has two **pre-existing** holes (in the
*current* `workshop-verify.js`, NOT introduced by the port):
- **`check-all.py` rides cross-domain PHANTOM constraints.** On the fixture: exit=1, 6 FAIL — but only
  **3 are real deck findings** (notes-structure, section-hierarchy, teleprompter-notes); **3 are
  phantoms** (`post-subagent-enforcement`, `topic-change-protocol`, `writing-stop-triggers`) that scan
  `plugin_dir/skills/writing-*/SKILL.md` in the **workflows repo itself** (proven:
  `writing-stop-triggers.py` walks `__file__.parent.parent.parent/'skills'`) — they audit *this repo's
  skill authoring*, not the deck, and fire **identically on every workshop project**. Plus **1 tooling
  ERROR** (`scored-tics-patterns` has no `check` attr). **Consequence: `constraintsPassed` is ~never
  true on any real deck → the substrate gate is effectively PERMANENTLY RED regardless of slide
  quality.** **Empirically confirmed on clean shipped main** (opv-parity, HEAD `4723f48`, not a
  worktree/fixture quirk): all 6 `writing-*` skills × the 3 phantom docs are missing the references
  those constraints require, and `check-all.py` resolves `__file__.parent.parent.parent/skills` = the
  plugin's own skills dir **regardless of the `.` path arg**, so the 3 phantoms + broken module keep
  `exit=1` even on a hypothetically perfect deck (0 real typst findings). The domain filter exists but
  reports "0 skipped" — it fails to scope a typst project down to `typst-*`, which is the precise fix
  locus for D-w-8. This is a *current shipped* bug, so the port must **reproduce it byte-for-byte** and
  the fix is filed separately (D-w-8).
- **Overflow heuristic false-positives.** `overflow = handout_pages − slide_count` over-counts because
  `university-theme` injects a page per `=`/`==`/title divider (fixture: handout 47 pp vs 38 `#slide`
  → naive overflow **9**, true ≈ **0**). Same story: a *current* heuristic, preserved for parity, fixed
  separately.
This **reinforces the move-(2) scope-disclosure**: the floor's `scope.notChecked` must eventually
disclose "check-all includes non-typst/meta constraints; overflow is a divider-naive page-count
heuristic" — but that disclosure is itself a behavior change → D-w-8, not folded into the port.

---

## 5. Pauses & the two-kinds-of-decision

| ds/dev | Workshop | Resume |
|---|---|---|
| **behavior-only** (gate unchanged) | **slide-content edit** (fix a bullet, tighten a takeaway) | re-run that section (`onlyChecks`); no spec edit |
| **gate-changing** (grain/key/schema → edit Verify + recompile) | **spec-changing editorial decision** (reorder sections, change time proportions, re-scope a Part) | edit `OUTLINE.md` + **re-index**; re-approve `OUTLINE_APPROVED.md`; the section re-blocks against the stale outline |
| **dynamic R4 pause** | **R4 structural** (already in workshop Phase 3/4 deviation tables) | **PAUSE**, surface numbered deviations, human decides |

**Stale-gate backstop, workshop form:** a section write-agent handed "the structure changed" must NOT
silently drop or re-scope a slide to make the fidelity/coverage gate pass — it must re-block and state
the OUTLINE must be updated + re-indexed + re-approved. The hardened guard catches a stale
`OUTLINE_APPROVED.md` whose slide/section count disagrees with the live `OUTLINE.md` (writing's
stale-`*_REVIEWED.md` catch, slide-table form). *(A per-domain forcing fixture — a deliberate
proportion-reorder that leaves a stale approval — is the workshop analog of ds's grain-pause; build it
in the test step.)*

---

## 6. What stays OUTSIDE the runner (unchanged)

gather (look-at extraction) · structure/outline (conversational, **user-approved** — the one decision
checkpoint) · **workshop-verify.js's per-slide semantic reviewers + visual-verify** · the
**workshop-verify → workshop-revise `/goal` loop** with substrate-gate exit + max-3-turns +
`SLIDES_REVIEWED.md`/`VALIDATION.md` artifacts. The metadata cross-check (title/authors vs SOURCES.md)
stays in Phase 4.

---

## 7. The "compile = data" divergence (record for shared-core pass #9)

ds/dev compile a **per-project `run.js` literal** because each project has a project-specific task DAG
and project-specific `Verify` commands. **Workshop has neither** — its section structure is uniform and
its runner is *generic*. So workshop's "compile" output is a **data artifact** (a slide work-list +
side-table) the generic runner consumes, **not generated code** — the *same* branch writing took.
**Workshop is the SECOND data instance, validating writing's branch** (ds/dev = code, writing+workshop =
data). And it adds a genuine **4th gate-type point** for the extraction (run-core-extract agreed this is
worth recording):

| Instance | Floor | Ceiling |
|---|---|---|
| ds / dev | exit-code (the gate IS the probe) | — |
| writing | mechanical-floor (grep/bib-resolution, necessary-not-sufficient) | semantic authority OUTSIDE |
| **workshop** | **RICH-mechanical floor (`typst compile` + `check-all.py` REAL exit codes)** | semantic ceiling (per-slide judgment + visual) OUTSIDE |

The D1 `{pass, artifactsPresent, evidence, scope}` contract spans all four cleanly — workshop's
`scope.checked` is just *larger* (more is genuinely exit-code-verified); `scope.notChecked` = the
visual/semantic ceiling. That is the contract proving it covers the whole spectrum — exactly what the
extraction wanted.

**Run-core consumption decision:** workshop **consumes the DATA seams** of the pass-#9 core — **S1**
(deterministic table parser + column-map, shared by compiler AND guard), **S4/S4-art** (payload +
`artifactsPresent`), **D1** (`gateProbe` contract incl. `scope`), **S6** (guard↔parser reconciliation),
and the **doctrine** — but **NOT S2** (the topo run-template DRIVER), because it has no DAG. Same
consumption profile as writing → **no bespoke seams**; workshop injects rather than reinvents.
**Two workshop-specific seam refinements for pass #9 (confirmed with run-core-extract):**
1. S1's "produce the work-list" has **two outputs** here, not one — an *enumeration* (generate ← spec)
   and a *candidate-row set for a SEMANTIC join* (verify ← built artifact, join stays LLM). The
   extracted core should model "compile = produce the work-list(s)" where a domain may bind the
   work-list to a *different* enumeration source per consumer, **and where the cross-artifact
   correspondence may itself be irreducibly semantic** (§3a-join) — the parser owns enumeration, never a
   drifting-identifier join.
2. **Scope of pass #9 vs the follow-up (run-core-extract's call, agreed):** pass #9 extracts
   `run-core.js` (the **JS S2 topo driver**, ds+dev) and lands the **D1 `{pass, artifactsPresent,
   evidence, scope:{checked,notChecked}}` contract** as the cross-instance reference (already live/tested
   in `writing_gate_probe.py`; ds+dev gain `scope` this pass; workshop's widow/overflow regex floor gets
   the same blind-spot disclosure). The **shared-Python S1 parser-core extraction** (so workshop +
   writing import ONE parser-core instead of per-domain copies) is a **separate immediate FOLLOW-UP
   pass, co-owned by run-core-extract + writing-refactor + this workshop port** — deliberately NOT folded
   into pass #9, to keep the proven-3-instance extraction clean. Workshop is documented as the **4th
   instance / contract consumer**, not a pass-#9 input.

*(Do the run-core extraction in pass #9 after writing's A/B parity lands; this pass mirrors writing's
already-built shape and consumes the contracts, not the driver.)*

---

## 8. Decisions for USER sign-off

- **D-w-1 — Scope = the 2 surgical moves + 1 emitter move, NOT a per-project `run.js`.** Extract the
  one shared parser; ground fidelity + scope-disclosure; born-canonical emitter. *(Recommended.)*
  Forcing a ds-style generated `run.js` with a fake DAG is the "don't rewrite where the shape works"
  anti-goal — and the real opv deck proves there's no DAG.
- **D-w-2 — PARITY: the executable table is required ONLY for net-new GENERATE, never for
  VERIFY/REVISE.** The parser is tolerant of the real **prose** form; the guard PASSES on existing
  prose decks; verify/revise degrade exactly as today on prose/absent OUTLINE. **Zero regression on the
  shipped opv deck.** *(Recommended — the parity partner's flagged constraint.)*
- **D-w-3 — ONE shared parser `scripts/workshop/workshop_slide_table.py`**, consumed by the guard
  (`validate = parse().violations`); **the GENERATE Discover is fully replaced** by it (its 21 rows ARE
  the generate work-list); **the VERIFY Discover keeps its own `slides.typ` enumeration** AND keeps the
  **OUTLINE-row↔slide JOIN semantic** — the parser supplies canonical candidate rows, the LLM does the
  fuzzy correspondence (§3a-join: a mechanical join measured ~72% / −5 body slides = a real regression;
  a mechanical join is a judgment masquerading as a string op). Net-new decks get a stamped slide-anchor
  so the join is mechanical-by-construction; legacy prose decks keep the semantic join. Golden-tested
  against the **REAL opv prose OUTLINE**, not the template (THE TRAP), two ways: (a) 21-row generate
  parity; (b) parser-join recall vs the LLM Discover's actual attach-to-38 baseline.
  *(Recommended — kills the doubled drift mask on *what the rows are*, without faking a semantic join.)*
- **D-w-4 — Honest gate: grep-grounded inventory fidelity (replace self-reported `citedInventory`) +
  `scope:{checked,notChecked}` disclosure on the verify floor (D1).** The substrate-split
  (crit+major block, minors advisory) is preserved byte-for-byte. *(Recommended — closes the two
  honesty gaps; no gate-behavior change.)*
- **D-w-5 — Born-canonical emitter (same pass):** Phase 2 emits the canonical Slide Spec **table**;
  parser stays tolerant of prose as a back-compat shim. Ship emitter + strict guard + tolerant parser
  **together** (else old decks break). *(Recommended — writing's confirmed sequencing.)*
- **D-w-6 — Do NOT extract `run-core` in this pass.** Workshop is the 4th data point (2nd "compile =
  data", new rich-floor gate-type, two-output work-list) that *informs* pass #9; consume the seams,
  don't build the core. *(Recommended.)*
- **D-w-7 — Sequence:** (1) `workshop_slide_table.py` + golden test on the real opv prose `OUTLINE.md`
  (two-way parity oracle per §3a); (2) reconcile the GENERATE Discover (full) + the VERIFY OUTLINE-read
  (side-table only) to it (opv-parity runs the deterministic Mechanical leg for byte-parity, then a
  single-slide judgment triple via `onlyChecks:["S1"]`); (3) guard reconciliation + the stale-approval
  catch; (4) grep-grounded fidelity + `scope` disclosure; (5) born-canonical emitter; (6)
  structure-reorder / stale-approval PAUSE fixture. **Each step tested before the next; nothing ships
  until two-way A/B parity holds on the real opv deck.** *(Recommended.)*

  **Mechanical-leg parity is byte-for-byte, NOISE INCLUDED.** The port MUST call `check-all.py` with
  the **identical invocation** and use the **identical overflow page-count heuristic** as current
  `workshop-verify.js` — so the 3 phantom constraint-FAILs, the 1 tooling error, and the over-counted
  overflow all reproduce *exactly* (parity HOLDS only because both inherit the same noise). **Any
  cleanup of that noise is NOT part of this port** (see D-w-8) — it is a separate change with its own
  before/after, never silently folded in (silent drift would make the A/B unreadable).

  **Two-track A/B fixtures (opv-parity, ready before the parser lands):**
  - **Track A — compile-fail short-circuit (parity-critical).** The real opv deck *as-is* does **not
    compile** (`slidesCompiled=false` — 10 missing `assets/cpva/*.png` appendix assets, S22–S31; body
    S1–S21 intact; the committed PDFs were built in Apr/May before the assets vanished). This exercises
    `workshop-verify.js`'s **compile-fail early-exit** (`workshop-verify.js:167`): `overallPass=false`,
    critical compile finding(s), **and the per-slide fan-out is SKIPPED** (no 38×3 reviewers spawned).
    **The port MUST reproduce this short-circuit** — fan-out skipped, **zero wasted agents on an
    uncompilable deck.** Running the fan-out anyway = a parity failure. A ready-made fixture, no
    construction needed. **Track-A pass condition asserts the STABLE short-circuit invariants, NOT an
    exact count** (opv-parity): `overallPass===false`; `verdict==='ISSUES FOUND'`; `findings.length>=1`
    and every finding `area==='compile'`/`severity==='critical'`; `reviews===[]`; **no per-slide
    reviewer agents spawned**; `slidesThatFlagged===` all enumerated IDs. Assert `summary.critical>=1`,
    **never `==2`** — because `summary.critical = 1 + compileErrors.length` is agent-bucketed and
    *floats* run-to-run (and disagrees with the always-1 `findings.length` — a current count bug; see
    D-w-8). The reconciled engine preserves that bug byte-for-byte; the assertion just doesn't bind to
    the flaky number.
  - **Track B — full pipeline (Discover + join + per-slide).** Needs a *compiling* deck → opv-parity
    preps a **fixture COPY** under `$CLAUDE_JOB_DIR/tmp` (never touches the real `slides.typ`) with the
    10 missing appendix figs **stubbed with placeholder rects** (chosen over dropping S22–S31) — this
    **preserves the 38-slide / 21-COVERED-17-PARTIAL baseline shape** so diff (b)'s acceptance criterion
    (§3a-join) stays valid against the appendix-coverage signal.

- **D-w-8 — Mechanical-floor HONESTY cleanup (SEPARATE from the port; flagged before/after).** Not part
  of the compile-pattern port, but surfaced by it (§4c) and worth doing right after parity lands:
  (a) **scope `check-all.py` to `typst-*` / a real domain filter** so the 3 repo-meta phantoms
  (`post-subagent-enforcement`, `topic-change-protocol`, `writing-stop-triggers`) and the broken
  `scored-tics-patterns` module stop riding every deck's gate — today they keep `constraintsPassed`
  permanently false, so the substrate gate can *never* go green on slide quality alone;
  (b) **make `overflow` divider-aware** (subtract theme-injected `=`/`==`/title pages, or move to a real
  per-slide frame-overflow check) so it stops false-positiving on every deck with section dividers;
  (c) **land the `scope.notChecked` disclosure** from move (2) describing what the floor does/doesn't
  cover; (d) **fix the compile-fail count inconsistency** (`workshop-verify.js:167`): `summary.critical
  = 1 + compileErrors.length` disagrees with the always-1 `findings.length` (real opv: critical=2,
  findings=1) — make them agree (count = `compileErrors.length`, or emit one finding per error).
  **Each is its own commit with a before/after on the opv fixture — NEVER folded into the port's
  parity A/B.** *(Recommended as a fast-follow; gated behind parity so the two changes never confound.)*

---

## 9. wc-audit result (folded in — `workflows:wc-audit` on `workshop`, 2026-06-26)

**Verdict PASS · substrate gate ✅ clean · composite 9.64 / 10 (advisory; threshold 9.5) · 0 critical ·
portability Clean · ultracode-candidacy 0 open.** This independently confirms the headline: workshop is
already a well-built, already-migrated workflow — there is **no architectural gap** the port must
repair; the port is the upstream honesty/determinism work this DESIGN scopes, not a rebuild.

Audit signals that **corroborate the move list** (not new criticals — the relevant low-9s):
- **P03 (9):** `OUTLINE_APPROVED` is the one gate enforced by skill prose, not a PreToolUse hook keyed
  to `.planning/OUTLINE_APPROVED.md`. → move (1)/(3) **hardens exactly this**: the guard becomes
  parser-backed (`validate = parse().violations`), making the structure→generate gate a real hook
  property.
- **P17 (9):** the Phase-3/4 `workshop-verify` reviewers are prompt-asserted read-only (platform
  ceiling — `agent()` has no allowed-tools hook), already documented in `workshop-verify.js`. No change;
  noted.
- **P18 (9):** no v1/v2/out-of-scope **scope tagging** on inventory IDs. Orthogonal to this port;
  candidate follow-up, not in scope.
- **Enforcement: Fact Rows "Weak" in generate; Red Flags+STOP "Weak" in structure.** Minor skill-prose
  polish, independent of the compiled-pattern port — fold opportunistically, not gating.

The candidacy scan classifies **generate as already-migrated** (the workshop-generate ultracode
workflow) and **gather/structure as correctly single-agent** (no fan-out value) — i.e. the runner
architecture is already the target shape. Nothing in the audit reopens the "needs a run.js" question.

---

## 9b. Build status (worktree `worktree-workshop-spec-plan-compile`, NOT shipped)

User signed off ("ok" → D-w-1…D-w-7 approved; D-w-8 mechanical-floor cleanup = fast-follow after parity).

- ✅ **Step 1 — `scripts/workshop/workshop_slide_table.py`** (the deterministic Discover, the ONE shared
  parser). Parses BOTH forms (canonical 7-col table + legacy 4-field prose); `build_index() → SlideIndex`
  with `.ok`/`.violations` (guard contract) + `.to_dict()` DATA work-list; prefix-tolerant columns (dev),
  unicode-safe slug (writing), inventory over-attach FIX (`[R1-R8]` → literal `['R1','R8']`),
  stale-approval backstop. **30/30** (`tests/workshop_slide_table_test.py`: mixed-form fixtures + the
  REAL-opv-deck parity block — THE TRAP). On the real opv prose deck: **form=prose, 21 slides, 5
  sections, ok=TRUE** (prose parses clean → parity-regression fixed), and the **stale-approval catch
  fired live** (approved 18/4 vs live 21/5).
- ✅ **Two-way A/B (opv-parity) — PASSED + 1 measured improvement.** (a) GENERATE: **exact 21/21**
  (section/takeaway/inventory-deduped). (b) VERIFY side-table (semantic join, NOT mechanized): candidate
  supplied for **21/21** baseline-COVERED → COVERED reproduced on all 21; inventory == baseline 20/21,
  the 1 diff being the S21 **over-attach FIX** (parser more correct, not a regression); the 5 focus
  paraphrase/split cases **S4/S9/S14/S18/S19 all reproduced exact**; non-bijection confirmed
  (S11/S12→{F1,F2,R9}, S13/S14→{A3,F3,R10}). **Mechanical titleSlug ceiling = 10/38** → empirically
  proves the legacy join cannot be mechanized (titleSlug is sound ONLY for the born-canonical anchor
  path). prose parses clean (ok=True, violations=[]); stale-approval fired (18/4 vs 21/5).
  *(`AB_RESULTS.md` archived in opv-parity's job dir.)*
- ✅ **Step 2 — engine reconciliation (engines done + unit-tested; skill-wiring next).**
  `workshop-generate.js`: `SLIDE_INDEX` gate + `discFromIndex()` **full-replaces** the LLM Discover
  (composite-group fan-out key; the assembly agent now constructs `fileHeader` so discFromIndex is 100%
  deterministic); LLM-Discover fallback retained. `workshop-verify.js`: KEEPS the slides.typ enumeration
  + the **semantic** OUTLINE-row↔slide JOIN, but feeds the Discover deterministic **CANDIDATE rows** from
  the parser (no free OUTLINE re-parse; inventory drawn ONLY from candidates). Parser also emits
  `paperPath` (deterministic SOURCES read, bold-tolerant). **12/12** (`tests/workshop-engine-discover.test.mjs`:
  no-LLM-discover-when-index path, per-group fan-out, verify-keeps-semantic-join-with-candidates,
  back-compat fallback — caught + fixed an unescaped-backtick bug in the fallback prompt).
- ✅ **Step 2b — skills wired.** All 5 engine invocations (workshop Phase 3 generate; Phase 3/4 + selective
  verify; workshop-revise verify) now run `workshop_slide_table.py --json > .planning/slide-index.json`,
  surface `violations`/`staleApproval` (STOP), and pass `args.slideIndex` (omit → LLM-Discover fallback).
- ✅ **Step 3 — guard reconciled (S6).** `hooks/workshop-outline-executable-guard.py` now imports
  `build_index` and sets `validate = build_index(outline).violations` — ONE parser shared by guard + both
  engines ("parses ⇔ passes the guard"). The legacy **prose form now PASSES** (the parity-regression fix —
  was a hard deny); real defects (missing inventory, dangling id) still DENY; **stale approval is
  allow+WARN**, not a block. **6/6** (`tests/workshop_guard_test.py`, incl. the real opv deck passing the
  guard CLI). Full regression green: parser 30/30, engine-discover 12/12, guard 6/6.
- ✅ **Track A — PASS.** Reconciled vs current verify on the real compile-fail deck short-circuit
  IDENTICALLY on the stable invariants (overallPass=false; verdict ISSUES; findings=1 compile/critical;
  **reviews=[]; agent_count=2 → ZERO per-slide agents**; slidesThatFlagged=all 38; critical=2 byte-for-byte
  on both → preserved for D-w-8). Reconciled short-circuits correctly WITH `slideIndex` present.
- ✅ **Track B — regression FIXED + re-architected + RE-VALIDATED (n=3).** opv-parity's first n=3
  variance study showed the candidate-MENU injection biased the verify join (appendix over-match, COVERED
  `[25,20,38]`). **Fix:** verify's Discover reverted to the **free OUTLINE read** (byte-identical join,
  parity-safe) + a deterministic **JS inventory WHITELIST** (drop non-SOURCES ids, applied outside the
  agent — no join bias). Parser emits `sourcesInventory`; `paperPath` `~`-expanded. **16/16**
  (`workshop-engine-discover.test.mjs`). **Re-run n=3 CONFIRMS:** COVERED `[21,21,21]` (tighter than
  current's `[21,21,19]`), appendix over-match **`[0,0,0]`** (matches current). Whitelist validated as a
  clean no-op hallucination guard on this deck (all attributed ids ∈ the 37-id `sourcesInventory`).
  **Honest caveat:** the S21 over-attach FIX is **GENERATE-path only** (where the parser's 21 rows ARE the
  source); VERIFY stays at parity with current (incl. current's S21 over-attach — all real ids, whitelist
  keeps them). **Step 2 is parity-clean on the real opv deck — shippable.**
- ✅ **Step 4 — honest gate (both gaps closed).** (4a) `workshop-generate` section agents now **ground
  `citedInventory` in the file** (`grep -ohE '[FTRA][0-9]+' section-N.typ`) instead of memory — the JS gate's
  `fidelityOk ⊆ allowed` check is now backed by a real file scan (writing-G1 analog). (4b)
  `workshop-verify` returns a **`scope:{checked, notChecked}`** disclosure (D1 / doctrine #3 addendum) on
  both the full gate and the compile-fail short-circuit — a clean pass no longer over-claims (it states the
  constraints-phantom/permanently-red caveat, the divider-naive overflow caveat, the SEMANTIC reviewers +
  unbiased join live OUTSIDE the floor, and the visual-skip when `look_at` is unresolved). Additive fields,
  gate booleans unchanged → parity-safe. **20/20** (`workshop-engine-discover.test.mjs`). Full suite green:
  parser 31/31, guard 6/6, engines 20/20.
- ✅ **Step 5 — born-canonical emitter reconciled (doctrine #6).** Phase 2 already emits the canonical
  7-col Slide Spec table; reconciled its framing to the shared parser (table = canonical, pins Visual+Notes
  so generation renders rather than invents; prose = legacy back-compat shim only; new decks MUST emit the
  table). Verified the parser parses the SKILL's **exact** template byte-for-byte (Part-prefix + `==`
  backtick + parenthetical Visual) — the emitter↔parser drift catch is now a golden test (`test_table`).
  *(The `// slide-id:` anchor for a mechanical verify join — §3a-join escape hatch — is intentionally
  DEFERRED: it only helps net-new decks and would re-touch the just-validated verify join; no speculative
  build.)*
- ✅ **Step 6 — structure-reorder PAUSE fixture** (`test_reorder_pause_fixture`, the workshop grain-pause
  analog): a reframe (2 Parts/2 slides → 3 Parts/4 slides) leaves a stale `OUTLINE_APPROVED.md`; the live
  OUTLINE parses clean (the reframe is legitimate) yet `stale_approval` fires → routes to a re-approve
  PAUSE, never silently trusting the stale APPROVED. Fires live on the real opv deck too (18/4 vs 21/5).
- ✅ **Generate end-to-end A/B (opv-parity, optional) — PASS + 1 gate-gap FIXED.** A full reconciled-generate
  run on a fresh opv copy: overallPass=true, 13/13 sections, deck compiles, **agent_count=14 (13 section + 1
  assembly, NO LLM discover)**, and grep-fidelity (4a) independently confirmed **file-backed** (re-grep of each
  fragment == reported `citedInventory`). **Gate-gap found + folded in:** the generate gate compiled ONLY
  `slides.typ`, so section agents inventing notes macros could ship a malformed `notes.typ` that still passed.
  **Fix (cheap, deterministic, parity-neutral):** the assembly agent now compiles `notes.typ` too;
  `notesCompiled` gates `overallPass` (critical finding on failure); section agents are told to write plain
  prose notes, NO invented macros. **23/23** (`workshop-engine-discover.test.mjs`: notes-fail blocks, macro
  forbidden).
- ✅ **ALL PORT STEPS COMPLETE.** Full suite green: **parser 37/37, guard 6/6, engines 23/23.** Step 2
  parity-validated by opv-parity (Track A + B, n=3); generate path end-to-end validated. Uncommitted in
  `worktree-workshop-spec-plan-compile`.
- ⬜ **D-w-8** (separate fast-follow, gated behind parity) — mechanical-floor cleanup: scope `check-all.py`
  to `typst-*` (kill the permanently-red phantoms), divider-aware overflow, the `critical`/`findings.length`
  count fix. Each its own before/after commit; NOT part of this port's parity surface.

## 10. Honest bottom line

Workshop is writing's twin and is **further along than writing was at assessment time**: it already has
the executable-spec guard writing had to *add*, already has the substrate-split JS gate, already keeps
verify/revise outside the runner, has a **richer** (real-exit-code) deterministic floor, and scores
**9.64 / PASS** on its own architecture audit. So copying the compiled-`run.js` machinery would bolt
DAG/topo/recompile ceremony onto a workflow that — proven on a real 38-slide deck — has no DAG. The
**real** workshop port is **upstream of the runner**: extract the **one shared parser** that three
readers currently re-derive (a *doubled* drift mask), make **inventory fidelity grep-grounded** and the
**floor scope-honest**, and emit a **born-canonical** slide table while keeping the parser tolerant of
the real prose decks already in the wild — with the **cardinality correction** baked in so verify never
under-counts a drifted deck. That respects "don't rewrite where the shape works," fixes a real parity
regression instead of causing one, and hands the pass-#9 extraction its **fourth** data point: a gate
that is **rich-mechanical-floor + semantic-ceiling**, and a "compile" that emits **data, not code** with
a **two-output work-list** — the second instance confirming that branch.
