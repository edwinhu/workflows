---
name: ds-data-pull-profile
description: Before native planning commits to a large external pull (≥50M rows, ≥500 MB estimated ship, or large/bulk/uncertain source), /ds profiles filtered raw versus aggregate/server-side paths so the choice is evidence-based.
applies-to: [ds, ds-fix]
---

## Rule

During `/ds` planning, dispatch a read-only profiler for every source that meets any trigger:

- estimated filtered raw rows ≥ **50M**;
- estimated ship size ≥ **500 MB** (compressed parquet or equivalent);
- source described as **large**, **bulk**, **TB**, **terabyte**, **millions of rows**, **hundreds of
  millions**, **full universe**, or **entire history**; or
- its size is unknown. Agents underestimate, so uncertainty triggers the profile.

**NO APPROVED NATIVE PLAN THAT COMMITS TO A TRIGGERED PULL WITHOUT THIS PROFILE.** A large pull
chosen from an estimate makes the user discover the waste after code and downstream assumptions
already exist. That is not helpful planning.

The profiler is read-only. It reports its evidence to the `/ds` orchestrator; it does not write a
pipeline, alter `.planning/PLAN.md`, or create a second task/state system.

1. **Count the filtered source.** Run `COUNT(*)` with the intended filter (or equivalent metadata
   request). Never pull the whole source solely to estimate it.
2. **Calibrate bytes per row.** When permitted, measure a representative ~100K-row sample using the
   project's intended codec. Treat the sample as temporary evidence, not a production artifact.
3. **Measure candidate aggregates.** For every plausible analysis grain, count the filtered `GROUP
   BY` result and identify which needed columns survive or are lost.
4. **Compare alternatives.** Compute `raw_rows / aggregate_rows`; compare pull-raw, source-side SQL
   aggregation, server-side pipeline, and hybrid options against downstream information needs.
5. **Return a decision report.** The report includes the table below, calibration method, lost versus
   preserved fields, and a recommendation. `/ds` records the decision and its rationale in the
   native plan before `ExitPlanMode`. If the decision will be reusable after this work, the
   orchestrator may curate it into project auto-memory; it is not a progress log.

| Source | Filtered raw rows | Raw MB | Aggregate level | Aggregate rows | Aggregate MB | Ratio | Recommendation |
|--------|------------------:|-------:|-----------------|---------------:|-------------:|------:|----------------|

## Decision guide

- **Ratio < 10×:** pull-raw is usually reasonable.
- **Ratio 10–100×:** source-side aggregation generally wins on transfer; prefer it unless the
  information-preservation check says otherwise.
- **Ratio > 100×:** pull-raw is unjustified unless a specified downstream task genuinely requires
  fields the aggregate drops.

A high ratio does not decide alone. Pulling raw may still be correct if aggregation loses needed
identifiers, the work needs multiple incompatible aggregation grains, or a server-side expression
cannot preserve the required logic. State the reason in the approved native plan, tied to the task
that needs it.

## Facts

- Mirror-voting v12's NPX profile found 144M raw rows versus a 1.62M-row candidate aggregate
  (89×), but aggregation dropped `fundid` and `wficn` needed for block classification. Pull-raw was
  correct only after the profile made the information loss visible.
- In the same work, planning estimates missed S12 by +18% and S34 by −78%. Unprofiled sizes run
  20–80% off in both directions; treating the profile as confirmation rather than decision evidence
  repeats a measured error.
- A 3-minute profile of a source that turns out to be 40M rows costs little. Missing a 150M-row
  profile pushes days of rework downstream.
- Implementers follow an approved plan literally. Deferring this decision to implementation means
  the expensive pull occurs before anyone evaluates the alternative.

## Cross-references

- **ds-external-skill-discovery:** discover relevant provider examples first; an existing server-side
  pipeline may be the best profile candidate.
- **WRDS PostgreSQL versus SAS reference:** when server-side work wins, use its decision guide to
  choose the engine.
