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

WHY SKILL FRONTMATTER RATHER THAN hooks.json
    Registration lives next to the thing it guards, and the hook fires only while that skill is
    active. The central `hooks/hooks.json` names 15 of the 40+ files in `hooks/`; a file silently
    absent from it is exactly how this bug survived. `skills/ds-delegate/SKILL.md` already registers
    `ds-post-subagent-guard` this way — the pattern existed and was not followed.

Run: python3 tests/observation-hook-registration.test.py
"""
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


for name in DISPATCHING_SKILLS:
    path = pathlib.Path(f"skills/{name}/SKILL.md")
    if not path.exists():
        failures.append(f"{name}: skills/{name}/SKILL.md does not exist; the registry names a skill that is gone")
        continue
    found = registrations(frontmatter(path))
    if "pre" not in found["PreToolUse"]:
        failures.append(f"{name}: no PreToolUse `matcher: \"Agent\"` running {HOOK} --phase pre")
    if "post" not in found["PostToolUse"]:
        failures.append(f"{name}: no PostToolUse `matcher: \"Agent\"` running {HOOK} --phase post")

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
print(f"observation-hook-registration: {len(DISPATCHING_SKILLS) - len({f.split(':')[0] for f in failures})}"
      f"/{len(DISPATCHING_SKILLS)} dispatching skills adjudicate their agents")
sys.exit(1 if failures else 0)
