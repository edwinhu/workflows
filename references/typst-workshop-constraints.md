---
name: typst-workshop-constraints
description: Typst slide and notes conventions for academic workshop presentations using secreg theme
applies-to: [workshop, workshop-revise]
---

## Typst Workshop Presentation Constraints

These constraints apply to ALL Typst slides and notes generated for academic workshop presentations using the secreg theme infrastructure.

---

### 1. Bullet Spacing (Top-Level)

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

---

### 2. Sub-Bullet Spacing and Syntax

Use **two-space indent + `- `** for sub-bullets. Blank lines between sub-bullets AND between parent and first sub-bullet.

**NEVER type `--` as a sub-bullet marker** — in Typst, `--` renders as an en-dash character, not a list item. The template already sets `#set list(marker: ([•], [--]))` which automatically renders nested items with an en-dash marker.

```typst
// CORRECT: blank lines between parent and sub-bullets, and between sub-bullets
- Two market imperfections undermine this:

  - *Free riding* --- investors fail to distinguish among reputations

  - *Agency problems* --- individuals may sacrifice the firm's reputation
```

```typst
// WRONG: no blank lines (renders tightly packed)
- Two market imperfections undermine this:
  - *Free riding* --- investors fail to distinguish
  - *Agency problems* --- individuals may sacrifice
```

```typst
// WRONG: -- is an en-dash, not a bullet
- Two imperfections:
  -- *Free riding*
  -- *Agency problems*
```

---

### 3. Formatting Conventions

| Element | Syntax | Example |
|---------|--------|---------|
| Case names | `_Case v. Party_` | `_SEC v. Howey_` |
| Key terms | `*emphasis*` | `*materiality*` |
| Em-dash | `---` | separate clauses |
| En-dash (ranges) | `--` | `10--20`, `2020--2025` |
| Dollar sign | `\$` | `\$100 million` |
| Smart apostrophe after `)` or `]` | `\u{2019}s` | `§ 2(a)(3)\u{2019}s` |

**CRITICAL: Apostrophe after `)` or `]`** — Typst's smart-quote algorithm treats `'` after `)` or `]` as a LEFT quote, not possessive. Always use `\u{2019}s` in these positions.

---

### 4. Table Formatting

**Minimum `inset: 10pt`.** Smaller values (2pt, 4pt, 5pt) produce cramped, unreadable tables on projected slides.

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

### 5. Image Centering

Images must be centered on slides. Typst defaults to left-aligned.

```typst
// CORRECT
#align(center)[#image("assets/figure.png")]

