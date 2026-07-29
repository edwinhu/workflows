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

## The five rules

| | Rule | Why it is not negotiable |
|---|---|---|
| **Type** | **Serif** faces for all text (labels, ticks, legends, annotations) | Figures sit inside serif body text. A sans-serif figure reads as pasted in from somewhere else, and journals increasingly ask for the match. |
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

## Checking a figure before it ships

1. **Greyscale it.** Convert to greyscale and confirm every series is still
   distinguishable. If not, the figure depends on hue alone and needs a second
   encoding.
2. **Simulate CVD.** `pip install daltonlens`, or view in any deuteranopia
   simulator.
3. **Zoom the PDF to 400%.** Text should stay sharp. If it pixelates, a raster
   image got embedded somewhere.
4. **Read it at print size.** Shrink to the column width it will occupy —
   typically 3.5in single-column. Tick labels usually die first.
