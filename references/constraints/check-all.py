#!/usr/bin/env python3
"""check-all.py — auto-discovers and runs all constraint checks.

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


def _detect_domain(cwd: str) -> str | None:
    """Read style from ACTIVE_WORKFLOW.md frontmatter."""
    aw = Path(cwd) / ".planning" / "ACTIVE_WORKFLOW.md"
    if not aw.is_file():
        return None
    try:
        text = aw.read_text(encoding="utf-8")
        m = re.search(r"^style:\s*(\w+)", text, re.MULTILINE)
        return m.group(1) if m else None
    except Exception:
        return None


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
    results = {"passed": [], "failed": [], "conventions": [], "errors": [], "skipped": []}

    domain = _detect_domain(cwd)

    # --- Layer 1: plugin-wide constraints ---
    md_stems, py_paths = _discover(_plugin_constraints_dir, exclude_names={"check-all"})
    _run_checks(md_stems, py_paths, "constraints", context, results)

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
                    violations = mod.check(context)
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
