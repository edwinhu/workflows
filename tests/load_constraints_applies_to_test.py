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

    The fix was exact match, or entry starting with "<skill>-" so a workflow entry point
    also collected its phase skills' constraints.

    THAT SECOND HALF IS GONE (2026-07-29). Reverse inheritance meant an entry point absorbed
    every constraint naming any phase in its family: 69% of /ds's load (64,158 of 92,586 bytes)
    was rules for phases it never runs — /ds is brainstorm, and it was handed ds-data-pull-profile
    and ds-join-audits, including rules about touching data that its own hook-enforced Iron Law
    forbids. /writing carried 63% inherited, /dev 45%. A constraint now reaches only the skills it
    NAMES; family scope is opt-in via a `ds-*` glob.

    This file therefore no longer mirrors check-all.py's `_applies`, and MUST NOT be "fixed" to.
    `_applies` matches a WORKFLOW ("should this check run in this project?") where family-prefix
    matching is correct; `skill_matches` matches a SKILL ("should this skill load this text?").
    Unifying them takes a writing project from 30 checks running to 4. See check-all.py's docstring.

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
    """Record a result, and FAIL LOUDLY under a test runner.

    This counted-and-printed rather than asserting, so `pytest` reported "8 passed" on a file whose
    script form exited 1 with 3 real failures — the per-test functions raise nothing, so a runner
    sees them return None and marks them green. A false green over a live failure is worse than no
    test. The counters stay for the standalone summary; the assert is what a runner can see.
    """
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  ✗ {name} {extra}")
    assert cond, f"{name} {extra}".strip()


def test_exact_and_all():
    check("exact entry matches", lc.skill_matches(["ds-plan"], "ds-plan"))
    check("'all' matches anything", lc.skill_matches(["all"], "whatever"))
    check("case-insensitive", lc.skill_matches(["DS-Plan"], "ds-plan"))
    check("unrelated entry does not match", not lc.skill_matches(["writing-draft"], "ds-plan"))
    check("empty applies-to matches nothing", not lc.skill_matches([], "ds"))


def test_phase_prefix():
    # CHANGED 2026-07-29: reverse inheritance is gone. An entry point used to collect every
    # constraint its phase skills declared — 69% of /ds's load was rules for phases it never
    # runs. A constraint now reaches only the skills it NAMES.
    check("ds does NOT pick up a ds-implement entry",
          not lc.skill_matches(["ds-implement"], "ds"))
    check("dev does NOT pick up a dev-review entry",
          not lc.skill_matches(["dev-review", "dev-verify"], "dev"))
    # ...and still not the other way around: a phase must not inherit a sibling's constraint.
    check("ds-plan does not match bare 'ds' entry", not lc.skill_matches(["ds"], "ds-plan"))
    # Family scope is opt-in via the `-*` glob, covering the entry point and every phase.
    check("ds-* matches the ds entry point", lc.skill_matches(["ds-*"], "ds"))
    check("ds-* matches a ds phase", lc.skill_matches(["ds-*"], "ds-implement"))
    check("ds-* does NOT match wrds", not lc.skill_matches(["ds-*"], "wrds"))
    check("ds-* does NOT match wrds-sge", not lc.skill_matches(["ds-*"], "wrds-sge-enforcement"))


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
    read_reached = set()
    for skill_md in (ROOT / "skills").glob("*/SKILL.md"):
        text = skill_md.read_text()
        for m in re.finditer(r"load-constraints\.py\s+([a-z0-9\-]+)", text):
            callers.add(m.group(1))
        # A skill may also deliver a constraint by naming its file directly — ds-delegate does
        # this deliberately, because auto-load reaches main chat but its analysis/engineering
        # SUBAGENTS are what need the rules, and the two roles need different subsets. Counting
        # only bang-line callers would report those as dead prose when they are in fact the only
        # constraints that reach the agent actually doing the work.
        #
        # The mention must be a DELIVERY, not a mention. A bare path regex exempted 27 files when
        # only 18 had a real Read directive; two were exempted solely by an illustrative list in
        # workflow-creator's own docs. That let a constraint retargeted to a retired skill stay
        # green while being genuinely dead — the exact failure this check exists to catch. So the
        # line must also carry `Read` or `${CLAUDE_SKILL_DIR}`, i.e. read as an instruction to load
        # the file rather than prose about it.
        for line in text.splitlines():
            if "Read" not in line and "CLAUDE_SKILL_DIR" not in line:
                continue
            for m in re.finditer(r"references/constraints/([a-z0-9\-]+)\.md", line):
                read_reached.add(m.group(1))
    callers.discard("skill-name")  # the documentation placeholder in workflow-creator
    check("found the loader-calling skills", len(callers) > 10, f"found {len(callers)}")

    orphans = []
    for md in sorted((ROOT / "references" / "constraints").glob("*.md")):
        meta, _ = lc.parse_frontmatter(md.read_text())
        applies_to = meta.get("applies-to", [])
        if isinstance(applies_to, str):
            applies_to = [applies_to]
        if md.stem in read_reached:
            continue  # delivered by an explicit Read — see the comment above
        if not any(lc.skill_matches(applies_to, s) for s in callers):
            orphans.append(f"{md.name} (applies-to={applies_to})")
    check("no constraint is unreachable", not orphans, "\n      " + "\n      ".join(orphans))


def main():
    # check() asserts so a test runner cannot report green over a failure. That would abort the
    # whole script at the first bad check, so swallow it here per-function: script mode keeps
    # reporting across all four groups. Checks *after* a failure within one group are skipped —
    # an accepted trade for never shipping a false green again.
    for t in (test_exact_and_all, test_phase_prefix, test_substring_regression,
              test_repo_constraints_scope_sanely):
        try:
            t()
        except AssertionError:
            pass
    total = PASS + FAIL
    print(f"\n{PASS}/{total} passed" + ("" if FAIL == 0 else f"  ({FAIL} FAILED)"))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
