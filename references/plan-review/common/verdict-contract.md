# Verdict contract and reviewer boundary

Report blockers separately from advisory findings. Produce one verdict for the complete current plan; do not rewrite it, choose an alternative architecture, or claim implementation quality.

The only durable reviewer write is `.planning/PLAN_REVIEWED.md` with exactly four YAML fields: `plan_hash`, `status`, `reviewer_session_id`, and `reviewed_at`. The shared guard, not this prose, authoritatively validates the path, session binding, hash, schema, timestamp, and tool boundaries.
