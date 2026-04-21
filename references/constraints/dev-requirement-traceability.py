#!/usr/bin/env -S uv run python3
"""Constraint: dev-requirement-traceability — CATEGORY-NN IDs must flow through dev artifacts."""
import re
import sys
from pathlib import Path

CONSTRAINT = "dev-requirement-traceability"
APPLIES_TO = ["dev-implement", "dev-review", "dev-verify", "dev-test-gaps"]
SEVERITY = "hard"

_REQ_ID_PATTERN = re.compile(r'\b[A-Z]+-\d{2}\b')
_IMPLEMENTS_PATTERN = re.compile(r'implements:\s*\[([^\]]*)\]', re.IGNORECASE)
_COVERAGE_PATTERN = re.compile(r'[A-Z]+-\d{2}:\s*(COVERED|PARTIAL|MISSING)', re.IGNORECASE)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    planning = cwd / ".planning"
    if not planning.is_dir():
        return violations

    spec_path = planning / "SPEC.md"
    plan_path = planning / "PLAN.md"
    validation_path = planning / "VALIDATION.md"

    # --- 1. SPEC.md must have CATEGORY-NN IDs ---
    if spec_path.exists():
        spec_text = spec_path.read_text(encoding="utf-8", errors="ignore")
        req_ids = set(_REQ_ID_PATTERN.findall(spec_text))
        if not req_ids and len(spec_text) > 200:
            violations.append(
                ".planning/SPEC.md: no CATEGORY-NN requirement IDs found — "
                "every requirement must have a unique traceable identifier (e.g., AUTH-01, DATA-02)"
            )

        # --- 2. PLAN.md tasks must have implements: lines ---
        if plan_path.exists() and req_ids:
            plan_text = plan_path.read_text(encoding="utf-8", errors="ignore")
            implements_ids = set(_REQ_ID_PATTERN.findall(
                " ".join(_IMPLEMENTS_PATTERN.findall(plan_text))
            ))

            # Check each task heading has implements: within 5 lines
            lines = plan_text.splitlines()
            for i, line in enumerate(lines):
                if re.match(r'^##+ .*[Tt]ask\b', line):
                    window = "\n".join(lines[i:min(len(lines), i + 6)])
                    if "implements:" not in window.lower():
                        violations.append(
                            f".planning/PLAN.md:{i+1}: task '{line.strip()}' "
                            "missing implements: line — every task must declare which requirements it covers"
                        )

            # Check every SPEC requirement appears in at least one task
            for rid in req_ids:
                if rid not in implements_ids:
                    violations.append(
                        f".planning/PLAN.md: {rid} from SPEC.md "
                        "not referenced in any implements: line — coverage gap"
                    )

        # --- 3. VALIDATION.md must have per-requirement status ---
        if validation_path.exists() and req_ids:
            validation_text = validation_path.read_text(encoding="utf-8", errors="ignore")
            if not _COVERAGE_PATTERN.search(validation_text):
                violations.append(
                    ".planning/VALIDATION.md: no per-requirement status (COVERED/PARTIAL/MISSING) found — "
                    "validate each CATEGORY-NN individually, not as a blanket assertion"
                )
            else:
                covered_ids = set(_REQ_ID_PATTERN.findall(
                    " ".join(m.group() for m in _COVERAGE_PATTERN.finditer(validation_text))
                ))
                for rid in req_ids:
                    if rid not in covered_ids:
                        violations.append(
                            f".planning/VALIDATION.md: {rid} has no coverage status — "
                            f"add {rid}: COVERED / PARTIAL / MISSING"
                        )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
