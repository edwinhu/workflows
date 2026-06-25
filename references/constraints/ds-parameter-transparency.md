---
name: parameter-transparency
description: No magic numbers — every filter threshold, band, cap, winsorization level, sample cutoff, and date window is centralized in one named config location and documented in a Filters & Parameters table
applies-to: [ds-plan, ds-delegate, ds-review]
---

## Rule

Every analysis parameter — filter threshold, price band, size cap, winsorization level, sample cutoff, date window, minimum-observation count, bin edge, significance level — MUST be:

1. **Centralized** in ONE named config/constants location, referenced by name everywhere it is used. **No inline numeric literals** in pipeline or exhibit code. `df[df.price > 100]` is a magic number; `df[df.price > MIN_PRICE]` is not.
2. **Documented** in a `## Filters & Parameters` table: **constant · value · applied in · rationale/source · principled? · disposition**. Every parameter flagged **not principled** (a convenience cutoff) must carry a **disposition** that resolves the researcher degree of freedom.

A "magic number" is any literal that encodes an analysis decision — a number whose value the reader cannot trace to a name, a rationale, or a disposition. Loop counters, array indices, and unit conversions (e.g. `* 100` for percent) are not magic numbers.

### The Filters & Parameters table (PLAN.md + analysis docs)

```markdown
## Filters & Parameters

| Constant | Value | Applied in | Rationale / source | Principled? | Disposition |
|----------|-------|------------|--------------------|-------------|-------------|
| TICK | 0.125 | pennying flag | Craig fn 55 | ✓ | — |
| EXEC_LAG_MAX_DAYS | 1 | executed-match | validated 86% recall / 21% FP vs status | ✓ | — |
| WINSOR | (.01, .99) | prices, spreads | Craig error trio | ✓ | — |
| MAX_TRADE_SIZE | 1_000_000 | trades filter | convenience cutoff | ⚠ | robustness panel {500K, 2M} |
| MIN_OBS_PER_FIRM | 8 | firm_quarter panel | round number | ⚠ | verified-redundant (result moves <0.2bps) |
```

- **Principled? = ✓** when the value is traceable to a **cited source** ("Craig fn 55") OR a **data-validation result** (a recall/FP rate, a coverage check) — state which in Rationale/source. **= ⚠ (warn)** when it is a convenience cutoff with no external basis (a round number, a "looks reasonable" cut).
- Every **⚠** parameter MUST carry a **disposition** — exactly one of:
  - **robustness panel** — name the alternative values a robustness exhibit varies it over (`{500K, 2M}`).
  - **verified-redundant** — show the result barely moves when the value changes, and cite the magnitude (`medians move <0.2bps`).
  - **display-only** — the value only affects presentation (bin edges for a chart), not an estimate.
- **An exhibit is not "done" until its ⚠ parameters all have a disposition.** A convenience cutoff with no disposition is an unexamined researcher degree of freedom — the exact thing the table exists to expose. (This is how [[ds-robustness-checks]] and [[ds-p-hacking-prevention]] get their inputs.)

### Centralization pattern

A single **plain-Python `src/config.py` of named constants with the rationale in an inline comment next to each value** — read by every module via `from src.config import TICK`. Match the project's existing pattern if one exists; otherwise default to this (the muni-pennying reference pattern):

```python
# src/config.py — the ONE place parameters live
TICK = 0.125              # pennying threshold (Craig fn 55)
EXEC_LAG_MAX_DAYS = 1     # executed-match window; validated 86% recall / 21% FP vs status field
WINSOR = (0.01, 0.99)     # Craig error trio: MEDIAN_WINDOW=5, MEDIAN_TOL=0.10, WINSOR
MID_WINDOWS = (3, 5, 10)  # benchmark mid windows (days); MID_WINDOW_DAYS=5 default
MAX_TRADE_SIZE = 1_000_000  # ⚠ convenience cutoff — robustness panel {500K, 2M}
```

```python
# every other file references by name — never a literal
from src.config import TICK, MAX_TRADE_SIZE
trades = trades[trades.par <= MAX_TRADE_SIZE]
pennied = (trades.cost_vs_mid.abs() < TICK)
```

**Why plain module over YAML/dataclass:** diffable in git, zero-dependency, directly importable, and the rationale lives next to the value. The config module is the machine-readable twin of the Filters & Parameters table — the table explains *why* and the *disposition*, the module supplies the *value*, and they must agree. A reviewer running a robustness panel edits one line, not fifteen scattered literals.

## Facts

- Scattered literals are a replication landmine: the same cutoff hard-coded at five call sites drifts to four-and-a-half when someone edits four of them, and the analysis silently runs two different samples. The reader/replicator cannot find what they cannot name. Centralizing makes the parameter set auditable in one screen; inlining defers that audit to whoever inherits the code, at much higher cost.
- The dangerous magic number is the one nobody flagged as a choice: a `> 100` price filter or a `>= 1000` size cap looks like a fact until you ask "why not 50, why not 5000?" — and the honest answer is "it was round." Recording it as `⚠` with a disposition converts a hidden researcher degree of freedom into a stated, resolved one; leaving it inline asserts a precision the value never had, which is a quiet form of dishonesty in the results.
- Sometimes the right disposition is to delete the parameter: the muni-pennying audit had hand-picked price bands (`[20,200]`, `[50,150]`) scattered across exhibits — pure convenience cutoffs. They were replaced by a single principled Craig `price_ok` + winsorize pipeline and the swap was *verified equivalent* (medians moved <0.2bps; within-tick share 34.7%→34.5%). A convenience parameter that survives only because no one tested removing it is the cheapest robustness check you are not running — and "verified-redundant" is a valid disposition only once you have actually shown the result barely moves.
- "Principled" has a specific bar: traceable to a cited source OR a data-validation result — not "it seemed reasonable." muni's `EXEC_LAG_MAX_DAYS=1` is principled because it was validated (86% recall / 21% FP against the status field), not because 1 is a tidy number. Claiming principled without the citation or the validation is the same unverified-claim problem the table exists to catch.
- Centralization is a planning-time decision, not a cleanup pass: the config module and the parameter inventory are cheapest to set up before any task writes a literal, and most expensive to retrofit after literals are scattered across the pipeline (Edwin's muni audit is exactly this retrofit — done once, it should not have to be done again). "I'll extract the constants later" is the commitment that never gets kept because the pipeline runs once and everyone moves on.
- "It's obviously just data availability" is sometimes true and sometimes a guess wearing a lab coat — a date window can be principled (coverage starts) or arbitrary (a round year). The table forces the distinction to be stated, and stating it is what lets a reviewer challenge the principled ones and a robustness check defend the arbitrary ones. Skipping the kind column collapses both into "trust me."
