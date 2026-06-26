---
name: writing-review
description: "Internal skill for hierarchical document review. Called by writing-validate after claim validation passes."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Write, Agent, Skill, Workflow
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Agent"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/VALIDATION.md
            GATE_STATUS=validated
            GATE_BLOCKED_TOOLS=Write,Edit,Agent
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

## Delete & Restart

If you catch yourself in any of these violations, the review output is contaminated. Delete it and start over:

| Violation | Why Contaminated | Action |
|---|---|---|
| Reviewed a section without reading its draft file | You fabricated a review from outline knowledge | DELETE REVIEW.md. Read every draft. Start Level 1 over. |
| Reviewed your own draft in the same context (no fresh subagent) | Self-review is rubber-stamping — you share the drafter's biases | DELETE the section review. Spawn a fresh subagent. Re-review. |
| Wrote REVIEW.md without completing all 3 levels | Partial review misses cross-section issues | DELETE REVIEW.md. Complete all levels. Regenerate. |

**Partial fixes to contaminated reviews create worse outcomes than restarting.** A review built on fabricated evidence will misdirect writing-revise into "fixing" non-problems while real issues persist.

## Red Flags

- About to write "no issues" for a section without quoting evidence → STOP. That is rubber-stamping; quote the text that proves it passes.
- About to skip boundary analysis between sections → STOP. Transition problems are the #1 reason this skill exists; compare every adjacent boundary pair.
- About to review only the section that looks weakest → STOP. Bias blinds the review elsewhere; review ALL sections with equal rigor.
- About to write a vague suggestion ("improve flow") → STOP. Unactionable for writing-revise; cite specific text, diagnose the specific problem, suggest the specific fix.
- About to finish review of a multi-section document in under 5 minutes → STOP. That is skimming; go back and read properly.
- About to copy outline structure as if it were review → STOP. Outline compliance is not quality review; check content quality, not just structural match.

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

### Step 2d: AI-prose audit (standard — always runs)

Run the corpus-validated AI-prose scorer on every draft. This is **not optional** — the
review always includes scorer-based AI-ism findings so the de-AI pass in `/writing-revise`
has spans to act on:

```bash
uv run --with pyyaml python3 ${CLAUDE_SKILL_DIR}/../de-ai-revise/scripts/de_ai_audit.py --json drafts/*.md
```

Carry these into the review:
- **`diction:always_flag` spans and `tic` spans with `sev_score >= 4`** → AI-ism findings. List them in REVIEW.md (as **minor** advisory polish, unless several cluster in one section → **major**). Each carries `line`, `text`, and `replace_with`.
- **`composite_human_likeness` + `tic_density` + `advisories`** → record per draft as context for the revise loop.
- Do **not** elevate AI-prose spans to blocking criticals, and do **not** treat a mid-range composite as failure — a human legal draft scores ~55-65 with em-dashes as nearly the whole signal (see `de-ai-revise` Iron Law of Goodhart). The substrate gate (critical+major) is unchanged.

The fix for these findings is `/writing-revise`'s mandatory de-ai-revise pass — review only surfaces them.

---

## Run the writing-review workflow

The review is **always parallel** and is owned by an ultracode workflow script — you do NOT choose a strategy and you do NOT dispatch reviewers yourself. The workflow runs all three levels (per-section structure + prose + fidelity fan-out, mechanical quote-verification, transition analysis, and whole-document checks) in the background and returns structured findings.

**1. Resolve the cached workflow path:**

```bash
WF=$(command ls -d ~/.claude/plugins/cache/*/workflows/*/workflows/writing-review.js 2>/dev/null | sort -V | tail -1)
# Fall back to the in-repo path when running from the plugin source (cache glob empty):
[ -z "$WF" ] && WF="${CLAUDE_SKILL_DIR}/../../workflows/writing-review.js"
```

**2. COMPILE the deterministic section index** (the writing analog of ds/dev's compile step — replaces the workflow's LLM `Discover` with a regex-parse of the approved planning artifacts; the SAME parser the writing-draft skill and the outline-executable guard use, so the section set can't drift between phases):

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_section_index.py "<abs project dir>" > .planning/section-index.json
```

Read `.planning/section-index.json`. If `ok`, pass the parsed object as `sectionIndex` below. If it carries `violations` / `staleApproval` (e.g. a `*_REVIEWED.md` whose claim/Part count disagrees with the live OUTLINE.md — a stale approval after a reframe), **surface them** — they are spec-integrity failures fixed upstream. On a hard error, omit `sectionIndex` (the workflow falls back to its LLM Discover).

**3. Invoke the workflow:**

```
Workflow({
  scriptPath: "<WF>",
  args: {
    projectDir: "<abs project dir>",          // holds .planning/, outlines/, drafts/, references/sources.bib
    pluginRoot: "${CLAUDE_SKILL_DIR}/../..",   // resolves domain skill + bridge_repetition_check.py
    sectionIndex: <parsed .planning/section-index.json, or omit for the LLM Discover fallback>
  }
})
```

The workflow runs Levels 1-3 and returns:
- `overallPass` / `substratePass` (== `critical===0 && major===0` — the blocking gate; **minors are advisory, not blocking**), `verdict` (CLEAN | CLEAN (advisory polish notes) | ISSUES FOUND)
- `summary` (`{ critical, major, minor, total, blocking, advisoryMinors }`)
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
   - implements: [CLAIM-XX ids the reviewed sections cover — the requirement→phase trace]
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

### Review Exit Facts

- Subagents confabulate verbatim quotes — Round 1 proved this. Compiling subagent output without spot-checking 3+ quotes per agent against the source launders fabricated evidence into REVIEW.md.
- The Topic Sentence Inventory IS the paragraph-level review. A review without it covers headings, not prose — and presenting it as a prose review is dishonest about what was checked.
- A long single-file document needs MORE structure, not less: build the Section Map and assign line ranges. Skipping it because the file is "too long to split" guarantees skimmed, shallow findings.

## Confidence Scoring

Tag each reported issue with a confidence level:

| Level | Threshold | Placement |
|---|---|---|
| **HIGH** | >= 90% certain this is a real problem | Main report — fix required |
| **MEDIUM** | >= 80% certain | Main report — fix recommended |
| **LOW** | < 80% certain | Separate "Possible Issues" section at end of REVIEW.md |

Only issues at HIGH or MEDIUM confidence appear in the main report. LOW confidence issues go in a separate **"Possible Issues"** section so they are visible but do not clutter actionable fixes. This prevents false positives from overwhelming `/writing-revise`.

## Red Flags

- About to write REVIEW.md without reading all drafts → STOP. That is fabricating a review; read every draft file first.
- About to skip Level 2 (transitions) → STOP. Transitions are the primary reason this skill exists; always run all three levels.
- About to record fewer than 3 issues on a multi-section document → STOP. Statistically implausible; review more carefully.
- About to use vague language ("could be improved") → STOP. Unactionable for writing-revise; quote text, diagnose specifically, suggest specifically.
- About to finish in one pass without re-reading → STOP. Different issue types need different passes; run each level as a separate pass.
- About to compile subagent output without spot-checking quotes → STOP. That launders potentially fabricated evidence; run the Verification Gate first.
- About to assign an agent a full document without line ranges → STOP. Unscoped agents skim; build the Section Map and assign start/end lines.
- About to accept a subagent review missing the Topic Sentence Inventory → STOP. The inventory IS the paragraph-level review; reject and request completion.

---

## Next Phase

After review is complete:

Invoke `/writing-revise` to fix issues identified in `.planning/REVIEW.md`.
