---
name: audit-fix-loop
description: "Use when 'iteratively improve', 'audit and fix', 'hill-climb quality', 'grade and improve', 'score and fix', 'audit loop', or 'quality loop'."
user-invocable: false
---

**Announce:** "Using audit-fix-loop to plan a scored iterative improvement loop."

<EXTREMELY-IMPORTANT>
## The Iron Law of Independent Audit

**THE AUDITOR MUST NOT BE THE FIXER. This is not negotiable.**

If the same agent that wrote the fix also scores it, you get rubber-stamping. The audit must be structurally independent: a fresh subagent, a different model (Gemini), or a mechanical checker. The fixer's opinion of its own work is worthless.

**Skipping the independent re-audit is NOT HELPFUL — the user gets an artifact with unverified fixes that may have introduced new problems.**
</EXTREMELY-IMPORTANT>

## The Pattern

```
PLAN (this skill)
  ↓
  AskUserQuestion → identify artifact, scorers, threshold, turn budget
  ↓
/goal <condition pinned to SCORES.md threshold>  (separate-model evaluator)
  ↓
  ┌─────────────────────────────────────────────┐
  │ AUDIT: Fresh subagent scores artifact        │
  │   → Findings written to .planning/AUDIT.md   │
  │   → Score (0-10) appended to .planning/SCORES.md │
  │                                              │
  │ DECIDE: substrate gate first, score advisory │
  │   → substrate clean (0 CRITICAL/0 HIGH) AND  │
  │     score FLAT at its ceiling? → end turn;   │
  │     /goal evaluator marks condition met      │
  │   → substrate dirty, OR score still climbing │
  │     run-to-run? → continue to FIX            │
  │                                              │
  │ FIX: Apply targeted improvements             │
  │   → Address highest-severity findings first  │
  │   → Minimal changes (don't rewrite)          │
  │                                              │
  │ → end turn; /goal refires for re-audit       │
  └─────────────────────────────────────────────┘
```

**This is hill-climbing — on the substrate, not the score.** Each iteration audits, fixes the worst findings, and re-audits. The loop terminates on the **substrate gate** — zero CRITICAL and zero HIGH findings outstanding (the deterministic, convergent signal) — once the 0-10 score has gone **flat** at its ceiling.

<EXTREMELY-IMPORTANT>
**Do NOT make a bare composite ≥ 9.5 the termination condition.** The 0-10 score is a noisy LLM proxy: it re-rolls ±0.2 each run and regenerates new minor findings every pass, so it asymptotes (empirically ~9.0) and never stably crosses 9.5 — chasing it is a treadmill where each fix surfaces a new nit and the last 0.5 is only buyable by over-engineering (see project_wc_mode3_asymptote). Gate on the substrate (0 CRITICAL/HIGH) + score-flat; treat the number as an advisory thermometer, not the summit. The threshold you pick in Step 1 is a *floor the substrate must clear*, not a bar to grind toward.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Planning

**NO `/goal` WITHOUT A PLAN. This is not negotiable.**

Before setting the `/goal` for an audit-fix loop, you MUST identify:
1. What artifact you are improving
2. Which scoring surfaces apply
3. How the audit will be independent
4. What the score threshold is (default: 9.5/10)

A `/goal` condition like "fix all issues" is a naive condition. It provides little enforcement because the evaluator can only judge what's surfaced in the transcript. The condition must pin completion to an external state the auditor writes — typically `SCORES.md` reaching the threshold. The score decides — not the fixer.
</EXTREMELY-IMPORTANT>

## Step 1: Plan the Loop

### Identify Artifact and Scorers

