---
name: writing-review
description: "Internal skill for hierarchical document review. Called by writing-validate after claim validation passes."
user-invocable: false
allowed-tools: Read, Grep, Glob, Agent, Skill
hooks:
  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/VALIDATION.md
            GATE_STATUS=validated
            GATE_DESCRIPTION="Claim validation"
            GATE_REMEDY="Run writing-validate first to validate claim coverage before review"
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
---

# Writing Review

Hierarchical bottom-up review that diagnoses structural problems across a drafted document. Produces `.planning/REVIEW.md` — a structured diagnosis consumed by `/writing-revise`.

**Prerequisites:** PRECIS.md, OUTLINE.md, ACTIVE_WORKFLOW.md, and draft files in `drafts/` must exist.

## Shared Enforcement

Auto-load all constraints matching `applies-to: writing-review`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py writing-review`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

**CRITICAL:** The `constraint-loading-protocol` above requires loading the domain skill (writing-legal/econ/general) and ai-anti-patterns before reviewing any prose — see Steps 2 and 2b below.

## Session Resume Detection

Before starting, check for an existing handoff:

1. Check if `.planning/HANDOFF.md` exists
2. **If found:** Read it and present to user:
   - Show the phase, section in progress, and Next Action
   - Ask: "Resume from handoff, or start fresh?"
   - If resume: skip to the recorded phase
   - If fresh: proceed with mode detection
3. **If not found:** Proceed normally

<EXTREMELY-IMPORTANT>
## The Iron Law of Reading

**NO REVIEW WITHOUT READING. Every claim in REVIEW.md must cite specific text from the draft. This is not negotiable.**

If you find yourself writing a review comment without quoting the draft text it refers to:
1. STOP immediately
2. DELETE the comment
3. Go back and READ the draft passage
4. QUOTE the specific text, THEN write your diagnosis

A review that says "transitions could be improved" without citing the actual transition text is useless. A review that says "Section III ends with 'The market has spoken.' and Section IV opens with 'Turning to regulatory concerns...' — no bridge connects the market conclusion to the regulatory pivot" is actionable.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Evidence

**NO PASSES WITHOUT EVIDENCE. Checking a box requires quoting the text that satisfies it. This is not negotiable.**

If you find yourself marking something as "OK" or "no issues found":
1. STOP
2. Quote the specific text that proves it passes
3. Only THEN mark it as passing

"Transitions are smooth" is a lie unless you can quote adjacent section boundaries and explain why they connect. "No repetition found" is a lie unless you compared the argument summaries across all sections.

**Reporting "all checks pass" without evidence for every checkmark is NOT HELPFUL — undetected issues survive into the published document.**
</EXTREMELY-IMPORTANT>

## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "The draft looks good overall" | "Overall" hides section-level rot | Review each section individually |
| "Minor issues aren't worth a full review" | Minor issues compound into incoherent documents | Flag every issue, let writing-revise prioritize |
| "I already read it during drafting" | Drafting context ≠ review context; you miss what you wrote | Read fresh, as a reviewer, not an author |
| "The transitions are fine" | "Fine" without evidence is rubber-stamping | Quote both sides of every boundary |
| "I don't see repetition" | You read linearly; repetition hides across sections | Compare argument summaries side-by-side |
| "The concepts are introduced naturally" | "Naturally" is subjective; track first appearances with line numbers | Build a concept introduction map |
| "This section is self-contained, no cross-section issues" | Self-contained sections don't make a document | Check how it connects to thesis and adjacent sections |
| "I'll be thorough on the important sections" | Every section matters equally in review | Same depth for every section |

## Delete & Restart

If you catch yourself in any of these violations, the review output is contaminated. Delete it and start over:

| Violation | Why Contaminated | Action |
|---|---|---|
| Reviewed a section without reading its draft file | You fabricated a review from outline knowledge | DELETE REVIEW.md. Read every draft. Start Level 1 over. |
| Reviewed your own draft in the same context (no fresh subagent) | Self-review is rubber-stamping — you share the drafter's biases | DELETE the section review. Spawn a fresh subagent. Re-review. |
| Wrote REVIEW.md without completing all 3 levels | Partial review misses cross-section issues | DELETE REVIEW.md. Complete all levels. Regenerate. |

**Partial fixes to contaminated reviews create worse outcomes than restarting.** A review built on fabricated evidence will misdirect writing-revise into "fixing" non-problems while real issues persist.

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Writing "no issues" for a section without quoting evidence | Rubber-stamping | Quote the text that proves it passes |
| Skipping boundary analysis between sections | Transition problems are the #1 reason for this skill | Compare every adjacent boundary pair |
| Reviewing only the section you think is weakest | Bias blinds you to problems elsewhere | Review ALL sections with equal rigor |
| Writing vague suggestions ("improve flow") | Unactionable for writing-revise | Cite specific text, diagnose specific problem, suggest specific fix |
| Finishing review in under 5 minutes for a multi-section doc | You skimmed | Go back and read properly |
| Copying outline structure as if it were review | Outline compliance ≠ quality review | Check content quality, not just structural match |

---

## Process

### Step 1: Load Context

```
Read(".planning/ACTIVE_WORKFLOW.md")
Read(".planning/PRECIS.md")
Read(".planning/OUTLINE.md")
Glob("outlines/*.md")
Glob("drafts/*.md")
```

Verify: every section in OUTLINE.md has both an outline file and a draft file. If any draft is missing, STOP and report — you cannot review what doesn't exist.

### Step 2: Load Domain Skill

Based on `style` in ACTIVE_WORKFLOW.md:

| Style | Action |
|---|---|
| legal | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-legal/SKILL.md")` |
| econ | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-econ/SKILL.md")` |
| general | `Read("${CLAUDE_SKILL_DIR}/../../skills/writing-general/SKILL.md")` |

