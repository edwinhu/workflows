#!/usr/bin/env -S uv run python3
"""Tests for the writing spec-layer guards:
  - hooks/writing-outline-executable-guard.py  (PreToolUse on OUTLINE_REVIEWED.md)
  - hooks/writing-claim-id-guard.py            (PostToolUse on outlines/ drafts/)

Run:  uv run python3 tests/writing_guards_test.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXEC_GUARD = ROOT / "hooks" / "writing-outline-executable-guard.py"
CLAIM_GUARD = ROOT / "hooks" / "writing-claim-id-guard.py"
FIX = ROOT / "tests" / "fixtures" / "writing-section-index"

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1; print(f"  ok  {name}")
    else:
        _f += 1; print(f"FAIL  {name} {extra}")


def run(cmd, stdin=None, env=None):
    return subprocess.run(cmd, input=stdin, capture_output=True, text=True,
                          env={**os.environ, **(env or {})})


def claim_payload(file_path: Path) -> str:
    """A real PostToolUse payload. Hooks read stdin — there is no CLAUDE_TOOL_INPUT."""
    return json.dumps({
        "hook_event_name": "PostToolUse",
        "tool_name": "Write",
        "tool_input": {"file_path": str(file_path)},
        "tool_response": {},
    })


def make_project(tmp: Path, *, granular=True, claim_ok=True, stale=False):
    (tmp / ".planning").mkdir(parents=True)
    (tmp / "outlines").mkdir()
    (tmp / "drafts").mkdir()
    (tmp / ".planning" / "ACTIVE_WORKFLOW.md").write_text("---\nstyle: legal\n---\n")
    outline_md = ("## Structure\n\n### Part I. Alpha\n- a\n- b\n- c\n\n"
                  "## Claim → Section Map\n| Claim | Primary home | x |\n|--|--|--|\n"
                  "| CLAIM-01 | I.A | - |\n| CLAIM-02 | I.A | - |\n")
    (tmp / ".planning" / "OUTLINE.md").write_text(outline_md)
    if stale:
        (tmp / ".planning" / "PRECIS_REVIEWED.md").write_text(
            "---\nstatus: APPROVED\n---\nReviewed: five claims across two Parts.\n")
    (tmp / "outlines" / "Part I. Alpha.md").write_text(
        "- TBA develop this\n" if not granular else "- **A** point [@x2020]\n- **B** point\n- **C** point\n")
    impl = "[CLAIM-01, CLAIM-02]" if claim_ok else "[CLAIM-01]"
    (tmp / "drafts" / "Part I. Alpha (Draft).md").write_text(f"---\nimplements: {impl}\n---\nProse.\n")
    return tmp


# ── outline-executable-guard: CLI lint mode ─────────────────────────────────────
r = run(["uv", "run", "python3", str(EXEC_GUARD), str(FIX)])
ok("exec-guard CLI: fixture is executable (exit 0)", r.returncode == 0, r.stdout + r.stderr)
ok("exec-guard CLI: fixture surfaces stale-approval note", "STALE APPROVAL" in r.stdout)

with tempfile.TemporaryDirectory() as td:
    proj = make_project(Path(td), granular=False)
    r = run(["uv", "run", "python3", str(EXEC_GUARD), str(proj)])
    ok("exec-guard CLI: non-granular ⇒ exit 1", r.returncode == 1, r.stdout)
    ok("exec-guard CLI: names the placeholder", "not granular" in r.stdout)

# ── outline-executable-guard: PreToolUse deny / allow ───────────────────────────
with tempfile.TemporaryDirectory() as td:
    proj = make_project(Path(td), claim_ok=False)  # draft missing primary CLAIM-02
    hook_in = json.dumps({"tool_name": "Write",
                          "tool_input": {"file_path": str(proj / ".planning" / "OUTLINE_REVIEWED.md")}})
    r = run(["uv", "run", "python3", str(EXEC_GUARD)], stdin=hook_in)
    out = json.loads(r.stdout)
    dec = out.get("hookSpecificOutput", {}).get("permissionDecision")
    ok("exec-guard hook: ⊇ violation ⇒ deny", dec == "deny", r.stdout)
    ok("exec-guard hook: deny names missing claim",
       "CLAIM-02" in out["hookSpecificOutput"]["permissionDecisionReason"])

with tempfile.TemporaryDirectory() as td:
    proj = make_project(Path(td), stale=True)  # executable but stale approval
    hook_in = json.dumps({"tool_name": "Write",
                          "tool_input": {"file_path": str(proj / ".planning" / "OUTLINE_REVIEWED.md")}})
    r = run(["uv", "run", "python3", str(EXEC_GUARD)], stdin=hook_in)
    out = json.loads(r.stdout)
    ok("exec-guard hook: executable+stale ⇒ allow (not deny)",
       out.get("hookSpecificOutput", {}).get("permissionDecision") == "allow", r.stdout)
    ok("exec-guard hook: allow carries stale note",
       "stale" in out["hookSpecificOutput"]["permissionDecisionReason"].lower())

# unrelated file ⇒ no-op
r = run(["uv", "run", "python3", str(EXEC_GUARD)],
        stdin=json.dumps({"tool_name": "Write", "tool_input": {"file_path": "/tmp/whatever.md"}}))
ok("exec-guard hook: non-OUTLINE_REVIEWED write ⇒ no-op", r.stdout.strip() == "" and r.returncode == 0)

# ── claim-id-guard: block draft / warn outline ──────────────────────────────────
with tempfile.TemporaryDirectory() as td:
    proj = make_project(Path(td))
    # a draft with NO claim, inside a project ⇒ block
    bad_draft = proj / "drafts" / "Orphan (Draft).md"
    bad_draft.write_text("# Orphan\nProse with no claim id.\n")
    r = run(["uv", "run", "python3", str(CLAIM_GUARD)], stdin=claim_payload(bad_draft))
    out = json.loads(r.stdout)
    ok("claim-guard: draft w/o claim in project ⇒ block", out.get("decision") == "block", r.stdout)
    ok("claim-guard: block carries a reason (not `message`)",
       isinstance(out.get("reason"), str) and "message" not in out, r.stdout)

    # an outline with NO claim ⇒ warn, never block. A warning on PostToolUse is
    # hookSpecificOutput.additionalContext — `{"result": "continue"}` is not a thing,
    # and asserting it here is what let the invalid payload survive in production.
    bad_outline = proj / "outlines" / "Orphan.md"
    bad_outline.write_text("- a point with no claim id\n")
    r = run(["uv", "run", "python3", str(CLAIM_GUARD)], stdin=claim_payload(bad_outline))
    out = json.loads(r.stdout)
    hso = out.get("hookSpecificOutput", {})
    ok("claim-guard: outline w/o claim ⇒ warn via additionalContext",
       hso.get("hookEventName") == "PostToolUse" and "additionalContext" in hso
       and "decision" not in out, r.stdout)

    # a draft WITH a claim ⇒ silence (nothing to say), never a block
    r = run(["uv", "run", "python3", str(CLAIM_GUARD)],
            stdin=claim_payload(proj / "drafts" / "Part I. Alpha (Draft).md"))
    ok("claim-guard: draft with claim ⇒ silent", r.stdout.strip() == "" and r.returncode == 0, r.stdout)

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
