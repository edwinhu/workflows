---
name: ds-constraints
description: The four DS constraint aggregates in one preloadable file — common constraints (C1-C6), common conventions (V1-V9), analysis constraints (A1-A6) and engineering constraints (E1-E6). Preloaded into the ds subagents; follow the indexed constraints your task touches and load the individual files under references/constraints/ that it needs.
---

# DS constraints

Four aggregates in one file, because a doer needs all four indexes at once and naming them by path
is discretionary: a task prompt that lists four paths is a suggestion, and a skipped read fails
silently. Preloaded, every index below arrives before the first turn.

Each row names a self-contained constraint file under
`${CLAUDE_PLUGIN_ROOT}/references/constraints/`. Read the index here; open the individual file when
the task actually touches that constraint.

---

# DS Workflow: Common Constraints

Deterministic rules for the DS workflow. Each constraint can be verified by a script returning pass/fail. Self-contained files under `${CLAUDE_PLUGIN_ROOT}/references/constraints/`.

**See also:** `${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-conventions.md` for judgment-based behavioral guidance (V1-V9).

After reading this index, load the specific constraint files your task needs.

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| C1 | Data Quality Checks | [ds-data-quality-checks.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-data-quality-checks.md) | Canonical DQ1-DQ6, M1, R1 definitions — load from ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-checks.md, never inline |
| C2 | Post-Subagent Boundary | [ds-post-subagent-boundary.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-post-subagent-boundary.md) | After an agent returns, verification proceeds through its returned report, the approved PLAN, and project auto-memory; it does not investigate source or data |
| C3 | Deviation Rules | [ds-deviation-rules.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-deviation-rules.md) | R1-R3 auto-fix, R4 stop for user decision — record deviations in the structured result returned for the task; return reusable project auto-memory candidates |
| C4 | External Skill Discovery | [ds-external-skill-discovery.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-external-skill-discovery.md) | Before the approved PLAN assigns an external skill, inspect its references and examples; prefer ADOPT/PATCH over greenfield |
| C5 | Data Pull Profile | [ds-data-pull-profile.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-data-pull-profile.md) | Before approving work involving a source >= 50M rows, >= 500 MB, or flagged large/bulk/TB/millions, profile raw versus aggregate shipping needs and record the decision in the approved PLAN |
| C6 | Sample Coverage | [ds-sample-coverage.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-sample-coverage.md) | The approved PLAN defines one canonical sample window and sub-windows; every windowed source has a Required-vs-Actual coverage row and disposition before task use |

---

# DS Workflow: Common Conventions

Behavioral guidance for the DS workflow. Loaded ex-ante for prompt context and assessed by human or LLM judgment during review.

After reading this index, load the specific convention files your task needs.

---

## Index

| ID | Convention | File | Description |
|----|-----------|------|-------------|
| V1 | Assumption Over Evidence | [ds-assumption-over-evidence.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-assumption-over-evidence.md) | Never treat assumptions as evidence — profile/verify fresh every time |
| V2 | Deferred Verification | [ds-deferred-verification.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-deferred-verification.md) | Verify after every technical step — "later" means never |
| V3 | Impatience Over Process | [ds-impatience-over-process.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-impatience-over-process.md) | Follow process — speed without correctness is malpractice |
| V4 | Topic Change Protocol | [ds-topic-change-protocol.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-topic-change-protocol.md) | Off-topic messages require announce-pause-handle-resume |
| V5 | DS Escape Patterns | [ds-escape-patterns.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-escape-patterns.md) | Four observed escape patterns to watch for |
| V6 | Statistical Validity | [ds-statistical-validity.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-statistical-validity.md) | Every statistical claim must have correct test |
| V7 | P-Hacking Prevention | [ds-p-hacking-prevention.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-p-hacking-prevention.md) | Lock analysis choices in the approved PLAN; no post-hoc fishing |
| V8 | Sample Selection | [ds-sample-selection.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-sample-selection.md) | Document and justify every sample filter |
| V9 | Deviation Rules (Analysis) | [ds-deviation-rules-analysis.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-deviation-rules-analysis.md) | Analysis-specific deviation handling |

