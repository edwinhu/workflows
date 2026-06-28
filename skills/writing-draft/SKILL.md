---
name: writing-draft
description: Internal skill for expanding section outlines into prose. Called after section outlines are complete.
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Agent|Workflow"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/OUTLINE_REVIEWED.md
            GATE_STATUS=APPROVED
            GATE_BLOCKED_TOOLS=Write,Edit,Agent,Workflow
            GATE_DESCRIPTION="Outline review"
            GATE_REMEDY="Return to writing-outline and run the outline reviewer before drafting"
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
    - matcher: "Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-outline-guard.py"
    - matcher: "Workflow"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-mechanical-gate.py"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-suggest-verify.py"
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-claim-id-guard.py"
---

# Writing Draft

Expand detailed section outlines into prose via the `writing-draft` ultracode workflow — one write-agent per section, in parallel — applying domain-specific style rules. The skill owns the gate, the `/goal` loop, and the mandatory source-verify; the workflow owns the per-section fan-out + JS gate.

**Prerequisites:** PRECIS.md, OUTLINE.md, ACTIVE_WORKFLOW.md, and at least one section outline in `outlines/` must exist.

## Shared Enforcement

Auto-load all constraints matching `applies-to: writing-draft` (includes constraint-loading-protocol, source-anchored-citations, no-bold-lead, topic-sentences, and all shared writing constraints):

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py writing-draft`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

**CRITICAL:** The `constraint-loading-protocol` above requires loading the domain skill (writing-legal/econ/general) and ai-anti-patterns before writing any prose — see Step 2 below.

## Draft Flowchart (This IS the Spec)

Drafting is a **ultracode TRANSFORM workflow**, not hand-drafting. The skill keeps the gate, the `/goal` loop, and the mandatory source-verify; the `writing-draft` workflow owns the per-section fan-out (one write-agent per section, in parallel) and computes the gate in JS. The outline is the spec; each write-agent EXPANDS its section's outline into prose — adding only local prose craft, citations from real sources, and the bridges to neighbors.

```
START (all section outlines in outlines/ exist, OUTLINE_REVIEWED.md APPROVED)
  │
  ├─ Step 1: Load context (PRECIS, OUTLINE, ACTIVE_WORKFLOW) + constraints
  │
  ├─ Step 2: Run the writing-draft WORKFLOW (discover → transform → verify → gate)
  │  ├─ Discover: enumerate sections; STRUCTURE gate (paragraph-granular? else bounce to outline)
  │  ├─ Transform: one write-agent per section — expands outline → prose, cites REAL sources
  │  │             (never fabricates; honest [CITE-NEEDED] when unsourceable), writes bridges from
  │  │             the adjacent OUTLINES (no dependency on sibling drafts)
  │  ├─ Verify (read-only): coverage (every point) + fidelity (every cite resolves) + transitions
  │  └─ Gate (JS): result.overallPass = every section drafted + substrate clean
  │
  ├─ Step 3: Read the gate, drive the /goal loop
  │  ├─ underGranular non-empty → STOP, bounce those outlines to writing-outline
  │  ├─ overallPass=false → /goal loop: re-invoke (onlyChecks=sectionsThatFailed) + fix findings
  │  └─ overallPass=true → proceed
  │
  ├─ Step 4: MANDATORY full source-verify (deep quote-fidelity; resolve every [CITE-NEEDED])
  │
  └─ GATE: workflow overallPass=true AND source-verify clean?
     ├─ NO → keep the /goal loop running (no pause)
     └─ YES → write DRAFT_COMPLETE.md → Load writing-validate → /writing-review
