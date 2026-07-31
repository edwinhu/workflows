# Agent Team Parallel Review Workflow

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled. If unavailable, fall back to Sequential.

## 1. Authenticate the Plan and Compile the Section Index

Before dispatching teammates, authenticate the exact generated writing `{planFile, planHash}`
from the approved combined `.planning/.state/review.json` receipt. Compile the deterministic
section index and require its `planFile`, `planHash`, and `reviewStatus` to match the receipt.
A missing, mismatched, malformed, or non-approved identity blocks review.

Use the authenticated PLAN's **Writing Intent**, **Claims**, **Claim → Section Map**,
**Source Plan**, **Section Outputs**, and **Review Surfaces**. These fields—not
`PRECIS.md`, `OUTLINE.md`, `ACTIVE_WORKFLOW.md`, `REVIEW.md`, or `AUTOMATED_REVIEW.md`—are
the review authority. The named retired files may be preserved only for explicit legacy
conversion; never rediscover, read, or write them in this canonical flow.

For every indexed section, verify:

- the exact outline and draft paths match the PLAN Section Outputs row;
- the outline and draft carry current `plan_hash` and exact `implements` frontmatter,
  including `[]` for claimless structural sections;
- the plan's Claim → Section Map provides the exact mapped claim IDs;
- the section's dependencies determine previous/next review context.

## 2. Build the Deterministic Section Map

The compiled index, rather than an LLM's heading discovery, is the Section Map. For each
section record, retain its exact name, outline deliverable, draft deliverable, mapped claim
IDs, dependencies, and any range in a combined draft.

**Case A: Multiple draft files** (one indexed draft deliverable per section)
- Give each agent its indexed outline and draft path. No splitting is needed.

**Case B: Single combined draft file**
- Use the deterministic index's section ranges and give each agent the same draft path plus
  its exact assigned line range.
- Do not infer headings from a mutable draft or rematch them to a legacy master outline.

```
## Section Map Example

| Section | Draft deliverable | Start Line | End Line | Outline deliverable | PLAN claims |
|---------|-------------------|-----------:|---------:|---------------------|-------------|
| Part I  | drafts/article.md | 1 | 287 | outlines/part-i.md | CLAIM-01 |
| Part II | drafts/article.md | 288 | 542 | outlines/part-ii.md | CLAIM-02, CLAIM-03 |
| Part III | drafts/article.md | 543 | 789 | outlines/part-iii.md | [] |
```

**This step is non-negotiable.** If you skip the authenticated index and hand agents a full
document without line ranges, they will skim. Line ranges are action masking—they constrain
the agent's attention to a tractable scope.

## 3. Create Tasks and Enter Delegate Mode

Create one TaskList item per indexed section using `TaskCreate`:
- Subject: `Review: [Section Name]`
- Description: authenticated `{planFile, planHash}`, indexed outline and draft deliverables
  (with line range when applicable), mapped PLAN claims, and Source Plan context.

Press **Shift+Tab** to enter delegate mode. The lead coordinates; fresh independent reviewers
perform the section review.

## 4. Spawn Agents

Each teammate receives the prompt from `references/reviewer-agent-prompt.md`. Substitute only
values compiled from the authenticated `{planFile, planHash}` section index. Teammates start
with a blank conversation and do not auto-load skills, so the prompt must remain self-contained.

## 5. Lead Monitoring

While teammates review:
- Watch TaskList for completion.
- If a teammate stalls, message for status.
- Do not replace a fresh reviewer's section review; coordinate and aggregate only.

## 6. Verification Gate (Before Level 2)

<EXTREMELY-IMPORTANT>
### The Iron Law of Verification

**DO NOT COMPILE SUBAGENT OUTPUT WITHOUT SPOT-CHECKING. Subagents confabulate
quotes. Unverified quotes in a TaskList finding are worse than no review at all.**

If you skip this step, you are laundering fabricated evidence into findings that will drive
editing decisions. This has happened before.
</EXTREMELY-IMPORTANT>

After ALL teammates complete, before proceeding to Level 2:

### A. Completeness Check

For each subagent returned result, verify it contains ALL required components:
1. Topic Sentence Inventory (with every paragraph covered)
2. Subsection Boundary Checks
3. Section Review Checklist (with quoted evidence)
4. Boundary Summary
5. Issues list, each bound to the authenticated plan hash and mapped claim IDs

If any component is missing: message the teammate requesting the missing component. If the
teammate has already shut down, create a TaskList item that records the review limitation; do
not create a review ledger.

### B. Quote Verification

For each subagent, spot-check at least **3 quoted passages** against the exact indexed draft
deliverable:
- Pick 1 quote from the Topic Sentence Inventory.
- Pick 1 quote from the Boundary Summary (opening or closing sentence).
- Pick 1 quote from the highest-severity issue.

For each quote, read the assigned draft at the cited line number and record verification in the
returned review result or current TaskList item:

```markdown
## Quote Verification

| Agent | Quote Source | Cited Line | Matches? | Notes |
|-------|-------------|------------|----------|-------|
| reviewer-1 | Topic ¶3 | 24 | Yes | |
| reviewer-1 | Boundary closing | 287 | Yes | |
| reviewer-1 | Issue #1 | 156 | No | Fabricated; re-review required |
```

**If ANY quote fails verification:**
1. STOP reconciliation for that section.
2. If the teammate is still running: message them with the discrepancy and request re-review
   of the flagged passage.
3. If the teammate has shut down: create a critical TaskList finding for unreliable reviewer
   evidence, preserving the authenticated plan hash and section identity.

### C. Minimum Issue Threshold

For any section longer than 1000 words where the subagent reported fewer than 3 issues: flag
this as suspicious in the returned result or TaskList. Either the section is exceptionally clean
(possible but rare) or the reviewer skimmed. The lead should scan that section for obvious issues
before accepting.

## 7. Proceed to Level 2

After the verification gate passes, the lead collects verified boundary summaries and findings,
then proceeds to Level 2 (Transition Review). Reconcile normalized findings into TaskList with
`planHash`, stable retry identity, section/claim IDs, and disposition. The workflow returns its
structured result for the human review surface; it never creates a mutable planning or review
ledger.
