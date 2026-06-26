#!/usr/bin/env -S uv run python3
"""
Tests for the reconciled hooks/workshop-outline-executable-guard.py (DESIGN Step 3, S6).
Asserts the guard now shares the ONE parser (validate = build_index().violations), so:
  • the legacy PROSE form PASSES (the parity-regression fix — was a hard deny before);
  • real defects (missing inventory) still DENY;
  • stale approval is allow+WARN, not a block;
  • the real opv prose deck passes the guard (no deny).
Run:  uv run python3 tests/workshop_guard_test.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / "hooks" / "workshop-outline-executable-guard.py"
PASS = 0
FAIL = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  ✗ {name} {extra}")


def run_hook(file_path: str):
    """Simulate the PreToolUse hook on a Write to OUTLINE_APPROVED.md; return parsed JSON or {}."""
    payload = {"tool_name": "Write", "tool_input": {"file_path": file_path}}
    r = subprocess.run([sys.executable, str(GUARD)], input=json.dumps(payload),
                       capture_output=True, text=True)
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        return {"_raw": r.stdout}


def decision(out):
    return (out.get("hookSpecificOutput") or {}).get("permissionDecision", "allow")


PROSE = """## Presentation Outline
### Part 1
= Motivation
== Intro
- Slide: "A real takeaway." — bullets → [A1]
"""
PROSE_NO_INV = """## Presentation Outline
= Motivation
== Intro
- Slide: "A title with no inventory."
"""


def test_prose_passes():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        d.mkdir(parents=True)
        (d / "OUTLINE.md").write_text(PROSE)
        out = run_hook(str(d / "OUTLINE_APPROVED.md"))
        check("prose form is ALLOWED (parity-regression fix — no hard deny)", decision(out) != "deny", out)


def test_missing_inventory_denies():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        d.mkdir(parents=True)
        (d / "OUTLINE.md").write_text(PROSE_NO_INV)
        out = run_hook(str(d / "OUTLINE_APPROVED.md"))
        check("missing-inventory slide DENIES", decision(out) == "deny", out)


def test_stale_approval_warns_not_blocks():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        d.mkdir(parents=True)
        (d / "OUTLINE.md").write_text(PROSE)  # 1 slide, 1 section
        (d / "OUTLINE_APPROVED.md").write_text("---\nslide_count: 5\nsection_count: 3\n---\n")
        out = run_hook(str(d / "OUTLINE_APPROVED.md"))
        check("stale approval is allow (not deny)", decision(out) == "allow", out)
        check("stale approval surfaces a warning",
              "STALE APPROVAL" in ((out.get("hookSpecificOutput") or {}).get("permissionDecisionReason", "")), out)


def test_cli_real_opv():
    opv = Path.home() / "projects" / "opv" / ".planning" / "OUTLINE.md"
    if not opv.is_file():
        print("  (skip real-opv guard CLI — opv OUTLINE absent)")
        return
    r = subprocess.run([sys.executable, str(GUARD), str(opv)], capture_output=True, text=True)
    check("real opv prose deck passes the guard CLI (exit 0 — parity-regression fix)", r.returncode == 0, r.stdout + r.stderr)
    # opv has a stale OUTLINE_APPROVED (18/4 vs live 21/5), so the CLI reports the stale-approval WARN
    # (still exit 0). Either the form line or the stale-approval WARN is an acceptable "executable" report.
    check("guard reports executable (form line or stale-approval warn)",
          "executable" in r.stdout.lower(), r.stdout)


def main():
    for t in (test_prose_passes, test_missing_inventory_denies,
              test_stale_approval_warns_not_blocks, test_cli_real_opv):
        t()
    total = PASS + FAIL
    print(f"\n{PASS}/{total} passed" + ("" if FAIL == 0 else f"  ({FAIL} FAILED)"))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
