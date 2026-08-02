#!/usr/bin/env python3
"""The IMPLEMENT observation hook must be REGISTERED, not merely correct.

WHY THIS EXISTS — THE DEFECT IT WOULD HAVE CAUGHT
    `hooks/work-implement-observation.ts` shipped in v5.106.0 registered in NOTHING. No `hooks.json`
    entry, no skill frontmatter, no `matcher: "Agent"` anywhere pointing at it. So
    `scripts/beat/preflight.ts` wrote an expectation file that nothing ever read, and the
    between-dispatch adjudication — the half that catches an agent writing outside its authority or
    misreporting what it wrote — never fired for ANY workflow.

    It had 35 behaviour tests. Every one passed. They proved the hook does the right thing WHEN
    INVOKED, and nothing asked whether it ever was. That is the same defect this repo had already
    found twice in one week and written down twice: measure the mechanism, not the reference; the
    guard was never misbehaving, it was never called. `tests/mutation-guard-registration.test.py`
    exists for precisely this reason and was not extended to the new hook.

    A behaviour test cannot hold this property. Registration is CONFIGURATION, so it needs a
    configuration assertion.

WHAT IS REQUIRED, AND WHY BOTH PHASES
    Every skill that dispatches implementation registers the hook on `matcher: "Agent"` for BOTH
    PreToolUse and PostToolUse. Both, because the adjudication compares a pre-dispatch observation
    against a post-dispatch one: with only `post` there is no baseline and every task is
    unattributable; with only `pre` nothing is ever adjudicated. A half-registration is not a
    weaker guarantee, it is no guarantee, and it looks identical in a diff.

WHY hooks.json IS REQUIRED AND SKILL FRONTMATTER IS NOT SUFFICIENT — MEASURED, NOT REASONED
    v5.106.1 registered this hook ONLY in skill frontmatter, on the argument that registration should
    live next to the thing it guards and fire only while that skill is active. That argument is fine
    and the conclusion was wrong, because skill-frontmatter hooks fire only while the skill is ACTIVE,
    and every caller of `beat-implement` READS its SKILL.md rather than invoking it — it is
    `user-invocable: false, disable-model-invocation: true`, so it cannot be invoked at all.

    Settled by execution, which is what docs/extension-mechanism-map.md:58 already said to do
    ("Not confirmed live ... Settle by execution, not reading."). With 5.106.2 installed, a fresh
    session read skills/beat-implement/SKILL.md and dispatched a subagent whose prompt began
    `TASK probe-alpha:`. The subagent ran. NO record was written anywhere on the filesystem — not even
    the `no-expectation` record this hook writes on every path including its own failure.

    So the skill registration was inert, and v5.106.1 was v5.106.0 with a passing test in front of it.
    That test was THIS FILE: it read YAML and asserted strings were present, which cannot distinguish
    a matcher Claude Code honours from one it ignores.

    `hooks/hooks.json` is the confirmed-live path — always on whenever the plugin is enabled, with
    subagent reach (same doc, line 32 and the scoping table at line 71). It is therefore the ONLY
    registration, and the skill-frontmatter copies are now asserted ABSENT.

WHY THE FRONTMATTER COPIES ARE FORBIDDEN, NOT "DEFENCE IN DEPTH"
    They were left in place as belt-and-braces after the move to hooks.json, and that was wrong.
    Defence in depth is sound for a READ-ONLY check, where a second opinion costs only time. This
    hook WRITES STATE: both registrations fire for the same Agent dispatch, so two processes race to
    `writeFileSync` the same `recordPath(...)`. An interleaved write yields unparseable JSON,
    `implement-gate`'s `readJson` returns undefined, and the wave is refused as `missing-pre` — a
    hard failure whose stated cause ("the hook did not run") points at the opposite of the truth.
    For a dev task it also executes `redCommand` twice per phase: four full suite runs per task.

    So the invariant is EXACTLY ONE registration, and duplication is a defect in its own right.

Run: python3 tests/observation-hook-registration.test.py
"""
import json
import pathlib
import re
import sys

HOOK = "hooks/work-implement-observation.ts"

# Every skill that dispatches implementation agents, and therefore must adjudicate them. Derived
# from who reaches `beat-implement/SKILL.md`; kept explicit so ADDING a dispatching skill without
# registering the hook fails here rather than passing by omission.
DISPATCHING_SKILLS = [
    "beat-implement",
    "writing-draft",
    "workshop",
    "ds-implement",
    "ds-fix",
    "dev-implement",
    "work",
    "workflow-creator",
]

failures: list[str] = []


