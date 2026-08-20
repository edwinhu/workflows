---
name: chart-typography
description: Charts inherit the host document's type and palette — one theme, registered once, never per-chart styling
applies-to: [ds-delegate]
---

## Rule

A chart is part of the document it sits in, not an image pasted from another one. Set the
typography and palette ONCE, as a registered theme, before any chart is built.

| Requirement | Why |
|---|---|
| **Every glyph in the chart matches the document's type** — title, axis labels, axis titles, legend title and labels, in-chart annotations | A serif page with a sans axis label reads as two documents. Half-converting (title only) is worse than not converting |
| **Register a theme; never style chart by chart** | A chart added later silently keeps the library default. The failure is invisible to the author and obvious to the reader |
| **One palette object, sampled from the continuous scheme in use** | A viridis swarm beside a `tab10` bar chart reads as two studies |
| **Reserve exactly one out-of-scheme colour for the one thing that must stand out** — a defendant, a treated unit, the focal firm | If everything is emphasised, nothing is. Pick a hue the scheme does not contain, so it cannot be mistaken for a value on the ramp |
| **Grey is for absence** — missing, "neither", not-applicable | A category that means "nothing here" should not compete for attention with one that means something |

Chart-level config beats theme config. A single `.configure_axis(...)`, `rcParams` write, or
inline `font=` re-opens the hole the theme closed, so the lint below refuses them.

```python
# altair
@alt.theme.register("paper", enable=True)
def _theme():
    return {"config": {
        "title":  {"font": DOC_FONT}, "axis": {"labelFont": DOC_FONT, "titleFont": DOC_FONT},
        "legend": {"labelFont": DOC_FONT, "titleFont": DOC_FONT}, "text": {"font": DOC_FONT},
    }}

# matplotlib
plt.rcParams.update({"font.family": DOC_FONT, "axes.titlesize": 13})
```

Find the document's font rather than assuming: read it off the rendered page (marimo sets
Lora/PT Sans; a Typst deck uses whatever the template declares; a docx uses its style).

## Rationale

**Why this exists** — Nothing warns you. The chart renders, the numbers are right, the check
passes, and the exhibit still announces that it came from somewhere else. In a filing or a
paper that reads as carelessness about the thing it is illustrating, which is the last
impression an exhibit should leave.

## Verification

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-chart-typography.py <file.py|dir>
```

Exits non-zero on: charts present with no theme registration; per-chart font or axis
configuration; hex colours outside a single palette block.
