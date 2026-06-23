"""Precision/recall evaluation of a candidate regex.

Pure-stdlib so the pytest battery can import it without a `uv` env.

The matching semantics MIRROR scripts/prose-lint.py exactly:
    re.compile(pattern, re.IGNORECASE | re.MULTILINE); rx.search(line)
so a rule that scores well here behaves identically once pasted into a
_*_PATTERNS table.

A candidate is evaluated against two labeled string sets:
  positives — strings that ARE the tic (mined from model output). Should match.
  negatives — strings from genuine HUMAN writing. Should NOT match.

Reported:
  recall     = TP / (TP + FN)   — fraction of real tics caught.
  precision  = TP / (TP + FP)   — over the combined labeled set.
  fp         = negatives matched (the ship-blocker; target 0).
  *_examples — sample offending strings for inspection.

The discipline the two recent rules baked in as comments — "must hit real
positives, must NOT hit curated legit negatives" — is computed here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

FLAGS = re.IGNORECASE | re.MULTILINE


@dataclass
class EvalResult:
    pattern: str
    tp: int = 0
    fn: int = 0
    fp: int = 0
    tn: int = 0
    fn_examples: list[str] = field(default_factory=list)
    fp_examples: list[str] = field(default_factory=list)

    @property
    def recall(self) -> float:
        d = self.tp + self.fn
        return self.tp / d if d else 0.0

    @property
    def precision(self) -> float:
        d = self.tp + self.fp
        return self.tp / d if d else 0.0

    @property
    def n_positives(self) -> int:
        return self.tp + self.fn

    @property
    def n_negatives(self) -> int:
        return self.fp + self.tn

    @property
    def ship_ready(self) -> bool:
        """Conservative bar: zero false positives on the human corpus AND
        non-trivial recall on the mined positives."""
        return self.fp == 0 and self.recall >= 0.5 and self.tp > 0

    def summary(self) -> str:
        return (
            f"recall={self.recall:.0%} ({self.tp}/{self.n_positives})  "
            f"precision={self.precision:.0%}  "
            f"FP={self.fp}/{self.n_negatives}  "
            f"{'SHIP-READY' if self.ship_ready else 'NOT READY'}"
        )


def evaluate_regex(pattern: str, positives, negatives,
                   max_examples: int = 8) -> EvalResult:
    """Score `pattern` against labeled positives/negatives.

    Raises re.error if the pattern does not compile (surface bad regexes
    loudly rather than silently scoring 0).
    """
    rx = re.compile(pattern, FLAGS)
    res = EvalResult(pattern=pattern)
    for s in positives:
        if rx.search(s):
            res.tp += 1
        else:
            res.fn += 1
            if len(res.fn_examples) < max_examples:
                res.fn_examples.append(s.strip())
    for s in negatives:
        if rx.search(s):
            res.fp += 1
            if len(res.fp_examples) < max_examples:
                res.fp_examples.append(s.strip())
        else:
            res.tn += 1
    return res
