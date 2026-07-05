#!/usr/bin/env -S uv run python3
"""
ds-compile: deterministically compile a ds PLAN.md Task Breakdown table into a
lean, project-specific Workflow script (.planning/run.js) from the shared template.

NO LLM. This replaces ds-implement.js's per-call LLM "discovery" agent (and the one
misparse it produced). Parsing is via the shared tolerant parser ds_plan_table.py
(the same module the executable guard uses), so compile and gate never disagree.

Usage:
  ds_compile.py PLAN.md [--out RUN_JS] [--project DIR] [--template TPL]

Defaults: --out  <PLAN dir>/run.js
          --project  parent of the .planning dir holding PLAN.md
          --template workflows/templates/run-core.js (shared driver; resolved from this file)
          --fragment workflows/templates/ds-task.js (ds D1/D2 bodies spliced into the core)

The shared splice/hole-fill/node-check driver lives in scripts/lib/compile_core.py — this
file supplies only the ds-specific config (parser, spec-dict, level-modes, meta text, tier).

Exit 0 on success; non-zero (with violations on stderr) if the plan is not compilable.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from ds_plan_table import parse_plan, toposort, Task  # noqa: E402
from compile_core import CompileConfig, main as _core_main  # noqa: E402

_HERE = Path(__file__).resolve()
_TEMPLATES = _HERE.parents[2] / "workflows" / "templates"

# ds is isolation-safe (writes disjoint parquet/output paths in a data dir, no shared source tree),
# so a level runs in PARALLEL when its tasks write provably-disjoint, statically-known Outputs.
_ISOLATION_SAFE = True

# Optional Tier column (heavy|standard|trivial|methodology) -> (model, effort), overriding the
# _tier() keyword heuristic below when present (scripts/ds/ds_plan_table.py VALID_TIERS).
_TIER_COLUMN_MAP = {
    "heavy": ("sonnet", "medium"),
    "standard": ("sonnet", "medium"),
    "trivial": ("haiku", "low"),
    "methodology": ("sonnet", "high"),
}


def _static_output(path: str) -> bool:
    """An output is statically provable iff it names a concrete path — no glob/wildcard/brace
    and not a bare directory. A runtime-computed path is NOT provable → forces sequential."""
    p = (path or "").strip()
    return bool(p) and not any(c in p for c in "*?{}[]") and not p.endswith("/")


def _level_modes(levels: list[list[str]], by_id: dict[str, Task]) -> list[str]:
    """Per-level intraLevel flag (S2, compiler-DERIVED): 'parallel' iff isolation-safe AND every task's
    declared Outputs are statically known AND pairwise-disjoint across the level; else 'sequential'."""
    modes: list[str] = []
    for level in levels:
        tasks = [by_id[i] for i in level if i in by_id]
        outs_per_task = [[o for o in (t.outputs or [])] for t in tasks]
        all_static = all(all(_static_output(o) for o in outs) for outs in outs_per_task)
        flat = [o for outs in outs_per_task for o in outs]
        disjoint = len(flat) == len(set(flat))
        modes.append("parallel" if (_ISOLATION_SAFE and all_static and disjoint) else "sequential")
    return modes


def _tier(t: Task) -> tuple[str, str]:
    """Model tier + effort. Prefers an explicit author-declared Tier column value; falls back to
    the v1 keyword-sniffing heuristic when the column is absent or its cell is blank/unrecognized
    (scripts/ds/ds_plan_table.py Task.tier is None in both cases) — zero behavior change for
    existing plans without a Tier column.
    engineer/heavy → sonnet; trivial mechanical → haiku; methodology/pause → sonnet."""
    if t.tier and t.tier in _TIER_COLUMN_MAP:
        return _TIER_COLUMN_MAP[t.tier]

    text = (t.task_text or "").lower()
    heavy = t.kind == "engineer" or any(
        o.endswith((".parquet", ".parquet`")) or "master" in o.lower() for o in (t.outputs or []))
    trivial = (
        t.kind != "engineer"
        and len(t.outputs) <= 1
        and any(k in text for k in ("loader", "thin ", "caption", "rename", "wire the notebook", "import"))
        and "regression" not in text and "winsor" not in text
    )
    if t.pause_after or any(k in text for k in ("methodology", "method-", "r4b", "decide", "winsor")):
        return "sonnet", "high"
    if heavy:
        return "sonnet", "medium"
    if trivial:
        return "haiku", "low"
    return "sonnet", "medium"


def _spec_dict(t: Task) -> dict:
    tier, effort = _tier(t)
    return {
        "id": t.id, "name": t.name, "kind": t.kind, "deps": t.deps,
        "outputs": t.outputs, "expectedOutput": t.expected_output,
        "verify": t.verify, "implements": t.implements, "done": t.done,
        "pauseAfter": t.pause_after, "taskText": t.task_text,
        "tier": tier, "effort": effort,
    }


def _describe(n_tasks: int, n_levels: int, project_dir: Path) -> str:
    return (
        f"Compiled ds runner for {project_dir.name}: topo-runs {n_tasks} task(s) across "
        f"{n_levels} dependency level(s) with real parallelism, output-first, gating each on "
        f"its Verify exit code (independent probe), pausing at decisions. Generated by ds-compile "
        f"from PLAN.md — do not hand-edit; edit PLAN.md and recompile.")


def _global_constraints_hole(res) -> str:
    # ds has no Global Constraints section (dev-only prose hole).
    return json.dumps("")


CONFIG = CompileConfig(
    domain="ds",
    default_fragment_name="ds-task.js",
    parse_plan=parse_plan,
    toposort=toposort,
    spec_dict=_spec_dict,
    level_modes=_level_modes,
    level_modes_needs_by_id=True,
    run_name="ds-run",
    describe=_describe,
    global_constraints_hole=_global_constraints_hole,
    # ds is output-first: force the outputsProduced self-report (True, not merely !== false) —
    # the forcing function the pass-#9 extraction accidentally dropped when it made the field
    # domain-optional in the shared TRANSFORM_SCHEMA/pass logic.
    require_outputs_produced=True,
)


def main() -> int:
    return _core_main(CONFIG, _TEMPLATES)


if __name__ == "__main__":
    sys.exit(main())
