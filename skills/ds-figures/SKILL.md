---
name: ds-figures
version: 1.0
description: "Use when producing a figure headed for a paper, slide deck, or notebook — 'make a chart', 'plot this', 'figure for the paper', 'export the figure', choosing colors or a palette, DPI or figure size, fonts, or when a reviewer asks whether a figure is colorblind-safe or print-ready. Covers matplotlib, plotnine, Observable Plot/pyobsplot, and Altair."
user-invocable: true
---

# Publication Figures

The house style, and the reasons behind it. A figure that violates these is not
wrong so much as unusable at the point it matters: in a printed journal, in a
reviewer's greyscale printout, or projected in a room where a tenth of the
audience cannot separate your two series.

## The house rules

| | Rule | Why it is not negotiable |
|---|---|---|
| **Type** | **Serif** faces for **all** text — axis labels, tick labels, **legend entries and legend title**, annotations, facet strips, colorbar labels | Figures sit inside serif body text. A sans-serif figure reads as pasted in from somewhere else, and journals increasingly ask for the match. The legend is the piece that most often escapes a global font setting, and one sans legend undoes the whole figure. |
| **Labels** | **Axis labels in Title Case** ("Shareholder Support Rate", not "shareholder support rate" or "support_rate"). Every user-visible string is **prose, never an identifier** | The reader never saw your DataFrame. `glass_lewis` is not a scenario, **Glass Lewis** is; `mkt_cap_wtd` is not an axis, **Market Cap Weighted** is. Shipping identifiers tells the reader the figure was never finished — and it is the single fastest tell that a chart came straight out of a notebook. |
| **Numbering** | Main exhibits **Figure 1 … Figure N**, consecutive in order of first mention. Appendix exhibits restart as **Figure A1 … Figure AN** | Numbers are the reader's only address for an exhibit. A sequence that skips, repeats, or continues main numbering into the appendix breaks every cross-reference in the text. |
| **Clipping** | **Nothing may be cut off.** Verify the saved file, not the notebook preview | A clipped y-label or a legend sliced by the frame is invisible in the inline preview at one size and obvious in the PDF at another. |
| **Format** | **Vector** (PDF/SVG/EPS). Raster only when the figure genuinely needs it — heatmaps, scatter with >50k points, images | Vector stays sharp at any zoom and prints at the press's resolution, not yours. A raster figure in a PDF is the one element a reader can visibly degrade by zooming. |
| **Resolution** | If raster is unavoidable, **300 DPI minimum** at final print size | 300 DPI is the floor most journals accept. Note DPI is meaningless without physical size: 300 DPI at 3 inches is 900px. Set figure size in inches, then DPI. |
| **Scale** | Use **log** when the series span more than ~1 decade — but then name the ticks | A linear axis over a 77x range collapses everything below the largest series into one band at the baseline. Log fixes that and introduces its own problem: unreadable automatic ticks. |
| **Color** | **Colorblind-safe throughout.** Sequential → `viridis`. Two-category contrast → **blue/orange**. Never red/green | ~8% of men have red-green color vision deficiency. A red/green figure is not "harder" for them — it carries zero information. |

## Palettes

**Sequential / continuous** — `viridis` (or `cividis`, which is additionally
optimised for CVD). Both are perceptually uniform: equal steps in the data are
equal steps in perceived brightness, so the eye does not invent structure that
is not there. This is the specific failure of `jet`/`rainbow`, which manufacture
a bright band in the middle of any scale.

**Two categories** — blue and orange. Maximally separable under every common CVD
type, and they survive greyscale conversion because they differ in lightness as
well as hue.

```python
BLUE, ORANGE = "#4a6fa5", "#c0563a"
```

**Three to eight categories** — Okabe-Ito, designed for CVD safety:

```python
OKABE_ITO = ["#0072B2", "#E69F00", "#009E73", "#CC79A7",
             "#56B4E9", "#D55E00", "#F0E442", "#000000"]
```

**Beyond eight categories, stop.** No palette is safely distinguishable past
about eight, so the fix is the chart, not the colors: facet, aggregate the tail
into "other", or directly label the lines and drop the legend.

**Redundant encoding.** Where a distinction carries the argument, encode it twice
— color *and* linetype, or color *and* marker shape. Then the figure survives
greyscale printing and CVD without depending on the reader's setup.

## Setup by library

### matplotlib / plotnine

```python
import matplotlib as mpl

mpl.rcParams.update({
    "font.family": "serif",
    "font.serif": ["Times New Roman", "DejaVu Serif", "Liberation Serif"],
    "mathtext.fontset": "stix",          # matches Times; default is sans
    "axes.prop_cycle": mpl.cycler(color=OKABE_ITO),
    "figure.dpi": 150,                   # screen
    "savefig.dpi": 300,                  # print floor
    "savefig.bbox": "tight",
    "savefig.format": "pdf",             # vector by default
    "axes.spines.top": False,
    "axes.spines.right": False,
})
```

