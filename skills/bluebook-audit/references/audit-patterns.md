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

Stage 2: Gemini Batch Audit (per-footnote)
  ├── Send each footnote with formatting markup to Gemini
  ├── Structured output: issue description, rule, severity, fix
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

## Source Type Typeface Reference (Rule 2.1 for Law Review Footnotes)

The hardest part of the Gemini audit is source type classification. Gemini consistently misclassifies non-standard sources. This reference table is authoritative.

### ITALIC (titles of articles, named documents, speeches)

| Source Type | Example | Rule |
|-------------|---------|------|
| Law review article title | *The Power of Proxy Advisors* | 16.1 |
| Newspaper article title | *Exclusive: White House Explores Rules...* | 16.6 |
| Blog post / client alert title | *What's Going On with the SEC's Proxy Advisor Rules?* | 18.2 |
| Speech / remarks title | *Remarks at the 2025 Institute for Corporate Counsel* | 17.1.5 |
| Press release title | *Deutsche Börse to Acquire ISS* | 17.1.3 |
| Letter / testimony title (within larger work) | *Chairman & CEO Letter to Shareholders* | 15.5.1 |
| Case names | *Smith v. Jones* | 10.2.1 |
| Signals (see, cf., e.g.) | *See also* | 1.2 |
| Short form signals (id., supra, infra) | *supra* note 42 | 4.1, 4.2 |

### SMALL CAPS (titles of books, reports, periodicals)

| Source Type | Example | Rule |
|-------------|---------|------|
| Book title | [SC]The Modern Corporation and Private Property[/SC] | 15.1 |
| Law journal name | [SC]U. Pa. L. Rev.[/SC] | 16.1 |
| Newspaper name | [SC]Wall St. J.[/SC] | 16.6 |
| Institutional report title (GAO, CRS) | [SC]Proxy Advisor Regulation...[/SC] | 15 |
| Annual report title | [SC]JPMorgan Chase & Co., 2023 Annual Report[/SC] | 15 |
| Named blog / podcast (as periodical) | [SC]Shareholder Primacy[/SC] | 16 (by analogy) |

### ROMAN (regulatory materials, designations, series names)

| Source Type | Example | Why Roman |
|-------------|---------|-----------|
| Executive order title | Protecting American Investors... | Rule 14.7 |
| SEC release / rule title | Commission Guidance Regarding... | Rule 14.6 (regulatory material) |
| SEC concept release title | Concept Release on the U.S. Proxy System | Rule 14.6 |
| Federal Register entry title | Proxy Voting Advice, 87 Fed. Reg. | Rule 14.6 |
| Working paper series designation | Eur. Corp. Governance Inst., Fin. Working Paper No. 975/2024 | Rule 17 (parenthetical) |
| ECGI / NBER paper number | ECGI Law Working Paper No. 875/2025 | Series designation |
| Company name in no-action letter | Exxon Mobil Corp., SEC No-Action Letter | Rule 14.6 |
| Statute / bill title | Protecting Americans' Retirement Savings Act | Rule 12.4 |
| Comment letter title | Comments on Proposed Amendments | Rule 17 (letter) |
| Webpage description (untitled) | Issuer Data Verification (IDR) | Rule 18.2 |
| Author name before *supra* | Levine, *supra* note 13 | Rule 4.2 |
| Hereinafter short forms | GAO Report, CRS Report | Rule 4.2(b) |

### Common Gemini Misclassifications

Gemini consistently gets these wrong. When reviewing Gemini suggestions for these source types, default to the table above:

1. **SEC releases/rules** — Gemini says italic; actually roman (regulatory material)
2. **Executive orders** — Gemini says italic; actually roman (Rule 14.7)
3. **Working paper series names** — Gemini says small caps; actually roman (parenthetical designation)
4. **Company names in no-action letters** — Gemini says italic; actually roman
5. **Author names before supra** — Gemini doesn't flag italic author names; they should be roman

## Annotation Extraction: Space-in-Marker Bug

