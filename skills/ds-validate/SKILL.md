---
name: ds-validate
description: "Validate analysis outputs against SPEC.md requirements using DQ checks."
user-invocable: false
disable-model-invocation: true
hooks:
  PostToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-post-subagent-guard.py"
  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-pre-subagent-clear.py"
    - matcher: "Read"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.py"
    - matcher: "Grep"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.py"
    - matcher: "Glob"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.py"
    - matcher: "Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.py"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.py"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.py"
    - matcher: "Agent|Workflow"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/IMPLEMENT_COMPLETE.md
            GATE_STATUS=COMPLETE
            GATE_DESCRIPTION="Implementation complete"
            GATE_REMEDY="Finish ds-implement (all PLAN.md tasks verified in LEARNINGS.md) before validating outputs."
            GATE_BLOCKED_TOOLS=Agent,Workflow
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
    - matcher: "Workflow"
      hooks:
        - type: command
          command: "FLOOR=ds uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/mechanical-floor-gate.py"
---

Announce: "Using ds-validate (Phase 3.5) to validate analysis outputs against SPEC.md requirements."

## Contents

- [The Iron Law of Validation](#the-iron-law-of-validation)
- [Validation Facts](#validation-facts)
- [Key Difference from Dev](#key-difference-from-dev)
- [The Process](#the-process)
- [Validation Levels](#validation-levels)
- [Classification](#classification)
- [VALIDATION.md Template](#validationmd-template)
- [Gate](#gate)
- [Phase Transition](#phase-transition)

# Output Validation Against SPEC.md

Phase 3.5 of the DS workflow (between implement and review). Maps every SPEC.md requirement to an output artifact and runs data quality checks.

<EXTREMELY-IMPORTANT>
## The Iron Law of Validation

**NO REVIEW WITHOUT VALIDATION. This is not negotiable.**

ds-review MUST NOT start until `.planning/VALIDATION.md` confirms all requirements have outputs. Validation is the DS equivalent of test coverage — without it, review is theater.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Validation Facts

- Per-task checks during implement miss cross-task issues — joins that silently drop rows and filters that compound only surface in the end-to-end requirement-to-output mapping.
- LEARNINGS.md logs observations; VALIDATION.md maps requirements to outputs. They serve different purposes — one cannot substitute for the other.
- Row-count traceability cannot be eyeballed — "outputs look fine" is not a validation result, and review run on unvalidated outputs either misses the gaps or re-runs the same checks.
</EXTREMELY-IMPORTANT>

## Key Difference from Dev

DS validation does NOT auto-fill gaps. Dev's test-gap-auditor can write missing tests. DS gaps require human judgment — a wrong output means a wrong analysis, not just a missing test. When gaps are found, present them to the user and let the user decide: fix (return to implement) or accept (proceed to review).

## Static Analysis (Constraint Check Scripts)

Before running runtime DQ checks, run the static analysis constraint check suite:

```bash
bash "${CLAUDE_SKILL_DIR}/../../scripts/check-all-ds.sh" "$(pwd)"
```

This runs all DS constraint check scripts (determinism, join audits, idempotency, error handling, schema contracts, standard errors, visualization integrity).

**If any check FAILS:** Report the failures in LEARNINGS.md. These are code quality issues in the analysis scripts that must be fixed before proceeding. Dispatch a fix subagent if needed. This is **hook-enforced**, not just prose: `mechanical-floor-gate.py` (FLOOR=ds, wired on the Workflow matcher) re-runs `check-all-ds.sh` and DENIES the `ds-validate-coverage` fan-out until the floor is clean. It gates the Workflow only — Agent (the fix subagent) stays free so you can actually fix the failures.

**If all checks PASS:** Proceed to runtime DQ checks.

## The Process

**This flowchart IS the specification. If prose elsewhere and this diagram disagree, the diagram wins.**

```
   ┌──────────────────────────────────────────────┐
   │ 0. RUN static analysis suite (check-all-ds.sh)│
   └───────────────────┬──────────────────────────┘
              all pass? │
        ┌──── no ───────┴────── yes ──────┐
        ▼                                  ▼
 ┌──────────────────┐   ┌───────────────────────────────────┐
 │ log to LEARNINGS │   │ 1-4. READ SPEC / PLAN / LEARNINGS, │
 │ + dispatch fix   │   │ DISCOVER ds-checks.md              │
 │ subagent, re-run │   └─────────────────┬─────────────────┘
 └────────┬─────────┘                     ▼
          │              ┌────────────────────────────────────┐
          │              │ 5. RUN ds-validate-coverage workflow│
          │              │ (one read-only validator/requirement│
          │              │  → JS gate, NOT a hand-tallied score)│
          │              └─────────────────┬──────────────────┘
          │                                ▼
          │              ┌────────────────────────────────────┐
          │              │ 6. RENDER .planning/VALIDATION.md   │
          │              │ from the workflow result            │
          │              └─────────────────┬──────────────────┘
          │                       JS gate   │
          │            ┌── gaps_found ───────┴── validated ──┐
          │            ▼                                     ▼
          │   ┌──────────────────────┐         ┌──────────────────────┐
          └──▶│ decision checkpoint: │         │ proceed to ds-review  │
              │ user fix-vs-accept   │         │ (gate: status=        │
              │ (see Gate section);  │         │  validated)           │
              │ accept ⇒ flip status │         └──────────────────────┘
              │ to validated         │
              └──────────────────────┘
```

> **Note:** Steps 1-4 stay in this skill as the reading/discovery preamble — the workflow's own Discover phase re-resolves them authoritatively, but reading them here lets the skill present context and decide scope before invoking the workflow.

### Step 1: Read Requirements

Read `.planning/SPEC.md` and extract every requirement:

```
For each requirement in SPEC.md:
  - Extract the requirement description
  - Note the success criteria
  - Note the expected output (table, figure, file, etc.)
```

### Step 2: Read Plan

Read `.planning/PLAN.md` and extract:
- Task-to-requirement mapping
- Output file locations mentioned
- Key columns and data structure decisions

### Step 3: Read Learnings

Read `.planning/LEARNINGS.md` and extract:
- Pipeline row counts at each stage (needed for DQ4 traceability)
- Data quality observations from implementation
- Any known issues or caveats

### Step 4: Load DQ Check Definitions

Read `${CLAUDE_SKILL_DIR}/../../skills/ds-implement/references/ds-checks.md` and follow its instructions.

### Step 5: Run the ds-validate-coverage workflow (per-requirement fan-out + JS gate)

The per-requirement DQ fan-out and the COVERED/PARTIAL/MISSING + `validated|gaps_found` gate are owned by a **ultracode workflow** — a script, not hand-dispatched agents. This is why: the validators return RAW DQ statuses and the **gate is computed in pure JS from those statuses**, so the model can no longer tally the composite by hand (the old honor-system gate). The workflow also isolates one validation transcript per requirement out of main context.

**1. Resolve the cached workflow path:**

```bash
WF=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/workflows/ds-validate-coverage.js 2>/dev/null | sort -V | tail -1)
# Local-plugin fallback (running from source, cache empty):
[ -z "$WF" ] && WF="${CLAUDE_SKILL_DIR}/../../workflows/ds-validate-coverage.js"
echo "$WF"
```

**2. Run it** (full pass first; on a re-run after fixes, pass `onlyChecks` + `priorReviews` from the prior result):

```
Workflow({ scriptPath: "<WF>", args: { projectDir: "<abs project dir>", pluginRoot: "<abs .../workflows dir>" } })
```

The workflow fans out one **read-only** validator per in-scope SPEC requirement (running DQ1-DQ5 + M1 from `ds-checks.md`), then computes — in JS, from raw statuses — each requirement's classification and the overall `status`. It returns `{ overallPass, status, counts, scoreTable, findings, reviews, reviewersThatFlagged }`.

### Step 6: Render VALIDATION.md from the workflow result

**Do NOT recompute or rationalize the gate** — `result.status` and `result.overallPass` are computed in JS. Write `.planning/VALIDATION.md` using `result.scoreTable` as the Requirements Map, `result.counts` for the frontmatter totals, and `result.findings` under DQ Details:

```
status: <result.status>           # validated | gaps_found — verbatim from the workflow
requirements_total / covered / partial / missing: <result.counts>
Requirements Map: <result.scoreTable>
DQ Details: <result.findings>
```

**The `/goal` fix loop stays in this skill:** if `status: gaps_found`, present gaps (Step "Gate" below) and let the **user** decide fix vs accept. On a fix-and-re-validate cycle, re-run the workflow with `onlyChecks: <prev result.reviewersThatFlagged>` and `priorReviews: <prev result.reviews>` so unflagged requirements carry forward and only the gaps re-run live.

## Validation Levels

Each requirement is validated at four levels, in order:

| Level | Check | Example |
|-------|-------|---------|
| 1. Exists | Output file/variable present | `output/results.csv` exists |
| 2. Substantive | Real data, not empty | >0 rows, expected columns present |
| 3. DQ Passes | DQ1-DQ5 + UNI/DEN/DEL/ENUM pass | No dupes on key, nulls handled, row counts trace, sources agree on the universe, every rate carries its base |
| 4. Answers Question | Addresses SPEC.md requirement | Table includes specified variables |

## Classification

For each requirement, assign a classification:

| Classification | Criteria |
|---------------|----------|
| **COVERED** | All 4 validation levels pass |
| **PARTIAL** | Output exists but DQ issues found or doesn't fully address requirement |
| **MISSING** | No output found for this requirement |
| **CANNOT-FIX** | A real defect, investigated, with the remedies eliminated by measurement |

## CANNOT-FIX Is A Result, And It Must Be Recorded

The loop is *fix until fixed, or until shown unfixable* — and "unfixable" is a
finding with evidence, not a place to stop trying. A defect closed this way is
re-opened by the next person unless the eliminations are written down **with
their numbers**.

A CANNOT-FIX entry must carry, for each candidate remedy, what was measured and
why it was rejected:

```markdown
### CF-1: <defect>, <size> (<share of the data>)

| candidate remedy | verdict | measurement |
|---|---|---|
| <remedy A> | ruled out | fixes 365 rows, BREAKS 138,024 |
| <remedy B> | ruled out | source has no rows before 2006-07; 36% of the gap |
| <remedy C> | ruled out | 633 entities, no concentration; large ones cleaner |

**Left in place, not filtered.** Removing the rows would improve the coverage
statistic by deleting the evidence (see DEL).
```

**Rejecting a remedy requires a measurement, not an argument.** Every remedy
rejected on reasoning alone in the source session was later found to be wrong in
one direction or the other — including three of the assistant's own.

**Prefer surfacing to filtering.** A known-bad row that is visible is worth more
than a clean statistic that hides it, and the honest move when a defect resists
repair is a separate reporting tier, not a `WHERE` clause.

## VALIDATION.md Template

```markdown
---
status: validated | gaps_found
date: [ISO 8601]
requirements_total: N
covered: N
partial: N
missing: N
---
# Output Validation

## Requirements Map
| # | Requirement | Output | DQ1 | DQ2 | DQ3 | DQ4 | DQ5 | M1 | Classification |
|---|-------------|--------|-----|-----|-----|-----|-----|----|----------------|
| 1 | [from SPEC] | [path] | PASS | PASS | PASS | PASS | PASS | PASS | COVERED |
| 2 | [from SPEC] | [path] | PASS | WARN | PASS | PASS | PASS | PASS | PARTIAL |
| 3 | [from SPEC] | — | — | — | — | — | — | — | MISSING |

## DQ Details
[For any non-PASS check, include the specific finding]

## Summary
- Requirements: N total
- Covered: X
- Partial: Y
- Missing: Z
```

### Status Rules

| Condition | Status |
|-----------|--------|
| All requirements COVERED | `validated` |
| Any PARTIAL or MISSING remain, user has NOT yet decided | `gaps_found` |
| Gaps remain BUT the user explicitly accepted them | `validated` (+ `## Accepted Gaps` section) |

**Status `validated` means "dispositioned and cleared to proceed" — either clean, OR gaps the user explicitly accepted.** The downstream ds-review gate (`GATE_STATUS=validated`) blocks on `gaps_found`, so an undispositioned `gaps_found` cannot silently pass into review. This is the structural backstop for the decision checkpoint below — do not rely on the prose alone.

When the user accepts gaps, rewrite VALIDATION.md frontmatter `status: gaps_found` → `status: validated` and append:

```markdown
## Accepted Gaps
The user reviewed and accepted these gaps on proceeding to review:
- [REQ-ID] [PARTIAL/MISSING]: [what is incomplete and why the user accepted it]
```

## Visual Diagnostics for Decision Checkpoints

When presenting validation results to the user (especially gaps), generate diagnostic plots to accelerate the decision:

| Validation Finding | Diagnostic to Generate |
|-------------------|----------------------|
| DQ2: High-null columns | Missingness heatmap (columns × rows) |
| DQ3: Duplicate rows | Duplicate count bar chart by key columns |
| DQ4: Row count mismatch | Pipeline waterfall chart (stage × row count) |
| DQ5: Suspicious cardinality | Value frequency distribution plot |
| PARTIAL requirements | Side-by-side: expected vs actual output summary |

**When to generate:** Only at `decision` checkpoints where the user must choose fix vs accept. Do not generate plots for COVERED requirements (no decision needed).

**Format:** Inline matplotlib/seaborn plots in notebooks, or saved to `scratch/diagnostics/` for script-based workflows.

## Gate

**Checkpoint type:** human-verify (VALIDATION.md status is machine-verifiable)

`.planning/VALIDATION.md` must exist before proceeding.

- If status is `validated`: **human-verify** checkpoint — auto-advanceable; proceed to ds-review.
- If status is `gaps_found`: **decision** checkpoint — present gaps to user before proceeding.
  - User decides: **fix** (return to ds-implement) or **accept**.
  - On **accept**: rewrite VALIDATION.md to `status: validated` and append the `## Accepted Gaps` section (see Status Rules) BEFORE proceeding. The ds-review gate hooks on `status: validated` — leaving it at `gaps_found` will (correctly) block review, because an undispositioned `gaps_found` is indistinguishable from "user never decided."

### Re-validation Loop Cap

When the user chooses **fix**, the cycle ds-validate → ds-implement → ds-validate repeats. This loop is bounded — it does not cycle indefinitely. Track it in `.planning/VALIDATE_STATE.md` (analogous to ds-review's REVIEW_STATE.md):

```yaml
---
iteration: 1
max_iterations: 3
status: gaps_found        # gaps_found | validated
last_gaps: [REQ-ID, ...]  # requirement IDs still PARTIAL/MISSING
---
```

- On each re-validate, increment `iteration`.
- **After 3 cycles still in `gaps_found`, STOP looping.** Escalate to the user with a structured choice (AskUserQuestion): **fix again** (override the cap with explicit instruction), **accept remaining gaps** (flip to validated + Accepted Gaps), **record CANNOT-FIX** (see below — requires eliminations), or **rethink** (return to /ds for re-planning). Do not silently start a 4th fix cycle — repeated failure to close the same gap is a signal the plan or data is wrong, not that one more pass will help.

- **`accept remaining gaps` and `CANNOT-FIX` are not the same option.** "Accepted" means the gap is
  tolerable and nobody looked further. CANNOT-FIX means the gap was *investigated* and each candidate
  remedy was **rejected by a measurement**. Only the second closes the question; the first leaves it
  open under a friendlier name. If the loop is terminating because remedies were tried and failed,
  record CANNOT-FIX — otherwise the next session re-opens it from scratch, having lost the reason.

<EXTREMELY-IMPORTANT>
**Do NOT auto-fill gaps. Do NOT silently proceed past gaps. Present them and wait for user decision.**

This is the critical difference from dev-test-gaps. In dev, missing tests can be auto-generated. In DS, missing or wrong outputs mean the analysis itself may be wrong. Only the user can judge whether a gap is acceptable.
</EXTREMELY-IMPORTANT>

## Phase Transition

After validation is complete, discover and read the ds-review skill:
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-review/SKILL.md` and follow its instructions.
