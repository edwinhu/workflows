#!/usr/bin/env -S uv run python3
"""PreToolUse gate: guarantee the deterministic mechanical floor (check-all.py) actually ran and
PASSED before the writing-review semantic fan-out spends tokens. Prose "run check-all" is a
suggestion the model can skip; this is the enforcement (the plugin's "Hooks over prompt" doctrine).

TIGHTLY SCOPED on purpose (the "check-all runs all .py" history):
  - FIRES only on a `Workflow` tool call whose target is the writing-review engine — NOT on every
    Write/Edit, NOT on other workflows. (Skill-scoped to writing-review in the frontmatter too.)
  - RUNS check-all from the PROJECT dir, so check-all self-scopes to the WRITING constraints via its
    APPLIES_TO + detected-workflow filter (non-writing constraints are skipped, not run).
  - BLOCKS only on HARD failures (check-all exit 1 = `failed`/`errors`); advisory "conventions"
    (judgment-only) never block.

Result: the Leg-1 mechanical floor is guaranteed clean before the review workflow runs, without
re-running on every edit and without dragging in other workflows' constraints.

CLI (debug):  uv run python3 writing-mechanical-gate.py /abs/project   # prints the would-be gate result
"""
import json
import subprocess
import sys
from pathlib import Path

CHECK_ALL = Path(__file__).resolve().parent.parent / "references" / "constraints" / "check-all.py"


def _run_check_all(project: str):
    """Return (ok, failed_names, error_names, summary). ok=True iff no hard content FAILURES.

    Blocks on `failed` (real writing-content violations) only. `errors` (a constraint script that
    threw — e.g. a missing dependency) are surfaced but do NOT block: a broken/under-provisioned
    constraint must not wall off the author's review. check-all is run with `--with lxml` so the
    lxml-dependent constraints actually run instead of erroring."""
    try:
        out = subprocess.run(
            ["uv", "run", "--with", "lxml", "python3", str(CHECK_ALL), project],
            capture_output=True, text=True, timeout=180)
    except Exception as e:
        # Never hard-block the workflow on a harness error running the gate.
        return True, [], [], f"(check-all could not run: {e})"
    failed, errors = [], []
    try:
        raw = out.stdout
        data = json.loads(raw[:raw.rfind("}") + 1])  # strip the trailing human summary line
        failed = [f.get("name", "?") if isinstance(f, dict) else str(f) for f in data.get("failed", [])]
        errors = [e.get("name", "?") if isinstance(e, dict) else str(e) for e in data.get("errors", [])]
    except Exception:
        # Parse failed → fall back to the process exit code, but never invent failures.
        if out.returncode != 0:
            failed = [(out.stdout.strip().splitlines() or ["check-all reported failures"])[-1]]
    summary = (out.stdout.strip().splitlines() or ["(no output)"])[-1]
    return (len(failed) == 0), failed, errors, summary


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
    # CLI debug mode
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        ok, failed, errors, summary = _run_check_all(sys.argv[1])
        print(f"ok={ok} | {summary}")
        if failed:
            print("FAILED (blocking):\n- " + "\n- ".join(failed))
        if errors:
            print("errors (non-blocking — tooling):\n- " + "\n- ".join(errors))
        sys.exit(0 if ok else 1)

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if hook_input.get("tool_name", "") != "Workflow":
        sys.exit(0)
    tool_input = hook_input.get("tool_input", {}) or {}
    # SCOPE: only the writing-draft / writing-review engines, nothing else.
    target = f"{tool_input.get('scriptPath', '')} {tool_input.get('name', '')}"
    is_review = "writing-review" in target
    is_draft = "writing-draft" in target
    if not (is_review or is_draft):
        sys.exit(0)

    # Soft check (both engines): the deterministic section-index should be COMPILED and passed.
    # Warn (don't deny) when it's absent — the engine's LLM-Discover fallback still works, but the
    # deterministic compile is the intended path. (Hard-denying would defeat the documented fallback.)
    args = tool_input.get("args")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    si = (args or {}).get("sectionIndex") if isinstance(args, dict) else None
    section_warn = "" if si else (
        " NOTE: args.sectionIndex was not passed — the engine will fall back to the LLM Discover. "
        "For the deterministic path, compile it first: "
        "`uv run python3 scripts/writing/writing_section_index.py <project>` and pass it as args.sectionIndex.")

    # The check-all mechanical gate is the REVIEW floor only (drafting fixes those issues; gating the
    # draft on them would deadlock). For writing-draft we only do the soft section-index nudge.
    if is_draft:
        if section_warn:
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PreToolUse", "permissionDecision": "allow",
                "permissionDecisionReason": section_warn.strip()}}))
        sys.exit(0)

    project = _project_from_args(tool_input)
    ok, failed, errors, summary = _run_check_all(project)
    if not ok:
        note = ("\n\n(Plus " + str(len(errors)) + " constraint(s) errored — tooling, NOT blocking.)"
                if errors else "")
        deny(
            "GATE BLOCKED: the deterministic mechanical floor (check-all.py — bold-lead, "
            "topic-sentences, anchored-numbers, AI-smell, outline-sync, etc.) has hard failures, so "
            "the semantic review fan-out must not run yet. Fix these first, then re-invoke:\n- "
            + "\n- ".join(failed or [summary]) + note + section_warn
            + "\n\n(Only writing constraints were checked; advisory 'conventions' do not block. "
              "Run `uv run --with lxml python3 references/constraints/check-all.py .` for details.)")
    if section_warn:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "allow",
            "permissionDecisionReason": "Mechanical floor clean." + section_warn}}))
    sys.exit(0)


if __name__ == "__main__":
    main()
