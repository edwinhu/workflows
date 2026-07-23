---
name: sample-coverage
description: Every analysis has ONE authoritative sample period (canonical window + sub-windows); every windowed data source has a Required-vs-Actual coverage row with a disposition for each gap; no windowed source is used by a task until asserted against its required window
applies-to: [ds, ds-plan, ds-implement, ds-review, ds-verify, ds-delegate, ds-fix]
---

## Rule

The analysis has **ONE authoritative sample period**, declared once in SPEC.md and inherited by every downstream phase. It is NOT scattered across prose ("2023H2–2025H1 measured", "2009–2024 for source X", "2005–2025 scope") with no single canonical window — that scattering is the failure this rule prevents.

Three things are mandatory:

1. **Canonical window** — the single outer `[start, end]` that bounds the whole study. Every date-bearing source and every task lives inside it (or declares why it legitimately extends beyond, e.g. lags/leads).
2. **Sub-windows** — named narrower windows a *specific* task or exhibit uses (e.g. `measured = 2023H2–2025H1`, `counterfactual = 2005–2025`, `estimation = 2009–2024`). Each sub-window names the task(s) that consume it. A sub-window that no task names is dead; a task that needs a window not listed is a gap.
3. **Per-source Required-vs-Actual coverage table** — for EVERY windowed source (raw pull, cache, intermediate, master), the window it is REQUIRED to cover (the union of the sub-windows of every task that reads it) vs the window it ACTUALLY covers (measured `min/max` of its date key), with a **disposition for each gap**.

**The COV gate:** a windowed source MUST NOT be used by a task until its ACTUAL coverage has been asserted against that task's REQUIRED window. Every gap (Actual narrower than Required) is either **closed** (re-pull/extend the source) or **dispositioned** (documented reason it is acceptable — e.g. "task only needs 2018+", "pre-2018 legitimately absent from vendor"). An undispositioned gap is a STOP.

**Reuse is the trap.** A source pulled to satisfy one task's window may be silently reused by a second task with a *wider* required window. The second task's rows outside the pulled window get ZERO data, and a truncated series still produces plausible numbers — so nothing fails loudly. The Required column is the **union across all consuming tasks**, precisely so a wider second consumer forces the coverage question before the reuse, not after an audit.

### Coverage table schema (SPEC.md and PLAN.md)

```markdown
## Sample Period & Coverage Requirements

**Canonical window:** 2005-01 to 2025-12 (all sources/tasks live inside this unless noted)

**Sub-windows:**
| Sub-window | Range | Consumed by |
|------------|-------|-------------|
| measured | 2023H2–2025H1 | Task 6 (active weight) |
| counterfactual | 2005–2025 | Task 8 (reassignment) |
| estimation | 2009–2024 | Task 4 (factor model) |

**Per-source coverage** (Required = union of sub-windows of every task that reads the source):
| Source | Required window | Actual (min–max) | Gap? | Disposition |
|--------|-----------------|------------------|------|-------------|
| mktcap_cache | 2005–2025 (Task 6 ∪ Task 8) | 2018–2026 | pre-2018 missing | **CLOSE** — re-pull from 2005 (Task 8 needs it) |
| returns | 2009–2024 | 2009–2024 | none | OK |
| holdings | 2023H2–2025H1 | 2023–2025 | none | OK |
```

At SPEC time the Actual column is `TBD (profiled in ds-plan)`; ds-plan fills it from profiling; ds-review/ds-verify assert it.

## Rationale

**Live ds project, market-cap cache reuse.** The SPEC scattered the period across three statements ("2023H2–2025H1" measured, "2009–2024" one source, "2005–2025" scope) with NO single canonical window and NO per-source coverage table. A market-cap cache was pulled for **2018–2026** to serve one sub-task (active weight, a `measured`-window task), then silently **reused** by a different task — a **2005–2025** counterfactual reassignment. Pre-2018 items got ZERO market-cap data. Nobody caught it until an independent audit, because a truncated series still produces plausible numbers.

