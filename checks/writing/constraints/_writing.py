"""What the writing constraints share: the one CLI contract and the prose reader.

The contract is checks/ds/constraints/_contract.py -- `<constraint>.py --project-dir P [--plan X] [--files F ...]`,
line 1 the count, each finding `path:line: <name> message`, exit 0 pass, 1 findings, 2 could not run. A writing
constraint checks every file it is handed whose type it reads, wherever it lies: it never looks for drafts/ itself.
A nested register's constraints (writing/legal, writing/econ) import this module from here.
"""
from __future__ import annotations

import fnmatch
import re
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[3]
for _d in (PLUGIN / "checks" / "ds" / "constraints", PLUGIN / "scripts"):
    if str(_d) not in sys.path:
        sys.path.insert(0, str(_d))

import prose_extract
from _contract import emit, expand, files_main, parse, rel

__all__ = ["PLUGIN", "emit", "expand", "guarded", "main", "markdown", "parse", "prose", "prose_extract",
           "rel", "table_main"]


def markdown(path: Path) -> bool:
    return path.suffix == ".md"


def prose(path: Path) -> bool:
    """A file prose_extract reads as a draft: .md, .markdown, .docx, .txt, .typ."""
    return any(fnmatch.fnmatchcase(path.name, g) for g in prose_extract.DRAFT_GLOBS)


def guarded(name, run) -> int:
    """run(), with a checker that raises reported as could-not-run (2), never as a finding."""
    try:
        return run()
    except Exception as e:  # noqa: BLE001 -- any crash is an unrun check, never a pass or a finding
        print(f"COULD-NOT-RUN: {name}: {type(e).__name__}: {e}", file=sys.stderr)
        return 2


def main(name, check, relevant, unit="file(s)", kind="prose file") -> int:
    """files_main over the files `relevant` keeps, guarded."""
    return guarded(name, lambda: files_main(name, check, relevant, unit=unit, kind=kind, waive=False))


def table_main(name, table, ignore_case=True) -> int:
    """A bare (regex, label) table as a constraint: every row over every prose line handed in."""
    rows = [(re.compile(p, re.MULTILINE | (re.IGNORECASE if ignore_case else 0)), label) for p, label in table]

    def check(context):
        cwd, out = Path(context["cwd"]), []
        for path in context["files"]:
            for i, line in prose_extract.iter_lines(path):
                out += [f"{rel(path, cwd)}:{i}: {label}" for rx, label in rows if rx.search(line)]
        return out

    return main(name, check, prose)
