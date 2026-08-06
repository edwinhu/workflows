#!/usr/bin/env -S uv run python3
"""Constraint: progressive-expansion-hierarchy — writing must flow PRECIS → OUTLINE → outlines/ → drafts/."""
import sys
from pathlib import Path

CONSTRAINT = "progressive-expansion-hierarchy"
APPLIES_TO = ["writing", "writing-setup", "writing-outline", "writing-draft",
               "writing-validate", "writing-verify", "writing-revise",
               "writing-precis-reviewer", "writing-outline-reviewer"]
SEVERITY = "hard"


def _find_planning_dir(cwd):
    candidate = cwd / ".planning"
    if candidate.is_dir():
        return candidate
    return None


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    planning = _find_planning_dir(cwd)
    if planning is None:
        return violations

    precis_path = planning / "PRECIS.md"
    outline_path = planning / "OUTLINE.md"
    review_path = planning / "REVIEW.md"
    outlines_dir = cwd / "outlines"
    drafts_dir = cwd / "drafts"
    revisions_dir = cwd / "revisions"

    has_precis = precis_path.exists()
    has_outline = outline_path.exists()
    has_review = review_path.exists()
    has_outlines = outlines_dir.is_dir() and any(outlines_dir.glob("*.md"))
    has_drafts = drafts_dir.is_dir() and any(drafts_dir.glob("*.md"))
    has_revisions = revisions_dir.is_dir() and any(revisions_dir.glob("*.md"))

    # Iron Law 1: NO OUTLINE WITHOUT PRECIS
    if has_outline and not has_precis:
        violations.append(
            f".planning/OUTLINE.md exists but .planning/PRECIS.md does not — "
            "NO OUTLINE WITHOUT PRECIS: create PRECIS.md first"
        )

    # Iron Law 2: NO DRAFT WITHOUT OUTLINE
    if has_outlines and not has_outline:
        violations.append(
            f"outlines/ contains files but .planning/OUTLINE.md does not exist — "
            "NO SECTION OUTLINE WITHOUT MASTER OUTLINE"
        )

    if has_drafts and not has_outlines:
        violations.append(
            f"drafts/ contains files but outlines/ is empty or missing — "
            "NO DRAFT WITHOUT OUTLINE: every draft section needs a matching outline file"
        )

    # Iron Law 3: NO REVISION WITHOUT REVIEW.md
    if has_revisions and not has_review:
        violations.append(
            f"revisions/ contains files but .planning/REVIEW.md does not exist — "
            "NO REVISION WITHOUT REVIEW.md: run /writing-verify first"
        )

    # Check each draft has a matching outline file
    if has_drafts and has_outlines:
        draft_files = {p.name for p in drafts_dir.glob("*.md")}
        outline_files = {p.name for p in outlines_dir.glob("*.md")}
        for draft_name in draft_files:
            if draft_name not in outline_files:
                violations.append(
                    f"drafts/{draft_name} has no matching outlines/{draft_name} — "
                    "every draft section must have a co-located outline"
                )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