```

If text and flowchart disagree, the flowchart wins.

<EXTREMELY-IMPORTANT>
## The Iron Law of Drafting

**NO PROSE WITHOUT OUTLINE. Every section must have a detailed outline in `outlines/` BEFORE you write prose for it. This is not negotiable.**

If you find yourself drafting without a matching outline file:
1. STOP immediately
2. DELETE what you wrote
3. Create the outline first using writing-outline
4. THEN draft the prose

Writing without an outline produces incoherent, wandering prose that requires complete rewriting.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Substance Coverage

**Reporting a section complete when an outline point's CLAIM is missing is NOT HELPFUL — reviewers catch the gap. But "covered" means the claim is MADE, NOT that every point got its own paragraph.**

Before claiming a section is drafted, check SUBSTANCE, not paragraph-count:
1. Open the outline. Is every point's CLAIM actually made in the prose — developed in proportion to its weight (a minor point may be a clause; a pivotal one several paragraphs)?
2. Is every mapped evidence item used where its claim needs it?
3. Read the topic sentences in order — do they carry the argument?

A DROPPED point or subsection (its claim absent/unsupported) means the section is NOT complete. Do NOT check for one-paragraph-per-point or a word-count target — proportional brevity is correct coverage, not a gap. The outline is a contract for the CLAIMS, not for uniform length.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Proportional Depth

**EACH CLAIM GETS THE DEVELOPMENT ITS WEIGHT EARNS — no more, no less. TWO failure modes, both forbidden:**

1. **STUB** — dropping a point, or writing a section so thin its claims aren't actually made/supported. Reward-hacking completion.
2. **FLAT PADDING** — giving every point its own same-length paragraph to "look complete." This is the uniform one-paragraph-per-point tell: it reads machine-made (low burstiness) and is exactly what makes Claude's law-review prose stilted while its op-eds read fine.

Each section must:
- Make every outline point's CLAIM and support it (no stub)
- Develop each claim **in proportion to its weight**; vary paragraph and sentence length deliberately
- Lead each unit with its topic sentence; keep subsection transitions as explicit bridges
- NOT chase a word-count target — length follows the argument, not a quota

If you catch yourself giving every point an identical paragraph, STOP — you are padding to a template. If a section's claims aren't actually made, STOP — you are stubbing. Aim for proportional, topic-sentence-led prose a person would actually write.
</EXTREMELY-IMPORTANT>

## Session Resume Detection

Before starting, check for an existing handoff:

1. Check if `.planning/HANDOFF.md` exists
2. **If found:** Read it and present to user:
   - Show the phase, section in progress, and Next Action
   - Ask: "Resume from handoff, or start fresh?"
   - If resume: skip to the recorded section
   - If fresh: proceed normally
3. **If not found:** Proceed normally

## Process

### Step 1: Load Context

```
Read(".planning/ACTIVE_WORKFLOW.md")
Read(".planning/PRECIS.md")
Read(".planning/OUTLINE.md")
```

### Step 2: Load Domain Skill

The workflow's write-agents apply the domain style rules per-section (the workflow resolves the domain skill itself). Load it here too so you can judge the `/goal` loop's output and enforce the export template (legal `.docx`). Based on `style` in ACTIVE_WORKFLOW.md, load the domain skill (relative to this skill's base directory):

| Style | Action |
|---|---|
| legal | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-legal/SKILL.md")` |
| econ | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-econ/SKILL.md")` |
| general | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-general/SKILL.md")` |

<EXTREMELY-IMPORTANT>
### Legal Domain: MUST Load Full Skill

When `style: legal` is detected:

1. **MUST Read the full skill file:**
   Discover path: `${CLAUDE_SKILL_DIR}/../../skills/writing-legal/SKILL.md`, then `Read()` the output.

2. **MUST use template for .docx export:**
   ```
   ${CLAUDE_SKILL_DIR}/../../skills/writing-legal/templates/law_review_template.docx
   ```

3. **Iron Laws from writing-legal:**
   - NO DOCX WITHOUT TEMPLATE - Copy template first, then add content
   - NO CLAIM WITHOUT COUNTERARGUMENTS - Confront objections
   - NO SECONDARY CITATIONS - Read original sources

**If you create a legal docx without reading the skill and using the template, DELETE IT and START OVER.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
### Econ Domain: MUST Load Full Skill

When `style: econ` is detected:

1. **MUST Read the full skill file:**
   Discover path: `${CLAUDE_SKILL_DIR}/../../skills/writing-econ/SKILL.md`, then `Read()` the output.

2. **Iron Laws from writing-econ:**
   - NO BOILERPLATE - Delete "This paper discusses...", roadmap paragraphs
   - NO ELEGANT VARIATION - One concept = one word, always
   - HOOK WITH FINDING - Start with compelling result, not background

3. **Delete & Restart triggers:**
   - "This paper discusses..." → DELETE, start with finding
   - Table-of-contents paragraph → DELETE
   - "As we shall see..." → DELETE

**If you write boilerplate in an econ paper, DELETE THE SECTION and START OVER with a hook.**
</EXTREMELY-IMPORTANT>

### Step 2b: Load Universal Constraints

