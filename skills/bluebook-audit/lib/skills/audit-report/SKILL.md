---
name: audit-report
description: "Phase 3: Generate and present audit report for user review"
---

# Phase 3: Report

Generate a human-readable audit report and present to the user for review before applying corrections.

## What This Phase Does

1. Merge mechanical findings + Gemini audit results (**mechanical findings take priority** — see audit-check merge rules)
2. Categorize by issue type and severity
3. Flag items needing manual review (low-confidence cross-refs, ambiguous citations)
4. Generate `scratch/AUDIT_REPORT.md`
5. Present summary to user

### Merge Priority

Mechanical findings (signal italic, terminal periods, Id. chains, small caps patterns) are deterministic and **must never be dropped** even if Gemini's audit for the same footnote reported "clean". Gemini adds findings for judgment-call issues (source classification, abbreviation tables) that the mechanical checker cannot evaluate.

## Report Structure

```markdown
# Bluebook Audit Report

## Summary
- Total footnotes: N
- Clean: N (XX%)
- Issues found: N across M footnotes

## Fix Counts by Category
| Category | Count | Auto-fixable |
|----------|-------|-------------|
| Journal name small caps | N | Yes |
| Book title small caps | N | Yes |
| Cross-reference resolution | N | Yes (high confidence) |
| Id. chain errors | N | Partial |
| Signal formatting | N | Yes |
| Terminal periods | N | Yes |
| Typeface errors (other) | N | Manual |

## Issues by Footnote
[sorted by footnote number]

## Items Needing Manual Review
[low-confidence cross-refs, ambiguous citations, judgment calls]

## Correct As-Is (Gemini False Positives)
[Items Gemini flagged but are actually correct, with reasoning]
[Group by source type: SEC releases (roman), exec orders (roman), etc.]
[Reference: audit-patterns.md Source Type Typeface Reference table]
```

### Why "Correct As-Is" Matters

Many Gemini suggestions are wrong — especially for non-standard source types (SEC releases, exec orders, working paper designations). Documenting WHY these are correct:
1. Prevents re-flagging if someone re-runs the audit
2. Forces the reviewer to consciously evaluate each judgment call
3. Creates a record of the source type classification decisions

## Gate: Exit Report

This is a **user gate**. The workflow pauses here.

- [ ] `scratch/AUDIT_REPORT.md` exists
- [ ] User has reviewed the report
- [ ] User approves proceeding to corrections

**Do NOT proceed to corrections without user acknowledgment.**

## Next Phase

After user approval:
```
Read("../audit-correct/SKILL.md")  # relative to this skill's base directory
```
