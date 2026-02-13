---
name: bluebook-audit
description: "This skill should be used when the user asks to 'audit footnotes', 'check Bluebook formatting', 'audit citations', 'run footnote audit', 'check my footnotes', 'bluebook audit', or needs systematic Bluebook compliance checking of a law review manuscript."
---

# Bluebook Footnote Audit Workflow

Systematic Bluebook 21st edition compliance audit for law review manuscripts in DOCX format.

**Announce:** "Using bluebook-audit to run a systematic Bluebook compliance check."

## Overview

Six-phase linear workflow: Extract -> Check -> Report -> Correct -> Verify -> Archive

```
/bluebook-audit  -> extract -> check -> report -> [USER REVIEWS] -> correct -> verify -> archive
/bluebook-audit-fix -> diagnose -> route to {re-check, re-correct, re-verify}
```

## Phase Summary

| Phase | Responsibility | Gate |
|-------|---------------|------|
| Extract | Parse DOCX -> structured JSON with formatting | `footnotes_data.json` exists, all FNs extracted |
| Check | Mechanical checks + Gemini formatted audit | `audit_findings.json` exists, ALL FNs covered |
| Report | Present findings to user for review | `AUDIT_REPORT.md` exists, user acknowledges |
| Correct | Apply fixes to DOCX via lxml | Corrected DOCX exists, fix counts match |
| Verify | Re-scan to confirm fixes applied | Zero remaining issues in re-scan |
| Archive | perma.cc URL archiving | All URLs archived, links written to DOCX |

## How to Start

1. User provides a DOCX file path
2. Workflow creates `scratch/` directory for intermediate artifacts
3. Proceeds through phases sequentially

## Next Step

Read the entry command:

```
Read("${CLAUDE_PLUGIN_ROOT}/commands/bluebook-audit.md")
```

<EXTREMELY-IMPORTANT>
## Iron Law: ALL Footnotes Must Be Checked

**Every footnote in the document must be audited. No subsets. No sampling.**

Auditing only "major-severity" footnotes or a random sample guarantees missed errors. The formatted Gemini audit must cover ALL footnotes, not just previously flagged ones.

Claiming audit completion without checking every footnote is LYING.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Iron Law: Formatted Text for Gemini Audit

**NEVER send plain text to Gemini for typeface auditing. Always include formatting markup.**

Plain text produces 10-20x false positives because Gemini cannot see what is already italic/small caps/roman. Inline markup (`*italic*`, `[SC]small caps[/SC]`) reduces false positives from ~400 to ~20 for a 239-footnote document.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Iron Law: Verify After Corrections

**After applying corrections, ALWAYS re-run the scanner to verify fixes were applied.**

NBSP characters, run boundaries, and cross-run text cause silent failures. A fix that "applied" in code may not have actually changed the DOCX. Re-scanning is mandatory.
</EXTREMELY-IMPORTANT>
