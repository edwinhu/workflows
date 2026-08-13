# Workflow architecture constraints

- Each internal phase has one responsibility and an explicit exit gate.
- Fresh and corrective entries route to internal-only phases rather than duplicating them.
- Deterministic work is compiled; judgment remains in read-only independent reviewers.
- Constraints are discovered in clarification and planning; mechanical checks are preferred to lenses wherever an exit code can decide.
- Selective retries preserve approved-plan identity and prior-review provenance.
- Review surfaces and `REJECT:` re-entry are named explicitly.
