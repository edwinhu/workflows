#!/usr/bin/env -S uv run python3
"""PostToolUse hook: prose-lint + structural constraints after draft edits.

Fires on Edit|Write to:
  - `drafts/*.md`   — markdown drafts (existing gate), AND
  - `*.typ` LETTERS — Typst letters (NOT slide decks; decks are skipped).

Two engines run, complementary and de-duplicated:
  1. scripts/prose-lint.py — the comprehensive PROSE PATTERN engine. Loads the
     regex tables defined once in the skill reference files (Strunk & White +
     ai-anti-patterns, plus econ/legal by domain) and lints the single edited
     file. Categories are domain-filtered via `--only` from
     `.planning/ACTIVE_WORKFLOW.md` `style:`.
  2. references/constraints/check-all.py — the GRANULAR engine, kept only for
     rules that need real logic, not regex tables (topic sentences, anchored
     numbers, outline sync, claim-id traceability, em-dash density, …).
     The three regex-table AI-smell constraints that DUPLICATE prose-lint's
     ai-anti-patterns category are suppressed here (see PROSE_LINT_SUPERSEDES)
     so the same rule isn't reported twice. check-all only globs `drafts/*.md`,
     so it runs for .md edits only; .typ letters get prose-lint alone.

Violations are filtered to the edited file AND the line range the edit actually
touched (±2 lines for boundary issues), so a single edit doesn't resurface
pre-existing warnings on unrelated lines.

Non-blocking: reports violations as an additionalContext message.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).parent.parent
CHECK_ALL = PLUGIN_ROOT / "references" / "constraints" / "check-all.py"
PROSE_LINT = PLUGIN_ROOT / "scripts" / "prose-lint.py"

# Granular constraints whose regex tables DUPLICATE prose-lint's
# `ai-anti-patterns` category. prose-lint is preferred; suppress these from the
# check-all results so the same rule is not double-reported. (em-dash density,
# topic sentences, anchored numbers, outline sync, etc. are real-logic checks
# with no prose-lint equivalent — they are NOT listed here and still run.)
PROSE_LINT_SUPERSEDES = {
    "writing-ai-smell-artifacts",
    "writing-ai-smell-puffery",
    "writing-ai-smell-structure",
}

# Domain `style:` -> extra prose-lint category. ai-anti-patterns and
# writing-general (Strunk) always run; econ/legal are added by domain.
_STYLE_CATEGORY = {
    "legal": "writing-legal",
    "econ": "writing-econ",
}

# Typst deck markers — if any appear we treat the .typ as a slide deck and skip.
# "touying"/"polylux" match the package import lines; "#slide(" matches a slide
# function call regardless of which deck framework defines it.
_DECK_MARKERS = ("touying", "polylux", "#slide(")
_DECK_DIR_RE = re.compile(r"^(slides|presentation)", re.IGNORECASE)


def _detect_style(project_root: Path) -> str | None:
    """Read `style:` from .planning/ACTIVE_WORKFLOW.md (legal/econ/general)."""
    aw = project_root / ".planning" / "ACTIVE_WORKFLOW.md"
    if not aw.is_file():
        return None
    try:
        m = re.search(r"^style:\s*(\w+)", aw.read_text(encoding="utf-8"),
                      re.MULTILINE)
        return m.group(1) if m else None
    except Exception:
        return None


def _prose_lint_categories(style: str | None) -> str:
    cats = ["ai-anti-patterns", "writing-general"]
    extra = _STYLE_CATEGORY.get((style or "").lower())
    if extra:
        cats.append(extra)
    return ",".join(cats)


def _is_typ_deck(path: Path) -> bool:
    """True if a .typ file is a slide deck (skip) rather than a letter."""
    for part in path.parts[:-1]:
        if _DECK_DIR_RE.match(part):
            return True
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return any(marker in text for marker in _DECK_MARKERS)


def _edit_ranges(tool_name: str, tool_input: dict, path: Path) -> list[tuple[int, int]]:
    """Line ranges the edit touched. Write -> whole file; Edit -> new_string
    span ±2 lines; unlocatable -> whole file."""
    if tool_name == "Write":
        return [(1, 10**9)]
    new_string = tool_input.get("new_string", "")
    ranges: list[tuple[int, int]] = []
    if new_string and path.exists():
        try:
            file_text = path.read_text()
        except Exception:
            file_text = ""
        idx = file_text.find(new_string)
        while idx != -1:
            start_line = file_text.count("\n", 0, idx) + 1
            end_line = start_line + new_string.count("\n")
            ranges.append((max(1, start_line - 2), end_line + 2))
            idx = file_text.find(new_string, idx + 1)
    return ranges or [(1, 10**9)]


def _in_ranges(line_no: int, ranges: list[tuple[int, int]]) -> bool:
    return any(a <= line_no <= b for a, b in ranges)


def _run_prose_lint(path: Path, style: str | None,
                    ranges: list[tuple[int, int]]) -> list[str]:
    """Run prose-lint.py on the single edited file; return scoped violations."""
    try:
        proc = subprocess.run(
            [sys.executable, str(PROSE_LINT),
             "--only", _prose_lint_categories(style), str(path)],
            capture_output=True, text=True, timeout=30,
        )
    except Exception:
        return []
    # stdout lines pair up: locator line then an indented context line.
    # Locator format: `{path}:{line}:{col} [{category}] {label}`.
    loc_re = re.compile(rf"^{re.escape(str(path))}:(\d+):\d+\s+(\[.+)$")
    out: list[str] = []
    for line in proc.stdout.splitlines():
        m = loc_re.match(line)
        if not m:
            continue
        if _in_ranges(int(m.group(1)), ranges):
            out.append(f"{path.name}:{m.group(1)} {m.group(2)}")
    return out


def _run_check_all(project_root: Path, path: Path,
                   ranges: list[tuple[int, int]]) -> list[str]:
    """Run check-all.py; return logic/structural violations for the edited file,
    excluding constraints superseded by prose-lint."""
    try:
        proc = subprocess.run(
            [sys.executable, str(CHECK_ALL), str(project_root)],
            capture_output=True, text=True, timeout=30,
        )
        raw = proc.stdout.strip()
        brace_depth = 0
        json_end = 0
        for i, ch in enumerate(raw):
            if ch == "{":
                brace_depth += 1
            elif ch == "}":
                brace_depth -= 1
                if brace_depth == 0:
                    json_end = i + 1
                    break
        results = json.loads(raw[:json_end]) if json_end else {}
    except Exception:
        return []

    line_re = re.compile(rf"drafts/{re.escape(path.name)}:(\d+):")
    out: list[str] = []
    for entry in results.get("failed", []):
        name = entry.get("name", "")
        if name.rsplit("/", 1)[-1] in PROSE_LINT_SUPERSEDES:
            continue
        for v in entry.get("violations", []):
            m = line_re.search(v)
            if m and _in_ranges(int(m.group(1)), ranges):
                out.append(v)
    return out


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in ("Edit", "Write"):
        sys.exit(0)

    tool_input = hook_input.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    path = Path(file_path)
    suffix = path.suffix.lower()

    # Routing / scope gates.
    if suffix == ".md":
        if path.parent.name != "drafts":
            sys.exit(0)
        project_root = path.parent.parent
        run_check_all = True
    elif suffix == ".typ":
        if _is_typ_deck(path):
            sys.exit(0)
        project_root = path.parent
        run_check_all = False  # check-all only scans drafts/*.md
    else:
        sys.exit(0)

    style = _detect_style(project_root)
    ranges = _edit_ranges(tool_name, tool_input, path)

    violations = _run_prose_lint(path, style, ranges)
    if run_check_all:
        violations += _run_check_all(project_root, path, ranges)

    if not violations:
        sys.exit(0)

    output = ("Prose quality violations (scoped to edited lines):\n"
              + "\n".join(f"  • {v}" for v in violations))
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": output,
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
