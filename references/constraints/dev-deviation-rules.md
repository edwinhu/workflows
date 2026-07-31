---
name: dev-deviation-rules
description: 4-rule system for unplanned discoveries during implementation — R1-R3 auto, R4 STOP
applies-to: [dev-implement, dev-delegate, dev-tdd]
---

## Rule

Implementation subagents follow a 4-rule system for unplanned discoveries:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Bug** | Broken behavior, errors, wrong queries, type errors, security vulns, race conditions, leaks | Fix -> test -> verify -> record against the current TaskList item | Auto |
| **R2: Missing Critical** | Missing essentials: error handling, validation, auth, CSRF/CORS, rate limiting, indexes, logging | Add -> test -> verify -> record against the current TaskList item | Auto |
| **R3: Blocking** | Prevents completion: missing deps, wrong types, broken imports, missing env/config/files, circular deps | Fix blocker -> verify proceeds -> record blocker/finding in TaskList | Auto |
| **R4: Architectural** | Structural change: new DB table, schema change, new service, switching libs, breaking API, new infra | **STOP -> present decision -> native replan if accepted** | Ask user |

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure -> R4.
**Edge cases:** missing validation -> R2 | null crash -> R1 | new table -> R4 | new column -> R1/2

Record each deviation in the current TaskList item and return it with the task result: the rule,
what changed, verification evidence, and impact. Do not create a visible planning ledger or mutate
approved plan bytes.

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

## Deviation Facts

- Schema changes and new services are R4 even when they feel "minor" or like "just good architecture" — they change the data model, deployment, and maintenance, which the user decides. A cost asymmetry settles unsure cases: a false R4 costs the user one quick decision; a false R3 is a silent architecture change. Unsure → R4, always.
- Tracking a deviation costs ~30 seconds; an untracked change costs hours of "why did the architecture change?" later. Record it immediately in the TaskList task/result — a deferred note does not survive the task.

## Red Flags

- **Changing the system architecture without flagging R4** -- STOP. If it changes structure, it's R4.
- **"I'll track this deviation later"** -- STOP. Record it NOW in the TaskList task/result.
- **"This is just a small structural change"** -- STOP. Small structural changes compound. If it changes architecture, it's R4.
- **No TaskList deviation record** -- STOP. The task/result must include the deviation, even if none occurred.
- **"The plan was wrong anyway"** -- STOP. The exact approved plan is the contract. Changing it requires R4, user approval, a replacement generated plan, and fresh receipt.
