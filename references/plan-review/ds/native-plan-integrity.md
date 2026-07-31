# Native plan integrity

For DS, native Plan approval creates the hidden combined receipt `.planning/.state/review.json` in `PENDING` state. Its `plan_file` selects the safe direct-child basename of the exact generated Markdown plan returned by that completed native Plan interaction; `plan_hash` authenticates the plan's exact bytes. The receipt also binds the approval session and UTC approval time.

The reviewer receives that exact generated plan path. Read the PENDING receipt and require the supplied path, after canonical normalization, to equal the safe receipt-derived `.planning/<plan_file>` path; matching the basename alone is insufficient. Hash that exact path before review and immediately before finalization. Never list or glob `.planning/`, choose a newest plan, infer a path from modification time, copy or rename a plan, or substitute another plan. Do not modify the plan bytes.

The approval, review, and implementation sessions must be independent, and `reviewed_at` must be strictly later than `approved_at`. Finalize only by replacing `.planning/.state/review.json`, preserving every approval-owned field unchanged and setting the reviewer-owned verdict fields. An `ISSUES_FOUND` verdict returns to native Plan mode for a new approval; it never authorizes a plan patch or implementation.

Dev uses the same native generated-plan and hidden combined-receipt authority. Any fixed dev `.planning/PLAN.md` or visible verdict is conversion-only provenance and never authorizes review or implementation.
