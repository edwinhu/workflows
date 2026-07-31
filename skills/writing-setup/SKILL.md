---
name: writing-setup
description: Internal writing phase that converts clarified intent and materialized sources into the authenticated native writing plan.
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-precis-guard.ts"
---

# Writing Setup

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts writing-setup`

Build the sole writing specification through native Plan mode. This phase does not mutate domain paths or create précis, master-outline, workflow-marker, or review-marker files.

## Prerequisites

- The user confirmed angle, audience, purpose, scope, and exclusions.
- Sources are materialized under `references/`.
- The applicable legal, econ, or general document-structure guidance is loaded before choosing document structure.

## Iron Law

**NO WRITING PLAN WITHOUT MATERIALIZED SOURCES, AND NO SECTION IMPLEMENTATION BEFORE NATIVE PLAN APPROVAL AND INDEPENDENT WHOLE-PLAN REVIEW.**

A substitute Markdown planning file cannot satisfy either gate.

## Process

1. Confirm required source artifacts already exist under `references/`; setup itself does not mutate project domain paths. The approved implementation session delegates creation of any missing `outlines/`, `drafts/`, or `scratch/` directories to an authorized implementation agent.
2. Confirm the thesis, strongest counterarguments, audience, purpose, hook, scope, and domain.
3. Read the domain skill's document-structure guidance.
4. Enter native Plan mode and produce one native generated `.planning/<name>.md` specification with the exact grammar below. Retain the exact path returned by the completed Plan interaction.
5. Exit Plan mode. The metadata-only binding hook hashes those existing bytes and initializes `.planning/.state/review.json` as `PENDING`; it never copies the plan or writes `plan.json`.
6. Dispatch an independent whole-plan reviewer with that exact path. The reviewer preserves approval-owned receipt fields and finalizes only status, reviewer session, and review time.
7. End the approval/review episode. In a fresh third session distinct from approval and review, authenticate the final receipt, reconcile approved sections into TaskList by `planFile`, `planHash`, and stable section name, and delegate `writing-outline` work to authorized implementation agents.

## Exact PLAN Template

```markdown
# [Working Title]

## Writing Intent
- **Thesis**: [one-sentence argument]
- **Audience**: [reader and prior knowledge]
- **Purpose**: [what the reader should conclude or do]
- **Hook**: [concrete opening problem or finding]
- **Scope**: [included and excluded ground]
- **Domain**: [legal | econ | general]

## Claims
- **CLAIM-01**: [claim and how it supports the thesis]
- **CLAIM-02**: [claim]

## Counterarguments
- [strongest objection] → [planned response and primary section]

## Document Structure
### Introduction
[goal and role]

### Part I. [Name]
[goal, role, transition]

### Part II. [Name]
[goal, role, counterargument response, transition]

### Conclusion
[payoff]

## Claim → Section Map
| Claim | Section |
|---|---|
| CLAIM-01 | Part I. [Name] |
| CLAIM-02 | Part II. [Name] |

## Source Plan
- **Bibliography**: references/sources.bib
- **Notebook**: [UUID or none]
- **Notebook URL**: [URL or none]
- **Key Sources**: [stable bibkeys or named authoritative inputs]

## Section Outputs
| Section | Outline | Draft | Depends On |
|---|---|---|---|
| Introduction | outlines/Introduction.md | drafts/Introduction (Draft).md | - |
| Part I. [Name] | outlines/Part I. [Name].md | drafts/Part I. [Name] (Draft).md | Introduction |
| Part II. [Name] | outlines/Part II. [Name].md | drafts/Part II. [Name] (Draft).md | Part I. [Name] |
| Conclusion | outlines/Conclusion.md | drafts/Conclusion (Draft).md | Part II. [Name] |

## Review Surfaces
- [whole-plan claim/structure/source review]
- [draft evidence and prose review]
- [final user review surface]
```

Every claim appears exactly once in the map. Every structural section appears exactly once in Section Outputs. Every dependency points to an earlier named section. Paths are concrete, project-relative, traversal-free, and place detailed outlines/drafts outside `.planning/`.

## Conversion

If retired writing files exist without an authenticated generated plan, read them only as evidence for a proposed native plan. Preserve them unchanged. Approval of the new plan does not retroactively authenticate the old files, and an independent review is still mandatory. If a caller tries to supply both the receipt-selected generated plan and a retired planning file as active authority, stop as a conflict.

## Review Boundary

The independent whole-plan review replaces separate précis and master-outline approvals. It checks the complete hash-bound unit: intent, claims, counterarguments, structure, mappings, source configuration, outputs, dependencies, and review surfaces. Issues replace the proposed plan through native Plan mode; they are not patched into the approved PLAN.

## Gate

Compile the exact approved plan with `scripts/writing/writing_section_index.py`. Missing headings, duplicate claims, dangling maps, invalid outputs, forward dependencies, malformed authentication, or conflicting active inputs fail closed. Only an authenticated, compiled, independently approved plan advances.