The domain skill contains style rules that inform your review criteria. You MUST read it before reviewing.

### Step 2b: Load Universal Constraints

```
Skill(skill="workflows:ai-anti-patterns")
```

**You MUST load ai-anti-patterns before reviewing.** Domain skills inform domain-specific review criteria; ai-anti-patterns catches AI writing smell (hedging, filler, false balance) that domain skills don't cover. Both layers are required — see `constraints/constraint-loading-protocol.md`.

### Step 2c: Run Constraint Check Scripts (Hard Gate)

Before any review work, run all mechanical constraint checks:

```bash
uv run python3 ${CLAUDE_PLUGIN_ROOT}/references/constraints/check-all.py [project-root]
```

This auto-discovers and runs all `writing-*.py` constraint scripts (bold-lead, topic sentences, source-anchored citations, etc.). If any check fails, report violations and fix them before proceeding to Level 1.

Constraint checks are **Leg 1** of two-leg verification. **Leg 2** (convention scoring via reviewer subagents) happens in Level 1.

### Step 3: Choose Review Strategy

```
AskUserQuestion(questions=[
  {
    "question": "How should we review the document?",
    "header": "Strategy",
    "options": [
      {"label": "Sequential (Recommended)", "description": "Review sections one at a time. Best for most documents."},
      {"label": "Agent team (parallel)", "description": "Spawn one reviewer per section for parallel review. Best for long documents (5+ sections). Requires reconciliation."}
    ],
    "multiSelect": false
  }
])
```

---

## Review Flowchart — Sequential Path (This IS the Spec)