Root cause: there was no sample-period SPEC to review against. The Required-vs-Actual table with `Required = Task6 ∪ Task8 = 2005–2025` would have flagged the 2018-start cache the moment Task 8 was mapped to it — before the reuse silently truncated the counterfactual.

**Why it exists:** period specification folded loosely into "Data Sources" (`[location, format, time period]`) records each source's *own* window in isolation. It never asks "does this source cover every task that reads it?" — the one question the reuse failure turns on. A canonical window + per-source Required-vs-Actual table makes the question mandatory and reviewable.

## Relationship to adjacent rules

- **[[sample-selection]] (V8)** documents *why* each filter (start/end date among them) and the row funnel, at implement time in LEARNINGS.md. It justifies the window; it does NOT assert that each source *covers* the required window, nor catch cross-task reuse. Coverage is the input-side precondition; sample-selection is the output-side accounting. Both are needed.
- **[[master-datasets]]** enforces *grain/keys* consistency — every exhibit from one master. A master can have the correct grain and still be truncated in time; a cache feeding it is unchecked by the grain rule. Coverage is orthogonal: right grain, wrong span.
- **[[ds-data-pull-profile]]** measures `min/max` per source but only to decide raw-vs-aggregate *ship size*. This rule reuses that measured `min/max` as the Actual column and gives it something to be asserted against.
- **[[parameter-transparency]]** centralizes date windows as named config so `START/END` are not inline literals. That prevents drift of the *value*; it does not verify a *source covers* the value. A correctly-centralized `COUNTERFACTUAL_START = 2005` still silently truncates against a 2018 cache — parameter-transparency is satisfied and the analysis is still wrong. Coverage closes that gap.

## COV check (runtime)

`COV` is defined in `skills/ds-implement/references/ds-checks.md` alongside DQ1–DQ6. For every windowed source, ds-review and ds-verify compute measured `min/max` of the date key and assert it covers the Required window of every task that reads it; any uncovered span that is not dispositioned in the coverage table is a high-confidence issue.

## Examples

### Correct
```markdown
## Sample Period & Coverage Requirements
**Canonical window:** 2005 to 2025
**Sub-windows:** measured 2023H2–2025H1 (Task 6); counterfactual 2005–2025 (Task 8)
| Source | Required | Actual | Gap? | Disposition |
| mktcap_cache | 2005–2025 (Task 6 ∪ Task 8) | 2005–2026 | none | OK (re-pulled from 2005) |
```
Task 8's wider window is in Required *before* the pull, so the cache is pulled from 2005, not 2018.

### Incorrect
```markdown
## Data Sources
- mktcap_cache: parquet, 2018-2026   # pulled for active weight (Task 6)
- (Task 8 counterfactual, 2005-2025, silently reuses mktcap_cache)
```
No canonical window, no Required column, no gap disposition. Task 8's pre-2018 rows get zero data; a plausible-looking number survives to write-up.

## Facts

- A truncated series produces plausible numbers, so coverage gaps do not fail loudly — they surface at audit, days after the analysis felt done. The Required-vs-Actual table is the only place the gap is visible before the numbers are trusted.
- The Required window for a source is the UNION of the sub-windows of every task that reads it — not the window of the task it was first pulled for. Recording only the first consumer's window is exactly how reuse truncates the second consumer.
- Per-source `time period` in the Data Sources list records each source's window in isolation; it never cross-checks source-vs-consuming-task. Isolation is why the loose folding into Data Sources missed the reuse.
- An undispositioned gap is a STOP, not a warning: "the series looked fine" is not a disposition. A disposition names the reason the missing span is acceptable (task doesn't need it / vendor genuinely lacks it) or triggers a re-pull.
- Coverage is an input-side precondition checked BEFORE use; sample-selection is output-side accounting checked AFTER filtering. Passing the sample-selection funnel does not imply the source ever covered the window — the funnel starts from whatever rows were pulled.
