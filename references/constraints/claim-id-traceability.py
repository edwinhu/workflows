#!/usr/bin/env python3
"""Constraint: claim-id-traceability — CLAIM-XX IDs must flow through all writing artifacts."""
import re
import sys
from pathlib import Path

CONSTRAINT = "claim-id-traceability"
APPLIES_TO = ["writing-setup", "writing-outline", "writing-draft", "writing-validate",
               "writing-review", "writing-revise", "writing-precis-reviewer",
               "writing-outline-reviewer"]
SEVERITY = "hard"

_CLAIM_PATTERN = re.compile(r'\bCLAIM-(\d{2})\b')
_IMPLEMENTS_PATTERN = re.compile(r'Implements:\s*\[([^\]]*)\]', re.IGNORECASE)
_COVERAGE_PATTERN = re.compile(r'CLAIM-\d{2}:\s*(COVERED|PARTIAL|MISSING)', re.IGNORECASE)


def _find_planning_dir(cwd):
    """Locate .planning/ directory — could be in cwd or a project subdirectory."""
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
        # No .planning/ dir — writing workflow not started, skip
        return violations

    precis_path = planning / "PRECIS.md"
    outline_path = planning / "OUTLINE.md"
    validation_path = planning / "VALIDATION.md"
    outlines_dir = cwd / "outlines"
    drafts_dir = cwd / "drafts"

    # --- 1. PRECIS.md must have CLAIM-XX IDs ---
    if precis_path.exists():
        precis_text = precis_path.read_text(encoding="utf-8", errors="ignore")
        claim_ids = set(_CLAIM_PATTERN.findall(precis_text))
        if not claim_ids:
            violations.append(
                f".planning/PRECIS.md: no CLAIM-XX IDs found — "
                "every claim must have a unique traceable identifier"
            )

        # --- 2. OUTLINE.md sections must have Implements: lines ---
        if outline_path.exists() and claim_ids:
            outline_text = outline_path.read_text(encoding="utf-8", errors="ignore")
            implements_claims = set(_CLAIM_PATTERN.findall(
                " ".join(_IMPLEMENTS_PATTERN.findall(outline_text))
            ))

            # Check each section heading (##) has Implements: within 5 lines
            lines = outline_text.splitlines()
            for i, line in enumerate(lines):
                if re.match(r'^##+ ', line):
                    window = "\n".join(lines[i:min(len(lines), i + 6)])
                    if "Implements:" not in window:
                        violations.append(
                            f".planning/OUTLINE.md:{i+1}: section '{line.strip()}' "
                            "missing Implements: line — every section must declare which claims it covers"
                        )

            # Check every PRECIS claim appears in at least one outline section
            for cid in claim_ids:
                if cid not in implements_claims:
                    violations.append(
                        f".planning/OUTLINE.md: CLAIM-{cid} from PRECIS.md "
                        "not referenced in any Implements: line — structural gap"
                    )

        # --- 3. VALIDATION.md must have per-claim status ---
        if validation_path.exists() and claim_ids:
            validation_text = validation_path.read_text(encoding="utf-8", errors="ignore")
            # Check for blanket assertion without per-claim breakdown
            covered_claims = set(_CLAIM_PATTERN.findall(
                " ".join(_COVERAGE_PATTERN.findall(validation_text))
            ))
            # If VALIDATION.md exists but has no per-claim statuses, flag it
            if not _COVERAGE_PATTERN.search(validation_text):
                violations.append(
                    f".planning/VALIDATION.md: no per-claim status (COVERED/PARTIAL/MISSING) found — "
                    "validate each CLAIM-XX individually, not as a blanket assertion"
                )
            else:
                for cid in claim_ids:
                    if cid not in covered_claims:
                        violations.append(
                            f".planning/VALIDATION.md: CLAIM-{cid} has no coverage status — "
                            "add CLAIM-{cid}: COVERED / PARTIAL / MISSING"
                        )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
