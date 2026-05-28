#!/usr/bin/env -S uv run python3
"""
PreToolUse hook (workshop): phase-aware gate enforcer for slide/notes generation.

Complements the generic phase-gate-guard (which gates ALL Edit/Write on the
Phase-1 SOURCES_VERIFIED artifact). This guard adds the Phase-2 -> Phase-3 gate
structurally: writing the *content* files (slides.typ / notes.typ) is blocked
until the outline has been approved.

  Phase 2 -> 3 gate: writing slides.typ or notes.typ requires
    .planning/OUTLINE_APPROVED.md with status: APPROVED.

Path-scoped (only .typ content files trigger it), so it composes with the
SOURCES_VERIFIED hook without conflict. Writes to .planning/ and .claude/ are
always allowed (the phase still needs to write its own state + gate artifacts).

Grounded in: 2026-05-28 Mode-2 audit (P03) — workshop had 3/3 STRUCTURAL gates
but only 1/3 HOOK-ENFORCED; OUTLINE_APPROVED and SLIDES_REVIEWED were
instruction-only. This closes the most important content gate (Phase 2 -> 3),
including the workshop-revise -> Phase-3-regeneration path.
"""

import json
import sys
from pathlib import Path

GATE_ARTIFACT = ".planning/OUTLINE_APPROVED.md"
GATE_STATUS = "APPROVED"
CONTENT_FILES = {"slides.typ", "notes.typ"}
ALWAYS_ALLOWED_DIRS = {".planning", ".claude"}


def _status_ok(path: str, required: str) -> bool:
    p = Path(path)
    if not p.is_file():
        return False
    try:
        text = p.read_text()
    except Exception:
        return False
    if not text.startswith("---"):
        return False
    parts = text.split("---", 2)
    if len(parts) < 3:
        return False
    for line in parts[1].strip().splitlines():
        line = line.strip()
        if line.startswith("status:"):
            value = line.split(":", 1)[1].strip().strip('"').strip("'")
            return value.upper() == required.upper()
    return False


def _is_content_file(file_path: str) -> bool:
    if not file_path:
        return False
    parts = Path(file_path).parts
    if any(d in parts for d in ALWAYS_ALLOWED_DIRS):
        return False
    return Path(file_path).name in CONTENT_FILES


def deny(reason: str):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if hook_input.get("tool_name", "") not in {"Write", "Edit"}:
        sys.exit(0)

    file_path = hook_input.get("tool_input", {}).get("file_path", "")
    if not _is_content_file(file_path):
        sys.exit(0)

    if not _status_ok(GATE_ARTIFACT, GATE_STATUS):
        deny(
            f"GATE BLOCKED: outline not approved.\n\n"
            f"Writing `{Path(file_path).name}` requires `{GATE_ARTIFACT}` with "
            f"`status: {GATE_STATUS}` — the Phase 2 outline-approval gate.\n\n"
            f"The artifact proves the user approved the outline before slide/notes "
            f"generation. Instructional text alone is not enforcement.\n\n"
            f"**Remedy:** Return to Phase 2 (Structure Outline), get user approval, "
            f"and write `.planning/OUTLINE_APPROVED.md`."
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
