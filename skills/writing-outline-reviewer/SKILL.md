---
name: writing-outline-reviewer
description: "Legacy-only conversion helper for archived master-outline episodes. It is never selected in a canonical writing episode."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Agent
---

# Legacy Outline Conversion Reviewer

This helper inspects a **legacy-only** `.planning/OUTLINE.md` and any `outlines/` deliverables only as conversion provenance. Canonical writing uses the receipt-selected generated plan’s document structure and claim-to-section map, then a whole-plan review. It never uses this helper to create a review marker or to authorize drafting.

## Admission

Use the layout classifier first. Continue only for `legacy-only` conversion. For canonical state, dispatch the canonical whole-plan reviewer. For a mixed conflicting layout, fail closed rather than merging sources of authority.

## Procedure

1. Read the legacy master outline and detailed `outlines/` files as provenance.
2. Dispatch a read-only reviewer to report claim coverage, section purposes, transitions, scope drift, evidence mapping, and incomplete detailed outlines.
3. Return conversion findings to the caller. Do not modify the legacy files, create `.planning/OUTLINE_REVIEWED.md`, or begin drafting.
4. Carry valid structure into a new native writing plan’s `## Document Structure`, `## Claim → Section Map`, `## Section Outputs`, and `## Review Surfaces`.
5. Require fresh native approval and the canonical independent whole-plan review before implementation. Detailed outlines remain normal `outlines/` project deliverables.

## Return format

```text
Legacy outline conversion findings
- Legacy inputs: [paths]
- Reusable structure and mappings: [findings]
- Gaps to resolve in the new plan or detailed outlines: [findings]
- Next action: author and approve a fresh canonical writing plan
```

## Red flags

| About to | Stop because | Do instead |
|---|---|---|
| Invoke this for canonical writing | It promotes retired master-outline authority | Use canonical whole-plan review. |
| Write an outline review marker | It creates a retired gate artifact | Return findings to the converter. |
| Treat a legacy outline as implementation authorization | Only an approved canonical plan authorizes work | Convert and obtain fresh approval. |
