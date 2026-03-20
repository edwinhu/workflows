---
name: ds-escape-patterns
description: Four observed escape patterns where main chat breaks orchestrator role — verification rationalization, silent topic change, urgency bypass, pre-delegation investigation
applies-to: [ds, ds-fix, ds-implement, ds-review, ds-verify, ds-delegate]
---

## Rule

Main chat must not escape its orchestrator role. Four specific escape patterns have been observed in delegated DS workflows. Recognize and interrupt each one.

## Rationale

**Why this exists** — These patterns were identified from observed failures in delegated workflows. Each describes HOW main chat escapes its orchestrator role and starts doing investigation/implementation work directly.

## Pattern A: "Verification" Rationalization

```
Trigger: Subagent returns output
Thought: "I should verify the output is right"
Action: Reads source code, runs analysis queries, inspects data files
Violation: Investigation disguised as verification
```

**Fix:** Read LEARNINGS.md, not source files. If something looks wrong, spawn a new Task agent.

## Pattern B: Silent Topic Change

```
Trigger: User asks "What's in the cleaned data?" during ds-implement
Thought: "This is related, I can answer it"
Action: Reads CSVs, queries database, runs exploratory analysis
Violation: Implementation loop paused without announcement; context corrupted
```

**Fix:** Announce pause, handle request, announce resume, reload state.

## Pattern C: Urgency Bypass

```
Trigger: Subagent reports unexpected error or data quality issue
Thought: "I need to act NOW before proceeding"
Action: Runs 20 diagnostic queries, reads data profiles, modifies PLAN.md
Violation: Orchestrator doing investigation + implementation + planning simultaneously
```

**Fix:** Log the issue in LEARNINGS.md. Dispatch a fresh Task agent to investigate. Do not investigate yourself. Even genuinely urgent issues are delegated — dispatch with "URGENT:" prefix, but do NOT investigate in main chat.

## Pattern D: Pre-Delegation Investigation

```
Trigger: Task is about to start, or previous task failed
Thought: "I'll diagnose first, then tell the Task agent what to fix"
Action: Reads code, runs diagnostic commands, forms hypothesis
Violation: Main chat already did the investigation; Task agent duplicates or is biased
```

**Fix:** Dispatch the Task agent with the error report. Let the subagent investigate with fresh eyes. Your pre-investigation biases the subagent.

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I should verify the output is right" | You're about to investigate, not verify | Read LEARNINGS.md, not source files |
| "This is related, I can answer it" | You're about to silently switch context | Announce pause, handle, resume |
| "I need to act NOW" | Urgency doesn't justify breaking delegation | Log issue, dispatch subagent |
| "I'll diagnose first" | Your pre-investigation biases the subagent | Dispatch with error report, let subagent investigate fresh |

## Red Flags — STOP Trigger Quick Reference

| Phrase | Pattern | What To Do Instead |
|--------|---------|-------------------|
| "Let me check the data" | A: Verification rationalization | Read LEARNINGS.md |
| "Let me verify the output" | A: Verification rationalization | Read subagent report |
| "Quick look at the notebook" | A: Verification rationalization | Dispatch review subagent |
| "I can check that quickly" | B: Silent topic change | Announce pause first |
| "This needs immediate attention" | C: Urgency bypass | Log issue, dispatch subagent |
| "Let me understand the issue first" | D: Pre-delegation investigation | Dispatch subagent with error report |
| "I'll just confirm the results" | A: Verification rationalization | Trust output-first protocol |
| "Let me look at that for you" | B: Silent topic change | Announce pause first |
| "I'll fix this before moving on" | C: Urgency bypass | Delegate the fix |
| "Let me check what went wrong" | D: Pre-delegation investigation | Dispatch investigator subagent |
