from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PRECIS_GUARD = ROOT / "hooks" / "writing-precis-guard.ts"
OUTLINE_GUARD = ROOT / "hooks" / "writing-outline-executable-guard.ts"
PROBE = ROOT / "scripts" / "writing" / "writing_gate_probe.py"
SETUP_SKILL = ROOT / "skills" / "writing-setup" / "SKILL.md"

PLAN = """# Test

## Writing Intent
- **Thesis**: T.
- **Audience**: A.
- **Purpose**: P.
- **Hook**: H.
- **Scope**: S.
- **Domain**: general

## Claims
- **CLAIM-01**: C.

## Counterarguments
- O → response.

## Document Structure
### Part I
The argument.

## Claim → Section Map
| Claim | Section |
|---|---|
| CLAIM-01 | Part I |

## Source Plan
- **Bibliography**: references/sources.bib
- **Notebook**: none
- **Notebook URL**: none
- **Key Sources**: source2024

## Section Outputs
| Section | Outline | Draft | Depends On |
|---|---|---|---|
| Part I | outlines/Part I.md | drafts/Part I (Draft).md | - |

## Review Surfaces
- Whole document.
"""


def run(command: list[str], *, payload: dict | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        input=json.dumps(payload) if payload is not None else None,
        capture_output=True,
        text=True,
        check=False,
    )


def make_project(root: Path, *, malformed: bool = False) -> Path:
    planning = root / ".planning"
    state = planning / ".state"
    state.mkdir(parents=True)
    (root / "outlines").mkdir()
    (root / "drafts").mkdir()
    (root / "references").mkdir()
    (root / "references" / "sources.bib").write_text("@article{source2024, title={Source}}\n")
    plan = PLAN.replace("## Review Surfaces", "## Review Surface") if malformed else PLAN
    plan_path = planning / "peaceful-article.md"
    plan_path.write_text(plan)
    plan_hash = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    (state / "review.json").write_text(
        json.dumps(
            {
                "workflow": "writing",
                "plan_file": plan_path.name,
                "plan_hash": plan_hash,
                "approved_session_id": "approval",
                "approved_at": "2026-07-31T10:00:00.000Z",
                "status": "APPROVED",
                "reviewer_session_id": "reviewer",
                "reviewed_at": "2026-07-31T10:01:00.000Z",
            }
        )
    )
    (root / "outlines" / "Part I.md").write_text(
        f"---\nimplements: [CLAIM-01]\nplan_hash: {plan_hash}\n---\n- Point [@source2024]\n- Evidence\n- Bridge\n"
    )
    (root / "drafts" / "Part I (Draft).md").write_text(
        f"---\nimplements: [CLAIM-01]\nplan_hash: {plan_hash}\n---\nCLAIM-01 is supported [@source2024].\n"
    )
    return root


def decision(stdout: str) -> tuple[str, str]:
    parsed = json.loads(stdout)
    hook = parsed.get("hookSpecificOutput", {})
    return hook.get("permissionDecision", parsed.get("decision", "")), hook.get(
        "permissionDecisionReason", parsed.get("reason", "")
    )


def test_setup_template_defines_every_mapped_section() -> None:
    skill = SETUP_SKILL.read_text()
    assert "### Part II. [Name]" in skill
    assert "| CLAIM-02 | Part II. [Name] |" in skill
    assert "| Part II. [Name] | outlines/Part II. [Name].md | drafts/Part II. [Name] (Draft).md | Part I. [Name] |" in skill
    assert "| Conclusion | outlines/Conclusion.md | drafts/Conclusion (Draft).md | Part II. [Name] |" in skill


def test_outline_guard_cli_accepts_authenticated_plan(tmp_path: Path) -> None:
    make_project(tmp_path)
    result = run(["bun", str(OUTLINE_GUARD), str(tmp_path)])
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Writing PLAN executable" in result.stdout


def test_outline_guard_cli_rejects_malformed_canonical_plan(tmp_path: Path) -> None:
    make_project(tmp_path, malformed=True)
    result = run(["bun", str(OUTLINE_GUARD), str(tmp_path)])
    assert result.returncode == 1
    assert "not executable" in result.stdout
    assert "Review Surfaces" in result.stdout


def test_outline_guard_blocks_retired_outline_and_review_marker(tmp_path: Path) -> None:
    make_project(tmp_path)
    for name in ("OUTLINE.md", "OUTLINE_REVIEWED.md"):
        result = run(
            ["bun", str(OUTLINE_GUARD)],
            payload={
                "tool_name": "Write",
                "cwd": str(tmp_path),
                "tool_input": {"file_path": f".planning/{name}"},
            },
        )
        verdict, reason = decision(result.stdout)
        assert verdict == "deny"
        assert "retired" in reason


def test_outline_guard_blocks_domain_outline_when_plan_is_invalid(tmp_path: Path) -> None:
    make_project(tmp_path, malformed=True)
    result = run(
        ["bun", str(OUTLINE_GUARD)],
        payload={
            "tool_name": "Edit",
            "cwd": str(tmp_path),
            "tool_input": {"file_path": "outlines/Part I.md"},
        },
    )
    verdict, reason = decision(result.stdout)
    assert verdict == "deny"
    assert "Review Surfaces" in reason
    assert "LLM" in reason


