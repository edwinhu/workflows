---
name: wc-gate-contract
description: Any self-grading gate (JS overallPass + findings + re-run selector) is a 3-way contract that must stay consistent
applies-to: [workflow-creator]
---

## Rule

For any workflow whose gate is computed in JS and returns `overallPass` (or `substratePass`) + a
`findings` list + a re-run selector (`*ThatFailed`/`reviewersThatFlagged`): `overallPass === false`
must imply the selector is non-empty for EVERY fail path, every fail condition must emit an
actionable finding, and the documented `returns {...}` shape must match the script's actual
`return {...}` keys and the selector's id-namespace exactly. See
`skills/workflow-creator/references/gate-doctrine.md` for the full doctrine (11 laws) and the
design-time / audit-time checklists.

## Rationale

A mismatch in this 3-way contract never errors — it silently degrades a targeted re-run into a
full regeneration, or a blocking gate into a display-only one. This has recurred across two
separate audit campaigns (this repo's PRs #50-#55 and a sibling course-materials campaign),
which is why it is durable doctrine, not a one-off fix.
