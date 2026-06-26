#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: block OUTLINE_APPROVED.md unless OUTLINE.md carries a machine-
EXECUTABLE per-slide Slide Spec table.

`workshop-generate` (the transform workflow) reads the Slide Spec table directly:
it fans out one fragment-agent per row (each builds its `#slide[...]` block + notes
from the pinned Takeaway/Bullets/Inventory/Visual), then an assembly agent stitches
the fragments under their Section headers into slides.typ + notes.typ. A title-only
outline (`- Slide: title — source → IDs`) forces every agent to invent content and
visuals — the failure mode the spec exists to prevent.

This guard fires when something writes `.planning/OUTLINE_APPROVED.md` (the Phase-2
approval artifact Phase 3 checks). It validates the sibling OUTLINE.md's Slide Spec
table and DENIES the approval if the table is missing or any row is incomplete.

Wired via workshop frontmatter:
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-outline-executable-guard.py

Standalone:  uv run python3 workshop-outline-executable-guard.py path/to/OUTLINE.md
"""

import json
import sys
from pathlib import Path

# S6 reconciliation (DESIGN §3b): the guard and BOTH engines share ONE parser. "Parses ⇔ passes the
# guard" is a property, not a hope. The parser is TOLERANT of the legacy PROSE form (so an existing
# prose deck like opv is no longer denied — the parity-regression fix, D-w-2), CANONICAL going forward.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts" / "workshop"))
from workshop_slide_table import build_index  # noqa: E402


def validate(outline_path: Path):
    """Structural violations only (S6: the guard asserts validity, never format). Returns
    build_index().violations — the SAME parse the engines consume. A prose OR table outline that
    parses to a complete, inventory-pinned work-list passes; only real defects (missing inventory,
    dangling F/T/R/A id, malformed/duplicate row, empty spec) block."""
    return build_index(outline_path).violations


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}))
    sys.exit(0)


def main():
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        idx = build_index(Path(sys.argv[1]))
        if idx.violations:
            print("OUTLINE NOT EXECUTABLE:\n- " + "\n- ".join(idx.violations)); sys.exit(1)
        if idx.stale_approval:
            print("OUTLINE executable (WARN — stale approval):\n- " + "\n- ".join(idx.stale_approval)); sys.exit(0)
        print(f"OUTLINE executable ({idx.form} form, {len(idx.slides)} slides)."); sys.exit(0)
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if hook_input.get("tool_name", "") not in ("Write", "Edit"):
        sys.exit(0)
    fp = hook_input.get("tool_input", {}).get("file_path", "")
    if not fp or not fp.endswith("OUTLINE_APPROVED.md"):
        sys.exit(0)
    outline = Path(fp).parent / "OUTLINE.md"
    idx = build_index(outline)
    if idx.violations:
        deny("GATE BLOCKED: OUTLINE.md is not machine-executable, so it cannot be approved "
             "for slide generation.\n\n"
             f"`{outline}` problems:\n- " + "\n- ".join(idx.violations) + "\n\n"
             "workshop-generate fans out one fragment-agent per slide. Every slide needs a takeaway and "
             "≥1 F/T/R/A inventory id (a table row OR a `- Slide: \"...\" → [IDs]` prose line). Fix, then re-approve.")
    # Stale approval (the live OUTLINE drifted from a prior APPROVED count) is allow+WARN, not a block:
    # the structure may legitimately have changed — surface it so the user re-confirms, don't hard-deny.
    if idx.stale_approval:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
              "permissionDecision": "allow",
              "permissionDecisionReason": "STALE APPROVAL (allowing — re-confirm the structure change):\n- "
              + "\n- ".join(idx.stale_approval)}}))
    sys.exit(0)


if __name__ == "__main__":
    main()
