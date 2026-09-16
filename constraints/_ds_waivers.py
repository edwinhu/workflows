#!/usr/bin/env python3
"""Per-line waivers for the ds-* constraints, which must carry a REASON.

Every ds-* checker returns `"path:line: message"` strings and prints them. Some of those
findings are correct and some are the rule not fitting: scripts/doc_render.py wraps a CACHE
READ in `except Exception: pass`, and ds-error-handling says "log and re-raise" — which would
turn an unreadable cache into a crash. Before this module there was nowhere to record that, so
the only ways to close such a finding were to make the code worse or to weaken the rule.

THE WAIVER IS NOT A SUPPRESSION.

  - It names ONE line, on that line or the one above it, never a pattern.
  - It names the RULE it waives, so a waiver cannot drift onto a finding it never meant.
  - It must carry a reason of at least MIN_REASON characters. A bare `# ds-error-handling:`
    waives nothing — a comment with no reason is a suppression wearing a waiver's clothes,
    and that is the failure this whole design is against.
  - Waived findings are COUNTED and reported. A waiver that vanishes silently is how a gate
    gets hollowed out one line at a time.

    df = pd.read_csv(p)  # ds-schema-contracts: fixture with a stated 3-column header, asserted
                         # by the test that writes it

Usage in a checker's __main__:

    from _ds_waivers import partition
    kept, waived = partition(violations, cwd, CONSTRAINT)
"""

from __future__ import annotations

import re
from pathlib import Path

MIN_REASON = 12

_LOC = re.compile(r"^(?P<path>[^:]+):(?P<line>\d+):")


def _waiver_on(text: str, constraint: str) -> str | None:
    """The reason on this source line, or None. `constraint` is e.g. "ds-error-handling"."""
    m = re.search(rf"#\s*{re.escape(constraint)}\s*:(?P<reason>.*)$", text)
    if not m:
        return None
    reason = m.group("reason").strip()
    return reason if len(reason) >= MIN_REASON else None


def partition(violations, cwd, constraint):
    """(kept, waived) — waived entries are `(violation, reason)`."""
    root = Path(cwd)
    kept, waived = [], []
    cache: dict[Path, list[str]] = {}
    for v in violations:
        m = _LOC.match(str(v))
        if not m:
            kept.append(v)
            continue
        p = root / m.group("path")
        try:
            lines = cache.setdefault(p, p.read_text(errors="replace").split("\n"))
        except OSError:
            # A file we cannot read is a file we cannot see a waiver in, and an unreadable
            # file must never be treated as waived.
            kept.append(v)
            continue
        n = int(m.group("line"))
        reason = None
        for idx in (n - 1, n - 2):           # the cited line, then the one above it
            if 0 <= idx < len(lines):
                reason = _waiver_on(lines[idx], constraint)
                if reason:
                    break
        (waived.append((v, reason)) if reason else kept.append(v))
    return kept, waived
