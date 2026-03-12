# Investigation: Workflow-Creator Common Enforcement Gap

**Date:** 2026-03-12
**Trigger:** Four course-materials teaching skills (slides-edit, notes-edit, lecture-prep, lecture-prep-edit) each had their own copy of the same Iron Laws. Running lecture-prep didn't enforce what slides-edit enforced — the user had to invoke multiple skills to get consistent quality. Had to manually extract to `references/common-constraints.md`.

## The distinction

- **skill-creator** creates individual skills — not responsible for cross-skill concerns
- **workflow-creator** creates skill families (groups/series) — responsible for ensuring consistent enforcement across the family

The fix belongs in workflow-creator.

## What workflow-creator had before

Shared enforcement awareness existed, but only for the **entry/midpoint pair**:

- "Shared Constraint Files" section: extract shared checks when entry and midpoint evaluate the same quality dimensions
- Iron Law: "NO DUPLICATE CONSTRAINTS BETWEEN ENTRY AND MIDPOINT"
- Red Flag for inlining the same check in both entry and midpoint

## The gap

The enforcement model was **hardcoded to the entry/midpoint pair topology**. But a skill family can have N skills sharing a domain:

| Topology | Example | Shared enforcement? |
|----------|---------|---------------------|
| Entry + midpoint (2 skills) | `/dev` + `/dev-debug` | Yes |
| Family of N domain skills | slides-edit, notes-edit, lecture-prep, lecture-prep-edit | **No** |

The real problem isn't duplication per se — it's that **each skill enforced its own version of the rules**. lecture-prep could miss checks that slides-edit caught, meaning the user had to run multiple skills to get what any single skill should have provided.

## Root cause

The mental model was "workflow = entry + midpoint." Real-world plugins have skill families where every skill needs the same guardrails. Without a shared enforcement file, each skill's enforcement drifts independently.

## Fix applied

Generalized workflow-creator to handle skill families, not just entry/midpoint pairs:

1. **Iron Law** → "NO SKILL FAMILY WITHOUT SHARED ENFORCEMENT" — if multiple skills operate on the same domain, common enforcement lives in a shared file
2. **Step 4b** → "Common Enforcement Across Skill Families" — scan sibling skills when creating new ones, extract or inherit shared enforcement
3. **Shared Constraint Files section** → reframed around consistent enforcement, not deduplication
4. **Mode 2 audit** → checks whether users get inconsistent enforcement depending on which skill they invoke
5. **Mode 3 fix** → "Skills sharing a domain without shared enforcement" as a gap to remediate
6. **Red Flags / Rationalization Table** → updated with the teaching plugin as the cautionary example

## Key insight

The concern isn't "don't copy-paste" — it's "every skill in a domain should enforce the full rule set." A user invoking lecture-prep should get the same enforcement as invoking slides-edit + notes-edit. Shared enforcement files make this automatic.
