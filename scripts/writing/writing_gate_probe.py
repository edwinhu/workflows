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
# numbers that look like reported statistics: 42.9%, $1.5B, n=58, 1,477.
# The trailing (?![A-Za-z]) stops a number being clipped out of an alphanumeric LEGAL token
# (e.g. "§ 78mm" → no longer yields a phantom "78m"; "251(h)" → "251" only, never flagged
# because it isn't a rich stat). See _looks_legal for the citation-context guard.
_STAT = re.compile(r"(?<![\w.])(?:\$?\d[\d,]*(?:\.\d+)?\s*(?:%|billion|million|thousand|bn|mn|B|M)?(?![A-Za-z])|n\s*=\s*\d[\d,]*)", re.I)
# a statutory/citation context immediately before a number → it is a legal cite, not a datum
_LEGAL_CTX = re.compile(r"(§|U\.?S\.?C\.?|C\.?F\.?R\.?|Rule|DGCL|No\.|art\.|§§)\s*$", re.I)
# spelled-out quantities legal prose uses ("forty-five percent", "fifty-eight petitions"); the
# numeric _STAT is structurally blind to these — we DISCLOSE that rather than silently miss them.
_SPELLED = re.compile(r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)[\w-]*\s+(percent|petitions?|deals?|days?|cases?|funds?)\b", re.I)


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
    s = re.sub(r"[\s,]", "", s).lower().rstrip(".")
    # equate magnitude words with their letter suffix so "$1.5billion" == "$1.5B" == "$1.5bn"
    for long, short in (("billion", "b"), ("million", "m"), ("thousand", "k"), ("bn", "b"), ("mn", "m")):
        s = s.replace(long, short)
    return s


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
        rich = []
        for m in _STAT.finditer(text):
            tok = m.group(0)
            # only flag "rich" stats (a % / $ / n= / B/M magnitude) — bare footnote numbers are noise
            if not re.search(r"[%$]|n\s*=|B\b|M\b", tok, re.I):
                continue
            # skip statutory/citation numbers ("§ 78mm", "Rule 14e-1", "17 C.F.R. § 240") — not data
            if _LEGAL_CTX.search(text[max(0, m.start() - 12):m.start()]):
                continue
            rich.append((tok, text.count("\n", 0, m.start()) + 1))
        unmatched = [f"{tok} @ {draft_path.name}:{ln}" for tok, ln in rich if _norm_num(tok) not in spec_nums]
        spelled = sorted({s.group(0) for s in _SPELLED.finditer(text)})
        evidence["dataProvenance"] = {
            "mode": "consistency-only",  # NOT true number→cell provenance (no local dataset)
            "unmatchedVsSpec": unmatched,
            # BLIND-SPOT DISCLOSURE: the numeric scan cannot see spelled-out quantities legal prose
            # uses; list them so a clean dataProvenance never implies they were checked.
            "spelledOutNotChecked": spelled,
            "note": "consistency vs PRECIS/OUTLINE only, NUMERIC ONLY — does NOT verify against the "
                    "dataset, and does NOT check spelled-out quantities (see spelledOutNotChecked). "
                    "A remote/absent dataset means these numbers are unverifiable locally.",
        }

    floor_fail = bool(evidence.get("bibUnresolved") or evidence.get("citeNeeded") or evidence.get("claimIdsMissing"))
    # SCOPE (canonical gateProbe contract): a deterministic floor must DISCLOSE its boundary —
    # a clean pass must never imply coverage it doesn't have. `checked` is what a green pass
    # actually verifies; `notChecked` is what it CANNOT and is deferred to the semantic authority
    # (writing-review + source-verify) — so necessary-not-sufficient says WHERE the line is.
    scope = {
        "checked": [
            "bib-resolution ([@key] → sources.bib)" if bib_path and bib_path.is_file() else "bib-resolution (SKIPPED — no bib provided)",
            "cite-needed-markers",
            "claim-id-trace",
        ] + (["numeric-consistency-vs-PRECIS/OUTLINE (NOT dataset provenance)"] if spec_text else []),
        "notChecked": [
            "quote-in-source fidelity (→ source-verify)",
            "claim-actually-supported-by-source (→ writing-review/source-verify)",
            "coverage / prose-quality / transitions / thesis (→ writing-review)",
            "spelled-out quantities (numeric scan is digit-only)",
            "dataset provenance (number→cell; dataset is remote/absent)",
        ],
    }
    return {
        "section": draft_path.stem,
        "pass": not floor_fail,                # necessary-not-sufficient: the semantic authority decides sufficiency
        "artifactsPresent": draft_path.is_file(),
        "evidence": evidence,
        "scope": scope,
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
