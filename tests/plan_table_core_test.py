#!/usr/bin/env -S uv run python3
"""Shared S1 parser-core tests. Run: uv run python3 tests/plan_table_core_test.py
The ds/dev golden tests exercise the core via the domain parsers; this locks the
domain-agnostic contract directly (esp. the prefix-tolerant column match + the DAG)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "lib"))
from plan_table_core import (  # noqa: E402
    split_row, col_index, has_col, cell, canon_id, find_table, parse_deps,
    check_acyclic, toposort_ids,
)

P, F = 0, 0


def check(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print(f"  ok  {name}")
    else:
        F += 1; print(f"  FAIL {name} {extra}")


# split_row
check("split_row strips pipes + cells", split_row("| a | b | c |") == ["a", "b", "c"])

# split_row: a bare '|' shell pipe / regex-alternation inside backticks must NOT split the cell
# (split_row does NOT strip backticks — that's the domain parser's `cell()` helper's job — so
# the expected cells here are still backtick-wrapped, just not shifted into the wrong column)
check("split_row: shell pipe in backticks stays one cell",
      split_row("| 1 | `---` | `pytest -q | tail` | A-01 |")
      == ["1", "`---`", "`pytest -q | tail`", "A-01"])
check("split_row: regex alternation in backticks stays one cell",
      split_row("| 1 | `---` | `grep -E 'foo|bar'` | A-01 |")
      == ["1", "`---`", "`grep -E 'foo|bar'`", "A-01"])
# escaped \| is a literal pipe in the cell, not a separator (unescaped in the output)
check("split_row: escaped \\| unescaped, not a separator",
      split_row(r"| 1 | a\|b | c |") == ["1", "a|b", "c"])
# a plain row with no pipes/backticks/escapes is unchanged
check("split_row: plain row unchanged",
      split_row("| Task | Deps | Verify |") == ["Task", "Deps", "Verify"])

# prefix-tolerant column access (the dev 'failing test (write first)' case)
hdr = ["task", "deps", "failing test (write first)", "verify command"]
check("col_index exact", col_index(hdr, "task") == 0)
check("col_index prefix+paren", col_index(hdr, "failing test") == 2)
check("col_index prefix+space", col_index(["a", "verify command"], "verify command") == 1)
check("col_index absent", col_index(hdr, "files") == -1)
check("has_col prefix", has_col(hdr, "failing test") and not has_col(hdr, "outputs"))
check("cell prefix-tolerant", cell(hdr, ["1", "—", "TestX", "pytest"], "failing test") == "TestX")
check("cell absent → ''", cell(hdr, ["1"], "files") == "")

# canon_id: strip markdown, keep prefix+digits
check("canon_id **T1**", canon_id("**T1**") == "T1")
check("canon_id 1.", canon_id("1.") == "1")
check("canon_id bare", canon_id("T10") == "T10")

# find_table: located by exact required-header superset, with a separator row
DOC = """intro
| Task | Deps | Verify Command | Implements |
|------|------|----------------|------------|
| 1 | — | pytest | R1 |
| 2 | after 1 | pytest | R2 |
next
"""
h, rows = find_table(DOC, {"task", "deps", "verify command"})
check("find_table header", h == ["task", "deps", "verify command", "implements"], h)
check("find_table rows", len(rows) == 2, rows)
check("find_table miss → None", find_table(DOC, {"task", "deps", "outputs"}) == (None, None))

# find_table: a data row's Verify Command cell carrying a shell pipe must not corrupt later rows
DOC_PIPE = """| Task | Deps | Verify Command | Implements |
|------|------|----------------|------------|
| 1 | — | `pytest -q | tail` | R1 |
| 2 | after 1 | `grep -E 'foo|bar'` | R2 |
"""
h2, rows2 = find_table(DOC_PIPE, {"task", "deps", "verify command"})
check("find_table: piped verify cell doesn't shift columns", rows2[0] == ["1", "—", "`pytest -q | tail`", "R1"], rows2)
check("find_table: regex-alternation verify cell doesn't shift columns", rows2[1] == ["2", "after 1", "`grep -E 'foo|bar'`", "R2"], rows2)

# parse_deps: no-deps tokens, 'after' prefix, bare list, **markdown**
check("parse_deps none", parse_deps("—") == [] and parse_deps("none") == [] and parse_deps("") == [])
check("parse_deps after", parse_deps("after 1, 2") == ["1", "2"])
check("parse_deps bare md", parse_deps("**T1**, T2") == ["T1", "T2"])

# parse_deps: free text with an embedded digit must NOT become a phantom dep (P5/v5.68.3)
check("parse_deps: free text doesn't sweep in a phantom dep",
      parse_deps("T1 (needs config v2)") == ["T1"], parse_deps("T1 (needs config v2)"))
viol = []
deps = parse_deps("T1 (needs config v2)", viol, "Task 3: ")
check("parse_deps: non-conforming residue reported as a violation, not silently dropped",
      deps == ["T1"] and len(viol) >= 1 and "v2" not in deps and all("unparseable" in v for v in viol),
      (deps, viol))
check("parse_deps: violations is optional (default None → no crash, no reporting)",
      parse_deps("T1 (needs config v2)") == ["T1"])

# DAG: cycle detection + level toposort (deps already filtered to present ids)
check("acyclic: clean DAG false", check_acyclic({"1": [], "2": ["1"], "3": ["1", "2"]}) is False)
check("acyclic: cycle true", check_acyclic({"1": ["2"], "2": ["1"]}) is True)
levels = toposort_ids({"1": [], "2": ["1"], "3": ["1", "2"], "4": []})
check("toposort levels", levels == [["1", "4"], ["2"], ["3"]], levels)
# cycle-safe: a stuck graph emits remaining whole rather than looping forever
stuck = toposort_ids({"1": ["2"], "2": ["1"]})
check("toposort cycle-safe (terminates)", sorted(x for lvl in stuck for x in lvl) == ["1", "2"])

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
