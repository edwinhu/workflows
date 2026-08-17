#!/usr/bin/env -S uv run python3
"""Tests for writing_receipt.py — the adapter that derives the writing workflow's
on-disk approval artifacts from craft's two approvals.

Run directly (NOT under pytest), matching writing_gate_probe_test.py's harness:

    uv run python3 scripts/writing_receipt_test.py

Every refusal path is asserted, plus one accepted round-trip. The round-trip runs
twice: once end-to-end in a throwaway temporary project this suite owns outright,
and once NON-DESTRUCTIVELY against the persistent fixture at <skill>/fixtures/clean/,
where it derives the two approval artifacts from the plan already on disk. It never
deletes or rebuilds that fixture — every other mechanical check is demonstrated
against it, and a suite that wipes it makes those demonstrations unreproducible.
"""
from __future__ import annotations

import shutil
import pathlib
import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import writing_receipt as wr  # noqa: E402
import writing_section_index as wsi  # noqa: E402

SKILL = ROOT.parent
FIXTURE = SKILL / "fixtures" / "clean"

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1
        print(f"  ok  {name}")
    else:
        _f += 1
        print(f"FAIL  {name} {extra}")


def refuses(name, needle, **kwargs):
    """Assert build_receipt refuses, and that the message names the reason."""
    try:
        wr.build_receipt(**kwargs)
    except wr.ReceiptRefusal as error:
        ok(f"refuses: {name}", needle in str(error), f"message was {str(error)!r}")
        return
    ok(f"refuses: {name}", False, "no ReceiptRefusal raised")


