#!/usr/bin/env -S uv run python3
"""
Shared, tolerant parser for the dev PLAN.md "Implementation Order" table.

This is the deterministic replacement for dev-implement.js's LLM "discovery" agent.
The table is fully regex-parseable; the only reason an LLM was ever used is that it
tolerated format drift the strict guard rejected (the same disease ds had with
`**T1**` ids / em-dash deps — see docs/DESIGN-dev-spec-plan-compile.md §1.4).

This module is the single source of truth for "what the Implementation Order table
means." It is imported by:
  - scripts/dev/dev_compile.py            (emits .planning/run.js)
  - hooks/dev-plan-executable-guard.py    (validates the table at PLAN_REVIEWED approval)

so the compiler and the guard can never disagree about a plan.

dev columns (vs ds): Task | Deps | Files | Failing Test | Verify Command | Implements.
dev also carries two optional prose sections the ds plan lacks, which this parser lifts:
  - `## Global Constraints`  → bullet rules binding EVERY task (injected into every implementer)
  - `## Task Interfaces`     → per-task `### Task N` Consumes/Produces sub-blocks

CLI:  uv run python3 dev_plan_table.py path/to/PLAN.md      # pretty-print parsed tasks
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED_COLS = ("task", "deps", "files", "failing test", "verify command", "implements")

# id token at the start of a Task cell: **1**, 1, 1., T1 — capture the bare key (e.g. "1", "T1")
_ID_RE = re.compile(r"^\s*\**\s*((?:[A-Za-z]+)?\d+)\s*\**\.?")
# done markers: a checked box `[x]` or a literal done marker anywhere in the Task cell
_DONE_RE = re.compile(r"`?\[x\]`?", re.I)
# tokens that mean "no dependencies"
_NO_DEPS = {"", "-", "--", "---", "—", "–", "n/a", "none"}
# a dependency reference token inside the Deps cell: 1, T1, t10 …
_DEP_TOK_RE = re.compile(r"(?:[A-Za-z]+)?\d+")
# an inline pause marker in any cell: ⏸ PAUSE: <text>  (also accepts "PAUSE:" without the glyph)
_PAUSE_RE = re.compile(r"(?:⏸\s*)?PAUSE:\s*(.+?)(?:\s*$)", re.I)
# values that mean "no failing test required" (TDD N/A — types-only / meta tasks)
_TEST_NA = {"", "n/a", "na", "none", "—", "-"}


@dataclass
class Task:
    id: str                      # canonical key, e.g. "1" or "T1"
    name: str                    # task cell text with the leading id token stripped
    deps: list[str]              # canonical keys this task depends on
    files: list[str]             # files the task creates/edits (repo-relative)
    failing_test: str            # the test to write FIRST, or "N/A"
    verify: str                  # the deterministic command whose exit-0 is the per-task gate
    implements: list[str]        # SPEC requirement IDs
    done: bool
    pause_after: str | None      # decision text if the row declares a ⏸ PAUSE marker, else None
    interfaces: str              # this task's `### Task N` Consumes/Produces block, verbatim; "" if none
    task_text: str               # full task cell, verbatim (for the implementer prompt)

    @property
    def test_required(self) -> bool:
        norm = self.failing_test.strip().lower()
        # "N/A", "N/A (meta)", "N/A (types only)", "none" … all mean no test required
        return norm not in _TEST_NA and not re.match(r"^(n/?a|none)\b", norm)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "deps": self.deps, "files": self.files,
            "failingTest": self.failing_test, "verify": self.verify,
            "implements": self.implements, "done": self.done, "pauseAfter": self.pause_after,
            "interfaces": self.interfaces, "taskText": self.task_text,
        }


@dataclass
class ParseResult:
    tasks: list[Task] = field(default_factory=list)
    global_constraints: str = ""
    violations: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations and bool(self.tasks)


def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def find_task_table(text: str):
    """Return (header_cells_lower, [row_cell_lists]) for the table whose header has
    Task + Deps + Verify Command; (None, None) if absent. Same detection as the guard."""
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not (line.startswith("|") and "|" in line[1:]):
            continue
        header = [c.strip().lower() for c in line.strip("|").split("|")]
        sep = lines[i + 1].strip() if i + 1 < len(lines) else ""
        is_sep = bool(re.match(r"^\|?[\s:|-]+\|[\s:|-]+\|?$", sep)) and "-" in sep
        if is_sep and {"task", "deps"}.issubset(set(header)) and "verify command" in header:
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].strip().startswith("|"):
                rows.append(_split_row(lines[j]))
                j += 1
            return header, rows
    return None, None


def _col_index(header, name) -> int:
    """Index of the column whose header equals `name` or starts with it — tolerant of
    parenthetical/qualifier suffixes the plan-template uses (e.g. the header cell
    'failing test (write first)' satisfies the required column 'failing test'). -1 if absent."""
    for i, h in enumerate(header):
        if h == name or h.startswith(name + " ") or h.startswith(name + "("):
            return i
    return -1


def _has_col(header, name) -> bool:
    return _col_index(header, name) >= 0


def _cell(header, cells, name) -> str:
    i = _col_index(header, name)
    try:
        return cells[i].strip() if i >= 0 else ""
    except IndexError:
        return ""


def _canon_id(token: str) -> str:
    """Normalise an id token to its canonical key: strip markdown, keep prefix+digits."""
    m = _ID_RE.match(token)
    return m.group(1) if m else token.strip().strip("*").strip()


def _parse_section_body(text: str, heading_re: str) -> str:
    """Return the verbatim body of the first `## <heading>` section (up to the next
    `## ` heading or EOF), stripped; "" if the section is absent."""
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if re.match(heading_re, line.strip(), re.I):
            start = i + 1
            break
    if start is None:
        return ""
    body = []
    for line in lines[start:]:
        if re.match(r"^##\s+\S", line):  # next H2 ends the section (### sub-blocks stay in)
            break
        body.append(line)
    return "\n".join(body).strip()


def _parse_global_constraints(text: str) -> str:
    return _parse_section_body(text, r"^##\s+Global Constraints\b")


def _parse_task_interfaces(text: str) -> dict[str, str]:
    """Parse `## Task Interfaces` into {canonical_id: block_text}. Each block is a
    `### Task N` heading and the lines until the next `### ` or the section end."""
    section = _parse_section_body(text, r"^##\s+Task Interfaces\b")
    if not section:
        return {}
    out: dict[str, str] = {}
    cur_id, cur_lines = None, []
    for line in section.splitlines():
        m = re.match(r"^###\s+Task\s+\**\s*((?:[A-Za-z]+)?\d+)", line.strip(), re.I)
        if m:
            if cur_id is not None:
                out[cur_id] = "\n".join(cur_lines).strip()
            cur_id, cur_lines = _canon_id(m.group(1)), []
        elif cur_id is not None:
            cur_lines.append(line)
    if cur_id is not None:
        out[cur_id] = "\n".join(cur_lines).strip()
    return out


def parse_plan(text: str) -> ParseResult:
    res = ParseResult()
    res.global_constraints = _parse_global_constraints(text)
    interfaces = _parse_task_interfaces(text)
    header, rows = find_task_table(text)
    if header is None:
        res.violations.append(
            "No executable Implementation Order table found (need a markdown table with columns "
            "Task | Deps | Files | Failing Test | Verify Command | Implements). The work appears to "
            "be recorded as prose/phase-headings, which dev-implement cannot parse into a DAG + "
            "per-task gate.")
        return res
    missing = [c for c in REQUIRED_COLS if not _has_col(header, c)]
    if missing:
        res.violations.append(
            f"Implementation Order table is missing required column(s): {', '.join(missing)}.")
        return res

    seen: set[str] = set()
    for cells in rows:
        task_cell = _cell(header, cells, "task")
        m = _ID_RE.match(task_cell)
        if not m:
            res.violations.append(f"Task row '{task_cell[:40]}' has no leading id (e.g. `1.`, `T1`).")
            continue
        tid = m.group(1)
        if tid in seen:
            res.violations.append(f"Duplicate task id '{tid}'.")
        seen.add(tid)

        name = _ID_RE.sub("", task_cell, count=1).strip()
        name = re.sub(r"^\**\s*", "", name)  # strip a dangling bold close
        name = _DONE_RE.sub("", name).strip().strip("`").strip()
        done = bool(_DONE_RE.search(task_cell))

        deps_cell = _cell(header, cells, "deps")
        deps_norm = deps_cell.strip().strip("`").strip().lower()
        if deps_norm in _NO_DEPS:
            deps = []
        else:
            body = re.sub(r"^after\s+", "", deps_cell.strip(), flags=re.I)
            deps = [_canon_id(t) for t in _DEP_TOK_RE.findall(body)]

        files_cell = _cell(header, cells, "files")
        files = [f.strip().strip("`").strip() for f in re.split(r"[;,]", files_cell) if f.strip()]
        failing_test = _cell(header, cells, "failing test").strip().strip("`").strip()
        verify = _cell(header, cells, "verify command").strip().strip("`").strip()
        impl_cell = _cell(header, cells, "implements")
        implements = [s.strip() for s in re.split(r"[;,]", impl_cell) if s.strip()]

        # pause marker: look in Failing Test first, then anywhere in the row
        pause = None
        for hay in (failing_test, task_cell):
            pm = _PAUSE_RE.search(hay)
            if pm:
                pause = pm.group(1).strip()
                break

        # Required-cell checks (Files / Verify / Implements always required; Failing Test may be N/A).
        if not files_cell:
            res.violations.append(
                f"Task {tid}: Files is empty — name every file the task creates/edits.")
        if not verify or verify.upper() == "N/A":
            res.violations.append(
                f"Task {tid}: Verify Command is empty/N/A — every code task needs a deterministic "
                f"command whose exit-0 is its gate.")
        if not impl_cell:
            res.violations.append(
                f"Task {tid}: Implements is empty — map the task to SPEC requirement ID(s).")
        if not failing_test:
            res.violations.append(
                f"Task {tid}: Failing Test is empty — write the test name, or `N/A` for "
                f"types-only/meta tasks.")

        res.tasks.append(Task(
            id=tid, name=name, deps=deps, files=files, failing_test=failing_test or "N/A",
            verify=verify, implements=implements, done=done, pause_after=pause,
            interfaces=interfaces.get(tid, ""), task_text=task_cell))

    ids = {t.id for t in res.tasks}
    for t in res.tasks:
        for d in t.deps:
            if d not in ids:
                res.violations.append(f"Task {t.id}: Deps references '{d}', which does not exist.")
    _check_acyclic(res)
    if not res.tasks:
        res.violations.append("Implementation Order table has no task rows.")
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
        res.violations.append("Deps form a cycle — the dependency graph must be a DAG.")


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
        print("usage: dev_plan_table.py PLAN.md", file=sys.stderr)
        return 2
    text = Path(sys.argv[1]).read_text()
    res = parse_plan(text)
    out = {
        "ok": res.ok,
        "violations": res.violations,
        "globalConstraints": res.global_constraints,
        "levels": toposort(res.tasks),
        "tasks": [t.to_dict() for t in res.tasks],
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if res.ok else 1


if __name__ == "__main__":
    sys.exit(main())
