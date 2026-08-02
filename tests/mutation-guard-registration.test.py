#!/usr/bin/env python3
"""Every skill that registers the orchestrator mutation guard must route ALL of it.

WHY THIS EXISTS
    `orchestrator-mutation-guard.ts` is what keeps main chat from mutating the project directly —
    the delegation boundary that stops implementation detail from poisoning the orchestrator's
    context. But hooks are registered per-matcher in each SKILL.md's frontmatter, so a skill can
    register the guard and still leave a tool unrouted. The guard then looks installed, reports
    nothing, and the hole is invisible.

    This is not hypothetical. The guard's own header (hooks/orchestrator-mutation-guard.ts:51-54)
    records it happening once already: "MultiEdit and NotebookEdit were both absent, so both fell
    past this branch to the final allow() — main chat could edit any project file by reaching for
    either." Measured again on 2026-08-02: the five dev-family skills routed Write/Edit/MultiEdit/
    NotebookEdit to the guard but NOT Bash, so `/dev` main chat could mutate the project with
    `sed -i`, `cp`, or a redirect — even though the guard's :95 branch explicitly handles dev's Bash.
    The hook supported it; the registration never wired it.

    A behaviour test cannot catch this: the guard behaves correctly when it is called. The defect is
    that it is never called. So this asserts the CONFIGURATION, which is the only place the gap
    exists — the same shape as tests/workflow-runtime-purity.test.mjs asserting a script's
    constructs rather than its runtime behaviour.

MATCHERS ARE ALTERNATIONS, NOT NAMES
    A first version of this audit compared matcher STRINGS and reported twelve failures, eleven of
    them false: `Write|Edit|MultiEdit|NotebookEdit|Bash` and `Write` + `Edit|MultiEdit|NotebookEdit`
    + `Bash` cover the same tools in different shapes. Coverage is a property of the tool SET, so
    that is what is compared. An audit that cries wolf gets muted, which would be worse than none.

Run: python3 tests/mutation-guard-registration.test.py
"""
import glob
import re
import sys

# Every tool through which main chat could mutate the project. Bash is the one that goes missing,
# because it is the only one whose name does not look like a write.
MUTATION_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"}
GUARD = "orchestrator-mutation-guard"


def frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return ""
    end = text.find("\n---", 4)
    return text[4:end] if end != -1 else ""


def guard_matchers(front: str) -> list[str]:
    """Matchers of every PreToolUse entry whose command runs the guard.

    Parsed without a YAML dependency: the block shape is fixed by the plugin format, and the suite
    must run on a bare interpreter. Each entry is `- matcher: "..."` followed by its `command:` line.
    """
    matchers: list[str] = []
    current: str | None = None
    for line in front.splitlines():
        found = re.match(r'\s*-\s*matcher:\s*"([^"]*)"', line)
        if found:
            current = found.group(1)
            continue
        if current is not None and GUARD in line:
            matchers.append(current)
            current = None
    return matchers


failures: list[str] = []
checked = 0
for path in sorted(glob.glob("skills/*/SKILL.md")):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    if GUARD not in text:
        continue          # not a guarded skill; whether it SHOULD be is a separate question
    checked += 1
    covered: set[str] = set()
    for matcher in guard_matchers(frontmatter(text)):
        covered |= set(matcher.split("|"))
    missing = MUTATION_TOOLS - covered
    if missing:
        failures.append(f"{path}: registers the mutation guard but leaves {', '.join(sorted(missing))} unrouted")

assert checked >= 10, f"expected the guard to be registered by many skills; found {checked} — did the parse break?"

# Guards the guard: if the matcher parser silently stopped finding anything, every skill would show
# every tool missing and this suite would look busy while proving nothing. A known-good skill pins it.
with open("skills/writing/SKILL.md", encoding="utf-8") as handle:
    sample = handle.read()
sample_cov: set[str] = set()
for matcher in guard_matchers(frontmatter(sample)):
    sample_cov |= set(matcher.split("|"))
assert MUTATION_TOOLS <= sample_cov, f"parser regression: writing should cover every mutation tool, saw {sorted(sample_cov)}"

for failure in failures:
    print(f"FAIL  {failure}")
print(f"mutation-guard-registration: {checked - len(failures)}/{checked} guarded skills route every mutation tool")
sys.exit(1 if failures else 0)
