#!/usr/bin/env python3
"""check-all.py — auto-discovers and runs all constraint checks in references/constraints/."""
import importlib.util
import json
import sys
from pathlib import Path

constraints_dir = Path(__file__).parent


def import_check(py_path):
    spec = importlib.util.spec_from_file_location(py_path.stem, py_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    context = {"cwd": cwd}

    md_stems = {p.stem for p in constraints_dir.glob("*.md")}
    py_stems = {p.stem for p in constraints_dir.glob("*.py") if p.stem != "check-all"}

    results = {"passed": [], "failed": [], "conventions": [], "errors": []}

    for name in sorted(md_stems):
        if name in py_stems:
            # Constraint — has check script, run it
            py_path = constraints_dir / f"{name}.py"
            try:
                mod = import_check(py_path)
                violations = mod.check(context)
                if violations:
                    results["failed"].append({"name": name, "violations": violations})
                else:
                    results["passed"].append(name)
            except Exception as e:
                results["errors"].append({"name": name, "error": str(e)})
        else:
            # Convention — no check script, flag for reviewer
            results["conventions"].append(name)

    print(json.dumps(results, indent=2))
    total = len(md_stems)
    print(
        f"\n{len(results['passed'])}/{total} passed, "
        f"{len(results['failed'])} failed, "
        f"{len(results['conventions'])} conventions (judgment-only), "
        f"{len(results['errors'])} errors"
    )
    sys.exit(1 if results["failed"] or results["errors"] else 0)


if __name__ == "__main__":
    main()
