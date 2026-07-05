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

Exit 0 on success; non-zero (with violations on stderr) if the plan is not compilable.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ds_plan_table import parse_plan, toposort, Task  # noqa: E402

_HERE = Path(__file__).resolve()
_TEMPLATES = _HERE.parents[2] / "workflows" / "templates"
_DEFAULT_TEMPLATE = _TEMPLATES / "run-core.js"        # shared driver/helpers/schema (pass #9)
_DEFAULT_FRAGMENT = _TEMPLATES / "ds-task.js"          # ds D1/D2 bodies spliced into __TASK_BODIES__

# ds is isolation-safe (writes disjoint parquet/output paths in a data dir, no shared source tree),
# so a level runs in PARALLEL when its tasks write provably-disjoint, statically-known Outputs.
_ISOLATION_SAFE = True


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
    """Heuristic model tier + effort (v1; overridable later via a Tip/Tier column).
    engineer/heavy → sonnet; trivial mechanical → haiku; methodology/pause → sonnet."""
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


def _js_literal(value) -> str:
    """JSON is a subset of JS object/array literal syntax — safe to inject."""
    return json.dumps(value, ensure_ascii=False, indent=2)


def _node_check(path: Path) -> bool:
    """`node --check` the emitted run.js — a splice has more failure modes than a single-file fill.
    Skips silently (returns True) if node is unavailable."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        return True
    proc = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"node --check FAILED on {path}:\n{proc.stderr}", file=sys.stderr)
    return proc.returncode == 0


def compile_plan(plan_path: Path, out_path: Path, project_dir: Path,
                 template_path: Path, fragment_path: Path) -> int:
    text = plan_path.read_text()
    res = parse_plan(text)
    if not res.ok:
        print("PLAN NOT COMPILABLE:\n- " + "\n- ".join(res.violations), file=sys.stderr)
        return 1

    specs = [_spec_dict(t) for t in res.tasks]
    levels = toposort(res.tasks)
    by_id = {t.id: t for t in res.tasks}
    level_modes = _level_modes(levels, by_id)
    pauses = [s["id"] for s in specs if s["pauseAfter"]]

    meta = {
        "name": "ds-run",
        "description": (
            f"Compiled ds runner for {project_dir.name}: topo-runs {len(specs)} task(s) across "
            f"{len(levels)} dependency level(s) with real parallelism, output-first, gating each on "
            f"its Verify exit code (independent probe), pausing at decisions. Generated by ds-compile "
            f"from PLAN.md — do not hand-edit; edit PLAN.md and recompile."),
        "phases": [{"title": f"Level {i}", "detail": " ".join(levels[i])} for i in range(len(levels))]
                  + [{"title": "Gate", "detail": "independent probe of each Verify exit code"}],
    }

    template = template_path.read_text()
    fragment = fragment_path.read_text()

    # 1. splice the per-domain fragment into __TASK_BODIES__ FIRST (exactly-once), so the
    #    exactly-once assertion for the data holes runs over the SPLICED result (catches a hole
    #    token leaking out of the fragment into the core).
    body_hole = "/*__TASK_BODIES__*/"
    if template.count(body_hole) != 1:
        print(f"Template {template_path}: hole {body_hole} appears {template.count(body_hole)}× (expected 1).", file=sys.stderr)
        return 2
    template = template.replace(body_hole, fragment, 1)

    # 2. ds has no Global Constraints; LEVEL_MODES is the compiler-derived intraLevel flag.
    #    ds is output-first: force the outputsProduced self-report (True, not merely !== false) —
    #    the forcing function the pass-#9 extraction accidentally dropped when it made the field
    #    domain-optional in the shared TRANSFORM_SCHEMA/pass logic.
    holes = {"/*__META__*/": _js_literal(meta),
             "/*__PROJECT__*/": json.dumps(str(project_dir)),
             "/*__TASKS__*/": _js_literal(specs),
             "/*__GLOBAL_CONSTRAINTS__*/": json.dumps(""),
             "/*__LEVEL_MODES__*/": _js_literal(level_modes),
             "/*__REQUIRE_OUTPUTS_PRODUCED__*/": _js_literal(True)}
    for hole in holes:
        n = template.count(hole)
        if n != 1:
            print(f"After splice: hole {hole} appears {n}× (expected exactly 1). "
                  f"A hole token must not appear in documentation/comments.", file=sys.stderr)
            return 2

    banner = (
        "// GENERATED by ds-compile from PLAN.md — DO NOT EDIT. Edit PLAN.md and recompile.\n"
        f"// source: {plan_path}\n"
        f"// core: {template_path.name} + fragment: {fragment_path.name}\n"
        f"// tasks: {len(specs)} | levels: {len(levels)} | modes: {level_modes} | declared pauses: {pauses or 'none'}\n\n")
    out = banner + template
    for hole, repl in holes.items():
        out = out.replace(hole, repl, 1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(out)
    if not _node_check(out_path):
        return 3
    print(f"compiled {len(specs)} task(s), {len(levels)} level(s), modes={level_modes} → {out_path}")
    if pauses:
        print(f"  declared pause(s) at: {', '.join(pauses)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--out")
    ap.add_argument("--project")
    ap.add_argument("--template", default=str(_DEFAULT_TEMPLATE))
    ap.add_argument("--fragment", default=str(_DEFAULT_FRAGMENT))
    a = ap.parse_args()

    plan_path = Path(a.plan).resolve()
    if not plan_path.is_file():
        print(f"PLAN.md not found: {plan_path}", file=sys.stderr)
        return 2
    out_path = Path(a.out).resolve() if a.out else plan_path.parent / "run.js"
    # project dir = parent of .planning (or PLAN's dir if not under .planning)
    if a.project:
        project_dir = Path(a.project).resolve()
    else:
        p = plan_path.parent
        project_dir = p.parent if p.name == ".planning" else p
    return compile_plan(plan_path, out_path, project_dir,
                        Path(a.template).resolve(), Path(a.fragment).resolve())


if __name__ == "__main__":
    sys.exit(main())
