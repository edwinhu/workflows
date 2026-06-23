"""N-gram rate-ratio diff — automated tic-candidate discovery.

The methodology's MEASURE step, scaled: instead of eyeballing samples, count how
often every n-gram appears in (a) a large human corpus and (b) LLM output, and
surface the phrases that are recurrent in LLM text but rare/absent in human
prose. Those over-used constructions are tic candidates, ranked automatically.

Key design choices:
  - Genre-matched comparison. The LLM corpus must be the SAME register as the
    human corpus (academic prose vs academic prose), or topic words dominate the
    ranking. (Op-ed elicitation vs journal articles would just surface "the Fed".)
  - Cross-model gate. A candidate must appear in >=2 models, so one model's
    idiosyncrasy doesn't rank. This is the n-gram analogue of the cross-model
    agreement check in measure.py.
  - Rarity in human prose. We want phrases that are ~absent from human writing,
    so the rate ratio is dominated by phrases a human author would not write.

Pure-stdlib so the pytest battery can import it.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

# Keep apostrophes (it's, don't) and word chars; everything else → space.
_NORM_RE = re.compile(r"[^a-z0-9'’ ]+")
_WS_RE = re.compile(r"\s+")


def normalize(text: str) -> list[str]:
    """Lowercase, strip punctuation (keep apostrophes), tokenize to words."""
    t = _NORM_RE.sub(" ", text.lower())
    return _WS_RE.sub(" ", t).strip().split()


def count_ngrams(texts, n_min: int = 2, n_max: int = 6) -> tuple[Counter, int]:
    """Return (Counter of space-joined n-grams, total token count).

    N-grams are counted within each text only (no crossing document boundaries),
    so phrases don't span unrelated articles.
    """
    counts: Counter = Counter()
    tokens = 0
    for text in texts:
        toks = normalize(text)
        tokens += len(toks)
        L = len(toks)
        for n in range(n_min, n_max + 1):
            for i in range(L - n + 1):
                counts[" ".join(toks[i:i + n])] += 1
    return counts, tokens


@dataclass
class Candidate:
    ngram: str
    n: int
    llm_count: int
    llm_rate: float          # per million tokens
    human_count: int
    human_rate: float        # per million tokens
    ratio: float
    models_hit: list = field(default_factory=list)


def diff(human_counts: Counter, human_tokens: int,
         llm_by_model: dict[str, tuple[Counter, int]],
         *, min_llm_count: int = 3, min_models: int = 2,
         max_human_rate: float = 50.0, smoothing: float = 0.5,
         top: int = 80) -> list[Candidate]:
    """Rank n-grams over-represented in LLM output vs human prose.

    Args:
      human_counts/human_tokens: from count_ngrams over the human corpus.
      llm_by_model: {model: (counts, tokens)} — one entry per model.
      min_llm_count: total LLM occurrences required (noise floor).
      min_models: cross-model gate (>= this many models must contain it).
      max_human_rate: drop phrases common in human prose (per-million).
      smoothing: added to rates in the ratio denominator/numerator.
    """
    # Aggregate LLM side.
    agg: Counter = Counter()
    llm_tokens = 0
    per_model_present: dict[str, set] = {}
    for model, (counts, toks) in llm_by_model.items():
        agg.update(counts)
        llm_tokens += toks
        per_model_present[model] = set(counts)

    hr_scale = 1e6 / max(1, human_tokens)
    lr_scale = 1e6 / max(1, llm_tokens)

    out: list[Candidate] = []
    for ng, lc in agg.items():
        if lc < min_llm_count:
            continue
        models_hit = [m for m, s in per_model_present.items() if ng in s]
        if len(models_hit) < min_models:
            continue
        hc = human_counts.get(ng, 0)
        human_rate = hc * hr_scale
        if human_rate > max_human_rate:
            continue
        llm_rate = lc * lr_scale
        ratio = (llm_rate + smoothing) / (human_rate + smoothing)
        out.append(Candidate(
            ngram=ng, n=ng.count(" ") + 1, llm_count=lc, llm_rate=llm_rate,
            human_count=hc, human_rate=human_rate, ratio=ratio,
            models_hit=sorted(models_hit)))
    out.sort(key=lambda c: (c.ratio, c.llm_count), reverse=True)
    return out[:top]


def dedupe_nested(cands: list[Candidate]) -> list[Candidate]:
    """Drop a shorter candidate if a longer one in the list contains it and has
    a comparable LLM count (the longer phrase is the real unit). Keeps the list
    readable without hiding distinct phrases."""
    kept: list[Candidate] = []
    longer = sorted(cands, key=lambda c: c.n, reverse=True)
    chosen: list[str] = []
    for c in sorted(cands, key=lambda c: (c.ratio, c.llm_count), reverse=True):
        covered = any(
            c.ngram != o.ngram and c.ngram in o.ngram
            and o.llm_count >= c.llm_count * 0.7
            for o in longer)
        if not covered:
            kept.append(c)
    return kept
