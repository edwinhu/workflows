---
name: audit-check
description: "Phase 2: Run mechanical checks and Claude formatted audit"
---

# Phase 2: Check (Mechanical + AI Audit)

Two-stage checking: Python mechanical checks catch definite errors; Claude in-context audit catches judgment-call issues.

## Stage 2a: Mechanical Checks (Python)

Run (paths relative to this skill's base directory): `python3 ../../../../../scripts/scan_formatting.py --docx path/to/file.docx`

Checks performed on ALL footnotes:
1. **Journal name small caps** - Comprehensive pattern list (law reviews, finance journals, newspapers, periodicals, forums)
2. **Book title small caps** - Detect italic book titles that should be small caps
3. **Id. chain validation** - Rule 4.1 mechanical check (single-source predecessor)
4. **Signal italic consistency** - All signals (see, cf., e.g.) must be italic
5. **Terminal period** - Every footnote must end with a period
6. **Hereinafter consistency** - Defined at first citation, used consistently after
7. **Author name supra format** - Text before `*supra*` should be roman, not italic (unless it's a case name short form). Catches `*Manne, supra*` → should be `Manne, *supra*`
8. **Italic spillover** - Trailing/leading spaces inside italic or small caps runs (e.g., `*supra *` should be `*supra* `). These don't affect Word display but cause LLM misparses

### NBSP Handling

DOCX uses non-breaking spaces (`\xa0`) in abbreviations. ALL search functions must handle both `\x20` and `\xa0`:
- `No.\xa02106`, `Feb.\xa07`, `Oct.\xa021`
- `Wall St.\xa0J.`, `Corp.\xa0Governance`

## Stage 2b: Claude In-Context Formatted Audit

**Extract all formatted footnotes, then analyze them directly in Claude's context.**

### Step 1: Extract formatted footnotes

Run: `python3 ../../../../../scripts/gemini_audit.py --docx path/to/file.docx --extract-only`

If `--extract-only` is not supported, use the extraction function directly:
```python
from gemini_audit import extract_formatted_footnotes
footnotes = extract_formatted_footnotes("path/to/file.docx")
```

Or extract manually — the formatted text uses inline markup:
- `*text*` = italic
- `[SC]text[/SC]` = small caps
- Plain text = roman

### Step 2: Analyze ALL footnotes in context

With ~200 footnotes at ~100-200 tokens each (~20-40K tokens), Claude can analyze them all in a single pass. This is **better than per-footnote Gemini calls** because Claude sees cross-footnote patterns (supra chains, hereinafter consistency, repeated source type issues).

**Audit focuses on:**
- Source type classification (case, statute, article, book, newspaper, working paper, hearing, letter, regulation)
- Typeface correctness per Rule 2 (italic vs small caps vs roman)
- Abbreviation correctness per T6/T13
- Short form validity (cases must not use supra)
- Cross-footnote consistency (supra references, hereinafter definitions)

**Output format:** JSON array matching the same schema as before:
```json
[{
  "fn_num": 1,
  "issues": [{"type": "typeface", "element": "...", "current_format": "roman", "correct_format": "italic", "rule": "Rule 2.1", "description": "..."}],
  "severity": "clean|minor|moderate|major"
}]
```

<EXTREMELY-IMPORTANT>
## Iron Law: Audit ALL Footnotes

The audit MUST cover every footnote, not a subset. Auditing only "major" or "flagged" footnotes guarantees missed errors.

Previous failure: Auditing 45 of 239 footnotes missed 41 journal names needing small caps.
</EXTREMELY-IMPORTANT>

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Auditing plain text without formatting markup | 10-20x false positives without formatting info | Always include inline markup |
| Auditing a subset of footnotes | Missed errors guaranteed | Audit ALL footnotes |
| Skipping NBSP variants in mechanical checks | Silent search failures | Always try both space types |
| Trusting AI audit results without cross-checking | AI audits can hallucinate rules | Cross-reference findings with Bluebook rules |

## Merging Mechanical + Claude Findings

When deduplicating findings, **mechanical checks are authoritative for deterministic rules**:
- Signal italic formatting → trust mechanical checker (regex on run-level XML)
- Terminal periods → trust mechanical checker
- Id. chain validation → trust mechanical checker
- Journal/book small caps patterns → trust mechanical checker

Claude's in-context audit is authoritative for **judgment calls** that require citation classification:
- Source type classification (is this a book or a report?)
- Typeface rules that depend on source type (italic title vs small caps title)
- Abbreviation correctness (T6/T13 tables)
- Short form validity
- Cross-footnote consistency (advantage over per-footnote Gemini: Claude sees all footnotes at once)

**Never drop a mechanical finding because the AI audit didn't flag it.** The mechanical checker catches 100% of signal issues by design.

## Gate: Exit Check

Before proceeding to Report phase:
- [ ] `scratch/audit_findings.json` exists
- [ ] Mechanical check results cover ALL footnotes
- [ ] Claude audit results cover ALL footnotes (verify count matches extract)
- [ ] Findings deduplicated (mechanical findings preserved; only Claude-unique judgment calls added)

## Next Phase

```
Read("../audit-report/SKILL.md")
```
