---
name: sample-coverage
description: Every DS native plan declares one canonical sample window, named task-specific sub-windows, and required-versus-actual source coverage with an explicit gap disposition before a source is used.
applies-to: [ds, ds-implement, ds-accept, ds-delegate, ds-fix]
---

## Rule

The approved native plan declares **one authoritative sample period**. Do not scatter periods through
source prose, task descriptions, or implementation code. The plan must specify:

1. **Canonical window:** the outer `[start, end]` for the study; every date-bearing source and task
   is within it unless the plan explicitly justifies a lag, lead, or other extension.
2. **Named sub-windows:** each narrower analysis window names the task or output that consumes it.
   A sub-window with no consumer is dead; a task that needs an unstated window is a planning gap.
3. **Required-versus-actual source coverage:** for every windowed raw source, cache, intermediate,
   or canonical analysis dataset, state the required span (the union of windows used by every
   consuming task), measured actual `min/max` on its date key, and an explicit disposition for each
   gap.

Use this structure in the native plan; do not create a separate specification or coverage state file:

```markdown
## Sample period and coverage

**Canonical window:** 2005-01 to 2025-12

| Sub-window | Range | Consumed by |
|---|---|---|
| measured | 2023H2–2025H1 | active-weight output |
| counterfactual | 2005–2025 | reassignment task |

| Source | Required window | Actual min–max | Gap | Disposition |
|---|---|---|---|---|
| mktcap cache | 2005–2025 (measured ∪ counterfactual) | 2018–2026 | pre-2018 | re-pull from 2005 |
| returns | 2009–2024 | 2009–2024 | none | OK |
```

Before the data profile runs, use `TBD (profiling task)` for Actual coverage. It marks scheduled
evidence; it is not permission to invent a range or leave the cell blank.

**COV gate:** a task must not use a windowed source until actual coverage has been compared with its
required window. A gap is either closed (re-pull or extend the source) or dispositioned with a
specific, task-relevant reason. An undispositioned gap is a stop.

## Why required is a union

Reuse is the dangerous case. A source pulled for one narrow task can be reused by a second task with
a wider span; rows outside the first pull become missing while the resulting series still looks
plausible. Required coverage is therefore the union of every consuming task's windows, not the span
of the task that first acquired the source.

A market-cap cache was pulled for 2018–2026 to support one measured-window task, then reused for a
2005–2025 counterfactual. The cache supplied zero pre-2018 values, yet the output looked plausible
until independent audit. A single native-plan coverage table would have compared the 2005–2025 union
with the 2018 start before implementation.

## Facts

- Truncated series do not reliably fail loudly; coverage gaps often surface only at audit, after
  plausible estimates have been trusted. The required-versus-actual comparison makes the mismatch
  visible before use.
- Source metadata that says only “time period” cannot detect cross-task reuse. It records the
  source in isolation rather than testing it against every consumer.
- A disposition names why the missing span is acceptable or requires a re-pull. “The series looked
  fine” is not evidence and is not a disposition.
- Coverage is an input precondition. Sample-selection accounting explains what later filtering did;
  it cannot prove that the input source ever covered the chosen interval.

## Runtime verification

`COV` is defined in `skills/ds-verify/references/ds-checks.md`. Implementation and independent
review compute actual `min/max` on each date key and compare it with the immutable plan's required
window. Any uncovered, undispositioned span is a high-confidence failure. Re-plan through native
Plan mode if the approved coverage decision must change; never patch the immutable plan copy.
