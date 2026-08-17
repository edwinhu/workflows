#!/usr/bin/env -S uv run python3
"""writing_prose_gate.py — the PROSE-HARD mechanical check.

Wraps the plugin's prose/AI-tell engine IN PLACE (never forked, never modified):

    uv run --with lxml --with pyyaml python3 <prose-audit.py> <drafts...> --style <domain> --json

`prose-audit.py` ends in `sys.exit(worst)`, which is 1 when ANY file carries a hard
span — but its own exit code is not what this gate reads. The gate reads the span
list and blocks only on `severity == "hard"`, so a soft advisory can never fail a run:

    any span with severity "hard"  → BLOCK   (exit 1)
    soft spans only                → printed as advisory, exit 0
    engine missing / unrunnable / output unparseable / no `spans` key → exit 2

Unparsed is UNCHECKED, never clean — every one of those paths exits non-zero.

`--with lxml --with pyyaml` is not decoration: the engine reaches lxml through
prose_extract.py and PyYAML through diction.yaml, and raises SystemExit without them.

Drafts are the paths the plan's `## Section Outputs` table names, resolved against the
project root; `--style` is the plan's `Domain:`, which selects the domain style guide.

Exit codes: 0 clean · 1 blocked (a hard span) · 2 gate defect.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Self-locating: skills/writing/scripts -> the plugin root that ships the engine.
# WRITING_PROSE_ENGINE overrides for an install that keeps prose-audit.py elsewhere.
ENGINE = Path(os.environ.get("WRITING_PROSE_ENGINE")
              or Path(__file__).resolve().parents[3] / "scripts" / "prose-audit.py")
RUNNER = ["uv", "run", "--with", "lxml", "--with", "pyyaml", "python3"]

EXIT_CLEAN = 0
EXIT_BLOCKED = 1
EXIT_GATE_DEFECT = 2


class GateDefect(Exception):
    """The engine could not be run, or its output could not be read for severity."""


def _receipt_plan(planning: Path) -> Path | None:
    """The plan `.planning/.state/review.json` authenticates, when that file is usable.

    A malformed receipt is NOT a defect here: the receipt is the grammar check's subject,
    and PROSE-HARD must stay about prose rather than reporting another check's failure.
    """
    try:
        receipt = json.loads((planning / ".state" / "review.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    name = receipt.get("plan_file") if isinstance(receipt, dict) else None
    if not isinstance(name, str) or Path(name).name != name or name == "PLAN.md":
        return None
    plan = planning / name
    return plan if plan.is_file() else None


def find_plan(project: Path) -> Path:
    """The generated plan under `<proj>/.planning/`.

    The receipt's `plan_file` wins where it resolves. Otherwise the plan is the one
    direct-child `.md` carrying a `## Section Outputs` heading — which is what excludes
    `ACTIVE_WORKFLOW.md` and the retired `PRECIS.md`/`OUTLINE.md`/`PHASE_SUMMARY.md`
    siblings without hard-coding their names. `PLAN.md` is never a plan: the vendored
    grammar parser rejects that basename.
    """
    planning = project / ".planning"
    if not planning.is_dir():
        raise GateDefect(f"no .planning directory under {project}")
    authenticated = _receipt_plan(planning)
    if authenticated is not None:
        return authenticated
    candidates = sorted(
        p for p in planning.glob("*.md")
        if p.is_file()
        and p.name != "PLAN.md"
        and any(line.strip() == "## Section Outputs"
                for line in p.read_text(encoding="utf-8", errors="ignore").splitlines())
    )
    if not candidates:
        raise GateDefect(f"no generated plan with `## Section Outputs` directly under {planning}")
    if len(candidates) > 1:
        raise GateDefect(
            f"{len(candidates)} candidate plans under {planning}: "
            + ", ".join(p.name for p in candidates)
        )
    return candidates[0]


def _table_rows(block: str) -> list[list[str]]:
    rows = []
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if all(set(c) <= set("-: ") and c for c in cells):
            continue
        rows.append(cells)
    return rows


def draft_paths(plan: Path) -> list[Path]:
    """The `Draft` column of `## Section Outputs`, resolved against the plan's project root."""
    text = plan.read_text(encoding="utf-8", errors="ignore")
    block, seen = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            if seen:
                break
            seen = line[3:].strip() == "Section Outputs"
            continue
        if seen:
            block.append(line)
    if not seen:
        raise GateDefect(f"{plan} has no `## Section Outputs` section")
    rows = _table_rows("\n".join(block))
    if len(rows) < 2:
        raise GateDefect(f"{plan}: `## Section Outputs` has no data rows")
    header = [c.lower() for c in rows[0]]
    if "draft" not in header:
        raise GateDefect(f"{plan}: `## Section Outputs` has no Draft column")
    col = header.index("draft")
    root = plan.parent.parent
    out = []
    for row in rows[1:]:
        if col >= len(row) or row[col] in ("", "-"):
            continue
        out.append(root / row[col])
    if not out:
        raise GateDefect(f"{plan}: `## Section Outputs` names no draft path")
    return out


