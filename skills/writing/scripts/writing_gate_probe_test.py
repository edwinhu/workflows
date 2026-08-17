#!/usr/bin/env -S uv run python3
"""Tests for scripts/writing/writing_gate_probe.py — the deterministic floor of the two-tier gateProbe.

THIS SUITE HAD BEEN QUARANTINED as "probes a writing gate whose response shape changed". It had, in
two ways that both mattered:

  1. `probe()` now takes the authenticated PLAN, not PRECIS, plus an expected plan hash, and refuses
     to evaluate anything without a receipt-authenticated project. The old tests passed bare temp
     files, so every call returned `{"pass": False}` with a `planAuthentication` list and no
     `dataProvenance` key — the KeyError that made this suite look broken was the guard working.
  2. Numeric consistency is checked against the plan (`unmatchedVsPlan`), not PRECIS
     (`unmatchedVsSpec`). PRECIS is legacy conversion-only provenance now.

Quarantining it meant the deterministic floor of the writing gate went unchecked for as long as the
entry stood. Rewritten against the real contract rather than deleted.

Run:  uv run python3 tests/writing_gate_probe_test.py
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import writing_gate_probe as gp  # noqa: E402

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1; print(f"  ok  {name}")
    else:
        _f += 1; print(f"FAIL  {name} {extra}")


PLAN = """# Article

## Writing Intent
- **Thesis**: The rule should change.
- **Audience**: Legal academics.
- **Purpose**: Establish the case for reform.
- **Hook**: The existing rule fails in a recurring case.
- **Scope**: Federal doctrine; state law is excluded.
- **Domain**: legal

## Claims
- **CLAIM-01**: The current rule creates a predictable gap; the rate is 42.9% across 58 petitions worth a median $1.5B.
- **CLAIM-02**: A narrower replacement closes that gap.

## Counterarguments
- Administrability favors the status quo → Part II answers with a bounded test.

## Document Structure
### Introduction
Frames the problem and previews both claims.

### Part I. The Gap
Establishes CLAIM-01.

### Part II. The Repair
Establishes CLAIM-02 and answers the counterargument.

### Conclusion
States the payoff.

## Claim → Section Map
| Claim | Section |
|---|---|
| CLAIM-01 | Part I. The Gap |
| CLAIM-02 | Part II. The Repair |

## Source Plan
- **Bibliography**: references/sources.bib
- **Notebook**: none
- **Notebook URL**: none
- **Key Sources**: case2024; article2025

## Section Outputs
| Section | Outline | Draft | Depends On |
|---|---|---|---|
| Introduction | outlines/Introduction.md | drafts/Introduction (Draft).md | - |
| Part I. The Gap | outlines/Part I. The Gap.md | drafts/Part I. The Gap (Draft).md | Introduction |
| Part II. The Repair | outlines/Part II. The Repair.md | drafts/Part II. The Repair (Draft).md | Part I. The Gap |
| Conclusion | outlines/Conclusion.md | drafts/Conclusion (Draft).md | Part II. The Repair |

