#!/usr/bin/env python3
"""Every workflow must REACH all five shared beats, and its router must PRESENT them.

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

THE SECOND ASSERTION, AND WHY MENTION WAS NEVER ENOUGH
    Until 2026-08-06 this file held ONE check — `reaches()` below — and it asks whether the string
    `<beat>/SKILL.md` appears anywhere in any of a workflow's ~15 family skills. That is satisfiable
    without the property it exists to guarantee, and it was satisfied that way:

        `/writing` named each beat exactly once and scored 3/3. `docs/beat-adoption-migration.md`
        recorded 18/18 adopted with KNOWN_GAPS empty. Its router meanwhile presented an eleven-step
        lifecycle under `## Lifecycle`, with no beat heading and no gate anywhere in it. A `/writing`
        run then did not follow the beats, and nothing broke — because the router never presented
        them. Both facts were true at once. The assertion was measuring MENTION, not SHAPE.

    Same class as the six vacuous passes third-party review found in v5.136/5.137, one layer up, and
    silently true since the beats shipped on 2026-08-02. So `conforms()` now asserts the SHAPE the
    router has to have for a run to actually walk the beats:

        1. an `## N. BEATNAME` heading, N = 1..5, named exactly CLARIFY/PLAN/IMPLEMENT/VERIFY/REVIEW,
           in that order;
        2. a literal `**Gate:**` line in each beat's section — a beat with no gate is a suggestion;
        3. at least one named `<skill>/SKILL.md` reference in each section — a heading that routes
           nowhere is a heading, not a beat.

    Reachability is KEPT rather than replaced. The two catch different failures: an adapter deep in
    the family can satisfy `reaches()` while the router says nothing, and a router can present a
    perfect spine over skills that never load the beat.

KNOWN_GAPS / KNOWN_NONCONFORMING
    BOTH EMPTY as of 2026-08-06. The registries stay because they are the mechanism, not the backlog:
    each entry is asserted to STILL be a gap, so fixing one turns this suite red and names the entry
    to delete. That is what retired all six original gaps, one failing assertion at a time. A new
    exemption must be added deliberately, with its reason and its exit condition, exactly like
    KNOWN_NONCOMPLIANT in tests/workflow-runtime-purity.test.mjs.

    The last KNOWN_GAPS entry to go was ("dev", "beat-clarify"), and it was a DECISION rather than
    work: beat-clarify's Iron Law is "ask before you look" while dev-clarify runs AFTER
    reconnaissance, so an adapter would have loaded the beat and violated its central constraint in
    the same step. It resolved as a SEQUENCE — /dev runs beat-clarify pre-recon (a step whose
    enforcement hook already existed with nothing behind it) and dev-clarify refines post-recon.
    Migration plan: docs/beat-adoption-migration.md.

Run: python3 tests/beat-adoption.test.py
     python3 tests/beat-adoption.test.py --router <path>   # structural check on one file, for red/green
"""
import glob
import os
import re
import sys

BEATS = ("beat-clarify", "beat-plan", "beat-implement", "beat-verify", "beat-review")
WORKFLOWS = ("ds", "dev", "work", "writing", "workshop", "workflow-creator")

# The five beat headings a router must present, in order. The name is the contract at the ROUTER
# level: a router that titles its third beat "GOAL + WORK" or "COMPILE + IMPLEMENT" is naming its own
# procedure, and six routers naming six procedures is the state this spine replaced. Adapter files
# below the router keep their domain titles — `beat-implement`'s own equation is
# `IMPLEMENT = GOAL + WORK + independent VERIFY`, so `work/beats/goal-work.md` is named for a real
# term of art here, not for a habit. Only the router heading is pinned.
SPINE = ("CLARIFY", "PLAN", "IMPLEMENT", "VERIFY", "REVIEW")

# (workflow, beat) pairs that are NOT yet migrated. Each is asserted to still be missing.
KNOWN_GAPS: set[tuple[str, str]] = set()

# Workflows whose ROUTER does not yet present the spine. Each is asserted to still be nonconforming.
KNOWN_NONCONFORMING: set[str] = set()

