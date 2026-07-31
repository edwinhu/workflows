from __future__ import annotations

import hashlib
import importlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "writing"))

wsi = importlib.import_module("writing_section_index")


PLAN = """# Article

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


def write_project(root: Path, plan: str = PLAN, *, legacy: bool = False) -> Path:
    planning = root / ".planning"
    state = planning / ".state"
    state.mkdir(parents=True)
    (root / "outlines").mkdir()
    (root / "drafts").mkdir()
    (root / "references").mkdir()
    (root / "references" / "sources.bib").write_text("@article{case2024, title={Case}}\n")
    plan_path = planning / "peaceful-article.md"
    plan_path.write_text(plan)
    plan_hash = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    (state / "review.json").write_text(
        json.dumps(
            {
                "workflow": "writing",
                "plan_file": plan_path.name,
                "plan_hash": plan_hash,
                "approved_session_id": "approval-session",
                "approved_at": "2026-07-31T10:00:00.000Z",
                "status": "APPROVED",
                "reviewer_session_id": "review-session",
                "reviewed_at": "2026-07-31T10:01:00.000Z",
            }
        )
    )
    if legacy:
        (planning / "PRECIS.md").write_text("legacy provenance")
        (planning / "OUTLINE.md").write_text("legacy provenance")
    for name, claims in {
        "Introduction": [],
        "Part I. The Gap": ["CLAIM-01"],
        "Part II. The Repair": ["CLAIM-02"],
        "Conclusion": [],
    }.items():
        (root / "outlines" / f"{name}.md").write_text(
            f"---\nimplements: [{', '.join(claims)}]\nplan_hash: {plan_hash}\n---\n- First point [@case2024]\n- Second point\n- Third point\n"
        )
        (root / "drafts" / f"{name} (Draft).md").write_text(
            f"---\nimplements: [{', '.join(claims)}]\nplan_hash: {plan_hash}\n---\n{' '.join(claims)} prose.\n"
        )
    return root


def test_compiles_authenticated_plan_grammar(tmp_path: Path) -> None:
    result = wsi.build_index(write_project(tmp_path))
    assert result.ok, result.violations
    assert result.style == "legal"
    plan_path = tmp_path / ".planning" / "peaceful-article.md"
    assert result.plan_hash == hashlib.sha256(plan_path.read_bytes()).hexdigest()
    assert result.plan_file == ".planning/peaceful-article.md"
    assert result.plan_path == str(plan_path.absolute())
    assert result.outline_path == ""
    assert result.review_status == "APPROVED"
    assert result.precis_path == ""
    assert [section.name for section in result.sections] == [
        "Introduction",
        "Part I. The Gap",
        "Part II. The Repair",
        "Conclusion",
    ]
    assert result.sections[2].dependencies == ["Part I. The Gap"]
    assert result.sections[2].primary_claims == ["CLAIM-02"]
    assert result.sections[2].claim_ok is True
    assert all(section.granular for section in result.sections)


def test_canonical_legacy_files_are_provenance_not_inputs(tmp_path: Path) -> None:
    result = wsi.build_index(write_project(tmp_path, legacy=True))
    assert result.ok
    assert result.layout == "canonical-with-legacy-provenance"
    assert {Path(path).name for path in result.legacy_paths} == {"PRECIS.md", "OUTLINE.md"}
    assert result.style == "legal"


def test_legacy_only_requires_conversion(tmp_path: Path) -> None:
    planning = tmp_path / ".planning"
    planning.mkdir()
    (planning / "PRECIS.md").write_text("legacy")
    (planning / "OUTLINE.md").write_text("legacy")
    result = wsi.build_index(tmp_path)
    assert not result.ok
    assert result.layout == "legacy-only"
    assert result.conversion_required is True
    assert "conversion input only" in result.violations[0]


@pytest.mark.parametrize(
    ("mutator", "message"),
    [
        (lambda text: text.replace("## Counterarguments", "## Objections"), "exactly these eight sections"),
        (lambda text: text.replace("- **CLAIM-02**", "- **CLAIM-01**"), "duplicate identifiers"),
        (lambda text: text.replace("| CLAIM-02 | Part II. The Repair |", "| CLAIM-02 | Missing Part |"), "unknown sections"),
        (lambda text: text.replace("| Part I. The Gap | outlines/Part I. The Gap.md | drafts/Part I. The Gap (Draft).md | Introduction |", "| Part I. The Gap | outlines/Part I. The Gap.md | drafts/Part I. The Gap (Draft).md | Conclusion |"), "must precede"),
        (lambda text: text.replace("references/sources.bib", "../sources.bib"), "traversal-free"),
        (lambda text: text.replace("| Claim | Section |", "| Claim | Primary home |"), "exact `claim` and `section` columns"),
        (lambda text: text.replace("| Claim | Section |", "| Claim | Section"), "exact `claim` and `section` columns"),
        (lambda text: text.replace(
            "| Introduction | outlines/Introduction.md | drafts/Introduction (Draft).md | - |\n| Part I. The Gap | outlines/Part I. The Gap.md | drafts/Part I. The Gap (Draft).md | Introduction |",
            "| Part I. The Gap | outlines/Part I. The Gap.md | drafts/Part I. The Gap (Draft).md | Introduction |\n| Introduction | outlines/Introduction.md | drafts/Introduction (Draft).md | - |",
        ), "same order as document structure"),
        (lambda text: text.replace("## Claims", "## Extra\nextra\n\n## Claims"), "exactly these eight sections"),
        (lambda text: text.replace("## Claims\n", "## Claims\n- CLAIM-1: bad\n"), "noncanonical identifiers"),
        (lambda text: text.replace("- **CLAIM-01**: The current rule creates a predictable gap.\n- **CLAIM-02**: A narrower replacement closes that gap.", "The prose mentions CLAIM-01 and CLAIM-02 but defines neither."), "must define at least one stable claim"),
    ],
)
def test_malformed_plan_fails_closed(tmp_path: Path, mutator, message: str) -> None:
    result = wsi.build_index(write_project(tmp_path, mutator(PLAN)))
    assert not result.ok
    assert message.lower() in " ".join(result.violations).lower()


def test_hash_mismatch_fails_before_grammar(tmp_path: Path) -> None:
    write_project(tmp_path)
    (tmp_path / ".planning" / "peaceful-article.md").write_text(PLAN + "\nchanged\n")
    result = wsi.build_index(tmp_path)
    assert not result.ok
    assert result.sections == []
    assert "hash does not match" in result.violations[0]


def test_frontmatter_requires_a_standalone_closing_delimiter(tmp_path: Path) -> None:
    write_project(tmp_path)
    draft = tmp_path / "drafts" / "Part I. The Gap (Draft).md"
    draft.write_text(draft.read_text().replace("\n---\nCLAIM", "\n---attacker\nCLAIM"))
    result = wsi.build_index(tmp_path)
    section = next(section for section in result.sections if section.name == "Part I. The Gap")
    assert section.draft_current is False
    assert any("unterminated YAML frontmatter" in issue for issue in section.draft_issues)


def test_existing_draft_must_implement_mapped_claim(tmp_path: Path) -> None:
    write_project(tmp_path)
    draft = tmp_path / "drafts" / "Part II. The Repair (Draft).md"
    plan_hash = hashlib.sha256((tmp_path / ".planning" / "peaceful-article.md").read_bytes()).hexdigest()
    draft.write_text(
        f"---\nimplements: [CLAIM-01]\nplan_hash: {plan_hash}\n---\nwrong claim\n"
    )
    result = wsi.build_index(tmp_path)
    assert result.ok
    section = next(section for section in result.sections if section.name == "Part II. The Repair")
    assert section.draft_current is False
    assert any("CLAIM-02" in issue and "implements" in issue for issue in section.draft_issues)


def test_existing_artifacts_must_match_current_plan_hash(tmp_path: Path) -> None:
    write_project(tmp_path)
    outline = tmp_path / "outlines" / "Part I. The Gap.md"
    outline.write_text(
        f"---\nimplements: [CLAIM-01]\nplan_hash: {'f' * 64}\n---\n- One\n- Two\n- Three\n"
    )
    result = wsi.build_index(tmp_path)
    assert result.ok
    section = next(section for section in result.sections if section.name == "Part I. The Gap")
    assert section.outline_current is False
    assert any("outline is bound to stale plan hash" in issue for issue in section.outline_issues)


@pytest.mark.parametrize("separator", ["| : | : |", "| - | -- |", "| --- | : |"])
def test_malformed_table_separator_fails_closed(tmp_path: Path, separator: str) -> None:
    malformed = PLAN.replace("|---|---|", separator, 1)
    result = wsi.build_index(write_project(tmp_path, malformed))
    assert not result.ok
    assert "separator row is malformed" in " ".join(result.violations)


def test_malformed_table_row_width_fails_closed(tmp_path: Path) -> None:
    malformed = PLAN.replace(
        "| CLAIM-02 | Part II. The Repair |",
        "| CLAIM-02 | Part II. The Repair | unexpected |",
    )
    result = wsi.build_index(write_project(tmp_path, malformed))
    assert not result.ok
    assert "wrong number of cells" in " ".join(result.violations)


def test_artifact_implements_must_equal_mapping_including_empty(tmp_path: Path) -> None:
    write_project(tmp_path)
    plan_hash = hashlib.sha256(
        (tmp_path / ".planning" / "peaceful-article.md").read_bytes()
    ).hexdigest()
    (tmp_path / "outlines" / "Introduction.md").write_text(
        f"---\nimplements: [CLAIM-01]\nplan_hash: {plan_hash}\n---\n- One\n- Two\n- Three\n"
    )
    result = wsi.build_index(tmp_path)
    section = next(section for section in result.sections if section.name == "Introduction")
    assert section.outline_current is False
    assert any("must equal mapped claims exactly: []" in issue for issue in section.outline_issues)


def test_generated_plan_argument_must_match_receipt_selected_path(tmp_path: Path) -> None:
    write_project(tmp_path)
    other = tmp_path / ".planning" / "other-plan.md"
    other.write_text(PLAN)
    result = wsi.build_index(other)
    assert not result.ok
    assert "does not match review.json plan_file" in result.violations[0]


def test_duplicate_receipt_keys_fail_before_json_collapse(tmp_path: Path) -> None:
    write_project(tmp_path)
    receipt_path = tmp_path / ".planning" / ".state" / "review.json"
    receipt = receipt_path.read_text()
    receipt_path.write_text(receipt.replace('"workflow":', '"workflow": "writing", "workflow":', 1))
    result = wsi.build_index(tmp_path)
    assert not result.ok
    assert "malformed" in " ".join(result.violations).lower()


def test_fixed_plan_name_is_never_modern_authority(tmp_path: Path) -> None:
    write_project(tmp_path)
    receipt_path = tmp_path / ".planning" / ".state" / "review.json"
    receipt = json.loads(receipt_path.read_text())
    receipt["plan_file"] = "PLAN.md"
    receipt_path.write_text(json.dumps(receipt))
    (tmp_path / ".planning" / "PLAN.md").write_text(PLAN)
    result = wsi.build_index(tmp_path)
    assert not result.ok
    assert "cannot be PLAN.md" in " ".join(result.violations)


def test_duplicate_labeled_values_fail_closed(tmp_path: Path) -> None:
    malformed = PLAN.replace("- **Domain**: legal", "- **Domain**: legal\n- **Domain**: general").replace(
        "- **Key Sources**: case2024; article2025",
        "- **Key Sources**: case2024; article2025\n- **Bibliography**: references/other.bib",
    )
    result = wsi.build_index(write_project(tmp_path, malformed))
    assert not result.ok
    violations = " ".join(result.violations)
    assert "Writing Intent contains duplicate `Domain:`" in violations
    assert "Source Plan contains duplicate `Bibliography:`" in violations


def test_bibliography_symlink_cannot_escape_project(tmp_path: Path) -> None:
    write_project(tmp_path)
    outside = tmp_path.parent / "outside-sources.bib"
    outside.write_text("@article{outside,title={Outside}}\n")
    bibliography = tmp_path / "references" / "sources.bib"
    bibliography.unlink()
    bibliography.symlink_to(outside)
    result = wsi.build_index(tmp_path)
    assert not result.ok
    assert "project-contained `Bibliography:`" in " ".join(result.violations)


def test_receipt_and_plan_symlinks_are_rejected(tmp_path: Path) -> None:
    write_project(tmp_path)
    receipt = tmp_path / ".planning" / ".state" / "review.json"
    receipt_target = tmp_path / "receipt-target.json"
    receipt_target.write_bytes(receipt.read_bytes())
    receipt.unlink()
    receipt.symlink_to(receipt_target)
    assert not wsi.build_index(tmp_path).ok

    receipt.unlink()
    receipt.write_bytes(receipt_target.read_bytes())
    plan = tmp_path / ".planning" / "peaceful-article.md"
    plan_target = tmp_path / "plan-target.md"
    plan_target.write_bytes(plan.read_bytes())
    plan.unlink()
    plan.symlink_to(plan_target)
    assert not wsi.build_index(tmp_path).ok