---

# DS Analysis Constraints

Deterministic rules for data analysis tasks (statistical analysis, modeling, visualization). Each constraint can be verified by a script returning pass/fail. Self-contained files under `${CLAUDE_PLUGIN_ROOT}/references/constraints/`.

**Complements (not replaces):** `${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-constraints.md` — load both for analysis tasks.

**See also:** `${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-conventions.md` for judgment-based analysis guidance (V6: statistical validity, V7: p-hacking prevention, V8: sample selection, V9: deviation rules for analysis).

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| A1 | Robustness Checks | [ds-robustness-checks.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-robustness-checks.md) | Beyond spec curves — placebo tests, IV, RDD, bootstrap, leave-one-out |
| A2 | Standard Error Spec | [ds-standard-error-spec.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-standard-error-spec.md) | Match SE type to data structure — wrong SEs invalidate all inference |
| A3 | Visualization Integrity | [ds-visualization-integrity.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-visualization-integrity.md) | Charts must not mislead — no truncated axes, dual-axis tricks, or 3D |
| A4 | Table-Figure Pairing | [ds-table-figure-pairing.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-table-figure-pairing.md) | Every main result table needs a companion figure (the "Hendershott" rule) |
| A5 | Chart Typography | [ds-chart-typography.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-chart-typography.md) | Charts inherit the host document's type and palette — one registered theme, never per-chart styling |
| A6 | Chart Colour | [ds-chart-color.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-chart-color.md) | Scheme matches the variable — categorical vs ramp, one reserved accent, grey for absence |

## Loading Guide

For analysis tasks, load all A1-A6. The most critical for preventing silent errors:

| Priority | Constraints | Why |
|----------|-------------|-----|
| **Always** | A2 (SEs) | Wrong standard errors invalidate all inference |
| **For regressions** | A1 (robustness) | Prevent specification search |
| **For reporting** | A3 (visualization), A4 (table-figure pairing) | Prevent misleading output; ensure every table has a visual companion |

---

# DS Engineering Constraints

Role-specific behavioral rules for data engineering tasks (pipelines, ETL, transformations). Each constraint is self-contained in its own file under `${CLAUDE_PLUGIN_ROOT}/references/constraints/`.

**Complements (not replaces):** `${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-constraints.md` — load both for engineering tasks.

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| E1 | Determinism | [ds-determinism.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-determinism.md) | Every pipeline step must be deterministic — set seeds, sort output |
| E2 | Schema Contracts | [ds-schema-contracts.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-schema-contracts.md) | Input/output schema validation at every boundary — schema changes are R4 |
| E3 | Join Audits | [ds-join-audits.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-join-audits.md) | Every merge/join must produce diagnostic log — row counts, match rates |
| E4 | Idempotency | [ds-idempotency.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-idempotency.md) | Running pipeline N times must equal running once — no append, no increment |
| E5 | Error Handling | [ds-error-handling.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-error-handling.md) | Errors must be loud — no catch-and-ignore, no silent coercion or drops |
| E6 | Native Document Input | [ds-native-document-input.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-native-document-input.md) | Send PDFs/images to a multimodal model natively — NEVER pre-extract text; it costs more and is less accurate |

## Loading Guide

For engineering tasks, load all E1-E6. The most critical:

| Priority | Constraints | Why |
|----------|-------------|-----|
| **Always** | E1 (determinism), E3 (join audits) | These prevent the most common silent data errors |
| **For ETL pipelines** | E2 (schema), E4 (idempotency) | Prevent state accumulation and schema drift |
| **For all transforms** | E5 (error handling) | Prevent silent data loss |
| **Any pipeline sending documents to a model** | E6 (native document input) | Pre-extracting text bills more tokens AND injects the page-furniture and hyphenation artifacts that a verbatim gate then fails on |
