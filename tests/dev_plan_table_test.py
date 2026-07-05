#!/usr/bin/env -S uv run python3
"""Tolerant dev-parser regression tests. Run: uv run python3 tests/dev_plan_table_test.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "dev"))
from dev_plan_table import parse_plan, toposort  # noqa: E402

P, F = 0, 0


def check(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print(f"  ok  {name}")
    else:
        F += 1; print(f"  FAIL {name} {extra}")


HEADER = ("| Task | Deps | Files | Failing Test | Verify Command | Implements |\n"
          "|---|---|---|---|---|---|\n")


def tbl(*rows, extra=""):
    return "# Implementation Plan\n\n## Implementation Order\n\n" + HEADER + "".join(rows) + extra


# 1. canonical plan-template format (N. ids, `---`, `after N`, N/A test)
r = parse_plan(tbl(
    "| 0. Test infra | `---` | `package.json` | N/A (meta) | `npm test -- --version` | INFRA-01 |\n",
    "| 1. Add types | `after 0` | `src/auth/types.ts` | N/A (types only) | `tsc --noEmit` | AUTH-01 |\n",
    "| 2. Service | `after 1` | `src/auth/service.ts, src/auth/service.test.ts` | `test_validate_session()` | `pytest tests/test_auth.py -v` | AUTH-01, AUTH-02 |\n",
    "| 3. Route | `after 1` | `src/routes/api.ts` | `test_api_endpoint()` | `pytest tests/test_api.py -v` | API-01 |\n",
))
check("canonical parses", r.ok, r.violations)
check("task0 id", r.tasks[0].id == "0")
check("task0 no deps (---)", r.tasks[0].deps == [])
check("task0 N/A test cell", r.tasks[0].failing_test == "N/A (meta)")
check("task1 deps after 0", r.tasks[1].deps == ["0"])
check("task2 two files", r.tasks[2].files == ["src/auth/service.ts", "src/auth/service.test.ts"])
check("task2 two implements", r.tasks[2].implements == ["AUTH-01", "AUTH-02"])
check("task2 test cell present", r.tasks[2].failing_test == "test_validate_session()")
check("task2 name stripped of id", r.tasks[2].name == "Service")

# 1b. toposort: 0 → 1 → {2,3} parallel level
levels = toposort(r.tasks)
check("level0 == [0]", levels[0] == ["0"], levels)
check("level1 == [1]", levels[1] == ["1"], levels)
check("level2 == [2,3] (same level)", levels[2] == ["2", "3"], levels)

# 2. tolerant drift: **bold** ids, em-dash deps, bare-list deps, [x] done, T-prefixed
r = parse_plan(tbl(
    "| **1.** `[x]` base | — | `a.ts` | `t_a()` | `npm test a` | R-01 |\n",
    "| **2.** masters | 1 | `b.ts` | `t_b()` | `npm test b` | R-02 |\n",
    "| 3. fan-in | 1, 2 | `c.ts` | `t_c()` | `npm test c` | R-03 |\n",
))
check("drift parses", r.ok, r.violations)
check("bold id 1", r.tasks[0].id == "1")
check("em-dash → no deps", r.tasks[0].deps == [])
check("done [x] flag", r.tasks[0].done is True)
check("done mark stripped from name", r.tasks[0].name == "base", r.tasks[0].name)
check("bare dep '1'", r.tasks[1].deps == ["1"])
check("bare-list fan-in 1,2", r.tasks[2].deps == ["1", "2"])

# 3. Global Constraints + Task Interfaces lifted
plan = tbl(
    "| 1. types | `---` | `t.ts` | N/A | `tsc --noEmit` | A-01 |\n",
    "| 2. svc | `after 1` | `s.ts` | `t_s()` | `npm test s` | A-02 |\n",
    extra=(
        "\n## Global Constraints\n\n- CON-1: all timestamps UTC\n- CON-2: no new deps without R4\n"
        "\n## Task Interfaces\n\n### Task 1\n- Consumes: —\n- Produces: `Session` type\n"
        "\n### Task 2\n- Consumes: `Session`\n- Produces: `validate()` in s.ts\n"),
)
r = parse_plan(plan)
check("constraints+interfaces plan parses", r.ok, r.violations)
check("global constraints lifted", "CON-1: all timestamps UTC" in r.global_constraints, r.global_constraints)
check("global constraints stop before Interfaces", "Consumes" not in r.global_constraints)
check("task1 interface block", "Produces: `Session` type" in r.tasks[0].interfaces, r.tasks[0].interfaces)
check("task2 interface block", "Consumes: `Session`" in r.tasks[1].interfaces, r.tasks[1].interfaces)
check("task1 interface doesn't leak task2", "validate()" not in r.tasks[0].interfaces)

# 4. rejections
r = parse_plan(tbl("| 1. x | `---` | | `t()` | `npm test` | A-01 |\n"))
check("empty Files rejected", not r.ok and any("Files is empty" in v for v in r.violations), r.violations)

r = parse_plan(tbl("| 1. x | `---` | `a.ts` | `t()` | | A-01 |\n"))
check("empty Verify rejected", not r.ok and any("Verify Command is empty" in v for v in r.violations), r.violations)

r = parse_plan(tbl(
    "| 1. x | `after 2` | `a.ts` | `t()` | `npm test` | A-01 |\n",
    "| 2. y | `after 1` | `b.ts` | `t()` | `npm test` | A-02 |\n",
))
check("cycle rejected", not r.ok and any("cycle" in v.lower() for v in r.violations), r.violations)

r = parse_plan(tbl("| 1. x | `after 9` | `a.ts` | `t()` | `npm test` | A-01 |\n"))
check("dangling dep rejected", not r.ok and any("does not exist" in v for v in r.violations), r.violations)

r = parse_plan("# Plan\n\nNo table here, just prose phases.\n")
check("no-table rejected", not r.ok and any("No executable" in v for v in r.violations), r.violations)

# table is detected (has task+deps+verify command) but is missing the Implements column
r = parse_plan("## Implementation Order\n\n| Task | Deps | Files | Failing Test | Verify Command |\n|---|---|---|---|---|\n| 1. x | `---` | `a` | `t()` | `npm test` |\n")
check("missing Implements column rejected", not r.ok and any("missing required column" in v for v in r.violations), r.violations)

# 5. ⏸ PAUSE marker lifted
r = parse_plan(tbl("| 1. x | `---` | `a.ts` | `t()` ⏸ PAUSE: confirm API shape | `npm test` | A-01 |\n"))
check("pause marker lifted", r.ok and r.tasks[0].pause_after == "confirm API shape", r.tasks[0].pause_after)

# 6. a Verify Command cell carrying a shell pipe must NOT shift later columns (P1/v5.68.3)
r = parse_plan(tbl(
    "| 1. x | `---` | `a.ts` | `t()` | `pytest -q | tail` | A-01 |\n",
))
check("piped verify cell parses", r.ok, r.violations)
check("piped verify cell preserved verbatim", r.tasks[0].verify == "pytest -q | tail", r.tasks[0].verify)
check("piped verify cell doesn't shift Implements", r.tasks[0].implements == ["A-01"], r.tasks[0].implements)

# 7. an em-dash/plain-dash Failing Test cell means NO test required (matches dev-task.js testRequired)
r = parse_plan(tbl(
    "| 1. x | `---` | `a.ts` | — | `npm test` | A-01 |\n",
    "| 2. y | `after 1` | `b.ts` | - | `npm test` | A-02 |\n",
))
check("em-dash failing-test cell parses", r.ok, r.violations)
check("em-dash failing-test cell preserved", r.tasks[0].failing_test == "—", r.tasks[0].failing_test)
check("plain-dash failing-test cell preserved", r.tasks[1].failing_test == "-", r.tasks[1].failing_test)

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
