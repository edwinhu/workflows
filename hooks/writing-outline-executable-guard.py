#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: block OUTLINE_REVIEWED.md = APPROVED unless the writing outline-spec is
machine-executable — i.e. scripts/writing/writing_section_index.py parses it clean.

This is the writing analog of ds/dev's *-plan-executable-guard: the SAME shared parser the
two writing engines (writing-draft.js, writing-review.js) consume also gates approval, so
"the index compiles" ⇔ "the outline passes the gate" — they cannot drift. The parser is the
single source of truth for the document's section set, document order, file pairing, and the
claim→section mapping.

What it blocks on (from build_index().violations):
  - a section with no outline file (tolerant pairing already tried '<Name>.md' + '(Outline).md')
  - a non-granular outline (placeholder "TBA"/"develop this", or bare headings)
  - a section whose draft.implements is MISSING a primary claim the OUTLINE.md
    `## Claim → Section Map` assigns to it (the ⊇ gate — superset, NOT equality, so
    Intro/Conclusion supersets are fine; a Part dropping its primary claim is not)

It ALSO surfaces (non-blocking warning) staleApproval: a *_REVIEWED.md whose claim/Part count
disagrees with the live OUTLINE.md (the stale-approved-artifact catch — e.g. a thesis reframe
left PRECIS_REVIEWED.md asserting the old shape). That is a re-approve prompt, not a hard block,
because the very act being gated is re-approval.

CLI:  uv run python3 writing-outline-executable-guard.py /abs/project   # lint mode (exit 1 if bad)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "writing"))
from writing_section_index import build_index  # noqa: E402


def validate(project_or_planning: Path):
    res = build_index(project_or_planning)
    return res.violations, res.stale_approval


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def main():
    # CLI lint mode
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        violations, stale = validate(Path(sys.argv[1]))
        if stale:
            print("STALE APPROVAL (re-approve PRECIS/OUTLINE):\n- " + "\n- ".join(stale))
        if violations:
            print("OUTLINE NOT EXECUTABLE:\n- " + "\n- ".join(violations))
            sys.exit(1)
        print("Outline-spec executable: every section parses, granular, and claim-pinned (⊇).")
        sys.exit(0)

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if hook_input.get("tool_name", "") not in ("Write", "Edit"):
        sys.exit(0)
    file_path = hook_input.get("tool_input", {}).get("file_path", "")
    if not file_path or not file_path.endswith("OUTLINE_REVIEWED.md"):
        sys.exit(0)

    # OUTLINE_REVIEWED.md lives in .planning/; the project root is its grandparent.
    planning = Path(file_path).parent
    violations, stale = validate(planning)

    if violations:
        msg = (
            "GATE BLOCKED: the writing outline-spec is not machine-executable, so it "
            "cannot be approved for drafting/review.\n\n"
            "Problems (from scripts/writing/writing_section_index.py):\n- "
            + "\n- ".join(violations) + "\n\n"
            "Both writing engines build the section set from this index (document order "
            "from OUTLINE.md ## Structure; the claim→section map; tolerant outline/draft "
            "pairing). Fix the outline(s) in writing-outline — give each section a "
            "paragraph-granular outline, pair its draft, and ensure each draft's "
            "`implements: [CLAIM-XX]` covers the primary claims the `## Claim → Section "
            "Map` assigns it — then re-run the outline reviewer."
        )
        if stale:
            msg += "\n\nALSO (stale approval — fix while you are here):\n- " + "\n- ".join(stale)
        deny(msg)

    # Outline executable but a prior approval is stale → warn, do not block (re-approval is the fix).
    if stale:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": (
                "Outline-spec is executable. NOTE — a prior review artifact is stale vs the "
                "live OUTLINE.md (re-approve to clear):\n- " + "\n- ".join(stale)),
        }}))
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
