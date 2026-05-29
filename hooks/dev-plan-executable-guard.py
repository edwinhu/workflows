#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: block PLAN_REVIEWED.md approval unless PLAN.md carries a
machine-EXECUTABLE Implementation Order table.

`dev-implement` (the transform workflow) reads the Implementation Order table
directly: it topologically sorts `Deps` into dependency levels, fans out one
worktree-isolated implementer per task, merges, and gates each task on its
`Verify Command` exit code. A plan that records the work as prose phase-headings
(or leaves Deps/Files/Verify Command blank) is NOT executable — the workflow
cannot parse a DAG or a per-task gate out of it.

This guard fires when something writes `.planning/PLAN_REVIEWED.md` (the approval
artifact dev-implement's gate checks). It validates the sibling PLAN.md's table
and DENIES the approval write if the table is missing or any row is incomplete.
Instructional "use the table" text was systematically ignored (a real reviewed
PLAN — happy-clawd — used prose phase-headings and passed); the hook is the
structural enforcement.

Wired via dev-plan-reviewer frontmatter:
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/dev-plan-executable-guard.py

Standalone:  uv run python3 dev-plan-executable-guard.py path/to/PLAN.md
"""

import json
import re
import sys
from pathlib import Path

REQUIRED = ("task", "deps", "files", "verify command", "implements")


def find_task_table(text: str):
    """Return (header_cells_lower, [row_cell_lists]) for the Implementation Order
    task table — the markdown table whose header has Task + Deps + Verify Command.
    Returns (None, None) if no such table exists."""
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("|") and "|" in line[1:]:
            header = [c.strip() for c in line.strip("|").split("|")]
            header_l = [h.lower() for h in header]
            # next line must be the markdown separator (---|---)
            sep = lines[i + 1].strip() if i + 1 < len(lines) else ""
            is_sep = bool(re.match(r"^\|?[\s:|-]+\|[\s:|-]+\|?$", sep)) and "-" in sep
            if is_sep and {"task", "deps"}.issubset(set(header_l)) and "verify command" in header_l:
                rows = []
                j = i + 2
                while j < len(lines) and lines[j].strip().startswith("|"):
                    cells = [c.strip() for c in lines[j].strip().strip("|").split("|")]
                    rows.append(cells)
                    j += 1
                return header_l, rows
        i += 1
    return None, None


def col(header, cells, name):
    """Value of a named column in a row, or '' if out of range."""
    try:
        return cells[header.index(name)].strip().strip("`").strip()
    except (ValueError, IndexError):
        return ""


def validate_plan(plan_path: Path):
    """Return list of human-readable violations ([] == executable)."""
    if not plan_path.is_file():
        return [f"PLAN.md not found at {plan_path}"]
    text = plan_path.read_text()
    header, rows = find_task_table(text)
    if header is None:
        return ["No executable Implementation Order table found "
                "(need a markdown table with columns Task | Deps | Files | "
                "Failing Test | Verify Command | Implements). The work appears "
                "to be recorded as prose/phase-headings, which dev-implement "
                "cannot parse into a DAG + per-task gate."]
    missing_cols = [c for c in REQUIRED if c not in header]
    if missing_cols:
        return [f"Implementation Order table is missing required column(s): "
                f"{', '.join(missing_cols)}."]

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
        files = col(header, cells, "files")
        verify = col(header, cells, "verify command")
        implements = col(header, cells, "implements")

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

        if not files:
            violations.append(f"Task {n}: Files is empty — name every file the task creates/edits (drives the worktree merge).")
        if not verify or verify.upper() == "N/A":
            violations.append(f"Task {n}: Verify Command is empty/N/A — every task needs a deterministic command whose exit-0 is its gate.")
        if not implements:
            violations.append(f"Task {n}: Implements is empty — map the task to SPEC requirement ID(s).")

    # Dependency integrity: references resolve + no cycles.
    for n, deps in deps_map.items():
        for d in deps:
            if d not in task_nums:
                violations.append(f"Task {n}: Deps references task {d}, which does not exist.")
    # cycle detection (DFS)
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
        violations.append("Deps form a cycle — the dependency graph must be a DAG (topological sort failed).")

    if not task_nums:
        violations.append("Implementation Order table has no task rows.")
    return violations


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def main():
    # Standalone CLI mode: validate a given PLAN.md, print report, exit 0/1.
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        v = validate_plan(Path(sys.argv[1]))
        if v:
            print("PLAN NOT EXECUTABLE:\n- " + "\n- ".join(v))
            sys.exit(1)
        print("PLAN executable: Implementation Order table is complete and the Deps DAG is valid.")
        sys.exit(0)

    # Hook mode.
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if hook_input.get("tool_name", "") not in ("Write", "Edit"):
        sys.exit(0)
    file_path = hook_input.get("tool_input", {}).get("file_path", "")
    if not file_path or not file_path.endswith("PLAN_REVIEWED.md"):
        sys.exit(0)  # only guards the approval artifact

    plan_path = Path(file_path).parent / "PLAN.md"
    violations = validate_plan(plan_path)
    if violations:
        deny(
            "GATE BLOCKED: PLAN.md is not machine-executable, so it cannot be "
            "approved for implementation.\n\n"
            f"`{plan_path}` problems:\n- " + "\n- ".join(violations) + "\n\n"
            "dev-implement reads the Implementation Order table to build the "
            "dependency DAG and per-task verify gates. Fix the table (see "
            "dev-design/references/plan-template.md — Task | Deps | Files | "
            "Failing Test | Verify Command | Implements), then re-run the plan "
            "reviewer. Do NOT record tasks as prose phase-headings."
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