_HEADING_RE = re.compile(r"(?m)^## (\d)\. ([A-Z][A-Z ]*[A-Z])\s*$")
_SKILL_REF_RE = re.compile(r"[\w-]+/SKILL\.md")
# The runtime form. `${CLAUDE_SKILL_DIR}` is the SKILL's directory, not the containing file's —
# a distinction that has already produced one wrong `../../` in this migration.
_SKILL_DIR_REF_RE = re.compile(r"\$\{CLAUDE_SKILL_DIR\}/([\w./-]+/SKILL\.md)")
_FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def _mask_fences(text: str) -> str:
    """Blank fenced code blocks, preserving offsets and line count.

    A router QUOTES the plan grammar its workflow requires, and those quoted headings are `## `
    lines. `/ds` fences a literal `## Data Outputs` inside its PLAN section, and `/writing` fences
    `## Claims` and six siblings. Slicing on raw `^## ` therefore ends a beat's section early, at a
    heading that is a code sample rather than a section — which reported `/ds` as having no PLAN gate
    when the gate was simply below the fence. A structural test that miscounts structure is the
    defect it was written to catch, one level up.

    Scanned line by line rather than by one regex, because the regex version matched only fences at
    column zero of exactly three characters. CommonMark allows up to three leading spaces and runs
    longer than three, and a ```` block legitimately CONTAINS ``` lines — so the regex both missed
    indented fences and closed four-backtick blocks early. Third-party review caught both.
    """
    out: list[str] = []
    fence: str | None = None
    for line in text.split("\n"):
        if fence is None:
            match = _FENCE_OPEN_RE.match(line)
            if match:
                fence = match.group(1)
                out.append(" " * len(line))
                continue
            out.append(line)
        else:
            closing = _FENCE_OPEN_RE.match(line)
            # A closing fence is the same character, at least as long as the opener. A shorter run
            # (``` inside a ````-opened block) does NOT close it.
            if closing and closing.group(1)[0] == fence[0] and len(closing.group(1)) >= len(fence):
                fence = None
            out.append(" " * len(line))
    return "\n".join(out)


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


def conforms(router_text: str, router_dir: str | None = None) -> list[str]:
    """Structural defects in one router's spine. Empty list means it presents the beats.

    `router_dir` is the directory `${CLAUDE_SKILL_DIR}` expands to at runtime. Pass it and each
    beat's reference must RESOLVE to a file on disk, not merely look like one. Without it this
    check asks only whether the text contains something shaped like `x/SKILL.md` — which is the
    same "a mention satisfies it" defect this suite exists to catch, one level down: a router could
    route every beat to `typo-verify/SKILL.md` and score a clean six-for-six.
    """
    defects: list[str] = []
    router_text = _mask_fences(router_text)
    headings = _HEADING_RE.findall(router_text)
    got = [(int(n), name.strip()) for n, name in headings]

    if [name for _, name in got] != list(SPINE):
        defects.append(
            f"beat headings are {[f'{n}. {name}' for n, name in got] or 'absent'}; "
            f"required exactly {[f'{i}. {b}' for i, b in enumerate(SPINE, 1)]}"
        )
        # Without the headings there are no sections to slice, so stop here rather than
        # reporting five derivative failures for one cause.
        return defects
    if [n for n, _ in got] != [1, 2, 3, 4, 5]:
        defects.append(f"beat headings are numbered {[n for n, _ in got]}; required 1..5 in order")

    # Slice each beat's section: from its heading to the next `## ` heading of any kind.
    bounds = [m.start() for m in _HEADING_RE.finditer(router_text)] + [len(router_text)]
    for index, beat in enumerate(SPINE):
        section = router_text[bounds[index]:bounds[index + 1]]
        following = re.search(r"(?m)^## (?!\d\. )", section)
        if following:
            section = section[: following.start()]
        if "**Gate:**" not in section:
            defects.append(f"{beat} has no `**Gate:**` line — a beat with no gate is a suggestion")
        # BIND BEAT N'S SECTION TO BEAT N. Requiring merely "some `x/SKILL.md`" let a router route
        # all five sections to five unrelated skills and still score clean — both third-party
        # reviewers built that synthetic router and confirmed it returned no defects. `reaches()`
        # cannot cover the gap either: a stray mention anywhere in the ~15-skill family satisfies it.
        own_beat = BEATS[index]
        if f"{own_beat}/SKILL.md" not in section:
            defects.append(
                f"{beat}'s section does not read `{own_beat}/SKILL.md` — the heading claims the beat "
                f"while the body routes elsewhere"
            )
        refs = _SKILL_REF_RE.findall(section)
        if not refs:
            defects.append(f"{beat} names no `<skill>/SKILL.md` — it routes nowhere")
        elif router_dir is not None:
            resolved = [
                ref for ref in _SKILL_DIR_REF_RE.findall(section)
                if os.path.exists(os.path.normpath(os.path.join(router_dir, ref)))
            ]
            if not resolved:
                defects.append(
                    f"{beat} names {refs} but no `${{CLAUDE_SKILL_DIR}}/...` reference in it "
                    f"resolves to a real file — it routes nowhere at runtime"
                )
    return defects



