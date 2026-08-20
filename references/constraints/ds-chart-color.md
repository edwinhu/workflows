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

**See also** A5 chart typography (`ds-chart-typography.md`) — same one-theme discipline,
applied to type.
