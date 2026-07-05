#!/usr/bin/env -S uv run python3
"""Shared PreToolUse-hook shell for the dev/ds plan-executable guards.

hooks/dev-plan-executable-guard.py and hooks/ds-plan-executable-guard.py were
byte-near-identical: validate_plan (lazy-import the domain's tolerant table
parser, return violations), deny (JSON PreToolUse deny payload), and main (the
standalone-CLI mode + the PLAN_REVIEWED.md-only hook-mode filter). This module
is the single source of truth for that shell; each hook file supplies only its
domain config (scripts subdir, parser module name, domain label, deny prose)
via `PlanGuardConfig` and calls `run(CONFIG)`.

Same sys.path-insert-by-path import pattern as hooks/_gate_common.py: each hook
still runs standalone as a script (`uv run python3 <path>`, invoked from
whatever cwd the harness happens to be in), so this module is imported via
`sys.path.insert(0, str(Path(__file__).resolve().parent))` in the hook file,
not a package-relative import.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


@dataclass
class PlanGuardConfig:
    hooks_dir: Path                 # this hook file's own directory (Path(__file__).resolve().parent)
    scripts_subdir: str              # "dev" | "ds" — scripts/<subdir> holds the parser module
    parser_module: str               # "dev_plan_table" | "ds_plan_table"
    table_label: str                 # "Implementation Order" | "Task Breakdown" (for CLI messages)
    deny_reason: Callable[[Path, list[str]], str]   # (plan_path, violations) -> full deny() reason


def validate_plan(cfg: PlanGuardConfig, plan_path: Path) -> list[str]:
    """Return list of human-readable violations ([] == executable).

    Single source of truth for "what the table means" — the SAME tolerant parser the domain's
    compile script uses to emit run.js, so a plan that COMPILES also PASSES this gate.

    The parser import is deliberately LAZY (done here, not at module load): this hook's
    PreToolUse matcher fires on every Write/Edit in a session, but only a write to
    PLAN_REVIEWED.md ever reaches this function — the hundreds of unrelated calls exit early
    in main() before validate_plan runs. Importing the parser module (and mutating sys.path)
    at module scope would pay that cost on every one of them.
    """
    if not plan_path.is_file():
        return [f"PLAN.md not found at {plan_path}"]
    sys.path.insert(0, str(cfg.hooks_dir.parent / "scripts" / cfg.scripts_subdir))
    parser_mod = __import__(cfg.parser_module, fromlist=["parse_plan"])
    return parser_mod.parse_plan(plan_path.read_text()).violations


def run(cfg: PlanGuardConfig) -> None:
    # Standalone CLI mode: validate a given PLAN.md, print report, exit 0/1.
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        v = validate_plan(cfg, Path(sys.argv[1]))
        if v:
            print("PLAN NOT EXECUTABLE:\n- " + "\n- ".join(v))
            sys.exit(1)
        print(f"PLAN executable: {cfg.table_label} table is complete and the Deps DAG is valid.")
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
    violations = validate_plan(cfg, plan_path)
    if violations:
        deny(cfg.deny_reason(plan_path, violations))
    sys.exit(0)