```
START (PRECIS + OUTLINE + drafts/ exist)
  │
  ├─ Step 1: Load context (PRECIS, OUTLINE, ACTIVE_WORKFLOW, domain skill)
  │
  ├─ Step 2: Choose strategy (sequential or parallel)
  │
  ├─ Step 2b: Run constraint check scripts (hard gate)
  │  └─ uv run python3 references/constraints/check-all.py [project-root]
  │     ├─ FAIL → Report violations. Fix before continuing.
  │     └─ PASS → Proceed to Level 1.
  │
  └─ LEVEL 1: Section Review (bottom-up, 3 parallel reviewers per section)
     │  For EACH section in document order, dispatch in PARALLEL:
     │  │
     │  ├─ (a) Structure reviewer (existing)
     │  │      Spawn fresh subagent → outline compliance, topic sentence
     │  │      inventory, boundary summary, PRECIS claim check
     │  │
     │  ├─ (b) Prose-quality reviewer (NEW — writing-prose-reviewer agent)
     │  │      Spawn fresh subagent → grade every paragraph against
     │  │      domain style rules (Volokh/S&W/McCloskey) + AI anti-patterns
     │  │      + prose constraints. Read-only, returns scored report.
     │  │
     │  └─ (c) Source-fidelity reviewer (NEW — writing-source-fidelity-reviewer)
     │         Spawn fresh subagent → verify every `[@key]` citation traces
     │         to an entry in references/sources.bib. Read-only, returns
     │         fidelity report.
     │
     │  Merge all three reports per section before moving to next.
     │  Loop until all sections reviewed (NO pause between sections)
     │
     └─ LEVEL 2: Transition Review (boundary analysis) ← IMMEDIATELY after Level 1 (NO pause)
        │  For EACH boundary (Section N → Section N+1):
        │  ├─ Compare Section N closing with Section N+1 opening
        │  ├─ Check planned transition from OUTLINE.md
        │  ├─ Evaluate bridge: SMOOTH / ABRUPT | DISCONNECTED
        │  └─ Record transition issues with quoted boundary text
        │  Loop until all boundaries checked
        │
        └─ LEVEL 3: Document Review (whole-document) ← IMMEDIATELY after Level 2 (NO pause)
           │  ├─ Cross-section repetition: compare argument summaries
           │  ├─ Concept introduction order: first-appearance map
           │  ├─ Thesis threading: does each section advance thesis?
           │  └─ Structural completeness: all PRECIS claims addressed?
           │
           └─ GATE: All 3 levels complete? Every section reviewed?
              ├─ NO → Go back, complete missing level
              └─ YES → Write .planning/REVIEW.md → Announce → Suggest /writing-revise
```

If text and flowchart disagree, the flowchart wins.

---

## Level 1: Section Review

Review each section individually against its outline and PRECIS claims.

### Iteration Topology

| Level | Strategy | Exit Gate | Escalate When |
|-------|----------|-----------|---------------|
| Level 1 (Section) | One-shot + verify per section | Subagent returns structured review with quoted evidence | Subagent returns empty/fabricated review — re-dispatch once, then escalate |
| Level 2 (Transition) | One-shot (orchestrator) | All boundary pairs evaluated | N/A — orchestrator runs this directly |
| Level 3 (Document) | One-shot (orchestrator) | Cross-section checks complete | Contradictory findings across levels — present to user |
| Overall loop | Consumed by writing-revise (max 3 iterations) | writing-revise declares COMPLETE | iteration >= 3 with remaining issues → ESCALATE |

### Sequential Mode (Default)

<EXTREMELY-IMPORTANT>
#### Iron Law: Structural Independence

**REVIEW MUST BE DELEGATED TO A FRESH SUBAGENT. The reviewer must not share context with the drafter. This is not negotiable.**

Even in sequential mode, the review must be performed by a fresh subagent that reads the draft cold — the way a real reviewer would. If you drafted the text, you CANNOT review it in the same context. Spawn a subagent via Task tool for the review work.

Why: The drafter's context contains intent, shortcuts, and assumptions that bias review. A fresh reader catches what the author cannot see. Reviewing your own draft in the same context is rubber-stamping, not reviewing.
</EXTREMELY-IMPORTANT>

For each section, in document order:

