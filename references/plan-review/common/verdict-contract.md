# Verdict contract and reviewer boundary

Report blockers separately from advisory findings. Produce one verdict for the complete current plan; do not rewrite it, select another plan, or claim implementation quality.

For DS, work, writing, workshop, and workflow-creator, native approval creates `.planning/.state/review.json` in `PENDING` state. The receipt contains exactly `workflow`, `plan_file`, `plan_hash`, `approved_session_id`, `approved_at`, `status`, `reviewer_session_id`, and `reviewed_at`. `plan_file` is the safe direct-child basename of the exact generated Markdown plan supplied by the completed native Plan interaction. `plan_hash` authenticates that file's exact bytes.

The independent reviewer receives the exact generated path. Never glob or list `.planning/`, choose a newest file, infer from modification time, or substitute another plan. Hash the exact path before review and immediately before finalization. The only durable reviewer write is replacement of `.planning/.state/review.json`: reproduce every approval-owned field unchanged, set `status` to `APPROVED` or `ISSUES_FOUND`, bind `reviewer_session_id` to the actual reviewer session, and set a strict UTC `reviewed_at` later than `approved_at`.

The shared guard validates duplicate and unknown fields, direct-child and reserved-name rules, regular-file and symlink safety, exact workflow/path/hash binding, immutable approval identity, reviewer session identity, and chronology. A final receipt authorizes implementation only when approval, review, and implementation sessions are all distinct.

Never write a visible `PLAN_REVIEWED.md`, `plan.json`, or copied `PLAN.md` for modern workflows. Legacy dev alone retains its fixed `.planning/PLAN.md` and four-field visible verdict. External workflow descriptor schema v1 remains unchanged.
