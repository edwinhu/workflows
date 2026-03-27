---
name: typst-cetz-storytelling
description: CeTZ canvas requires minimum length 2em and a Storytelling comment (visual mechanism → pedagogical insight) — cetz-plot is FORBIDDEN
applies-to: [workshop, workshop-revise]
---

## Rule

cetz-plot is FORBIDDEN (version conflict with secreg theme's cetz 0.3.2). But plain `cetz.canvas` diagrams (timelines, trees, flowcharts) are fine when used from the theme's bundled cetz import.

When using `cetz.canvas`:
- **Minimum `length: 2em`** — smaller diagrams are unreadable on projected slides
- **`// Storytelling:` comment required** — must appear within 3 lines before diagram code

### The Storytelling Comment

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
