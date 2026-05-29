#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: block PLAN_REVIEWED.md approval unless the ds PLAN.md carries a
machine-EXECUTABLE Task Breakdown table.

`ds-implement` (the transform workflow) reads the Task Breakdown table directly:
it topologically sorts `Deps` (the data-flow DAG — which intermediates a task
consumes) into levels, runs each level output-first, and gates each task on its
`Verify` assertion exit code. A plan that records tasks as prose `### Task N`
headers (or leaves Deps/Outputs/Expected Output/Verify blank) is NOT executable.

This guard fires when something writes `.planning/PLAN_REVIEWED.md` (the approval
artifact ds-implement's gate checks). It validates the sibling PLAN.md's table
and DENIES the approval write if the table is missing or any row is incomplete.

Wired via ds-plan frontmatter (the orchestrator that writes PLAN_REVIEWED.md):
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-plan-executable-guard.py

Standalone:  uv run python3 ds-plan-executable-guard.py path/to/PLAN.md
"""

import json
import re
import sys
from pathlib import Path

REQUIRED = ("task", "deps", "outputs", "expected output", "verify", "implements")


def find_task_table(text: str):
    """Return (header_cells_lower, [row_cell_lists]) for the Task Breakdown table —
    the markdown table whose header has Task + Deps + Verify. (None, None) if absent."""
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("|") and "|" in line[1:]:
            header = [c.strip().lower() for c in line.strip("|").split("|")]
            sep = lines[i + 1].strip() if i + 1 < len(lines) else ""
            is_sep = bool(re.match(r"^\|?[\s:|-]+\|[\s:|-]+\|?$", sep)) and "-" in sep
            if is_sep and {"task", "deps", "verify"}.issubset(set(header)):
                rows = []
                j = i + 2
                while j < len(lines) and lines[j].strip().startswith("|"):
                    cells = [c.strip() for c in lines[j].strip().strip("|").split("|")]
                    rows.append(cells)
                    j += 1
                return header, rows
        i += 1
    return None, None


def col(header, cells, name):
    try:
        return cells[header.index(name)].strip().strip("`").strip()
    except (ValueError, IndexError):
        return ""


def validate_plan(plan_path: Path):
    if not plan_path.is_file():
        return [f"PLAN.md not found at {plan_path}"]
    text = plan_path.read_text()
    header, rows = find_task_table(text)
    if header is None:
        return ["No executable Task Breakdown table found (need a markdown table with "
                "columns Task | Deps | Outputs | Expected Output | Verify | Implements). "
                "The tasks appear to be recorded as prose `### Task N` headers, which "
                "ds-implement cannot parse into a data-flow DAG + per-task verify gate."]
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        return [f"Task Breakdown table is missing required column(s): {', '.join(missing)}."]

    violations = []
    task_nums = set()
    deps_map = {}
    for cells in rows:
        task = col(header, cells, "task")
        m = re.match(r"^(\d+)\.", task)
        if not m:
            violations.append(f"Task row '{task[:40]}' has no leading 'N.' number.")
            continue
        n = int(m.group(1))
        task_nums.add(n)
        deps = col(header, cells, "deps")
        if not deps:
            violations.append(f"Task {n}: Deps is empty (use `---` or `after N`/`after N,M`).")
        elif deps != "---":
            dm = re.match(r"^after\s+([\d,\s]+)$", deps, re.I)
            if not dm:
                violations.append(f"Task {n}: Deps '{deps}' is malformed (expected `---` or `after N[,M]`).")
            else:
                deps_map[n] = [int(x) for x in re.findall(r"\d+", dm.group(1))]
        else:
            deps_map[n] = []
        for name, label in (("outputs", "Outputs"), ("expected output", "Expected Output"),
                            ("verify", "Verify"), ("implements", "Implements")):
            val = col(header, cells, name)
            if not val or val.upper() == "N/A":
                violations.append(f"Task {n}: {label} is empty/N/A — required for an executable, output-first task.")

    for n, deps in deps_map.items():
        for d in deps:
            if d not in task_nums:
                violations.append(f"Task {n}: Deps references task {d}, which does not exist.")
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in deps_map}

    def has_cycle(u):
        color[u] = GREY
        for v in deps_map.get(u, []):
            if v not in color:
                continue
            if color[v] == GREY or (color[v] == WHITE and has_cycle(v)):
                return True
        color[u] = BLACK
        return False

    if any(color[n] == WHITE and has_cycle(n) for n in list(deps_map)):
        violations.append("Deps form a cycle — the data-flow graph must be a DAG (topological sort failed).")
    if not task_nums:
        violations.append("Task Breakdown table has no task rows.")
    return violations


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def main():
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        v = validate_plan(Path(sys.argv[1]))
        if v:
            print("PLAN NOT EXECUTABLE:\n- " + "\n- ".join(v))
            sys.exit(1)
        print("PLAN executable: Task Breakdown table is complete and the Deps DAG is valid.")
        sys.exit(0)

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if hook_input.get("tool_name", "") not in ("Write", "Edit"):
        sys.exit(0)
    file_path = hook_input.get("tool_input", {}).get("file_path", "")
    if not file_path or not file_path.endswith("PLAN_REVIEWED.md"):
        sys.exit(0)

    plan_path = Path(file_path).parent / "PLAN.md"
    violations = validate_plan(plan_path)
    if violations:
        deny(
            "GATE BLOCKED: ds PLAN.md is not machine-executable, so it cannot be "
            "approved for implementation.\n\n"
            f"`{plan_path}` problems:\n- " + "\n- ".join(violations) + "\n\n"
            "ds-implement reads the Task Breakdown table to build the data-flow DAG "
            "and per-task Verify gates. Fix the table (see ds-plan — Task | Deps | "
            "Outputs | Expected Output | Verify | Implements), then re-run the plan "
            "reviewer. Do NOT record tasks as prose `### Task N` headers."
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
