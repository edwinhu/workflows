---
name: workshop-constraints
description: The fifteen vendored Typst deck and notes constraint modules in one preloadable file — bullet and label spacing, sub-bullets, tables, images, CeTZ and Fletcher diagrams, formatting, slide format, section hierarchy, notes structure, teleprompter notes, computed values, common elements, no-subtitle-echo. Preloaded into the workshop subagents; follow every module when writing or grading a .typ slide deck or notes file.
---

# Workshop Typst constraints

Fifteen modules in one file, because a deck doer needs all fifteen at once and naming them by path
is discretionary: a task prompt that lists fifteen paths is a suggestion, and a skipped read fails
silently. Preloaded, every module below arrives before the first turn.

Each module is reproduced verbatim from
`${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/constraints/`, where it also lives beside the
`.py` checker `run-constraints.py` runs. The files remain the authority for the checker; this file
is the authority for what you write.


---

# typst-bullet-spacing


## Rule

**Blank lines between ALL top-level bullet items.** No exceptions.

```typst
// CORRECT
- First point

- Second point

- Third point
```

```typst
// WRONG
- First point
- Second point
- Third point
```

## Bullet Spacing in Slides

Separate `-` bullet items with blank lines. This creates paragraph spacing between bullets in the rendered output, giving more breathing room on projected slides.

```typst
// CORRECT: blank lines between bullets
- Issuer bankrupt; officers fled #pause

- *Underwriters*, *auditors*, *lawyers* remain solvent #pause

- Gatekeepers can prevent fraud at lower cost
```

```typst
// WRONG: no blank lines (renders tightly packed)
- Issuer bankrupt; officers fled #pause
- *Underwriters*, *auditors*, *lawyers* remain solvent #pause
- Gatekeepers can prevent fraud at lower cost
```

This also applies to `+` (ordered lists) and numbered lists (`1.`, `2.`, etc.). Enforced by `bullet-spacing.py` (auto-discovered by `check-all.py`).

---

# typst-cetz-diagrams


## Rule

CeTZ canvas diagrams (timelines, conceptual visuals, information matrices) are used for visuals that don't fit table or bullet format. **Diagrams must be grounded in the paper's content** — they should visualize the paper's arguments, model structure, or data relationships. If a diagram synthesizes information not directly in the paper (e.g., a timeline of related regulation), document the decision and verify all facts against the source.

```typst
#cetz.canvas(length: 2em, {
  import cetz.draw: *
  // ... diagram code
})
```

**Minimum `length: 2em`.** Anything smaller produces unreadable diagrams on projected slides. If you encounter `length: 1cm`, `length: 0.8cm`, `length: 1.5em`, or similar — change it to `2em`.

