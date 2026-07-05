#!/usr/bin/env -S uv run python3
"""PostToolUse hook: runs every constraint check that applies to workflow-creator
after edits to workflow-creator files.

"Applies to workflow-creator" is read from each constraint .md's `applies-to`
frontmatter (the same source load-constraints.py uses) — NOT a `wc-*` name glob.
So auto-loader-usage.py, atomic-constraints.py, and the wc-*.py checks all fire,
keeping the PostToolUse hook (Layer 3) aligned with the full applicable set
(check-all.py's wc-filtered subset)."""

import importlib.util
import json
import sys
from pathlib import Path

WC_PATHS = ("skills/workflow-creator/", "references/constraints/wc-")
TARGET_SKILL = "workflow-creator"

# Checks that apply-to workflow-creator but are REPO-WIDE structural scans, not
# edit-relevant guards — they belong in check-all.py / CI (Leg 1), not in a
# per-edit PostToolUse hook (firing them here floods warnings about unrelated
# domains' files on every wc edit). This is a documented, justified gap, not a
# silent omission: check-all.py still runs them.
CI_ONLY = {"atomic-constraints"}

REPO_ROOT = Path(__file__).parent.parent
CONSTRAINTS_DIR = REPO_ROOT / "references" / "constraints"

# Import the SINGLE SOURCE OF TRUTH for applies-to parsing (scripts/load-constraints.py) by path,
# rather than hand-rolling a regex here. The old hand-rolled regex only matched the bracketed list
# form `applies-to: [a, b]` — a scalar `applies-to: workflow-creator` (no brackets) silently fell
# through to "no frontmatter match ⇒ defaults to all", leaking wc-only constraints onto every edit
# in the repo. parse_frontmatter/skill_matches handle both forms identically to check-all.py.
_lc_spec = importlib.util.spec_from_file_location("load_constraints", REPO_ROOT / "scripts" / "load-constraints.py")
_lc = importlib.util.module_from_spec(_lc_spec)
_lc_spec.loader.exec_module(_lc)
parse_frontmatter = _lc.parse_frontmatter
skill_matches = _lc.skill_matches


def applies_to_target(md_path):
    """True iff the .md's applies-to frontmatter includes workflow-creator or 'all'
    (absent applies-to defaults to 'all', matching load-constraints.py)."""
    try:
        text = md_path.read_text()
    except Exception:
        return False
    meta, _body = parse_frontmatter(text)
    applies_to = meta.get("applies-to", [])
    if isinstance(applies_to, str):
        applies_to = [applies_to]
    if not applies_to:
        applies_to = ["all"]
    return skill_matches(applies_to, TARGET_SKILL)


def applicable_checks():
    """Stems whose .md applies to workflow-creator AND have a co-located .py."""
    py_stems = {p.stem for p in CONSTRAINTS_DIR.glob("*.py")}
    out = []
    for md in sorted(CONSTRAINTS_DIR.glob("*.md")):
        if md.stem in CI_ONLY:
            continue
        if md.stem in py_stems and applies_to_target(md):
            out.append(CONSTRAINTS_DIR / f"{md.stem}.py")
    return out


def import_check(py_path):
    spec = importlib.util.spec_from_file_location(py_path.stem, py_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    if tool_name not in ("Write", "Edit"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not any(segment in file_path for segment in WC_PATHS):
        sys.exit(0)

    context = {"cwd": str(REPO_ROOT)}
    failures = []

    for py_path in applicable_checks():
        try:
            mod = import_check(py_path)
            violations = mod.check(context)
            if violations:
                failures.extend(f"{py_path.stem}: {v}" for v in violations)
        except Exception:
            pass

    if failures:
        msg = "Constraint violations after edit:\n" + "\n".join(f"  - {f}" for f in failures)
        result = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "outputToUser": msg}}
        print(json.dumps(result))

    sys.exit(0)


if __name__ == "__main__":
    main()
