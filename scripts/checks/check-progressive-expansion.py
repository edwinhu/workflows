#!/usr/bin/env python3
"""Check: progressive-expansion-hierarchy — verify writing artifacts follow the 4-level hierarchy.

Checks:
1. If OUTLINE.md exists, PRECIS.md must exist
2. If outlines/ files exist, OUTLINE.md must exist
3. If drafts/ files exist, each must have a matching outlines/ file
4. If writing-revise is active, REVIEW.md must exist
"""
import sys
from pathlib import Path

planning = Path('.planning')
violations = []


def find_writing_dir():
    """Find the directory containing outlines/ and drafts/ (may be project root or a subdir)."""
    # Check project root first
    if (Path('outlines').exists() or Path('drafts').exists()):
        return Path('.')
    # Check .planning for state files
    return None


def main():
    writing_dir = find_writing_dir()

    # Check 1: OUTLINE without PRECIS
    outline = planning / 'OUTLINE.md'
    precis = planning / 'PRECIS.md'
    if outline.exists() and not precis.exists():
        violations.append(f"FAIL: {outline} exists but {precis} does not — NO OUTLINE WITHOUT PRECIS")

    # Check 2: outlines/ files without OUTLINE.md
    if writing_dir:
        outlines_dir = writing_dir / 'outlines'
        if outlines_dir.exists() and list(outlines_dir.glob('*.md')):
            if not outline.exists():
                violations.append(f"FAIL: {outlines_dir}/ has files but {outline} does not exist — section outlines need master outline")

    # Check 3: drafts/ files without matching outlines/ files
    if writing_dir:
        drafts_dir = writing_dir / 'drafts'
        outlines_dir = writing_dir / 'outlines'
        if drafts_dir.exists():
            for draft in sorted(drafts_dir.glob('*.md')):
                section = draft.stem.replace(' (Draft)', '').replace(' (draft)', '').strip()
                if not section:
                    continue
                # Look for matching outline (case-insensitive)
                outline_found = False
                if outlines_dir.exists():
                    for ofile in outlines_dir.iterdir():
                        if ofile.stem.strip().lower() == section.lower():
                            outline_found = True
                            break
                if not outline_found:
                    violations.append(f"FAIL: {draft} has no matching outline in {outlines_dir}/ — NO DRAFT WITHOUT OUTLINE")

    # Check 4: Active revise phase without REVIEW.md
    active_wf = planning / 'ACTIVE_WORKFLOW.md'
    review = planning / 'REVIEW.md'
    if active_wf.exists():
        try:
            content = active_wf.read_text()
            if 'phase: revise' in content.lower() or 'phase: revision' in content.lower():
                if not review.exists():
                    violations.append(f"FAIL: Revise phase active but {review} does not exist — NO REVISION WITHOUT REVIEW.md")
        except Exception:
            pass

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print("PASS: progressive-expansion-hierarchy — all levels present in correct order")
    sys.exit(0)


if __name__ == '__main__':
    main()
