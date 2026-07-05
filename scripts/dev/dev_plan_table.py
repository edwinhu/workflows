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

so the compiler and the guard can never disagree about a plan. The domain-agnostic table
+ DAG mechanics live in scripts/lib/plan_table_core.py (shared seam S1); this module owns
the dev COLUMN-MAP + dev-specific logic.

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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from plan_table_core import (  # noqa: E402
    ID_RE, DONE_RE, PAUSE_RE, cell, has_col, canon_id,
    find_table, parse_deps, check_acyclic, toposort_ids,
)

REQUIRED_COLS = ("task", "deps", "files", "failing test", "verify command", "implements")
# dev detects its table by these exact header cells; columns accessed tolerantly (prefix-aware).
_TABLE_REQUIRED = {"task", "deps", "verify command"}
# "is a test required?" has exactly ONE owner: workflows/templates/dev-task.js's `testRequired`
# (it decides whether gateProbe/implementerPrompt demand a Failing Test). This parser does NOT
# duplicate that predicate — a second copy is how P2/v5.68.3 drifted (this parser's now-deleted
# `_TEST_NA` treated `—`/`-` as N/A while dev-task.js's regex did not, so a `—` cell compiled but
# could never satisfy the gate). Keep the N/A convention here in sync with dev-task.js by eye.


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


def find_task_table(text: str):
    """Locate the dev Implementation Order table (Task + Deps + Verify Command). Thin wrapper over
    the shared core so the guard and the compiler detect the same table."""
    return find_table(text, _TABLE_REQUIRED)


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
            cur_id, cur_lines = canon_id(m.group(1)), []
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
    missing = [c for c in REQUIRED_COLS if not has_col(header, c)]
    if missing:
        res.violations.append(
            f"Implementation Order table is missing required column(s): {', '.join(missing)}.")
        return res

    seen: set[str] = set()
    for cells in rows:
        task_cell = cell(header, cells, "task")
        m = ID_RE.match(task_cell)
        if not m:
            res.violations.append(f"Task row '{task_cell[:40]}' has no leading id (e.g. `1.`, `T1`).")
            continue
        tid = m.group(1)
        if tid in seen:
            res.violations.append(f"Duplicate task id '{tid}'.")
        seen.add(tid)

        name = ID_RE.sub("", task_cell, count=1).strip()
        name = re.sub(r"^\**\s*", "", name)  # strip a dangling bold close
        name = DONE_RE.sub("", name).strip().strip("`").strip()
        done = bool(DONE_RE.search(task_cell))

        deps = parse_deps(cell(header, cells, "deps"), res.violations, f"Task {tid}: ")

        files_cell = cell(header, cells, "files")
        files = [f.strip().strip("`").strip() for f in re.split(r"[;,]", files_cell) if f.strip()]
        failing_test = cell(header, cells, "failing test").strip().strip("`").strip()
        verify = cell(header, cells, "verify command").strip().strip("`").strip()
        impl_cell = cell(header, cells, "implements")
        implements = [s.strip() for s in re.split(r"[;,]", impl_cell) if s.strip()]

        # pause marker: look in Failing Test first, then anywhere in the row
        pause = None
        for hay in (failing_test, task_cell):
            pm = PAUSE_RE.search(hay)
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
    ids = {t.id for t in res.tasks}
    deps_map = {t.id: [d for d in t.deps if d in ids] for t in res.tasks}
    if check_acyclic(deps_map):
        res.violations.append("Deps form a cycle — the dependency graph must be a DAG.")


def toposort(tasks: list[Task]) -> list[list[str]]:
    """Return dependency levels: level k holds tasks whose deps are all in levels < k."""
    ids = {t.id for t in tasks}
    return toposort_ids({t.id: [d for d in t.deps if d in ids] for t in tasks})


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