// WRONG (left-aligned by default)
#image("assets/figure.png")
```

---

### 6. No Subtitle-Body Echo

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

### 7. Post-Compile Widow Detection

<EXTREMELY-IMPORTANT>
**EVERY COMPILE MUST BE FOLLOWED BY PDF WIDOW DETECTION. This is not negotiable.**

Source-level checks estimate widow risk; Typst's line-breaking algorithm is the final arbiter. The PDF check is ground truth.

After every successful compilation:
```bash
DETECT_WIDOWS=$(command ls -d ~/.claude/plugins/cache/tinymist-plugin/tinymist/*/skills/typst-widow-orphan/scripts/detect_widows.py 2>/dev/null | sort -V | tail -1) && python3 "$DETECT_WIDOWS" slides.pdf
```

Exit code 1 = widows found. Gate does NOT pass until 0 widows.

**Widow Fix Strategies (in order):**
1. **Tighten wording** — remove redundant words
2. **`~` (non-breaking space)** — tie last 2-3 words: `gun-jumping~rules.`
3. **`#box[]` for unbreakable units** — when `~` fails at en-dashes: `#box[(CP 515--520)]`
4. **Restructure clause** — reorder words for different break points

**CRITICAL: `~` does NOT prevent breaks at en-dashes (`--`).** Use `#box[]` instead for units containing en-dashes.

Never pad with filler words.
</EXTREMELY-IMPORTANT>

---

### 8. Computed Values

**Never hardcode calculated numbers.** Use Typst's `calc` module:

```typst
#let start = 1e6
#let rate = 1.1
#let periods = 12
// WRONG: \$3.1 million
// RIGHT: \$#calc.round(start * calc.pow(rate, periods) / 1e6, digits: 1) million
```

If you catch yourself typing a dollar amount, percentage, or any derived number — STOP and write a `calc` expression.

---

### 9. Common Elements

- `#callout[]` — for warnings, caveats, important notes ONLY. Not for quoting text.
- **Overflow warning:** Slides with `#callout[]` + 3 or more `#pause` markers are overflow-prone. Reduce content or split the slide.

---

### 10. CeTZ Canvas Diagrams & Visual Storytelling

cetz-plot is FORBIDDEN (version conflict with secreg theme's cetz 0.3.2). But plain `cetz.canvas` diagrams (timelines, trees, flowcharts) are fine when used from the theme's bundled cetz import.

When using `cetz.canvas`:
- **Minimum `length: 2em`** — smaller diagrams are unreadable on projected slides
- **`// Storytelling:` comment required** — must appear within 3 lines before diagram code

#### The Storytelling Comment

Every `cetz.canvas` block MUST have a preceding `// Storytelling:` comment explaining the visual design decision — what visual property carries meaning, and what the audience should understand from *seeing* it.

**Format:**
```
// Storytelling: [visual mechanism] → [pedagogical insight]
```

- **Visual mechanism**: The specific visual property that carries meaning — gradient direction, spatial layout, branching, timeline shape, color coding, parallel structure.
- **Pedagogical insight**: What the audience should understand from seeing the diagram that bullets cannot convey — the "aha" that is spatial, relational, or temporal.

The `→` separates *how* from *why*. Both halves are required.

**Examples:**

```typst
// Storytelling: Horizontal timeline with red dashed boundaries → class period is a *window*, not a point
#align(center)[
  #cetz.canvas(length: 2.5em, {
    import cetz.draw: *
    // ...
  })
]

// Storytelling: Three branches converge to single gate node → all disclosure types funnel to the same test
#align(center)[
  #cetz.canvas(length: 2em, {
    import cetz.draw: *
    // ...
  })
]

// Storytelling: Two parallel spectra in opposite directions → as courts narrowed standing, they broadened "in connection with"
#align(center)[
  #cetz.canvas(length: 2em, {
    import cetz.draw: *
    // ...
  })
]
```

**What makes a good comment:**

The comment must capture enough design intent that an agent rebuilding the diagram from scratch would produce something equally good. Test: **if you deleted the diagram code and kept only the comment, could an agent reconstruct the visual logic?**

| Good | Bad | Why |
|------|-----|-----|
| "Color gradient darkens left→right → narrowing scope is visible at a glance" | "Shows the different requirements" | Good names the visual property (gradient) AND the insight (narrowing). Bad restates the data. |
| "Price line diverges from dotted value line; red bracket marks the gap → the gap IS the damages" | "Price over time chart" | Good explains why the visual shape matters. Bad is a content label. |
| "Decision tree funnels three types through a single gate → all roads lead to the same test" | "Materiality decision tree" | Good captures structural insight (convergence). Bad names the diagram type. |

**When to update the comment:**
- **Yes:** Diagram's visual structure changes (new branches, different layout, recolored), or pedagogical purpose shifts
- **No:** Only spacing, inset, or stroke values change; node text corrected without changing visual logic

---

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Sub-bullet spacing doesn't matter for workshops" | It matters for ALL projected slides — tight sub-bullets are unreadable from the back | Add blank lines between sub-bullets |
| "Smart apostrophes are a minor rendering issue" | `§ 2(a)(3)'s` renders with a LEFT quote — looks broken | Use `\u{2019}s` after `)` or `]` |
| "Table inset 5pt is fine" | 5pt is unreadable when projected at 16:9 | Use `inset: 10pt` minimum |
| "I'll center the image later" | Left-aligned images on centered slides look misaligned | Wrap in `#align(center)` from the start |
| "The subtitle echo emphasizes the point" | It double-prints the same sentence — amateurish, wastes space | Keep one role per text |
| "Source-level widow check was clean" | Source clean ≠ PDF clean. Typst's line-breaking decides. | Run PDF widow detection after every compile |
| "The calculation is simple, I'll hardcode it" | Hardcoded numbers become wrong when parameters change | Use `calc` module |
| "One callout + multiple pauses is fine" | Callout + 3+ pauses frequently overflows the slide | Reduce content or split |
| "The Storytelling comment is just documentation" | It's a reconstruction spec — without it, the next agent rewrites the diagram from scratch | Write mechanism → insight, both halves |
| "'Shows the data' is a fine Storytelling comment" | That's a content label, not a visual design decision — it doesn't explain WHY this visual form | Name the visual property AND the pedagogical insight |

## Red Flags — STOP If You Catch Yourself:

- **Writing sub-bullets with `--` marker** → STOP. Use two-space indent + `- `.
- **Writing consecutive sub-bullets without blank lines** → STOP. Add blank lines.
- **Typing `)'s` or `]'s`** → STOP. Use `\u{2019}s` instead.
- **Setting table `inset` below 10pt** → STOP. Use 10pt minimum.
- **Adding `#image()` without `#align(center)`** → STOP. Center it.
- **Writing slide body that restates the `===` title** → STOP. Remove the echo.
- **Proceeding after compile without running widow detection** → STOP. Run the PDF detector.
- **Typing a calculated number** → STOP. Write a `calc` expression.
- **Adding `#callout[]` to a slide with 3+ `#pause`** → STOP. Split the slide.
- **Writing `cetz.canvas` without `// Storytelling:` comment** → STOP. Add it — both halves: visual mechanism → pedagogical insight.
- **Writing a Storytelling comment that's just a content label** ("Price chart", "Timeline diagram") → STOP. Name the visual property AND what the audience learns from seeing it.
- **Writing `cetz.canvas(length: 1cm, ...)` or similar small lengths** → STOP. Use `2em` minimum.
- **Writing notes.typ bullets without blank lines** → STOP. Notes follow the same spacing convention.
