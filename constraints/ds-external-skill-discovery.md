---
name: ds-external-skill-discovery
description: Before /ds commits native-plan work that uses another skill or data provider, discover its relevant references and examples, then record an ADOPT, PATCH, or GREENFIELD decision in the approved plan.
applies-to: [ds, ds-fix]
---

## Rule

When `/ds` expects a task to use an external skill or provider — for example WRDS, gemini-batch,
LSEG, NLM, Readwise, document tooling, or an API — perform discovery before entering native Plan
mode. Rule references describe syntax; domain references explain the data recipe; examples preserve
working implementations. All three can change the plan.

For each skill in scope:

1. Enumerate `skills/<skill>/references/*.md`.
2. Read the domain references that match the contemplated data or task, not only generic rules.
3. Enumerate `skills/<skill>/examples/**`.
4. Read the README or entrypoint for every example that plausibly matches the work.
5. Select **ADOPT**, **PATCH**, or **GREENFIELD**. Record the example path and, for PATCH or
   GREENFIELD, the exact delta or reason in the native plan before `ExitPlanMode`.

**NO APPROVED NATIVE PLAN WITH EXTERNAL-SKILL WORK UNTIL DISCOVERY IS RECORDED.** “I will look for
examples if I get stuck” does not happen: greenfield work can look plausible without ever revealing
that a production pattern already exists. Recreating it is anti-helpful to the user and the later
implementer.

Use the native plan's natural section structure. Do not create a separate discovery ledger or a
custom plan table. The immutable copied `.planning/PLAN.md` records the approved choice; reusable
provider facts may be curated into project auto-memory only when they will help later work.

## Native-plan record

```markdown
## External skill decisions

| Skill | Domain references read | Example examined | Decision | Reuse path / delta |
|---|---|---|---|---|
| wrds | `tfn-ownership.md`, `sas-etl.md` | `examples/voting_ownership_pipeline/README.md` | PATCH | Reuse pipeline; change date window and add classification field |
```

A plan that declares no external skills may state that explicitly.

## Facts

- In mirror-voting v12, planning loaded generic SAS rules and drafted three greenfield ownership
  scripts. The later discovery of `skills/wrds/examples/voting_ownership_pipeline/` covered nearly
  every task. The user caught days of avoidable reinvention.
- Battle-tested examples already encode SGE parameters, hash sizes, and filtering patterns. PATCH
  is usually safer than recreating those decisions.
- The filesystem is the source of truth: references are renamed and examples are added. A two-second
  enumeration beats an unverified memory claim.

## Cross-reference

Run **ds-data-pull-profile** after discovery when a source is large or uncertain. A discovered
server-side example is a candidate in the raw-versus-aggregate comparison, not an excuse to skip it.
