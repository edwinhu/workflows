#!/usr/bin/env -S uv run python3
"""Tolerant-parser regression tests. Run: uv run python3 tests/ds_plan_table_test.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ds"))
from ds_plan_table import parse_plan, toposort  # noqa: E402

P, F = 0, 0


def check(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print(f"  ok  {name}")
    else:
        F += 1; print(f"  FAIL {name} {extra}")


HEADER = "| Task | Deps | Outputs | Expected Output | Verify | Implements |\n|---|---|---|---|---|---|\n"


def tbl(*rows):
    return "# PLAN\n\n## Task Breakdown\n\n" + HEADER + "".join(rows)


# 1. bold T-ids + bare/em-dash deps (the muni format the strict guard rejects)
r = parse_plan(tbl(
    "| **T1** `[x]` — base | — | `a.parquet` | non-empty | `python -c \"assert 1\"` | D-01 |\n",
    "| **T2** [engineer] — masters | T1 | `b.parquet` | rows | `python -c \"assert 1\"` | D-02 |\n",
))
check("muni-format parses", r.ok, r.violations)
check("T1 id", r.tasks[0].id == "T1")
check("T1 no deps (em-dash)", r.tasks[0].deps == [])
check("T1 done flag", r.tasks[0].done is True)
check("T2 deps bare T1", r.tasks[1].deps == ["T1"])
check("T2 kind engineer", r.tasks[1].kind == "engineer")

# 2. numeric ids + `---` + `after N,M` (the documented format)
r = parse_plan(tbl(
    "| 1. base | --- | `a` | x | `true` | D-01 |\n",
    "| 2. mid | after 1 | `b` | x | `true` | D-02 |\n",
    "| 3. join | after 1, 2 | `c` | x | `true` | D-03 |\n",
))
check("documented-format parses", r.ok, r.violations)
check("numeric ids", [t.id for t in r.tasks] == ["1", "2", "3"])
check("after 1,2 → deps", r.tasks[2].deps == ["1", "2"])
check("topo levels", toposort(r.tasks) == [["1"], ["2"], ["3"]])

# 3. pause marker lifted from Expected Output
r = parse_plan(tbl(
    "| T1 — x | — | `a` | done ⏸ PAUSE: confirm grain | `true` | D-01 |\n",
))
check("pause lifted", r.tasks[0].pause_after == "confirm grain", r.tasks[0].pause_after)

# 4. parallelism: independent branches share a level
r = parse_plan(tbl(
    "| A1 | — | `a` | x | `true` | D-01 |\n",
    "| B1 | A1 | `b` | x | `true` | D-02 |\n",
    "| C1 | A1 | `c` | x | `true` | D-03 |\n",
    "| D1 | B1, C1 | `d` | x | `true` | D-04 |\n",
))
check("B1,C1 parallel level", toposort(r.tasks) == [["A1"], ["B1", "C1"], ["D1"]], toposort(r.tasks))

# 5. cycle detected
r = parse_plan(tbl(
    "| X1 | Y1 | `a` | x | `true` | D-01 |\n",
    "| Y1 | X1 | `b` | x | `true` | D-02 |\n",
))
check("cycle flagged", any("cycle" in v.lower() for v in r.violations), r.violations)

# 6. missing required cell flagged
r = parse_plan(tbl("| T1 — x | — | `a` | x |  | D-01 |\n"))
check("empty Verify flagged", any("Verify" in v for v in r.violations), r.violations)

# 7. dangling dep flagged
r = parse_plan(tbl("| T1 — x | T9 | `a` | x | `true` | D-01 |\n"))
check("dangling dep flagged", any("does not exist" in v for v in r.violations), r.violations)

# 8. real muni plan
muni = Path.home() / "projects/muni-pennying/.planning/PLAN.md"
if muni.is_file():
    r = parse_plan(muni.read_text())
    check("muni real plan ok", r.ok, r.violations[:2])
    check("muni 10 tasks", len(r.tasks) == 10, len(r.tasks))
    check("muni T2∥T5 in level 1", toposort(r.tasks)[1] == ["T2", "T5"], toposort(r.tasks)[1])
else:
    print("  skip muni real plan (not present)")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
