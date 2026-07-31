---
name: writing
description: "Use when starting or resuming a writing project, gathering sources for a paper, or routing a document through planning, drafting, review, and revision."
allowed-tools: Read, Grep, Glob, Bash, Skill, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Workflow, TaskCreate, TaskUpdate, TaskList, TaskGet
hooks:
  PreToolUse:
    - matcher: "Read|Glob|Grep|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/clarify-before-recon-guard.ts --workflow writing"
    - matcher: "Edit|Write|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow writing"
    - matcher: "Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow writing"
  PostToolUse:
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow writing"
---

# Writing

Entry point for writing projects. Quick inline edits may route directly to `writing-general`; project mode follows the authenticated native-plan lifecycle below.

## Iron Law: One Writing Specification

**NO WRITING IMPLEMENTATION WITHOUT THE EXACT GENERATED PLAN AUTHENTICATED AND INDEPENDENTLY APPROVED BY `.planning/.state/review.json`.**

For a new writing episode:

- The safe generated `.planning/<native-name>.md` selected by `review.json` is the sole substantive planning specification.
- The combined hidden receipt binds its exact `plan_file`, `plan_hash`, writing identity, native approval session/time, and independent review session/time.
- TaskList owns phase, progress, blockers, verification, retries, and review findings.
- `outlines/`, `drafts/`, and `references/` contain the domain artifacts.
- `.planning/.state/writing.json` or `.planning/.state/writing-section-index.json` may hold narrow, disposable machine state only when a hook or runner needs filesystem-visible state.

Do not create new `PRECIS.md`, `OUTLINE.md`, `ACTIVE_WORKFLOW.md`, `PRECIS_REVIEWED.md`, `OUTLINE_REVIEWED.md`, review ledgers, phase summaries, or mutable status fields. Copying PLAN content into another file creates competing authority and is prohibited.

## Required PLAN Grammar

The native plan must contain each exact heading once:

```markdown
## Writing Intent
## Claims
## Counterarguments
## Document Structure
## Claim → Section Map
## Source Plan
## Section Outputs
## Review Surfaces
```

The grammar is deterministic:

- **Writing Intent** defines `Thesis:`, `Audience:`, `Purpose:`, `Hook:`, `Scope:`, and `Domain:` (`legal`, `econ`, or `general`).
- **Claims** defines unique stable `CLAIM-NN` identifiers.
- **Counterarguments** states the strongest objections and planned responses.
- **Document Structure** contains one ordered `### Section Name` heading per output section.
- **Claim → Section Map** is a table with one primary section for every claim.
- **Source Plan** defines `Bibliography:`, explicit `Notebook:` and `Notebook URL:` values (`none` is allowed), and `Key Sources:`.
- **Section Outputs** is a table with `Section | Outline | Draft | Depends On`; dependencies must point backward to named sections.
- **Review Surfaces** lists what independent reviewers and the user will inspect.

`scripts/writing/writing_section_index.py` is the only canonical grammar parser. There is no LLM discovery fallback and no canonical fallback to retired files.

## Lifecycle

```text
CLARIFY → gather/materialize sources → native Plan approval → independent whole-plan review
        → detailed section outlines → deterministic section-index compile
        → writing-draft → verification → independent writing-review
        → /writing-revise → returned human review surface
```

1. Clarify thesis or angle, audience, purpose, scope, exclusions, source expectations, deliverables, evidence, and review surfaces before reconnaissance.
2. Gather sources through the librarian workflow and materialize real source artifacts under `references/`.
3. Load `writing-setup` to enter native Plan mode and produce the required grammar. Do not write a substitute planning document.
4. After approval, dispatch one independent whole-plan reviewer. Implementation waits for an `APPROVED` hash-bound `review.json` from a distinct reviewer session.
5. Load `writing-outline` for detailed section outlines, then `writing-draft`. Its PLAN-based mechanical probe and semantic source verification replace the retired marker-based validation hop; proceed directly to independent `writing-review`, then `/writing-revise`.
6. Represent live work as TaskList items bound to `planHash` and stable section/claim identifiers.

## Resume and Compatibility

Classify before resuming:

- **Canonical:** `review.json` selects and authenticates one generated plan path/hash. Resume from that identity plus TaskList. If review is pending, resume at whole-plan review; if approved, resume current-hash TaskList work.
- **Legacy-only:** one or more retired writing planning files exist without an authenticated generated plan. Preserve them unchanged as conversion input, build a new native plan, obtain fresh approval, and obtain fresh independent review. Legacy files never authorize implementation.
- **Canonical with legacy provenance:** canonical state remains the only authority; retired files may be read only to explain history. Never merge them into the live specification.
- **Conflicting authority:** any caller, hook, or workflow attempts to use canonical PLAN and a retired file as active inputs. Stop and identify both paths; do not choose or merge automatically.

Structural changes—including thesis, claim set, document order, claim homes, source configuration, section outputs, or dependencies—require a replacement native plan and fresh independent review. The immutable PLAN is never patched.

## Source Gathering

All source searches go through the `workflows:librarian` agent. Clarify angle and audience first, decompose the question into independent themes, search in parallel, deduplicate results, and materialize the authoritative inputs under `references/`. Training-data recall is not a source.

## Gate

Before implementation:

1. **IDENTIFY** the exact generated `plan_file` and `plan_hash` in `.planning/.state/review.json` (exposed as `planFile` and `planHash` by the compiled section index).
2. **RUN** approved-artifact admission for `writing` and compile the deterministic section index from that exact path.
3. **READ** the exact path/hash, parser diagnostics, and whole-plan verdict.
4. **VERIFY** required headings, stable claims, exact mappings, outputs, dependencies, workflow identity, chronology, and distinct sessions.
5. **CLAIM** readiness only when admission and compilation both pass. Otherwise return to planning or conversion.

Skipping authentication to appear faster is anti-helpful: it lets stale or competing prose silently control a document the user believes was approved.
