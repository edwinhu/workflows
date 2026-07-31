# Section Review Checklist (Sequential Mode)

Authenticate the receipt-selected `{planFile, planHash}` and compile the deterministic section
index before reviewing. For each indexed section, use only its exact PLAN-bound outline and draft
deliverables, mapped claim IDs, dependencies, and Source Plan context. Do not use a visible précis,
master outline, workflow state, or review ledger as authority.

For each section, check ALL of the following. Every checkmark needs quoted evidence.

## PLAN-Bound Outline Compliance
- [ ] Every subsection from the assigned outline deliverable has corresponding prose
- [ ] Every planned evidence item appears in the assigned draft deliverable
- [ ] Word count is in the range the assigned outline implies
- [ ] Section advances its mapped PLAN claim IDs, or satisfies its claimless structural role
- [ ] No content exceeds authenticated PLAN scope
- [ ] Citations and propositions remain consistent with the Source Plan

## Paragraph-Level Gate

Produce a Topic Sentence Inventory for this section:

| ¶ # | Line | Topic Sentence (quoted) | Single Idea? | Bridge to Next? |
|-----|------|------------------------|--------------|-----------------|

Every paragraph must appear. This inventory replaces the Internal Coherence
checklist — it provides the same information with verifiable evidence.

## Subsection Boundaries

For each pair of adjacent subsections, quote the closing sentence of
subsection N and the opening sentence of subsection N+1. Evaluate each
as SMOOTH, ABRUPT, or DISCONNECTED.

These are checked here (within-section) because Level 2 only checks
section-to-section transitions.

## Domain Style
- [ ] Follows domain-specific rules from loaded skill
- [ ] Register appropriate for audience
- [ ] Citation style correct (if applicable)

## Prose Quality Constraints
- [ ] No bold-lead paragraph patterns (`**Bold Header.** Text...`)
- [ ] Topic sentences state substance, not meta-commentary (no "deserves context", "is striking", "is not an overstatement")
- [ ] No expletive constructions opening paragraphs ("There are...", "It is...")

## AI Anti-Patterns
- [ ] No sycophantic patterns
- [ ] No hollow emphasis ("crucial", "vital", "Moreover")
- [ ] No filler transitions
- [ ] No generic conclusions
- [ ] Active voice predominant
- [ ] Concrete nouns and strong verbs

## Boundary Summary Format

<!-- NOTE: This format is duplicated in the agent team spawn prompt
     (references/reviewer-agent-prompt.md). Keep both copies in sync. -->

After reviewing each section, return this structured summary to the lead for TaskList
reconciliation; do not write a review Markdown file:

```markdown
## Boundary Summary: [Section Name]

### Opening
- Assumes from previous: [concept/context assumed from prior section]
- First sentence: "[quote actual first sentence of section]"
- Tone: [register]

### Closing
- Hands off to next: [concept for next section to pick up]
- Last sentence: "[quote actual last sentence of section]"
- Argument state: [where the PLAN argument stands after this section]

### Concepts
- Introduced: [first appearances of key concepts]
- Used from earlier: [references to concepts from prior sections]
- Core terms: [domain terms for consistency check]
```
