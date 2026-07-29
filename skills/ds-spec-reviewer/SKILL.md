---
name: ds-spec-reviewer
description: "Internal skill used by ds-brainstorm at Phase 1 exit gate. Dispatches a reviewer subagent to verify SPEC.md completeness before planning. NOT user-facing."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-reviewer-readonly-guard.ts"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-reviewer-readonly-guard.ts"
---

# Spec Document Reviewer (Data Science)

**Purpose:** Catch spec gaps BEFORE they survive into data profiling, planning, and implementation.

## When to Dispatch

After Phase 1 (brainstorm) writes `.planning/SPEC.md` and before Phase 2 (ds-plan) begins.

```
Phase 1: Brainstorm -> SPEC.md written
  -> [THIS SKILL] Dispatch spec reviewer subagent
  -> Issues found? Fix SPEC.md -> re-dispatch reviewer
  -> Approved? -> Phase 2: ds-plan
```

<EXTREMELY-IMPORTANT>
## The Iron Law of Spec Review

**NO PLANNING WITHOUT REVIEWED SPEC. This is not negotiable.**

A bad spec that survives into planning means:
- Profiling data you don't need
- Missing data sources discovered mid-analysis
- Building analysis against incomplete objectives
- Implementing the wrong methodology

**Catching a spec gap NOW costs 1 minute. Catching it during implementation costs hours.**
</EXTREMELY-IMPORTANT>

### Spec-Review Facts

- User confirmation covers intent, not completeness — a user-confirmed spec can still have empty sections, missing data sources, and unstated assumptions. The reviewer checks what the user didn't.
- Planning consumes the spec as-is: gaps survive into data profiling and task breakdown, so an incomplete section is not "filled in later" — it propagates downstream until someone profiles the wrong data.
- A spec that resembles a prior one is not thereby complete — prior specs had different data sources and objectives; each section is checked against THIS analysis's requirements.

## Dispatch Template

Use this Task invocation to dispatch the spec reviewer:

```
Agent(
  subagent_type="general-purpose",
  description="Review DS spec document",
  allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"],
  prompt="""
You are a data science spec document reviewer. Verify this spec is complete and ready for data profiling and analysis planning.

**Tool Restrictions:** The spec reviewer is READ-ONLY. It reads `.planning/SPEC.md`, evaluates against checklist, returns verdict. It MUST NOT use Write or Edit.

**Spec to review:** .planning/SPEC.md

Read the spec file, then evaluate against ALL categories below.

## What to Check

| Category | What to Look For |
|----------|------------------|
| Completeness | TODOs, placeholders, "TBD", incomplete sections, empty fields |
| Data Sources | All data sources identified with location, format, and time period |
| Sample Period & Coverage | ONE canonical window declared (not scattered across prose); named sub-windows each mapped to consuming task(s); every windowed source has a Required-vs-Actual coverage row (Actual may be "TBD — profiled in ds-plan", but Required must be filled = union of consuming tasks' sub-windows) |
| Analysis Objectives | Clear, specific questions the analysis will answer |
| Output Format | Expected deliverables specified (report, dashboard, model, tables) |
| Success Criteria | Measurable, specific, with clear pass/fail (not vague) |
| Reproducibility | Replication strategy documented if replicating existing work |
| Constraints | Timeline, methodology requirements, computational limits documented |
| Consistency | Internal contradictions, conflicting requirements |
| YAGNI | Unrequested analyses, over-engineering, scope creep |

## CRITICAL - Look Especially Hard For:

- Any TODO markers or placeholder text
- Sections saying "to be defined later" or "will spec when data is explored"
- Sections noticeably less detailed than others
- Data sources listed without location or format
- Sample period scattered across prose (a "measured" range here, a "scope" year there) with NO single canonical window — or a per-source coverage row whose Required window omits a task that will read the source (the reuse-truncation trap)
- Analysis objectives that are vague ("explore the data", "find patterns")
- Success criteria that are unmeasurable ("good model", "interesting results")
- Missing replication/reproducibility strategy when replicating existing work
- Missing constraints section
- Output format unspecified (who consumes the results and how?)

## Output Format

## Spec Review

**Status:** APPROVED | ISSUES_FOUND

**Issues (if any):**
- [Section]: [specific issue] - [why it matters for planning]

**Recommendations (advisory - don't block approval):**
- [suggestions for improvement that aren't blocking]
""")
```

## Handling Reviewer Output

### If APPROVED

**1. Write the structural gate sentinel** (ds-plan refuses to start without it — a PreToolUse `phase-gate-guard.py` hook checks this file):

```
Write(".planning/SPEC_REVIEWED.md", """---
status: APPROVED
reviewed: spec
date: [ISO 8601]
---
Spec reviewed and APPROVED by ds-spec-reviewer. ds-plan may proceed.
""")
```

**2. Proceed immediately to Phase 2 (ds-plan).** Discover and load:
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-plan/SKILL.md` and follow its instructions.

### If ISSUES_FOUND
1. **Clear any stale sentinel** so the gate cannot pass on an old approval:
   `Write(".planning/SPEC_REVIEWED.md", "---\nstatus: ISSUES_FOUND\nreviewed: spec\n---\nSpec has open issues; ds-plan is gated.")`
2. Fix the specific issues in `.planning/SPEC.md`
3. Re-dispatch the reviewer (same template)
4. Repeat until APPROVED or max 5 iterations

### If 5 Iterations Without Approval
Escalate to user:
```
"Spec reviewer has flagged issues 5 times. Remaining issues:
[list issues]
Should I: (A) Fix these, (B) Proceed with known gaps, (C) Rethink the spec?"
```

## Gate Function

**Checkpoint type:** human-verify (spec completeness is machine-verifiable)

```
1. IDENTIFY: `.planning/SPEC.md` exists
2. DISPATCH: Send to reviewer subagent
3. READ: Reviewer returns APPROVED or ISSUES_FOUND
4. VERIFY: If ISSUES_FOUND, fix and re-dispatch (max 5)
5. CLAIM: On APPROVED, write `.planning/SPEC_REVIEWED.md` (`status: APPROVED`), THEN proceed to ds-plan

**This gate is hook-enforced, not advisory:** ds-plan declares a PreToolUse `phase-gate-guard.py` hook that blocks Write/Edit/Agent until `.planning/SPEC_REVIEWED.md` exists with `status: APPROVED`. A user who invokes `/ds-plan` directly without a reviewed spec is structurally blocked.
```
