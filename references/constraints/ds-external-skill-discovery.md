---
name: ds-external-skill-discovery
description: Before drafting PLAN.md tasks that reference an external skill (wrds, gemini-batch, lseg-data, nlm, readwise, etc.), main chat MUST glob that skill's references/ and examples/ directories, load domain-specific references matching the data/task at hand, read the README of any matching example, and prefer adopting/patching an existing example over greenfield drafting.
applies-to: [ds-plan, ds-fix]
---

## Rule

When ds-plan determines that one or more external plugin skills will be used (WRDS, gemini-batch, lseg-data, nlm, readwise, etc.), complete the External Skill Discovery checklist BEFORE drafting the Task Breakdown section of PLAN.md.

Loading only the rule references (e.g. `sas-etl.md`, `postgres-vs-sas.md`) is necessary but NOT sufficient. Rule references teach *how* to write code; domain references teach the *recipe*; example directories contain *battle-tested implementations*. All three layers are required.

**The checklist, per external skill `X` in play:**

1. `Glob skills/X/references/*.md` — enumerate all references.
2. Load the domain-specific reference(s) matching the data/task at hand (not just the generic rule refs). Map task domain → reference filename by name. Examples: WRDS holdings/ownership → `tfn-ownership.md`; WRDS voting → `iss-voting.md`; WRDS TAQ → `taq.md`; WRDS Compustat → `compustat.md`.
3. `Glob skills/X/examples/**` — enumerate prior pipelines.
4. For every example whose name matches the task domain, Read its `README.md` in full (or the top-level file if no README).
5. Decide ADOPT / PATCH / GREENFIELD and record the decision in PLAN.md with the example path and the delta.

**NO PLAN.md TASK BREAKDOWN WITHOUT EXTERNAL SKILL DISCOVERY COMPLETED. This is not negotiable.** You don't know what you don't know. Sibling `examples/` directories are where prior projects crystallized hard-won knowledge — skipping them means re-paying the cost of every mistake those examples already solved.

## Rationale

Mid-2026 mirror-voting v12 project: ds-plan loaded `sas-etl.md` and `postgres-vs-sas.md`, then drafted greenfield `sas/build_classification.sas`, `sas/build_mf_own.sas`, `sas/stack_mf_own.sas`. The user prompted "check wrds skills and references for ownership" — which surfaced `skills/wrds/examples/voting_ownership_pipeline/` (7 files, complete SGE pipeline, production-proven) covering nearly every greenfield task verbatim. Days of reinvention avoided only because the user caught it.

Rule references teach syntax. Domain references teach the recipe. Examples ARE the recipe, already tested.

## Examples

Correct — wrds skill in play, task is S12 institutional holdings:

```
1. Glob skills/wrds/references/*.md
   → tfn-ownership.md matches "holdings" → load
   → sas-etl.md (rule ref) → load
2. Glob skills/wrds/examples/**
   → voting_ownership_pipeline/ matches "ownership" → Read its README.md
3. Decision: ADOPT voting_ownership_pipeline/build_inst_own.sas + build_mflinks.sas verbatim;
   PATCH merge_panel.py for the new date window.
4. PLAN.md "External Skill Discovery" section records the adoption and path.
```

Incorrect — same task:

```
1. Load sas-etl.md and postgres-vs-sas.md (rule refs only).
2. Draft greenfield sas/build_mf_own.sas — reinventing voting_ownership_pipeline.
3. PLAN.md has no External Skill Discovery section.
```

## Facts (incident-derived)

- "I'll search examples if I get stuck" never fires: greenfield drafting doesn't get stuck — it silently produces worse code than the existing example, and it passes review because no one knows it could have been better. Discovery is a planning-time obligation, not a fallback.
- Patching a battle-tested example beats greenfielding ~9 times out of 10: SGE parameters, hash table sizes, and WHERE patterns are already tuned. PATCH and document the delta in PLAN.md.
- The filesystem, not memory of it, is ground truth — new examples get added and references get renamed, so "I know what's in the skill" without globbing is an unverified competence claim. The glob takes 2 seconds.
- A comment noting the example creates no enforcement; the PLAN.md External Skill Discovery section does — the plan reviewer checks it and implementers follow it.
- The pattern is skill-agnostic: a `gemini_batch_*.py`, LSEG, or NotebookLM task drafted without reading `skills/<skill>/examples/` repeats the same reinvention as the SAS case.

## Cross-references

- **ds-data-pull-profile** — Step 5c fires AFTER this Step 5b. An external skill example may already encode the correct pull strategy (server-side pipeline, SQL GROUP BY, or documented pull-raw). When the discovered example is a server-side pipeline (e.g. `skills/wrds/examples/voting_ownership_pipeline/`), the profiling subagent's recommendation should be ADOPT/PATCH that pipeline rather than a greenfield pull. When the example is a raw pull, profiling still fires to confirm the example's scale assumptions still hold for your date range / filter.
