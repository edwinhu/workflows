---
name: audit-correct
description: "Phase 4: Apply corrections to DOCX"
---

# Phase 4: Correct

Apply approved corrections to the DOCX file via lxml XML manipulation.

## What This Phase Does

1. Back up the original DOCX
2. Apply corrections in order:
   a. Cross-reference resolution (fill `[_]` placeholders)
   b. Small caps for journal/periodical names (run-splitting)
   c. Small caps for book titles (italic -> small caps)
   d. Signal italic fixes
   e. Id. chain corrections
   f. Terminal period additions
   g. Other typeface fixes
3. Write corrected DOCX

## Run-Splitting Approach

When formatting a substring within a larger run:
1. Find the run containing the target text
2. Split into 3 runs: prefix (original) + target (new format) + suffix (original)
3. Clone `rPr` from original run via `deepcopy`
4. Add new formatting only to target run
5. Set `xml:space="preserve"` on all `<w:t>` elements

## Critical Gotchas

### NBSP Variants
All search operations MUST handle `\xa0` (non-breaking space):
```python
def find_in_run(text, target):
    if target in text:
        return text.find(target)
    nbsp_target = target.replace(' ', '\xa0')
    if nbsp_target in text:
        return text.find(nbsp_target)
    # Try regex with [\s\xa0] for mixed
    import re
    pattern = re.escape(target).replace(r'\ ', r'[\s\xa0]')
    m = re.search(pattern, text)
    return m.start() if m else -1
```

### footnoteRef Space Run Bug
The run after `<w:footnoteRef/>` often contains the full footnote text, not just a space. When replacing entire footnote content, keep ONLY the footnoteRef run and add an explicit space run.

### Cross-Run Text
`supra note 10` spans italic + roman runs. Target the specific run containing the text you need to change (e.g., just "note 10" in the roman run).

<EXTREMELY-IMPORTANT>
## Iron Law: Verify Every Fix

After each category of corrections, verify the fix was applied by reading back the modified XML. Silent failures from NBSP, run boundaries, or wrong-run targeting are common.

Claiming fixes were applied without reading them back is LYING.
</EXTREMELY-IMPORTANT>

## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "The fix applied in code, no need to verify" | NBSP causes silent failures; run boundaries cause wrong-target | Read back the XML and verify |
| "I'll verify all at once at the end" | By then you can't tell which fix failed | Verify after each category |
| "This is the same pattern as last time" | Each footnote has unique run structure | Check each footnote individually |
| "I can skip the backup" | One XML corruption destroys the whole document | Always back up first |

## Gate: Exit Correct

Before proceeding to Verify phase:
- [ ] Backup DOCX exists (original preserved)
- [ ] Corrected DOCX exists
- [ ] Per-category fix counts logged
- [ ] Spot-check verification passed (at least 5 random fixes checked)

## Next Phase

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/audit-verify/SKILL.md")
```
