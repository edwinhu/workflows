# Implementation Plan: toy feature (dev compile/runner fixture)

## Global Constraints

- CON-1: all timestamps are UTC
- CON-2: no new runtime dependency without an R4 decision

## Implementation Order

| Task | Deps | Files | Failing Test (write FIRST) | Verify Command | Implements |
|------|------|-------|----------------------------|----------------|------------|
| 1. types | `---` | `src/types.ts` | N/A (types only) | `tsc --noEmit` | T-01 |
| 2. left branch service | `after 1` | `src/types.ts, src/service.ts, src/service.test.ts` | `test_service()` | `vitest run src/service.test.ts` | A-01 |
| 3. right branch route ⏸ PAUSE: confirm the API shape before downstream | `after 1` | `src/route.ts, src/route.test.ts` | `test_route()` | `vitest run src/route.test.ts` | A-02 |
| 4. wire service into route | `after 2,3` | `src/route.ts, src/wire.test.ts` | `test_wire()` | `vitest run src/wire.test.ts` | A-03 |

## Task Interfaces

### Task 1
- Consumes: —
- Produces: `Session` type in `src/types.ts` (used by Tasks 2, 3)

### Task 2
- Consumes: `Session` (`src/types.ts`)
- Produces: `validate(req): Session | null` in `src/service.ts`

### Task 3
- Consumes: `Session` (`src/types.ts`)
- Produces: `POST /api/session` handler in `src/route.ts`

### Task 4
- Consumes: `validate()` (Task 2), the route (Task 3)
- Produces: the wired endpoint
