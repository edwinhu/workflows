---
name: ds-engineering-constraints
description: Data-engineering (pipeline/ETL) constraints for ds engineering phases
applies-to: [ds, ds-fix, ds-plan, ds-implement, ds-review, ds-verify, ds-validate, ds-delegate]
---

# DS Engineering Constraints

Role-specific behavioral rules for data engineering tasks (pipelines, ETL, transformations). Each constraint is self-contained in its own file under `constraints/`.

**Loaded by:** ds-delegate for engineering-type tasks.

**Complements (not replaces):** `ds-common-constraints.md` — load both for engineering tasks.

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| E1 | Determinism | [constraints/ds-determinism.md](constraints/ds-determinism.md) | Every pipeline step must be deterministic — set seeds, sort output |
| E2 | Schema Contracts | [constraints/ds-schema-contracts.md](constraints/ds-schema-contracts.md) | Input/output schema validation at every boundary — schema changes are R4 |
| E3 | Join Audits | [constraints/ds-join-audits.md](constraints/ds-join-audits.md) | Every merge/join must produce diagnostic log — row counts, match rates |
| E4 | Idempotency | [constraints/ds-idempotency.md](constraints/ds-idempotency.md) | Running pipeline N times must equal running once — no append, no increment |
| E5 | Error Handling | [constraints/ds-error-handling.md](constraints/ds-error-handling.md) | Errors must be loud — no catch-and-ignore, no silent coercion or drops |

## Loading Guide

For engineering subagents, load all E1-E5. The most critical:

| Priority | Constraints | Why |
|----------|-------------|-----|
| **Always** | E1 (determinism), E3 (join audits) | These prevent the most common silent data errors |
| **For ETL pipelines** | E2 (schema), E4 (idempotency) | Prevent state accumulation and schema drift |
| **For all transforms** | E5 (error handling) | Prevent silent data loss |
