# Section execution

After authenticating the receipt-selected `{planFile, planHash}`, compile the deterministic section
index from the generated PLAN. The PLAN must enumerate concrete **Section Outputs** and preserve
that index. Each section task names its exact outline and draft deliverables, mapped `CLAIM-NN` IDs
(or `[]` for a claimless structural section), neighboring dependency context for transitions,
domain style constraints, Source Plan context, and execution-fidelity evidence.

Section outlines and drafts must carry the exact plan hash and `implements` frontmatter matching
the plan's Claim → Section Map. Dependencies must distinguish genuinely independent sections from
transitions or shared inputs that require ordering. Reviewers use the authenticated index and
normal outline/draft deliverables rather than rediscovering sections through any legacy planning
or review artifact. A legacy planning or review artifact cannot be authority for section execution.
