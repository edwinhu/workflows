#!/usr/bin/env python3
"""node-check: every .js file handed in parses under `node --check`.

    node-check.py --project-dir P [--plan X] [--files F ...]   (the contract: checks/ds/constraints/_contract.py)

A workflow skill's workflow.js is loaded by `work`; a syntax error in it surfaces only when a run
starts. A file that is not .js is out of scope, and none handed in is an explicit empty scope.
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
WHERE = re.compile(r"^(?P<path>.+?):(?P<line>\d+)\s*$")


def check(ctx):
    node = shutil.which("node")
    if not node:
        print(f"COULD-NOT-RUN: {CONSTRAINT}: no `node` on PATH", file=sys.stderr)
        raise SystemExit(2)
    found = []
    for path in ctx["files"]:
        r = subprocess.run([node, "--check", str(path)], capture_output=True, text=True, check=False)
        if r.returncode == 0:
            continue
        err = r.stderr.strip().splitlines()
        m = WHERE.match(err[0]) if err else None
        why = next((ln.strip() for ln in err if re.match(r"^\w*Error\b", ln.strip())), err[-1] if err else f"exit {r.returncode}")
        found.append(f"{rel(path, ctx['cwd'])}:{m['line'] if m else 1}: {why}")
    return found


if __name__ == "__main__":
    raise SystemExit(files_main(CONSTRAINT, check, lambda p: p.suffix == ".js", kind=".js file", waive=False))
