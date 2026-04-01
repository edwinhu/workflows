---
name: dev-deviation-rules
description: 4-rule system for unplanned discoveries during implementation — R1-R3 auto, R4 STOP
applies-to: [dev-implement, dev-delegate, dev-tdd]
---

## Rule

Implementation subagents follow a 4-rule system for unplanned discoveries:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Bug** | Broken behavior, errors, wrong queries, type errors, security vulns, race conditions, leaks | Fix -> test -> verify -> track `[Rule 1 - Bug]` | Auto |
| **R2: Missing Critical** | Missing essentials: error handling, validation, auth, CSRF/CORS, rate limiting, indexes, logging | Add -> test -> verify -> track `[Rule 2 - Missing Critical]` | Auto |
| **R3: Blocking** | Prevents completion: missing deps, wrong types, broken imports, missing env/config/files, circular deps | Fix blocker -> verify proceeds -> track `[Rule 3 - Blocking]` | Auto |
| **R4: Architectural** | Structural change: new DB table, schema change, new service, switching libs, breaking API, new infra | **STOP -> present decision -> track `[Rule 4 - Architectural]`** | Ask user |

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure -> R4.
**Edge cases:** missing validation -> R2 | null crash -> R1 | new table -> R4 | new column -> R1/2

Each task summary MUST include a deviation tracking line: `**Total deviations:** N auto-fixed (R1: X, R2: Y, R3: Z). **Impact:** [assessment].`

## Rationale

**Why this exists** -- during implementation, subagents inevitably discover problems not anticipated by the plan: a dependency is missing, a type doesn't match, or a schema change is needed. Without a classification system, agents either silently make architectural changes (dangerous) or stop for every minor fix (inefficient). The R1-R4 system draws a clear line: bugs, missing essentials, and blockers are auto-handled, but architectural changes require human approval because they change the system structure, not just the implementation details.

## Examples

### Correct
1. R1 (bug): Query returns wrong results due to missing WHERE clause. Subagent fixes, logs: "R1: Fixed missing WHERE clause in user query."
2. R2 (missing critical): Endpoint has no input validation. Subagent adds validation, logs: "R2: Added request body validation for POST /users."
3. R3 (blocking): Import fails because dependency not in package.json. Subagent adds dep, logs: "R3: Added missing `zod` dependency."
4. R4 (architectural): Feature needs a new database table. Subagent STOPS: "R4: Feature requires new `sessions` table. User decision required."

### Incorrect
1. Subagent adds a new database table silently because "it's obvious." The schema changed without plan approval.
2. Subagent stops for every missing import, asking the user about R3-level changes. Workflow grinds to a halt.
3. Subagent doesn't track deviations. After implementation, nobody knows what changed from the plan.

## Rationalization Table

| Thought | Reality | Do Instead |
|---------|---------|------------|
| "This schema change is minor" | If it changes the data model, it's R4. User decides. | STOP. Flag as R4. |
| "I'll note the deviation later" | Later = never. Track it NOW. | Track immediately in the task summary. |
| "Adding a new service is just good architecture" | New services change deployment and maintenance. User MUST know. | Flag as R4. User decides. |
| "Tracking deviations slows down implementation" | 30 seconds of tracking prevents hours of "why did the architecture change?" | Track every deviation. Every time. |
| "I'm not sure if this is R3 or R4" | Unsure -> R4. The cost of a false R4 (user decides quickly) is far less than a false R3 (silent architecture change). | When in doubt, R4. |

## Red Flags

- **Changing the system architecture without flagging R4** -- STOP. If it changes structure, it's R4.
- **"I'll track this deviation later"** -- STOP. Track it NOW in the task summary.
- **"This is just a small structural change"** -- STOP. Small structural changes compound. If it changes architecture, it's R4.
- **No deviation tracking line in a task summary** -- STOP. Every task summary MUST include deviation tracking, even if "deviations: none."
- **"The plan was wrong anyway"** -- STOP. The plan is the contract. Changing it requires R4 and user approval.
