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
    - matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow writing"
    - matcher: "Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow writing"
  PostToolUse:
    - matcher: "AskUserQuestion"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/episode-phase.ts --workflow writing"
    - matcher: "ExitPlanMode"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-persist.ts --workflow writing"
---

# Writing

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/ensure-plans-directory.ts ${CLAUDE_SESSION_ID}`

Entry point for writing projects. Quick inline edits may route directly to `writing-general`; project mode follows the authenticated native-plan lifecycle below.

## Write surface: main chat does not do the work

**You may Write/Edit only under `.planning/` and `.claude/`. Every other file — drafts, outlines,
sources — is written by a dispatched agent.** `orchestrator-mutation-guard` is registered in this
skill's frontmatter, so the attempt is REFUSED, not corrected: a write you try anyway costs a turn
and produces nothing. Reach for `Agent` first, not after a denial.

Two narrow exceptions: the generated plan while you are IN Plan mode, and `.claude-workflows.json`
when adopting governance.

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
CLARIFY → PLAN → IMPLEMENT → VERIFY → REVIEW
```

## 1. CLARIFY

Read `${CLAUDE_SKILL_DIR}/../beat-clarify/SKILL.md` and follow it — it owns the question set, the
stop condition, and how confirmed intent is carried forward as evidence. The
`clarify-before-recon-guard` hook enforces that this happens; the beat defines what it is. Clarify
thesis or angle, audience, purpose, scope, exclusions, source expectations, deliverables, evidence,
and review surfaces before reconnaissance.

**Gate:** thesis, audience, purpose, scope, exclusions, deliverables, evidence, and review surfaces
are explicit enough to enter native Plan mode without guessing.

## 2. PLAN

Read `${CLAUDE_SKILL_DIR}/../beat-plan/SKILL.md`, then `${CLAUDE_SKILL_DIR}/../writing-setup/SKILL.md`,
then `${CLAUDE_SKILL_DIR}/../writing-plan-reviewer/SKILL.md`.

1. Gather sources through the librarian workflow and materialize real source artifacts under
   `references/`. All source searches go through the `workflows:librarian` agent. Clarify angle and
   audience first, decompose the question into independent themes, search in parallel, deduplicate
   results, and materialize the authoritative inputs under `references/`. Training-data recall is
   not a source.
2. Load `writing-setup` to enter native Plan mode and produce the required grammar. Do not write a
   substitute planning document.
3. After approval, dispatch one independent whole-plan reviewer. Implementation waits for an
   `APPROVED` hash-bound `review.json` from a distinct reviewer session.

Before implementation:

1. **IDENTIFY** the exact generated `plan_file` and `plan_hash` in `.planning/.state/review.json` (exposed as `planFile` and `planHash` by the compiled section index).
2. **RUN** approved-artifact admission for `writing` and compile the deterministic section index from that exact path.
3. **READ** the exact path/hash, parser diagnostics, and whole-plan verdict.
4. **VERIFY** required headings, stable claims, exact mappings, outputs, dependencies, workflow identity, chronology, and distinct sessions.
5. **CLAIM** readiness only when admission and compilation both pass. Otherwise return to planning or conversion.

Skipping authentication to appear faster is anti-helpful: it lets stale or competing prose silently control a document the user believes was approved.

**Gate:** admission and deterministic section-index compilation both pass against the
receipt-selected `planFile` and `planHash`, and every source the plan relies on exists under
`references/`.

## 3. IMPLEMENT

Read `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md`, then
`${CLAUDE_SKILL_DIR}/../writing-outline/SKILL.md` for detailed section outlines, then
`${CLAUDE_SKILL_DIR}/../writing-draft/SKILL.md`. Represent live work as TaskList items bound to
`planHash` and stable section/claim identifiers.

**Gate:** every section named by `## Section Outputs` has its outline and draft produced under the
authenticated `planHash`, with TaskList holding the complete current-plan task set.

## 4. VERIFY

Read `${CLAUDE_SKILL_DIR}/../beat-verify/SKILL.md`, then
`${CLAUDE_SKILL_DIR}/../writing-verify/SKILL.md`. `writing-draft`'s PLAN-based mechanical probe and
semantic source verification replace the retired marker-based validation hop; proceed directly to
independent `writing-verify`, then `/writing-revise`.

**Gate:** independent `writing-verify` reports no open finding against the current `planHash`, and
every `/writing-revise` fix is re-verified rather than self-attested.

## 5. REVIEW

Read `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`, then
`${CLAUDE_SKILL_DIR}/../writing-accept/SKILL.md` for terminal human acceptance. Independent machine
review is not a person's acceptance; the adapter carries the domain framing over `beat-review`.

**Gate:** the user has accepted the deliverable, TaskList has no open current-plan item, and no
`REJECT:` remains.

## Resume and Compatibility

Classify before resuming:

- **Canonical:** `review.json` selects and authenticates one generated plan path/hash. Resume from that identity plus TaskList. If review is pending, resume at whole-plan review; if approved, resume current-hash TaskList work.
- **Legacy-only:** one or more retired writing planning files exist without an authenticated generated plan. Preserve them unchanged as conversion input, build a new native plan, obtain fresh approval, and obtain fresh independent review. Legacy files never authorize implementation.
- **Canonical with legacy provenance:** canonical state remains the only authority; retired files may be read only to explain history. Never merge them into the live specification.
- **Conflicting authority:** any caller, hook, or workflow attempts to use canonical PLAN and a retired file as active inputs. Stop and identify both paths; do not choose or merge automatically.

Structural changes—including thesis, claim set, document order, claim homes, source configuration, section outputs, or dependencies—require a replacement native plan and fresh independent review. The immutable PLAN is never patched.
