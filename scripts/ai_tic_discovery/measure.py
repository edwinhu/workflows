"""MEASURE — base rate + cross-model agreement for candidate patterns.

Given cached elicitation samples and a candidate regex, tally how often the
pattern appears, broken down by model. Cross-model agreement (the pattern fires
for BOTH models, not just one) is the strongest signal that a construction is a
real LLM default rather than one model's quirk.

Operates on whole samples (a sample = one model answer, possibly multi-line).
A sample "hits" if the regex matches anywhere in it.
"""

from __future__ import annotations

import re
from collections import defaultdict

from .evaluate import FLAGS


def measure_pattern(samples, pattern: str) -> dict:
    """Tally hit-rate of `pattern` over samples, by model.

    Returns:
      per_model: {model: {"hits": int, "total": int, "rate": float}}
      overall:   {"hits", "total", "rate"}
      cross_model_agreement: True if >=2 models hit at all.
      models_hit: sorted list of models with >=1 hit.
    """
    rx = re.compile(pattern, FLAGS)
    by_model = defaultdict(lambda: {"hits": 0, "total": 0})
    for s in samples:
        cell = by_model[s.model]
        cell["total"] += 1
        if rx.search(s.text):
            cell["hits"] += 1
    per_model = {}
    models_hit = []
    th = tt = 0
    for model, c in sorted(by_model.items()):
        rate = c["hits"] / c["total"] if c["total"] else 0.0
        per_model[model] = {"hits": c["hits"], "total": c["total"], "rate": rate}
        th += c["hits"]
        tt += c["total"]
        if c["hits"] > 0:
            models_hit.append(model)
    return {
        "per_model": per_model,
        "overall": {"hits": th, "total": tt, "rate": (th / tt if tt else 0.0)},
        "cross_model_agreement": len(models_hit) >= 2,
        "models_hit": models_hit,
    }


def matching_lines(samples, pattern: str, max_lines: int = 50):
    """Yield (context_id, model, line) for every line that matches — the raw
    positives feed for building/refining a regex and for the eval positives set.
    """
    rx = re.compile(pattern, FLAGS)
    seen = 0
    for s in samples:
        for line in s.text.splitlines():
            line = line.strip()
            if line and rx.search(line):
                yield s.context_id, s.model, line
                seen += 1
                if seen >= max_lines:
                    return
