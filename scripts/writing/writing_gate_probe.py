#!/usr/bin/env -S uv run python3
"""
The DETERMINISTIC FLOOR of writing's two-tier gateProbe (DESIGN §4).

Writing's gate is a SEMANTIC judgment (coverage, prose quality, transitions, claim-actually-
supported) and that judgment stays OUTSIDE any runner as the real authority (writing-review +
source-verify). But part of "did this section pass" IS mechanically checkable, and an LLM that
self-reports it can be wrong or gamed (audit G1: writing-draft's fidelityOk *asserts* "@bibkey
exists" without grepping the bib). This script is that mechanical floor, returning
{pass, evidence} with NUMBERED, SPECIFIC evidence — necessary, NOT sufficient.

It is the writing analog of ds/dev's exit-code probe, except:
  - it returns {pass, evidence}, not {exit0} — the gate is judgment, the floor is mechanical;
  - evidence MUST be specific (file:line, the offending key/number) — for a semantic gate the
    payload IS the human's catch-channel (the muni-row-count / hylo-AssertionError lesson);
  - dataProvenance degrades to LABELED prose-vs-PRECIS consistency when the dataset is remote
    (the tender_offers case) — it NEVER claims true number→cell provenance it cannot run.

Checks (all deterministic):
  - bibUnresolved   : [@key] cited in the draft with no entry in sources.bib  (closes G1)
  - citeNeeded      : unresolved [CITE-NEEDED] markers left in the prose
  - claimIdsMissing : the draft carries no implements: / CLAIM-XX trace
  - dataProvenance  : numbers in the draft not found in PRECIS/OUTLINE (mode: consistency-only
                      when no local dataset; labeled so a green check never overstates)
Repetition (bridge_repetition_check.py) and prose-lint (prose-lint.py) are separate Leg-1
scripts the skill already runs; this floor references them rather than duplicating.

pass = no bibUnresolved AND no citeNeeded AND not claimIdsMissing. dataProvenance is advisory
(consistency-only locally) and does NOT flip pass.

CLI:  uv run python3 writing_gate_probe.py <draft.md> --bib <sources.bib> [--precis <PRECIS.md>]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_BIBKEY_DEF = re.compile(r"@\w+\s*\{\s*([^,\s]+)", re.M)        # @article{key,
_CITE_IN_PROSE = re.compile(r"\[@([\w:-]+)")                     # [@key] or [@key, @key2]
_EXTRA_CITES = re.compile(r"@([A-Za-z][\w:-]+)")                # bare @key inside a [@a; @b] group
_CITE_NEEDED = re.compile(r"\[CITE-NEEDED[^\]]*\]", re.I)
_CLAIM = re.compile(r"CLAIM-\d+")
# numbers that look like reported statistics: 42.9%, $1.5B, n=58, 1,477
_STAT = re.compile(r"(?<![\w.])(?:\$?\d[\d,]*(?:\.\d+)?\s*(?:%|B|M|bn|mn)?|n\s*=\s*\d[\d,]*)", re.I)


def _bib_keys(bib_path: Path) -> set[str]:
    if not bib_path or not bib_path.is_file():
        return set()
    return set(_BIBKEY_DEF.findall(bib_path.read_text(encoding="utf-8", errors="ignore")))


def _draft_cites(text: str) -> set[str]:
    keys = set()
    # capture every @key inside bracketed pandoc groups [@a2020; @b2021, p. 3]
    for grp in re.findall(r"\[([^\]]*@[^\]]+)\]", text):
        keys.update(_EXTRA_CITES.findall(grp))
    return keys


def _line_of(text: str, needle: str) -> int:
    idx = text.find(needle)
    return text.count("\n", 0, idx) + 1 if idx >= 0 else 0


def _norm_num(s: str) -> str:
    return re.sub(r"[\s,]", "", s).lower().rstrip(".")


def probe(draft_path: Path, bib_path: Path | None, precis_path: Path | None,
          outline_path: Path | None = None) -> dict:
    text = draft_path.read_text(encoding="utf-8", errors="ignore")
    evidence: dict = {}

    # 1. bibUnresolved (G1)
    bib = _bib_keys(bib_path) if bib_path else set()
    cited = _draft_cites(text)
    if bib_path and bib_path.is_file():
        unresolved = sorted(k for k in cited if k not in bib)
        if unresolved:
            evidence["bibUnresolved"] = [f"@{k} @ {draft_path.name}:{_line_of(text, '@' + k)}" for k in unresolved]
    elif cited:
        evidence["bibNote"] = [f"no bib provided; {len(cited)} [@key] cite(s) unchecked"]

    # 2. citeNeeded
    needed = _CITE_NEEDED.findall(text)
    if needed:
        evidence["citeNeeded"] = [f"{m} @ {draft_path.name}:{_line_of(text, m)}" for m in needed]

    # 3. claimIdsMissing
    claims = sorted(set(_CLAIM.findall(text)))
    if not claims:
        evidence["claimIdsMissing"] = [f"{draft_path.name}: no CLAIM-XX / implements: trace"]

    # 4. dataProvenance (degraded: consistency-only vs PRECIS/OUTLINE when no local dataset)
    spec_text = ""
    for p in (precis_path, outline_path):
        if p and p.is_file():
            spec_text += "\n" + p.read_text(encoding="utf-8", errors="ignore")
    if spec_text:
        spec_nums = {_norm_num(m) for m in _STAT.findall(spec_text)}
        draft_nums = [(m, _line_of(text, m)) for m in _STAT.findall(text)]
        # only flag "rich" stats (a % / $ / n=) to avoid footnote numbers etc.
        rich = [(m, ln) for m, ln in draft_nums if re.search(r"[%$]|n\s*=|B\b|M\b", m, re.I)]
        unmatched = [f"{m} @ {draft_path.name}:{ln}" for m, ln in rich if _norm_num(m) not in spec_nums]
        evidence["dataProvenance"] = {
            "mode": "consistency-only",  # NOT true number→cell provenance (no local dataset)
            "unmatchedVsSpec": unmatched,
            "note": "consistency vs PRECIS/OUTLINE only — does NOT verify against the dataset; "
                    "a remote/absent parquet means these numbers are unverifiable locally.",
        }

    floor_fail = bool(evidence.get("bibUnresolved") or evidence.get("citeNeeded") or evidence.get("claimIdsMissing"))
    return {
        "section": draft_path.stem,
        "pass": not floor_fail,                # necessary-not-sufficient: the semantic authority decides sufficiency
        "evidence": evidence,
        "citesChecked": len(cited),
        "claims": claims,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("draft")
    ap.add_argument("--bib", default="")
    ap.add_argument("--precis", default="")
    ap.add_argument("--outline", default="")
    a = ap.parse_args()
    res = probe(Path(a.draft),
                Path(a.bib) if a.bib else None,
                Path(a.precis) if a.precis else None,
                Path(a.outline) if a.outline else None)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
