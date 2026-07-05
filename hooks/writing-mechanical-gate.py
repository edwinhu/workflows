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

FRESHNESS CACHE (this gate ONLY — NOT hooks/mechanical-floor-gate.py, whose dev/ds floors stay
fresh-run every time): writing-review's Leg-1 already runs check-all.py once; this gate then
re-runs the SAME check on the Workflow spawn seconds later — a double run on an unchanged draft.
After a successful run this gate writes `.planning/.checkall-cache.json` (exit-ok, failed, errors,
summary, hash); on the next invocation, if the hash (drafts/*.md + constraint files, by mtime)
still matches, the cached verdict is reused instead of re-running check-all. Fail-open throughout:
any cache read/write/hash error just falls through to a normal (uncached) check-all run.

CLI (debug):  uv run python3 writing-mechanical-gate.py /abs/project   # prints the would-be gate result
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = HOOKS_DIR.parent
CHECK_ALL = PLUGIN_ROOT / "references" / "constraints" / "check-all.py"
CACHE_REL = Path(".planning") / ".checkall-cache.json"

# Hooks run standalone (`uv run python3 <path>`) from an unknown cwd, so
# sys.path-insert this file's own directory before importing the sibling
# shared module rather than assuming a package/relative import will resolve.
sys.path.insert(0, str(HOOKS_DIR))
from _gate_common import deny, _project_from_args  # noqa: E402


def _constraint_files():
    """Every constraint script check-all.py can execute: plugin-wide references/constraints/*.py
    plus per-skill skills/*/references/*.py — the same universe check-all itself globs (see
    references/constraints/check-all.py). Sorted for a stable hash input."""
    files = list((PLUGIN_ROOT / "references" / "constraints").glob("*.py"))
    files += list(PLUGIN_ROOT.glob("skills/*/references/*.py"))
    files.append(CHECK_ALL)
    return sorted(set(files))


def _freshness_hash(project: str) -> str | None:
    """Hash of (path, mtime) over drafts/*.md + every constraint file — the cache is valid iff
    this is unchanged since the last successful run. Returns None (⇒ cache never matches / never
    trusted) on any filesystem error, so a hashing failure fails OPEN to a normal check-all run."""
    try:
        proj = Path(project)
        drafts = sorted((proj / "drafts").glob("*.md")) if (proj / "drafts").is_dir() else []
        stamps = [(str(p), p.stat().st_mtime) for p in drafts + _constraint_files() if p.is_file()]
        digest = hashlib.sha256(repr(sorted(stamps)).encode("utf-8")).hexdigest()
        return digest
    except Exception:
        return None


def _read_cache(project: str) -> dict | None:
    try:
        cache_path = Path(project) / CACHE_REL
        if not cache_path.is_file():
            return None
        return json.loads(cache_path.read_text())
    except Exception:
        return None


def _write_cache(project: str, ok: bool, failed: list, errors: list, summary: str, hash_: str) -> None:
    try:
        cache_path = Path(project) / CACHE_REL
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({
            "exit_ok": ok, "failed": failed, "errors": errors, "summary": summary, "hash": hash_,
        }))
    except Exception:
        pass  # caching is advisory-only; never fail the gate over a cache-write error


def _run_check_all_cached(project: str):
    """Return (ok, failed_names, error_names, summary, from_cache). Reuses the cached verdict from
    a prior successful run IFF the freshness hash still matches; otherwise runs check-all fresh and
    (re)writes the cache. Fail-open: any hashing/cache-read error just runs check-all fresh."""
    cur_hash = _freshness_hash(project)
    if cur_hash is not None:
        cached = _read_cache(project)
        if cached and cached.get("hash") == cur_hash:
            return (cached.get("exit_ok", True), cached.get("failed", []),
                    cached.get("errors", []), cached.get("summary", "(cached)"), True)
    ok, failed, errors, summary = _run_check_all(project)
    if cur_hash is not None:
        _write_cache(project, ok, failed, errors, summary, cur_hash)
    return ok, failed, errors, summary, False


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


def main():
    # CLI debug mode
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        ok, failed, errors, summary, from_cache = _run_check_all_cached(sys.argv[1])
        print(f"ok={ok} | {summary}" + (" [cached]" if from_cache else ""))
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

    project = _project_from_args(tool_input, hook_input)
    ok, failed, errors, summary, _from_cache = _run_check_all_cached(project)
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
