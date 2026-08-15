---
name: typst-teleprompter-notes
description: Notes must be teleprompter-style prose — 1-2 sentences per bullet, no fragments, no hollow references, no slide narration
type: constraint
testable: true
check-script: teleprompter-notes.py
applies-to: [workshop, workshop-revise, lecture-prep, notes-edit, lecture-prep-edit]
---

<EXTREMELY-IMPORTANT>
## Rule — The Iron Law of Teleprompter-Style Notes

**EACH BULLET (`-`) IN NOTES MUST CONTAIN 1-2 SENTENCES OF SUBSTANTIVE, SPEAKABLE CONTENT. This is not negotiable.**

The presenter reads notes live at the podium — they are teleprompter lines for a scripted talk. Every bullet must contain the actual words the presenter will say.

### Failure 1: Dense Bullets (3+ sentences)

A 4-sentence bullet is impossible to skim while maintaining eye contact with the audience. **If a bullet has 3+ sentences:** split it into multiple bullets. Keep the full prose — do NOT convert to outline-style fragments. The presenter scripts everything they say.

### Failure 2: Hollow Bullets (references content instead of containing it)

A bullet that says "there are six scenarios — let's walk through them" is useless at the podium. The presenter cannot "walk through" scenarios that aren't written down. The notes ARE the script — if it's not on the page, it doesn't get said.

**Hollow bullets include:**
- "Let's walk through the scenarios" (what scenarios? write them out)
- "There are six hypotheticals here" (list them — the presenter needs to read each one)
- "The paper discusses several factors" (which factors? extract and write as prose)
- "The TM discusses several factors" (which factors? extract and write them as prose)
- "Consider the following examples" (what examples? they must be on the page)
- Any bullet that promises content the presenter must improvise or remember

**The fix for a hollow bullet:** extract the referenced content from the source (paper, TM, or PPTX) and write it out as full teleprompter prose. If the TM says there are six scenarios, write six groups of bullets — one per scenario — with the setup, question, and answer guidance for each.

### Failure 3: Slide Narration (meta-referencing the visual)

A bullet that says "the slide shows" or "the diagram on this slide" is narrating the presentation, not teaching. The presenter is standing next to the slide — the audience can see it. The notes should state the content directly, as if the slide weren't there.

**Narration bullets include:**
- "The slide shows a comparison of shelf vs. non-shelf..." (just state the comparison)
- "The diagram on this slide illustrates..." (just describe what it illustrates)
- "As you can see on the slide..." (they can already see it — say the content)
- "This table presents..." (walk through the rows instead)
- "Looking at this chart..." (describe the data directly)

**The fix for a narration bullet:** Remove the meta-reference and state the content directly. Instead of "The slide shows a timeline of the offering process," say "The offering process has three phases: filing, review, and effectiveness."

**BAD:** `- The slide shows the elements of a shelf registration statement.`
**GOOD:** `- A shelf registration statement has three key elements: the base prospectus, the prospectus supplement, and the undertakings.`

**BAD:** `- The diagram on this slide illustrates the dual filing process.`
**GOOD:** `- So there are actually two filings happening here --- the base registration statement, and then a prospectus supplement each time you sell.`

### Answer Blocks Are Scripted

**This applies to ALL content in `notes/*.typ`** — both narration AND answer blocks `[...]`. If the presentation includes Q&A preparation or cold-call answers in notes, those blocks follow the SAME rules — full prose, max 2 sentences per bullet. The professor reads answer blocks aloud too, because students usually don't give a full or good enough answer.

**Applies to:** workshop, workshop-revise, lecture-prep (NOTES phase), notes-edit, lecture-prep-edit (when fixing notes)
</EXTREMELY-IMPORTANT>

## Notes Facts

- Slides and notes serve different functions: slides carry bullet points; notes carry the spoken words. Copying slide bullets into notes produces a deck the presenter cannot read aloud — outline fragments (e.g. `- ECMH → price reflects info`) are not speakable.
