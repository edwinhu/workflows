#!/usr/bin/env -S uv run python3
"""Regression: the writing-review/draft mechanical-gate hook must stay TIGHTLY SCOPED.

The whole point of this hook (per the "check-all runs all .py" history + the user's "limit the
scope" directive) is that it fires ONLY on the writing-draft/writing-review Workflow engines and
no-ops on everything else. These tests lock the routing/scoping WITHOUT running check-all (which
needs a real project + lxml); the check-all integration is exercised by the CLI debug mode.

Run: uv run python3 tests/test_writing_mechanical_gate.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "hooks" / "writing-mechanical-gate.py"

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1; print(f"  ok  {name}")
    else:
        _f += 1; print(f"FAIL  {name} {extra}")


def run(payload: dict):
    """Return (exit_code, parsed_stdout_or_None)."""
    r = subprocess.run([sys.executable, str(HOOK)], input=json.dumps(payload),
                       capture_output=True, text=True, timeout=60)
    out = None
    if r.stdout.strip():
        try:
            out = json.loads(r.stdout)
        except Exception:
            out = {"_raw": r.stdout}
    return r.returncode, out


def decision(out):
    return (out or {}).get("hookSpecificOutput", {}).get("permissionDecision")


# 1. Non-Workflow tool → no-op (silent allow, exit 0, no output)
code, out = run({"tool_name": "Write", "tool_input": {"file_path": "x"}})
ok("non-Workflow tool is a no-op", code == 0 and out is None, f"code={code} out={out}")

# 2. Unrelated Workflow (ds/dev/etc.) → no-op — does NOT drag in other workflows
code, out = run({"tool_name": "Workflow", "tool_input": {"name": "ds-run"}})
ok("unrelated Workflow is a no-op (scope)", code == 0 and out is None, f"code={code} out={out}")

# 3. writing-draft WITHOUT sectionIndex → ALLOW + soft section-index warn (never check-all, never deny)
code, out = run({"tool_name": "Workflow",
                 "tool_input": {"scriptPath": "writing-draft.js", "args": {"projectDir": "/nonexistent"}}})
ok("writing-draft no-index → allow", decision(out) == "allow", f"out={out}")
ok("writing-draft no-index warns about sectionIndex",
   "sectionIndex" in (out or {}).get("hookSpecificOutput", {}).get("permissionDecisionReason", ""))

# 4. writing-draft WITH sectionIndex → silent allow (no nag)
code, out = run({"tool_name": "Workflow",
                 "tool_input": {"scriptPath": "writing-draft.js",
                                "args": {"projectDir": "/nonexistent", "sectionIndex": {"sections": [1]}}}})
ok("writing-draft with-index → silent allow", code == 0 and out is None, f"out={out}")

# 5. writing-draft NEVER denies (drafting fixes the issues the floor checks; gating it would deadlock)
ok("writing-draft never denies", decision(out) != "deny")

# 6. The hook resolves check-all and invokes it WITH lxml (so prose constraints actually run)
src = HOOK.read_text()
ok("hook invokes check-all with --with lxml",
   '"--with", "lxml"' in src and "check-all.py" in src.replace('"references"', "") or
   ('"--with", "lxml"' in src and "CHECK_ALL" in src))

# 7. ERRORS are non-blocking; only `failed` blocks (limit-scope: a broken dep must not wall off review)
ok("hook blocks on failed only (errors non-blocking)",
   "len(failed) == 0" in src and "NOT blocking" in src)

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