Save vector explicitly: `fig.savefig("f1.pdf")`. `savefig.dpi` only binds when
the format is raster, so it is a fallback, not the plan.

`rcParams["font.family"]` covers legend text, so a sans legend under a serif
figure means the legend was styled separately — check for a stray `prop=`,
`fontproperties=`, or a `FontProperties` on `ax.legend()`.

### Relabelling before plotting

Rename once, at the boundary between the data and the plot, so no identifier can
reach an axis, a legend, or a facet strip:

```python
SCENARIO_LABELS = {
    "glass_lewis": "Glass Lewis",
    "iss_rec": "ISS Recommendation",
    "mgmt_rec": "Management Recommendation",
}
AXIS_LABELS = {"support_rate": "Shareholder Support Rate", "yr": "Year"}

plot_df = df.assign(scenario=df["scenario"].map(SCENARIO_LABELS))
assert plot_df["scenario"].notna().all(), "unmapped scenario code"
ax.set_xlabel(AXIS_LABELS["yr"])
ax.set_ylabel(AXIS_LABELS["support_rate"])
ax.legend(title="Scenario")          # Title Case here too
```

The assert matters: a `.map()` with a missing key silently produces `NaN`, which
drops the series or prints "nan" in the legend instead of failing loudly.

### Observable Plot / pyobsplot

Plot has no font parameter — style it through the enclosing CSS, or set the
`style` option:

```python
Plot.plot({
    "style": {"fontFamily": "Times New Roman, serif", "fontSize": "12px"},
    "color": {"range": [BLUE, ORANGE]},          # never rely on the default
    "marks": [...],
})
```

Plot's default categorical scheme is `observable10`, which is **not** CVD-safe —
always pass an explicit `range` or a `scheme` of `"viridis"`/`"cividis"`.

### Altair

```python
alt.themes.register("house", lambda: {"config": {
    "font": "Times New Roman",
    "range": {"category": OKABE_ITO, "ramp": {"scheme": "viridis"}},
}})
alt.themes.enable("house")
```

## Facts

- A figure's DPI claim is meaningless without its physical size — 300 DPI at 3
  inches is 900 pixels, at 6 inches it is 1800. Set size in inches first, then
  DPI, or "300 DPI" is a number that describes nothing.
- `savefig.dpi` has no effect on PDF/SVG output. Setting it and saving vector is
  harmless; setting it and *believing* it is what makes a raster figure ship at
  the default 100 DPI.
- matplotlib's `mathtext` defaults to a sans-serif math font. Setting
  `font.family` alone leaves every equation and superscript in the wrong face,
  which is more conspicuous than leaving the whole figure sans.
- Observable Plot's default `observable10` scheme is not colorblind-safe. A chart
  that never sets `color.range` has silently opted out of this guide.
- **A year axis needs an explicit integer format.** Plotting a numeric year
  column renders ticks as `2,005` — the axis applies a thousands separator
  because the values are numbers, not dates. Pass `tickFormat: "d"` (Observable
  Plot / d3) or `FuncFormatter(lambda v, _: f"{v:.0f}")` (matplotlib). It looks
  like a typo in the data and is the fastest way to make a figure look unfinished.
- **A log axis needs explicit, human-readable ticks.** Over less than ~2 decades
  the automatic ticks are unusable — minor ticks appear unlabelled, or values
  arrive as `1e-1` and `2.5e0`. Name them and format them plainly:
  `"ticks": [0.1, 0.25, 0.5, 1, 2, 5], "tickFormat": "~f"` (Observable Plot), or
  `ax.set_yticks([...])` with `ScalarFormatter` (matplotlib, whose default
  `LogFormatterSciNotation` also produces scientific notation). An axis that is
  technically correct and unreadable is not a working axis.
- **Say "log scale" in the axis label**, not only in the caption. A reader who
  starts at the figure will otherwise read a log plot as linear and conclude the
  gaps are far smaller than they are — a misreading the figure caused.
- Viridis is perceptually uniform; `jet`/`rainbow` are not, and manufacture a
  bright band mid-scale that readers interpret as a feature of the data. This is
  a false finding introduced by the palette, not a matter of taste.
- **Every default label is an identifier.** matplotlib/plotnine/Altair name axes
  and legend entries from the column and the category *values* — so `support_rate`
  and `glass_lewis` ship unless you rename them. There is no library setting that
  makes this right; the fix is a label map applied before plotting, and it must
  cover legend entries and facet strips, not just `set_xlabel`.
