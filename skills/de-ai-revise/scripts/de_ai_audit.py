#!/usr/bin/env -S uv run --with pyyaml python3
"""de-ai-revise AUDIT — the unified, corpus-validated AI-prose scorer.

Folds the three already-built, corpus-gated scorers into ONE finding set that
GUIDES a de-AI rewrite (it does not grade for its own sake):

  1. Scored AI-tics  — skills/ai-anti-patterns/references/scored-tics-patterns.py
     (every entry passed the ~0-human-rate gate vs the 14.3M-sentence
     law+finance corpus; severity rides in the label as `ai-tic·sevN·id`).
  2. Tiered diction  — references/diction.yaml (fancy->plain, tiered by empirical
     corpus rate). always_flag = replace on sight; cluster = flag 2+/paragraph;
     density = flag at saturation; dropped = legal-normal, NEVER flagged.
  3. Stylometrics    — skills/ai-anti-patterns/scripts/style_metrics.py --lint
     (composite_human_likeness 0-100 + line findings: em_dash / metronomic_run /
     opener / nominalization; + draft-level rhythm/diction advisories).

Output is a SPAN LIST (line-anchored, each with a plain replacement where one
exists) plus draft-level signals (composite, tic density, advisories). The
rewrite revises the flagged spans — it does NOT chase the composite. Diction
`dropped`-tier words are never emitted: flagging legal-normal vocabulary is the
false-positive failure this tiering exists to prevent.

Usage:
  de_ai_audit.py draft.md                 # human-readable report
  de_ai_audit.py --json draft.md ...      # machine output (review/revise consume this)
  de_ai_audit.py --tier always_flag x.md  # restrict diction to a tier (default: always_flag,cluster,density)
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent          # skills/de-ai-revise
SKILLS_ROOT = SKILL_DIR.parent                              # skills/
SCORED_TICS = SKILLS_ROOT / "ai-anti-patterns" / "references" / "scored-tics-patterns.py"
STYLE_LINT = SKILLS_ROOT / "ai-anti-patterns" / "scripts" / "style_metrics.py"
DICTION_YAML = SKILL_DIR / "references" / "diction.yaml"

try:
    import yaml
except ImportError:
    sys.exit("needs PyYAML: run via `uv run --with pyyaml python3 de_ai_audit.py ...`")


# ── tics ──────────────────────────────────────────────────────────────────────
def _load_tics():
    """Return [(compiled_regex, label, severity)] from the in-plugin scored table."""
    spec = importlib.util.spec_from_file_location("scored_tics", SCORED_TICS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = []
    for pat, label in getattr(mod, "_TIC_PATTERNS", []):
        m = re.search(r"sev(\d)", label)
        sev = int(m.group(1)) if m else 1
        out.append((re.compile(pat, re.I | re.M), label, sev))
    return out


# ── diction ─────────────────────────────────────────────────────────────────
def _word_rx(word: str) -> re.Pattern:
    """Match the word and its common inflections (delve->delving, meticulous->meticulously).

    Hyphenated compounds (cutting-edge, ever-evolving) match literally.
    """
    esc = re.escape(word)
    if "-" in word or word.endswith(("s", "es", "ies")):
        return re.compile(r"\b" + esc + r"\b", re.I)
    return re.compile(r"\b" + esc + r"(?:s|es|ed|d|ing|ly|ies)?\b", re.I)


def _load_diction():
    data = yaml.safe_load(DICTION_YAML.read_text())
    tiers = {}
    for tier in ("always_flag", "cluster", "density"):
        entries = []
        for e in data.get(tier, []):
            entries.append({
                "word": e["word"],
                "replace_with": e.get("replace_with", ""),
                "rate": float(e.get("rate_per_M", 0)),
                "rx": _word_rx(e["word"]),
            })
        tiers[tier] = entries
    return tiers


# ── stylometrics ──────────────────────────────────────────────────────────────
def _run_style(path: Path) -> dict:
    try:
        out = subprocess.run(
            [sys.executable, str(STYLE_LINT), "--lint", "--json", str(path)],
            capture_output=True, text=True, timeout=120)
        if out.returncode not in (0, 1) or not out.stdout.strip():
            return {}
        return json.loads(out.stdout)
    except Exception:
        return {}


def _paragraphs(text: str):
    """Yield (start_line, paragraph_text). Blank-line delimited."""
    lines = text.split("\n")
    buf, start = [], 1
    for i, ln in enumerate(lines, 1):
        if ln.strip() == "":
            if buf:
                yield start, "\n".join(buf)
            buf, start = [], i + 1
        else:
            if not buf:
                start = i
            buf.append(ln)
    if buf:
        yield start, "\n".join(buf)


def audit_text(text: str, path: str = "<text>",
               tiers_on=("always_flag", "cluster", "density")) -> dict:
    tics = _load_tics()
    diction = _load_diction()
    lines = text.split("\n")
    words = max(1, len(re.findall(r"\b\w+\b", text)))
    spans = []

    # --- tics (line-anchored) ---
    tic_weighted = 0
    tic_flags = 0
    for rx, label, sev in tics:
        for i, ln in enumerate(lines, 1):
            for m in rx.finditer(ln):
                tic_flags += 1
                tic_weighted += sev
                spans.append({
                    "line": i, "type": "tic", "severity": "major" if sev >= 4 else "minor",
                    "sev_score": sev, "label": label, "text": m.group(0),
                    "replace_with": "", "message": f"AI-tic ({label}) — rewrite; real authors do not write this.",
                })

    # --- diction: always_flag (every occurrence) ---
    if "always_flag" in tiers_on:
        for e in diction["always_flag"]:
            for i, ln in enumerate(lines, 1):
                for m in e["rx"].finditer(ln):
                    spans.append({
                        "line": i, "type": "diction:always_flag", "severity": "major",
                        "sev_score": 4, "label": f"diction·always_flag·{e['word']}",
                        "text": m.group(0), "replace_with": e["replace_with"],
                        "message": f"'{m.group(0)}' -> {e['replace_with']}",
                    })

    # --- diction: cluster (flag when 2+ in one paragraph) ---
    if "cluster" in tiers_on:
        for pstart, ptext in _paragraphs(text):
            phits = []
            for e in diction["cluster"]:
                for m in e["rx"].finditer(ptext):
                    line_off = ptext[:m.start()].count("\n")
                    phits.append((pstart + line_off, m.group(0), e))
            if len(phits) >= 2:
                for line, tok, e in phits:
                    spans.append({
                        "line": line, "type": "diction:cluster", "severity": "minor",
                        "sev_score": 2, "label": f"diction·cluster·{e['word']}",
                        "text": tok, "replace_with": e["replace_with"],
                        "message": f"cluster ({len(phits)} fancy words this paragraph): '{tok}' -> {e['replace_with']}",
                    })

    # --- diction: density (flag at saturation ~3%+ of words) ---
    density_words = []
    if "density" in tiers_on:
        dcount = 0
        seen = []
        for e in diction["density"]:
            n = len(e["rx"].findall(text))
            if n:
                dcount += n
                seen.append((e["word"], n))
        density_rate = dcount / words
        if density_rate >= 0.03:
            density_words = sorted(seen, key=lambda x: -x[1])
            for w, n in density_words:
                spans.append({
                    "line": 0, "type": "diction:density", "severity": "minor",
                    "sev_score": 1, "label": f"diction·density·{w}",
                    "text": w, "replace_with": "", "count": n,
                    "message": f"density saturation ({density_rate*100:.1f}% fancy words): '{w}' x{n} — vary toward plainer diction",
                })

    # --- stylometrics ---
    style = _run_style(Path(path)) if path not in ("<text>",) else {}
    style_findings = style.get("findings", [])
    for f in style_findings:
        spans.append({
            "line": f.get("line", 0), "type": f"style:{f.get('type')}",
            "severity": f.get("severity", "minor"),
            "sev_score": 3 if f.get("severity") == "high" else 1,
            "label": f"style·{f.get('type')}", "text": f.get("excerpt", ""),
            "replace_with": "", "message": f.get("message", ""),
        })

    tic_density = round(min(100.0, tic_weighted / words * 1000 * 8), 1)
    composite = style.get("composite_human_likeness")

    spans.sort(key=lambda s: (s["line"] if s["line"] else 10**9, -s["sev_score"]))
    by_type = {}
    for s in spans:
        by_type[s["type"]] = by_type.get(s["type"], 0) + 1

    return {
        "file": path,
        "words": words,
        "composite_human_likeness": composite,
        "tic_density": tic_density,
        "tic_flags": tic_flags,
        "n_spans": len(spans),
        "by_type": by_type,
        "spans": spans,
        "advisories": style.get("advisories", []),
        "density_words": density_words,
    }


def audit_file(path: str, tiers_on) -> dict:
    text = Path(path).read_text(encoding="utf-8", errors="ignore")
    return audit_text(text, path, tiers_on)


def _report(res: dict) -> None:
    c = res["composite_human_likeness"]
    print(f"\n{res['file']}")
    print(f"  human-likeness composite: {c if c is not None else 'n/a'}/100   "
          f"AI-tic density: {res['tic_density']}/100   spans: {res['n_spans']}")
    if res["by_type"]:
        print("  " + "  ".join(f"{k}:{v}" for k, v in sorted(res["by_type"].items())))
    for s in res["spans"][:60]:
        loc = f"L{s['line']}" if s["line"] else "doc"
        print(f"    [{s['severity']:<5} {loc:>5}] {s['message']}")
    if res["n_spans"] > 60:
        print(f"    … +{res['n_spans']-60} more")
    for a in res["advisories"]:
        print(f"    [advisory] {a.get('message','')}")
    if not res["spans"] and not res["advisories"]:
        print("    (clean — no AI-prose tells)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--tier", default="always_flag,cluster,density",
                    help="diction tiers to apply (comma-sep): always_flag,cluster,density")
    a = ap.parse_args()
    tiers_on = tuple(t.strip() for t in a.tier.split(",") if t.strip())
    allres = {}
    worst = 0
    for f in a.files:
        res = audit_file(f, tiers_on)
        allres[f] = res
        if res["n_spans"]:
            worst = 1
        if not a.json:
            _report(res)
    if a.json:
        print(json.dumps(allres, indent=2))
    # exit 1 if any tells found (lets it gate CI/hooks softly); never hard-fail on errors
    sys.exit(worst)


if __name__ == "__main__":
    main()