def _self_test() -> None:
    """Guards the guard, on inputs that do not depend on the repo.

    Runs BEFORE the scan. Previously these sat after it and aborted the process on the first
    AssertionError, which masked every already-collected, more specific failure — a reporting
    defect third-party review flagged. Repo-state guards now join `failures` instead of asserting,
    so a broken `work` is reported alongside the other workflows rather than instead of them.
    """
    # Guards the guard: if `family()`, the scan, or the heading regex silently stopped matching,
    # every pair would look like a gap and every router like a defect, and this suite would report
    # busily while proving nothing. `work` reaches all five directly and is the reference spine.
    assert not KNOWN_GAPS, (
        "KNOWN_GAPS is non-empty. Adding an entry means ALSO relaxing this assertion, in the same "
        "commit, with the reason and the exit condition written beside the entry. That coupling is "
        "deliberate and is the whole mechanism: an exemption you can add without touching a "
        "tripwire is an exemption nobody reviews, which is the silent list this registry exists to "
        "prevent. (Inherited note: this message used to say a non-empty registry was 'allowed', "
        "which the assertion directly contradicted.)"
    )
    assert not KNOWN_NONCONFORMING, (
        "KNOWN_NONCONFORMING is non-empty. Same rule and same coupling as KNOWN_GAPS: relax this "
        "assertion in the same commit, with the reason and the exit condition, or it is a denylist "
        "of inconvenient facts."
    )
    assert _HEADING_RE.findall("## 1. CLARIFY\n"), "regex regression: the heading pattern matches nothing"
    assert conforms("no headings here"), "regex regression: conforms() accepts a router with no spine"
    # The fence mask must hide a quoted heading WITHOUT moving anything after it.
    _fenced = "## 1. CLARIFY\nx/SKILL.md\n```\n## Quoted\n```\n**Gate:** g\n"
    assert _mask_fences(_fenced).count("\n") == _fenced.count("\n"), "fence mask changed line count"
    assert "## Quoted" not in _mask_fences(_fenced), "fence mask did not hide a quoted heading"
    assert "**Gate:** g" in _mask_fences(_fenced), "fence mask ate content outside the fence"
    # Indented fence, and a four-backtick block containing a three-backtick line.
    _tricky = "  ```\n## Indented\n  ```\n````\n## Outer\n```\n## StillInside\n````\n## Real\n"
    _masked = _mask_fences(_tricky)
    for hidden in ("## Indented", "## Outer", "## StillInside"):
        assert hidden not in _masked, f"fence mask failed to hide {hidden}"
    assert "## Real" in _masked, "fence mask hid a heading outside every fence"
    # A router that routes every beat to a skill that does not exist must NOT pass.
    _typo = "".join(
        f"## {i}. {b}\n\nRead `${{CLAUDE_SKILL_DIR}}/../no-such-skill-{i}/SKILL.md`.\n\n**Gate:** g\n\n"
        for i, b in enumerate(SPINE, 1)
    )
    assert len(conforms(_typo)) == 5, (
        "binding regression: even without router_dir, five sections reading no beat at all must "
        "produce five wrong-beat defects"
    )
    assert len(conforms(_typo, "skills/work")) == 10, (
        "regression: conforms() accepted five beats routing to skills that neither exist nor "
        "match the beat (expect one wrong-beat defect and one unresolvable defect per beat)"
    )
    # Real, resolvable skills — but every beat reads the WRONG beat. Must still be rejected.
    _swapped = "".join(
        f"## {i}. {b}\n\nRead `${{CLAUDE_SKILL_DIR}}/../beat-review/SKILL.md`.\n\n**Gate:** g\n\n"
        for i, b in enumerate(SPINE, 1)
    )
    assert len(conforms(_swapped, "skills/work")) == 4, (
        "binding regression: conforms() accepted a router whose sections all read beat-review"
    )

