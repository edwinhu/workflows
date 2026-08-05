#!/usr/bin/env -S uv run --with lxml,pyyaml python3
"""de-ai-revise AUDIT — thin wrapper over `scripts/prose-audit.py --profile de-ai`.

THE SCORERS MOVED; THE OUTPUT DID NOT. Every scorer this script used to own — the corpus-gated
scored AI-tics, the tiered diction table, the British-spelling locale check, the stylometric
composite, and the footnote masking that keeps all of them out of citations — now lives in
`scripts/prose-audit.py`, the single deterministic prose audit for the whole plugin. That
consolidation is what makes it possible to hand ONE span list to every reviewer as evidence
instead of three reviewers each assembling their own subset; see
`docs/DESIGN-prose-constraint-architecture.md`.

WHAT DID NOT CHANGE — deliberately — is the JSON this emits. `skills/de-ai-revise/SKILL.md`
consumes `spans[]` with `type`/`sev_score`/`message`/`replace_with`, plus
`composite_human_likeness`, `tic_density`, `by_type`, `advisories`, `density_words` and
`z_report`; `tests/test_de_ai_audit.py` and `tests/test_de_ai_footnote_masking.py` assert on those
exact keys and import this module by path. The de-ai profile reproduces that shape byte for byte,
and this file re-exports the module-level names (`audit_text`, `audit_file`, `mask_footnotes`,
`BRITISH`, …) that those importers reach for.

Use `prose-audit.py` directly for anything new. This entry point exists for the de-ai REWRITE view
— a worklist of spans with plain replacements — which is a different shape from the audit's
severity-ranked, id-bearing span list, not a subset of it.

Usage (unchanged):
  de_ai_audit.py draft.md                 # human-readable report
  de_ai_audit.py --json draft.md ...      # machine output (review/revise consume this)
  de_ai_audit.py --tier always_flag x.md  # restrict diction to a tier
  de_ai_audit.py --keep-footnotes x.md    # do NOT mask footnotes before scoring
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

_PROSE_AUDIT = Path(__file__).resolve().parents[3] / "scripts" / "prose-audit.py"

# prose-audit.py is hyphenated, so it can only be loaded by path — the same importlib dance the
# constraint loaders already use for the wikipedia tables.
_spec = importlib.util.spec_from_file_location("prose_audit", _PROSE_AUDIT)
_pa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pa)

# ── Re-exports. Existing importers of this module must keep working unchanged. ──
audit_text = _pa.de_ai_audit_text
audit_file = _pa.de_ai_audit_file
mask_footnotes = _pa.mask_footnotes
_blank = _pa._blank
_INLINE_FN = _pa._INLINE_FN
_REF_FN_DEF = _pa._REF_FN_DEF
BRITISH = _pa.BRITISH
_BRITISH_RX = _pa._BRITISH_RX
_load_tics = _pa._load_tics
_load_diction = _pa.load_diction
_word_rx = _pa._word_rx
_paragraphs = _pa._de_ai_paragraphs
_report = _pa.de_ai_report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--tier", default="always_flag,cluster,density",
                    help="diction tiers to apply (comma-sep): always_flag,cluster,density")
    ap.add_argument("--keep-footnotes", action="store_true",
                    help="do NOT mask footnotes before scoring (default: mask ^[...] and [^id]: — "
                         "footnotes/citations are off-limits to a de-AI rewrite)")
    a = ap.parse_args()
    tiers_on = tuple(t.strip() for t in a.tier.split(",") if t.strip())
    allres = {}
    worst = 0
    for f in a.files:
        res = audit_file(f, tiers_on, mask_fn=not a.keep_footnotes)
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
