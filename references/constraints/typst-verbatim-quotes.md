---
name: typst-verbatim-quotes
description: Quotes from statutes, court opinions, the paper and the PPTX must be preserved verbatim — never paraphrase legal or scholarly text
type: constraint
testable: partial
check-script: smart-apostrophe.py
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

<EXTREMELY-IMPORTANT>
## The Iron Law of Verbatim Quotes

**WHEN THE SOURCE CONTAINS A DIRECT QUOTE, PRESERVE IT VERBATIM. This is not negotiable.**

Statutory text, judicial language, and direct quotes from the paper are precise — every word matters. When the source paper, statute, or opinion contains a direct quote, it must appear in the slides **exactly as it appears in the source**, in full.

**Do NOT:**
- Paraphrase statutory language ("Congress required..." instead of the actual text)
- Truncate quotes with ellipsis unless the source itself uses ellipsis
- Summarize a quote into your own words
- Split a quote across slides in a way that loses words
- "Clean up" archaic or awkward phrasing
- Reconstruct quotes from training knowledge

**Do:**
- Copy the full quote verbatim from the source
- Preserve original formatting (italics, emphasis) where Typst supports it
- Present quotes as plain text within bullets or as `#quote()` blocks — NOT in `#callout()` boxes (callouts are for warnings/notes, not for quoting source material)
- If the quote causes overflow, fix by adjusting surrounding content (reduce intro text, tighten transitions) — never by trimming the quote itself
- When a quote is too long for one slide, split at a natural sentence boundary and continue on the next slide with clear continuation marking

**Why:** Statutory text IS the law — paraphrasing changes the meaning. Opinion quotes are what the court actually said, and students need to see the real language to do close reading. Paper quotes are what the authors actually wrote. Training knowledge reconstructs quotes with subtle errors.

### The Iron Law of Verbatim Statutory and Opinion Quotes

For lecture material built from a PPTX source:

**WHEN THE PPTX CONTAINS AN ACTUAL QUOTE FROM A STATUTE OR COURT OPINION, PRESERVE THE FULL QUOTE VERBATIM. This is not negotiable.**

A quote is indicated by quotation marks, block-quote formatting, or explicit attribution like "Section 10(b) provides:" or "The Court held:". A paraphrased "summary" of Section 10(b) is not Section 10(b). Training knowledge may reconstruct quotes with subtle errors (wrong word, missing clause); only the PPTX source is authoritative.

**Applies to:** workshop, workshop-revise, lecture-prep (SLIDES phase), slides-edit, notes-edit, lecture-prep-edit
</EXTREMELY-IMPORTANT>

## Facts

- The Menora incident applies to quotes too: training knowledge reconstructs legal text with subtle errors — wrong words, missing clauses. Writing a statutory or opinion quote "from memory" is fabrication wearing the format of a citation; only the source is authoritative.