**cetz-plot is FORBIDDEN** (version conflict with secreg theme's cetz 0.3.2). Plain `cetz.canvas` from the theme's bundled import is fine.

**Storytelling comment required:** Every `cetz.canvas(` must be preceded by a `// Storytelling:` comment. See the `typst-cetz-storytelling` constraint.

<EXTREMELY-IMPORTANT>
**Visual-verify loop MANDATORY for every CeTZ diagram.**

After creating or modifying any `cetz.canvas` block:
1. Compile slides.typ to PDF
2. Run visual-verify on the rendered diagram (via look-at with --goal targeting the diagram)
3. Score against the defect checklist: clipped text, overlapping elements, arrow routing, label anchoring, spacing consistency, text size
4. If score < 9.5 → fix and re-render (max 5 iterations)

**A diagram that compiles is NOT a diagram that works.** Compilation verifies syntax; visual-verify verifies that the audience can actually read it. Shipping an unverified diagram means the presenter discovers clipped labels at the podium.
</EXTREMELY-IMPORTANT>

## CeTZ Diagrams

In lecture material, CeTZ canvas diagrams (value lines, trading volume, information/control matrices) are used for quantitative and conceptual visuals that don't fit the Fletcher flowchart model.

The default `length: 1cm` is too small for 16:9 lecture slides viewed from the back of a classroom.

---

# typst-common-elements


## Rule

- `#callout[]` — for warnings, caveats, important notes ONLY. Not for quoting text.
- **Overflow warning:** Slides with `#callout[]` + 3 or more `#pause` markers are overflow-prone. Reduce content or split the slide.

## Common Elements

- `#callout()[text]`, `#callout(marker: emoji.quest)[question]` — for warnings, caveats, and important notes only. NOT for quoting statutory text or opinion language.
- `#grid(columns: (1fr, 1fr), gutter: 2em, [left], [right])`
- `#block(fill: rgb("#f0f0f0"), inset: 1em, radius: 5pt, width: 100%)[text]`
- `#table(columns: (auto, auto), inset: 10pt, table.header([*H1*], [*H2*]), ...)`

---

# typst-computed-values


## Rule

**Base values must be extracted from the paper first.** Then use Typst's `calc` module for derived values. Never type a number from memory — extract it from the paper's tables/figures, then compute.

**Never hardcode calculated numbers.** Use Typst's `calc` module:

```typst
#let start = 1e6
#let rate = 1.1
#let periods = 12
// WRONG: \$3.1 million
// RIGHT: \$#calc.round(start * calc.pow(rate, periods) / 1e6, digits: 1) million
```

If you catch yourself typing a dollar amount, percentage, or any derived number — STOP and write a `calc` expression.

## Computed Values / calc Module

The same rule in lecture material, where the derived number usually appears mid-sentence:

```typst
#let start = 1e6
#let rate = 1.1
#let periods = 12
// WRONG: After one year: \$3.1 million
// RIGHT: After one year: \$#calc.round(start * calc.pow(rate, periods) / 1e6, digits: 1) million
```

If you catch yourself typing a dollar amount, percentage, or any derived number — STOP and write a `calc` expression instead.

---

# typst-fletcher-diagrams


## Rule — Fletcher Diagrams (Timelines, Flowcharts)

Fletcher diagrams are used for flowcharts, timelines, and decision trees. **Diagrams must represent the source's logic, timeline, or decision structure** — not synthesized content from training knowledge. Every node label and edge label must trace to a specific concept in the paper, casebook section, or PPTX being presented.

```typst
#fletcher-diagram(
  node-stroke: 1pt, edge-stroke: 1pt, spacing: (2em, 2em),
  node((0, 0), [*Node A*], name: <a>, fill: rgb("#b8c9e8"), inset: 0.5em),
  node((2, 0), [*Node B*], name: <b>, fill: rgb("#c8e6c9"), inset: 0.5em),
  edge(<a>, <b>, "-|>", label: [Label]),
)
```

Colors: Blue `#b8c9e8`, Green `#c8e6c9`, Orange `#ffe0b2`, Red `#ffcdd2`, Gray `#e8e8e8`.

PPTX visual elements (timelines, flowcharts, comparisons) must be rendered using fletcher-diagram, table, or grid -- not as bullets or prose.

### Fletcher Spacing

Start tight. The driver is **edge label length**, not node count.

| Edge labels | Spacing | When |
|-------------|---------|------|
| None or single-word | `(2em, 2em)` | Default for all diagrams |
| Multi-word (2-3 words) | `(4em, 2em)` | Only when labels clip or crowd at 2em |

Vertical spacing of `2em` is sufficient for most diagrams. Do NOT use `(5em, 3em)`, `(6em, 3em)`, `(8em, 3em)` — these create unnecessarily wide diagrams that waste slide space.

### Fletcher Rules

- **No duplicate nodes:** Never create two nodes with the same text/label. If multiple edges need the same outcome (e.g., "Security" or "Not a Security"), use a single shared node and route all edges to it.
- **Edge routing with `udlr`:** When a direct edge would overlap other nodes or arrows, use Fletcher's vertex-based routing (e.g., `edge(<from>, (x1, y1), (x2, y2), <to>, "-|>")`) or direction strings (e.g., `"d,r,u"`) to route around obstacles with right-angle turns.
- **Storytelling comment required:** Every `#fletcher-diagram(` must be preceded by a `// Storytelling:` comment. See the `typst-cetz-storytelling` constraint for the comment format.
- **Visual-verify loop required:** Same as CeTZ — compile, render, score, iterate.

---

# typst-formatting


## Rule — Formatting

| Element | Syntax | Example |
|---------|--------|---------|
| Case names | `_Case v. Party_` | `_SEC v. Howey_` |
| Key terms | `*emphasis*` | `*materiality*` |
| Greek letters | `$beta$` | |
| Casebook ref | `(CP XX)` | `(CP 120)` |
| Em-dash | `---` | separate clauses |
| En-dash (ranges) | `--` | `10--20`, `2020--2025` |
| Dollar sign | `\$` | `\$100 million` |
| Apostrophe after `)`, `]`, or `.` | `\u{2019}s` | `§ 2(a)(3)\u{2019}s`, `J.R.\u{2019}s` |

**CRITICAL: Apostrophe after `)` or `]`** — Typst's smart-quote algorithm treats `'` after `)` or `]` as a LEFT quote, not possessive. Always use `\u{2019}s` in these positions.

### Smart Quotes / Apostrophes

Typst's smart-quote algorithm treats `'` after `)`, `]`, or `.` as an **opening** left single quote instead of a possessive apostrophe. This affects any possessive on a parenthetical reference or abbreviated name:

