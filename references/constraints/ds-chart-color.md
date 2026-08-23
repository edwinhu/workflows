---
name: chart-color
description: Colour encodes the kind of variable — categorical schemes for categories, ramps for order, one reserved accent, grey for absence
applies-to: [ds-delegate]
---

## Rule

**Match the scheme to the variable.** This is the error that survives review, because the
chart looks designed either way.

| Variable | Scheme | Never |
|---|---|---|
| Categorical (2 groups) | Okabe-Ito **blue `#0072b2` / orange `#e69f00`** | Red/green — the pair ~8% of men cannot separate |
| Categorical (3-6) | Okabe-Ito: add green `#009e73`, sky `#56b4e9`, vermillion `#d55e00`, purple `#cc79a7` | A continuous ramp sampled at N points |
| Ordinal / continuous | viridis, magma, or another perceptually uniform ramp | A categorical palette put in order |
| Diverging around a meaningful zero | blue-white-orange | Rainbow, which invents structure |
| Absence — "neither", missing, N/A | **grey** | A hue, which makes nothing look like something |

**Provenance of Okabe-Ito** — devised by Masataka Okabe and Kei Ito
(https://jfly.uni-koeln.de/color/), and brought into the journals by Bang Wong, *Points of
View: Color blindness*, Nature Methods 8, 441 (2011), which is why Nature/Science house
guidance converges on it. Cite Wong when asked where the default comes from; the eight
hexes are his figure.

**Sampling a continuous ramp for categories is a misuse, not a shortcut.** Viridis is
engineered so that *adjacent* values look similar; that is exactly wrong for categories,
which must look unlike each other. Two viridis samples give you poor separation and, at
the blue-green end, the weakest contrast under deuteranopia.

**Reserve exactly one accent for the one thing that must be found** — the defendant, the
treated unit, the focal firm — and take it from OUTSIDE every scheme on the page. When the
categories are viridis, a rust accent works; add orange to the categorical palette and
rust stops being unambiguous, so the accent moves to near-black. The accent colour appears
in the chart for one reason only, never as a category.

**Say what the size channel means when it is not linear.** On a log scale a dot twice the
area is roughly ten times the value, and no reader assumes that unless told.

**Filled regions behind black text are a different job — Okabe-Ito is still the default
for marks, but it is the wrong instrument here.** A diagram node, a highlighted table cell
and a map region are backgrounds carrying text, not thin marks on a surface. Okabe-Ito is
built for marks and is too saturated to sit under black type. Use Paul Tol's paired
schemes, as published (https://sronpersonalpages.nl/~pault/):

| Role | Scheme | Tol's own stated purpose |
|---|---|---|
| Fill behind black text | **pale** — `#AACCEE` `#CCEEFF` `#BBDDBB` `#EEEEBB` `#FFBBCC` `#EEBBDD` `#DDDDDD` | "for the background of black text, for example to highlight cells in a table. The text remains easily readable" |
| Border / connector on that fill | **dark** — `#4477BB` `#117788` `#228833` `#775500` `#CC4466` `#882288` `#444444` | "for text and lines when visibility on a white background is more important than distinct colours" |

Pair a pale fill with the dark step of the same hue; identity lives in the **border**, which
is where the separation survives. **Never encode a category by pale fill alone** — pale buys
black-text readability by giving up hue separation, and four distinguishable pastel fills do
not exist: blue against purple at pastel lightness measures dE 6.4 for *normal* colour
vision, below the floor that a second encoding channel is allowed to excuse. Give every
filled region its own text label.

Do not hand-tune a pastel set to pass a validator. That was tried here across seven
candidates; the survivor was three hues plus a neutral, against Tol's six plus grey, and
carried no evidence beyond one tool's output.

## Rationale

**Why this exists** — Colour is read before any label. A palette that encodes the wrong
kind of variable, or repeats the highlight colour as a category, tells the reader something
false faster than the caption can correct it. In an exhibit meant to persuade a court, that
is the whole ballgame.

## Verification

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-chart-color.py <file.py|dir>
```

Exits non-zero on: a continuous scheme bound to a nominal field; red/green as the only two
categorical colours; an accent colour reused as a category.

**Corroboration** — the same defaults (Okabe-Ito categorical, viridis sequential, Tol
qualitative/diverging) are what journal-facing guides converge on; e.g.
https://conceptviz.app/blog/scientific-color-palette-for-research-papers-and-posters,
which notes Nature/Science/Cell Press recommend Okabe-Ito. That guide does NOT address
fills-behind-text versus lines, which is why the pale/dark section above exists.

**See also** A5 chart typography (`ds-chart-typography.md`) — same one-theme discipline,
applied to type.
