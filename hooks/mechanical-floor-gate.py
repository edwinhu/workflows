#!/usr/bin/env -S uv run python3
"""PreToolUse gate: guarantee the deterministic static-analysis floor (check-all) actually RAN and
PASSED before a phase spends tokens on its expensive fan-out. Prose "run check-all" is a suggestion
the model can skip; this is the enforcement (the plugin's "Hooks over prompt" doctrine). This is the
dev/ds sibling of hooks/writing-mechanical-gate.py — the same gap (the Leg-1 mechanical floor sat in
skippable prose while the phase hook gated on a *different* artifact) the wc-audit P20 sub-probe
flagged across writing, dev, and ds.

Parameterized by the FLOOR env var (set in the skill frontmatter hook command):

  FLOOR=dev  → gate the Agent spawn (the goal-backward verifier in dev-verify, Leg 2).
               Runs references/constraints/check-all.py, which self-scopes to the dev constraints via
               its APPLIES_TO + detected-workflow filter. Denies on HARD failures only.
               Fixes are ordinary main-chat edits, so denying Agent does not deadlock.

  FLOOR=ds   → gate the Workflow spawn (the ds-validate-coverage per-requirement fan-out).
               Runs scripts/check-all-ds.sh; denies on non-zero exit.
               Gates the WORKFLOW only — NOT Agent — on purpose: ds forbids main-chat analysis-code
               edits (ds-no-main-chat-code-guard), so a failing floor is fixed by a FIX SUBAGENT
               (an Agent). Denying Agent here would wall off the only legal way to fix it. The
               coverage Workflow is the expensive fan-out worth protecting; fix subagents stay free.

TIGHTLY SCOPED on purpose (the "check-all runs all .py" history): this hook is wired only into
dev-verify (FLOOR=dev) and ds-validate (FLOOR=ds) frontmatter, and each branch gates exactly one
tool. It never fires on Write/Edit and never drags in another workflow's constraints (check-all
self-scopes by detected workflow / the ds-*.py glob).

In all cases a constraint that ERRORED (threw — e.g. a missing dependency) is surfaced but does NOT
block: a broken/under-provisioned constraint must not wall off the phase. Only real content
FAILURES block. A harness error running the gate itself never blocks either (fail-open).

CLI (debug):  FLOOR=dev uv run python3 mechanical-floor-gate.py /abs/project
              FLOOR=ds  uv run python3 mechanical-floor-gate.py /abs/project
"""
import json
import os
import subprocess
import sys
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent
REPO = HOOKS_DIR.parent
CHECK_ALL_PY = REPO / "references" / "constraints" / "check-all.py"
CHECK_ALL_DS = REPO / "scripts" / "check-all-ds.sh"


def _run_dev(project: str):
    """check-all.py (dev). Return (ok, failed, errors, summary). ok iff no hard content FAILURES.

    Run with `--with lxml` so the lxml-dependent constraints actually run instead of landing in
    `errors` (the same invocation fix shipped in v5.67.5)."""
    try:
        out = subprocess.run(
            ["uv", "run", "--with", "lxml", "python3", str(CHECK_ALL_PY), project],
            capture_output=True, text=True, timeout=180)
    except Exception as e:
        return True, [], [], f"(check-all.py could not run: {e})"
    failed, errors = [], []
    try:
        raw = out.stdout
        data = json.loads(raw[:raw.rfind("}") + 1])  # strip the trailing human summary line
        failed = [f.get("name", "?") if isinstance(f, dict) else str(f) for f in data.get("failed", [])]
        errors = [e.get("name", "?") if isinstance(e, dict) else str(e) for e in data.get("errors", [])]
    except Exception:
        if out.returncode != 0:
            failed = [(out.stdout.strip().splitlines() or ["check-all reported failures"])[-1]]
    summary = (out.stdout.strip().splitlines() or ["(no output)"])[-1]
    return (len(failed) == 0), failed, errors, summary


def _run_ds(project: str):
    """check-all-ds.sh (ds). Return (ok, failed, errors, summary). ok iff exit 0.

    The bash runner prints `✗ <name>` per failing constraint and exits non-zero iff any failed."""
    try:
        out = subprocess.run(
            ["bash", str(CHECK_ALL_DS), project],
            capture_output=True, text=True, timeout=180)
    except Exception as e:
        return True, [], [], f"(check-all-ds.sh could not run: {e})"
    failed = [ln.split("✗", 1)[1].strip() for ln in out.stdout.splitlines() if "✗" in ln]
    summary = (out.stdout.strip().splitlines() or ["(no output)"])[-1]
    ok = out.returncode == 0
    if not ok and not failed:
        failed = [summary]
    return ok, failed, [], summary


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def _project_from_args(tool_input: dict) -> str:
    args = tool_input.get("args")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    if isinstance(args, dict) and args.get("projectDir"):
        return str(args["projectDir"])
    return "."


def main():
    floor = os.environ.get("FLOOR", "").strip().lower()

    # CLI debug mode
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        runner = _run_ds if floor == "ds" else _run_dev
        ok, failed, errors, summary = runner(sys.argv[1])
        print(f"FLOOR={floor or 'dev'} ok={ok} | {summary}")
        if failed:
            print("FAILED (blocking):\n- " + "\n- ".join(failed))
        if errors:
            print("errors (non-blocking — tooling):\n- " + "\n- ".join(errors))
        sys.exit(0 if ok else 1)

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {}) or {}

    if floor == "ds":
        # Gate the ds-validate-coverage Workflow fan-out ONLY (never Agent — fix subagents must run).
        if tool_name != "Workflow":
            sys.exit(0)
        project = _project_from_args(tool_input)
        ok, failed, errors, summary = _run_ds(project)
        if not ok:
            deny(
                "GATE BLOCKED: the DS static-analysis floor (check-all-ds.sh — determinism, join "
                "audits, idempotency, error handling, schema contracts, standard errors, viz "
                "integrity) has failures, so the per-requirement validation fan-out must not run "
                "yet. These are code-quality defects in the analysis scripts. Dispatch a FIX "
                "SUBAGENT (an Agent — not blocked) to fix them, then re-invoke:\n- "
                + "\n- ".join(failed or [summary])
                + "\n\n(Run `bash scripts/check-all-ds.sh .` for details.)")
        sys.exit(0)

    # FLOOR=dev (default): gate the goal-backward verifier Agent spawn.
    if tool_name != "Agent":
        sys.exit(0)
    project = _project_from_args(tool_input)
    ok, failed, errors, summary = _run_dev(project)
    if not ok:
        note = ("\n\n(Plus " + str(len(errors)) + " constraint(s) errored — tooling, NOT blocking.)"
                if errors else "")
        deny(
            "GATE BLOCKED: the constraint floor (check-all.py — Leg 1) has hard failures, so the "
            "goal-backward verifier must not run yet. Constraint failures are hard blocks — fix "
            "these first, then re-spawn the verifier:\n- "
            + "\n- ".join(failed or [summary]) + note
            + "\n\n(Run `uv run --with lxml python3 references/constraints/check-all.py .` for details.)")
    sys.exit(0)


if __name__ == "__main__":
    main()
