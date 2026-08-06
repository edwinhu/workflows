#!/usr/bin/env python3
"""Every workflow must reach all three shared beats — CLARIFY, IMPLEMENT, REVIEW.

WHY THIS EXISTS
    The beats are shared so that enforcement lives in one place. `beat-implement` is what keeps main
    chat from writing to the project and what binds each task to declared writable paths; a workflow
    that hand-rolls its own agent dispatch inherits none of that. Adoption is therefore a safety
    property, not a tidiness one.

    Nothing enforced it. `writing` and `workshop` drifted off `beat-implement` entirely and no test
    failed — they hand-rolled write-capable dispatch, which is exactly why neither had writable-path
    bounds on any task. `beat-implement` itself had never executed for months for a different reason,
    and that was invisible for the same one: no assertion about who uses what.

    Both were migrated on 2026-08-02. They keep their own orchestration and call the beat's pre-step
    with `dispatchOwnership: "caller"`, which authenticates the approval, bounds each task, and
    derives the expectation the observation hooks adjudicate against — everything except routing and
    script emission, which would be wrong for a workflow that already owns richer phases.

    This is a CONFIGURATION assertion, like tests/mutation-guard-registration.test.py and the
    KNOWN_NONCOMPLIANT registry in tests/workflow-runtime-purity.test.mjs. A behaviour test cannot
    hold it: each beat behaves correctly when it is called, and the defect is that it is not.

REACHING A BEAT, DIRECTLY OR THROUGH AN ADAPTER
    A workflow "reaches" a beat if its own skill loads the beat's SKILL.md, or if any skill in its
    family does. The adapter shape is intended, not a bypass: `ds-accept` and `dev-accept` each load
    `beat-review` and add domain framing, which is where domain-specific surfaces belong.

    Two skills are NOT adapters despite their names, and must never be counted as ones:
    `dev-verify` and `writing-verify` are independent MACHINE review of authenticated artifacts,
    where `beat-review` presents verified work to a PERSON and returns their decision. Counting them
    would mark a real gap as covered.

KNOWN_GAPS
    NOW EMPTY — all 18 pairs are adopted as of 2026-08-02. The registry stays because it is the
    mechanism, not the backlog: each entry is asserted to STILL be a gap, so migrating one turns this
    suite red and names the entry to delete. That is what retired all six, one failing assertion at a
    time. A new exemption must be added deliberately, with its reason and its exit condition, exactly
    like KNOWN_NONCOMPLIANT in tests/workflow-runtime-purity.test.mjs.

    The last entry to go was ("dev", "beat-clarify"), and it was a DECISION rather than work:
    beat-clarify's Iron Law is "ask before you look" while dev-clarify runs AFTER reconnaissance, so
    an adapter would have loaded the beat and violated its central constraint in the same step. It
    resolved as a SEQUENCE — /dev runs beat-clarify pre-recon (a step whose enforcement hook already
    existed with nothing behind it) and dev-clarify refines post-recon. Migration plan:
    docs/beat-adoption-migration.md.

Run: python3 tests/beat-adoption.test.py
"""
import glob
import re
import sys

BEATS = ("beat-clarify", "beat-implement", "beat-review")
WORKFLOWS = ("ds", "dev", "work", "writing", "workshop", "workflow-creator")

# (workflow, beat) pairs that are NOT yet migrated. Each is asserted to still be missing.
KNOWN_GAPS: set[tuple[str, str]] = set()


def family(workflow: str) -> list[str]:
    """The workflow's own skill plus its `<workflow>-*` skills, and work's beats/ directory."""
    paths = glob.glob(f"skills/{workflow}/SKILL.md") + glob.glob(f"skills/{workflow}-*/SKILL.md")
    paths += glob.glob(f"skills/{workflow}/beats/*.md")
    # `dev` must not absorb `workflow-creator`'s skills, and `work` must not absorb `workflow-*`.
    return [p for p in paths if re.match(rf"^skills/{re.escape(workflow)}(-|/)", p)]


def reaches(workflow: str, beat: str) -> list[str]:
    found = []
    for path in family(workflow):
        with open(path, encoding="utf-8") as handle:
            if f"{beat}/SKILL.md" in handle.read():
                found.append(path)
    return found


failures: list[str] = []
covered = 0
for workflow in WORKFLOWS:
    for beat in BEATS:
        via = reaches(workflow, beat)
        gap = (workflow, beat) in KNOWN_GAPS
        if via and gap:
            failures.append(
                f"{workflow} now reaches {beat} (via {', '.join(via)}) — MIGRATED. "
                f"Delete ('{workflow}', '{beat}') from KNOWN_GAPS."
            )
        elif not via and not gap:
            failures.append(
                f"{workflow} does not reach {beat}. Every workflow must use every beat; "
                f"a hand-rolled equivalent inherits none of the beat's enforcement."
            )
        elif via:
            covered += 1

# Guards the guard: if `family()` or the scan silently stopped matching, every pair would look like a
# gap and this suite would report busily while proving nothing. `work` reaches all three directly.
assert not KNOWN_GAPS, (
    "KNOWN_GAPS is non-empty. That is allowed, but never by default: write the reason and the exit "
    "condition next to the entry, or this registry becomes the silent exemption list it exists to prevent."
)
for beat in BEATS:
    assert reaches("work", beat), f"scan regression: work should reach {beat} directly, found nothing"

for failure in failures:
    print(f"FAIL  {failure}")
total = len(WORKFLOWS) * len(BEATS)
print(f"beat-adoption: {covered}/{total} workflow-beat pairs adopted, {len(KNOWN_GAPS)} known gap(s) pending migration")
sys.exit(1 if failures else 0)