```typst
// WRONG: renders as left quote (')
§ 2(a)(3)'s definition
J.R.'s strategy

// CORRECT: explicit right single quote (')
§ 2(a)(3)\u{2019}s definition
J.R.\u{2019}s strategy
```

The pattern to watch for: any `)'s`, `]'s`, or `.'s` in running text. Use `\u{2019}` (Unicode RIGHT SINGLE QUOTATION MARK) instead of a literal `'` in these positions.

---

# typst-images


## Rule — Images

**Images should be paper figures extracted during the Phase 1 inventory.** If an image is a synthesized diagram (not from the paper), document the decision. Paper figures are the authoritative visual source — never recreate a figure from memory.

Images and figures must be centered on slides. Typst defaults to left-aligned.

```typst
// CORRECT
#align(center)[#image("assets/figure.png")]

// WRONG (left-aligned by default)
#image("assets/figure.png")
```

The same holds for lecture assets referenced by relative path:

```typst
// CORRECT
#align(center)[#image("../../assets/ipo-gross-spreads.png")]

// WRONG — left-aligned by default
#image("../../assets/ipo-gross-spreads.png")
```

---

# typst-label-bullet-spacing


<EXTREMELY-IMPORTANT>
## Rule — The Iron Law of Label-Bullet Spacing

**A BOLD LABEL LINE (`*Label:*`) MUST HAVE A BLANK LINE BEFORE THE FOLLOWING BULLET LIST. This is not negotiable.**

Typst treats a bullet immediately after a paragraph line as a continuation of the paragraph, not as a separate list. This renders the bullet inline with the label text instead of as a proper indented list item.

```typst
// WRONG: bullet renders inline with label
*Key requirements:*
- Must file within 10 days

// CORRECT: blank line separates paragraph from list
*Key requirements:*

- Must file within 10 days
```

**Bad pattern:**
```typst
*Graphic communication:*
- Includes all forms of electronic media
```

**Fix — add a blank line:**
```typst
*Graphic communication:*

- Includes all forms of electronic media
```

**Applies to:** workshop, workshop-revise, lecture-prep (SLIDES phase), slides-edit, lecture-prep-edit
</EXTREMELY-IMPORTANT>

---

# typst-no-subtitle-echo


## Rule

**The slide title (`===`) must NOT repeat as the first bold/italic body line.** This double-prints the same sentence on the rendered slide.

```typst
// WRONG: echo
=== Proxy advisors emerged to fill this governance gap.

*Proxy advisors emerged to fill this governance gap.* #pause
```

```typst
// CORRECT: subtitle frames, body answers
=== Proxy advisors emerged to fill this governance gap.

- *ISS* founded in 1985, *Glass Lewis* in 2003

- Today these two firms control >90% of the market
```

**"Almost the same" counts.** If subtitle and body differ only by punctuation or articles, it's still an echo.

---

# typst-notes-structure


## Notes File Structure

Lecture notes open with the template import and the panel for the day:

```typst
#import "../templates/notes-template.typ": *
#show: notes-setup.with(panel: "B")  // Panel A-H
```

## Rule — Notes Structure

### Section Matching

Notes headings must match slide headings:
- `== Section Title` in notes matches `= Section Title` in slides
- `=== Subsection Title` for first slide in a section (NO "NEXT SLIDE")
- `=== NEXT SLIDE (Description)` only for subsequent slides within a section

