---
name: audit-report
description: "Phase 3: Generate and present audit report for user review"
---

# Phase 3: Report

Generate a human-readable audit report and present to the user for review before applying corrections.

## What This Phase Does

1. Merge mechanical findings + Gemini audit results
2. Categorize by issue type and severity
3. Flag items needing manual review (low-confidence cross-refs, ambiguous citations)
4. Generate `scratch/AUDIT_REPORT.md`
5. Present summary to user

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
```

## Gate: Exit Report

This is a **user gate**. The workflow pauses here.

- [ ] `scratch/AUDIT_REPORT.md` exists
- [ ] User has reviewed the report
- [ ] User approves proceeding to corrections

**Do NOT proceed to corrections without user acknowledgment.**

## Next Phase

After user approval:
```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/audit-correct/SKILL.md")
```