PLAN = """# Fixture Article

## Writing Intent
- **Thesis**: The rule should change.
- **Audience**: Legal academics.
- **Purpose**: Establish the case for reform.
- **Hook**: The existing rule fails in a recurring case.
- **Scope**: Federal doctrine; state law is excluded.
- **Domain**: legal

## Claims
- **CLAIM-01**: The current rule creates a predictable gap.
- **CLAIM-02**: A narrower replacement closes that gap.

## Counterarguments
- Administrability favors the status quo, and Part II answers with a bounded test.

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
- **Key Sources**: smith2019; jones2020

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

BIB = "@article{smith2019, title={A Predictable Gap}}\n@book{jones2020, title={A Narrower Rule}}\n"

PLAN_NAME = "writing-fixture-plan.md"
APPROVED_AT = "2026-08-10T12:00:00.000Z"
REVIEWED_AT = "2026-08-10T12:05:00.000Z"
APPROVED_SESSION = "craft-plan-approval-0001"
REVIEWER_SESSION = "craft-plan-lens-review-0001"

SECTIONS = {
    "Introduction": [],
    "Part I. The Gap": ["CLAIM-01"],
    "Part II. The Repair": ["CLAIM-02"],
    "Conclusion": [],
}

OUTLINE_BEATS = (
    "- Beat one, grounded in [@smith2019].\n"
    "- Beat two, contrasting with [@jones2020].\n"
    "- Beat three, stating the payoff for the reader.\n"
)
DRAFT_BODY = (
    "The current rule leaves a gap that recurs across the reported cases [@smith2019].\n"
    "A narrower replacement closes it without new administrative cost [@jones2020].\n"
)


def build_project(root: Path, plan_name: str = PLAN_NAME, plan_body: str = PLAN) -> tuple[Path, str]:
    """Lay down a complete writing project (minus the receipt) and return (plan, hash)."""
    planning = root / ".planning"
    planning.mkdir(parents=True, exist_ok=True)
    for sub in ("outlines", "drafts", "references"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    (root / "references" / "sources.bib").write_text(BIB, encoding="utf-8")
    plan = planning / plan_name
    plan.write_text(plan_body, encoding="utf-8")
    plan_hash = hashlib.sha256(plan.read_bytes()).hexdigest()
    for section, claims in SECTIONS.items():
        front = f"---\nimplements: [{', '.join(claims)}]\nplan_hash: {plan_hash}\n---\n"
        (root / "outlines" / f"{section}.md").write_text(front + OUTLINE_BEATS, encoding="utf-8")
        (root / "drafts" / f"{section} (Draft).md").write_text(front + DRAFT_BODY, encoding="utf-8")
    return plan, plan_hash


BASE = dict(
    domain="legal",
    approved_session=APPROVED_SESSION,
    reviewer_session=REVIEWER_SESSION,
    approved_at=APPROVED_AT,
    reviewed_at=REVIEWED_AT,
)

# ── Refusal paths ────────────────────────────────────────────────────────────
# Each must refuse by NAME rather than emit a receipt writing_section_index.py
# would then reject — a shim that writes an invalid receipt has moved the failure
# somewhere with less context.

with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    plan, plan_hash = build_project(tmp)

    # 1. The retired legacy basename.
    legacy = tmp / ".planning" / "PLAN.md"
    legacy.write_text(PLAN, encoding="utf-8")
    refuses("PLAN.md basename", "PLAN.md", project=tmp, plan=legacy,
            plan_hash=hashlib.sha256(legacy.read_bytes()).hexdigest(), **BASE)

    # 2. A basename the parser's generated-name regex rejects.
    spaced = tmp / ".planning" / "my plan.md"
    spaced.write_text(PLAN, encoding="utf-8")
    refuses("unsafe generated basename", "safe generated", project=tmp, plan=spaced,
            plan_hash=hashlib.sha256(spaced.read_bytes()).hexdigest(), **BASE)

    # 3. A hash that is not lowercase 64-hex.
    refuses("non-64-hex plan hash", "lowercase 64-hex", project=tmp, plan=plan,
            plan_hash="deadbeef", **BASE)
    refuses("uppercase plan hash", "lowercase 64-hex", project=tmp, plan=plan,
            plan_hash=plan_hash.upper(), **BASE)

    # 4. Well-formed hex that is not the plan's actual digest. The parser recomputes
    #    the digest itself, so emitting this would produce a receipt it rejects.
    refuses("plan hash does not match the plan bytes", "does not match the bytes",
            project=tmp, plan=plan, plan_hash="0" * 64, **BASE)

    # 5. One session id cannot stand for two approvals.
    refuses("equal session ids", "must differ", project=tmp, plan=plan, plan_hash=plan_hash,
            **{**BASE, "reviewer_session": APPROVED_SESSION})
    refuses("empty reviewer session", "--reviewer-session must be non-empty",
            project=tmp, plan=plan, plan_hash=plan_hash, **{**BASE, "reviewer_session": "  "})
    refuses("empty approved session", "--approved-session must be non-empty",
            project=tmp, plan=plan, plan_hash=plan_hash, **{**BASE, "approved_session": ""})

    # 6. The plan must be a DIRECT child of <proj>/.planning/.
    nested = tmp / ".planning" / "sub"
    nested.mkdir()
    deep = nested / PLAN_NAME
    deep.write_text(PLAN, encoding="utf-8")
    refuses("plan nested below .planning", "direct child", project=tmp, plan=deep,
            plan_hash=hashlib.sha256(deep.read_bytes()).hexdigest(), **BASE)
    outside = tmp / PLAN_NAME
    outside.write_text(PLAN, encoding="utf-8")
    refuses("plan outside .planning", "direct child", project=tmp, plan=outside,
            plan_hash=hashlib.sha256(outside.read_bytes()).hexdigest(), **BASE)

    # 7. A plan that does not exist at all.
    refuses("missing plan file", "does not resolve", project=tmp,
            plan=tmp / ".planning" / "absent.md", plan_hash=plan_hash, **BASE)

    # 8. Domain must be one of the three styles, and must not contradict the plan's
    #    own `Domain:` — an undetected or wrong style runs the wrong domain's constraints.
    refuses("unknown domain", "--domain must be one of", project=tmp, plan=plan,
            plan_hash=plan_hash, **{**BASE, "domain": "poetry"})
    refuses("domain contradicts the plan", "contradicts the plan", project=tmp, plan=plan,
            plan_hash=plan_hash, **{**BASE, "domain": "econ"})

    # 9. Review must be strictly later than approval, in strict UTC form.
    refuses("review not later than approval", "strictly later", project=tmp, plan=plan,
            plan_hash=plan_hash, **{**BASE, "reviewed_at": APPROVED_AT})
    refuses("review before approval", "strictly later", project=tmp, plan=plan,
            plan_hash=plan_hash, **{**BASE, "reviewed_at": "2026-08-10T11:00:00.000Z"})
    refuses("loose timestamp form", "strict UTC timestamp", project=tmp, plan=plan,
            plan_hash=plan_hash, **{**BASE, "reviewed_at": "2026-08-10T12:05:00Z"})

# 10. A project with no .planning/ at all.
with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    plan, plan_hash = build_project(tmp)
    bare = tmp / "bare"
    bare.mkdir()
    refuses("project without .planning", "no .planning/", project=bare, plan=plan,
            plan_hash=plan_hash, **BASE)
    refuses("project that is not a directory", "not a directory",
            project=tmp / "references" / "sources.bib", plan=plan, plan_hash=plan_hash, **BASE)

# ── The CLI refuses too, with a non-zero exit ────────────────────────────────
with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    plan, plan_hash = build_project(tmp)
    code = wr.main([
        "--project", str(tmp), "--plan", str(plan), "--plan-hash", "0" * 64,
        "--approved-session", APPROVED_SESSION, "--reviewer-session", REVIEWER_SESSION,
        "--domain", "legal",
    ])
    ok("CLI exits non-zero on a refusal", code == 1, f"exit {code}")
    ok("CLI writes no receipt when it refuses",
       not (tmp / ".planning" / ".state" / "review.json").exists())

def assert_receipt(label: str, project: Path, plan_hash: str, style: str) -> None:
    """Assert the two derived artifacts exist and say what the parser requires."""
    receipt_path = project / ".planning" / ".state" / "review.json"
    active_path = project / ".planning" / "ACTIVE_WORKFLOW.md"
    ok(f"{label}: round-trip leaves the receipt in the tree", receipt_path.is_file(), str(receipt_path))
    ok(f"{label}: round-trip leaves ACTIVE_WORKFLOW.md in the tree", active_path.is_file(), str(active_path))

    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    ok(f"{label}: receipt carries exactly the eight required keys",
       set(receipt) == wsi.REVIEW_FIELDS, str(sorted(receipt)))
    ok(f"{label}: receipt authenticates the writing workflow", receipt["workflow"] == "writing")
    ok(f"{label}: receipt status is APPROVED", receipt["status"] == "APPROVED")
    ok(f"{label}: receipt plan_file is the parser's safe generated basename",
       wsi._safe_generated_name(receipt["plan_file"]), receipt["plan_file"])
    ok(f"{label}: receipt plan_hash is craft's plan hash", receipt["plan_hash"] == plan_hash)
    ok(f"{label}: receipt session ids differ",
       receipt["reviewer_session_id"] != receipt["approved_session_id"])
    ok(f"{label}: receipt timestamps are strict UTC",
       wsi._strict_utc(receipt["approved_at"]) and wsi._strict_utc(receipt["reviewed_at"]))
    ok(f"{label}: review is strictly later than approval",
       receipt["reviewed_at"] > receipt["approved_at"])

    active_text = active_path.read_text(encoding="utf-8")
    ok(f"{label}: ACTIVE_WORKFLOW.md scopes check-all to writing",
       "workflow: writing" in active_text, active_text)
    ok(f"{label}: ACTIVE_WORKFLOW.md carries the plan's style",
       f"style: {style}" in active_text, active_text)


# ── Accepted round-trip #1: a temporary project this suite owns outright ─────
# Owning the whole project is what lets this leg assert the strongest claim there
# is — that the vendored parser compiles it with no violation of any kind.
with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    plan, plan_hash = build_project(tmp)
    code = wr.main([
        "--project", str(tmp), "--plan", str(plan), "--plan-hash", plan_hash,
        "--approved-session", APPROVED_SESSION, "--reviewer-session", REVIEWER_SESSION,
        "--domain", "legal", "--approved-at", APPROVED_AT, "--reviewed-at", REVIEWED_AT,
    ])
    ok("temp: accepted round-trip exits 0", code == 0, f"exit {code}")
    assert_receipt("temp", tmp, plan_hash, "legal")

    index = wsi.build_index(tmp)
    ok("temp: parser reports no review.json violation",
       not [v for v in index.violations if "review.json" in v], str(index.violations))
    ok("temp: parser compiles the project cleanly", index.ok is True, str(index.violations))
    ok("temp: parser reports no artifact violations",
       not index.to_dict()["artifactViolations"], str(index.to_dict()["artifactViolations"]))
    ok("temp: parser reads the style from the plan", index.style == "legal", index.style)

# ── Accepted round-trip #2: the PERSISTENT fixture, derived not rebuilt ──────
# fixtures/clean/ is a deliverable — craft's verifier is read-only and cannot
# reproduce a demonstration against a throwaway directory. This leg therefore
# leaves the receipt there, but it DERIVES it from the plan already on disk and
# deletes nothing: every other mechanical check is demonstrated against this same
# fixture, and a suite that wipes it makes those demonstrations unreproducible.

LEGACY = {"PLAN.md", "PRECIS.md", "OUTLINE.md", "ACTIVE_WORKFLOW.md", "PHASE_SUMMARY.md"}


def fixture_plan(project: Path) -> Path:
    """The generated plan already in <fixture>/.planning/, creating one only if absent."""
    planning = project / ".planning"
    candidates = sorted(
        p for p in planning.glob("*.md") if p.is_file() and p.name not in LEGACY
    ) if planning.is_dir() else []
    if not candidates:
        # Nothing to preserve yet — lay the project down rather than fail; still no deletion.
        plan, _ = build_project(project)
        return plan
    for candidate in candidates:
        if candidate.name == PLAN_NAME:
            return candidate
    return candidates[0]

# Run against a COPY, never fixtures/clean itself. This suite is a mechanicalCheck, and a
# readOnly confirming pass runs every cmd verbatim — a check that rewrites the fixture the
# other checks are demonstrated against is a writer on a pass declared read-only, even when
# the bytes it writes are identical.
_CLEAN_COPY = pathlib.Path(tempfile.mkdtemp(prefix="wr-clean-")) / "clean"
shutil.copytree(FIXTURE, _CLEAN_COPY)
plan = fixture_plan(_CLEAN_COPY)
plan_hash = hashlib.sha256(plan.read_bytes()).hexdigest()
style = wr._plan_domain(plan) or "general"
code = wr.main([
    "--project", str(_CLEAN_COPY), "--plan", str(plan), "--plan-hash", plan_hash,
    "--approved-session", APPROVED_SESSION, "--reviewer-session", REVIEWER_SESSION,
    "--domain", style, "--approved-at", APPROVED_AT, "--reviewed-at", REVIEWED_AT,
])
ok("fixtures/clean (copy): accepted round-trip exits 0", code == 0, f"exit {code}")
assert_receipt("fixtures/clean (copy)", _CLEAN_COPY, plan_hash, style)

# Scoped to this shim's own subject: the fixture's prose, drafts and outlines belong
# to other tasks, so this leg asserts the receipt is accepted and the plan authenticates
# — not that somebody else's artifacts are clean.
index = wsi.build_index(FIXTURE)
ok("fixtures/clean: parser reports no review.json violation",
   not [v for v in index.violations if "review.json" in v], str(index.violations))
ok("fixtures/clean: parser authenticates the plan against the receipt",
   index.plan_hash == plan_hash, f"{index.plan_hash!r} != {plan_hash!r}: {index.violations}")

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
