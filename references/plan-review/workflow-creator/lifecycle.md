# Workflow-creator lifecycle constraints

- Exactly two user-facing entries: fresh `workflow-creator` and corrective `workflow-creator-improve`.
- Plan names shared-v1 semantic phases, exact approval, independent plan review, delegated implementation, independent verification, and terminal human review.
- Audit-only requests remain read-only and go from diagnosis to human review.
- Legacy `.planning/wc` state is rejected, never resumed or converted.
