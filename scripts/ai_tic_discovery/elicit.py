"""ELICIT — fan out context prompts over the model CLIs, cache raw outputs.

A *context* is a place an AI tic lives, expressed as a prompt that asks a model
to produce text in that context (e.g. "Write 8 op-ed closing lines that tie
together three unrelated news items."). We run each context across every model
N times and cache each raw answer, so MEASURE/JUDGE are reproducible and offline.

Cache layout (gitignored):
    scratch/ai-tics/cache/<context_id>/<model>/<n>.txt

Idempotent: an existing non-empty cache file is reused unless refresh=True.
Failures (rate-limit, timeout) are recorded as `.error` sidecars and skipped on
re-run only if you pass refresh=False (so transient errors can be retried by
default-running again — an `.error` file does NOT count as a cached success).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from . import models

REPO_ROOT = Path(__file__).resolve().parents[2]
# AITIC_CACHE_DIR lets the cache live outside the repo (e.g. synced to rjds).
CACHE_DIR = Path(os.environ.get("AITIC_CACHE_DIR",
                                str(REPO_ROOT / "scratch" / "ai-tics" / "cache")))


@dataclass
class Sample:
    context_id: str
    model: str
    n: int
    text: str
    cached: bool


def _cell(context_id: str, model: str, n: int) -> Path:
    return CACHE_DIR / context_id / model / f"{n}.txt"


def load_samples(context_id: str) -> list[Sample]:
    """Read every cached answer for a context (across models/runs)."""
    out: list[Sample] = []
    base = CACHE_DIR / context_id
    if not base.is_dir():
        return out
    for model_dir in sorted(base.iterdir()):
        if not model_dir.is_dir():
            continue
        for f in sorted(model_dir.glob("*.txt")):
            try:
                text = f.read_text(encoding="utf-8")
            except OSError:
                continue
            if text.strip():
                out.append(Sample(context_id, model_dir.name,
                                   int(f.stem), text, cached=True))
    return out


def elicit_context(context_id: str, prompt: str, n_samples: int,
                   model_list=models.MODELS, refresh: bool = False,
                   timeout: int = 180, log=print) -> list[Sample]:
    """Run `prompt` across models × n_samples, caching each answer."""
    results: list[Sample] = []
    for model in model_list:
        for n in range(1, n_samples + 1):
            cell = _cell(context_id, model, n)
            if cell.exists() and cell.read_text().strip() and not refresh:
                results.append(Sample(context_id, model, n,
                                      cell.read_text(), cached=True))
                continue
            res = models.run_model(model, prompt, timeout=timeout)
            if res.ok:
                cell.parent.mkdir(parents=True, exist_ok=True)
                cell.write_text(res.text, encoding="utf-8")
                # Clear any stale error sidecar.
                err = cell.with_suffix(".error")
                if err.exists():
                    err.unlink()
                results.append(Sample(context_id, model, n, res.text, cached=False))
                log(f"  [{model} #{n}] ok ({len(res.text)} chars)")
            else:
                cell.parent.mkdir(parents=True, exist_ok=True)
                cell.with_suffix(".error").write_text(res.error, encoding="utf-8")
                log(f"  [{model} #{n}] FAIL: {res.error}")
    return results
