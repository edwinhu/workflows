#!/usr/bin/env python3
"""Tests for the de-ai-revise audit scorer (skills/de-ai-revise/scripts/de_ai_audit.py).

Confirms the three folded scorers fire as designed and — critically — that the
corpus `dropped` tier never false-positives on legal-normal vocabulary.

Run with:  python3 -m pytest tests/test_de_ai_audit.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
AUDIT_PATH = REPO_ROOT / "skills" / "de-ai-revise" / "scripts" / "de_ai_audit.py"

pytest.importorskip("yaml")  # the audit loads diction.yaml


def _load_audit():
    spec = importlib.util.spec_from_file_location("de_ai_audit", AUDIT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


AUDIT = _load_audit()


def _types(res):
    return res["by_type"]


# --- tics fire ---------------------------------------------------------------
def test_tic_fires_on_ai_phrase():
    res = AUDIT.audit_text("The bridge stands as a testament to careful planning.")
    assert any(s["type"] == "tic" for s in res["spans"])
    assert res["tic_density"] > 0


def test_findings_carry_implications_tic():
    res = AUDIT.audit_text("These findings carry significant implications for the field.")
    labels = [s["label"] for s in res["spans"] if s["type"] == "tic"]
    assert any("findings-carry-implications" in l for l in labels)


# --- always_flag diction swaps on sight, carries a replacement ---------------
def test_always_flag_diction_fires_with_replacement():
    res = AUDIT.audit_text("The reform is a paradigm-shifting tapestry of ideas.")
    af = [s for s in res["spans"] if s["type"] == "diction:always_flag"]
    assert af, "always_flag diction did not fire"
    assert all(s["replace_with"] for s in af), "always_flag span missing replace_with"


def test_always_flag_matches_inflections():
    # 'showcasing' is the -ing inflection of always_flag 'showcasing'; 'nestled' literal
    res = AUDIT.audit_text("The town, nestled in the hills, kept showcasing its charm.")
    words = {s["text"].lower() for s in res["spans"] if s["type"] == "diction:always_flag"}
    assert "nestled" in words and "showcasing" in words


# --- the corpus 'dropped' tier must NEVER fire (the FP guard) ----------------
def test_dropped_tier_never_flags_legal_normal_words():
    # Every word here is in diction.yaml `dropped` (legal/finance-normal).
    text = ("This significant and robust analysis will leverage a comprehensive, "
            "sophisticated framework to facilitate a crucial outcome.")
    res = AUDIT.audit_text(text)
    diction_hits = [s for s in res["spans"] if s["type"].startswith("diction")]
    assert not diction_hits, f"dropped-tier words false-positived: {diction_hits}"


# --- clean human prose produces no actionable diction/tic spans --------------
def test_clean_legal_prose_has_no_tic_or_always_flag():
    text = ("The order makes the ten-day period available only to offers that "
            "satisfy six conditions at once. Roughly one in three third-party "
            "tender offers could, on these facts, have run on the compressed clock.")
    res = AUDIT.audit_text(text)
    bad = [s for s in res["spans"]
           if s["type"] == "tic" or s["type"] == "diction:always_flag"]
    assert not bad, f"clean prose flagged: {bad}"


# --- de-AI rewrite improves the signals (the round-trip the tool exists for) --
def test_rewrite_improves_tic_density_and_clears_spans():
    before = ("In today's rapidly evolving landscape, the reform stands as a "
              "testament to progress, and these findings carry significant "
              "implications for a multifaceted, meticulous debate.")
    after = ("The reform is a real step forward. It changes how courts weigh "
             "competing offers, and that matters for the debate over timing.")
    rb = AUDIT.audit_text(before)
    ra = AUDIT.audit_text(after)
    assert rb["tic_density"] > 0 and ra["tic_density"] == 0
    assert ra["n_spans"] < rb["n_spans"]


# --- corpus z-vs-human reporting (item 4: report z-scores, not just raw counts) ----------
def test_z_report_present_and_backward_compatible():
    res = AUDIT.audit_text("The bridge stands as a testament to careful planning.")
    # backward-compatible: all prior top-level keys still present
    for key in ("file", "words", "composite_human_likeness", "tic_density", "tic_flags",
                "n_spans", "by_type", "spans", "advisories", "density_words"):
        assert key in res
    # new field, additive only
    assert "z_report" in res
    zr = res["z_report"]
    assert set(zr) == {"stylometric_per_feature", "stylometric_mean_abs_z", "diction_rate_vs_human"}


def test_z_report_on_real_file_populates_stylometric_and_diction(tmp_path):
    text = ("In today's rapidly evolving landscape, the reform stands as a testament to "
            "progress, and these findings carry significant implications for a "
            "multifaceted, meticulous debate. The analysis showcases a rich tapestry of "
            "considerations, and the framework harnesses cutting-edge methodology.")
    f = tmp_path / "draft.md"
    f.write_text(text)
    res = AUDIT.audit_file(str(f), ("always_flag", "cluster", "density"))
    zr = res["z_report"]
    assert zr["stylometric_per_feature"], "expected per-feature stylometric z-scores"
    for feat, v in zr["stylometric_per_feature"].items():
        assert {"value", "human_mean", "z", "flag"} <= set(v)
    dr = zr["diction_rate_vs_human"]
    assert "tapestry" in dr
    assert dr["tapestry"]["draft_rate_per_M"] > dr["tapestry"]["human_rate_per_M"]
    assert dr["tapestry"]["ratio_vs_human"] > 1


def test_z_report_diction_ratio_none_when_corpus_rate_zero(tmp_path):
    # 'underpinning' has rate_per_M: 0.0 in diction.yaml (always_flag) — ratio must be
    # reported as None (undefined multiplier), not a ZeroDivisionError or a fabricated number.
    f = tmp_path / "draft.md"
    f.write_text("This underpinning shapes the whole argument.")
    res = AUDIT.audit_file(str(f), ("always_flag", "cluster", "density"))
    dr = res["z_report"]["diction_rate_vs_human"]
    assert "underpinning" in dr
    assert dr["underpinning"]["human_rate_per_M"] == 0.0
    assert dr["underpinning"]["ratio_vs_human"] is None


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