```
Skill(skill="workflows:ai-anti-patterns")
```

**You MUST load ai-anti-patterns before drafting.** Domain skills catch domain-specific issues; ai-anti-patterns catches AI writing smell (hedging, filler, false balance, weasel words). Both layers are required — see `constraints/constraint-loading-protocol.md` for why.

### Step 3: Run the writing-draft workflow + drive the /goal loop

Drafting is the `writing-draft` **ultracode workflow** — do NOT hand-draft sections in this session, and do NOT spawn your own per-section agents.

**First COMPILE the deterministic section index** (the writing analog of ds/dev's compile step — it replaces the workflow's LLM `Discover` with a regex-parse of the approved planning artifacts, so the section set/order/file-pairing/claim-map can't drift). Run it and read the JSON:

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_section_index.py "<project root>" > .planning/section-index.json
```

Read `.planning/section-index.json`. If `ok` is true, pass the parsed object as `sectionIndex` (below). If it has `violations` (e.g. a section's `draft.implements` is missing a primary claim the OUTLINE.md Claim→Section Map assigns, or `staleApproval` flags a `*_REVIEWED.md` whose claim/Part count disagrees with the live OUTLINE.md), **STOP and surface them** — these are spec-integrity failures (the writing analog of a stale gate), fixed in writing-outline/-setup, not papered over. If the script errors entirely, omit `sectionIndex` and the workflow falls back to its LLM Discover (back-compat).

Then invoke it once over the whole document:

```
Workflow(name="writing-draft", args={
  "projectDir": "<absolute path to the writing project root (cwd)>",
  "pluginRoot": "<absolute path to this plugin's workflows/ dir — resolve ${CLAUDE_SKILL_DIR}/../../workflows>",
  "outputSubdir": "drafts",
  "sectionIndex": <the parsed .planning/section-index.json object, or omit to use the LLM Discover>
})
```

It discovers the sections (deterministically when `sectionIndex` is passed), asserts each outline is paragraph-structured, fans out one write-agent per section (each EXPANDS its outline → prose, cites real sources, writes bridges from the adjacent outlines), verifies coverage + citation-resolvability + transitions, and returns `{ overallPass, substratePass, verdict, scoreTable, sections, findings, underGranular, sectionsThatFailed, reviews }`. **The gate is computed in JS from raw counts — never self-report it.**

**Read the result and act:**

1. **`underGranular` non-empty** → STOP. Those outlines lack paragraph-level structure (or are placeholders like "TBA"). Do NOT draft them conversationally as a workaround — return to `writing-outline`, deepen them to paragraph level, re-run the outline reviewer, then re-invoke this workflow. *(This is the executable-spec gate: an under-detailed outline is fixed in outlining, not papered over at draft time.)*

2. **`overallPass=false`** (sections drafted but failing coverage / citation-resolvability / transitions) → drive convergence with the native `/goal` primitive. A separate evaluator gates exit on `result.overallPass`, so the agent that drafts isn't the one that judges:

   ```
   /goal The writing-draft workflow returns result.overallPass=true (every OUTLINE section drafted, coverage clean, every citation resolves to a real source with no [CITE-NEEDED] left, transitions connect) AND source-verify is clean. Stop after 8 turns.
   ```

   Each turn under the active goal: read the latest `findings`, fix them (resolve a `[CITE-NEEDED]` by finding the real source or cutting the claim; expand a cursory section; repair a seam), then re-invoke the workflow with `onlyChecks: result.sectionsThatFailed` + `priorReviews: result.reviews` (re-drafts only the failed sections, carries the rest). End the turn so the evaluator re-checks. Do NOT pause to ask "continue?" — the evaluator decides.

3. **`overallPass=true`** → proceed to Step 4.

**The JS gate is authoritative.** Do not hand-wave it to true; fix a finding and let the next run recompute. Per-section minor prose nits are advisory here — document-quality polish is `/writing-review`'s job, not the draft gate's.

### Step 4: gate the citations — deterministic floor THEN semantic source-verify (two-tier)

Writing's citation gate is **two-tier** (DESIGN §4). Run the deterministic floor FIRST (it cannot be gamed and is nearly free), then the semantic authority:

**4a — Deterministic floor (`{pass, evidence}`, mechanical).** For each `drafts/*.md`, run the gate probe — it greps every `[@key]` against `sources.bib` (closes the old "fidelity asserted, not checked" gap), flags any `[CITE-NEEDED]` left, confirms a `CLAIM-XX` trace, and reports number-vs-PRECIS drift in **labeled `consistency-only` mode** (it does NOT claim true dataset provenance when the parquet is remote/absent):

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_gate_probe.py \
  "drafts/<Section> (Draft).md" --bib references/sources.bib --precis .planning/PRECIS.md --outline .planning/OUTLINE.md
```

`pass:false` (an unresolved `[@key]`, a leftover `[CITE-NEEDED]`, or no claim trace) → feed the named `evidence` into the Step-3 `/goal` loop and re-draft that section; do NOT proceed. `dataProvenance.unmatchedVsSpec` is **advisory** (consistency-only) — review the listed numbers, but it never blocks on its own; numbers whose only source is a remote dataset are **unverifiable locally** and must not be reported as verified.

**4b — Semantic authority (the real correctness check).** The floor is necessary, not sufficient. It confirms a cite *resolves*; it does NOT confirm the quoted text appears in the source or that the source supports the claim. Run the deep check:

```
Skill(skill="workflows:source-verify")
```

source-verify checks every citation against the bibliography and verifies quotes against the source documents — resolving any remaining `[CITE-NEEDED]`, catching mis-attribution and quote drift. **A draft is not complete until BOTH `result.overallPass=true` AND source-verify is clean.** If source-verify surfaces an unresolved or mis-attributed citation, feed it back into the Step-3 `/goal` loop (re-draft that section with the correct source) — never write `DRAFT_COMPLETE.md` with an unverified citation.

After the workflow returns `overallPass=true`, record state in `.planning/ACTIVE_WORKFLOW.md` (`phase: draft`, `sections_drafted: [...]`, `edits_since_verify: 0`).

---

## Gate: Exit Draft

Before proceeding to edit/verify (see `constraints/gate-function-standard.md` for the full 6-step gate including SUMMARY):

1. **IDENTIFY**: The `writing-draft` workflow result (Step 3) + the source-verify result (Step 4)
2. **RUN**: Re-read `result.overallPass` and the source-verify outcome — do not re-derive by hand; the workflow already listed `drafts/`, checked coverage, and resolved citations in JS
3. **READ**: Confirm `result.underGranular` is empty (no outline bounced) and `result.findings` has no unresolved blocking entry
4. **VERIFY**: `result.overallPass === true` (every section drafted, coverage + citation-resolvability + transitions clean) AND source-verify is clean (quotes match sources, no `[CITE-NEEDED]` left)
5. **CLAIM**: Only if steps 1-4 pass, write the gate artifact, THEN proceed to writing-validate. writing-validate's PreToolUse hook blocks until this file exists — the artifact certifies every OUTLINE section has a substantive, citation-verified draft:

   ```bash
   mkdir -p .planning && cat > .planning/DRAFT_COMPLETE.md <<EOF
   ---
   status: APPROVED
   gate: draft
   sections: ${SECTION_COUNT:-all}
   ---
   Draft gate passed: every OUTLINE.md section has a drafts/ file with substantive content covering all outline points (not cursory stubs).
   EOF
   ```

   **Gate type: `human-verify` — auto-advance to writing-validate.** Do not write `status: APPROVED` while any section is a cursory stub — the artifact is the contract that drafting is genuinely complete.
6. **SUMMARY**: Append phase summary to `.planning/PHASE_SUMMARY.md` (see `constraints/phase-summary-frontmatter.md`):
   - phase: draft
   - artifacts_produced: [list all drafts/*.md files created]
   - implements: [CLAIM-XX ids the drafted sections advance — the requirement→phase trace]
   - provides: [drafts/*.md]
   - deviations: {r1: X, r2: Y, r3: Z, r4: W}
   - Include substantive one-liner (NOT "Drafting complete")

**Reporting "all sections drafted" without checking each file is NOT HELPFUL — the user moves to review with missing sections that force a return to drafting.** You must verify every draft exists and has real content.

### Handling failed sections (inside the /goal loop)

These govern how the **Step-3 `/goal` loop** responds to the workflow's per-section `findings` — the workflow drafts and verifies; this loop fixes and re-invokes. Map each finding to an action, then re-invoke with `onlyChecks: result.sectionsThatFailed`:

| Finding type | Action on re-invoke |
|-------------|---------------------|
| **Coverage** (a point's CLAIM is missing/unsupported — a dropped point, not mere brevity) | The point's claim wasn't made. Re-invoke that section; if its claim keeps coming back unsupported, the outline point may lack substance → R2/R4. (Do NOT treat proportional brevity as a coverage gap.) |
| **Fidelity** (`[CITE-NEEDED]` / unresolvable cite) | Find the real source (bib / Paperpile / a search) and supply it, or cut the claim. NEVER let the loop "resolve" it by inventing a cite. |
| **Transition** (seam, dangling reference) | The adjacent-outline bridge broke. Re-invoke the section; if two sections genuinely don't connect, that's an outline-order issue → R4. |
| **Structureless** (`underGranular`) | Not fixable in the loop — STOP and bounce the outline to `writing-outline`. |

Re-invoke WITHOUT pausing — the `/goal` evaluator re-checks `result.overallPass` and refires until clean or the turn budget elapses.

**The workflow's coverage check enforces SUBSTANCE mechanically** — a section that DROPS a point's claim fails coverage and the gate won't pass; proportional brevity does NOT (a minor point folded into a clause is covered). You do not need a separate per-section self-check; the JS gate checks claims-made, not paragraph-count.

---

## Progress Gating

**If 5+ iterations on the same section without meaningful progress, STOP and escalate to the user for scope adjustment.**

Signs you are stuck:
- Redrafting the same section repeatedly without quality improvement
- Failing the gate check on the same points across iterations
- Outline points that resist expansion (evidence may be insufficient)
- Section keeps growing without advancing the PRECIS claim

When escalating, present:
- What you've tried (briefly)
- Where the section is stuck
- Options: simplify the section, return to outline phase, merge with adjacent section, or gather more sources

**Spinning without progress is anti-helpful.** Five iterations is the threshold for asking the user if scope needs adjustment.

## Deviation Rules

When drafting reveals unplanned issues, follow this 4-rule system:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Factual Error** | Wrong fact, misattribution, incorrect citation, anachronism, wrong date/name | Fix → verify against source → track `[Rule 1 - Factual]` | Auto |
| **R2: Missing Evidence** | Claim without citation, unsupported assertion, missing example, evidence gap | Add evidence/citation → track `[Rule 2 - Evidence]` | Auto |
| **R3: Structural Blocker** | Missing section referenced by another, broken cross-reference, orphaned footnote, missing transition | Fix blocker → track `[Rule 3 - Structural]` | Auto |
| **R4: Argument Restructuring** | Claim order needs changing, thesis angle needs adjustment, major section add/remove, argument flow fundamentally broken | **STOP** → present to user → may require `.planning/OUTLINE.md` revision → track `[Rule 4 - Restructuring]` | **Ask user** |

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4.

**Edge cases:**
- Missing footnote for existing claim → R2 (add evidence)
- Entire section doesn't fit the argument → R4 (restructuring)
- Cross-reference to nonexistent section → R3 (structural blocker)
- Claim contradicts evidence found during drafting → R4 (argument restructuring)
- Typo in citation → R1 (factual error)
- Section too long, needs splitting → R3 (structural) unless it changes the argument flow → R4

**Tracking format per section:**
Each section's draft summary should include:
**Deviations:** N auto-fixed (R1: X, R2: Y, R3: Z). **R4 escalations:** [list or "none"].

## Red Flags

- About to draft a section without reading its outline file → STOP. The prose drifts from structure; read the outline first.
- About to write multiple sections simultaneously → STOP. Focus splinters, transitions slip, treatment goes cursory — one section at a time.
- About to write prose without the domain style rules loaded → STOP. The output is generic register instead of the document's; load the domain skill.
- About to skip the PRECIS cross-reference → STOP. A section that advances no claim is filler; check which claim it serves.
- About to pause after one section to ask the user → STOP. That breaks momentum and context; continue to the next section immediately.
- About to give every outline point its own identical-length paragraph → STOP. Uniform one-paragraph-per-point reads machine-made (flat rhythm); develop each claim in proportion to its weight. (The opposite failure — dropping a point's claim entirely — is a stub; cover every claim.)
- About to skip evidence mapped in the outline → STOP. Claims without evidence are assertions, not arguments; develop every item in prose.

---

## Next Phase

After all sections are drafted:

Read `${CLAUDE_SKILL_DIR}/../../skills/writing-validate/SKILL.md` and follow its instructions. Follow its instructions to validate claim coverage before review.
