#!/usr/bin/env python3
"""The writing workflow's STRUCTURAL constraints, for hooks/writing-prose-check.ts.

    structural_constraints.py <workflow> --list
    structural_constraints.py <workflow> --project-dir P --files F ... [--plan X]

The set is the layout's -- `bin/workflow-check <workflow> --list`, so writing/legal is writing's
constraints and legal's -- minus what scripts/prose-audit.py owns: a module it reads pattern tables
from (its own discovery, table_modules, says which) or one that runs the audit itself (a module-level
PROSE_AUDIT). The hook reports those through the audit; running them here too would report every
finding twice. Nothing names a constraint, so one dropped under checks/writing/constraints/ is run.

--list prints {"structural": [...], "owned": [...]}. A run prints {"findings": [...], "couldNotRun":
[...]}: each finding `{"constraint", "line"}` with the constraint's own `path:line: ID message` line,
on the CLI contract (checks/ds/constraints/_contract.py). Exit 0 whenever it could judge, 2 when not.
"""
import argparse
import ast
import importlib.util
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "bin" / "workflow-check"
AUDIT = ROOT / "scripts" / "prose-audit.py"
FINDING = re.compile(r"^\S[^\n]*?:\d+: \S")
TIMEOUT = 60


def runs_audit(path: Path) -> bool:
    """Does the module bind PROSE_AUDIT at module level (it delegates to the audit engine)?"""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError, ValueError):
        return False
    return any(isinstance(n, (ast.Assign, ast.AnnAssign)) and any(
        isinstance(t, ast.Name) and t.id == "PROSE_AUDIT" for t in (n.targets if isinstance(n, ast.Assign) else [n.target]))
        for n in tree.body)


def split(workflow: str) -> tuple[list[str], list[str]]:
    ls = subprocess.run([sys.executable, str(RUNNER), workflow, "--list"], capture_output=True, text=True, check=False)
    if ls.returncode != 0:
        raise LookupError(ls.stderr.strip() or f"workflow-check {workflow} --list exit {ls.returncode}")
    constraints = [Path(c) for c in json.loads(ls.stdout)["constraints"]]
    spec = importlib.util.spec_from_file_location("prose_audit", AUDIT)
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    style = workflow.split("/", 1)[1] if "/" in workflow else "general"
    tables = {p.resolve() for _, p in audit.table_modules(style) if audit._module_tables(p)[1]}
    owned = [c for c in constraints if c.resolve() in tables or runs_audit(c)]
    return [str(c) for c in constraints if c not in owned], [str(c) for c in owned]


def run(path: str, project: str, files: list[str], plan: str | None) -> dict:
    cmd = [sys.executable, path, "--project-dir", project, *(["--plan", plan] if plan else []), "--files", *files]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT, cwd=project, check=False)
    except (subprocess.TimeoutExpired, OSError) as e:
        return {"constraint": Path(path).stem, "error": str(e)}
    if r.returncode not in (0, 1):
        return {"constraint": Path(path).stem, "error": f"exit {r.returncode}: {r.stderr.strip()[-300:]}"}
    return {"constraint": Path(path).stem, "lines": [ln for ln in r.stdout.splitlines()[1:] if FINDING.match(ln)]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("workflow")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--project-dir")
    ap.add_argument("--files", nargs="*", default=[])
    ap.add_argument("--plan")
    a = ap.parse_args()
    try:
        structural, owned = split(a.workflow)
    except (LookupError, ValueError, OSError) as e:
        print(f"structural_constraints: {e}", file=sys.stderr)
        return 2
    if a.list:
        print(json.dumps({"structural": structural, "owned": owned}))
        return 0
    if not a.project_dir or not a.files:
        print("structural_constraints: a run needs --project-dir and --files", file=sys.stderr)
        return 2
    with ThreadPoolExecutor(max(1, min(8, len(structural)))) as ex:
        results = list(ex.map(lambda c: run(c, os.path.abspath(a.project_dir), a.files, a.plan), structural))
    print(json.dumps({
        "findings": [{"constraint": r["constraint"], "line": ln} for r in results for ln in r.get("lines", [])],
        "couldNotRun": [f"{r['constraint']}: {r['error']}" for r in results if "error" in r],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