def main() -> int:
    if "--router" in sys.argv:
        path = sys.argv[sys.argv.index("--router") + 1]
        with open(path, encoding="utf-8") as handle:
            defects = conforms(handle.read(), os.path.dirname(os.path.abspath(path)))
        for defect in defects:
            print(f"FAIL  {path}: {defect}")
        print(f"beat-spine: {path} {'CONFORMS' if not defects else f'has {len(defects)} defect(s)'}")
        return 1 if defects else 0

    _self_test()

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

    conforming = 0
    for workflow in WORKFLOWS:
        with open(f"skills/{workflow}/SKILL.md", encoding="utf-8") as handle:
            defects = conforms(handle.read(), f"skills/{workflow}")
        exempt = workflow in KNOWN_NONCONFORMING
        if not defects and exempt:
            failures.append(
                f"{workflow}'s router now presents the spine — MIGRATED. "
                f"Delete '{workflow}' from KNOWN_NONCONFORMING."
            )
        elif defects and not exempt:
            for defect in defects:
                failures.append(f"skills/{workflow}/SKILL.md does not present the spine: {defect}")
        elif not defects:
            conforming += 1

    # THE WRITE SURFACE IS STATED BEFORE IT IS ENFORCED.
    #
    # `orchestrator-mutation-guard` is registered in every entry skill's frontmatter, so it denies
    # from the moment the skill loads — but four of the seven routers said NOTHING about the
    # boundary, and the two that mentioned it did so at lines 119/160 and 85/89. The model therefore
    # discovered the rule by being refused, and retried: observed 2026-08-06 in a live `/writing`
    # run, where main chat attempted a write, was denied, and tried again.
    #
    # A denial is not a teaching mechanism. It costs a turn, produces nothing, and arrives after the
    # decision it should have informed. `beat-implement` states this well — and is Read-loaded at
    # IMPLEMENT, which is far too late to stop the attempts that happen before it.
    for workflow in (*WORKFLOWS, "workflow-creator-improve"):
        with open(f"skills/{workflow}/SKILL.md", encoding="utf-8") as handle:
            body = handle.read().split("\n---\n", 1)[-1]
        if "## Write surface" not in body:
            failures.append(
                f"skills/{workflow}/SKILL.md never states its write surface: the guard denies from "
                f"the moment this skill loads, so the router must say so before the first attempt"
            )
            continue
        # UPFRONT, NOT MERELY PRESENT. A statement below the halfway mark is read after the writes
        # it was supposed to prevent — which is exactly the state workflow-creator-improve was in,
        # with its one mention on line 85 of 89.
        position = body.index("## Write surface") / max(len(body), 1)
        if position > 0.35:
            failures.append(
                f"skills/{workflow}/SKILL.md states its write surface {position:.0%} of the way in; "
                f"it must come before the beats it constrains"
            )

    # Repo-state guards, reported rather than asserted: `work` is the reference spine, so if it
    # stops reaching a beat or presenting the spine, that is a scan regression AND a real failure.
    for beat in BEATS:
        if not reaches("work", beat):
            failures.append(f"scan regression: work should reach {beat} directly, found nothing")
    with open("skills/work/SKILL.md", encoding="utf-8") as handle:
        for defect in conforms(handle.read(), "skills/work"):
            failures.append(
                f"scan regression: work is the reference spine and must conform: {defect}. "
                f"Fix work rather than loosening conforms()."
            )

    for failure in failures:
        print(f"FAIL  {failure}")
    total = len(WORKFLOWS) * len(BEATS)
    print(
        f"beat-adoption: {covered}/{total} workflow-beat pairs adopted, "
        f"{len(KNOWN_GAPS)} known gap(s) pending migration"
    )
    print(
        f"beat-spine:    {conforming}/{len(WORKFLOWS)} routers present the five beats with gates, "
        f"{len(KNOWN_NONCONFORMING)} known nonconforming"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
