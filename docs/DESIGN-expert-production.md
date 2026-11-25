# DESIGN: expert-production

## The production SPEC is its own file

`expert-production` adds one persistent file outside the canonical state inventory:
`production/<name>.spec.json`, one per production, written in the project during PLAN. Its boundary is
load-bearing:

- **It is the gate's input, approved by hash.** The plan records the SPEC's sha256, and
  `package-check.sh --spec-sha256` refuses a SPEC whose hash moved. No task's `writablePaths` contains
  it. An approved input that can change mid-run is not approved.
- **It cannot fold into `.planning/.state/episode.json`.** `episode.json` holds mutable episode state
  and is rewritten as a run advances. Merging an immutable, hash-checked input into it would put the
  input in the same failure domain as the state that is meant to change, and every episode write would
  move the hash the gate checks.
- **It cannot fold into `.planning/.state/review.json`.** That receipt records approval of the plan,
  not the contents of a production. A matter with several productions needs several SPECs, and each
  must outlive the episode that approved it.
- **It does not belong in the plans directory.** That directory holds only the plan.

A SPEC is never shipped: it names internal paths (`stage`, `runbook_source`, rerun references) that
must not reach the recipient.
