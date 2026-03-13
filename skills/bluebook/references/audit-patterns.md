# Bluebook Footnote Audit Patterns

Reference for conducting systematic Bluebook audits of law review manuscripts. Covers the full pipeline from mechanical checks through AI-assisted audit to DOCX corrections.

## Audit Pipeline Architecture

The audit proceeds in five stages, each catching different error classes:

```
Stage 1: Python Mechanical Checks
  ├── Regex-based pattern matching (wrong abbreviations, spacing)
  ├── Id. chain validation (Rule 4.1 mechanical check)
  ├── Hereinafter definition tracking
  └── Output: list of definite errors + suspect patterns

Stage 2: Claude In-Context Audit (all footnotes at once)
  ├── Load all footnotes with formatting markup into Claude's context
  ├── Structured output: issue description, rule, severity, fix
  ├── Cross-footnote pattern detection (supra chains, hereinafter consistency)
  ├── Deduplication against Stage 1 findings
  └── Output: prioritized issue list (~20-30 real issues from ~240 footnotes)

Stage 3: Sub-Agent Cross-Footnote Review
  ├── Citation registry construction
  ├── Cross-reference resolution (supra, id., hereinafter chains)
  ├── Infra reference validation against later footnotes
  └── Output: cross-reference errors, missing definitions

Stage 4: DOCX XML Corrections
  ├── Apply fixes via lxml (see docx-footnote-xml skill)
  ├── Handle run-splitting for formatting changes
  ├── Preserve footnoteRef structure
  └── Output: corrected DOCX

Stage 5: Perma.cc Archiving
  ├── Extract all URLs from footnotes
  ├── Deduplicate (same URL across multiple footnotes)
  ├── Archive via Perma.cc API
  └── Insert perma.cc links into footnotes
```

## Stage 2: Formatted Text Is Essential for AI Audit

### The Problem

Sending **plain text** footnotes for Bluebook audit produces massive false positives. In testing: 414 flagged issues from 239 footnotes, the vast majority spurious.

**Root cause:** Without formatting information, the auditor cannot distinguish:
- Italic case names from roman text (is "Smith v. Jones" italicized or not?)
- Small caps journal names from roman (is "U. Pa. L. Rev." in small caps?)
- Italic signals from text ("See" as signal vs. "See" as English word)

### The Solution: Inline Formatting Markup

Convert DOCX runs to inline markup before auditing:

```
Plain text (BAD):
  See Sunstein, supra note 12, at 2040.

Formatted text (GOOD):
  *See* Sunstein, *supra* note 12, at 2040.
```

**Markup conventions:**
- `*text*` for italic
- `[SC]text[/SC]` for small caps
- `**text**` for bold (rare in footnotes)
- `***text***` for bold italic

### Why Not Pandoc?

Pandoc conversion loses small caps information because Markdown has no native small caps representation. Since Bluebook typeface rules (Rule 2) require small caps for books, journal names, and institutional authors, this is a critical gap.

### Implementation

```python
def footnote_to_markup(footnote_elem):
    """Convert DOCX footnote XML to formatting-annotated text."""
    parts = []
    for run in footnote_elem.findall('.//w:r', NSMAP):
        # Skip footnoteRef runs
        if run.find('.//w:footnoteRef', NSMAP) is not None:
            continue
        t = run.find('.//w:t', NSMAP)
        if t is None or not t.text:
            continue
        rpr = run.find('.//w:rPr', NSMAP)
        is_italic = rpr is not None and rpr.find('.//w:i', NSMAP) is not None
        is_smallcaps = rpr is not None and rpr.find('.//w:smallCaps', NSMAP) is not None
        is_bold = rpr is not None and rpr.find('.//w:b', NSMAP) is not None

        text = t.text
        if is_smallcaps:
            text = f'[SC]{text}[/SC]'
        if is_italic and is_bold:
            text = f'***{text}***'
        elif is_italic:
            text = f'*{text}*'
        elif is_bold:
            text = f'**{text}**'
        parts.append(text)
    return ''.join(parts)
```

### Claude In-Context Audit

With 1M context, load ALL footnotes at once (not per-footnote). This enables:
1. Cross-footnote supra chain validation
2. Hereinafter consistency checking
3. Repeated source type classification (flag once, apply everywhere)

Include with each footnote:
1. The formatted text with inline markup
2. The footnote number
3. Request structured JSON output: `{issue, rule, severity, suggested_fix}`

## Stage 3: Citation Registry and Cross-Reference Resolution

### Building the Citation Registry

Parse all footnotes to build a registry mapping short forms to their definitions:

