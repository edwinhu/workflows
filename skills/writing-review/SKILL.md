---
name: writing-review
description: "Internal skill for hierarchical document review. Called by writing-validate after claim validation passes."
user-invocable: false
disable-model-invocation: true
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

**The writing-review workflow now enforces this structurally:** every reviewer it dispatches must attach a verbatim `quote` + `file:line` to each issue, so a review without reading cannot be produced.
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

**The writing-review workflow now enforces this structurally:** its reviewers return quoted evidence per finding, and a mechanical Verify stage confirms each quote resolves to the draft — fabricated or misattributed quotes are dropped before they reach REVIEW.md. Evidence-grounding is no longer honor-system; it is built into the workflow.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Iron Law: Structural Independence

**REVIEW MUST BE PERFORMED BY FRESH SUBAGENTS THAT DO NOT SHARE CONTEXT WITH THE DRAFTER. This is not negotiable.**

The drafter's context contains intent, shortcuts, and assumptions that bias review. A fresh reader catches what the author cannot see. Reviewing your own draft in the same context is rubber-stamping, not reviewing.

**The writing-review workflow now guarantees this by construction:** it always dispatches fresh reviewer subagents (structure, prose, fidelity) that read each draft cold. You do not — and must not — review draft prose in the main conversation yourself.
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
uv run python3 ${CLAUDE_SKILL_DIR}/../../references/constraints/check-all.py [project-root]
```

This auto-discovers and runs all `writing-*.py` constraint scripts (bold-lead, topic sentences, source-anchored citations, etc.). If any check fails, report violations and fix them before proceeding to Level 1.

Constraint checks are **Leg 1** of two-leg verification. **Leg 2** (convention scoring via reviewer subagents) happens in Level 1.

---

## Run the writing-review workflow

The review is **always parallel** and is owned by a dynamic workflow script — you do NOT choose a strategy and you do NOT dispatch reviewers yourself. The workflow runs all three levels (per-section structure + prose + fidelity fan-out, mechanical quote-verification, transition analysis, and whole-document checks) in the background and returns structured findings.

**1. Resolve the cached workflow path:**

```bash
WF=$(command ls -d ~/.claude/plugins/cache/*/workflows/*/workflows/writing-review.js 2>/dev/null | sort -V | tail -1)
# Fall back to the in-repo path when running from the plugin source (cache glob empty):
[ -z "$WF" ] && WF="${CLAUDE_SKILL_DIR}/../../workflows/writing-review.js"
```

**2. Invoke the workflow:**

```
Workflow({
  scriptPath: "<WF>",
  args: {
    projectDir: "<abs project dir>",          // holds .planning/, outlines/, drafts/, references/sources.bib
    pluginRoot: "${CLAUDE_SKILL_DIR}/../.."    // resolves domain skill + bridge_repetition_check.py
  }
})
```

The workflow runs Levels 1-3 and returns:
- `overallPass`, `verdict` (CLEAN | ISSUES FOUND)
- `summary` (`{ critical, major, minor, total }`)
- `style`
- `sections[]` — per-section `issues` (each tagged `source: structure | prose | fidelity`), `boundary`, `argumentSummary`, `unreliable`
- `transitions[]` — adjacent boundary verdicts
- `documentLevel` — `{ conceptOrderIssues, repetition, thesisIssues, completeness }`
- `unreliableSections` — sections where a reviewer returned nothing
- `sectionsThatFlagged` — sections to pass as `onlyChecks` on a re-review

**Re-review (when `/writing-revise` re-invokes after edits):** pass only the changed sections so the workflow re-reviews them and carries the rest forward:

```
Workflow({
  scriptPath: "<WF>",
  args: {
    projectDir: "<abs project dir>",
    pluginRoot: "${CLAUDE_SKILL_DIR}/../..",
    onlyChecks: [<changed section names>],     // re-review only these
    priorReviews: <previous result.sections>   // carry the rest forward
  }
})
```

> **Note:** `references/agent-team-workflow.md` and `references/reviewer-agent-prompt.md` are SUPERSEDED by `workflows/writing-review.js` — the script replaces the hand-rolled agent-team orchestration, and `references/sequential-checklist.md`'s content now lives in the workflow's structure-reviewer prompt. Those reference files are retained for provenance only; do not follow them to dispatch reviewers.

---

## Render REVIEW.md

Write `.planning/REVIEW.md` from `result.*` using the template in `references/review-template.md`:

- **Summary counts** ← `result.summary` (`critical`, `major`, `minor`, `total`)
- **Verdict** ← `result.verdict`
- **Document-Level Issues** ← `result.documentLevel` (`conceptOrderIssues`, `repetition`, `thesisIssues`, `completeness`)
- **Transition Issues** ← `result.transitions` (one block per non-SMOOTH boundary; quote `closes`/`opens`)
- **Section-Level Issues** ← `result.sections` — list each section's `issues` sorted by severity; each issue carries `source` (structure / prose / fidelity), `location` (file:line), `quote`, `detail`, and `fix`
- **Boundary Summaries** ← `result.sections[].boundary`

If `result.unreliableSections` is non-empty, mark those sections **UNRELIABLE** in REVIEW.md (a reviewer returned nothing for them) — do NOT fabricate findings or a clean verdict for them.

> The workflow's reviewers already cite verbatim quotes with file:line and a mechanical Verify stage drops any quote that does not resolve to the draft, so the findings you render are evidence-grounded by construction. Render them faithfully — do not add, invent, or soften.

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
