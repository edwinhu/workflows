"""The elide checkers on the one constraint contract (checks/ds/constraints/_contract.py).

Each checker keeps its positional CLI, which skills/elide-case/scripts/check.sh drives leg by leg
with its per-reading flags. Given --project-dir it runs here instead, as bin/workflow-check runs it:
over the files it is handed, each relevant one judged by the checker's own logic, whose FAIL lines
become `path:line: <name> ...` findings. The checker's own output follows, indented, for a reader.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ds" / "constraints"))
from _contract import count_line, emit, expand, parse, rel

AT_LINE = re.compile(r"\bline (\d+)")


def wanted(argv=None) -> bool:
    """Contract mode: the runner always names --project-dir; the positional CLIs never take it."""
    return "--project-dir" in (sys.argv[1:] if argv is None else argv)


def findings_of(path: Path, text: str, marker=re.compile(r"\bFAIL\b")) -> list[str]:
    """Each line of a checker's output that `marker` flags, as `path:line: <the line>`."""
    out = []
    for ln in text.splitlines():
        if marker.search(ln):
            m = AT_LINE.search(ln)
            out.append(f"{path}:{m.group(1) if m else 1}: {ln.strip()}")
    return out


def run(name: str, relevant, judge, unit: str, kind: str, detail: str = "", argv=None) -> int:
    """`judge(path, ctx) -> (rc, findings, text)` over every file `relevant` keeps; a judge may
    append to ctx["notes"] what the count line should say it established.

    rc 0 passes, 1 carries its findings (`path:line: message`), anything else is a check that did
    not run, which makes the whole constraint exit 2: an unrun check is never a pass.
    """
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
    ctx = {"root": root, "plan": a.plan, "given": given}
    found, shown, broken = [], [], []
    for p in files:
        rc, fs, text = judge(p, ctx)
        if rc not in (0, 1):
            broken.append(f"{rel(p, root)}: {name} could not run (exit {rc})")
        elif rc == 1:
            found += fs or [f"{p}:1: exited 1"]
        if rc != 0 and text.strip():
            shown.append(f"  {rel(p, root)}:\n" + "\n".join(f"    {ln}" for ln in text.rstrip().splitlines()))
    detail = "; ".join(x for x in (detail, *ctx.get("notes", [])) if x)
    if broken:
        print(count_line(name, len(files), unit, detail=detail))
        print("\n".join(broken + shown))
        print(f"COULD-NOT-RUN: {name}: " + "; ".join(broken), file=sys.stderr)
        return 2
    rc = emit(name, len(files), unit, "", found, root, detail=detail)
    if shown:
        print("\n".join(shown))
    return rc
