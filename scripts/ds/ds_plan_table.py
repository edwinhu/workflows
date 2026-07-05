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

so the compiler and the guard can never disagree about a plan. The domain-agnostic table
+ DAG mechanics live in scripts/lib/plan_table_core.py (shared seam S1); this module owns
the ds COLUMN-MAP + ds-specific logic (kind tag, language, output/verify validation).

CLI:  uv run python3 ds_plan_table.py path/to/PLAN.md       # pretty-print parsed tasks
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from plan_table_core import (  # noqa: E402
    ID_RE, DONE_RE, PAUSE_RE, cell, has_col, find_table, parse_deps, check_acyclic, toposort_ids,
)

REQUIRED_COLS = ("task", "deps", "outputs", "expected output", "verify", "implements")
# ds detects its table by these exact header cells (Deps + Verify present); columns accessed tolerantly.
_TABLE_REQUIRED = {"task", "deps", "verify"}
# ds-only: a [engineer] / [analyst] role tag anywhere in the task cell
_KIND_RE = re.compile(r"\[(engineer|analyst)\]", re.I)
# OPTIONAL Tier column (heavy|standard|trivial|methodology) — an author-declared override for
# ds_compile._tier()'s keyword-sniffing heuristic. Absent column or unrecognized/blank cell value
# falls back to the heuristic untouched (zero behavior change for existing plans).
VALID_TIERS = {"heavy", "standard", "trivial", "methodology"}


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
    tier: str | None = None      # optional author-declared Tier column value (heavy|standard|trivial|methodology)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "kind": self.kind, "deps": self.deps,
            "outputs": self.outputs, "expectedOutput": self.expected_output,
            "verify": self.verify, "implements": self.implements, "done": self.done,
            "pauseAfter": self.pause_after, "taskText": self.task_text, "tier": self.tier,
        }


@dataclass
class ParseResult:
    tasks: list[Task] = field(default_factory=list)
    language: str = "unspecified"
    violations: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations and bool(self.tasks)


def find_task_table(text: str):
    """Locate the ds Task Breakdown table (Task + Deps + Verify). Thin wrapper over the shared
    core so the guard and the compiler detect the same table."""
    return find_table(text, _TABLE_REQUIRED)


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
    missing = [c for c in REQUIRED_COLS if not has_col(header, c)]
    if missing:
        res.violations.append(f"Task Breakdown table missing column(s): {', '.join(missing)}.")
        return res

    seen: set[str] = set()
    for cells in rows:
        task_cell = cell(header, cells, "task")
        m = ID_RE.match(task_cell)
        if not m:
            res.violations.append(f"Task row '{task_cell[:40]}' has no leading id (e.g. `T1`, `1.`).")
            continue
        tid = m.group(1)
        if tid in seen:
            res.violations.append(f"Duplicate task id '{tid}'.")
        seen.add(tid)

        name = ID_RE.sub("", task_cell, count=1).strip()
        name = re.sub(r"^\**\s*", "", name)  # strip a dangling bold close
        kind_m = _KIND_RE.search(task_cell)
        kind = kind_m.group(1).lower() if kind_m else "unspecified"
        done = bool(DONE_RE.search(task_cell))

        deps = parse_deps(cell(header, cells, "deps"), res.violations, f"Task {tid}: ")

        outputs_cell = cell(header, cells, "outputs")
        outputs = [o.strip().strip("`").strip() for o in re.split(r"[;,]", outputs_cell) if o.strip()]
        expected = cell(header, cells, "expected output")
        verify = cell(header, cells, "verify").strip().strip("`").strip()
        impl_cell = cell(header, cells, "implements")
        implements = [s.strip() for s in re.split(r"[;,]", impl_cell) if s.strip()]

        # pause marker: look in Expected Output first, then anywhere in the row
        pause = None
        for hay in (expected, task_cell):
            pm = PAUSE_RE.search(hay)
            if pm:
                pause = pm.group(1).strip()
                break

        for label, val in (("Outputs", outputs_cell), ("Expected Output", expected),
                           ("Verify", verify), ("Implements", impl_cell)):
            if not val or val.upper() == "N/A":
                res.violations.append(f"Task {tid}: {label} is empty/N/A.")

        tier_val = None
        if has_col(header, "tier"):
            raw_tier = cell(header, cells, "tier").strip().strip("`").strip().lower()
            if raw_tier in VALID_TIERS:
                tier_val = raw_tier

        res.tasks.append(Task(
            id=tid, name=name, kind=kind, deps=deps, outputs=outputs,
            expected_output=expected, verify=verify, implements=implements,
            done=done, pause_after=pause, task_text=task_cell, tier=tier_val))

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
    ids = {t.id for t in res.tasks}
    deps_map = {t.id: [d for d in t.deps if d in ids] for t in res.tasks}
    if check_acyclic(deps_map):
        res.violations.append("Deps form a cycle — the data-flow graph must be a DAG.")


def toposort(tasks: list[Task]) -> list[list[str]]:
    """Return dependency levels: level k holds tasks whose deps are all in levels < k."""
    ids = {t.id for t in tasks}
    return toposort_ids({t.id: [d for d in t.deps if d in ids] for t in tasks})


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
