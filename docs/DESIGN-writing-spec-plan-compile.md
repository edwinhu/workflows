# DESIGN: the `spec → plan → compiled run.js` pattern applied to the **writing** workflow

Status: **DRAFT — assessment first, awaiting USER sign-off before any engine change.**
Companions: `docs/DESIGN-ds-spec-plan-compile.md` (proven 1st instance, exit-code gate),
`docs/DESIGN-dev-spec-plan-compile.md` (shipped 2nd instance, exit-code gate, v5.56.0/PR#8),
`docs/ds-generalization-assessment.md` (the playbook — writing is the judgment-gate test).

> The brief asked for an **honest assessment, not code**. This document's headline is a finding,
> not a port plan: **writing is the farthest sibling, and most of the ds/dev headline win does not
> apply to it because writing's execute layer is *already* a dynamic fan-out workflow.** What *does*
> port is narrower, and it is mostly about the **spec** (the outline) and the **gate** (semantic),
> not the runner.

---

## 0. TL;DR

ds/dev replaced a **generic interpreter** (`{ds,dev}-implement.js`: an LLM "discovery" agent
re-parsed `PLAN.md` once **per dependency level**, ran one level, then a heavyweight verifier) with a
**deterministic compiler + a per-plan compiled `run.js`** that topo-sorts the whole DAG, runs it in
one invocation, and gates each task on a real **exit code** via an independent probe.

**Writing already did the part that mattered most.** `workflows/writing-draft.js` and
`workflows/writing-verify.js` are *already* ultracode workflows with a `discover → fan-out →
verify → gate` shape that runs the **whole document in ONE invocation** with **genuine per-section
parallelism**. There is no per-level round-trip to collapse, and **there is no task DAG** — writing
sections are deliberately independent (each write-agent reads the prior/next *outline*, never a
sibling *draft*). So the three ds/dev wins land as:

| ds/dev win | Writing status |
|---|---|
| Kill ~N LLM-discovery round-trips → 1 topo-run | **Mostly N/A** — already 1 invocation, already flat-parallel; no DAG to topo-sort |
| Kill the per-call LLM discovery re-parse | **Partial win** — one `Discover` LLM agent per invocation remains, and it *is* the writing form of the spec-drift mask (see §3) |
| Cheap honest gate via real exit code | **Does NOT port as-is** — writing's gate is a **semantic judgment**, not an exit code (see §4) |

The honest, high-value port for writing is therefore **three surgical moves**, not a run.js rewrite:

1. **Compile the `Discover` phase** of both engines into a deterministic section-index parser
   (`scripts/writing/writing_section_index.py`) — the writing analog of `ds_plan_table.py`. Both
   audits find Discover ≈ 80–90% pure enumeration. This kills writing's discovery-LLM drift mask.
2. **Harden the outline-spec + reconcile its guard** to that shared parser
   (`writing-outline-executable-guard.py` importing it) — the assessment's explicit writing
   follow-up ("harden writing-outline to pin a source per claim") and the close of audit gap **G2**.
3. **Formalize `gateProbe(s)` as the SEMANTIC fork** returning `{ pass, evidence }` with
   **numbered, specific evidence** — splitting it into a *deterministic floor* (bib-grep, claim-id,
   repetition, prose-lint, de-ai, quote-resolution — mostly already the "Leg-1" gate) and an
   *irreducible LLM-judgment authority* that **stays OUTSIDE run.js** (writing-verify + source-verify).

**What does NOT change:** brainstorm / lit-review / setup / outline stay conversational + human-gated;
the **writing-verify → writing-revise `/goal` loop stays OUTSIDE** any runner as the real correctness
authority (for semantic gates it becomes *more* load-bearing, not foldable — assessment §"Semantic
gates raise the stakes"). **We do NOT generate a per-project `.planning/run.js`** (§7, a real
divergence from ds/dev worth recording for the eventual shared-core pass).

---

## 1. Audit findings (delegated wc-audits, 2026-06-26)

Two parallel Mode-2 audits (per the delegation discipline). Full reports archived; key results:

### 1.1 `writing-draft.js` + skill — baseline **8.5/10**
Well-built TRANSFORM engine. Invariants are clean and largely structural. The 1.5-pt deduction is
**determinism/honesty gaps**, the exact class the compile pass kills:
- **G1 (biggest):** `fidelityOk` is *presented* like a mechanical check (ds deps-resolution) but is
  **LLM-self-reported** — the verifier *asserts* "@bibkey exists in the bib" without grepping the
  bib. Extracting `[@key]` from prose and grepping `bibPath` is exactly as compilable as ds
  deps-resolution and currently isn't done. **Cleanest determinism win available.**
- **G2:** `outlineGranular` has **no shared source-of-truth guard** — the verdict lives solely in the
  Discover LLM; there is no `writing-outline-executable-guard.py`. ds's "one parser feeds both
  compiler and guard" lesson is not yet applied to writing.
- **G3:** coverage depth is **asserted, not counted** — `pointsExpanded` is a self-report; the
  outline's bullet-groups are parseable and could ground it.
- Discover verdict: **~90% compilable.** Pure enumeration (names, prev/next order, file paths,
  `bibPath`, `sourcesPinned` regex). Thin residue = the *marginal* granularity judgment, which the
  **already-mandatory `OUTLINE_REVIEWED.md = APPROVED` gate** mostly re-litigates — push it upstream;
  catch only the *regression* (placeholder / bare-headings) mechanically.

### 1.2 `writing-verify.js` + review/revise skills — baseline **9.3/10**
The layer **already separates the two halves the assessment predicts.** Leg-1 (`check-all.py` +
de-ai-audit + bridge-repetition + prose-lint) is the deterministic probe floor that runs *before* the
workflow; L1/L2/L3 are the irreducible semantic reviewers with evidence-rich payloads. Gaps:
- **G3′:** `check_section_cites.py` is a **semantic gate disguised as deterministic** — its exit code
  is reproducible-shaped but the per-claim SUPPORTED/UNSUPPORTED comes from an NLM/LLM call (PARTIAL/
  UNCLEAR can flip run-to-run). Do **not** file it under deterministic probes.
- **G4:** superseded reference docs still on disk (retire-the-orchestrator hygiene, like
  dev-implement.js).
- Discover verdict: **~80% compilable**, conditional on two upstream invariants being *hard*:
  (a) `ACTIVE_WORKFLOW.md` always carries `style:`; (b) outlines carry `CLAIM-XX` tags. Today
  `writing-claim-id-guard.py` only **warns**, never blocks — so (b) is not guaranteed.

### 1.3 The load-bearing invariants any change MUST preserve
From the audits (B-numbered there): closed section set from `outlines/*.md`; **document order, not
lexical**; the **executable-spec bounce** (`outlineGranular=false` ⇒ never drafted, fixed upstream);
**genuine parallel fan-out** (prev/next *outlines*, never sibling drafts); **pure-JS substrate gate**
(critical+major block, minors advisory — the wc-asymptote lesson, `writing-verify.js:254`);
**selective re-run** (`onlyChecks`+`priorReviews`); **payload > pass/fail** (every issue carries
`{severity, file:line, verbatim quote, detail}`); the **mechanical Verify stage drops fabricated
quotes**; the **Iron Law of Re-Review**; the **Leg-1 mechanical hard gate runs BEFORE the workflow**;
the **mandatory source-verify / de-AI passes OUTSIDE run.js**.

---

## 2. Mapping writing onto the ds "spec → plan → compiled run.js" model

| ds/dev concept | Writing analog | Notes |
|---|---|---|
| **SPEC** (`SPEC.md`) | `PRECIS.md` (thesis, claims, scope, counterargs) | human-gated, conversational — unchanged |
| **PLAN** (`PLAN.md` Task-Breakdown table) | `OUTLINE.md` + `outlines/*.md` (per-section, paragraph-granular, source-pinned) | **the spec to harden** (§3); the drafts already carry `implements: [CLAIM-XX]` frontmatter — a born traceability hook |
| **compile** (`ds_plan_table.py` → `run.js` literal) | `writing_section_index.py` → a **data** artifact (section index), consumed by the *generic* engines | **divergence:** writing emits DATA, not code (§7) |
| **run.js** (per-project compiled runner) | `writing-draft.js` / `writing-verify.js` (**already generic dynamic workflows**) | already exist; we feed them a compiled index instead of an LLM `Discover` |
| **task** | **section** | no inter-section deps → no DAG, no topo-sort, flat-parallel |
| **`implementerPrompt(t)`** | the per-section **write-agent** prompt (writing-draft Transform) | already exists; unchanged in shape |
| **`gateProbe(t)` → `{exit0, outputsPresent, tail}`** | **`gateProbe(s)` → `{pass, evidence}`** | **THE REAL FORK** (§4) — semantic, not exit-code; evidence must be numbered |
| **adversarial layer OUTSIDE run.js** (full suite / test-gaps / dev-verify) | **writing-verify + source-verify + the `/goal` revise loop** | stays outside; **more** load-bearing for semantic gates |
| **two-kinds-of-decision + stale-gate backstop** | **prose-only edit vs spec-changing editorial decision** (§5) | thesis reframe = gate-changing → edit outline + re-index |
| **declared/dynamic PAUSE** | **R4 escalation / thesis-change** (§5) | the SEC-order reframe is the live writing R4 |

**What a "gate" is in writing.** Two tiers, and conflating them is the trap:
- a **deterministic floor** (necessary, not sufficient): bib `[@key]` resolves; `CLAIM-XX` present;
  no fabricated quote (grep); no `[CITE-NEEDED]` left; repetition/prose-lint/de-ai thresholds. These
  *can* be a probe-shaped `{pass, evidence}` — and mostly already are (Leg-1).
- the **semantic authority** (sufficient): coverage adequacy, prose F/C grades, transition
  SMOOTH/ABRUPT, thesis threading, claim-actually-supported-by-source. **Irreducibly LLM**, kept
  OUTSIDE run.js, trusted only because the payload carries verbatim quotes + file:line.

**What the probe is.** The deterministic floor above — *plus* a finding from the real repo: in
`tender_offers` many footnotes cite a **dataset** (`data/processed/appraisal_petitions.parquet`:
42.9%, n=58, $1.5B), not literature. **No exit code and no bib-grep verifies a number traces to a
parquet cell** — that needs a reader that actually loads the data. So a writing `gateProbe` has a
*third* dimension ds/dev never had — **empirical/dataset provenance** — which is **not** a mechanical
probe; it routes to the semantic authority (a data-reading verifier) with numbered evidence. Recorded
as a first-class finding, not forced into exit-code semantics.

**Degraded mode when the dataset is remote (the real-repo case).** In `tender_offers` the parquet is
*not local* (it lives in a remote rjds notebook), so true number→cell provenance can't run. The honest
fallback is **prose-to-prose internal consistency** — does the draft's `42.9%` match `PRECIS.md`/
`OUTLINE.md`'s `42.9%` — which catches **drift between draft and spec, NOT fabrication vs the data**.
The `dataProvenance` evidence MUST label which mode it ran in (`provenance` vs `consistency-only`) so a
green check never overstates what was verified. *(Parity sanity-checked one: draft "1,489 eligible"
vs PRECIS "1,477" reconciles as 1,489 − 12 carve-out = 1,477 — consistent, not a discrepancy.)*

---

## 3. Move 1 + 2 — compile `Discover`, harden the outline-spec, reconcile the guard

This is the genuinely-ports core and the highest-value work.

**`scripts/writing/writing_section_index.py`** (single source of truth, mirrors `ds_plan_table.py`):
- parses `OUTLINE.md` (`###` part order → document order, prev/next) + `outlines/*.md`
  (`"<Name> (Outline).md"` → name) + `drafts/*.md` pairing (reuse `check_section_cites.section_slug()`);
- extracts per section: `outlineFile`, `draftFile`, the **primary** claims (from the `## Claim →
  Section Map`), the draft's `implements:` set, `prevName`/`nextName`, and **`sourcesPinned`**
  (advisory, outline-based: a pandoc `[@key]` in the outline — a bare `CLAIM-XX` is a *claim id, not a
  source*, so it does **not** count; this differs by design from a draft-body reading and gates
  nothing — resolved spec, per the parity oracle's `sourcesPinned_AMBIGUITY` note);
- **mechanical granularity floor:** `granular = (#bullet-groups ≥ N) ∧ (each group has ≥1 sub-point)`;
  `false` only for placeholder (`TBA`, `develop this`, `X pgs`) or bare-headings — the *regression*
  catch. The substantive "is each point real" judgment stays with the upstream outline reviewer.
- **prefix-tolerant column/heading lookup** (dev's gotcha: `h == name or h.startswith(name+" ")`),
  and **golden-tested against a REAL outline** (`tender_offers/outlines/`), not the template.

**Both engines** (`writing-draft.js`, `writing-verify.js`) drop their LLM `Discover` agent and consume
this index (passed in `args`, or read via a tiny deterministic pre-step). This closes the drift mask:
today the section enumeration is an LLM judgment that can silently disagree with what the guards think
the section set is.

### 3a. Real-repo parser constraints (tender-parity, pre-build read-only check)

The parity partner stress-tested these assumptions against the live `tender_offers` repo *before* the
parser is written, and found the convention the current engine assumes does **not** hold there — which
is itself the **drift-mask thesis caught live**: `writing-draft.js`'s `Discover` prompt says *"each
file named `<Name> (Outline).md`"*, yet the real outlines are named `<Name>.md`. The LLM `Discover`
silently tolerates this; a strict deterministic parser would miss **every** outline. So the parser
must be **tolerant** (the ds lesson) AND the emitter canonical (so new projects are born clean):

- **Filename pairing is project-variable.** Accept both `<Name> (Outline).md` (canonical) and
  `<Name>.md` (real `tender_offers`); pair to the draft `<Name> (Draft).md`. The `(Outline)` suffix in
  this repo only exists in an **old `notes/` tree** — exclude it.
- **Document order: `OUTLINE.md` exists and is canonical** (parity correction — it lives in
  `paper/.planning/`, alongside the full state machine: `ACTIVE_WORKFLOW.md`, `PRECIS(_REVIEWED).md`,
  `OUTLINE(_REVIEWED).md`, `DRAFT_COMPLETE`, `LEARNINGS.md`). Its `## Structure` block lists
  `### Introduction / ### Part I / II / III / ### Conclusion` = exact document order. So the **primary
  path is parse `OUTLINE.md ## Structure`**; the loud-fail heuristic (D-w-7) is **back-compat
  fallback only**, not the main route.
- **Unicode-safe slugs.** Part II is `… — The Two Offer-Period Channels` (em-dash) → `section_slug()`
  must be unicode-safe (NFC normalize, keep word chars, don't choke on `—`).
- **Claim-trace direction is the critical D-w-3 fork — there are THREE non-identical claim
  representations; the canonical source is `OUTLINE.md ## Claim → Section Map`** (maps each claim to a
  PRIMARY home + setup/echo, by Part numeral; claims are primary-homed only in Parts I/II/III, while
  Intro/Conclusion are echo-only). The per-section outline tags and the draft `implements:`
  frontmatter are *derived*, not the spec. **Guard semantics MUST be `draft.implements ⊇ {claims the
  map assigns to that section}` — NOT equality, NOT `draft ⊆ outline`.** Either of the latter
  **rejects Intro & Conclusion**, which legitimately survey all six claims (supersets). Getting this
  wrong makes the blocking guard reject the real repo. *(Confirmed: all 5 drafts carry
  `implements: [CLAIM-XX]`; Part I/II/III match their map, Intro/Concl are supersets.)*
- **The deterministic bib-grep floor is EMPTY on 2 of 5 sections.** `[@key]` cites are a *minority*:
  Intro 11 footnotes/**0** `[@key]`; Part I 18/8; Part II 14/**0**; Part III 19/**19**; Concl 4/14.
  Intro & Part II are 100% Bluebook-*prose* footnotes → the deterministic source-fidelity probe
  catches **zero** there; all fidelity falls to the semantic authority. **Slice implication:** Part
  III (19/19) is the only section that exercises *both* gate tiers; Intro alone under-tests the
  deterministic floor (it's a pure semantic-tier test). All 18 distinct `[@key]` resolve clean to
  `sources.bib` → **G1 bib-grep is sound where keys exist.**
- **`appraisal_petitions.parquet` is NOT local** (`data/` doesn't exist; `OUTLINE.md ## Figures &
  Tables` points to a remote rjds notebook). So **D-w-4's data-provenance verifier cannot run here as
  true provenance** — see the degraded-mode note in §4.

**Harden the spec + guard (close G2, the assessment's writing follow-up):**
- a new **`writing-outline-executable-guard.py`** imports `writing_section_index.py` and blocks
  `OUTLINE_REVIEWED.md = APPROVED` unless every section parses (granular, claim-pinned, source-pinned
  where the claim is substantive). "Compiles ⇔ passes the gate" becomes a property, not a hope.
- **make `writing-claim-id-guard.py` blocking** (today it only warns — audit G1′), so `CLAIM-XX`
  presence is guaranteed and `precisClaim` resolution is deterministic.
- **born-canonical outline emitter:** `writing-outline` writes the canonical structure the parser
  expects (mirrors ds-plan's canonical Task-Breakdown emitter), so the tolerant parser is a
  back-compat shim, not a permanent crutch.

**Close G1 inside writing-draft verify:** add a deterministic `[@key]`-against-`bibPath` grep to the
fidelity step so `fidelityOk` is grounded, not asserted.

---

## 4. Move 3 — `gateProbe(s) → { pass, evidence }`: the semantic fork

Reusing dev-refactor's seam naming (`gateProbe`, `implementerPrompt`), but **not** dev's exit-code
shape. Writing's `gateProbe` is the judgment-gate abstraction the assessment names as the real fork:

```
gateProbe(section) → {
  pass: boolean,             // necessary-not-sufficient: the deterministic FLOOR
  evidence: {                // MUST be numbered/specific — the human's catch-channel
    bibUnresolved: ["@foo 2019 @ Part-I:42"],     // grep [@key] vs bibPath (G1 fix, deterministic)
    citeNeeded:    ["Part-I:88 'effect on minority holders'"],
    fabricatedQuotes: [...], // grep verbatim quote vs draft (deterministic)
    claimIdsMissing: [...],  // deterministic
    repetition:    [{quote, locations}],           // bridge_repetition_check.py (deterministic)
    proseLint:     [{path:line:col, category}],    // prose-lint.py (deterministic)
    dataProvenance: ["42.9% @ Part-III:12 — unverified vs parquet"],  // EMPIRICAL — routes to a reader, NOT a probe
  }
}
```

**Why evidence must be numbered (the central lesson, *stronger* here):** an exit code can't lie; a
"does this section cover its outline / cite only its sources" judge *can* be wrong or gamed. The muni
8.8%-dedup and the hylo `readwiseSync` signature were caught by the deviation note + numbered
payload, not the gate. For a semantic gate that funnel is the *only* safety net. So `evidence`
carries the same specificity muni's row-counts and dev's AssertionError did. A `pass:true` with vague
evidence is the failure mode wearing a judge's robe.

**The authority stays outside.** `gateProbe.pass` (floor) is necessary; the **writing-verify `/goal`
loop + source-verify** is sufficient and authoritative. We do **not** let the semantic floor self-
certify a draft complete — exactly as ds keeps `ds-validate-coverage` and dev keeps the full suite
outside `run.js`.

---

## 5. Pauses & the two-kinds-of-decision (the live thesis-change test)

Writing's editorial decisions map onto ds's two-kinds routing + stale-gate backstop:

| ds/dev | Writing | Resume |
|---|---|---|
| **behavior-only** (winsor scope; gate unchanged) | **prose-only edit** (fix a sentence, tighten a bridge) | re-run the section; no spec edit |
| **gate-changing** (grain/key/schema → edit Verify + recompile) | **spec-changing editorial decision** (recast a claim, reorder sections, **reframe the thesis**) | edit `OUTLINE.md`/`outlines/` + **re-index**; the draft re-blocks against the stale outline |
| **dynamic R4 pause** (implementer can't auto-resolve) | **R4 restructuring** (already in writing-draft/revise) — and the **thesis-change** | **PAUSE**, surface numbered payload, human decides |

**The stale-gate backstop, writing form:** a write-agent handed "the thesis changed" must NOT silently
drop or rewrite an outline point to make coverage pass — it **re-blocks** and states the outline must
be updated + re-indexed. A draft that quietly conforms to a changed thesis while the outline still
encodes the old one is the writing analog of the forbidden silent dedup.

**Live adversarial test (`tender_offers`, from tender-parity):** the **Apr 16 2026 SEC order**
(13e-3 carve-out + competing-bid snap-back) undercut the original thesis and forced the v1→v2 reframe.
A compiled run **must surface that as a PAUSE, never a silent edit.** This is writing's grain-pause
fixture — the single strongest parity test, and it already happened in the real repo.

**The stale APPROVED artifact (the writing analog of ds's stale `Verify`) — caught live.**
`PRECIS_REVIEWED.md` (dated 2026-06-18, **pre-reframe**) certifies *"FIVE claims / FOUR substantive
Parts,"* but the live reframed structure is **SIX claims / THREE Parts.** The `APPROVED` gate file is
**stale and now lies about the document's shape.** This is exactly the failure the stale-gate backstop
must catch: a spec-changing decision (the reframe) was honored in the *drafts* while an upstream
APPROVED artifact still encodes the old shape. **The hardened guard (D-w-3) must detect this** — the
section index built from the live `OUTLINE.md ## Claim → Section Map` (6 claims / 3 primary Parts) must
**fail loudly against a `*_REVIEWED.md` that asserts a different count**, surfacing a PAUSE
("re-approve PRECIS/OUTLINE — the approved review predates the reframe"), not silently trusting the
stale `APPROVED`. A green gate over a stale approval is the semantic-gate version of passing on a
clobbered artifact.

---

## 6. What stays OUTSIDE the runner (unchanged)

brainstorm · lit-review · setup · outline (conversational, human-gated) · **writing-verify.js's L1/L2/L3
semantic reviewers** · **source-verify** (deep quote-in-source) · **`check_section_cites.py`** (NLM
semantic gate — G3′: keep it a gate, not a "deterministic probe") · **de-ai-revise** · the
**writing-verify → writing-revise `/goal` loop** with substrate-gate exit + max-3 + REVIEW_STATE.md.

---

## 7. A real divergence to record for the shared-core pass (#9)

ds/dev compile a **per-project `run.js` literal** because each project has a project-specific task DAG
and project-specific `Verify` commands to inline. **Writing has neither** — its section structure is
uniform and its runner (`writing-draft.js`/`writing-verify.js`) is *generic*. So writing's "compile"
output is best a **data artifact** (a section index) the generic runner consumes, **not generated
code**. This is a genuine seam finding: the eventual `run-core.js` extraction should treat "compile"
as *"produce the work-list,"* whose output may be **code (ds/dev) or data (writing)** — and
`gateProbe` must be a domain function returning `{pass, evidence}` that spans **exit-code (ds/dev),
mechanical-floor (writing deterministic), and judgment+empirical (writing semantic)** gates. Three
instances now triangulate the core; do the extraction *after* writing, not as part of it.

---

## 8. Decisions for USER sign-off

- **D-w-1 — Scope = the 3 surgical moves, NOT a per-project `run.js`.** Compile `Discover` +
  harden the outline-spec/guard + formalize the semantic `gateProbe`. *(Recommended.)* The
  alternative — forcing a ds-style generated `run.js` with a fake DAG — is the "don't rewrite where
  the shape works" anti-goal.
- **D-w-2 — `gateProbe` is two-tier: deterministic floor (probe-shaped) + semantic authority
  (outside run.js).** Evidence numbered/specific. *(Recommended — the assessment's core directive
  for judgment gates.)*
- **D-w-3 — Harden the outline-spec: make `writing-claim-id-guard.py` BLOCKING and add
  `writing-outline-executable-guard.py` importing the shared parser.** *(Recommended — closes G1/G2;
  is the assessment's named writing follow-up.)* **Canonical claim source = `OUTLINE.md ## Claim →
  Section Map`; guard semantics = `draft.implements ⊇ {claims mapped to that section}` (superset, NOT
  equality, NOT `draft ⊆ outline`)** — see §3a; the wrong direction rejects the real repo's
  Intro/Conclusion. The guard must ALSO **fail loudly when a `*_REVIEWED.md` asserts a claim/Part
  count that disagrees with the live `OUTLINE.md`** (the stale-approval catch, §5). Risk: a blocking
  guard could reject in-flight projects; mitigate with the born-canonical emitter + tolerant shim.
- **D-w-4 — Empirical/dataset-provenance is a NEW gate dimension; route it to a data-reading verifier
  in the semantic layer, do NOT force exit-code/probe semantics. When the dataset is remote (the real
  `tender_offers` case), degrade to labeled prose-to-prose consistency** (draft-vs-PRECIS number
  agreement) and never let the evidence overstate it as true provenance (§4 degraded mode). Also:
  **fix the source-fidelity reviewer to handle `sources.bib` + dataset citations, not just
  `sources.md`** (tender-parity tooling gap), and note the deterministic bib-grep floor is **empty on
  prose-footnote sections** (Intro, Part II) — those are semantic-tier-only. *(Recommended.)*
- **D-w-5 — Sequence:** (1) `writing_section_index.py` + golden test on `tender_offers/.planning`
  (canonical `OUTLINE.md ## Structure` order + the `## Claim → Section Map`) and `outlines/`;
  (2) reconcile both engines' Discover to it (parity: same section set, same verdicts);
  (3) guard reconciliation + blocking claim-id (⊇ semantics + stale-approval catch);
  (4) `gateProbe` two-tier + G1 bib-grep + labeled-degraded dataProvenance;
  (5) **A/B on Part III FIRST** (19/19 `[@key]` — the only section exercising *both* gate tiers), then
  the Introduction (pure semantic-tier); (6) thesis-change / stale-approval PAUSE fixture. **Each step
  tested before the next; nothing ships until A/B parity holds.** *(Recommended — note this flips the
  earlier "Intro first" order: Intro under-tests the deterministic floor.)*
- **D-w-6 — Do NOT extract `run-core` in this pass.** Writing is the 3rd data point that *informs*
  the later extraction (§7). *(Recommended, per the assessment.)*
- **D-w-7 — Document-order source: parse `OUTLINE.md ## Structure` (primary — it exists and is
  canonical in the real repo, §3a), with a loud-fail heuristic (Introduction → `Part N` by numeral →
  Conclusion) as back-compat fallback ONLY.** *(Recommended — corrected from the earlier "no OUTLINE.md
  → heuristic-primary" assumption.)* The tolerant filename pairing (`<Name>.md` ⇔ `<Name> (Draft).md`)
  + unicode-safe slug (§3a) come along with this; the golden test runs against the real
  `tender_offers/.planning` + `outlines/`, not the template.

---

## 8b. Build status (2026-06-26, worktree `worktree-writing-spec-plan-compile`, NOT shipped)

User signed off ("go for it" → "Full sequence incl. emitter synergy"). All steps tested; ds+dev
suites unaffected throughout.

- ✅ **Step 1 — `scripts/writing/writing_section_index.py`** (the deterministic Discover). 28/28
  (`tests/writing_section_index_test.py`), **blind-oracle parity PASSED** vs `tender_offers`
  (clean canonical match). Stale-approval catch fires live. Emits `precis/outline/bib` paths so the
  index is a complete DATA artifact.
- ✅ **Step 2 — engine reconciliation.** `writing-draft.js` + `writing-verify.js` consume
  `args.sectionIndex` (skip the LLM Discover), back-compat fallback retained. Both skills wired to
  compile + pass the index. 13/13 (`tests/writing-engine-discover.test.mjs`: no-LLM path, granularity
  bounce, back-compat).
- ✅ **Step 3 — guards reconciled to the shared parser.** New
  `hooks/writing-outline-executable-guard.py` (PreToolUse on `OUTLINE_REVIEWED.md`,
  `validate = build_index().violations`; deny on ⊇/granularity, allow+warn on stale approval).
  `writing-claim-id-guard.py` now BLOCKS drafts w/o a claim trace (warns on outlines — incremental).
  12/12 (`tests/writing_guards_test.py`).
- ✅ **Emitter synergy (born-canonical, the first instance to close the ds/dev emitter gap).**
  `writing-setup` OUTLINE.md template now emits the canonical `## Structure` (headings = filename
  stems) + `## Claim → Section Map`; `writing-outline` emits `implements: [CLAIM-XX]` frontmatter +
  a pinned source per claim. Tolerant parser is now a back-compat shim, not the primary path.
- ✅ **Step 4 — two-tier `gateProbe` deterministic floor** (`scripts/writing/writing_gate_probe.py`,
  closes audit G1). `{pass, evidence}`: bib-grep (`[@key]` vs `sources.bib`), `[CITE-NEEDED]`, claim
  trace; `dataProvenance` in **labeled consistency-only mode** (never overstates a remote-dataset
  number as verified). Wired into the writing-draft skill Step 4a before the semantic source-verify
  (4b). 13/13 (`tests/writing_gate_probe_test.py`), incl. real Part III (all `[@key]` resolve;
  numbers flagged consistency-only).
- ✅ **Gate-probe floor honesty (tender-parity A/B):** fixed legal-Bluebook-prose defects — statutory
  false positive (`§ 78mm`→phantom) via token-boundary lookahead + citation-context guard; spelled-out
  blind spot DISCLOSED (`spelledOutNotChecked` + numeric-only note) + magnitude-word normalization.
  Probe return now carries the canonical `scope:{checked,notChecked}` (D1 contract). 23/23.
- ✅ **PARITY PASSED (A/B on the real `tender_offers`, 2026-06-26).** Methodology: the confounded
  current-vs-compiled double-run was REJECTED (L1/L2/L3 are non-deterministic — a verdict diff couldn't
  be attributed to the compile change vs reviewer noise). Instead: section-set+order proven
  deterministically (oracle diff=0); downstream review code is byte-identical between paths; the only
  divergent variable is `precisClaim` form. **(A) focused `precisClaim` probe → BENIGN** (controlled
  output — `precisClaimAdvanced` + argument grasp — identical across bare-ids vs prose-gloss despite
  reviewer noise). **(B) end-to-end compiled `/writing-verify`** ran CLEAN on the real 12k-word paper:
  consumed `args.sectionIndex` (no LLM Discover), 5 sections, 22 agents, 0 unreliable, transitions+L3
  ran, JS substrate gate computed the verdict (9C/57M/44m, `substratePass=false`) — a genuine,
  project-aware review. Cross-validated (A)'s Part III outline-leaks. **Nuance (non-blocking):**
  `precisClaimAdvanced` flips run-to-run (reviewer noise, NOT an ids-vs-gloss effect) and is NOT
  gate-bearing → no ship impact; the optional `precisClaim` enrichment for echo-only sections is
  DEFERRED (would only matter if that field is ever made gate-bearing — no speculative build).
- ⏳ **SHIP (pending user go):** version bump 5.56.0 → 5.57.0 (minor; new scripts/hooks + engine
  reconcile, fully back-compat), commit, push, PR, merge worktree. *(Watch for a 5.57.0 collision with
  the wc-creator worktree; rebase to 5.58.0 if it merges first.)*

## 9. Honest bottom line

Writing is the farthest sibling and it shows: the ds/dev runner win is **already banked** (flat-
parallel fan-out, one invocation), so copying the compiled-`run.js` machinery would add pause/DAG/
recompile ceremony to a workflow that doesn't need it. The **real** writing port is **upstream of the
runner** — make the **outline a machine-executable, guarded spec** (the assessment's follow-up),
**compile away the one residual discovery-LLM** that masks drift, and **treat the gate as a two-tier
semantic fork** whose authority stays outside the runner and whose evidence is numbered. That closes
the two honesty gaps the audit found (G1 self-reported fidelity, G2 no shared parser/guard), respects
"don't rewrite where the shape works," and gives the eventual shared-core extraction its third,
most-divergent data point: a gate that is judgment + empirical, and a "compile" that emits data, not
code.