def frontmatter(path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8")
    parts = text.split("---\n")
    return parts[1] if len(parts) > 2 else ""


def registrations(block: str) -> dict[str, set[str]]:
    """event -> set of phases registered under a matcher that includes Agent."""
    found: dict[str, set[str]] = {"PreToolUse": set(), "PostToolUse": set()}
    event = None
    matcher_has_agent = False
    for line in block.split("\n"):
        stripped = line.strip()
        if stripped in ("PreToolUse:", "PostToolUse:"):
            event = stripped[:-1]
            matcher_has_agent = False
            continue
        if stripped.startswith("- matcher:"):
            # The matcher is a regex alternation; Agent must be one of its alternatives.
            value = stripped.split(":", 1)[1].strip().strip('"')
            matcher_has_agent = "Agent" in re.split(r"\|", value)
            continue
        if HOOK in stripped and matcher_has_agent and event:
            phase = "post" if "--phase post" in stripped else "pre" if "--phase pre" in stripped else "?"
            found[event].add(phase)
    return found


# THE LOAD-BEARING ASSERTION. Everything else here is defence in depth.
manifest = json.loads(pathlib.Path("hooks/hooks.json").read_text(encoding="utf-8"))["hooks"]
for event, phase in (("PreToolUse", "pre"), ("PostToolUse", "post")):
    wired = any(
        "Agent" in re.split(r"\|", group.get("matcher", ""))
        and any(HOOK in hook.get("command", "") and f"--phase {phase}" in hook.get("command", "")
                for hook in group.get("hooks", []))
        for group in manifest.get(event, [])
    )
    if not wired:
        failures.append(
            f"hooks.json has no {event} `matcher: \"Agent\"` running {HOOK} --phase {phase}. "
            f"This is the CONFIRMED-LIVE registration path; skill frontmatter alone was MEASURED inert "
            f"(v5.106.1: subagent dispatched, zero records written)."
        )

# THE PROBE BUDGET MUST FIT INSIDE THE HOOK TIMEOUT. runRedCommand allows 600s; Claude Code's
# default hook timeout is 60s. Without an explicit timeout the runtime kills the hook mid-probe,
# before writeRecord runs — so no record exists and the gate refuses the wave as missing-pre, which
# reads as "the hook did not run" for a hook that ran and was cut off.
for event, phase in (("PreToolUse", "pre"), ("PostToolUse", "post")):
    for group in manifest.get(event, []):
        for hook in group.get("hooks", []):
            command = hook.get("command", "")
            if HOOK in command and f"--phase {phase}" in command:
                if hook.get("timeout", 60) < 600:
                    failures.append(
                        f"hooks.json {event} {HOOK} --phase {phase} has timeout={hook.get('timeout', 60)}s, "
                        f"below the 600s runRedCommand ceiling. The runtime would kill the probe before "
                        f"it writes its record."
                    )

for name in DISPATCHING_SKILLS:
    path = pathlib.Path(f"skills/{name}/SKILL.md")
    if not path.exists():
        failures.append(f"{name}: skills/{name}/SKILL.md does not exist; the registry names a skill that is gone")
        continue
    found = registrations(frontmatter(path))
    # EXACTLY ONE REGISTRATION. hooks.json owns it (asserted above); a frontmatter copy here would
    # double-fire on the same dispatch and corrupt the record both copies write.
    for event, phase in (("PreToolUse", "pre"), ("PostToolUse", "post")):
        if phase in found[event]:
            failures.append(
                f"{name}: frontmatter ALSO registers {HOOK} --phase {phase} on `matcher: \"Agent\"`. "
                f"hooks.json already does, so both fire per dispatch and race to write the same record "
                f"file. Remove the frontmatter copy; duplication here is corruption, not redundancy."
            )

# Guards the guard. If the parser stopped matching — a frontmatter format change, a renamed key —
# every skill would look unregistered and this suite would fail loudly rather than pass vacuously.
# But the inverse is the dangerous one: a parser that matches EVERYTHING would pass while proving
# nothing, so assert it rejects a shape it must reject.
NEGATIVE = """  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/work-implement-observation.ts --phase pre"
"""
assert "pre" not in registrations(NEGATIVE)["PreToolUse"], (
    "parser regression: a matcher WITHOUT Agent was accepted as a registration. The hook would never "
    "fire on a dispatch, which is the exact bug this suite exists to catch."
)
POSITIVE = """  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/work-implement-observation.ts --phase pre"
"""
assert "pre" in registrations(POSITIVE)["PreToolUse"], "parser regression: a valid registration was not recognised"

for failure in failures:
    print(f"FAIL  {failure}")
print(f"observation-hook-registration: hooks.json wired for both phases; "
      f"{len(DISPATCHING_SKILLS) - len({f.split(':')[0] for f in failures})}/{len(DISPATCHING_SKILLS)} "
      f"dispatching skills free of duplicate frontmatter registration")
sys.exit(1 if failures else 0)
