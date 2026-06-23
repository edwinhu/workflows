"""JUDGE — judgment probe.

Ask the models whether a candidate construction reads as an AI tic and to NAME
the construction (the name aids labeling and dedupe against existing rules).

This is a coarse signal, not a vote that ships a rule — a rule ships on the
precision/recall battery (evaluate.py), not on a model's self-assessment. But
cross-model "yes, this is an AI tell" plus a shared name for the construction is
useful corroboration and gives a ready label.

Verdicts are cached alongside elicitation output:
    scratch/ai-tics/cache/_judge/<hash>.txt
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from . import models
from .elicit import CACHE_DIR

JUDGE_DIR = CACHE_DIR / "_judge"

_PROMPT = (
    "You are an editor trained to spot AI-generated writing tells. "
    "Read this sentence:\n\n"
    "\"\"\"{example}\"\"\"\n\n"
    "Answer in exactly two lines:\n"
    "VERDICT: <AI-TIC or HUMAN-OK>\n"
    "NAME: <a short 2-5 word name for the rhetorical construction>\n"
)

_VERDICT_RE = re.compile(r"VERDICT:\s*(AI-?TIC|HUMAN-?OK)", re.I)
_NAME_RE = re.compile(r"NAME:\s*(.+)", re.I)


def _key(example: str) -> Path:
    h = hashlib.sha1(example.strip().encode("utf-8")).hexdigest()[:16]
    return JUDGE_DIR / f"{h}.txt"


def judge_example(example: str, model_list=models.MODELS,
                  refresh: bool = False, timeout: int = 120) -> dict:
    """Ask each model to judge one example. Returns per-model verdict/name."""
    out = {}
    for model in model_list:
        cell = _key(example) if len(model_list) == 1 else \
            JUDGE_DIR / f"{model}-{_key(example).name}"
        if cell.exists() and cell.read_text().strip() and not refresh:
            raw = cell.read_text()
        else:
            res = models.run_model(model, _PROMPT.format(example=example),
                                   timeout=timeout)
            if not res.ok:
                out[model] = {"verdict": None, "name": None, "error": res.error}
                continue
            raw = res.text
            cell.parent.mkdir(parents=True, exist_ok=True)
            cell.write_text(raw, encoding="utf-8")
        vm = _VERDICT_RE.search(raw)
        nm = _NAME_RE.search(raw)
        verdict = vm.group(1).upper().replace("-", "") if vm else None
        out[model] = {
            "verdict": verdict,            # AITIC / HUMANOK / None
            "name": nm.group(1).strip() if nm else None,
            "raw": raw,
        }
    n_tic = sum(1 for v in out.values() if v.get("verdict") == "AITIC")
    out["_consensus"] = {
        "ai_tic_votes": n_tic,
        "n_models": sum(1 for k in out if not k.startswith("_")),
    }
    return out
