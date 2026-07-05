#!/usr/bin/env -S uv run python3
"""Regression: the writing-review/draft mechanical-gate hook must stay TIGHTLY SCOPED.

The whole point of this hook (per the "check-all runs all .py" history + the user's "limit the
scope" directive) is that it fires ONLY on the writing-draft/writing-review Workflow engines and
no-ops on everything else. These tests lock the routing/scoping WITHOUT running check-all (which
needs a real project + lxml); the check-all integration is exercised by the CLI debug mode.

Run: uv run python3 tests/test_writing_mechanical_gate.py
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import time
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

# 8. Freshness cache: reuses the cached verdict when the hash is unchanged, re-runs when a
#    drafts/*.md file's mtime moves (item 5 — the Leg-1 double-run with writing-review).
spec = importlib.util.spec_from_file_location("writing_mechanical_gate", HOOK)
GATE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(GATE)

with tempfile.TemporaryDirectory() as td:
    project = Path(td)
    (project / "drafts").mkdir()
    draft = project / "drafts" / "intro.md"
    draft.write_text("Hello world.")

    calls = {"n": 0}

    def _fake_run_check_all(proj):
        calls["n"] += 1
        return True, [], [], "ok (fake run)"

    GATE._run_check_all = _fake_run_check_all

    ok1, failed1, errors1, summary1, cached1 = GATE._run_check_all_cached(str(project))
    ok("cache miss: first call actually runs check-all", calls["n"] == 1 and cached1 is False)
    ok("cache miss: writes .planning/.checkall-cache.json",
       (project / ".planning" / ".checkall-cache.json").is_file())

    ok2, failed2, errors2, summary2, cached2 = GATE._run_check_all_cached(str(project))
    ok("cache hit: unchanged project reuses cached verdict (no re-run)",
       calls["n"] == 1 and cached2 is True, f"calls={calls['n']} cached2={cached2}")
    ok("cache hit: verdict matches the cached run", ok2 == ok1 and summary2 == summary1)

    time.sleep(0.02)
    draft.write_text("Hello world, edited.")
    ok3, failed3, errors3, summary3, cached3 = GATE._run_check_all_cached(str(project))
    ok("draft edit invalidates the cache (re-runs check-all)",
       calls["n"] == 2 and cached3 is False, f"calls={calls['n']} cached3={cached3}")

# 9. Cache read/write are fail-open: a corrupt cache file must not crash the gate, just re-run.
with tempfile.TemporaryDirectory() as td:
    project = Path(td)
    (project / "drafts").mkdir()
    (project / "drafts" / "a.md").write_text("x")
    (project / ".planning").mkdir()
    (project / ".planning" / ".checkall-cache.json").write_text("{not valid json")
    calls = {"n": 0}
    GATE._run_check_all = lambda proj: (calls.__setitem__("n", calls["n"] + 1) or (True, [], [], "ok"))
    ok4, failed4, errors4, summary4, cached4 = GATE._run_check_all_cached(str(project))
    ok("corrupt cache file fails open (still returns a verdict)", ok4 is True and cached4 is False)

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
