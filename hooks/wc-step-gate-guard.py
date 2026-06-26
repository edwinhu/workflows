#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: Multi-step gate guard for workflow-creator.

Two enforcement layers across ALL three modes:

Layer 1 — File-path gates (mode: create only):
  INTERVIEW.md  → requires 1-philosophy
  DESIGN.md     → requires 2-interview
  AUDIT.md      → requires 6-generate
  skills/*.md   → requires 5-entry-points
  constraints/  → requires 5-entry-points

Layer 2 — STATE.md step-chain validation (all modes):
  When writing to STATE.md with a new step, the predecessor step must be completed.

  Mode create:  1-philosophy → 2-interview → 3-decomposition → 3b-artifact-review
                → 4-enforcement → 4b-cross-skill → 5-entry-points → 6-generate → 7-self-audit

  Mode audit:   1-read → 2-score → 3-enforcement → 3b-portability → 4-report

  Mode improve: 1-initial-audit → 1-audit-loop

Layer 3 — Structural review-marker gates (mode: create only):
  Advancing to 3-decomposition requires INTERVIEW_REVIEWED.md (status: APPROVED).
  Advancing to 4-enforcement   requires DESIGN_REVIEWED.md   (status: APPROVED).
  This makes the artifact-review gates hook-enforced, not advisory prose.
"""

import json
import re
import sys
from pathlib import Path

# Structural review-marker gates (create mode): advancing to the keyed step
# requires the marker file to exist with `status: APPROVED`. This makes the
# INTERVIEW.md / DESIGN.md review gates genuinely structural (hook-enforced),
# not advisory prose claiming to be structural.
MARKER_GATES = {
    "create": {
        "3-decomposition": "INTERVIEW_REVIEWED.md",
        "4-enforcement": "DESIGN_REVIEWED.md",
    },
}

STEP_CHAINS = {
    "create": [
        "1-philosophy",
        "2-interview",
        "3-decomposition",
        "3b-artifact-review",
        "4-enforcement",
        "4b-cross-skill",
        "5-entry-points",
        "6-generate",
        "7-self-audit",
    ],
    "audit": [
        "1-read",
        "2-score",
        "3-enforcement",
        "3b-portability",
        "4-report",
    ],
    "improve": [
        "1-initial-audit",
        "1-audit-loop",
    ],
}


def build_predecessors(chain):
    preds = {}
    for i, step in enumerate(chain):
        if i > 0:
            preds[step] = chain[i - 1]
    return preds


def find_active_wc_state():
    wc_dir = Path(".planning/wc")
    if not wc_dir.exists():
        return None
    state_files = list(wc_dir.glob("*/STATE.md"))
    if not state_files:
        return None
    return max(state_files, key=lambda p: p.stat().st_mtime)


def parse_state(state_path):
    try:
        content = state_path.read_text()
    except Exception:
        return set(), None

    mode_match = re.search(r'mode:\s*(\S+)', content)
    mode = mode_match.group(1) if mode_match else None

    completed = set()
    for match in re.finditer(r'step:\s*(\S+)', content):
        step = match.group(1)
        rest = content[match.start():match.start() + 200]
        if re.search(r'status:\s*completed', rest):
            completed.add(step)

    return completed, mode


def match_file_to_gate(file_path, mode):
    p = Path(file_path)
    parts = p.parts
    name = p.name

    if name in ("HANDOFF.md", "SCORES.md"):
        return None

    if name == "STATE.md":
        return "STATE_CHAIN"

    if '.planning' in parts or '.claude' in parts:
        if 'wc' in parts and mode == "create":
            if name == "INTERVIEW.md":
                return ("1-philosophy", "Step 1 (philosophy) must be completed before writing INTERVIEW.md")
            if name == "DESIGN.md":
                return ("2-interview", "Step 2 (interview) must be completed before writing DESIGN.md")
            if name == "AUDIT.md":
                return ("6-generate", "Step 6 (generate) must be completed before writing AUDIT.md")
        return None

    if mode == "create":
        if 'skills' in parts and p.suffix == '.md':
            return ("5-entry-points", "Steps 1-5 must be completed before generating skill files")
        if 'constraints' in parts:
            return ("5-entry-points", "Steps 1-5 must be completed before generating constraint files")

    return None


