---
name: audit-check
description: "Phase 2: Run mechanical checks and Gemini formatted audit"
---

# Phase 2: Check (Mechanical + AI Audit)

Two-stage checking: Python mechanical checks catch definite errors; Gemini batch audit catches judgment-call issues.

## Stage 2a: Mechanical Checks (Python)

Run: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/scan_formatting.py --docx path/to/file.docx`

Checks performed on ALL footnotes:
1. **Journal name small caps** - Comprehensive pattern list (law reviews, finance journals, newspapers, periodicals, forums)
2. **Book title small caps** - Detect italic book titles that should be small caps
3. **Id. chain validation** - Rule 4.1 mechanical check (single-source predecessor)
4. **Signal italic consistency** - All signals (see, cf., e.g.) must be italic
5. **Terminal period** - Every footnote must end with a period
6. **Hereinafter consistency** - Defined at first citation, used consistently after
7. **Author name supra format** - Text before `*supra*` should be roman, not italic (unless it's a case name short form). Catches `*Manne, supra*` → should be `Manne, *supra*`
8. **Italic spillover** - Trailing/leading spaces inside italic or small caps runs (e.g., `*supra *` should be `*supra* `). These don't affect Word display but cause Gemini misparses

### NBSP Handling

DOCX uses non-breaking spaces (`\xa0`) in abbreviations. ALL search functions must handle both `\x20` and `\xa0`:
- `No.\xa02106`, `Feb.\xa07`, `Oct.\xa021`
- `Wall St.\xa0J.`, `Corp.\xa0Governance`

## Stage 2b: Gemini Formatted Audit

Run: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/gemini_audit.py --docx path/to/file.docx`

Sends EVERY footnote to Gemini with inline formatting markup:
- `*text*` = italic
- `[SC]text[/SC]` = small caps
- Plain text = roman

Uses structured JSON output (`response_mime_type: "application/json"`).

### Gemini Prompt Focuses On:
- Source type classification (case, statute, article, book, newspaper, working paper, hearing, letter, regulation)
- Typeface correctness per Rule 2 (italic vs small caps vs roman)
- Abbreviation correctness per T6/T13
- Short form validity (cases must not use supra)

<EXTREMELY-IMPORTANT>
## Iron Law: Audit ALL Footnotes

The Gemini audit MUST cover every footnote, not a subset. Auditing only "major" or "flagged" footnotes guarantees missed errors.

Previous failure: Auditing 45 of 239 footnotes missed 41 journal names needing small caps.
</EXTREMELY-IMPORTANT>

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Sending plain text to Gemini | 10-20x false positives without formatting info | Always include inline markup |
| Auditing a subset of footnotes | Missed errors guaranteed | Audit ALL footnotes |
| Skipping NBSP variants in mechanical checks | Silent search failures | Always try both space types |
| Trusting Gemini results without cross-checking | Gemini hallucinates rules | Cross-reference findings with Bluebook rules |

## Merging Mechanical + Gemini Findings

When deduplicating findings, **mechanical checks are authoritative for deterministic rules**:
- Signal italic formatting → trust mechanical checker (regex on run-level XML), not Gemini
- Terminal periods → trust mechanical checker
- Id. chain validation → trust mechanical checker
- Journal/book small caps patterns → trust mechanical checker

Gemini is authoritative only for **judgment calls** that require citation classification:
- Source type classification (is this a book or a report?)
- Typeface rules that depend on source type (italic title vs small caps title)
- Abbreviation correctness (T6/T13 tables)
- Short form validity

**Never drop a mechanical finding because Gemini didn't flag it.** Gemini misses ~30% of signal formatting issues because its attention focuses on citation-level analysis. The mechanical checker catches 100% of signal issues by design.

## Gate: Exit Check

Before proceeding to Report phase:
- [ ] `scratch/audit_findings.json` exists
- [ ] Mechanical check results cover ALL footnotes
- [ ] Gemini audit results cover ALL footnotes (verify count matches extract)
- [ ] Findings deduplicated (mechanical findings preserved; only Gemini-unique judgment calls added)

## Next Phase

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/audit-report/SKILL.md")
```
