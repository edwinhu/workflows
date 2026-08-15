---
name: typst-notes-structure
description: Notes file structure — template setup, section matching with slides, sub-bullet organization, transitions, setups, cold-call questions, recap
type: convention
graduated: false
applies-to: [workshop, workshop-revise, lecture-prep, notes-edit, lecture-prep-edit]
---

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