def marker_approved(state_dir, marker):
    """True iff the review marker exists in the wc state dir with status: APPROVED."""
    try:
        return bool(re.search(r'status:\s*APPROVED', (Path(state_dir) / marker).read_text()))
    except Exception:
        return False


def manifest_violations(state_dir):
    """Single-source generation guard (P23): validate the DESIGN.md Generation Manifest via the
    SAME parser wc-generate uses (validate = parse_design().violations), so the generated file SET
    can't drift from the design. Back-compat: a DESIGN with NO manifest is allowed (wc-generate
    falls back to LLM enumeration) — only a manifest that is PRESENT-but-INVALID blocks. Never
    blocks on a tooling error."""
    design = Path(state_dir) / "DESIGN.md"
    if not design.is_file():
        return None
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "wc"))
        from wc_file_set import parse_design
        fs = parse_design(design.read_text())
    except Exception:
        return None
    # drop the "no manifest" violation → back-compat allow; any OTHER violation blocks.
    viols = [v for v in fs.violations if "Generation Manifest" not in v]
    return viols or None


def check_state_chain(tool_input, completed_steps, mode, state_dir):
    content = tool_input.get("content", "")
    new_string = tool_input.get("new_string", "")
    text = content or new_string

    if not text:
        return None

    step_match = re.search(r'step:\s*(\S+)', text)
    if not step_match:
        return None

    new_step = step_match.group(1).rstrip(',')

    chain = STEP_CHAINS.get(mode)
    if not chain:
        return None

    predecessors = build_predecessors(chain)

    if new_step not in predecessors:
        return None

    predecessor = predecessors[new_step]
    if predecessor not in completed_steps:
        return (
            f"STEP-CHAIN BLOCKED: Cannot write step '{new_step}' — "
            f"predecessor '{predecessor}' not completed.\n\n"
            f"Required: STATE.md must show `step: {predecessor}, status: completed` "
            f"before advancing to {new_step}.\n\n"
            f"**Remedy:** Complete step {predecessor} first."
        )

    # Structural review-marker gate: the artifact-review marker must be APPROVED
    # before advancing past the review gate.
    marker = MARKER_GATES.get(mode, {}).get(new_step)
    if marker and not marker_approved(state_dir, marker):
        return (
            f"REVIEW-GATE BLOCKED: Cannot write step '{new_step}' — "
            f"the artifact review marker '{marker}' is missing or not APPROVED.\n\n"
            f"Required: `{marker}` must exist in {state_dir} with `status: APPROVED` "
            f"(written by the upstream review gate once the reviewer returns APPROVED).\n\n"
            f"**Remedy:** Run the review gate to convergence and write the marker before advancing."
        )

    # Single-source generation guard (P23): entering 6-generate requires the DESIGN.md
    # Generation Manifest to parse clean (so the deterministic file-set enumeration can't drift).
    if new_step == "6-generate":
        viols = manifest_violations(state_dir)
        if viols:
            return (
                "MANIFEST BLOCKED: Cannot enter step '6-generate' — DESIGN.md's "
                "`## Generation Manifest` is present but invalid:\n- " + "\n- ".join(viols) + "\n\n"
                "**Remedy:** Fix the manifest in DESIGN.md (run "
                "`uv run python3 scripts/wc/wc_file_set.py --check .planning/wc/{name}/DESIGN.md` "
                "until clean), then advance."
            )

    return None


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    if tool_name not in ('Write', 'Edit'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    state_path = find_active_wc_state()
    if not state_path:
        sys.exit(0)

    completed_steps, mode = parse_state(state_path)

    if not mode:
        sys.exit(0)

    gate = match_file_to_gate(file_path, mode)
    if gate is None:
        sys.exit(0)

    if gate == "STATE_CHAIN":
        reason = check_state_chain(tool_input, completed_steps, mode, state_path.parent)
        if reason:
            result = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason
                }
            }
            print(json.dumps(result))
        sys.exit(0)

    required_step, gate_description = gate

    if required_step not in completed_steps:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"GATE BLOCKED: {gate_description}\n\n"
                    f"Required: STATE.md must show `step: {required_step}, status: completed` "
                    f"before this write is allowed.\n\n"
                    f"**Remedy:** Complete step {required_step} first and update STATE.md."
                )
            }
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == '__main__':
    main()
