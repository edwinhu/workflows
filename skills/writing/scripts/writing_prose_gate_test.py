#!/usr/bin/env -S uv run python3
"""writing_prose_gate_test.py — run DIRECTLY, not under pytest.

    uv run python3 writing_prose_gate_test.py

Four cases, each exercising the gate end to end as a subprocess against a temporary
project it builds itself (it never writes into `fixtures/`, which other checks are
demonstrated against):

  1. a hard span exits non-zero
  2. a soft-only document exits 0 with the advisory printed
  3. a missing engine exits non-zero
  4. unparseable engine output exits non-zero
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

GATE = Path(__file__).resolve().parent / "writing_prose_gate.py"

PLAN = """# Fixture Article

## Section Outputs
| Section | Outline | Draft | Depends On |
|---|---|---|---|
| Introduction | outlines/Introduction.md | drafts/Introduction.md | - |
"""

# `stands as a testament to` is `ai-tic·sev4·stands-as-testament`; prose-audit rates a
# corpus-gated scored tic at sev>=4 as `hard`.
HARD_DRAFT = """The current rule leaves a gap that recurs across the reported cases.
The doctrine stands as a testament to that gap.
"""

# Em-dashes in running prose: `style·em_dash`, which prose-audit rates `soft`.
SOFT_DRAFT = """The current rule leaves a gap — one that recurs across the reported cases.
A narrower replacement closes it — without new administrative cost.
"""

STUB_UNPARSEABLE = "import sys\nprint('this is not JSON')\nsys.exit(1)\n"


def build_project(root: Path, draft: str) -> Path:
    project = root / "project"
    (project / ".planning").mkdir(parents=True)
    (project / "drafts").mkdir()
    (project / ".planning" / "fixture-plan.md").write_text(PLAN)
    (project / "drafts" / "Introduction.md").write_text(draft)
    return project


def run_gate(project: Path, engine: Path | None = None) -> subprocess.CompletedProcess:
    argv = ["uv", "run", "python3", str(GATE), "--project", str(project), "--style", "legal"]
    if engine is not None:
        argv += ["--engine", str(engine)]
    return subprocess.run(argv, capture_output=True, text=True)


def main() -> int:
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str) -> None:
        results.append((name, ok, detail))

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        # 1 — a hard span blocks.
        hard_project = build_project(root / "hard", HARD_DRAFT)
        proc = run_gate(hard_project)
        check(
            "a hard span exits non-zero",
            proc.returncode != 0
            and "PROSE-HARD: BLOCKED" in proc.stdout
            and "BLOCKING (hard):" in proc.stdout,
            f"exit={proc.returncode} blocked={'PROSE-HARD: BLOCKED' in proc.stdout} "
            f"hard_line={'BLOCKING (hard):' in proc.stdout}",
        )

        # 2 — soft only passes, and the advisory is still printed.
        soft_project = build_project(root / "soft", SOFT_DRAFT)
        proc = run_gate(soft_project)
        check(
            "a soft-only document exits 0 with the advisory printed",
            proc.returncode == 0
            and "advisory (soft):" in proc.stdout
            and "PROSE-HARD: clean" in proc.stdout,
            f"exit={proc.returncode} advisory={'advisory (soft):' in proc.stdout} "
            f"clean={'PROSE-HARD: clean' in proc.stdout}",
        )

        # 3 — a missing engine is a defect, not a pass.
        proc = run_gate(soft_project, engine=root / "no-such-engine.py")
        check(
            "a missing engine exits non-zero",
            proc.returncode != 0 and "GATE DEFECT" in proc.stdout,
            f"exit={proc.returncode} defect={'GATE DEFECT' in proc.stdout}",
        )

        # 4 — output that cannot be parsed for severity is UNCHECKED, never clean.
        stub = root / "stub-engine.py"
        stub.write_text(STUB_UNPARSEABLE)
        proc = run_gate(soft_project, engine=stub)
        check(
            "unparseable output exits non-zero",
            proc.returncode != 0 and "GATE DEFECT" in proc.stdout,
            f"exit={proc.returncode} defect={'GATE DEFECT' in proc.stdout}",
        )

    passed = sum(1 for _, ok, _ in results if ok)
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}  [{detail}]")
    print(f"\n{passed} passed, {len(results) - passed} failed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
