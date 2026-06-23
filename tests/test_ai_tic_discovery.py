#!/usr/bin/env python3
"""Tests for the AI-tic discovery harness (stdlib-only modules).

Covers the parts that gate whether a discovered rule ships:
  - models._clean (strip ANSI + copilot footer from CLI output)
  - evaluate.evaluate_regex (recall / precision / FP accounting)
  - ngram.normalize / count_ngrams / diff (automated candidate discovery)

models/evaluate/ngram are stdlib-only by design so this runs without a uv env:
    python3 -m pytest tests/test_ai_tic_discovery.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from ai_tic_discovery import models, ngram          # noqa: E402
from ai_tic_discovery.evaluate import evaluate_regex  # noqa: E402


# ── models._clean ───────────────────────────────────────────────────────────

def test_clean_strips_ansi_and_footer():
    raw = ("The answer sentence.\n\n"
           "\x1b[38;2;112;112;112mChanges    \x1b[39m+0 -0\n"
           "AI Credits 6.7 (9s)\n"
           "Tokens 31.8k\n"
           "Shell cwd was reset to /x\n")
    assert models._clean(raw) == "The answer sentence."


def test_clean_keeps_multiline_body():
    raw = "Line one.\nLine two.\nLine three."
    assert models._clean(raw) == "Line one.\nLine two.\nLine three."


# ── evaluate_regex ──────────────────────────────────────────────────────────

def test_evaluate_recall_and_fp():
    pat = r"\bthe lesson is the same\b"
    pos = ["…and the lesson is the same here.", "the lesson is the same",
           "a totally different construction"]
    neg = ["whether the merger was fair is the question",
           "the lesson is the same applies"]  # 2nd is a (deliberate) FP
    r = evaluate_regex(pat, pos, neg)
    assert r.tp == 2 and r.fn == 1
    assert abs(r.recall - 2 / 3) < 1e-9
    assert r.fp == 1 and r.tn == 1
    assert not r.ship_ready          # any FP blocks ship


def test_evaluate_ship_ready_requires_zero_fp():
    pat = r"\bpoint to one uncomfortable truth\b"
    pos = ["they point to one uncomfortable truth", "point to one uncomfortable truth"]
    neg = ["the firm reported earnings", "investors react to news"]
    r = evaluate_regex(pat, pos, neg)
    assert r.fp == 0 and r.recall == 1.0 and r.ship_ready


# ── ngram ───────────────────────────────────────────────────────────────────

def test_normalize_keeps_apostrophes_drops_punctuation():
    assert ngram.normalize("It's, really— the SAME thing!") == \
        ["it's", "really", "the", "same", "thing"]


def test_count_ngrams_does_not_cross_documents():
    counts, tokens = ngram.count_ngrams(["alpha beta", "gamma delta"],
                                        n_min=2, n_max=2)
    assert tokens == 4
    assert counts["alpha beta"] == 1 and counts["gamma delta"] == 1
    assert "beta gamma" not in counts          # no cross-document bigram


def test_diff_surfaces_cross_model_overused_phrase():
    human = ["the firm reports earnings and investors react to the news"] * 40
    gpt = ["these findings point to one uncomfortable truth"] * 15
    gem = ["the evidence points to one uncomfortable truth"] * 15
    hc, ht = ngram.count_ngrams(human)
    llm = {"copilot": ngram.count_ngrams(gpt), "gemini": ngram.count_ngrams(gem)}
    cands = ngram.diff(hc, ht, llm, min_llm_count=3, min_models=2, top=20)
    phrases = {c.ngram for c in cands}
    assert "one uncomfortable truth" in phrases
    # every survivor cleared the cross-model gate
    assert all(len(c.models_hit) >= 2 for c in cands)


def test_diff_cross_model_gate_excludes_single_model():
    human = ["ordinary academic prose about firms and markets"] * 40
    only_gpt = ["a quirky phrase only gpt says repeatedly"] * 20
    gem = ["the evidence about markets"] * 5
    hc, ht = ngram.count_ngrams(human)
    llm = {"copilot": ngram.count_ngrams(only_gpt), "gemini": ngram.count_ngrams(gem)}
    cands = ngram.diff(hc, ht, llm, min_llm_count=3, min_models=2, top=20)
    assert "quirky phrase only" not in {c.ngram for c in cands}


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
