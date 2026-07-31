# REVIEW SURFACE

The shared `beat-review` primitive owns feedback capture, ordering, dispositions, and `REJECT:`
semantics. This adapter supplies the target described by the receipt-selected generated plan and any
rendered output required by its Review Surfaces section.

## Choose the surface

- When a diffable target exists, use the `tuicr` skill for the human diff-review loop.
- Require a rendered surface exactly when a Success Criteria or Review Surfaces entry names rendered
  behavior: a page, chart, executed notebook, compiled document, or generated output.
- Delegate format-specific mechanics to existing skills such as `workflows:marimo` and
  `workflows:visual-verify`; do not duplicate their commands here.

A rendered review surface has two parts:

| Part | Requirement |
|---|---|
| Live | Watches the source so review-driven fixes appear during the round |
| Durable | Freshly executed, committable or shareable output corresponding to reviewed source |

Refresh durable output when source is newer. Delete partial output after a failed export. Record and
tear down review-only live servers when the gate closes; do not leave an unauthenticated kernel or stale
watcher running. Avoid broad `pkill -f` patterns that can match the invoking shell.

## TaskList review state

Every annotation or actionable chat item becomes a TaskList review finding bound to the current
`planHash`, affected `plan_task_id`, concrete surface or source location, and disposition. Review-level
items without a source line still receive a stable finding identity. Review-driven repairs create
blocked implementation and verification items; they never alter the receipt-selected generated plan.

## Outcome

- **Tactical feedback:** disposition the finding; if work changes, activate a bounded repair `/goal`,
  return to the same independent verifier, clear the goal on PASS, then relaunch the review surface.
- **`REJECT:`:** clear the goal, preserve the rejection finding in TaskList, and return to CLARIFY. The
  current generated plan remains immutable provenance while a replacement native plan receives fresh
  approval and review.
- **No new feedback:** finish only when every current-hash finding is dispositioned, no implementation
  or verification item remains open, the final relaunch produces no new finding, and required durable
  output is fresh.

## Red flags

| About to | Do instead |
|---|---|
| Review source when the criterion is about rendered output | Execute and expose the durable rendered artifact |
| Review an export older than its source | Refresh it first |
| Leave a finding only in chat | Capture a current-hash TaskList review finding and disposition it |
| Skip re-verification after review-driven change | Return to VERIFY before review relaunch |
| Patch the receipt-selected generated plan after `REJECT:` | Replace it through native Plan mode and fresh review |
| Leave a review server running | Tear it down when the gate closes |