```
AskUserQuestion(questions=[
  {
    "question": "What artifact are you improving?",
    "header": "Artifact",
    "options": [
      {"label": "Writing draft", "description": "Document, essay, paper, or prose in drafts/ or a specific file"},
      {"label": "Skill or workflow", "description": "SKILL.md or workflow definition being hardened"},
      {"label": "Visual output", "description": "Slides, charts, rendered documents — use visual-verify instead"},
      {"label": "Citations", "description": "Bluebook footnotes in a DOCX manuscript"}
    ],
    "multiSelect": false
  },
  {
    "question": "Which scoring surfaces should the audit use?",
    "header": "Scorers",
    "options": [
      {"label": "AI anti-patterns", "description": "12-category checklist for AI writing indicators (puffery, structure, artifacts)"},
      {"label": "Style guide", "description": "Domain rules: legal writing, econ writing, or Strunk & White (general)"},
      {"label": "Bluebook rules", "description": "Citation compliance against Bluebook 21st edition mechanical rules"},
      {"label": "Enforcement patterns", "description": "Score skill/workflow against 12 superpowers enforcement patterns"},
      {"label": "Source verification", "description": "Check citations against paperpile.bib, verify quotes against source PDFs (use source-verify skill)"}
    ],
    "multiSelect": true
  }
])
```

If user selects "Visual output," redirect to visual-verify — it already implements this pattern with Gemini vision.

If user selects "Citations," redirect to bluebook-audit — it already implements the audit+correct+verify cycle.

### Derive Loop Parameters

Based on selections, determine:

| Parameter | How to Derive |
|-----------|--------------|
| **Audit method** | See scorer table below |
| **Fix method** | Self-edit for small artifacts, parallel subagents for large ones |
| **Turn budget** | 10 (default), encoded as `Stop after N turns` in the `/goal` condition |
| **Score threshold** | 9.5/10 (default), adjustable |
| **Goal condition** | Pin to `SCORES.md` reaching threshold — see template below |

**Goal condition template:** The condition must reference the artifact AND the score state file. Examples:

- `All workflow families score >= 9.5 in .planning/SCORES.md across all selected scorers. Stop after 10 turns.`
- `Draft .planning/REVIEW.md shows 0 CRITICAL and 0 HIGH AI anti-pattern findings and SCORES.md latest row >= 9.5. Stop after 10 turns.`
- `SKILL.md scores >= 9.5 on the enforcement-checklist audit (12 patterns). Stop after 10 turns.`

### Scorer Reference

Each scorer has a specific audit method that ensures independence:

