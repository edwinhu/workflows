# REVIEW SURFACE

The shared `beat-review` primitive owns feedback capture, TaskList ordering, dispositions, the durable
ledger, and `REJECT:` semantics. This adapter supplies the review target and any rendered output.

## Choose the surface

- When a diffable target exists, use the `tuicr` skill for the human diff-review loop.
- Require a rendered surface exactly when a Success Criteria Evidence cell names rendered behavior: a
  page, chart, executed notebook, compiled document, or generated output.
- Delegate format-specific mechanics to existing skills such as `workflows:marimo` and
  `workflows:visual-verify`; do not duplicate their commands here.

A rendered review surface has two parts:

| Part | Requirement |
|---|---|
| Live | Watches the source so review-driven fixes appear during the round |
| Durable | Freshly executed, committable/shareable output corresponding to the reviewed source |

Refresh durable output when the source is newer. Delete partial output after a failed export. Record
and tear down review-only live servers when the gate closes; do not leave an unauthenticated kernel or
stale watcher running. Avoid broad `pkill -f` patterns that can match the invoking shell.

Anchor review notes to source locations where possible; otherwise use a review-level annotation. Both
rendered-output notes and diff notes enter the same `.planning/REVIEW.md` ledger.

## Outcome

- Tactical feedback: disposition it; if work changed, activate a new bounded repair `/goal` for the
  captured items, return to the same independent verifier, clear the repair goal on PASS, then relaunch
  review.
- `REJECT:`: read `rejections` from `WORK.md`, clear the goal, and return to CLARIFY. Never treat it as
  a tactical patch list.
- No new feedback: apply the shared review gate and mark `status: complete`.

## Red flags

| About to | Do instead |
|---|---|
| Review source when the criterion is about rendered output | Execute and expose the durable rendered artifact |
| Review an export older than its source | Refresh it first |
| Skip re-verification after a review-driven change | Return to VERIFY before review relaunch |
| Leave a review server running | Tear it down when the gate closes |