### Sub-Bullet Structure

Use sub-bullets to organize notes by topic and sub-topic. The parent bullet states the topic; indented sub-bullets provide details. This makes it easy to see the structure at a glance at the podium.

```typst
- The theoretical foundation is the Efficient Capital Markets Hypothesis, or ECMH.

  - In an efficient market, the price of a security reflects all publicly available information. This is the "semi-strong" form.

  - If the defendant makes a material misstatement, that misstatement is incorporated into the stock price.
```

Every bullet — parent or sub — must be full speakable prose (max 2 sentences). No outline fragments like `- ECMH → price reflects info`. **Content must be extracted from the source** — when discussing figures, tables, or empirical results, extract the specific values from the paper inventory in SOURCES.md (workshop) or the lecture inventory and TM (lecture-prep) rather than summarizing from memory.

### Section Transitions

Every `==` section (except Recap and the first content section) must begin with a **transition sentence** --- a `-` bullet that connects the new topic to what came before. The presenter needs a verbal bridge; without it, the talk feels like a list of unrelated topics.

**GOOD transitions:**
```typst
== Empirical Evidence

=== Studies show mixed results on proxy advisor influence.

- We've just covered the theoretical arguments for and against regulation. But what does the data actually say? Let's turn to the empirical evidence.
```

```typst
== _Garnatz v. Stifel, Nicolaus & Co._ (CP 384--387)

=== _Garnatz v. Stifel_: Broker Defrauded an Average Investor

- Now we've just spent a lot of time talking about out-of-pocket damages in the context of secondary market fraud. But what about face-to-face fraud? For that, we turn to _Garnatz v. Stifel_.
```

```typst
== Transnational Securities Fraud

=== _Morrison v. National Australia Bank_ (CP 388--399)

- The final topic in this chapter: does Section 10(b) apply outside the United States?
```

**BAD (cold start — no bridge):**
```typst
== Empirical Evidence

=== Studies show mixed results on proxy advisor influence.

- Several studies have examined the relationship between ISS recommendations and voting outcomes.
```

```typst
== Proportionate Liability Under PSLRA

=== The PSLRA Replaced Joint-and-Several with Proportionate Liability

- Section 21D(f) of the Exchange Act fundamentally changed how damages are allocated among multiple defendants.
```

### End-of-Section Setups

Substantial `==` sections (3+ slides — cases, hypotheticals, multi-slide doctrine) should end with a **setup bullet** — a forward pointer previewing the next topic. This gives the presenter a verbal runway out of the current section before the slide changes.

**GOOD setup (last bullet of a `==` section):**
```typst
- That covers the market structure arguments. But there's a regulatory dimension too — what has the SEC actually done? That's where we turn next.
```

```typst
- That's the out-of-pocket measure for secondary market fraud. But what happens when the fraud is face-to-face — does the same measure apply? That's the question in our next case.
```

**BAD (section just stops):**
```typst
- The Dura Court held that an inflated purchase price alone is not enough to show loss causation.
// == next section starts here with no runway
```

Not every `==` section needs a setup — short single-slide sections or hypotheticals that naturally flow into the next topic can omit it. But any section with 3+ slides of substantive content should end with a forward pointer.

### `===` Sub-Section Transitions

Transitions between `===` sub-sections within a `==` are also important when the sub-topic shifts significantly (e.g., moving from case facts to a policy discussion). A brief orienting sentence ("Now let's look at the diagram" or "Let's apply this to our hypo") is sufficient.

### Cold-Call Questions

Lecture notes (lecture-prep, notes-edit, lecture-prep-edit) script the Socratic dialogue:

```typst
- *Q (#next()):* What did the court hold?
  - [Answer (TM p.XX): The court held...]
- *Follow-up:* Does that hold for retail investors?
  - [Answer (TM p.XX): Debatable because...]
```

Group related questions under one `#next()` call (2-4 questions per student). Target 10-20 `#next()` calls per class. Every `[Answer ...]` block must cite a source.

### Question Types

Two types of questions appear in notes:

1. **Cold-call** (`*Q (#next()):*`): Targets a specific student from the panel. `#next()` pulls up the student's name. Use for Socratic dialogue.
   ```typst
   - *Q (#next()):* What did the court hold in Basic v. Levinson?
     - [Answer (TM p.XX): The court held...]
   ```

