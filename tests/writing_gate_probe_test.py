#!/usr/bin/env -S uv run python3
"""Tests for scripts/writing/writing_gate_probe.py — the deterministic floor of the two-tier
gateProbe. Run:  uv run python3 tests/writing_gate_probe_test.py"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "writing"))
import writing_gate_probe as gp  # noqa: E402

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1; print(f"  ok  {name}")
    else:
        _f += 1; print(f"FAIL  {name} {extra}")


def write(d: Path, name: str, body: str) -> Path:
    p = d / name; p.write_text(body); return p


BIB = "@article{smith2019, title={X}}\n@book{jones2020, title={Y}}\n"

with tempfile.TemporaryDirectory() as td:
    d = Path(td)
    bib = write(d, "sources.bib", BIB)
    precis = write(d, "PRECIS.md", "Thesis. Key figure: 42.9% of deals; median ~$1.5B; n=58 petitions.\nCLAIM-01\n")

    # 1. clean draft: resolvable cite, claim present, number matches PRECIS
    clean = write(d, "Clean (Draft).md", "---\nimplements: [CLAIM-01]\n---\nThe rate is 42.9% [@smith2019].\n")
    r = gp.probe(clean, bib, precis)
    ok("clean draft passes floor", r["pass"] is True, str(r["evidence"]))
    ok("clean: no bibUnresolved", "bibUnresolved" not in r["evidence"])
    ok("clean: 42.9% matches PRECIS (no unmatched)", not r["evidence"].get("dataProvenance", {}).get("unmatchedVsSpec"))

    # 2. unresolved cite ⇒ fail + named
    badcite = write(d, "BadCite (Draft).md", "---\nimplements: [CLAIM-01]\n---\nClaim [@ghostref2099].\n")
    r = gp.probe(badcite, bib, precis)
    ok("unresolved [@key] ⇒ pass False", r["pass"] is False)
    ok("unresolved names the key", any("ghostref2099" in e for e in r["evidence"].get("bibUnresolved", [])), str(r["evidence"]))

    # 3. CITE-NEEDED left ⇒ fail
    cn = write(d, "CiteNeeded (Draft).md", "---\nimplements: [CLAIM-01]\n---\nFoo [CITE-NEEDED: the source].\n")
    r = gp.probe(cn, bib, precis)
    ok("CITE-NEEDED ⇒ pass False", r["pass"] is False and r["evidence"].get("citeNeeded"))

    # 4. no claim trace ⇒ fail
    noclaim = write(d, "NoClaim (Draft).md", "Body with a cite [@smith2019] but no claim id.\n")
    r = gp.probe(noclaim, bib, precis)
    ok("no CLAIM-XX ⇒ pass False", r["pass"] is False and r["evidence"].get("claimIdsMissing"))

    # 5. number not in PRECIS ⇒ flagged in dataProvenance (advisory) but pass stays True
    drift = write(d, "Drift (Draft).md", "---\nimplements: [CLAIM-01]\n---\nThe rate is 99.9% [@smith2019].\n")
    r = gp.probe(drift, bib, precis)
    ok("drifting number flagged in dataProvenance", any("99.9%" in u for u in r["evidence"]["dataProvenance"]["unmatchedVsSpec"]))
    ok("dataProvenance is advisory (pass stays True)", r["pass"] is True)
    ok("dataProvenance labeled consistency-only", r["evidence"]["dataProvenance"]["mode"] == "consistency-only")

    # 6. no bib provided ⇒ note, not a hard fail on cites
    r = gp.probe(clean, None, precis)
    ok("no bib ⇒ cites unchecked note, still passes", r["pass"] is True and "bibNote" in r["evidence"])

# 7. legal-prose robustness (the tender-parity A/B defects)
with tempfile.TemporaryDirectory() as td:
    d = Path(td)
    bib = write(d, "sources.bib", BIB)
    precis = write(d, "PRECIS.md", "Median deal ~$1.5B; value-at-stake ~$30.7M; 45% repeat funds.\nCLAIM-01\n")
    # statutory citation must NOT be parsed as a datum; magnitude words must normalize
    legal = write(d, "Legal (Draft).md",
                  "---\nimplements: [CLAIM-01]\n---\n"
                  "Under 15 U.S.C. § 78mm and Rule 14e-1, the median deal is $1.5 billion [@smith2019] "
                  "and value-at-stake $30.7 million, with forty-five percent repeat funds.\n")
    r = gp.probe(legal, bib, precis)
    dp = r["evidence"].get("dataProvenance", {})
    um = dp.get("unmatchedVsSpec", [])
    ok("no statutory phantom (§ 78mm not flagged)", not any("78m" in u for u in um), str(um))
    ok("$1.5 billion matches spec $1.5B (magnitude-word norm)", not any("1.5" in u for u in um), str(um))
    ok("$30.7 million matches spec $30.7M", not any("30.7" in u for u in um), str(um))
    ok("spelled-out blind spot disclosed", "forty-five percent" in dp.get("spelledOutNotChecked", []), str(dp.get("spelledOutNotChecked")))
    ok("note discloses numeric-only + spelled-out gap", "spelled-out" in dp.get("note", "").lower())

# real-repo smoke (skipped if absent)
REAL = Path.home() / "projects" / "tender_offers" / "paper"
d3 = REAL / "drafts" / "Part III. Objections and the Targeted Fix (Draft).md"
if d3.is_file():
    r = gp.probe(d3, REAL / "references" / "sources.bib", REAL / ".planning" / "PRECIS.md")
    ok("[real] Part III floor passes (all [@key] resolve)", r["pass"] is True, str(r["evidence"].get("bibUnresolved")))
    ok("[real] Part III dataProvenance is consistency-only (remote parquet)",
       r["evidence"].get("dataProvenance", {}).get("mode") == "consistency-only")
else:
    print("  -- real tender_offers absent; smoke skipped")

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
