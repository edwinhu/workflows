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
5. Exit Plan mode. The metadata-only binding hook — `approved-artifact-persist`, registered by `skills/writing/SKILL.md` on `PostToolUse: ExitPlanMode`, and by `hooks/hooks.json` plugin-wide, **not by this skill**, whose own frontmatter registers only `writing-precis-guard` — hashes those existing bytes and initializes `.planning/.state/review.json` as `PENDING`; it never copies the plan or writes `plan.json`. If it cannot determine the approved plan path it now exits **2** with `NO RECEIPT WAS WRITTEN`: stop and report, because re-approving cannot fix it.
6. Dispatch an independent whole-plan reviewer with that exact path. The reviewer preserves approval-owned receipt fields and finalizes only status, reviewer session, and review time.
7. **Offer the matching output style — once per project, only after the receipt reads `APPROVED`.** Ask with `AskUserQuestion` whether to set the project's `outputStyle` to the register the plan declares, and default to **yes**. On yes, run `bun ${CLAUDE_PLUGIN_ROOT}/scripts/set-output-style.ts <projectRoot>` and report its output verbatim; on no, or on a refusal, say so in one line and move on. Never retry with different content, and never hand-edit `.claude/settings.local.json` yourself — see the gate below.
8. End the approval/review episode. In a fresh third session distinct from approval and review, authenticate the final receipt, reconcile approved sections into TaskList by `planFile`, `planHash`, and stable section name, and delegate `writing-outline` work to authorized implementation agents.

### Why step 7 sits here and not in CLARIFY

**IRON LAW: NO `outputStyle` WRITE FROM AN UNAPPROVED STYLE — AND THE STYLE COMES FROM THE PLAN, NOT FROM THE ANSWER.**

At CLARIFY the domain is an *answer*; it becomes authority when the receipt reads `APPROVED`. Every other consumer already reads it from there — `hooks/writing-prose-check.ts` picks `--style` from `authenticatedWritingPlan().style`, and `workflows/writing-draft.js` throws when the compiled section index disagrees with the plan's Writing Intent. Writing the setting from a clarify answer the user then revised during planning would leave the main conversation in one register while every gate enforced another, with nothing reporting the split.

`set-output-style.ts` therefore takes **no style argument**: it derives one through the same `authenticatedWritingPlan()` and refuses outright when there is no approved plan. That is `.claude/CLAUDE.md`'s *derive before you record* enforced in code rather than asserted in a skill.

**It takes effect next session, and that is why it runs at the end of this episode.** The output style is part of the system prompt, which Claude Code reads once at session start. Step 8 already requires a fresh session before implementation, so the boundary the setting needs is one this workflow was taking anyway. Compare `plans-directory-restart-gate.ts`, which had to become a *gate* because a mid-session `plansDirectory` left the episode unauthenticated and an advisory line measurably lost to the task in progress. This is prose voice, not authentication — the drafting and reviewing subagents get the same register through the preloaded `writing-register` skill either way — so a notice is proportionate where a gate would not be.

| Action | Why wrong | Do instead |
|---|---|---|
| Set `outputStyle` during CLARIFY | The domain is not authority until the receipt is `APPROVED` | Ask at step 7 |
| Pass the domain to `set-output-style.ts` | It would outrank the plan, silently | It takes a project root and derives the rest |
| Hand-edit `.claude/settings.local.json` | It carries `permissions`, it outranks project settings, and Claude Code git-excludes it — a clobber is damaging and invisible to `git status` | Run the script; it merges one key and refuses on unparseable JSON |
| Report the style as active in this session | It is not; the system prompt was read at session start | Quote the script's own notice |

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
