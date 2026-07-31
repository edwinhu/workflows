# Claims and section traceability

The authenticated generated PLAN must state its thesis, audience, scope, exclusions, and document
purpose in **Writing Intent**. Every material `CLAIM-NN` must map through **Claim → Section Map**
to a planned section or be explicitly excluded. Every **Section Outputs** row must name the exact
outline and draft deliverables that implement its mapped claims, with `[]` only for an explicitly
claimless structural section.

Reviewers authenticate the receipt-selected `{planFile, planHash}` and compile the deterministic
section index before tracing. The PLAN's Claims, Document Structure, Claim → Section Map, and
Section Outputs are authoritative; a visible précis, master outline, workflow state, or review
ledger cannot fill a gap. Missing or contradictory traceability is `ISSUES_FOUND`.