def test_outline_guard_allows_repair_after_plan_replacement(tmp_path: Path) -> None:
    make_project(tmp_path)
    prior_path = tmp_path / ".planning" / "peaceful-article.md"
    plan_path = tmp_path / ".planning" / "replacement-article.md"
    replacement = prior_path.read_text().replace("- **Thesis**: T.", "- **Thesis**: Replacement thesis.")
    plan_path.write_text(replacement)
    receipt_path = tmp_path / ".planning" / ".state" / "review.json"
    receipt = json.loads(receipt_path.read_text())
    receipt["plan_file"] = plan_path.name
    receipt["plan_hash"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    receipt["approved_session_id"] = "replacement-approval"
    receipt["approved_at"] = "2026-07-31T10:02:00.000Z"
    receipt["reviewer_session_id"] = "replacement-reviewer"
    receipt["reviewed_at"] = "2026-07-31T10:03:00.000Z"
    receipt_path.write_text(json.dumps(receipt))

    result = run(
        ["bun", str(OUTLINE_GUARD)],
        payload={
            "tool_name": "Edit",
            "cwd": str(tmp_path),
            "tool_input": {"file_path": "outlines/Part I.md"},
        },
    )
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_precis_guard_blocks_canonical_retired_write(tmp_path: Path) -> None:
    make_project(tmp_path)
    result = run(
        ["bun", str(PRECIS_GUARD)],
        payload={
            "tool_name": "Write",
            "cwd": str(tmp_path),
            "tool_input": {"file_path": ".planning/PRECIS.md"},
        },
    )
    verdict, reason = decision(result.stdout)
    assert verdict == "deny"
    assert "retired" in reason
    assert "replacement native plan" in reason


def test_precis_guard_gives_legacy_conversion_remedy(tmp_path: Path) -> None:
    planning = tmp_path / ".planning"
    planning.mkdir()
    (planning / "PRECIS.md").write_text("legacy")
    result = run(
        ["bun", str(PRECIS_GUARD)],
        payload={
            "tool_name": "Edit",
            "cwd": str(tmp_path),
            "tool_input": {"file_path": ".planning/PRECIS.md"},
        },
    )
    verdict, reason = decision(result.stdout)
    assert verdict == "deny"
    assert "legacy-only" in reason
    assert "conversion input" in reason


def test_plan_probe_is_hash_bound_and_uses_plan_for_consistency(tmp_path: Path) -> None:
    make_project(tmp_path)
    plan_path = tmp_path / ".planning" / "peaceful-article.md"
    plan_hash = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    result = run(
        [
            sys.executable,
            str(PROBE),
            str(tmp_path / "drafts" / "Part I (Draft).md"),
            "--bib",
            str(tmp_path / "references" / "sources.bib"),
            "--plan",
            str(plan_path),
            "--plan-hash",
            plan_hash,
        ]
    )
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(result.stdout)
    assert payload["pass"] is True
    assert payload["planHash"] == plan_hash
    assert payload["evidence"]["dataProvenance"]["comparedAgainst"] == str(plan_path)
    assert "unmatchedVsPlan" in payload["evidence"]["dataProvenance"]


@pytest.mark.parametrize("artifact", ["draft", "plan", "bib"])
def test_plan_probe_rejects_symlinked_authenticated_artifacts(tmp_path: Path, artifact: str) -> None:
    make_project(tmp_path)
    plan_path = tmp_path / ".planning" / "peaceful-article.md"
    draft_path = tmp_path / "drafts" / "Part I (Draft).md"
    bib_path = tmp_path / "references" / "sources.bib"
    path = {"draft": draft_path, "plan": plan_path, "bib": bib_path}[artifact]
    target = path.with_name(f"{path.stem}-target{path.suffix}")
    target.write_bytes(path.read_bytes())
    path.unlink()
    path.symlink_to(target)
    result = run([
        sys.executable, str(PROBE), str(draft_path), "--bib", str(bib_path),
        "--plan", str(plan_path), "--plan-hash", hashlib.sha256(target.read_bytes()).hexdigest(),
    ])
    assert result.returncode == 1
    assert "planAuthentication" in json.loads(result.stdout)["evidence"]


def test_plan_probe_rejects_bibliography_symlink_target_as_an_alternate_path(tmp_path: Path) -> None:
    make_project(tmp_path)
    plan_path = tmp_path / ".planning" / "peaceful-article.md"
    bibliography = tmp_path / "references" / "sources.bib"
    target = tmp_path / "references" / "target.bib"
    target.write_bytes(bibliography.read_bytes())
    bibliography.unlink()
    bibliography.symlink_to(target)
    result = run([
        sys.executable, str(PROBE), str(tmp_path / "drafts" / "Part I (Draft).md"),
        "--bib", str(target), "--plan", str(plan_path),
        "--plan-hash", hashlib.sha256(plan_path.read_bytes()).hexdigest(),
    ])
    assert result.returncode == 1
    assert "exact receipt-authenticated Source Plan Bibliography" in json.dumps(json.loads(result.stdout))


def test_plan_probe_requires_exact_authenticated_bibliography(tmp_path: Path) -> None:
    make_project(tmp_path)
    plan_path = tmp_path / ".planning" / "peaceful-article.md"
    alternate = tmp_path / "references" / "alternate.bib"
    alternate.write_text("@article{source2024, title={Alternate}}\n")
    result = run([
        sys.executable, str(PROBE), str(tmp_path / "drafts" / "Part I (Draft).md"),
        "--bib", str(alternate), "--plan", str(plan_path),
        "--plan-hash", hashlib.sha256(plan_path.read_bytes()).hexdigest(),
    ])
    assert result.returncode == 1
    assert "exact receipt-authenticated Source Plan Bibliography" in json.dumps(json.loads(result.stdout))


def test_plan_probe_accepts_exact_claimless_implements_list(tmp_path: Path) -> None:
    make_project(tmp_path)
    plan_path = tmp_path / ".planning" / "peaceful-article.md"
    plan = plan_path.read_text().replace(
        "## Document Structure\n### Part I\nThe argument.",
        "## Document Structure\n### Introduction\nOpening.\n\n### Part I\nThe argument.",
    ).replace(
        "| Part I | outlines/Part I.md | drafts/Part I (Draft).md | - |",
        "| Introduction | outlines/Introduction.md | drafts/Introduction (Draft).md | - |\n| Part I | outlines/Part I.md | drafts/Part I (Draft).md | Introduction |",
    )
    plan_path.write_text(plan)
    plan_hash = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    receipt_path = tmp_path / ".planning" / ".state" / "review.json"
    receipt = json.loads(receipt_path.read_text())
    receipt["plan_hash"] = plan_hash
    receipt_path.write_text(json.dumps(receipt))
    (tmp_path / "outlines" / "Introduction.md").write_text(
        f"---\nimplements: []\nplan_hash: {plan_hash}\n---\n- Open\n- Frame\n- Bridge\n"
    )
    draft = tmp_path / "drafts" / "Introduction (Draft).md"
    draft.write_text(f"---\nimplements: []\nplan_hash: {plan_hash}\n---\nOpening prose.\n")
    result = run([sys.executable, str(PROBE), str(draft), "--bib", str(tmp_path / "references" / "sources.bib"), "--plan", str(plan_path), "--plan-hash", plan_hash])
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)["pass"] is True


