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
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-suggest-verify.py"
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-claim-id-guard.py"
---

# Writing Draft

Expand detailed section outlines into prose via the `writing-draft` dynamic workflow — one write-agent per section, in parallel — applying domain-specific style rules. The skill owns the gate, the `/goal` loop, and the mandatory source-verify; the workflow owns the per-section fan-out + JS gate.

**Prerequisites:** PRECIS.md, OUTLINE.md, ACTIVE_WORKFLOW.md, and at least one section outline in `outlines/` must exist.

## Shared Enforcement

Auto-load all constraints matching `applies-to: writing-draft` (includes constraint-loading-protocol, source-anchored-citations, no-bold-lead, topic-sentences, and all shared writing constraints):

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py writing-draft`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

**CRITICAL:** The `constraint-loading-protocol` above requires loading the domain skill (writing-legal/econ/general) and ai-anti-patterns before writing any prose — see Step 2 below.

## Draft Flowchart (This IS the Spec)

Drafting is a **dynamic TRANSFORM workflow**, not hand-drafting. The skill keeps the gate, the `/goal` loop, and the mandatory source-verify; the `writing-draft` workflow owns the per-section fan-out (one write-agent per section, in parallel) and computes the gate in JS. The outline is the spec; each write-agent EXPANDS its section's outline into prose — adding only local prose craft, citations from real sources, and the bridges to neighbors.

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
## The Iron Law of Draft Completeness

**Reporting sections complete without verifying every outline point was expanded is NOT HELPFUL — the user publishes a draft with gaps that reviewers catch.**

Before claiming a section is drafted:
1. Open the outline file for that section
2. Check off EVERY subsection point — is it in the prose?
3. Check off EVERY evidence item — is it cited in the prose?
4. Check the word count — does it match the outline's estimate?

If ANY point or evidence is missing, the section is NOT complete. Saying "draft done" when outline points were skipped wastes the user's time — they discover gaps during review that should never have survived drafting. The outline is a contract; the draft must fulfill it.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Depth

**EACH SECTION DESERVES FULL ATTENTION. Do not rush through sections to "finish" the draft. This is not negotiable.**

The failure mode: a single agent writes cursory 2-paragraph versions of every section to reach "draft complete" as fast as possible. This is reward hacking - optimizing for the appearance of completion without the substance.

Each section must:
- Expand EVERY point from the outline (not a subset)
- Include EVERY piece of evidence mapped in the outline
- Develop transitions between subsections
- Meet the word count target from the outline

If you catch yourself writing a section significantly shorter than the outline implies, STOP. You are being cursory. Go back to the outline and expand every point.
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

Drafting is the `writing-draft` **dynamic workflow** — do NOT hand-draft sections in this session, and do NOT spawn your own per-section agents. Invoke it once over the whole document:

```
Workflow(name="writing-draft", args={
  "projectDir": "<absolute path to the writing project root (cwd)>",
  "pluginRoot": "<absolute path to this plugin's workflows/ dir — resolve ${CLAUDE_SKILL_DIR}/../../workflows>",
  "outputSubdir": "drafts"
})
```

It discovers the sections, asserts each outline is paragraph-structured, fans out one write-agent per section (each EXPANDS its outline → prose, cites real sources, writes bridges from the adjacent outlines), verifies coverage + citation-resolvability + transitions, and returns `{ overallPass, substratePass, verdict, scoreTable, sections, findings, underGranular, sectionsThatFailed, reviews }`. **The gate is computed in JS from raw counts — never self-report it.**

**Read the result and act:**

1. **`underGranular` non-empty** → STOP. Those outlines lack paragraph-level structure (or are placeholders like "TBA"). Do NOT draft them conversationally as a workaround — return to `writing-outline`, deepen them to paragraph level, re-run the outline reviewer, then re-invoke this workflow. *(This is the executable-spec gate: an under-detailed outline is fixed in outlining, not papered over at draft time.)*

2. **`overallPass=false`** (sections drafted but failing coverage / citation-resolvability / transitions) → drive convergence with the native `/goal` primitive. A separate evaluator gates exit on `result.overallPass`, so the agent that drafts isn't the one that judges:

   ```
   /goal The writing-draft workflow returns result.overallPass=true (every OUTLINE section drafted, coverage clean, every citation resolves to a real source with no [CITE-NEEDED] left, transitions connect) AND source-verify is clean. Stop after 8 turns.
   ```

   Each turn under the active goal: read the latest `findings`, fix them (resolve a `[CITE-NEEDED]` by finding the real source or cutting the claim; expand a cursory section; repair a seam), then re-invoke the workflow with `onlyChecks: result.sectionsThatFailed` + `priorReviews: result.reviews` (re-drafts only the failed sections, carries the rest). End the turn so the evaluator re-checks. Do NOT pause to ask "continue?" — the evaluator decides.

3. **`overallPass=true`** → proceed to Step 4.

**The JS gate is authoritative.** Do not hand-wave it to true; fix a finding and let the next run recompute. Per-section minor prose nits are advisory here — document-quality polish is `/writing-review`'s job, not the draft gate's.

### Step 4: Mandatory source-verify (the citation gate)

The workflow's verify stage confirms each citation *resolves* (the source exists / the cite is well-formed). It does NOT confirm the quoted text actually appears in the source. Before declaring the draft complete, run the deep check:

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
   - provides: [drafts/*.md]
   - deviations: {r1: X, r2: Y, r3: Z, r4: W}
   - Include substantive one-liner (NOT "Drafting complete")

**Reporting "all sections drafted" without checking each file is NOT HELPFUL — the user moves to review with missing sections that force a return to drafting.** You must verify every draft exists and has real content.

### Handling failed sections (inside the /goal loop)

These govern how the **Step-3 `/goal` loop** responds to the workflow's per-section `findings` — the workflow drafts and verifies; this loop fixes and re-invokes. Map each finding to an action, then re-invoke with `onlyChecks: result.sectionsThatFailed`:

| Finding type | Action on re-invoke |
|-------------|---------------------|
| **Coverage** (missing/cursory outline points) | The outline point wasn't expanded. Re-invoke that section; if it keeps coming back cursory, the outline point may lack substance → R2/R4. |
| **Fidelity** (`[CITE-NEEDED]` / unresolvable cite) | Find the real source (bib / Paperpile / a search) and supply it, or cut the claim. NEVER let the loop "resolve" it by inventing a cite. |
| **Transition** (seam, dangling reference) | The adjacent-outline bridge broke. Re-invoke the section; if two sections genuinely don't connect, that's an outline-order issue → R4. |
| **Structureless** (`underGranular`) | Not fixable in the loop — STOP and bounce the outline to `writing-outline`. |

Re-invoke WITHOUT pausing — the `/goal` evaluator re-checks `result.overallPass` and refires until clean or the turn budget elapses.

**The workflow's coverage check enforces depth mechanically** — a 2-paragraph section under a 5-subsection outline fails coverage and the gate won't pass. You do not need a separate per-section self-check; the JS gate is the check.

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

## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "I'll outline in my head, no file needed" | Mental outlines produce wandering prose | Write the outline file first |
| "This section is short, outline is overkill" | Short sections still need structure | Write a brief outline, then expand |
| "I'll draft all sections at once for flow" | Monolithic drafting loses focus and depth | One section at a time, verify each |
| "The outline is close enough to prose already" | Outlines organize; prose argues | Expand with evidence and transitions |
| "I'll fix the structure in editing" | Structural problems in drafts compound | Get structure right in outline, before prose |
| "This doesn't match the outline but it's better" | Unplanned deviations are usually rationalizations | Update outline first, then draft to match |
| "I'll write a quick version now and expand later" | "Later" means never. Cursory drafts stay cursory. | Write it properly the first time |
| "The user just wants to see something fast" | Fast garbage requires more rework than slow quality | Invest in depth now, save rework later |
| "This section only needs 2 paragraphs" | If the outline has 5 subsections, 2 paragraphs is cursory | Match the depth the outline implies |
| "I can skip the evidence for now" | Evidence-free claims are assertions, not arguments | Include every piece of evidence from the outline |

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Drafting without reading the section outline | Prose will drift from structure | Read outline first, always |
| Writing multiple sections simultaneously | Lose focus, miss transitions, cursory treatment | One section at a time |
| Ignoring domain style rules | Generic prose instead of appropriate register | Load and follow domain skill |
| Skipping the PRECIS cross-reference | Section may not advance the argument | Check which claim this section serves |
| Stopping after one section to ask user | Breaks momentum and context | Continue to next section immediately |
| Writing a section in 2 paragraphs when outline has 5 subsections | You are being cursory to "finish" faster | Expand every subsection properly |
| Skipping evidence mapped in the outline | Claims without evidence are assertions | Include all evidence, developed in prose |

## Why Skipping Hurts the Thing You Care About Most

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|--------------|----------------------|---------------------|
| **Helpfulness** | "Finishing the draft fast helps the user" | Cursory drafts create 3x the rework. Every skipped outline point becomes a revision cycle. Your speed produced waste. | **Anti-helpful** |
| **Competence** | "I know the domain style rules" | You didn't load the domain skill. The prose reads as generic AI output. Reviewers will flag every paragraph. Your confidence was incompetence. | **Incompetent** |
| **Efficiency** | "Outlining is overkill for a short section" | The section wandered without structure. You rewrote it twice. The 5-minute outline would have saved 30 minutes. Your "efficiency" was a 6x slowdown. | **Anti-efficient** |
| **Approval** | "The user wants to see progress" | You showed a cursory draft. The user sees thin prose and loses confidence in the workflow. Next time they'll micromanage every section. You lost autonomy. | **Lost approval** |
| **Honesty** | "I expanded the outline points" | You skipped 3 of 5 subsections. The user discovers gaps during review — your shortcut created rework they trusted you to prevent. | **Anti-helpful** |

---

## Next Phase

After all sections are drafted:

Read `${CLAUDE_SKILL_DIR}/../../skills/writing-validate/SKILL.md` and follow its instructions. Follow its instructions to validate claim coverage before review.