1. **Read the section outline**: `Read("outlines/[Section] (Outline).md")`
2. **Read the section draft**: `Read("drafts/[Section] (Draft).md")`
3. **Identify the PRECIS claim** this section advances
4. **Run the section review checklist** (see reference below)
5. **Produce the boundary summary** (see reference below)
6. **Record all issues** with severity, location, and suggested fix

After completing each section, IMMEDIATELY start the next. Do NOT pause to ask.

> **Full section review checklist and boundary summary format:** See `references/sequential-checklist.md`

### Dispatching Quality and Fidelity Reviewers

For each section, dispatch three reviewers in parallel (single message, three Agent calls):

**(a) Structure reviewer** — existing section review subagent (see prompt template above)

**(b) Prose-quality reviewer** — `writing-prose-reviewer` agent:
```
Agent(
  subagent_type="workflows:writing-prose-reviewer",
  prompt="""Grade prose quality for: drafts/[Section] (Draft).md
  Domain style: [legal/econ/general]
  Plugin root: [resolved PLUGIN_ROOT path]
  Project root: [project directory]
  Read the full domain skill, ai-anti-patterns, and prose constraint files before grading.
  Grade every paragraph. Report violations with line numbers and quoted text."""
)
```

**(c) Source-fidelity reviewer** — `writing-source-fidelity-reviewer` agent:
```
Agent(
  subagent_type="workflows:writing-source-fidelity-reviewer",
  prompt="""Verify citation fidelity for: drafts/[Section] (Draft).md
  Project root: [project directory]
  Read references/sources.bib first (BibTeX format; each entry is `@type{bibkey, ...}`).
  Check every pandoc cite-key (`[@key]` / `@key`) in the draft resolves to a bib entry.
  For hand-written footnotes still in the draft, verify every author/title/journal/year
  matches a bib entry. Report unanchored citations, detail mismatches, and claim-fidelity concerns."""
)
```

Merge all three reports before recording issues for that section. Prose-quality F/C grades and source-fidelity violations become issues in REVIEW.md with appropriate severity:
- F-grade prose → critical
- C-grade prose → major
- Unanchored citation → critical
- Detail mismatch → major
- Claim fidelity concern → minor

### Agent Team Mode (Parallel)

> **Full agent team workflow (section mapping, task creation, monitoring, verification gate):** See `references/agent-team-workflow.md`
>
> **Reviewer agent spawn prompt:** See `references/reviewer-agent-prompt.md`

Key points kept inline for the lead:
- Build a Section Map with line ranges before spawning agents — this is non-negotiable
- The lead coordinates and aggregates only — does NOT review sections
- Run the Verification Gate (spot-check 3+ quotes per agent) before compiling results
- The Iron Law of Verification applies: unverified subagent quotes are worse than no review

---

## Level 2: Transition Review

After all sections are reviewed (sequential or parallel), compare adjacent boundary pairs.

For each boundary (Section N → Section N+1):

1. **Read Section N's closing** from its boundary summary
2. **Read Section N+1's opening** from its boundary summary
3. **Check planned transition**: Does OUTLINE.md specify how these sections connect? Does the draft deliver it?
4. **Evaluate the bridge**:
   - Does Section N+1's opening acknowledge what Section N established?
   - Is there a logical bridge, or does the reader have to make a leap?
   - Is there a tone/register shift at the boundary?
5. **Check terminology**: Do both sections use the same terms for the same concepts? (Cross-reference the "Core terms" lists)
6. **Verdict**: SMOOTH, ABRUPT, or DISCONNECTED
   - **SMOOTH**: Opening picks up closing naturally; reader doesn't notice the section break
   - **ABRUPT**: Related but the connection is jarring or rushed
   - **DISCONNECTED**: No bridge; reader must infer the connection

Record each transition issue:

