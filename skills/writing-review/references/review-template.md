# REVIEW.md Template

Write the complete review to `.planning/AUTOMATED_REVIEW.md` using this template:

```markdown
# Document Review

**Document**: [title from PRECIS]
**Style**: [legal | econ | general]
**Reviewed**: [date]
**Word count**: [approximate]

## Summary

| Severity | Count |
|----------|-------|
| Critical | [N] |
| Major | [N] |
| Minor | [N] |
| **Total** | **[N]** |

**Verdict**: [ISSUES FOUND | CLEAN]

---

## Document-Level Issues

### Concept Introduction Order
[Issues from Level 3, or "All concepts introduced before use (evidence: [concept map])"]

### Cross-Section Repetition
[Issues from Level 3, or "No redundant repetition found (evidence: [comparison summary])"]

### Thesis Threading
[Issues from Level 3, or "All sections advance thesis (evidence: [per-section claim check])"]

### Structural Completeness
- Claims addressed: [N/N]
- Counterarguments confronted: [N/N]
- Scope honored: [yes/no, with evidence]
- Hook delivered: [yes/no, with evidence]
- Conclusion follows: [yes/no, with evidence]

---

## Transition Issues

### [Section N] → [Section N+1]
- **Verdict**: [SMOOTH | ABRUPT | DISCONNECTED]
- **Closes with**: "[last sentence of Section N]"
- **Opens with**: "[first sentence of Section N+1]"
- **Problem**: [description]
- **Planned transition**: [from OUTLINE.md]
- **Suggestion**: [specific fix]

[Repeat for each boundary]

---

## Section-Level Issues

### [Section Name]

#### Outline Compliance
[Pass/fail with evidence for each item]

#### Coherence
[Issues found, or pass with evidence]

#### Domain Style
[Issues found, or pass with evidence]

#### AI Anti-Patterns
[Issues found, or pass with evidence]

#### Issues
[List all issues for this section, sorted by severity]

[Repeat for each section]

---

## Boundary Summaries

[Raw boundary summaries from Level 1, preserved here as reference data for writing-revise]

### [Section Name]
#### Opening
- Assumes from previous: [...]
- First sentence: "[...]"
- Tone: [...]
#### Closing
- Hands off to next: [...]
- Last sentence: "[...]"
- Argument state: [...]
#### Concepts
- Introduced: [...]
- Used from earlier: [...]
- Core terms: [...]

[Repeat for each section]
```
