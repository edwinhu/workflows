#!/usr/bin/env python3
"""Check: claim-id-traceability — verify CLAIM-XX IDs flow through all writing artifacts.

Checks:
1. PRECIS.md has CLAIM-XX IDs
2. OUTLINE.md sections have Implements: lines referencing CLAIM-XX IDs
3. Every CLAIM-XX in PRECIS appears in at least one OUTLINE section
4. outlines/ files reference CLAIM-XX IDs
5. VALIDATION.md (if exists) has per-claim status
"""
import re
import sys
from pathlib import Path

CLAIM_PATTERN = re.compile(r'CLAIM-\d+')
planning = Path('.planning')
violations = []


def extract_claim_ids(text: str) -> set:
    """Extract all CLAIM-XX IDs from text."""
    return set(CLAIM_PATTERN.findall(text))


def main():
    precis = planning / 'PRECIS.md'
    outline = planning / 'OUTLINE.md'
    validation = planning / 'VALIDATION.md'

    # If no writing workflow artifacts exist, pass (nothing to check)
    if not precis.exists():
        print("PASS: claim-id-traceability — no PRECIS.md found (no active writing workflow)")
        sys.exit(0)

    # Check 1: PRECIS.md has CLAIM-XX IDs
    precis_text = precis.read_text()
    precis_claims = extract_claim_ids(precis_text)
    if not precis_claims:
        violations.append(f"FAIL: {precis} contains no CLAIM-XX IDs — every claim needs a unique identifier")

    # Check 2-3: OUTLINE.md references claims
    if outline.exists() and precis_claims:
        outline_text = outline.read_text()
        outline_claims = extract_claim_ids(outline_text)

        # Check for Implements: lines
        if 'Implements:' not in outline_text and 'implements:' not in outline_text:
            violations.append(f"FAIL: {outline} has no 'Implements:' lines — sections must declare which claims they cover")

        # Check coverage: every precis claim should appear in outline
        missing = precis_claims - outline_claims
        if missing:
            violations.append(f"FAIL: {outline} missing claims from PRECIS: {', '.join(sorted(missing))} — structural gap")

    # Check 4: outlines/ files reference claims
    outlines_dir = Path('outlines')
    if outlines_dir.exists() and precis_claims:
        for ofile in sorted(outlines_dir.glob('*.md')):
            otext = ofile.read_text()
            oclaims = extract_claim_ids(otext)
            if not oclaims:
                violations.append(f"FAIL: {ofile} contains no CLAIM-XX references — section outlines must trace to claims")

    # Check 5: VALIDATION.md has per-claim status
    if validation.exists() and precis_claims:
        vtext = validation.read_text()
        vclaims = extract_claim_ids(vtext)
        missing_validation = precis_claims - vclaims
        if missing_validation:
            violations.append(f"FAIL: {validation} missing claims: {', '.join(sorted(missing_validation))} — every claim needs COVERED/PARTIAL/MISSING status")

        # Check for actual status markers
        if not re.search(r'COVERED|PARTIAL|MISSING', vtext):
            violations.append(f"FAIL: {validation} has no COVERED/PARTIAL/MISSING status markers — per-claim status required")

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print("PASS: claim-id-traceability — all CLAIM-XX IDs properly traced through artifacts")
    sys.exit(0)


if __name__ == '__main__':
    main()
