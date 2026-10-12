#!/usr/bin/env python3
"""Lint chart colour: right scheme for the variable, one reserved accent.

Only the decidable half. Whether a hue "looks right" is not checked and is not the point;
what is checked is the class of error that survives review because the chart looks fine.

    ds-chart-color.py --project-dir P --files <file.py|file.ipynb|dir> ...   (checks/ds/constraints/_contract.py)
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _contract import files_main

CONSTRAINT = "ds-chart-color"

CONTINUOUS = ("viridis", "magma", "inferno", "plasma", "cividis", "turbo",
              "blues", "greens", "oranges", "purples", "reds", "greys",
              "yellowgreenblue", "redyellowblue", "redyellowgreen")
# NOMINAL only (":N"). An ORDINAL field (":O") with a perceptually uniform ramp is the
# correct pairing — that is what viridis is for — so flagging it would train the reader
# of this lint to ignore it.
NOMINAL_ENC = re.compile(r"alt\.Color\(\s*[\"'][^\"']+:N[\"']")
SCHEME = re.compile(r"scheme\s*=\s*[\"']([a-z]+)[\"']")
HEX = re.compile(r"#([0-9a-fA-F]{6})\b")
RED = re.compile(r"#(?:[c-f][0-9a-f]|[b-f][0-9a-f])[0-3][0-9a-f][0-3][0-9a-f]\b", re.I)
GREEN = re.compile(r"#[0-3][0-9a-f](?:[9a-f][0-9a-f])[0-4][0-9a-f]\b", re.I)


def lines(path: Path) -> list[tuple[int, str]]:
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


def charts(path: Path) -> bool:
    return any("alt.Chart" in l or "plt." in l or "sns." in l for _, l in lines(path))


def check(path: Path) -> list[str]:
    src = lines(path)
    if not charts(path):
        return []
    bad: list[str] = []

    # A continuous ramp bound to a nominal field, within a few lines of each other.
    for i, (n, line) in enumerate(src):
        if not NOMINAL_ENC.search(line):
            continue
        window = " ".join(l for _, l in src[i:i + 6])
        m = SCHEME.search(window)
        if m and m.group(1).lower() in CONTINUOUS:
            bad.append(f"{path}:{n}: continuous scheme '{m.group(1)}' on a categorical "
                       "field — sampling a ramp for categories gives adjacent hues, and "
                       "the blue-green end is the weakest contrast under deuteranopia")

    # An accent named as reserved, then used as a category.
    accents = {v.lower() for n, l in src
               for v in HEX.findall(l)
               if re.search(r"\bACCENT\b|\bHIGHLIGHT\b|reserved", l, re.I)}
    for n, line in src:
        if re.search(r"\brange\s*=\s*\[", line):
            for v in (x.lower() for x in HEX.findall(line)):
                if v in accents:
                    bad.append(f"{path}:{n}: the reserved accent #{v} appears in a "
                               "categorical range — an accent that is also a category "
                               "highlights nothing")
    return bad


if __name__ == "__main__":
    # In scope: a .py or .ipynb that draws a chart. Every path handed in is read; none is pruned.
    raise SystemExit(files_main(CONSTRAINT, lambda ctx: [f for p in ctx["files"] for f in check(p)],
                                lambda p: p.suffix in (".py", ".ipynb") and charts(p),
                                kind="file drawing a chart", waive=False))
