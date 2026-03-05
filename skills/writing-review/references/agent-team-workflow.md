# Agent Team Parallel Review Workflow

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled. If unavailable, fall back to Sequential.

## 1. Prerequisites Check and Section Mapping

Verify outlines exist. Then identify draft files:

**Case A: Multiple draft files** (one per section, e.g., `drafts/Part I (Draft).md`)
- Verify each section in OUTLINE.md has a corresponding draft file. If any are missing, STOP.
- Each agent gets its own file path. No splitting needed.

**Case B: Single combined draft file** (e.g., `drafts/Combined Draft.md` or `drafts/Article.md`)
- Read the file and identify all top-level section headings (typically `#` or `##`).
- Build a **Section Map**: for each section, record heading text, start line, end line.
- Each agent gets the same file path but with specific line ranges.

```
## Section Map Example

| Section | Heading | Start Line | End Line | Outline File |
|---------|---------|------------|----------|--------------|
| Part I  | # Part I: The Rise... | 1 | 287 | outlines/Part I (Outline).md |
| Part II | # Part II: The Law... | 288 | 542 | outlines/Part II (Outline).md |
| Part III | # Part III: Re-evaluating... | 543 | 789 | outlines/Part III (Outline).md |
| Part IV | # Part IV: Policy... | 790 | 1104 | outlines/Part IV (Outline).md |
```

To build the section map:
1. `Grep` for top-level headings: `^#{1,2}\s` in the draft file, with line numbers
2. Each section starts at its heading line and ends at the line before the next heading (or EOF)
3. Match each heading to the corresponding outline file
4. If a heading has no matching outline, flag it as an issue (scope creep) but still assign it to the nearest section's agent

**This step is non-negotiable.** If you skip it and hand agents a full document without line ranges, they will skim. Line ranges are action masking — they constrain the agent's attention to a tractable scope.

## 2. Create Tasks and Enter Delegate Mode

Create one task per section using `TaskCreate`:
- Subject: `Review: [Section Name]`
- Description: section outline path, draft path (with line range if Case B), PRECIS claim to check

Press **Shift+Tab** to enter delegate mode. The lead coordinates, does NOT review.

## 3. Spawn Agents

Each teammate receives the prompt from `references/reviewer-agent-prompt.md`. Teammates start with a blank conversation and do NOT auto-load skills — the prompt must be completely self-contained.

## 4. Lead Monitoring

While teammates review:
- Watch task list for completion
- If a teammate stalls, message for status
- Do NOT review any sections yourself — coordinate and aggregate only

## 5. Verification Gate (Before Level 2)

<EXTREMELY-IMPORTANT>
### The Iron Law of Verification

**DO NOT COMPILE SUBAGENT OUTPUT WITHOUT SPOT-CHECKING. Subagents confabulate
quotes. Unverified quotes in REVIEW.md are worse than no review at all.**

If you skip this step, you are laundering fabricated evidence into a review
document that will drive editing decisions. This has happened before.
</EXTREMELY-IMPORTANT>

After ALL teammates complete, before proceeding to Level 2:

### A. Completeness Check

For each subagent report, verify it contains ALL required components:
1. Topic Sentence Inventory (with every paragraph covered)
2. Subsection Boundary Checks
3. Section Review Checklist (with quoted evidence)
4. Boundary Summary
5. Issues list

If any component is missing: message the teammate requesting the missing
component. If the teammate has already shut down, note the gap in REVIEW.md
and flag it as a review limitation.

### B. Quote Verification

For each subagent, spot-check at least **3 quoted passages** against the
actual source text:
- Pick 1 quote from the Topic Sentence Inventory
- Pick 1 quote from the Boundary Summary (opening or closing sentence)
- Pick 1 quote from the highest-severity issue

For each quote: `Read()` the draft at the cited line number and verify the
quote matches. Record the result:

```markdown
## Quote Verification Log

| Agent | Quote Source | Cited Line | Matches? | Notes |
|-------|-------------|------------|----------|-------|
| reviewer-1 | Topic ¶3 | 24 | Yes | |
| reviewer-1 | Boundary closing | 287 | Yes | |
| reviewer-1 | Issue #1 | 156 | NO — text says "..." not "..." | Fabricated |
```

**If ANY quote fails verification:**
1. STOP compilation for that section
2. If the teammate is still running: message them with the discrepancy
   and request re-review of the flagged passage
3. If the teammate has shut down: the lead must re-read the relevant
   passage and correct the issue in REVIEW.md, flagging it as
   "corrected by lead — original subagent quote was inaccurate"

### C. Minimum Issue Threshold

For any section longer than 1000 words where the subagent reported fewer
than 3 issues: flag this as suspicious in REVIEW.md. Either the section
is exceptionally clean (possible but rare) or the reviewer skimmed.
The lead should scan that section for obvious issues before accepting.

## 6. Proceed to Level 2

After the verification gate passes, the lead collects all verified boundary
summaries and issues, then proceeds to Level 2 (Transition Review).