2. **Poll** (no prefix, just narrative): Whole-class activity via PollEv. The notes `===` heading gets `#emoji.chart.bar` to signal the professor to pull up PollEv. The question itself uses plain narrative — no `*Q (#next()):*` prefix. Slides do NOT get the emoji (students shouldn't see it).
   ```typst
   // In notes:
   === #emoji.chart.bar NEXT SLIDE (Rule 172: Five scenarios testing access equals delivery.)
   - Let's test Rule 172 with five scenarios.
   ```

**Triage source:** The content inventory tags `[POLL]` and `[COLD-CALL]` on each HYPO-*/DQ-*/TQ-* item determine which format to use. If the inventory has no tags (legacy), apply the rule: "Can I write 4 plausible MC choices with one clearly correct answer?" If yes → poll. If no → cold-call.

Never use `#next()` for poll questions — it would display a student name for what should be an anonymous whole-class activity.

### Recap Section

Every class starts with detailed recap of previous class (15-30 bullets). Read `notes/(N-1)-*.typ` to write it.

---

# typst-section-hierarchy


## Rule — Section Hierarchy

The slide heading hierarchy must mirror the source's organizational structure: for workshop decks, the paper's structure as captured in `.planning/OUTLINE.md`; for lecture decks, the casebook's table of contents as captured in the per-lecture inventory, whose `##` sections are the authoritative source.

- `= Major Section` — the source's main sections (Introduction, Literature Review, Model, Results; or roman-numeral casebook sections I, II, II.A, II.B)
- `== Sub-topic` — subsections, key arguments, case studies, empirical results, hypotheticals, doctrinal sub-topics
- `=== Slide Subtitle` — takeaway sentence for this specific slide (not a topic label)

In lecture decks the CP ref `(CP XX--YY)` goes on the **first** `===` only, and **only for cases and casebook hypotheticals** — not for doctrinal overviews, policy discussions, statutory sections, or other content types that don't correspond to specific casebook pages.

### Paper Structure Mapping

| Paper structure | Slide heading level | Example |
|----------------|---------------------|---------|
| Major numbered section (I, II, III) | `=` | `= The Market for Proxy Advisory Services` |
| Subsection or key argument | `==` | `== Free-Riding on Governance` |
| Individual slide takeaway | `===` | `=== Two firms control over 90% of the market.` |

**Every `=` heading must correspond to a major paper section.** No orphan `=` headings that don't track the paper's structure.

### Casebook TOC Mapping

The inventory's `##` headings determine both the presence and level of slide headings:

| Inventory `##` heading | Slide heading level | Example |
|------------------------|---------------------|---------|
| Roman-numeral prefix (I., II.A., III.) | `=` | `## II.B. Waiting Period` → `= Waiting Period` |
| Everything else | `==` | `## Hypothetical Three — Rule 135` → `== Hypothetical Three --- Rule 135` |

**Every inventory `##` section must have a corresponding `=` or `==` heading at the correct level.** Every `=` heading must correspond to a roman-numeral inventory section — no orphan `=` headings that don't track the casebook TOC.

**Why:** The slide deck TOC is what the presenter navigates during class. If the heading structure doesn't mirror the source, navigation during the talk breaks down.

### Slide Subtitles (`===`)

Subtitles must be **complete sentences** — takeaway statements, not topic labels.

```typst
// GOOD: takeaway sentence
=== Proxy advisors emerged to fill a governance gap left by dispersed ownership.

// BAD: topic label
=== Proxy Advisors Overview
```

### Long Sections

If a `==` section has more than 10 `===` subtitles, consider breaking it into sub-sections with additional `==` headings. This is a signal, not a hard rule — but 24 subtitles under one `==` is too many to navigate.

### Discussion Question Sequence Rule

In a `==` section with 3+ discussion question slides, the **first slide must NOT be a numbered DQ**. It should introduce the case or topic with a descriptive subtitle (e.g., facts diagram, case setup). DQ numbering (`Discussion Questions X of N`) starts on the second slide. N counts only the numbered DQ slides, not the introductory slide.

**GOOD:**
```typst
== _Dirks v. SEC_

#slide[
=== Secrist tipped Dirks about massive fraud at EFA; Dirks told his clients, who sold before the scandal broke.
// facts diagram here
]

#slide[
=== Discussion Questions 1 of 5
// questions here
]
```

**BAD (numbered DQ as first slide):**
```typst
== _Dirks v. SEC_

#slide[
=== Discussion Questions 1 of 6
// facts diagram crammed into a numbered DQ slide
]
```

No TM references in student-facing materials.

### Additional Rules

- `==` headings go OUTSIDE `#slide[...]` blocks (they are section dividers, not slide content).
- Notes file `==` sections must match slides `=` sections. Where a per-lecture slides file carries its own `==` sections, notes and slides sections are matched **positionally, not by name**: `check-notes-alignment.sh` compares the n-th `==` section on each side and the two sides may use different heading names.
- Related hypos (HYPO-* items) may be grouped under a single `==` category heading to prevent bloat; each hypo still gets its own `===` subtitle.

---

# typst-slide-format


## Rule — Slide Structure

```typst
#slide[
=== Takeaway statement for this slide (CP 120--125)

- First point about the topic

- Second point revealed after pause #pause

- Third point with supporting detail
]
```

- **`#slide[...]`** wraps each slide's content
- **`#pause`** creates animation steps (content revealed progressively)
- **`#hide[...]`** for content the presenter sees but audience doesn't (e.g., anticipated Q&A answers in pre-distributed version)
- **`===` subtitle** goes inside `#slide[...]` as the first element
- **`==` section dividers** go OUTSIDE `#slide[...]` blocks

Prose content is also allowed in place of bullets:

```typst
#slide[
=== Takeaway statement for this slide (CP 120--125)
Content...
#pause  // Animation step
More content revealed after pause...
]
```

Use `#hidden-slide[...]` for any content that should not appear in student-facing PDFs (cold-call questions, answer reveals, instructor notes). The entire slide is hidden in for-posting and final modes. Answers and `#pause` steps inside `#hidden-slide` work normally in presentation mode.

---

# typst-sub-bullets


## Rule — Nested List Items (Sub-Bullets)

Use **two-space indent + `- `** for second-level list items. Do **not** use `--` as a sub-bullet marker — in Typst, `--` renders as an en-dash character, not a list item. The template already sets `#set list(marker: ([•], [--]))` which automatically renders nested items with an en-dash marker.

Sub-bullets must be separated by blank lines — both from the parent bullet and from each other. This matches the top-level bullet spacing convention and keeps projected slides readable.

```typst
// CORRECT: blank lines between parent and sub-bullets, and between sub-bullets
- Two market imperfections undermine this:

  - *Free riding* --- investors fail to distinguish among reputations

  - *Agency problems* --- individuals may sacrifice the firm's reputation
```

```typst
// WRONG: no blank lines (renders tightly packed)
- Two market imperfections undermine this:
  - *Free riding* --- investors fail to distinguish among reputations
  - *Agency problems* --- individuals may sacrifice the firm's reputation
```

```typst
// WRONG: -- is an en-dash, not a bullet — renders as inline text
- Two market imperfections undermine this:
  -- *Free riding* --- investors fail to distinguish among reputations
  -- *Agency problems* --- individuals may sacrifice the firm's reputation
```

Enforced by `sub-bullets.py` (SUB-BULLET-SPACING) and `fake-sub-bullets.py` (FAKE-SUB-BULLET,
the sole owner of that check), both auto-discovered by `check-all.py`.

---

# typst-tables


## Rule — Table Formatting

**Tables must be grounded in the source.** If the table reproduces paper data (regression results, summary statistics), extract values from the paper — never type numbers from training knowledge. If the table synthesizes information for pedagogical purposes (comparison matrices, timeline summaries), document that decision in a comment.

**Minimum `inset: 10pt`.** Smaller values (2pt, 4pt, 5pt) produce cramped, unreadable tables on projected slides. Use 10pt for data-dense tables; 12pt for tables with shorter content.

```typst
#table(
  columns: (auto, 1fr, 1fr),
  align: (left, left, left),
  stroke: 0.5pt,
  inset: 10pt,
  table.header([*Col 1*], [*Col 2*], [*Col 3*]),
  // rows...
)
```

---

# typst-teleprompter-notes


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
