# Returned Writing Review Result and TaskList Template

> **Canonical-only.** This template is for returned workflow results and TaskList reconciliation.
> It is not a Markdown review artifact: do not write `.planning/REVIEW.md`,
> `.planning/AUTOMATED_REVIEW.md`, or `.planning/HUMAN_REVIEW.md`. Those paths are retired
> as authority in canonical writing episodes.

Use the exact authenticated `{planFile, planHash}` from the approved combined receipt and the
matching deterministic section index. A malformed index, changed plan hash, or mismatched receipt
blocks a clean result.

```markdown
# Returned Writing Review Result

**Plan identity**: `{planFile, planHash}`
**Document**: [title/purpose from PLAN Writing Intent]
**Style**: [legal | econ | general from PLAN Writing Intent]
**Reviewed**: [date]
**Draft corpus word count**: [approximate]
**Review Surfaces**: [each PLAN Review Surfaces entry inspected with evidence]

## Summary

| Severity | Count | Gate effect |
|----------|------:|-------------|
| Critical | [N] | Blocks |
| Major | [N] | Blocks |
| Minor | [N] | Advisory |
| **Total** | **[N]** | |

**Overall pass**: [true | false]
**Verdict**: [ISSUES FOUND | CLEAN | CLEAN (advisory polish notes)]
**Unreliable sections**: [section names or `none`]

## Normalized Findings for TaskList

For each finding, create or update the current-hash TaskList item:

### [stable retry identity]
- **planHash**: [exact `planHash`]
- **Severity**: [critical | major | minor]
- **Disposition**: [open | fixed | accepted | superseded]
- **Area**: [section | transition | source | whole-document | review-surface | artifact-integrity]
- **Section / claim IDs**: [indexed section and `CLAIM-NN` IDs, or `[]`]
- **Location**: [draft path and line, transition pair, or review surface]
- **Evidence**: "[verbatim quote or concrete review-surface evidence]"
- **Diagnosis**: [plan-bound issue]
- **Suggested fix**: [actionable fix]
- **Retry linkage**: [prior/current stable retry identity]

## Whole-Document Checks

- Claims addressed: [all | list missing PLAN claim IDs]
- Counterarguments confronted: [all | list missing PLAN counterarguments]
- Scope honored: [yes/no, with authenticated PLAN evidence]
- Hook delivered: [yes/no, with evidence]
- Conclusion follows: [yes/no, with evidence]
- Concept introduction order: [findings or evidence]
- Cross-section repetition: [findings or comparison evidence]

## Transition Checks

### [Indexed Section N] → [Indexed Section N+1]
- **Verdict**: [SMOOTH | ABRUPT | DISCONNECTED]
- **Closes with**: "[last sentence of Section N]"
- **Opens with**: "[first sentence of Section N+1]"
- **PLAN dependency / transition context**: [from authenticated PLAN]
- **Finding**: [none or normalized finding identity]

## Section Evidence

### [Indexed Section Name]
- **Outline and draft deliverables**: [exact indexed paths]
- **Mapped PLAN claims**: [`CLAIM-NN`, ...] or `[]`
- **Plan-bound outline compliance**: [pass/fail with evidence]
- **Topic Sentence Inventory**: [returned inventory]
- **Subsection boundaries**: [returned checks]
- **Boundary Summary**: [returned summary]
- **Source Plan fidelity**: [pass/fail with evidence]
- **Quote verification**: [verified / unreliable, with evidence]

## Review-Surface Completion

| Exact PLAN review surface | Status | Evidence |
|---------------------------|--------|----------|
| [surface] | INSPECTED | [concrete evidence] |
```

A clean result requires zero critical findings, zero major findings, no unreliable sections,
unchanged authenticated plan/outline/draft bytes, and every PLAN Review Surface completed.
Return this structure to the caller and reconcile its findings into TaskList before routing to
`/writing-revise`. Do not persist a competing review ledger.
