# Law Review Template Formatting

Reference for the law review document template at `templates/law_review_template.docx`. (relative to this skill's base directory)

Load this file when creating or converting Word documents.

## Heading Hierarchy

| Style | Use | Formatting |
|-------|-----|------------|
| **Title** | Article title | Bold, small caps, centered |
| **Heading 1** | I., II., III. sections | Bold, left-aligned |
| **Heading 2** | A., B., C. subsections | Bold, left-aligned |
| **Heading 3** | i., ii. sub-subsections | Italic, left-aligned |
| **Heading 4** | Lowest-level headings | Italic, indented |

**ALL headings MUST be in Title Case.** Capitalize the first and last word, and all major words. Do NOT capitalize articles (a, an, the), coordinating conjunctions (and, but, or, nor, for, yet, so), or prepositions of four or fewer letters (in, on, at, to, with, from) unless they are the first or last word.

- WRONG: `A. The impact of proxy voting on governance outcomes`
- RIGHT: `A. The Impact of Proxy Voting on Governance Outcomes`

## Body Text Styles

| Style | Use |
|-------|-----|
| **Body Text** | All body paragraphs (first-line indent) |
| **First Paragraph** | Paragraph with no first-line indent (available if needed) |

All body paragraphs use `Body Text` (indented). The `First Paragraph` style is available for cases where a flush-left paragraph is needed.

## Gate Function: Document Creation

When user requests a Word document (docx), follow this 5-step gate:

```
STEP 1: LOAD    → Load /docx skill
STEP 2: COPY    → Copy templates/law_review_template.docx
                  to target location (e.g., user's specified path)
STEP 3: EDIT    → Add content to the COPIED template
STEP 4: VERIFY  → Check template formatting preserved (styles, footnotes)
STEP 5: DELIVER → Return the document to user
```

**GATE VIOLATION = RESTART**: If any step is skipped, delete the output and restart from Step 1.

## Pandoc Conversion

When converting markdown or other formats to docx, ALWAYS use the template as `--reference-doc`:

```bash
pandoc input.md -o output.docx --reference-doc="templates/law_review_template.docx"
```

This applies all template styles (fonts, spacing, heading formatting, footnote styles) to the output. Pandoc maps its internal heading levels to the template's Heading 1–4 styles, and body text to the Body Text style.

**NEVER run `pandoc -o output.docx` without `--reference-doc`.** A bare conversion produces default Calibri formatting that violates journal requirements.

## Template Facts

- Retroactive styling breaks footnotes — formatting is structural, not cosmetic, so it cannot be "applied properly later". Copying the template is one step; starting from a blank doc means redoing all formatting.
- Wrong format means rejection by journals, whether or not the user mentioned the template — professional output is implicit in every docx request.

## Red Flags

- About to create a new Word document from scratch → copy the template first.
- About to run pandoc or the docx skill without the template as base → the template IS the formatting; wire in `--reference-doc` now.
