# Constraint ledger constraints

A workflow is the set of constraints its output must satisfy. The plan carries them as a `##
Constraints` ledger with columns `Constraint | Kind (mechanical|lens) | Decided by | Why not
mechanical`. Reject a plan that omits it.

- Every mechanical row's `Decided by` is a runnable command, not an adjective or a property name.
- Every lens row's `Why not mechanical` names the specific judgement no exit code can make.
  "Quality", "correctness", "subjective", and restatements of the constraint are not answers — such
  a row is an unwritten lint rule and is a blocking finding.
- One mechanical entry point is named by path, and every mechanical row is reachable through it. A
  second standalone command outside it is a blocking finding.
- The ledger and the `## Adapter` section agree one-for-one: every `mechanicalChecks`,
  `verifyLenses`, and `reviewLenses` entry traces to exactly one row, and every row to one entry.
- Lens count that grew relative to the workflow being corrected, with no converted lens, requires a
  written reason.
- No gate loops on a lens verdict; lenses are scored once, advisory. A fix loop's exit condition is
  mechanical.