def test_plan_probe_rejects_unselected_generated_plan(tmp_path: Path) -> None:
    make_project(tmp_path)
    other = tmp_path / ".planning" / "other-plan.md"
    other.write_text(PLAN)
    result = run(
        [
            sys.executable,
            str(PROBE),
            str(tmp_path / "drafts" / "Part I (Draft).md"),
            "--plan",
            str(other),
            "--plan-hash",
            hashlib.sha256(other.read_bytes()).hexdigest(),
        ]
    )
    assert result.returncode == 1
    assert "planAuthentication" in json.loads(result.stdout)["evidence"]


def test_plan_probe_rejects_stale_hash(tmp_path: Path) -> None:
    make_project(tmp_path)
    result = run(
        [
            sys.executable,
            str(PROBE),
            str(tmp_path / "drafts" / "Part I (Draft).md"),
            "--bib",
            str(tmp_path / "references" / "sources.bib"),
            "--plan",
            str(tmp_path / ".planning" / "peaceful-article.md"),
            "--plan-hash",
            "0" * 64,
        ]
    )
    assert result.returncode == 1
    assert "planHashMismatch" in json.loads(result.stdout)["evidence"]


def test_outline_guard_rejects_unselected_and_symlink_targets(tmp_path: Path) -> None:
    make_project(tmp_path)
    unselected = run(
        ["bun", str(OUTLINE_GUARD)],
        payload={
            "tool_name": "Write",
            "cwd": str(tmp_path),
            "tool_input": {"file_path": "outlines/Other.md"},
        },
    )
    verdict, reason = decision(unselected.stdout)
    assert verdict == "deny"
    assert "exact Outline path" in reason

    outline = tmp_path / "outlines" / "Part I.md"
    target = tmp_path / "outlines" / "target.md"
    target.write_bytes(outline.read_bytes())
    outline.unlink()
    outline.symlink_to(target)
    symlinked = run(
        ["bun", str(OUTLINE_GUARD)],
        payload={
            "tool_name": "Edit",
            "cwd": str(tmp_path),
            "tool_input": {"file_path": "outlines/Part I.md"},
        },
    )
    verdict, reason = decision(symlinked.stdout)
    assert verdict == "deny"
    assert "symlink" in reason or "executable" in reason


def test_writing_guards_fail_closed_on_malformed_payload() -> None:
    for guard in (PRECIS_GUARD, OUTLINE_GUARD):
        result = subprocess.run(
            ["bun", str(guard)],
            input="{not-json",
            capture_output=True,
            text=True,
            check=False,
        )
        verdict, reason = decision(result.stdout)
        assert verdict == "deny"
        assert "malformed hook payload" in reason
