---
name: parameter-transparency
description: No magic numbers — every filter threshold, band, cap, winsorization level, sample cutoff, and date window is centralized in one named config location and documented in a Filters & Parameters table
applies-to: [ds-plan, ds-delegate, ds-review]
---

## Rule

Every analysis parameter — filter threshold, price band, size cap, winsorization level, sample cutoff, date window, minimum-observation count, bin edge, significance level — MUST be:

1. **Centralized** in ONE named config/constants location (a `config.py` / `constants.py` module, a `params` dataclass, or a `config.yaml`/`.toml`), referenced by name everywhere it is used. **No inline numeric literals** in pipeline or exhibit code. `df[df.price > 100]` is a magic number; `df[df.price > P.MIN_PRICE]` is not.
2. **Documented** in a `## Filters & Parameters` table: **name · value · where applied · rationale · arbitrary-vs-principled**. Every parameter flagged **arbitrary** must have a corresponding **sensitivity/robustness check** that varies it.

A "magic number" is any literal that encodes an analysis decision — a number whose value the reader cannot trace to a name, a rationale, or a robustness check. Loop counters, array indices, and unit conversions (e.g. `* 100` for percent) are not magic numbers.

### The Filters & Parameters table (PLAN.md + analysis docs)

```markdown
## Filters & Parameters

| Name | Value | Where applied | Rationale | Kind | Sensitivity check |
|------|-------|---------------|-----------|------|-------------------|
| MIN_PRICE | 1.00 | trade_file filter | Sub-$1 munis are odd-lot noise | principled | — |
| MAX_TRADE_SIZE | 1_000_000 | trade_file filter | Institutional cutoff; drops dealer blocks | arbitrary | robustness: {500K, 2M} |
| WINSOR_PCT | 0.01 | returns, spreads | Standard 1%/99% tail trim | principled | — |
| SAMPLE_START | 2010-01-01 | all masters | MSRB coverage begins | principled | — |
| MIN_OBS_PER_FIRM | 8 | firm_quarter panel | Need ≥2yrs for FE | arbitrary | robustness: {4, 12} |
```

- **Kind = principled** when the value follows from data availability, an institutional/legal threshold, a published convention, or theory — state which. **Kind = arbitrary** when it is a judgment call (a round number, a "looks reasonable" cut).
- Every **arbitrary** row needs a **sensitivity check** naming the alternative values the robustness analysis varies it over. An arbitrary parameter with no sensitivity check is an unexamined researcher degree of freedom — the exact thing the table exists to expose.

### Centralization pattern

Default to a single module read by every task. Match the project's existing pattern if one exists; otherwise:

```python
# src/config.py — the ONE place parameters live
from dataclasses import dataclass

@dataclass(frozen=True)
class Params:
    MIN_PRICE: float = 1.00
    MAX_TRADE_SIZE: int = 1_000_000
    WINSOR_PCT: float = 0.01
    SAMPLE_START: str = "2010-01-01"
    MIN_OBS_PER_FIRM: int = 8

P = Params()
```

```python
# every other file references by name — never a literal
from src.config import P
trades = trades[(trades.price >= P.MIN_PRICE) & (trades.size <= P.MAX_TRADE_SIZE)]
```

The config module is the machine-readable twin of the Filters & Parameters table — the table explains *why*, the module supplies the *value*, and they must agree. A reviewer changing `WINSOR_PCT` for a robustness check edits one line, not fifteen scattered literals.

## Facts

- Scattered literals are a replication landmine: the same cutoff hard-coded at five call sites drifts to four-and-a-half when someone edits four of them, and the analysis silently runs two different samples. The reader/replicator cannot find what they cannot name. Centralizing makes the parameter set auditable in one screen; inlining defers that audit to whoever inherits the code, at much higher cost.
- The dangerous magic number is the one nobody flagged as a choice: a `> 100` price filter or a `>= 1000` size cap looks like a fact until you ask "why not 50, why not 5000?" — and the honest answer is "it was round." Recording it as `arbitrary` with a sensitivity check converts a hidden researcher degree of freedom into a stated, tested one; leaving it inline asserts a precision the value never had, which is a quiet form of dishonesty in the results.
- Centralization is a planning-time decision, not a cleanup pass: the config module and the parameter inventory are cheapest to set up before any task writes a literal, and most expensive to retrofit after literals are scattered across the pipeline (Edwin's muni audit is exactly this retrofit — done once, it should not have to be done again). "I'll extract the constants later" is the commitment that never gets kept because the pipeline runs once and everyone moves on.
- "It's obviously just data availability" is sometimes true and sometimes a guess wearing a lab coat — a date window can be principled (coverage starts) or arbitrary (a round year). The table forces the distinction to be stated, and stating it is what lets a reviewer challenge the principled ones and a robustness check defend the arbitrary ones. Skipping the kind column collapses both into "trust me."
