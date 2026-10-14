#!/usr/bin/env python3
"""node-check: every .js file handed in parses under `node --check`; a Workflow script parses as the harness compiles it.

    node-check.py --project-dir P [--plan X] [--files F ...]   (the contract: checks/ds/constraints/_contract.py)

A workflow skill's workflow.js is loaded by `work`; a syntax error in it surfaces only when a run
starts. A Workflow script (first statement `export const meta`) is compiled by the harness as an
AsyncFunction body (skills/work/scripts/workflow-harness.mjs), where a top-level `return` and `await`
are legal, so it is checked that way; any other .js stays on `node --check`. A file that is not .js is out of scope, and none handed in is an explicit empty scope.
Exit 0 every .js parses, 1 one does not (each a `path:line: node-check <error>` finding), 2 no node.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ds" / "constraints"))  # the contract helper
from _contract import files_main, rel

CONSTRAINT = "node-check"
WORKFLOW_SCRIPT = re.compile(r"\A(?:\s|//[^\n]*\n|/\*.*?\*/)*export\s+const\s+meta\b", re.S)
# Compile (never run) the file's body as the harness does: `export` stripped, wrapped as an AsyncFunction.
AS_ASYNC_FUNCTION = (
    "const src = require('fs').readFileSync(process.argv[1], 'utf8').replace('export const meta =', 'const meta =');"
    "new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'phase', 'parallel', 'pipeline', 'log', src)"
)
FUNCTION_PREAMBLE = 2  # lines `new Function` prepends to the body, which its syntax errors count
WHERE = re.compile(r"^(?P<path>.+?):(?P<line>\d+)\s*$")


def check(ctx):
    node = shutil.which("node")
    if not node:
        print(f"COULD-NOT-RUN: {CONSTRAINT}: no `node` on PATH", file=sys.stderr)
        raise SystemExit(2)
    found = []
    for path in ctx["files"]:
        workflow = WORKFLOW_SCRIPT.match(path.read_text(errors="replace"))
        cmd = [node, "-e", AS_ASYNC_FUNCTION, str(path)] if workflow else [node, "--check", str(path)]
        r = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if r.returncode == 0:
            continue
        err = r.stderr.strip().splitlines()
        m = WHERE.match(err[0]) if err else None
        why = next((ln.strip() for ln in err if re.match(r"^\w*Error\b", ln.strip())), err[-1] if err else f"exit {r.returncode}")
        line = int(m["line"]) if m else 1
        found.append(f"{rel(path, ctx['cwd'])}:{max(1, line - FUNCTION_PREAMBLE) if workflow else line}: {why}")
    return found


if __name__ == "__main__":
    raise SystemExit(files_main(CONSTRAINT, check, lambda p: p.suffix == ".js", kind=".js file", waive=False))