- **`bbox_inches="tight"` fixes clipping at save time, not at draw time.** The
  inline preview and `plt.show()` use the figure's own bounds, so a label clipped
  on screen can be fine in the PDF and vice versa. Only the saved file counts.
- **`bbox_inches="tight"` does not rescue a legend placed outside the axes with
  `loc="upper left", bbox_to_anchor=(1.02, 1)` if the figure was also given an
  explicit `figsize` the legend exceeds** — tight bbox expands the canvas, which
  silently changes the figure's physical width and therefore its effective DPI and
  the column width it was sized for. Reserve the space instead
  (`fig.subplots_adjust(right=0.78)`) so the size you set is the size you get.
- **Title Case is not `str.title()`.** `"support rate by iss rec".title()` yields
  `"Support Rate By Iss Rec"` — it capitalizes the preposition and mangles the
  acronym. Write the label string out by hand; an automated caser produces text
  that is visibly wrong in a way readers attribute to carelessness.
- **Appendix figures restart at A1 and are numbered independently of the main
  sequence.** A figure labelled "Figure 12" in an appendix that only has three
  exhibits reads as a numbering bug and sends readers hunting for figures 9-11.

## Red Flags — STOP If You Catch Yourself

| Action | Why Wrong | Do Instead |
|---|---|---|
| About to use red and green to separate two series | Carries zero information for ~8% of men | Blue/orange, or add a second encoding |
| About to export PNG for a paper figure | Degrades on zoom and at press resolution | PDF/SVG; raster only for heatmaps and huge scatters |
| About to accept a library's default categorical palette | `observable10`, matplotlib's `tab10` and Altair's `category10` are none of them CVD-safe | Pass Okabe-Ito or an explicit range |
| About to set `font.family="serif"` and stop | Math text stays sans, so every superscript mismatches | Also set `mathtext.fontset` |
| About to plot more than ~8 categories in color | No palette separates that many | Facet, aggregate a tail, or label directly |
| About to plot a numeric year on an axis without formatting it | Renders as `2,005` — a thousands separator on a year | `tickFormat: "d"`, or make the column a date |
| About to set a log scale and accept the default ticks | Under ~2 decades they come out unlabelled or in scientific notation | Name the ticks and format them plainly; put "log scale" in the label |
| About to ship an axis label, legend entry, facet strip, or category value that is a column name or a code (`support_rate`, `glass_lewis`, `mkt_cap_wtd`) | The reader has never seen your schema; identifiers read as an unfinished draft | Map to prose before plotting — "Shareholder Support Rate", "Glass Lewis" |
| About to write an axis label in lowercase or sentence case | House style is Title Case for both axes | "Shareholder Support Rate", not "shareholder support rate" |
| About to call `.title()` on a label to get Title Case | Capitalizes prepositions and destroys acronyms — "By Iss Rec" | Write the string by hand |
| About to declare a figure done from the notebook preview | Preview bounds differ from the saved file, so clipping shows up in one and not the other | Open the saved PDF/PNG and check all four edges |
| About to leave `ax.legend()` with a default sans font under a serif figure | A styled-separately legend escapes `font.family` | Remove the `prop=`/`fontproperties=` override |
| About to continue main figure numbering into the appendix ("Figure 12" in Appendix A) | Breaks every cross-reference and implies missing exhibits | Restart at Figure A1 |

## Checking a figure before it ships

Run these **on the saved file**, not the notebook preview.

1. **Read every string aloud.** Axis labels, tick labels, legend title and
   entries, facet strips, annotations, colorbar label. Each must be prose a
   reader who has never seen the data would understand, and each axis label must
   be in Title Case. One underscore anywhere fails this check.
2. **Check all four edges for clipping.** Y-label at the left, x-label and tick
   labels at the bottom, legend and long tick labels at the right, title at the
   top. Rotated tick labels and a legend anchored outside the axes are where this
   fails; both look fine inline and truncate on save.
3. **Greyscale it.** Convert to greyscale and confirm every series is still
   distinguishable. If not, the figure depends on hue alone and needs a second
   encoding.
4. **Simulate CVD.** `pip install daltonlens`, or view in any deuteranopia
   simulator.
5. **Zoom the PDF to 400%.** Text should stay sharp. If it pixelates, a raster
   image got embedded somewhere. At this zoom the legend's font is also
   unambiguous — serif or not.
6. **Read it at print size.** Shrink to the column width it will occupy —
   typically 3.5in single-column. Tick labels usually die first.
7. **Check the number.** The figure's number is consecutive with the exhibit
   before it, and appendix exhibits are in the A-series.
