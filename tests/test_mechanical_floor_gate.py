#!/usr/bin/env -S uv run python3
"""Regression: the dev/ds mechanical-floor gate must stay TIGHTLY SCOPED and route by FLOOR.

These lock the routing/scoping WITHOUT running check-all (which needs a real project + lxml):
  - FLOOR=dev gates the Agent spawn ONLY (the goal-backward verifier). Workflow/Write are no-ops.
  - FLOOR=ds  gates the Workflow spawn ONLY (the ds-validate-coverage fan-out). Agent is a NO-OP —
    this is the deadlock-avoidance invariant: ds forbids main-chat code edits, so a failing floor is
    fixed by a FIX SUBAGENT (an Agent); the gate must never block Agent. (Tested directly below.)

Run: uv run python3 tests/test_mechanical_floor_gate.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "hooks" / "mechanical-floor-gate.py"

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1; print(f"  ok  {name}")
    else:
        _f += 1; print(f"FAIL  {name} {extra}")


def run(payload: dict, floor: str):
    """Return (exit_code, parsed_stdout_or_None)."""
    env = dict(os.environ, FLOOR=floor)
    r = subprocess.run([sys.executable, str(HOOK)], input=json.dumps(payload),
                       capture_output=True, text=True, timeout=60, env=env)
    out = None
    if r.stdout.strip():
        try:
            out = json.loads(r.stdout)
        except Exception:
            out = {"_raw": r.stdout}
    return r.returncode, out


def decision(out):
    return (out or {}).get("hookSpecificOutput", {}).get("permissionDecision")


# ── FLOOR=dev: gates Agent only ──────────────────────────────────────────────
# 1. dev + Workflow → no-op (dev does NOT gate Workflow; that's ds's job)
code, out = run({"tool_name": "Workflow", "tool_input": {"name": "anything"}}, "dev")
ok("dev + Workflow is a no-op", code == 0 and out is None, f"code={code} out={out}")

# 2. dev + Write → no-op (never fires on edits)
code, out = run({"tool_name": "Write", "tool_input": {"file_path": "x"}}, "dev")
ok("dev + Write is a no-op", code == 0 and out is None, f"code={code} out={out}")

# ── FLOOR=ds: gates Workflow only — Agent MUST stay free (fix-subagent deadlock-avoidance) ────
# 3. ds + Agent → no-op  (THE invariant: a failing floor is fixed by a fix SUBAGENT)
code, out = run({"tool_name": "Agent", "tool_input": {"subagent_type": "ds-engineer"}}, "ds")
ok("ds + Agent is a no-op (fix-subagent must run)", code == 0 and out is None, f"code={code} out={out}")

# 4. ds + Write → no-op
code, out = run({"tool_name": "Write", "tool_input": {"file_path": "x"}}, "ds")
ok("ds + Write is a no-op", code == 0 and out is None, f"code={code} out={out}")

# 5. Malformed stdin → fail-open (never wall off the phase on a harness error)
r = subprocess.run([sys.executable, str(HOOK)], input="not json",
                   capture_output=True, text=True, timeout=60, env=dict(os.environ, FLOOR="ds"))
ok("malformed stdin fails open", r.returncode == 0 and not r.stdout.strip(), f"code={r.returncode}")

# ── Source invariants (the check-all integration runs live; locked here by construction) ──────
src = HOOK.read_text()
ok("dev branch runs check-all.py with --with lxml",
   '"--with", "lxml"' in src and "CHECK_ALL_PY" in src)
ok("ds branch runs check-all-ds.sh", "CHECK_ALL_DS" in src and "check-all-ds.sh" in src)
ok("ds gates Workflow only (never Agent)",
   'floor == "ds"' in src and 'tool_name != "Workflow"' in src)
ok("dev gates Agent only", 'tool_name != "Agent"' in src)
ok("ds deny names the fix-subagent path (no deadlock)", "FIX SUBAGENT" in src)
ok("errors are non-blocking (only failed blocks)", "len(failed) == 0" in src and "NOT blocking" in src)

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
