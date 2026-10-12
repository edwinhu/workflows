"""The one constraint CLI contract. bin/workflow-check runs every constraint through it:

    <constraint>.py --project-dir P [--plan X] [--files F ...]

stdout line 1 is the leg count `<name>: N <unit> examined` (work/scripts/leg-counts.sh); N = 0 carries
`— nothing in scope (<why>)`. Each finding follows on its own line as `path:line: <name> message`, the
path relative to P when it lies under it. Exit 0 pass, 1 findings, 2 could not run.

A checker decides relevance from what it is handed and checks every path it is handed: it never prunes
scratch/, worktrees or hidden directories. A directory in --files stands for every file beneath it.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

_LOC = re.compile(r"^(?P<path>.+?)(?::(?P<line>\d+))?(?::\s*|\s+—\s+)(?P<msg>.*)$", re.DOTALL)


def rel(path, root) -> str:
    """`path` (relative paths are taken from `root`) relative to `root` when it lies under it, else absolute."""
    p = Path(path)
    p, r = (p if p.is_absolute() else Path(root) / p).resolve(), Path(root).resolve()
    try:
        return str(p.relative_to(r))
    except ValueError:
        return str(p)


def parse(argv=None, flags=()):
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-dir", required=True)
    ap.add_argument("--plan")
    ap.add_argument("--files", nargs="*", default=[])
    for f in flags:
        ap.add_argument(f, action="store_true")
    return ap.parse_args(argv)


def expand(paths) -> list[Path]:
    """Every file named, absolute, a directory standing for all the files beneath it; a missing path is an error."""
    out: list[Path] = []
    for s in paths:
        p = Path(s).absolute()
        if p.is_dir():
            out += sorted(Path(d) / f for d, _, fs in os.walk(p) for f in fs)
        elif p.is_file():
            out.append(p)
        else:
            raise FileNotFoundError(s)
    return list(dict.fromkeys(out))


def finding(name: str, text: str, root) -> str:
    """A checker's `path[:line]: message` (or `path:line — message`) as `path:line: <name> message`."""
    m = _LOC.match(str(text))
    if not m:
        return f"{root}:1: {name} {text}"
    return f"{rel(m['path'], root)}:{m['line'] or 1}: {name} {m['msg'].strip()}"


def count_line(name: str, n: int, unit: str, why: str = "", detail: str = "") -> str:
    if n:
        return f"{name}: {n} {unit} examined" + (f" ({detail})" if detail else "")
    return f"{name}: 0 {unit} examined — nothing in scope ({why})"


def emit(name, n, unit, why, findings, root, waive=False, detail="") -> int:
    """Print the count line and the findings in contract form; return the exit code."""
    out = [finding(name, f, root) for f in findings]
    waived = []
    if waive and out:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from _ds_waivers import partition
        out, waived = partition(out, root, name)
    # a waived finding is counted on the count line, which the runner prints even when the check passes
    note = f"{len(waived)} finding(s) waived with a stated reason" if waived else ""
    print(count_line(name, n, unit, why, "; ".join(x for x in (detail, note) if x)))
    for f in out:
        print(f)
    return 1 if out else 0


def files_main(name, check, relevant, unit="file(s)", kind=".py file", waive=True, argv=None) -> int:
    """A checker over files: `check({"cwd", "files", "plan"})` sees only the files `relevant` keeps."""
    a = parse(argv)
    root = Path(a.project_dir)
    try:
        given = expand(a.files)
    except FileNotFoundError as e:
        print(f"COULD-NOT-RUN: {name}: no file named {e}", file=sys.stderr)
        return 2
    files = [p for p in given if relevant(p)]
    if not files:
        return emit(name, 0, unit, f"no {kind} among {len(given)} file(s) given", [], root)
    return emit(name, len(files), unit, "", check({"cwd": str(root), "files": files, "plan": a.plan}), root, waive)


def plan_main(name, check, argv=None) -> int:
    """A plan reader: in scope only when --plan names a plan; `check` returns `line: message` pairs."""
    a = parse(argv)
    root = Path(a.project_dir)
    if not a.plan:
        return emit(name, 0, "plan(s)", "no --plan given", [], root)
    plan = Path(a.plan)
    if not plan.is_file():
        print(f"COULD-NOT-RUN: {name}: no plan at {plan}", file=sys.stderr)
        return 2
    found = [f"{plan}:{line}: {msg}" for line, msg in check({"cwd": str(root), "plan": plan})]
    return emit(name, 1, "plan(s)", "", found, root)
