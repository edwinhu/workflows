#!/usr/bin/env python3
"""Constraint: wc-traceability — every WC-XX in traceability table has a matching implements annotation in SKILL.md."""

CONSTRAINT = "wc-traceability"
APPLIES_TO = ["workflow-creator"]
SEVERITY = "soft"

import re
import sys
from pathlib import Path


def check(context):
    violations = []
    cwd = Path(context.get("cwd", "."))

    trace_file = cwd / "references" / "constraints" / "wc-traceability.md"
    skill_file = cwd / "skills" / "workflow-creator" / "SKILL.md"

    if not trace_file.exists() or not skill_file.exists():
        return violations

    trace_content = trace_file.read_text()
    skill_content = skill_file.read_text()

    table_ids = set(re.findall(r'\|\s*(WC-\d+)\s*\|', trace_content))
    annotation_ids = set(re.findall(r'<!--\s*implements:\s*(WC-\d+)\s*-->', skill_content))

    missing_annotations = table_ids - annotation_ids
    orphan_annotations = annotation_ids - table_ids

    for wc_id in sorted(missing_annotations):
        violations.append(
            f"{wc_id} is in wc-traceability.md but has no <!-- implements: {wc_id} --> in SKILL.md"
        )

    for wc_id in sorted(orphan_annotations):
        violations.append(
            f"{wc_id} has <!-- implements: {wc_id} --> in SKILL.md but is not in wc-traceability.md"
        )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
