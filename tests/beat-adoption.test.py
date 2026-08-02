#!/usr/bin/env python3
"""Every workflow must reach all three shared beats — CLARIFY, IMPLEMENT, REVIEW.

WHY THIS EXISTS
    The beats are shared so that enforcement lives in one place. `beat-implement` is what keeps main
    chat from writing to the project and what binds each task to declared writable paths; a workflow
    that hand-rolls its own agent dispatch inherits none of that. Adoption is therefore a safety
    property, not a tidiness one.

    Nothing enforced it. `writing` and `workshop` drifted off `beat-implement` entirely and no test
    failed — they hand-roll write-capable dispatch (writing-draft.js:443,
    workshop-generate.js:252/274/294), which is exactly why neither has writable-path bounds on any
    task. `beat-implement` itself had never executed for months for a different reason, and that was
    invisible for the same one: no assertion about who uses what.

    This is a CONFIGURATION assertion, like tests/mutation-guard-registration.test.py and the
    KNOWN_NONCOMPLIANT registry in tests/workflow-runtime-purity.test.mjs. A behaviour test cannot
    hold it: each beat behaves correctly when it is called, and the defect is that it is not.

REACHING A BEAT, DIRECTLY OR THROUGH AN ADAPTER
    A workflow "reaches" a beat if its own skill loads the beat's SKILL.md, or if any skill in its
    family does. The adapter shape is intended, not a bypass: `ds-review` and `dev-verify` each load
    `beat-review` and add domain framing, which is where domain-specific surfaces belong.

    Two skills are NOT adapters despite their names, and must never be counted as ones:
    `dev-review` and `writing-review` are independent MACHINE review of authenticated artifacts,
    where `beat-review` presents verified work to a PERSON and returns their decision. Counting them
    would mark a real gap as covered.

KNOWN_GAPS
    The gaps that exist today, each asserted to STILL be a gap. When one is migrated this suite goes
    red and tells you to delete its entry — so the registry cannot rot into a silent exemption, and
    a NEW drift fails immediately rather than joining the list unnoticed. Same contract as
    KNOWN_NONCOMPLIANT. Migration plan: docs/beat-adoption-migration.md.

Run: python3 tests/beat-adoption.test.py
"""
import glob
import re
import sys

BEATS = ("beat-clarify", "beat-implement", "beat-review")
WORKFLOWS = ("ds", "dev", "work", "writing", "workshop", "workflow-creator")

# (workflow, beat) pairs that are NOT yet migrated. Each is asserted to still be missing.
KNOWN_GAPS = {
    # writing does CLARIFY as inline prose under clarify-before-recon-guard: the gate is enforced,
    # the primitive is not used.
    ("writing", "beat-clarify"),
    # writing-draft.js:443 dispatches its own write-capable agent ("Write the full prose to the exact
    # PLAN-owned path ... with the Write tool"), so no task carries writable-path bounds.
    ("writing", "beat-implement"),
    # writing's flow ends "-> /writing-revise -> returned human review surface", a hand-rolled
    # terminal surface. It is the only workflow with no beat-review path.
    ("writing", "beat-review"),
    # workshop clarifies as inline prose, same as writing.
    ("workshop", "beat-clarify"),
    # workshop-generate.js:252/274/294 dispatch their own write-capable agents for fragment files.
    ("workshop", "beat-implement"),
    # dev-clarify is "conversational clarification AFTER dev reconnaissance"; beat-clarify asks the
    # user BEFORE recon and carries evidence-bearing intent forward. These may be genuinely different
    # steps rather than a duplicate, so this entry is a DECISION to make, not merely work to do:
    # either dev-clarify becomes an adapter over beat-clarify, or the divergence is documented as
    # deliberate. Do not collapse it silently to make this suite green.
    ("dev", "beat-clarify"),
}


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
for beat in BEATS:
    assert reaches("work", beat), f"scan regression: work should reach {beat} directly, found nothing"

for failure in failures:
    print(f"FAIL  {failure}")
total = len(WORKFLOWS) * len(BEATS)
print(f"beat-adoption: {covered}/{total} workflow-beat pairs adopted, {len(KNOWN_GAPS)} known gap(s) pending migration")
sys.exit(1 if failures else 0)
