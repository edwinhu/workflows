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

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The rule references tell me how to write SAS, that's enough" | Rule refs teach syntax, not recipes. The recipe for holdings→permno-quarter aggregation is in `tfn-ownership.md` AND in `voting_ownership_pipeline/`. | Load BOTH rule refs AND domain refs AND check examples. |
| "I'll search examples if I get stuck" | You won't get "stuck" — you'll silently draft worse code than the example, and it'll pass review because no one will know it could have been better. | Search examples BEFORE drafting, not after. |
| "The example is for a different year / slightly different task" | Patching a battle-tested example beats greenfielding from scratch 9 times out of 10. The example has SGE parameters, hash table sizes, and WHERE patterns already tuned. | PATCH the example. Document the delta in PLAN.md. |
| "Globbing is a waste of time, I know what's in the skill" | You don't. New examples get added, references renamed. The `examples/` directory IS the ground truth. | Glob every time. 2 seconds. |
| "I'll note the example in a comment" | Comments don't create enforcement. PLAN.md section creates enforcement — the plan reviewer checks it, implementers follow it. | Write the decision in the External Skill Discovery section of PLAN.md. |

## Red Flags — STOP If You Catch Yourself

- About to draft a SAS / Python / R script from scratch without first `Glob`bing `skills/<skill>/examples/` → STOP. That directory exists specifically to prevent reinvention.
- Loaded only rule refs (`sas-etl.md`, `postgres-vs-sas.md`) and proceeding to task breakdown → STOP. You loaded rule refs, not domain refs. What's the data? What's the ref for that data?
- About to write a `gemini_batch_*.py` / LSEG / NotebookLM task without reading `skills/<skill>/examples/` → STOP. Same pattern, different skill.
- Assumed no relevant example exists without checking → STOP. Check.

## Cross-references

- **ds-data-pull-profile** — Step 5c fires AFTER this Step 5b. An external skill example may already encode the correct pull strategy (server-side pipeline, SQL GROUP BY, or documented pull-raw). When the discovered example is a server-side pipeline (e.g. `skills/wrds/examples/voting_ownership_pipeline/`), the profiling subagent's recommendation should be ADOPT/PATCH that pipeline rather than a greenfield pull. When the example is a raw pull, profiling still fires to confirm the example's scale assumptions still hold for your date range / filter.