When extracting formatted text from DOCX runs for Gemini, trailing/leading spaces inside italic or small caps runs produce malformed annotations:

```
BAD:  *supra * (space inside marker — LLMs don't parse this as italic)
GOOD: *supra*  (space outside marker)
```

**Fix:** Strip leading/trailing spaces from the text before wrapping in markers, then re-add the spaces outside:

```python
text = t.text
if is_italic or has_sc:
    leading = " " if text.startswith(" ") else ""
    trailing = " " if text.endswith(" ") else ""
    inner = text.strip()
    if not inner:
        parts.append(text)  # whitespace-only run: emit as plain
    elif is_italic:
        parts.append(f"{leading}*{inner}*{trailing}")
    else:
        parts.append(f"{leading}[SC]{inner}[/SC]{trailing}")
```

In the "Other People's Votes" audit, 14% of italic runs had this bug, inflating false positives from 61 to 80.

## Stage 2: Formatted Text Is Essential for Gemini Audit

### The Problem

Sending **plain text** footnotes to Gemini for Bluebook audit produces massive false positives. In testing: 414 flagged issues from 239 footnotes, the vast majority spurious.

**Root cause:** Without formatting information, Gemini cannot distinguish:
- Italic case names from roman text (is "Smith v. Jones" italicized or not?)
- Small caps journal names from roman (is "U. Pa. L. Rev." in small caps?)
- Italic signals from text ("See" as signal vs. "See" as English word)

### The Solution: Inline Formatting Markup

Convert DOCX runs to inline markup before sending to Gemini:

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

### Gemini Prompt Structure

Send each footnote with:
1. The formatted text
2. The footnote number
3. The preceding footnote's formatted text (for id. chain validation)
4. Request structured JSON output: `{issue, rule, severity, suggested_fix}`

Use `response_mime_type: "application/json"` for reliable structured output.

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

---

## Stage 6: Cross-Reference Field Codes

Converts hardcoded supra/infra note numbers to NOTEREF fields that auto-update when footnotes are renumbered.

### Script: `create_crossrefs.py`

```bash
BB_SCRIPTS=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/skills/bluebook-audit/scripts 2>/dev/null | sort -V | tail -1)
python3 "$BB_SCRIPTS/create_crossrefs.py" --docx file.docx --dry-run   # preview
python3 "$BB_SCRIPTS/create_crossrefs.py" --docx file.docx              # apply (creates .bak)
python3 "$BB_SCRIPTS/create_crossrefs.py" --docx file.docx --output out.docx
```

### What It Does

1. **Parses** all `supra note N` and `infra note N` patterns in footnotes.xml
2. **Adds bookmarks** (`_Ref_fnN`) to target footnoteReferences in document.xml
3. **Replaces** hardcoded numbers with 5-run NOTEREF field codes:
   ```xml
   <w:r><w:fldChar w:fldCharType="begin"/></w:r>
   <w:r><w:instrText> NOTEREF _Ref_fn42 \h </w:instrText></w:r>
   <w:r><w:fldChar w:fldCharType="separate"/></w:r>
   <w:r><w:t>42</w:t></w:r>
   <w:r><w:fldChar w:fldCharType="end"/></w:r>
   ```

### Key Design Decisions

- **Bookmark naming**: `_Ref_fn{display_num}` for new bookmarks; reuses existing `_Ref*` bookmarks
- **Bookmark IDs**: Start at `max_existing + 1` to avoid collisions
- **Field skipping**: The while-loop re-scans with field-aware text extraction, so already-converted numbers are invisible to regex (prevents infinite loops)
- **Run splitting**: Clones original rPr to preserve font size, color, highlight
- **Range handling**: `infra notes 209-210` creates two NOTEREFs with separator text between them
- **Skip detection**: Footnotes already containing NOTEREF instrText are skipped entirely

### After Running

Open in Word → **Ctrl+A, F9** to update all fields. The display numbers should match the originals. To test: manually renumber a footnote and confirm supra references update.
