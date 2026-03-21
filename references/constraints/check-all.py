#!/usr/bin/env python3
"""check-all.py — auto-discovers and runs all constraint checks.

Discovers from two directories:
  - references/constraints/*.py       — plugin-wide constraints
  - skills/*/references/*.py          — skill-local constraints (co-located with their .md pairs)
"""
import importlib.util
import json
import sys
from pathlib import Path

_repo_root = Path(__file__).parent.parent.parent  # workflows/
_plugin_constraints_dir = Path(__file__).parent


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


def _run_checks(md_stems, py_paths, directory_label, context, results):
    for name in sorted(md_stems):
        qualified = f"{directory_label}/{name}"
        if name in py_paths:
            try:
                mod = import_check(py_paths[name])
                violations = mod.check(context)
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
    results = {"passed": [], "failed": [], "conventions": [], "errors": []}

    # --- Layer 1: plugin-wide constraints ---
    md_stems, py_paths = _discover(_plugin_constraints_dir, exclude_names={"check-all"})
    _run_checks(md_stems, py_paths, "constraints", context, results)

    # --- Layer 2: skill-local constraints (prefixed .py files in skills/*/references/) ---
    # Skill reference .md files are long source documents (Strunk, McCloskey, etc.), not
    # constraint definitions — so .py files here run unconditionally, no .md pairing required.
    skills_dir = _repo_root / "skills"
    if skills_dir.is_dir():
        for skill_refs in sorted(skills_dir.glob("*/references")):
            skill_name = skill_refs.parent.name
            py_files = sorted(skill_refs.glob("*.py"))
            for py_path in py_files:
                label = f"skills/{skill_name}/references/{py_path.stem}"
                try:
                    mod = import_check(py_path)
                    violations = mod.check(context)
                    if violations:
                        results["failed"].append({"name": label, "violations": violations})
                    else:
                        results["passed"].append(label)
                except Exception as e:
                    results["errors"].append({"name": label, "error": str(e)})

    total = len(results["passed"]) + len(results["failed"]) + len(results["conventions"]) + len(results["errors"])
    print(json.dumps(results, indent=2))
    print(
        f"\n{len(results['passed'])}/{total} passed, "
        f"{len(results['failed'])} failed, "
        f"{len(results['conventions'])} conventions (judgment-only), "
        f"{len(results['errors'])} errors"
    )
    sys.exit(1 if results["failed"] or results["errors"] else 0)


if __name__ == "__main__":
    main()
