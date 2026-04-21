#!/usr/bin/env -S uv run python3
"""Render SCORES.md as a text-based score trend for Mode 3 decision checkpoints."""

import re
import sys
from pathlib import Path


def parse_scores(scores_path):
    """Parse SCORES.md table into list of (iteration, score, notes)."""
    content = scores_path.read_text()
    rows = []
    for match in re.finditer(
        r'\|\s*(\d+(?:\s*\([^)]*\))?)\s*\|\s*[\d-]+\s*\|\s*([\d.]+)\s*\|\s*(.*?)\s*\|',
        content
    ):
        iteration = match.group(1).strip()
        score = float(match.group(2))
        notes = match.group(3).strip()
        rows.append((iteration, score, notes))
    return rows


def render_trend(rows, threshold=9.5, width=40):
    """Render a text-based score trend chart."""
    if not rows:
        print("No scores found.")
        return

    min_score = min(r[1] for r in rows)
    max_score = max(r[1] for r in rows)
    lo = max(0, min_score - 1)
    hi = min(10, max(max_score + 0.5, threshold + 0.5))
    span = hi - lo if hi > lo else 1

    print(f"\n{'=' * (width + 20)}")
    print(f"  Score Trend — Target: {threshold}")
    print(f"{'=' * (width + 20)}")

    threshold_col = int((threshold - lo) / span * width)

    print(f"  {'lo':>4}{'':>{threshold_col - 4}}|{'':>{width - threshold_col}}  hi")
    print(f"  {lo:.1f}{'':>{threshold_col - 4}}{threshold:.1f}{'':>{width - threshold_col - 3}}{hi:.1f}")
    print(f"  {'─' * width}")

    for iteration, score, notes in rows:
        pos = int((score - lo) / span * width)
        pos = max(0, min(width - 1, pos))
        bar = '░' * pos + '█'
        marker = '✓' if score >= threshold else ' '
        label = f"  iter {iteration:<12}"
        print(f"{label}{bar:<{width + 1}} {score:.1f} {marker}")

    print(f"  {'─' * width}")

    current = rows[-1][1]
    gap = threshold - current
    if gap > 0:
        print(f"\n  Gap to {threshold}: {gap:.1f} points ({gap / 19 * 100:.0f}% of principles need +1)")
        pts_needed = int(gap * 19 / 10 + 0.5)
        print(f"  Approx {pts_needed} principle-point improvements needed")
    else:
        print(f"\n  ✓ Threshold {threshold} met!")

    print()


def main():
    if len(sys.argv) < 2:
        scores_dir = Path(".planning/wc")
        if scores_dir.exists():
            candidates = list(scores_dir.glob("*/SCORES.md"))
            if candidates:
                scores_path = max(candidates, key=lambda p: p.stat().st_mtime)
            else:
                print("No SCORES.md found in .planning/wc/*/")
                sys.exit(1)
        else:
            print("Usage: render-audit-scores.py <path/to/SCORES.md>")
            sys.exit(1)
    else:
        scores_path = Path(sys.argv[1])

    if not scores_path.exists():
        print(f"File not found: {scores_path}")
        sys.exit(1)

    threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 9.5

    rows = parse_scores(scores_path)
    render_trend(rows, threshold=threshold)


if __name__ == '__main__':
    main()
