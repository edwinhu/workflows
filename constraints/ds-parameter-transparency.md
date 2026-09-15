---
name: parameter-transparency
description: Every analytic threshold, filter, tuning value, and date window is centralized in one named configuration location and justified in the approved native plan.
applies-to: [ds, ds-implement, ds-accept, ds-delegate]
---

## Rule

Before native Plan mode approval, `/ds` inventories every analysis decision encoded by a value:
filters, bands, caps, winsorization levels, date windows, minimum observations, bin edges, and
significance thresholds. Loop counters, array indices, and unit conversions are not analysis
parameters.

The approved native plan names one configuration/constants location and records each parameter:

| Constant | Value | Applied in | Rationale/source | Principled? | Disposition |
|---|---|---|---|---|---|
| `TICK` | 0.125 | pennying flag | Craig fn. 55 | ✓ | — |
| `MAX_TRADE_SIZE` | 1_000_000 | trade filter | convenience cutoff | ⚠ | robustness panel `{500K, 2M}` |

Implementation refers to constants by name rather than scattering literals. Match an established
project convention; otherwise a small `src/config.py` with rationale-adjacent constants is the
default.

- **✓ principled** means a cited authority or data-validation result supports the value.
- **⚠ convenience** means a judgment call. It gets exactly one disposition: a robustness panel with
  alternatives, verified-redundant evidence, or display-only explanation.

**NO APPROVED NATIVE PLAN WITH UNNAMED ANALYTIC PARAMETERS.** Inline literals make a sample choice
look like a fact and make replication depend on finding every copy. “It seemed reasonable” is not a
principled rationale.

## Facts

- The same cutoff hard-coded at five sites eventually diverges when four are changed. One named
  constant makes the parameter set auditable in one screen.
- A muni analysis replaced hand-picked price bands with a cited `price_ok` plus winsorization
  pipeline; medians moved under 0.2 bps. Deleting a convenience parameter can be the correct
  disposition, but only after checking equivalence.
- A principled value has a specific bar: citation or validation evidence. `EXEC_LAG_MAX_DAYS=1` was
  principled only because validation found 86% recall and 21% false positives, not because one is a
tidy number.

If a parameter decision changes during implementation, re-enter native Plan mode for approval rather
than patching the immutable copied plan.
