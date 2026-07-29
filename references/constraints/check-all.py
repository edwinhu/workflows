#!/usr/bin/env -S uv run --with lxml python3
"""check-all.py — auto-discovers and runs all constraint checks.

NOTE: invoked with `--with lxml` because several constraint scripts (ai-anti-patterns
wikipedia-*, writing-general strunk, writing-legal volokh) import lxml. Without it they raise
"lxml is required" and land in `errors` — i.e. those prose checks silently DON'T run. Callers that
invoke this as `uv run python3 check-all.py` must also pass `--with lxml`.

Discovers from two directories:
  - references/constraints/*.py       — plugin-wide constraints
  - skills/*/references/*.py          — skill-local constraints (co-located with their .md pairs)

Domain filtering: reads {cwd}/.planning/ACTIVE_WORKFLOW.md for `style:` field.
  - writing-legal (Volokh)  → legal only
  - writing-econ (McCloskey) → econ only
  - writing-general (S&W)   → always
  - ai-anti-patterns         → always
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

_repo_root = Path(__file__).parent.parent.parent  # workflows/
_plugin_constraints_dir = Path(__file__).parent

DOMAIN_SKILL_MAP = {
    "writing-legal": {"legal"},
    "writing-econ": {"econ"},
}


def _find_active_workflow(cwd: str) -> Path | None:
    """Locate the nearest .planning/ACTIVE_WORKFLOW.md by walking UP from cwd.

    CRITICAL (the production wiring gap, opv-parity): the workshop mechanical leg runs check-all from
    the PRESENTATION dir, but ACTIVE_WORKFLOW.md lives at PROJECT-ROOT/.planning (the two-dir layout:
    projectRoot/.planning + projectRoot/presentation/). A non-walking `{cwd}/.planning` lookup returns
    None there → workflow undetected → "run all" → the phantoms still fire → gate still permanently-red.
    Walking up finds the project-root file from any subdir. Bounded at the filesystem root / $HOME.
    """
    home = Path.home()
    p = Path(cwd).resolve()
    for d in (p, *p.parents):
        aw = d / ".planning" / "ACTIVE_WORKFLOW.md"
        if aw.is_file():
            return aw
        if d == home or d == d.parent:  # stop at $HOME or filesystem root — don't escape upward
            break
    return None


def _detect_domain(cwd: str) -> str | None:
    """Read style from the nearest ACTIVE_WORKFLOW.md frontmatter (walks up — see _find_active_workflow)."""
    aw = _find_active_workflow(cwd)
    if aw is None:
        return None
    try:
        m = re.search(r"^style:\s*(\w+)", aw.read_text(encoding="utf-8"), re.MULTILINE)
        return m.group(1) if m else None
    except Exception:
        return None


def _detect_workflow(cwd: str) -> str | None:
    """Read `workflow:` from the nearest ACTIVE_WORKFLOW.md (walks up — fixes the two-dir wiring gap)."""
    aw = _find_active_workflow(cwd)
    if aw is None:
        return None
    try:
        m = re.search(r"^workflow:\s*([\w-]+)", aw.read_text(encoding="utf-8"), re.MULTILINE)
        return m.group(1) if m else None
    except Exception:
        return None


def _applies(applies_to, workflow) -> bool:
    """Honor a constraint's APPLIES_TO against the detected workflow (the documented gotcha:
    check-all previously IGNORED APPLIES_TO and ran every constraint on every project, so writing's
    authoring-lints fired on workshop decks → a permanently-red gate). Conservative by design:
      - no APPLIES_TO (missing/empty)  → RUN  (back-compat: missing ⇒ treated as [all])
      - "all" in APPLIES_TO            → RUN
      - workflow undetected (standalone / no ACTIVE_WORKFLOW) → RUN (can't scope safely)
      - else RUN iff some entry == workflow OR startswith(workflow + "-")
        (APPLIES_TO entries are SKILL names; a skill belongs to its workflow by name prefix:
         'writing-draft' ∈ 'writing', 'workshop-revise' ∈ 'workshop').

    DELIBERATELY DIFFERENT from load-constraints.py's `skill_matches()`, which dropped exactly this
    prefix rule on 2026-07-29. The two answer different questions and must not be unified:

      _applies(applies_to, WORKFLOW)   → "should this check RUN in this project?"
                                          A writing project must run writing-draft's checks, so
                                          family-prefix matching is correct here.
      skill_matches(applies_to, SKILL) → "should this skill LOAD this constraint's text?"
                                          /ds is brainstorm; loading ds-implement's rules costs
                                          context for a phase it never runs.

    Making these agree would stop a writing project from running its own phases' checks. If you are
    here because the two look inconsistent: that is intentional, and this comment is the reason.
    """
    if not applies_to:
        return True
    if "all" in applies_to:
        return True
    if not workflow:
        return True
    return any(e == workflow or e.startswith(workflow + "-") for e in applies_to)


def import_check(py_path):
    spec = importlib.util.spec_from_file_location(py_path.stem, py_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _discover(directory, exclude_names=None):
    """Return (md_stems, py_stems, py_paths) for a directory."""
    exclude_names = exclude_names or set()
    md_stems = {p.stem for p in directory.glob("*.md")}
    py_paths = {
        p.stem: p
        for p in directory.glob("*.py")
        if p.stem not in exclude_names
    }
    return md_stems, py_paths


def _run_checks(md_stems, py_paths, directory_label, context, results, workflow=None):
    for name in sorted(md_stems):
        qualified = f"{directory_label}/{name}"
        if name in py_paths:
            try:
                mod = import_check(py_paths[name])
            except Exception as e:
                results["errors"].append({"name": qualified, "error": str(e)})
                continue
            # A globbed .py with no check() callable is a helper/data module, not a constraint — skip,
            # don't error (fixes e.g. scored-tics-patterns riding the gate as a permanent error).
            check_fn = getattr(mod, "check", None)
            if not callable(check_fn):
                results["skipped"].append(f"{qualified} (no check() — not a constraint)")
                continue
            # Honor APPLIES_TO: skip constraints that don't apply to the current workflow.
            if not _applies(getattr(mod, "APPLIES_TO", None), workflow):
                results["skipped"].append(f"{qualified} (APPLIES_TO≠{workflow})")
                continue
            try:
                violations = check_fn(context)
                if violations:
                    results["failed"].append({"name": qualified, "violations": violations})
                else:
                    results["passed"].append(qualified)
            except Exception as e:
                results["errors"].append({"name": qualified, "error": str(e)})
        else:
            results["conventions"].append(qualified)


def main():
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    context = {"cwd": cwd}
    results = {"passed": [], "failed": [], "conventions": [], "errors": [], "skipped": []}

    domain = _detect_domain(cwd)
    workflow = _detect_workflow(cwd)

    # --- Layer 1: plugin-wide constraints (now APPLIES_TO-scoped to the detected workflow) ---
    md_stems, py_paths = _discover(_plugin_constraints_dir, exclude_names={"check-all"})
    _run_checks(md_stems, py_paths, "constraints", context, results, workflow)

    # --- Layer 2: skill-local constraints (prefixed .py files in skills/*/references/) ---
    # Skill reference .md files are long source documents (Strunk, McCloskey, etc.), not
    # constraint definitions — so .py files here run unconditionally, no .md pairing required.
    # Domain filtering: writing-legal runs only for legal, writing-econ only for econ.
    skills_dir = _repo_root / "skills"
    if skills_dir.is_dir():
        for skill_refs in sorted(skills_dir.glob("*/references")):
            skill_name = skill_refs.parent.name
            # Domain filter: skip domain-specific skills that don't match
            if domain and skill_name in DOMAIN_SKILL_MAP:
                if domain not in DOMAIN_SKILL_MAP[skill_name]:
                    results["skipped"].append(f"skills/{skill_name} (domain={domain})")
                    continue
            py_files = sorted(skill_refs.glob("*.py"))
            for py_path in py_files:
                label = f"skills/{skill_name}/references/{py_path.stem}"
                try:
                    mod = import_check(py_path)
                except Exception as e:
                    results["errors"].append({"name": label, "error": str(e)})
                    continue
                check_fn = getattr(mod, "check", None)
                if not callable(check_fn):
                    results["skipped"].append(f"{label} (no check() — not a constraint)")
                    continue
                if not _applies(getattr(mod, "APPLIES_TO", None), workflow):
                    results["skipped"].append(f"{label} (APPLIES_TO≠{workflow})")
                    continue
                try:
                    violations = check_fn(context)
                    if violations:
                        results["failed"].append({"name": label, "violations": violations})
                    else:
                        results["passed"].append(label)
                except Exception as e:
                    results["errors"].append({"name": label, "error": str(e)})

    total = len(results["passed"]) + len(results["failed"]) + len(results["conventions"]) + len(results["errors"]) + len(results["skipped"])
    print(json.dumps(results, indent=2))
    print(
        f"\n{len(results['passed'])}/{total} passed, "
        f"{len(results['failed'])} failed, "
        f"{len(results['conventions'])} conventions (judgment-only), "
        f"{len(results['skipped'])} skipped (domain filter), "
        f"{len(results['errors'])} errors"
    )
    sys.exit(1 if results["failed"] or results["errors"] else 0)


if __name__ == "__main__":
    main()