def run_engine(drafts: list[Path], style: str, engine: Path) -> tuple[str, str, int]:
    if not engine.is_file():
        raise GateDefect(f"prose-audit engine not found at {engine}")
    # The engine is called IN PLACE in the plugin tree, which this skill treats as read-only.
    # prose-audit.py imports sibling modules from that tree, so a normal run writes __pycache__
    # into it — "call it in place" and "modify nothing there" are otherwise incompatible.
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    try:
        proc = subprocess.run(
            RUNNER + [str(engine)] + [str(d) for d in drafts] + ["--style", style, "--json"],
            capture_output=True,
            text=True,
            env=env,
        )
    except OSError as error:
        raise GateDefect(f"could not run the prose-audit engine: {error}") from error
    return proc.stdout, proc.stderr, proc.returncode


def parse_results(stdout: str) -> dict[str, dict]:
    """{file: result}. The engine emits one bare result for a single file and a
    {path: result} mapping for several; both shapes are normalised here."""
    text = stdout.strip()
    if not text:
        raise GateDefect("the prose-audit engine produced no stdout to parse")
    try:
        value = json.loads(text)
    except ValueError as error:
        raise GateDefect(f"prose-audit output is not JSON: {error}") from error
    if not isinstance(value, dict):
        raise GateDefect(f"prose-audit output is {type(value).__name__}, not an object")
    if "spans" in value:
        value = {str(value.get("file", "<document>")): value}
    results = {}
    for name, result in value.items():
        if not isinstance(result, dict) or "spans" not in result:
            raise GateDefect(f"prose-audit result for {name!r} has no 'spans' key")
        if not isinstance(result["spans"], list):
            raise GateDefect(f"prose-audit 'spans' for {name!r} is not a list")
        results[name] = result
    if not results:
        raise GateDefect("prose-audit reported no documents")
    return results


def split_spans(results: dict[str, dict]) -> tuple[list[tuple[str, dict]], list[tuple[str, dict]]]:
    """(hard, soft) as (file, span) pairs. A span with an unknown severity counts as hard —
    the gate may not invent a severity that would let an unrecognised finding through."""
    hard, soft = [], []
    for name, result in results.items():
        for span in result["spans"]:
            if not isinstance(span, dict) or "severity" not in span:
                raise GateDefect(f"prose-audit span in {name!r} declares no severity")
            (soft if span["severity"] == "soft" else hard).append((name, span))
    return hard, soft


def _show(kind: str, pairs: list[tuple[str, dict]], out) -> None:
    for name, span in pairs:
        loc = f"{name}:{span.get('line', 0)}:{span.get('col', 0)}"
        print(f"{kind} [{span.get('id', '?')}] {loc}: {' | '.join(span.get('labels', []))}", file=out)
        if span.get("quote"):
            print(f"    {span['quote'][:110]!r}", file=out)


def gate(project: Path, style: str, engine: Path = ENGINE, out=sys.stdout) -> int:
    try:
        plan = find_plan(project)
        drafts = draft_paths(plan)
        present = [d for d in drafts if d.is_file()]
        for missing in [d for d in drafts if not d.is_file()]:
            print(f"not yet drafted (skipped): {missing}", file=out)
        if not present:
            raise GateDefect("no draft named by `## Section Outputs` exists on disk")
        stdout, stderr, returncode = run_engine(present, style, engine)
        results = parse_results(stdout)
        hard, soft = split_spans(results)
    except GateDefect as defect:
        print(f"PROSE-HARD GATE DEFECT: {defect}", file=out)
        print("An unparseable or unrunnable prose audit is UNCHECKED, never clean.", file=out)
        return EXIT_GATE_DEFECT

    _show("BLOCKING (hard):", hard, out)
    _show("advisory (soft):", soft, out)
    print(
        f"\nPROSE-HARD: {len(hard)} hard span(s), {len(soft)} soft advisory span(s) "
        f"over {len(present)} draft(s), style {style} "
        f"[prose-audit exit {returncode}, not wired to this gate]",
        file=out,
    )
    if hard:
        if stderr.strip():
            print(f"prose-audit stderr: {stderr.strip()[:2000]}", file=out)
        print("PROSE-HARD: BLOCKED", file=out)
        return EXIT_BLOCKED
    print("PROSE-HARD: clean (soft spans are advisory and do not block)", file=out)
    return EXIT_CLEAN


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Hard-severity prose gate over prose-audit.py")
    parser.add_argument("--project", required=True, help="writing project root")
    parser.add_argument(
        "--style",
        required=True,
        choices=("legal", "econ", "general"),
        help="the plan's Domain: — selects the domain style guide",
    )
    parser.add_argument(
        "--engine",
        default=str(ENGINE),
        help="path to prose-audit.py (default: the plugin's, run in place)",
    )
    args = parser.parse_args(argv)
    return gate(Path(args.project), args.style, Path(args.engine))


if __name__ == "__main__":
    sys.exit(main())