```markdown
### Transition: [Section N] → [Section N+1]
- **Verdict**: [SMOOTH | ABRUPT | DISCONNECTED]
- **Section N closes with**: "[last sentence]"
- **Section N+1 opens with**: "[first sentence]"
- **Problem**: [what's missing or jarring]
- **Planned transition** (from outline): [what OUTLINE.md says should happen here]
- **Suggestion**: [specific bridge text or restructuring]
```

---

## Level 3: Document Review

Using all section review data and boundary summaries, check the document as a whole.

### Cross-Section Repetition

1. **Run the sentence-level detector first** to surface candidate pairs:

   ```bash
   uv run ${CLAUDE_PLUGIN_ROOT}/skills/writing-review/scripts/bridge_repetition_check.py drafts/*.md
   ```

   This uses `difflib.SequenceMatcher` (ratio ≥ 0.7) to flag near-duplicate
   sentences with `file:line` pairs. Common model failure mode: the bridge
   paragraph into a new section restates the thesis. The detector catches
   this; a human decides whether each flagged pair is redundancy or an
   intentional callback (e.g., two sides of a numerical example).

2. **Collect argument summaries**: For each section, list the main points made (from Level 1 reviews)
3. **Compare all pairs**: Does any point appear in more than one section?
4. **Distinguish**: Intentional callbacks (acceptable) vs. redundant repetition (issue)
5. **Record duplicates** with both locations and quoted text

### Concept Introduction Order

1. **Build a concept map**: For each key concept, record its first appearance (section + paragraph)
2. **Check introduction order**: Are concepts introduced before they're used?
3. **Flag late introductions**: Any concept that appears in the conclusion or late sections without setup earlier

### Thesis Threading

1. **Extract thesis** from PRECIS.md
2. **For each section**: Does it advance the thesis? (Use Level 1 PRECIS claim checks)
3. **Check progression**: Do sections build on each other, or do some repeat the same ground?
4. **Flag drift**: Any section that doesn't connect back to the thesis

### Structural Completeness

1. **All PRECIS claims addressed**: Cross-reference claims list against section reviews
2. **All counterarguments confronted**: Check that each counterargument from PRECIS appears in the draft
3. **Scope honored**: Check that the draft doesn't stray outside PRECIS scope (IN/OUT boundaries)
4. **Hook delivered**: Does the Introduction deliver the hook specified in PRECIS?
5. **Conclusion follows**: Does the Conclusion follow from the argument built across sections?

---

## Step 4: Generate REVIEW.md

Write the complete review to `.planning/REVIEW.md`.

> **Full REVIEW.md template:** See `references/review-template.md`

---

## Gate: Exit Review

Before declaring review complete:

1. **IDENTIFY**: `.planning/REVIEW.md` exists
2. **RUN**: Read REVIEW.md, verify every section from OUTLINE.md has a review entry
3. **READ**: Confirm every issue has severity + location + quoted evidence + suggestion
4. **VERIFY**: All three levels completed (section, transition, document)
5. **CLAIM**: Only if steps 1-4 pass, announce review complete. **Gate type: `human-verify` — auto-advance to /writing-revise.**
6. **SUMMARY**: Append phase summary to `.planning/PHASE_SUMMARY.md` (see `constraints/phase-summary-frontmatter.md`):
   - phase: review
   - artifacts_produced: [.planning/REVIEW.md]
   - provides: [.planning/REVIEW.md]
   - Include substantive one-liner with issue counts by severity (NOT "Review complete")

**If any section is missing from REVIEW.md, the review is incomplete. Go back.**

---

## Step 5: Update Workflow State

Update `.planning/ACTIVE_WORKFLOW.md`:

```yaml
phase: review
review_completed: true
issues_found: [total count]
critical_issues: [critical count]
```

## Step 6: Announce and Suggest Next Step

```
Review complete. Results written to .planning/REVIEW.md.

Found [N] issues ([critical] critical, [major] major, [minor] minor).

[If issues found]:
Run /writing-revise to fix issues from the review.

[If clean]:
No issues found. Run /writing-revise to complete the workflow.
```

