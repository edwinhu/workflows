---
name: writing-precis-reviewer
description: "Legacy-only conversion helper for archived writing précis episodes. It is never selected in a canonical writing episode."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Agent
---

# Legacy Precis Conversion Reviewer

This helper exists only to inspect an archived, **legacy-only** `.planning/PRECIS.md` as conversion input. A canonical writing episode uses one receipt-selected immutable generated plan and whole-plan review; it must not invoke this skill, create a précis review marker, or treat a précis as active authority.

## Admission

Before dispatching, use the layout classifier. Proceed only when it reports `legacy-only` and the caller is preparing conversion. If canonical state exists, stop and use the canonical writing plan-review flow. If legacy and canonical files conflict, fail closed; never merge them.

## Procedure

1. Read the legacy précis solely as provenance.
2. Dispatch a read-only reviewer to identify thesis, distinct claims, counterarguments, scope, audience, source support, placeholders, and contradictions.
3. Return findings to the caller; do not write `.planning/PRECIS_REVIEWED.md`, modify the legacy file, or authorize outlining/drafting.
4. The caller carries the usable findings into a newly authored native plan with `## Writing Intent`, `## Claims`, `## Counterarguments`, `## Source Plan`, and related required sections.
5. Require fresh native approval and the canonical independent whole-plan review before implementation.

## Return format

```text
Legacy précis conversion findings
- Legacy input: [path]
- Reusable intent / claims / counterarguments: [findings]
- Gaps to resolve in the new plan: [findings]
- Next action: author and approve a fresh canonical writing plan
```

## Red flags

| About to | Stop because | Do instead |
|---|---|---|
| Invoke this in a canonical episode | It revives retired authority | Use the whole-plan reviewer. |
| Write a précis review marker | It creates a competing gate | Return findings to the converter. |
| Draft or outline from the legacy précis | Conversion input is not approved current intent | Create and approve a native plan first. |