## Review Surfaces
- Whole-plan claim and structure review.
- Citation fidelity and final user review.
"""

BIB = "@article{smith2019, title={X}}\n@book{jones2020, title={Y}}\n"


def project(tmp: Path, body: str, implements: str | None = "CLAIM-01"):
    """`body` is prose; the frontmatter is built here because a draft must BIND the plan hash.

    Each draft carries `implements:` plus the `plan_hash:` it was written against — that binding is
    what stops a draft written for one approved plan from being credited under another. The hash is
    only known after the plan is written, so the frontmatter cannot live in a module-level constant.
    """
    """An APPROVED, receipt-authenticated writing project. Returns (draft, bib, plan, plan_hash)."""
    planning = tmp / ".planning"
    (planning / ".state").mkdir(parents=True)
    (tmp / "outlines").mkdir()
    (tmp / "drafts").mkdir()
    (tmp / "references").mkdir()
    bib = tmp / "references" / "sources.bib"
    bib.write_text(BIB)
    for section in ["Introduction", "Part I. The Gap", "Part II. The Repair", "Conclusion"]:
        (tmp / "outlines" / f"{section}.md").write_text("- Beat one.\n")
    plan = planning / "writing-native.md"
    plan.write_text(PLAN)
    plan_hash = hashlib.sha256(plan.read_bytes()).hexdigest()
    (planning / ".state" / "review.json").write_text(json.dumps({
        "workflow": "writing", "plan_file": plan.name, "plan_hash": plan_hash,
        "approved_session_id": "approval-session", "approved_at": "2026-07-31T10:00:00.000Z",
        "status": "APPROVED", "reviewer_session_id": "review-session",
        "reviewed_at": "2026-07-31T10:01:00.000Z",
    }))
    draft = tmp / "drafts" / "Part I. The Gap (Draft).md"
    front = f"---\nimplements: [{implements}]\nplan_hash: {plan_hash}\n---\n" if implements else ""
    draft.write_text(front + body)
    return draft, bib, plan, plan_hash


CLEAN = "The rate is 42.9% [@smith2019].\n"

# 1. A clean draft clears the floor.
with tempfile.TemporaryDirectory() as td:
    draft, bib, plan, plan_hash = project(Path(td), CLEAN)
    r = gp.probe(draft, bib, plan, plan_hash)
    ok("clean draft passes floor", r["pass"] is True, str(r["evidence"]))
    ok("clean: no bibUnresolved", "bibUnresolved" not in r["evidence"])
    ok("clean: no planAuthentication errors", "planAuthentication" not in r["evidence"],
       str(r["evidence"].get("planAuthentication")))
    ok("clean: 42.9% matches the plan (no unmatched)",
       r["evidence"]["dataProvenance"]["unmatchedVsPlan"] == [],
       str(r["evidence"]["dataProvenance"]["unmatchedVsPlan"]))

# 2. An unresolvable citation key fails and is NAMED — a bare False would not be actionable.
with tempfile.TemporaryDirectory() as td:
    draft, bib, plan, plan_hash = project(Path(td), "Claim [@ghost2099].\n")
    r = gp.probe(draft, bib, plan, plan_hash)
    ok("unresolved [@key] ⇒ pass False", r["pass"] is False)
    ok("unresolved names the key", any("ghost2099" in u for u in r["evidence"].get("bibUnresolved", [])),
       str(r["evidence"]))

# 3. An explicit CITE-NEEDED marker is a floor failure, not a note.
with tempfile.TemporaryDirectory() as td:
    draft, bib, plan, plan_hash = project(Path(td), "Foo [CITE-NEEDED: the source].\n")
    r = gp.probe(draft, bib, plan, plan_hash)
    ok("CITE-NEEDED ⇒ pass False", r["pass"] is False and bool(r["evidence"].get("citeNeeded")), str(r["evidence"]))

# 4. A draft that traces to no claim fails: untraceable prose is what this floor exists to catch.
with tempfile.TemporaryDirectory() as td:
    draft, bib, plan, plan_hash = project(Path(td), "The rate is 42.9% [@smith2019].\n", implements=None)
    r = gp.probe(draft, bib, plan, plan_hash)
    ok("no CLAIM-XX ⇒ pass False", r["pass"] is False, str(r["evidence"]))
    ok("the missing claim trace is named", "claimIdsMissing" in r["evidence"], str(r["evidence"]))

# 5. A claim the plan never authorized fails — scope creep is as much a defect as an omission.
with tempfile.TemporaryDirectory() as td:
    draft, bib, plan, plan_hash = project(Path(td), "Claim [@smith2019].\n", implements="CLAIM-99")
    r = gp.probe(draft, bib, plan, plan_hash)
    ok("a claim absent from the plan ⇒ pass False", r["pass"] is False)
    ok("the unauthorized claim is named", "CLAIM-99" in json.dumps(r["evidence"]), str(r["evidence"]))

# 6. Numeric drift against the plan is reported (consistency-only, and it says so).
with tempfile.TemporaryDirectory() as td:
    draft, bib, plan, plan_hash = project(Path(td), "The rate is 99.9% [@smith2019].\n")
    r = gp.probe(draft, bib, plan, plan_hash)
    dp = r["evidence"]["dataProvenance"]
    ok("drifting number flagged in dataProvenance", any("99.9%" in u for u in dp["unmatchedVsPlan"]), str(dp))
    ok("dataProvenance states its limited scope", dp["mode"] == "consistency-only")

# 7. AUTHENTICATION IS THE FLOOR UNDER THE FLOOR. A wrong plan hash must refuse outright — otherwise
#    every check above would be running against an artifact nobody approved.
with tempfile.TemporaryDirectory() as td:
    draft, bib, plan, plan_hash = project(Path(td), CLEAN)
    r = gp.probe(draft, bib, plan, "0" * 64)
    ok("a mismatched plan hash refuses", r["pass"] is False)
    # Reported under its OWN key, not the generic planAuthentication bucket: "the hash does not match"
    # and "this project has no valid receipt" send you to different places.
    ok("the refusal names the hash mismatch specifically", "planHashMismatch" in r["evidence"], str(r["evidence"]))
    ok("the mismatch shows expected vs observed", "expected" in json.dumps(r["evidence"]["planHashMismatch"]))

# 8. A draft path the receipt never selected cannot be probed under this plan's authority.
with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    draft, bib, plan, plan_hash = project(tmp, CLEAN)
    stray = tmp / "drafts" / "Unlisted (Draft).md"
    stray.write_text(CLEAN)
    r = gp.probe(stray, bib, plan, plan_hash)
    ok("an unselected draft path refuses", r["pass"] is False)
    ok("the refusal says the draft is not receipt-authenticated",
       any("not a receipt-authenticated" in e for e in r["evidence"].get("planAuthentication", [])),
       str(r["evidence"]))

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
