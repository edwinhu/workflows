---
name: ds-engineering-constraints
description: Data-engineering (pipeline/ETL) constraints for ds engineering work
applies-to: [ds]
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
| E7 | Network Politeness | [ds-network-politeness.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-network-politeness.md) | State the computed request rate against the target's documented ceiling, name quota vs rate limit, never call an unexecuted fallback required |

## Loading Guide

For engineering tasks, load all E1-E7. The most critical:

| Priority | Constraints | Why |
|----------|-------------|-----|
| **Always** | E1 (determinism), E3 (join audits) | These prevent the most common silent data errors |
| **For ETL pipelines** | E2 (schema), E4 (idempotency) | Prevent state accumulation and schema drift |
| **For all transforms** | E5 (error handling) | Prevent silent data loss |
| **Any pipeline sending documents to a model** | E6 (native document input) | Pre-extracting text bills more tokens AND injects the page-furniture and hyphenation artifacts that a verbatim gate then fails on |
| **Any pipeline fetching from a host it does not own** | E7 (network politeness) | A worker count with no computed rate is an unreviewed increase in pressure on someone else's server, from an IP the institution owns |
