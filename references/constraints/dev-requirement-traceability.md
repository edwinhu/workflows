---
name: dev-requirement-traceability
description: CATEGORY-NN requirement IDs from SPEC.md must flow through PLAN.md, VALIDATION.md, and verification
applies-to: [dev-implement, dev-review, dev-verify, dev-test-gaps]
---

## Rule

SPEC.md assigns unique IDs to every requirement (e.g., AUTH-01, DATA-02). These IDs flow through the entire dev workflow:

| Artifact | How IDs appear |
|----------|---------------|
| **SPEC.md** | `AUTH-01: [requirement text]` -- unique ID per requirement |
| **PLAN.md** | `implements: [AUTH-01, AUTH-02]` per task |
| **LEARNINGS.md** | `implements: [AUTH-01]` per task summary |
| **VALIDATION.md** | `AUTH-01: COVERED / PARTIAL / MISSING` -- full coverage map |
| **dev-verify** | `REQUIREMENT: AUTH-01` per goal verification |

**Without IDs, "we tested the feature" is vague. With IDs, you can verify that AUTH-01, AUTH-02, and DATA-01 are each addressed with tests in specific tasks.**

**ID format:** `CATEGORY-NN` where category comes from natural groupings (AUTH, DATA, UI, API, etc.).

**Scope tags:** `v1` (must complete), `v2` (defer if needed), `out-of-scope` (excluded).

## Rationale

**Why this exists** -- in early dev workflows, "requirements covered" was asserted without proof. Validation would pass because the agent believed it had tested everything, but specific requirements were missing test coverage. Requirement IDs make coverage auditable: VALIDATION.md can mechanically check that every CATEGORY-NN appears in at least one task's test output. Vague coverage assertions become concrete traceable links.

## Examples

### Correct

```markdown
# SPEC.md
AUTH-01: Users can login with email/password [v1]
AUTH-02: JWT tokens refresh automatically [v1]
DATA-01: API returns paginated results [v1]

# PLAN.md
## Task 1: Auth endpoints
implements: [AUTH-01, AUTH-02]

## Task 2: Pagination
implements: [DATA-01]

# VALIDATION.md
AUTH-01: COVERED (test_login_success, test_login_failure)
AUTH-02: COVERED (test_token_refresh)
DATA-01: COVERED (test_pagination_defaults, test_pagination_cursor)
```

### Incorrect

```markdown
# SPEC.md
The app needs authentication and pagination.
(No requirement IDs. Requirements embedded in prose. Can't trace.)

# PLAN.md
## Task 1: Build auth
(No implements line. No way to verify which requirements this covers.)

# VALIDATION.md
"All requirements tested."
(No per-requirement status. Just assertion.)
```

## Rationalization Table

| Thought | Reality | Do Instead |
|---------|---------|------------|
| "Requirements are obvious from context" | Obvious to you now. Not to the validation phase or a resuming session. | Assign explicit CATEGORY-NN IDs. |
| "Adding IDs clutters the plan" | IDs are one line per task. Clutter is finding out in review that a requirement was never tested. | Add the `implements:` line. |
| "I'll add traceability during validation" | Validation checks traceability -- it can't add it. IDs must exist before validation runs. | Add IDs at each phase as artifacts are created. |
| "Not all requirements map neatly to tasks" | Then the plan structure needs revision. A requirement with no task is a coverage gap. | Flag it as a structural issue during design. |

## Red Flags

- **SPEC.md has requirements without CATEGORY-NN IDs** -- STOP. Every requirement needs a unique, traceable identifier.
- **PLAN.md tasks missing `implements:` lines** -- STOP. Every task must declare which requirements it covers.
- **VALIDATION.md says "all requirements covered" without per-requirement status** -- STOP. Validate each ID individually.
- **A CATEGORY-NN appears in SPEC.md but not in any PLAN.md task** -- STOP. That's a coverage gap.
- **Adding new requirements mid-implementation without updating SPEC.md** -- STOP. New requirements need IDs and must flow through all downstream artifacts.
