---
name: typst-notes-structure
description: Notes file structure — section matching with slides, transitions between sections, sub-bullet organization
applies-to: [workshop, workshop-revise]
---

## Rule

### Section Matching

Notes headings must match slide headings:
- `== Section Title` in notes matches `= Section Title` in slides
- `=== Subsection Title` for first slide in a section
- `=== NEXT SLIDE (Description)` only for subsequent slides within a section

### Sub-Bullet Structure

Use sub-bullets to organize notes by topic and sub-topic. The parent bullet states the topic; indented sub-bullets provide details.

```typst
- The theoretical foundation is the efficient market hypothesis.

  - In an efficient market, the price of a security reflects all publicly available information.

  - If there is a material misstatement, it gets incorporated into the stock price.
```

Every bullet — parent or sub — must be full speakable prose (max 2 sentences). No outline fragments. **Content must be extracted from the paper** — when discussing figures, tables, or empirical results, extract the specific values from the paper inventory in SOURCES.md rather than summarizing from memory.

### Section Transitions

Every `==` section (except the first) must begin with a **transition sentence** — a `-` bullet that connects the new topic to what came before. The presenter needs a verbal bridge.

```typst
== Empirical Evidence

=== Studies show mixed results on proxy advisor influence.

- We've just covered the theoretical arguments for and against regulation. But what does the data actually say? Let's turn to the empirical evidence.
```

**BAD (cold start — no bridge):**
```typst
== Empirical Evidence

=== Studies show mixed results on proxy advisor influence.

- Several studies have examined the relationship between ISS recommendations and voting outcomes.
```

### End-of-Section Setups

Substantial sections (3+ slides) should end with a **setup bullet** — a forward pointer previewing the next topic.

```typst
- That covers the market structure arguments. But there's a regulatory dimension too — what has the SEC actually done? That's where we turn next.
```