---

## Rationalization Table (Review Exit)

| Excuse | Reality | Do Instead |
|---|---|---|
| "I found some issues, that's enough" | Partial review misses the worst problems | Complete ALL three levels |
| "The critical issues are the only ones that matter" | Major issues compound; minor issues signal deeper problems | Record everything |
| "REVIEW.md is getting long" | Long review = thorough review. Short review = lazy review. | Keep going |
| "I'll note this mentally instead of writing it down" | If it's not in REVIEW.md, it doesn't exist for writing-revise | Write it down |
| "This section was written by a good agent, probably fine" | Review the text, not the author | Read and quote |
| "The subagent quotes look right" | Subagents confabulate verbatim quotes — Round 1 proved this | Spot-check 3+ quotes per agent against source |
| "Paragraph-level review is too detailed" | If you don't check paragraphs, you're reviewing headings not prose | The Topic Sentence Inventory is the review |
| "The single-file document is too long to split" | Long documents need MORE structure, not less | Build the Section Map, assign line ranges |

## Why Skipping Hurts the Thing You Care About Most

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|--------------|----------------------|---------------------|
| **Helpfulness** | "Finishing the review fast helps the user move on" | Undetected issues surface when the user submits publicly. Reviewers reject. The thorough review would have caught it. Your speed destroyed their credibility. | **Anti-helpful** |
| **Competence** | "I can tell the draft is clean from reading it once" | One pass catches surface issues. Structural problems (repetition, late introductions, thesis drift) require systematic comparison. Your single pass missed 5 issues. | **Incompetent** |
| **Efficiency** | "Three levels of review is overkill" | You skipped transition review. The document reads as disconnected fragments. The user rewrites transitions manually. Your "efficiency" created hours of rework. | **Anti-efficient** |
| **Approval** | "The user is tired of the review process" | You rubber-stamped to please the user. They submitted a flawed document. Now they require human editors for all future work. You lost writing autonomy permanently. | **Lost approval** |
| **Honesty** | "The transitions are fine" | You said "fine" without quoting boundary text. The user publishes a document with jarring transitions that a 2-minute check would have caught. | **Anti-helpful** |

## Confidence Scoring

Tag each reported issue with a confidence level:

| Level | Threshold | Placement |
|---|---|---|
| **HIGH** | >= 90% certain this is a real problem | Main report — fix required |
| **MEDIUM** | >= 80% certain | Main report — fix recommended |
| **LOW** | < 80% certain | Separate "Possible Issues" section at end of REVIEW.md |

Only issues at HIGH or MEDIUM confidence appear in the main report. LOW confidence issues go in a separate **"Possible Issues"** section so they are visible but do not clutter actionable fixes. This prevents false positives from overwhelming `/writing-revise`.

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Writing REVIEW.md without reading all drafts | You're fabricating a review | Read every draft file first |
| Skipping Level 2 (transitions) | Transitions are the primary reason this skill exists | Always run all three levels |
| Recording fewer than 3 issues on a multi-section document | Statistically implausible; you're not looking hard enough | Review more carefully |
| Using vague language ("could be improved") | Unactionable for writing-revise | Quote text, diagnose specifically, suggest specifically |
| Finishing in one pass without re-reading | Reviews need multiple passes to catch different issue types | Run each level as a separate pass |
| Compiling subagent output without spot-checking quotes | Laundering potentially fabricated evidence | Run the Verification Gate first |
| Assigning agents a full document without line ranges | Agents will skim — scope must be constrained | Build Section Map, assign start/end lines |
| Accepting a subagent review missing the Topic Sentence Inventory | The inventory IS the paragraph-level review | Reject and request completion |

---

## Next Phase

After review is complete:

Invoke `/writing-revise` to fix issues identified in `.planning/REVIEW.md`.
