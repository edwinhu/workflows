---
name: ds-escape-patterns
description: Four observed escape patterns where the DS orchestrator breaks its role — verification rationalization, silent topic change, urgency bypass, pre-delegation investigation
applies-to: [ds, ds-fix, ds-implement, ds-review, ds-delegate]
---

## Rule

The DS orchestrator must not escape its coordination role. Four specific escape patterns have been observed in delegated DS workflows. Recognize and interrupt each one. Technical `VERIFY` belongs to `ds-implement`; `ds-review` records and resolves human feedback only.

## Rationale

**Why this exists** — These patterns were identified from observed failures in delegated workflows. Each describes how an orchestrator starts doing investigation, implementation, or technical verification directly, which erodes independent evidence and makes the approved PLAN unstable.

## Pattern A: "Verification" Rationalization

```
Trigger: Agent returns output
Thought: "I should verify the output is right"
Action: Reads source code, runs analysis queries, inspects data files
Violation: Investigation disguised as verification
```

**Fix:** Read the returned report, approved PLAN, project auto-memory, and `TaskList`. If a technical check is needed, dispatch `ds-implement`; do not read source or data.

## Pattern B: Silent Topic Change

```
Trigger: User asks "What's in the cleaned data?" during ds-implement
Thought: "This is related, I can answer it"
Action: Reads CSVs, queries database, runs exploratory analysis
Violation: Implementation loop paused without announcement; context corrupted
```

**Fix:** Announce pause, handle the request, announce resume, then restore coordination context from the approved PLAN, project auto-memory, and `TaskList`.

## Pattern C: Urgency Bypass

```
Trigger: Agent reports unexpected error or data-quality issue
Thought: "I need to act NOW before proceeding"
Action: Runs diagnostic queries, reads data profiles, rewrites the approved PLAN
Violation: Orchestrator doing investigation + implementation + planning simultaneously
```

**Fix:** Capture the issue in `TaskList`. Dispatch a fresh `ds-implement` agent to investigate or VERIFY. Do not modify the approved PLAN. Even genuinely urgent work is delegated — use an `URGENT:` prompt, but do not investigate in the orchestrator.

## Pattern D: Pre-Delegation Investigation

```
Trigger: Task is about to start, or a previous task failed
Thought: "I'll diagnose first, then tell the task agent what to fix"
Action: Reads code, runs diagnostic commands, forms hypothesis
Violation: Orchestrator already did the investigation; task agent duplicates or is biased
```

**Fix:** Dispatch the `ds-implement` agent with the error report and approved task. Let the agent investigate with fresh eyes. Pre-investigation biases the agent and is not coordination.
