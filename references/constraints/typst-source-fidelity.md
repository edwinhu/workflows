---
name: typst-source-fidelity
description: Every claim in slides/notes must be verifiable against the source paper — flag ungrounded content to user
applies-to: [workshop, workshop-revise]
---

<EXTREMELY-IMPORTANT>
## The Iron Law of Source Fidelity

**EVERY FACTUAL CLAIM IN SLIDES AND NOTES MUST BE TRACEABLE TO THE SOURCE PAPER. This is not negotiable.**

Workshop presentations summarize and present a research paper. The slides and notes are a faithful representation of the paper's arguments, findings, and conclusions — not an independent commentary.

### What Must Be Verified

| Content Type | Verification Method |
|-------------|-------------------|
| Empirical results (coefficients, percentages, sample sizes) | Extract from paper tables/text via look-at or rga |
| Author claims and conclusions | Verify against paper's abstract, conclusion, or specific section |
| Statutory/regulatory references | Cross-check against paper's citations |
| Case names and holdings | Verify against paper's discussion |
| Timeline events and dates | Extract from paper's narrative |

### Verification Protocol

After generating or editing slides/notes content:

1. **List all factual claims** in the changed slides
2. **For each claim**, identify the paper section/page that supports it
3. **Flag ungrounded claims** — any claim you cannot trace to a specific paper passage
4. **Report to user**: "These N claims need verification: [list]"

### Ungrounded Content

If a claim cannot be found in the paper:
- **Do NOT include it** in slides/notes
- **Flag it to the user** with: "Could not find support for: [claim]. Should this be included?"
- **Never fill gaps from training knowledge** — see the `typst-source-first` constraint
</EXTREMELY-IMPORTANT>
