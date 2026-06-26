#!/usr/bin/env -S uv run python3
"""
Shared, tolerant parser for the ds PLAN.md "Task Breakdown" table.

This is the deterministic replacement for ds-implement.js's LLM "discovery" agent.
The table is fully regex-parseable; the only reason an LLM was ever used is that it
tolerated format drift the strict guard rejected (real plans use `**T1**` ids and
`—` / bare-list deps, not the documented `1.` ids and `---` / `after N` deps).

This module is the single source of truth for "what the Task Breakdown table means."
It is imported by:
  - scripts/ds/ds_compile.py        (emits .planning/run.js)
  - hooks/ds-plan-executable-guard.py (validates the table at PLAN_REVIEWED approval)

so the compiler and the guard can never disagree about a plan.

CLI:  uv run python3 ds_plan_table.py path/to/PLAN.md       # pretty-print parsed tasks
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED_COLS = ("task", "deps", "outputs", "expected output", "verify", "implements")

# id token at the start of a Task cell: **T1**, T1, T1., 1., 1 — capture the bare key (e.g. "T1", "1")
_ID_RE = re.compile(r"^\s*\**\s*((?:[A-Za-z]+)?\d+)\s*\**\.?")
# a [engineer] / [analyst] role tag anywhere in the task cell
_KIND_RE = re.compile(r"\[(engineer|analyst)\]", re.I)
# done markers: a checked box `[x]` or a literal done marker
_DONE_RE = re.compile(r"`?\[x\]`?", re.I)
# tokens that mean "no dependencies"
_NO_DEPS = {"", "-", "--", "---", "—", "–", "n/a", "none", "—"}
# a dependency reference token inside the Deps cell: T1, 1, t10 …
_DEP_TOK_RE = re.compile(r"(?:[A-Za-z]+)?\d+")
# an inline pause marker in any cell: ⏸ PAUSE: <text>  (also accepts "PAUSE:" without the glyph)
_PAUSE_RE = re.compile(r"(?:⏸\s*)?PAUSE:\s*(.+?)(?:\s*$)", re.I)


@dataclass
class Task:
    id: str                      # canonical key, e.g. "T1" or "2"
    name: str                    # task cell text with the leading id token stripped
    kind: str                    # engineer | analyst | unspecified
    deps: list[str]              # canonical keys this task depends on
    outputs: list[str]
    expected_output: str
    verify: str
    implements: list[str]
    done: bool
    pause_after: str | None      # decision text if the row declares a ⏸ PAUSE marker, else None
    task_text: str               # full task cell, verbatim (for the implementer prompt)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "kind": self.kind, "deps": self.deps,
            "outputs": self.outputs, "expectedOutput": self.expected_output,
            "verify": self.verify, "implements": self.implements, "done": self.done,
            "pauseAfter": self.pause_after, "taskText": self.task_text,
        }


@dataclass
class ParseResult:
    tasks: list[Task] = field(default_factory=list)
    language: str = "unspecified"
    violations: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations and bool(self.tasks)


def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def find_task_table(text: str):
    """Return (header_cells_lower, [row_cell_lists]) for the table whose header has
    Task + Deps + Verify; (None, None) if absent. Same detection as the guard."""
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not (line.startswith("|") and "|" in line[1:]):
            continue
        header = [c.strip().lower() for c in line.strip("|").split("|")]
        sep = lines[i + 1].strip() if i + 1 < len(lines) else ""
        is_sep = bool(re.match(r"^\|?[\s:|-]+\|[\s:|-]+\|?$", sep)) and "-" in sep
        if is_sep and {"task", "deps", "verify"}.issubset(set(header)):
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].strip().startswith("|"):
                rows.append(_split_row(lines[j]))
                j += 1
            return header, rows
    return None, None


def _cell(header, cells, name) -> str:
    try:
        return cells[header.index(name)].strip()
    except (ValueError, IndexError):
        return ""


def _canon_id(token: str) -> str:
    """Normalise an id token to its canonical key: strip markdown, keep the prefix+digits."""
    m = _ID_RE.match(token)
    return m.group(1) if m else token.strip().strip("*").strip()


def _parse_language(text: str) -> str:
    m = re.search(r"Implementation Language\s*[:|]\s*([^\n|]+)", text, re.I)
    if not m:
        return "unspecified"
    val = m.group(1).strip().strip("`").strip()
    return val or "unspecified"


def parse_plan(text: str) -> ParseResult:
    res = ParseResult()
    res.language = _parse_language(text)
    header, rows = find_task_table(text)
    if header is None:
        res.violations.append(
            "No Task Breakdown table found (need a markdown table with columns "
            "Task | Deps | Outputs | Expected Output | Verify | Implements).")
        return res
    missing = [c for c in REQUIRED_COLS if c not in header]
    if missing:
        res.violations.append(f"Task Breakdown table missing column(s): {', '.join(missing)}.")
        return res

    seen: set[str] = set()
    for cells in rows:
        task_cell = _cell(header, cells, "task")
        m = _ID_RE.match(task_cell)
        if not m:
            res.violations.append(f"Task row '{task_cell[:40]}' has no leading id (e.g. `T1`, `1.`).")
            continue
        tid = m.group(1)
        if tid in seen:
            res.violations.append(f"Duplicate task id '{tid}'.")
        seen.add(tid)

        name = _ID_RE.sub("", task_cell, count=1).strip()
        name = re.sub(r"^\**\s*", "", name)  # strip a dangling bold close
        kind_m = _KIND_RE.search(task_cell)
        kind = kind_m.group(1).lower() if kind_m else "unspecified"
        done = bool(_DONE_RE.search(task_cell))

        deps_cell = _cell(header, cells, "deps")
        deps_norm = deps_cell.strip().strip("`").strip().lower()
        if deps_norm in _NO_DEPS:
            deps = []
        else:
            # tolerate `after T1, T2` and bare `T1, T2`
            body = re.sub(r"^after\s+", "", deps_cell.strip(), flags=re.I)
            deps = [_canon_id(t) for t in _DEP_TOK_RE.findall(body)]

        outputs_cell = _cell(header, cells, "outputs")
        outputs = [o.strip().strip("`").strip() for o in re.split(r"[;,]", outputs_cell) if o.strip()]
        expected = _cell(header, cells, "expected output")
        verify = _cell(header, cells, "verify").strip().strip("`").strip()
        impl_cell = _cell(header, cells, "implements")
        implements = [s.strip() for s in re.split(r"[;,]", impl_cell) if s.strip()]

        # pause marker: look in Expected Output first, then anywhere in the row
        pause = None
        for hay in (expected, task_cell):
            pm = _PAUSE_RE.search(hay)
            if pm:
                pause = pm.group(1).strip()
                break

        for label, val in (("Outputs", outputs_cell), ("Expected Output", expected),
                           ("Verify", verify), ("Implements", impl_cell)):
            if not val or val.upper() == "N/A":
                res.violations.append(f"Task {tid}: {label} is empty/N/A.")

        res.tasks.append(Task(
            id=tid, name=name, kind=kind, deps=deps, outputs=outputs,
            expected_output=expected, verify=verify, implements=implements,
            done=done, pause_after=pause, task_text=task_cell))

    ids = {t.id for t in res.tasks}
    for t in res.tasks:
        for d in t.deps:
            if d not in ids:
                res.violations.append(f"Task {t.id}: Deps references '{d}', which does not exist.")
    _check_acyclic(res)
    if not res.tasks:
        res.violations.append("Task Breakdown table has no task rows.")
    return res


def _check_acyclic(res: ParseResult) -> None:
    graph = {t.id: [d for d in t.deps if d in {x.id for x in res.tasks}] for t in res.tasks}
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}

    def visit(u) -> bool:
        color[u] = GREY
        for v in graph.get(u, []):
            if color.get(v) == GREY or (color.get(v) == WHITE and visit(v)):
                return True
        color[u] = BLACK
        return False

    if any(color[n] == WHITE and visit(n) for n in list(graph)):
        res.violations.append("Deps form a cycle — the data-flow graph must be a DAG.")


def toposort(tasks: list[Task]) -> list[list[str]]:
    """Return dependency levels: level k holds tasks whose deps are all in levels < k."""
    ids = {t.id for t in tasks}
    deps = {t.id: [d for d in t.deps if d in ids] for t in tasks}
    placed: set[str] = set()
    levels: list[list[str]] = []
    while len(placed) < len(tasks):
        layer = [tid for tid in deps if tid not in placed and all(d in placed for d in deps[tid])]
        if not layer:  # cycle (already reported) — avoid infinite loop
            layer = [tid for tid in deps if tid not in placed]
        levels.append(sorted(layer, key=lambda x: [int(n) for n in re.findall(r"\d+", x)] or [0]))
        placed.update(layer)
    return levels


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: ds_plan_table.py PLAN.md", file=sys.stderr)
        return 2
    text = Path(sys.argv[1]).read_text()
    res = parse_plan(text)
    out = {
        "language": res.language,
        "ok": res.ok,
        "violations": res.violations,
        "levels": toposort(res.tasks),
        "tasks": [t.to_dict() for t in res.tasks],
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if res.ok else 1


if __name__ == "__main__":
    sys.exit(main())