| Scorer | Audit Method | Independence Mechanism | Score Metric |
|--------|-------------|----------------------|-------------|
| **AI anti-patterns** | Fresh subagent reads `../ai-anti-patterns/SKILL.md` (relative to this skill's base directory) + all references, then audits the artifact | Fresh subagent (no fixer context) | Count by severity (CRITICAL/HIGH/MEDIUM) |
| **Style guide** | Fresh subagent reads domain skill (writing-legal, writing-econ, or writing-general), then audits | Fresh subagent | Rule violations by severity |
| **Bluebook rules** | Fresh subagent reads `../bluebook/SKILL.md` + references, then audits citations | Fresh subagent | Violations by rule category |
| **Enforcement patterns** | Fresh subagent reads `references/enforcement-checklist.md`, scores all 12 patterns | Fresh subagent | Count of Absent + Weak scores |
| **Source verification** | Invoke `Skill(skill="workflows:source-verify")` — checks citations against paperpile.bib, verifies quotes against source PDFs | Mechanical (bibtex grep) + NLM (quote search) | Verified / checkable citations |

**Composing scorers:** When multiple scorers are selected, each audit iteration runs ALL of them. The total score is the sum of all findings across all scorers. This means the audit catches different failure modes simultaneously — AI-smell AND style violations AND unsupported claims.

## Step 2: Initialize State Files

Create the `.planning/` directory and two state files before starting the loop:

```bash
mkdir -p .planning
```

**`.planning/AUDIT.md`** — current audit findings (overwritten each iteration):
```markdown
# Audit Findings

## Iteration: 1
## Scorers: [list]
## Total Score: [N]

### [Scorer Name]
| # | Severity | Finding | Location | Suggestion |
|---|----------|---------|----------|------------|
| 1 | HIGH | ... | ... | ... |
```

**`.planning/SCORES.md`** — score history across iterations (append-only):
```markdown
# Score History

| Iteration | Score | Threshold | Delta | Key Findings |
|-----------|-------|-----------|-------|-------------|
| 1 | 6.5 | 9.5 | — | 3 CRITICAL, 2 HIGH |
| 2 | 8.0 | 9.5 | +1.5 | 0 CRITICAL, 1 HIGH, 3 MEDIUM |
```

## Step 3: Start the Loop

Hand the user the literal `/goal` condition (or run `claude -p "/goal …"`). The condition's gate is the **substrate** (CRITICAL/HIGH counts) plus score-flatness — pin it to `.planning/SCORES.md` so the evaluator can read both the finding counts and the score trend from the transcript.

Example:

```
/goal All three workflow families are substrate-clean — zero CRITICAL and zero HIGH findings
outstanding in .planning/SCORES.md across the selected scorers — AND their composite scores have
gone flat (within ±0.2 of the prior turn, at or above the chosen floor). Audit then fix in parallel
inside each turn. Stop after 10 turns. Do NOT keep iterating to lift a flat score once substrate-clean.
```

Each turn under the active goal must enforce this exact sequence:

### Iteration Protocol

**Phase A: Audit (MUST be first)**

For each selected scorer, spawn a fresh audit subagent:

```
Agent(prompt="""
You are an independent auditor. You have NO knowledge of any prior fixes.

Read the scoring rules:
[SCORER-SPECIFIC SKILL PATH]

Then audit this artifact:
[ARTIFACT PATH]

Produce findings in this EXACT format:

| # | Severity | Finding | Location | Suggestion |
|---|----------|---------|----------|------------|

Severity levels: CRITICAL, HIGH, MEDIUM, LOW

Be thorough. A clean audit with missed issues is worse than a harsh audit.
Do NOT soften findings. Do NOT say "overall good."
""", subagent_type="general-purpose")
```

After all audit subagents return, compile findings into `.planning/AUDIT.md` and compute the score:

**Scoring:** The auditor scores the artifact 0-10 across the selected scoring surfaces.

The score reflects compliance rate: 9.5/10 = 95% of checkable items pass. For checklist-based scorers (ai-anti-patterns, style guide, enforcement patterns), this is concrete — count violations, divide by total checkpoints, invert. For judgment-based scorers, the auditor must justify the score with specific findings.

| Score | Meaning |
|-------|---------|
| 10.0 | 100% — zero findings |
| 9.5 | 95% — 1-2 minor items remain (default threshold) |
| 8.0 | 80% — several items need fixing |
| < 7.0 | Major gaps — significant work needed |

Record in `.planning/SCORES.md`.

**Phase B: Decide**

Read `.planning/SCORES.md`. Check against threshold:

| Condition | Action |
|-----------|--------|
| Score >= threshold (default 9.5) | End the turn — the `/goal` evaluator reads `.planning/SCORES.md` and marks the condition met |
| Score < threshold | Continue to Phase C |
| Turn budget reached | Escalate to user with current score and remaining findings |

**Phase C: Fix**

Address findings from `.planning/AUDIT.md`, prioritized by severity:
1. Fix all CRITICAL findings first
2. Then HIGH
3. Then MEDIUM (if iteration budget allows)
4. Skip LOW unless everything else is clean

**Fix rules:**
- Targeted changes only — do NOT rewrite the entire artifact
- Each fix should address ONE finding
- After fixing, do NOT self-assess — the next iteration's audit will judge

**Then end your turn** (the active `/goal` refires the next turn for re-audit).

**After fixing, do NOT pause to summarize or ask "should I continue?" — end your turn immediately so the goal refires for re-audit. The evaluator decides when to stop, not you.**

<EXTREMELY-IMPORTANT>
## The Iron Law of Score Threshold

**The `/goal` condition must be pinned to the auditor's score, not your judgment.**

Not when you "feel" the artifact is good enough. Not when you're tired of iterating. Not when the remaining findings seem minor. The auditor's score in `.planning/SCORES.md` decides — you don't.

Write the auditor's score into `.planning/SCORES.md` every turn. The `/goal` evaluator reads it from the transcript and marks the condition met only when the threshold is crossed. Do not paraphrase the score, do not summarize as "looks good" — surface the literal number.

**Asserting completion when the score is below threshold is NOT HELPFUL — the user receives a substandard artifact that fails its quality bar.**
</EXTREMELY-IMPORTANT>

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The remaining findings are minor" | Minor findings keep the score below 9.5. The threshold exists for a reason. | Fix them or document why they're false positives |
| "I can audit my own fixes" | Self-audit is rubber-stamping. You'll approve your own work. | Spawn a fresh subagent for every audit |
| "One more iteration won't help" | You don't know that. The score decides. | Run the audit, check the score, then decide |
| "The audit is too harsh" | Harsh audits produce quality. Soft audits produce complacency. | Keep the standard. Lower scores, not standards |
| "I'll batch all the fixes" | Batching makes it impossible to trace which fix helped | Fix by severity priority, let re-audit measure impact |
| "Bluebook checking is overkill for this draft" | If the document has footnotes, they must be correct. Wrong citations undermine credibility. | Run the Bluebook check |
| "'all issues addressed' is basically the same as meeting the threshold" | That phrasing is honor-system. The threshold requires `.planning/SCORES.md` to show >= 9.5. | Pin the `/goal` condition to the score file, not to "issues addressed" |
| "I'll skip the AskUserQuestion planning" | Unplanned `/goal`s are naive — the evaluator has nothing concrete to check. | Plan first, set the goal second |

## Delete & Restart

**If you set a `/goal` without planning (no AskUserQuestion, no scorer selection, no condition pinned to SCORES.md), CANCEL the goal and START OVER with Step 1.** No patching a naive condition mid-flight — run `/goal clear`, plan properly, then set a new goal.

**If you ran an audit with the fixer agent instead of a fresh subagent, DELETE the audit findings and RE-RUN with a fresh subagent.** Tainted audit results are worse than no audit — they give false confidence.

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Setting a `/goal` without running Step 1 | Naive condition — no audit structure | Plan the loop first |
| Goal condition like "all issues addressed" | Honor system — evaluator has nothing concrete to check | Pin condition to `.planning/SCORES.md` >= threshold |
| Auditing your own fixes in the same context | Rubber-stamping — no independence | Spawn fresh audit subagent |
| Claiming complete when score < threshold | Lying about quality | Read `.planning/SCORES.md`, check score >= threshold |
| Rewriting the entire artifact instead of targeted fixes | Introduces new issues, loses original voice | Fix one finding at a time |
| Skipping a selected scorer "to save time" | Partial audit misses entire failure categories | Run all selected scorers every iteration |

## Why Skipping Hurts the Thing You Care About Most

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|-------------|----------------------|---------------------|
| **Helpfulness** | "I'll save time by self-auditing" | You approved your own sloppy work | **Anti-helpful** — the artifact still has issues |
| **Competence** | "I know the quality is good enough" | A fresh auditor found 8 more issues | **Incompetent** — you missed what a checklist caught |
| **Efficiency** | "Planning the loop is overhead" | Unplanned loop ran 10 iterations with no progress | **Inefficient** — planning takes 30 seconds, unplanned loops waste minutes |
| **Honesty** | "Close enough to 9.5" | Score is 8.7 — you claimed threshold met without checking | **Dishonest** — you lied about quality |

## Integration

This skill **does not replace** existing audit workflows. It plans and structures loops that use them:

| Existing Skill | Relationship |
|---------------|-------------|
| **visual-verify** | Already implements audit-fix-loop for visual output. Redirect there. |
| **bluebook-audit** | Already implements audit+correct+verify for citations. Redirect there. |
| **writing-review + writing-revise** | Can be wrapped in audit-fix-loop for iterative improvement |
| **skill-creator** | Enforcement audit step IS an audit-fix pattern |
| **ai-anti-patterns** | Used AS a scorer within audit-fix-loop |
| **source-verify** | Domain-specific audit-fix-loop for citation/quote verification |

## Source Verification

For citation and quote verification, use the dedicated skill:

```
Skill(skill="workflows:source-verify")
```

Source-verify checks citations against `paperpile.bib` (existence + field accuracy), verifies quotes against source PDFs (via `rga` or NLM), and optionally checks claim grounding via NLM. It implements its own audit-fix-loop with scored threshold termination.

Use source-verify directly — do NOT try to reinvent citation checking inside a generic audit-fix-loop.
