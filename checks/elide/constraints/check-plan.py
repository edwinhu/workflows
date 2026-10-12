#!/usr/bin/env python3
"""The plan records the interview: both answers and a page target per reading.

Usage: check-plan.py <plan.md> <declared out> <readings out>       (check.sh's plan leg)
       check-plan.py --project-dir P [--plan X] [--files F ...]    (the constraint contract: a plan
                     reader, in scope only when --plan names a plan; checks/ds/constraints/_contract.py)

A plan FAILS on:
  - no '## Doctrinal target' section, or one whose 'Doctrinal thread:', 'Cuts against:' or
    'Taught for:' (holding|reasoning) answer is missing, empty or a placeholder;
  - no '## Readings In Scope' section, no reading row, or a row with no caption or no usable
    MIN-MAX page target.

In check.sh's form it also writes the plan's `caption \\x1f MIN-MAX` rows to <readings out> and its
'## Non-court readings' as `caption \\x1f why` lines to <declared out>, which the later legs read.
Each problem prints as `  <problem>`. Exit 0 the plan records both, 1 it does not.
"""
import importlib.util
import re
import sys
from pathlib import Path

PLACEHOLDER = re.compile(r"^(tbd|todo|n/?a|none|\?+|_+|x+|<.*>|\[.*\])$", re.I)
TARGET_RE = re.compile(r"^(\d+)\s*[-–—]\s*(\d+)$")


def problems_of(plan: str) -> tuple[list[str], list[str]]:
    """(each problem, each `caption \\x1f MIN-MAX` reading row) of a plan's text."""

    def section(name: str) -> str | None:
        m = re.search(rf"^##+\s*{re.escape(name)}\s*$(.*?)(?=^##\s|\Z)", plan, re.I | re.M | re.S)
        return m.group(1) if m else None

    def field(body: str, label: str) -> str:
        # Horizontal whitespace only: \s* would cross the newline and capture the NEXT bullet
        # as this label's answer, so an empty answer would read as filled in.
        m = re.search(rf"{re.escape(label)}[^\S\n]*:[^\S\n]*([^\n]*)", body, re.I)
        if not m:
            return ""
        v = m.group(1).strip().strip("*_` ")
        return "" if PLACEHOLDER.match(v) else v

    problems: list[str] = []
    target = section("Doctrinal target")
    if target is None:
        problems.append("no '## Doctrinal target' section — neither interview answer is recorded")
    else:
        if not field(target, "Doctrinal thread"):
            problems.append("interview answer 1 absent: 'Doctrinal thread:' is missing or empty")
        if not field(target, "Cuts against"):
            problems.append("interview answer 1 incomplete: 'Cuts against:' is missing or empty")
        taught = field(target, "Taught for").lower()
        if not taught:
            problems.append("interview answer 2 absent: 'Taught for:' is missing or empty")
        elif not re.search(r"\b(holding|reasoning)\b", taught):
            problems.append(f"interview answer 2 unusable: 'Taught for: {taught}' is neither holding nor reasoning")

    # '## Readings In Scope' is the source of truth for each reading's page target. It is
    # enforced exactly as the three Doctrinal target lines are: absent section, a row with no
    # target, or a placeholder target all FAIL, and the failure names the offending row.
    readings: list[str] = []
    scope = section("Readings In Scope")
    if scope is None:
        problems.append(
            "no '## Readings In Scope' section — no reading has an approved page target"
        )
    else:
        rows = []
        for raw in scope.splitlines():
            if not raw.strip().startswith("|"):
                continue
            cells = [c.strip() for c in raw.strip().strip("|").split("|")]
            if len(cells) < 2:
                continue
            if set("".join(cells)) <= set("-: "):
                continue  # the |---|---| separator
            if cells[0].lower() in ("caption", "reading"):
                continue  # the header row
            rows.append(cells)
        if not rows:
            problems.append("'## Readings In Scope' has no reading rows")
        for cells in rows:
            cap = cells[0].strip("*_` ")
            tgt = cells[-1].strip().strip("*_` ")
            label = cap[:60] if cap else "<unnamed row>"
            if not cap:
                problems.append(f"'## Readings In Scope' row has no caption: {' | '.join(cells)}")
                continue
            if len(cells) < 3 or not tgt or PLACEHOLDER.match(tgt):
                problems.append(
                    f"reading '{label}' has no page target — the '## Readings In Scope' row must "
                    f"end in a MIN-MAX page target (2-6 is the default range)"
                )
                continue
            m = TARGET_RE.match(tgt)
            if not m:
                problems.append(
                    f"reading '{label}' has an unusable page target {tgt!r} — expected MIN-MAX, e.g. 2-6"
                )
                continue
            readings.append(f"{cap}\x1f{int(m.group(1))}-{int(m.group(2))}")
    return problems, readings


def leg_main(argv: list[str]) -> int:
    """check.sh's plan leg: the problems, and the readings and non-court files the later legs read."""
    plan = Path(argv[0]).read_text(encoding="utf-8")
    declared_out, readings_out = Path(argv[1]), Path(argv[2])
    problems, readings = problems_of(plan)
    readings_out.write_text("\n".join(readings) + ("\n" if readings else ""), encoding="utf-8")

    # The non-court bullets are parsed by the quotes leg's own reader, so the two cannot disagree.
    spec = importlib.util.spec_from_file_location("check_quotes", Path(__file__).resolve().parent / "check-quotes.py")
    quotes = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(quotes)
    lines = [f"{cap}\x1f{why}" for cap, why in quotes.noncourt(plan)]
    declared_out.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    for p in problems:
        print(f"  {p}")
    return 1 if problems else 0


def judge(ctx: dict) -> list[tuple[int, str]]:
    """The constraint contract: each problem a finding at the plan's line 1."""
    return [(1, p) for p in problems_of(Path(ctx["plan"]).read_text(encoding="utf-8"))[0]]


if __name__ == "__main__":
    if "--project-dir" in sys.argv[1:]:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ds" / "constraints"))  # the contract helper
        from _contract import plan_main
        sys.exit(plan_main("check-plan", judge))
    if len(sys.argv) != 4:
        print("usage: check-plan.py <plan.md> <declared out> <readings out>", file=sys.stderr)
        sys.exit(2)
    sys.exit(leg_main(sys.argv[1:]))
