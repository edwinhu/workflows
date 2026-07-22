#!/usr/bin/env -S uv run python3
"""
Tests for scripts/load-constraints.py `skill_matches` scoping.

WHAT IT CATCHES
    The matcher used a bare substring test (`skill_name in entry`), so ANY skill whose
    name is a substring of an applies-to entry silently picked that constraint up.
    "ds" is a substring of "wrds": the /ds entry point loaded wrds-sge-enforcement
    (WRDS grid rules, irrelevant to a generic DS project) while /wrds — the intended
    audience — loaded nothing, because the wrds skill never calls the loader at all.
    Nothing failed; the wrong prose just arrived in the wrong prompt.

    The fix mirrors check-all.py's `_applies`: exact match, or entry starting with
    "<skill>-" so a workflow entry point still collects its own phase constraints.

Run:  uv run python3 tests/load_constraints_applies_to_test.py
"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PASS = 0
FAIL = 0


def _load():
    spec = importlib.util.spec_from_file_location("lc", ROOT / "scripts" / "load-constraints.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


lc = _load()


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  ✗ {name} {extra}")


def test_exact_and_all():
    check("exact entry matches", lc.skill_matches(["ds-plan"], "ds-plan"))
    check("'all' matches anything", lc.skill_matches(["all"], "whatever"))
    check("case-insensitive", lc.skill_matches(["DS-Plan"], "ds-plan"))
    check("unrelated entry does not match", not lc.skill_matches(["writing-draft"], "ds-plan"))
    check("empty applies-to matches nothing", not lc.skill_matches([], "ds"))


def test_phase_prefix():
    # A workflow entry point collects the constraints its phase skills declare.
    check("ds picks up ds-implement entry", lc.skill_matches(["ds-implement"], "ds"))
    check("dev picks up dev-review entry", lc.skill_matches(["dev-review", "dev-verify"], "dev"))
    # ...but not the other way around: a phase must not inherit a sibling's constraint.
    check("ds-plan does not match bare 'ds' entry", not lc.skill_matches(["ds"], "ds-plan"))


def test_substring_regression():
    """The actual bug: 'ds' must not match 'wrds'."""
    check("ds does NOT match wrds (the regression)", not lc.skill_matches(["wrds"], "ds"))
    check("ds does NOT match wrds-anything", not lc.skill_matches(["wrds-sge-enforcement"], "ds"))
    check("hpc does not match 'nohpc'", not lc.skill_matches(["nohpc"], "hpc"))
    check("wrds still matches its own entry", lc.skill_matches(["wrds"], "wrds"))


def test_repo_constraints_scope_sanely():
    """Every shipped constraint's applies-to must reach at least one loader-calling skill.

    A constraint nobody can load is dead prose — that is how hpc-slurm-enforcement.md
    and wrds-sge-enforcement.md sat unreachable.
    """
    import re

    callers = set()
    for skill_md in (ROOT / "skills").glob("*/SKILL.md"):
        for m in re.finditer(r"load-constraints\.py\s+([a-z0-9\-]+)", skill_md.read_text()):
            callers.add(m.group(1))
    callers.discard("skill-name")  # the documentation placeholder in workflow-creator
    check("found the loader-calling skills", len(callers) > 10, f"found {len(callers)}")

    orphans = []
    for md in sorted((ROOT / "references" / "constraints").glob("*.md")):
        meta, _ = lc.parse_frontmatter(md.read_text())
        applies_to = meta.get("applies-to", [])
        if isinstance(applies_to, str):
            applies_to = [applies_to]
        if not any(lc.skill_matches(applies_to, s) for s in callers):
            orphans.append(f"{md.name} (applies-to={applies_to})")
    check("no constraint is unreachable", not orphans, "\n      " + "\n      ".join(orphans))


def main():
    for t in (test_exact_and_all, test_phase_prefix, test_substring_regression,
              test_repo_constraints_scope_sanely):
        t()
    total = PASS + FAIL
    print(f"\n{PASS}/{total} passed" + ("" if FAIL == 0 else f"  ({FAIL} FAILED)"))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
