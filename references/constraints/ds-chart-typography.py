#!/usr/bin/env python3
"""Lint chart typography: one registered theme, no per-chart styling, one palette.

Decidable by construction — every finding is a line number, never a judgement about
whether a chart "looks right". What it cannot see (does the font actually match the host
document?) it does not pretend to check; that one is named in the .md and left to the eye.

    python3 ds-chart-typography.py <file.py|file.ipynb|dir>
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

CHART = re.compile(r"\balt\.Chart\b|\bplt\.(subplots|figure)\b|\bsns\.\w+plot\b|\.mark_\w+\(")
THEME = re.compile(r"alt\.theme\.register|alt\.themes\.register|enable_theme|"
                   r"rcParams\.update|plt\.style\.use|sns\.set_theme")
# Per-chart styling: the hole a theme exists to close.
PER_CHART = re.compile(r"\.configure_(axis|legend|title|text|mark|view)\s*\(|"
                       r"\b(labelFont|titleFont|fontFamily|fontname)\s*=|"
                       r"\bplt\.rc\(")
HEX = re.compile(r"#[0-9a-fA-F]{6}\b")
# A palette block is where hex is allowed: a run of assignments near the top of a file.
PALETTE_HINT = re.compile(r"^[A-Z][A-Z0-9_]{2,}\s*=\s*[\"']#[0-9a-fA-F]{6}[\"']")


def cells(path: Path) -> list[tuple[int, str]]:
    """(line number, source line) for a .py, or for every code cell of a .ipynb."""
    if path.suffix == ".ipynb":
        nb = json.loads(path.read_text(errors="ignore"))
        out, n = [], 0
        for c in nb.get("cells", []):
            for line in ("".join(c.get("source", ""))).splitlines():
                n += 1
                if c.get("cell_type") == "code":
                    out.append((n, line))
        return out
    return list(enumerate(path.read_text(errors="ignore").splitlines(), start=1))


def check(path: Path) -> list[str]:
    src = cells(path)
    body = "\n".join(l for _, l in src)
    if not CHART.search(body):
        return []

    bad: list[str] = []
    if not THEME.search(body):
        bad.append(f"{path}: charts but no registered theme — style is set chart by chart, "
                   "so the next chart added will silently keep the library default")

    for n, line in src:
        if line.lstrip().startswith("#"):
            continue
        if PER_CHART.search(line):
            bad.append(f"{path}:{n}: per-chart styling overrides the theme — {line.strip()[:70]}")

    palette_lines = {n for n, l in src if PALETTE_HINT.match(l.strip())}
    loose = [(n, l) for n, l in src
             if HEX.search(l) and n not in palette_lines and not l.lstrip().startswith("#")]
    if loose and palette_lines:
        for n, l in loose[:8]:
            bad.append(f"{path}:{n}: hex colour outside the palette block — {l.strip()[:70]}")
    return bad


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    target = Path(sys.argv[1])
    files = ([p for p in target.rglob("*") if p.suffix in {".py", ".ipynb"}]
             if target.is_dir() else [target])
    findings = [f for p in files for f in check(p)]
    for f in findings:
        print(f)
    n_charted = sum(1 for p in files if CHART.search("\n".join(l for _, l in cells(p))))
    print(f"\n{len(findings)} finding(s) across {n_charted} file(s) containing charts")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
