#!/usr/bin/env -S uv run python3
"""ds_compile._tier() Tier-column override tests. Run: uv run python3 tests/ds_compile_tier_test.py

Covers item 3 (deferred from PR #52): an OPTIONAL Tier column overrides the keyword-sniffing
_tier() heuristic when present and recognized; absence/blank/unrecognized falls back to the
heuristic untouched (zero behavior change for existing plans without the column).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ds"))
from ds_plan_table import parse_plan  # noqa: E402
from ds_compile import _tier  # noqa: E402

P, F = 0, 0


def check(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print(f"  ok  {name}")
    else:
        F += 1; print(f"  FAIL {name} {extra}")


HEADER_NO_TIER = "| Task | Deps | Outputs | Expected Output | Verify | Implements |\n|---|---|---|---|---|---|\n"
HEADER_TIER = "| Task | Deps | Outputs | Expected Output | Verify | Implements | Tier |\n|---|---|---|---|---|---|---|\n"


def tbl(header, *rows):
    return "# PLAN\n\n## Task Breakdown\n\n" + header + "".join(rows)


# 1. no Tier column: heuristic path unchanged (engineer + master output → heavy → sonnet/medium)
r = parse_plan(tbl(HEADER_NO_TIER,
    "| **T1** [engineer] Build master | — | `master.parquet` | x | `true` | D-01 |\n",
    "| **T2** [analyst] Rename thin loader | T1 | `b.txt` | x | `true` | D-02 |\n",
))
check("no-Tier: parse ok", r.ok, r.violations)
check("no-Tier heuristic: engineer+master ⇒ sonnet/medium", _tier(r.tasks[0]) == ("sonnet", "medium"), _tier(r.tasks[0]))
check("no-Tier heuristic: trivial rename ⇒ haiku/low", _tier(r.tasks[1]) == ("haiku", "low"), _tier(r.tasks[1]))

# 2. Tier column present and OVERRIDES a heuristic that would say otherwise
r = parse_plan(tbl(HEADER_TIER,
    # engineer+master would heuristically be heavy (sonnet/medium) — Tier=trivial overrides to haiku/low
    "| **T1** [engineer] Build master | — | `master.parquet` | x | `true` | D-01 | trivial |\n",
    # plain analyst rename would heuristically be trivial (haiku/low) — Tier=heavy overrides to sonnet/medium
    "| **T2** [analyst] Rename cols | T1 | `b.txt` | x | `true` | D-02 | heavy |\n",
    # Tier=methodology always maps to sonnet/high regardless of text
    "| **T3** [analyst] Plain step | T2 | `c.parquet` | x | `true` | D-03 | methodology |\n",
    # Tier=standard maps to sonnet/medium
    "| **T4** [analyst] Plain step 2 | T3 | `d.parquet` | x | `true` | D-04 | standard |\n",
))
check("Tier: parse ok", r.ok, r.violations)
check("Tier=trivial overrides engineer/master heuristic", _tier(r.tasks[0]) == ("haiku", "low"), _tier(r.tasks[0]))
check("Tier=heavy overrides trivial-rename heuristic", _tier(r.tasks[1]) == ("sonnet", "medium"), _tier(r.tasks[1]))
check("Tier=methodology ⇒ sonnet/high", _tier(r.tasks[2]) == ("sonnet", "high"), _tier(r.tasks[2]))
check("Tier=standard ⇒ sonnet/medium", _tier(r.tasks[3]) == ("sonnet", "medium"), _tier(r.tasks[3]))

# 3. Tier column present but blank/unrecognized cell ⇒ falls back to heuristic for that row
r = parse_plan(tbl(HEADER_TIER,
    "| **T1** [analyst] Rename thin loader | — | `a.txt` | x | `true` | D-01 |  |\n",
    "| **T2** [analyst] Rename thin loader | T1 | `b.txt` | x | `true` | D-02 | bogus |\n",
))
check("blank Tier cell falls back to heuristic", _tier(r.tasks[0]) == ("haiku", "low"), _tier(r.tasks[0]))
check("unrecognized Tier cell falls back to heuristic", _tier(r.tasks[1]) == ("haiku", "low"), _tier(r.tasks[1]))

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
