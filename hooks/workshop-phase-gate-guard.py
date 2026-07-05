#!/usr/bin/env -S uv run python3
"""
PreToolUse hook (workshop): phase-aware gate enforcer for slide/notes generation.

Complements the generic phase-gate-guard (which gates ALL Edit/Write on the
Phase-1 SOURCES_VERIFIED artifact). This guard adds the Phase-2 -> Phase-3 gate
structurally: writing the *content* files (slides.typ / notes.typ) is blocked
until the outline has been approved.

  Phase 2 -> 3 gate: writing slides.typ or notes.typ requires
    .planning/OUTLINE_APPROVED.md with status: APPROVED.

  Phase 3 -> 4 gate: writing .planning/VALIDATION.md (the Phase 4 deliverable)
    requires .planning/SLIDES_REVIEWED.md with status: APPROVED — i.e. the
    workshop-verify artifact-review gate must have passed before the final
    verification record can be written.

Path-scoped (only .typ content files and the VALIDATION.md deliverable trigger
it), so it composes with the SOURCES_VERIFIED hook without conflict. Other
writes to .planning/ and .claude/ are always allowed (each phase still needs to
write its own state + gate artifacts).

Grounded in: 2026-05-28 Mode-2 audit (P03) — workshop had 3/3 STRUCTURAL gates
but only 1/3 HOOK-ENFORCED; OUTLINE_APPROVED and SLIDES_REVIEWED were
instruction-only. The 2026-05-28 Mode-3 re-audit (P20) flagged the surviving
SLIDES_REVIEWED gap. This now closes both content gates (Phase 2 -> 3 via the
.typ files, Phase 3 -> 4 via VALIDATION.md), including the
workshop-revise -> Phase-3-regeneration path.
"""

import json
import sys
from pathlib import Path

GATE_ARTIFACT = ".planning/OUTLINE_APPROVED.md"
GATE_STATUS = "APPROVED"
CONTENT_FILES = {"slides.typ", "notes.typ"}
ALWAYS_ALLOWED_DIRS = {".planning", ".claude"}

# Phase 3 -> 4 gate: the final verification record (VALIDATION.md) may not be
# written until the workshop-verify review gate has passed (SLIDES_REVIEWED).
PHASE4_DELIVERABLE = "VALIDATION.md"
PHASE4_GATE_ARTIFACT = ".planning/SLIDES_REVIEWED.md"
PHASE4_GATE_STATUS = "APPROVED"


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


def _is_workshop_generate_dispatch(tool_input: dict) -> bool:
    """True iff this Workflow tool call dispatches workshop-generate (the Phase 2->3 fan-out that
    actually writes slides.typ/notes.typ). The Edit|Write-only check below never saw this dispatch —
    Workflow calls carry no file_path, so a skipped OUTLINE_APPROVED step could still start generation
    via Workflow even though direct Edit/Write to the content files was gated."""
    target = f"{tool_input.get('scriptPath', '')} {tool_input.get('name', '')}"
    return "workshop-generate" in target


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    if tool_name == "Workflow":
        if not _is_workshop_generate_dispatch(tool_input):
            sys.exit(0)
        if not _status_ok(GATE_ARTIFACT, GATE_STATUS):
            deny(
                f"GATE BLOCKED: outline not approved.\n\n"
                f"Dispatching workshop-generate requires `{GATE_ARTIFACT}` with "
                f"`status: {GATE_STATUS}` — the Phase 2 outline-approval gate.\n\n"
                f"The artifact proves the user approved the outline before slide/notes "
                f"generation. Instructional text alone is not enforcement.\n\n"
                f"**Remedy:** Return to Phase 2 (Structure Outline), get user approval, "
                f"and write `.planning/OUTLINE_APPROVED.md`."
            )
        sys.exit(0)

    if tool_name not in {"Write", "Edit"}:
        sys.exit(0)

    file_path = tool_input.get("file_path", "")

    # Phase 3 -> 4 gate: the VALIDATION.md verification record requires a passed
    # workshop-verify review gate. Checked before the always-allowed .planning
    # carve-out so the deliverable itself is gated even though it lives there.
    if Path(file_path).name == PHASE4_DELIVERABLE:
        if not _status_ok(PHASE4_GATE_ARTIFACT, PHASE4_GATE_STATUS):
            deny(
                f"GATE BLOCKED: slides not reviewed.\n\n"
                f"Writing `{PHASE4_DELIVERABLE}` (the Phase 4 verification record) "
                f"requires `{PHASE4_GATE_ARTIFACT}` with `status: {PHASE4_GATE_STATUS}` "
                f"— the Phase 3 artifact-review gate.\n\n"
                f"The artifact proves the workshop-verify workflow returned "
                f"overallPass=true before final verification. Instructional text "
                f"alone is not enforcement.\n\n"
                f"**Remedy:** Return to Phase 3, run the workshop-verify review gate "
                f"to overallPass=true, and write `.planning/SLIDES_REVIEWED.md`."
            )
        sys.exit(0)

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