```python
citation_registry = {
    "hereinafter": {
        "GAO Report": {"defined_in": 12, "full_title": "U.S. Gov't Accountability Office..."},
        "Proxy Advisory Report": {"defined_in": 3, "full_title": "..."},
    },
    "authors": {
        "Choi, Fisch & Kahan": [
            {"fn": 10, "title_fragment": "The Power of Proxy Advisors"},
            {"fn": 21, "title_fragment": "Who Calls the Shots?"},
        ],
        "Sunstein": [
            {"fn": 5, "title_fragment": "Expressive Function"},
        ],
    },
}
```

### Multi-Work Author Disambiguation

When an author has multiple cited works, supra references need title disambiguation:
- `Choi, Fisch & Kahan, supra note 10` -- unambiguous only if they have one work
- If multiple works: must verify the note number resolves to the correct title
- Use title fragment matching with confidence levels

### Confidence Levels

| Level | Meaning | Action |
|-------|---------|--------|
| High | Exact author + note number match, single work | Auto-fix |
| Medium | Author match, note number plausible, multiple works | Flag for review |
| Low | Partial match or ambiguous reference | Manual review required |

### Infra Resolution

Infra references (forward-looking) are resolved against later footnotes:
```
FN 5: "See infra note 45 and accompanying text."
  --> Verify FN 45 exists and contains a relevant citation
```

## Id. Chain Validation (Rule 4.1)

### Mechanical Rules

1. **Id. requires single-source predecessor.** If the preceding footnote cites multiple sources, id. is ambiguous and must be replaced with an explicit supra or short form.

2. **Consecutive single-source citations should use id.** When the preceding footnote cites the same single source, the next footnote should use id. instead of repeating the supra form.

3. **Id. chains break on multi-source footnotes.** Even if a footnote three back cited the same source, if the intervening footnote cited multiple sources, id. cannot be used.

### Validation Algorithm

```python
def validate_id_chains(footnotes):
    """Check all id. references for validity."""
    issues = []
    for i, fn in enumerate(footnotes):
        if uses_id(fn):
            prev = footnotes[i - 1]
            if count_sources(prev) > 1:
                issues.append({
                    "fn": i + 1,
                    "issue": "Id. follows multi-source footnote",
                    "rule": "4.1",
                    "fix": "Replace id. with explicit supra/short form",
                    "prev_fn": i,
                    "prev_sources": extract_sources(prev),
                })
        # Also check: should this footnote USE id. but doesn't?
        if i > 0 and not uses_id(fn):
            prev = footnotes[i - 1]
            if count_sources(prev) == 1:
                prev_source = extract_sources(prev)[0]
                if cites_same_source(fn, prev_source):
                    issues.append({
                        "fn": i + 1,
                        "issue": "Should use id. instead of repeating citation",
                        "rule": "4.1",
                        "fix": f"Replace with Id. or Id. at [page]",
                    })
    return issues
```

## Hereinafter Management (Rule 4.2(b))

### Rule

Hereinafter must be defined at the **first** citation of the source. If a hereinafter is defined at, say, FN 15 but the source first appears in FN 8, the definition must move to FN 8.

### Cascading Updates

When moving a hereinafter definition to an earlier footnote:
1. Add `[hereinafter Short Name]` to the first citation
2. Update ALL subsequent citations between the old and new definition locations to use the short form
3. Verify no orphaned hereinafter definitions remain

## Stage 5: Perma.cc Institutional API Usage

### Account Limits

- **Free accounts:** 10 links/month -- insufficient for law review work
- **Institutional accounts:** Unlimited via organization folders

### Finding Your Organization Folder

```bash
curl -H "Authorization: ApiKey YOUR_API_KEY" \
  https://api.perma.cc/v1/organizations/
```

Response includes organization ID and folder IDs. Note the folder ID for archive creation.

### Creating Archives

```python
import requests

PERMA_API_KEY = "your-key"
PERMA_FOLDER_ID = 12345  # from organizations endpoint

def archive_url(url):
    resp = requests.post(
        "https://api.perma.cc/v1/archives/",
        headers={"Authorization": f"ApiKey {PERMA_API_KEY}"},
        json={
            "url": url,
            "folder": PERMA_FOLDER_ID,  # CRITICAL: enables institutional limits
        },
    )
    resp.raise_for_status()
    return resp.json()["guid"]  # e.g., "ABCD-1234"
```

### Best Practices

1. **Deduplicate URLs first.** The same SSRN or government URL often appears in multiple footnotes. Archive once, use the same perma.cc link everywhere.

2. **Save progress after each archive.** Write `{url: perma_guid}` mappings to a JSON file after each successful archive. If the script fails mid-run, you can resume without re-archiving.

3. **Rate limiting.** Perma.cc does not document rate limits, but space requests ~1 second apart to be safe.

4. **Perma.cc link format:** `https://perma.cc/GUID` (e.g., `https://perma.cc/ABCD-1234`)

5. **Insertion format in footnotes:** Typically added in brackets after the URL:
   ```
   https://www.example.com/report.pdf [https://perma.cc/ABCD-1234].
   ```
