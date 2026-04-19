#!/usr/bin/env python3
"""Constraint: ds-data-pull-profile.

If SPEC.md or PLAN.md indicates a data pull from a large external source
(estimated ≥50M rows, ≥500 MB ship size, or uses large-source keywords like
"large", "bulk", "TB", "millions"), PLAN.md MUST contain a "## Data Pull
Profile" section with a decision table documenting raw vs aggregate size per
source, ratio, and recommended strategy.

Runs against `.planning/SPEC.md` and `.planning/PLAN.md` in the caller's cwd.
If PLAN.md does not yet exist, the check is a no-op (pre-plan state).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CONSTRAINT = "ds-data-pull-profile"
APPLIES_TO = ["ds-plan", "ds-fix"]
SEVERITY = "hard"

# Numeric-size triggers. Match rows first (more specific), then MB.
# Examples matched:
#   "~150M rows", "approximately 2B trades", "144M rows", "50,000,000 rows",
#   "about 60 million rows", "hundreds of millions of rows"
ROW_COUNT_PATTERN = re.compile(
    r"""
    (?:
        (?:approximately|approx\.?|about|~|>=?|>|\bover\b)?\s*
        (\d{1,3}(?:[,_]\d{3})*|\d+(?:\.\d+)?)\s*
        ([kKmMbB])\s*
        (?:rows?|records?|trades?|observations?|obs\b|filings?|events?|entries)
    )
    |
    (?:
        (\d{1,3}(?:[,_]\d{3})*|\d+(?:\.\d+)?)\s*
        (?:million|billion|thousand)\s*
        (?:rows?|records?|trades?|observations?|obs\b|filings?|events?|entries)
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Size-in-bytes trigger (≥500 MB)
SIZE_PATTERN = re.compile(
    r"""
    (\d+(?:\.\d+)?)\s*
    (KB|MB|GB|TB)
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Keyword triggers. Deliberately liberal — agents underestimate size, so we
# fire on suspicion. "hundreds of millions" / "entire history" / "full universe"
# all suggest a pull that warrants profiling even without a precise count.
KEYWORD_TRIGGERS = [
    r"\blarge\s+(?:table|source|dataset|file|pull|dump|extract)",
    r"\bbulk\s+(?:pull|download|extract|load|insert|copy)",
    r"\bterabyte",
    r"\b\d+\s*TB\b",
    r"\bmillions\s+of\s+(?:rows|records|trades|observations|filings)",
    r"\bhundreds\s+of\s+millions",
    r"\bbillions?\s+of\s+(?:rows|records|trades|observations|filings)",
    r"\bfull\s+universe",
    r"\bentire\s+history",
    r"\bfull\s+history",
    r"\bwhole\s+table",
    r"\bfull\s+table\s+pull",
]
KEYWORD_PATTERNS = [re.compile(p, re.IGNORECASE) for p in KEYWORD_TRIGGERS]

# Required section header in PLAN.md
PROFILE_HEADER = re.compile(
    r"^##\s+Data\s+Pull\s+Profile\b", re.IGNORECASE | re.MULTILINE
)

# Required tokens in the Data Pull Profile section
REQUIRED_TOKENS = ["Raw rows", "Aggregate", "Ratio", "Recommend"]

# Thresholds
ROW_THRESHOLD = 50_000_000  # 50M rows
SIZE_THRESHOLD_MB = 500


def _parse_row_count(raw: str, suffix: str) -> int:
    """Convert '150', 'M' -> 150_000_000. Handles commas/underscores."""
    try:
        n = float(raw.replace(",", "").replace("_", ""))
    except ValueError:
        return 0
    s = suffix.lower()
    if s == "k":
        return int(n * 1_000)
    if s == "m":
        return int(n * 1_000_000)
    if s == "b":
        return int(n * 1_000_000_000)
    return int(n)


def _parse_word_count(raw: str, word: str) -> int:
    try:
        n = float(raw.replace(",", "").replace("_", ""))
    except ValueError:
        return 0
    w = word.lower()
    if w == "thousand":
        return int(n * 1_000)
    if w == "million":
        return int(n * 1_000_000)
    if w == "billion":
        return int(n * 1_000_000_000)
    return int(n)


def _exceeds_row_threshold(text: str) -> tuple[bool, str]:
    """Return (triggered, reason) for any ≥50M row mention in `text`."""
    for m in ROW_COUNT_PATTERN.finditer(text):
        # Branch 1: numeric + K/M/B suffix
        if m.group(1) and m.group(2):
            n = _parse_row_count(m.group(1), m.group(2))
            if n >= ROW_THRESHOLD:
                return True, f"row-count mention >= 50M ({m.group(0).strip()!r})"
        # Branch 2: numeric + word (million/billion/thousand)
        elif m.group(3):
            word_match = re.search(r"(thousand|million|billion)", m.group(0), re.IGNORECASE)
            if word_match:
                n = _parse_word_count(m.group(3), word_match.group(1))
                if n >= ROW_THRESHOLD:
                    return True, f"row-count mention >= 50M ({m.group(0).strip()!r})"
    return False, ""


def _exceeds_size_threshold(text: str) -> tuple[bool, str]:
    """Return (triggered, reason) for any ≥500 MB ship-size mention."""
    for m in SIZE_PATTERN.finditer(text):
        try:
            n = float(m.group(1))
        except ValueError:
            continue
        unit = m.group(2).upper()
        mb = n * {"KB": 1 / 1024, "MB": 1, "GB": 1024, "TB": 1024 * 1024}.get(unit, 0)
        if mb >= SIZE_THRESHOLD_MB:
            return True, f"ship-size mention >= 500 MB ({m.group(0).strip()!r})"
    return False, ""


def _keyword_trigger(text: str) -> tuple[bool, str]:
    for pat in KEYWORD_PATTERNS:
        m = pat.search(text)
        if m:
            return True, f"large-source keyword {m.group(0).strip()!r}"
    return False, ""


def _triggers(text: str) -> list[str]:
    reasons = []
    for checker in (_exceeds_row_threshold, _exceeds_size_threshold, _keyword_trigger):
        fired, reason = checker(text)
        if fired:
            reasons.append(reason)
    return reasons


def _extract_profile_section(plan_text: str) -> str | None:
    m = PROFILE_HEADER.search(plan_text)
    if not m:
        return None
    body = plan_text[m.end():]
    next_header = re.search(r"^## ", body, re.MULTILINE)
    if next_header:
        body = body[: next_header.start()]
    return body


def check(context: dict) -> list[str]:
    cwd = Path(context.get("cwd", "."))
    spec = cwd / ".planning" / "SPEC.md"
    plan = cwd / ".planning" / "PLAN.md"

    # Collect trigger text from whichever files exist
    trigger_text = ""
    if spec.exists():
        trigger_text += spec.read_text(encoding="utf-8", errors="replace")
    if plan.exists():
        trigger_text += "\n" + plan.read_text(encoding="utf-8", errors="replace")

    if not trigger_text:
        return []  # No spec/plan yet — nothing to check

    reasons = _triggers(trigger_text)
    if not reasons:
        return []  # No large-source triggers → Data Pull Profile not required

    # Triggered. PLAN.md must exist and contain the Data Pull Profile section.
    if not plan.exists():
        # SPEC.md triggered but no PLAN.md yet — no-op (pre-plan state).
        # The gate fires when PLAN.md is drafted.
        return []

    plan_text = plan.read_text(encoding="utf-8", errors="replace")
    violations = []

    section = _extract_profile_section(plan_text)
    if section is None:
        violations.append(
            "PLAN.md is missing the required '## Data Pull Profile' section. "
            f"Triggered by: {'; '.join(reasons)}. "
            "Dispatch a read-only profiling subagent to quantify raw vs "
            "aggregate ship size per source, write "
            "docs/investigations/YYYY-MM-DD_pull_profile.md, and record the "
            "decision table in PLAN.md before finalizing."
        )
        return violations

    missing = [tok for tok in REQUIRED_TOKENS if tok.lower() not in section.lower()]
    if missing:
        violations.append(
            f"PLAN.md '## Data Pull Profile' section is a stub — missing "
            f"required tokens: {', '.join(missing)}. The section must contain "
            "a decision table with columns: Source, Raw rows, Raw MB, "
            "Aggregate level, Aggregate rows, Aggregate MB, Ratio, "
            "Recommendation."
        )

    # Additional check: investigation file reference
    if "docs/investigations/" not in section and "pull_profile" not in section.lower():
        violations.append(
            "PLAN.md '## Data Pull Profile' section should reference the "
            "investigation file at docs/investigations/YYYY-MM-DD_pull_profile.md "
            "where the profiling subagent recorded COUNT(*), bytes/row "
            "calibration, aggregate cardinality queries, and "
            "information-preservation notes."
        )

    return violations


if __name__ == "__main__":
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    vs = check({"cwd": cwd})
    if vs:
        for v in vs:
            print(f"FAIL [{CONSTRAINT}]: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
