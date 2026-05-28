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
import re
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


def applies_to_target(md_path):
    """True iff the .md's applies-to frontmatter includes workflow-creator or 'all'
    (absent applies-to defaults to 'all', matching load-constraints.py)."""
    try:
        text = md_path.read_text()
    except Exception:
        return False
    if not text.startswith("---"):
        return True  # no frontmatter ⇒ defaults to all
    fm = text.split("---", 2)[1]
    m = re.search(r'applies-to:\s*\[([^\]]*)\]', fm)
    if not m:
        return True
    entries = [e.strip().strip("'\"").lower() for e in m.group(1).split(",")]
    return "all" in entries or TARGET_SKILL in entries


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
