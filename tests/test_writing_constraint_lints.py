#!/usr/bin/env -S uv run python3
"""Regression test for the 3 writing authoring-lints (writing-stop-triggers,
topic-change-protocol, post-subagent-enforcement).

They verify the REAL auto-load wiring — (a) the constraint .md's `applies-to` includes the
skill AND (b) the skill invokes load-constraints.py — NOT a defunct inline `.md` string
reference (which false-failed once check-all correctly scoped APPLIES_TO to writing projects).

Run:  uv run python3 tests/test_writing_constraint_lints.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINTS = ["writing-stop-triggers", "topic-change-protocol", "post-subagent-enforcement"]

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1; print(f"  ok  {name}")
    else:
        _f += 1; print(f"FAIL  {name} {extra}")


def load(stem):
    spec = importlib.util.spec_from_file_location(stem.replace("-", "_"),
                                                  ROOT / "references" / "constraints" / f"{stem}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


for stem in LINTS:
    m = load(stem)
    # 1. passes against the real plugin (the wiring is correct: applies-to + load-constraints call)
    v = m.check({})
    ok(f"{stem}: PASSES on the real plugin (wiring intact)", v == [], str(v))

    # 2. still catches a real regression: simulate the .md applies-to dropping a required skill
    skills_attr = next(a for a in ("PROSE_SKILLS", "PHASE_SKILLS", "SUBAGENT_SKILLS") if hasattr(m, a))
    required = getattr(m, skills_attr)
    orig = m._md_applies_to
    m._md_applies_to = lambda p, _o=orig: [a for a in _o(p) if a != required[0]]
    v = m.check({})
    ok(f"{stem}: FAILS when applies-to omits {required[0]} (real regression caught)",
       any(required[0] in x for x in v), str(v))
    m._md_applies_to = orig

    # 3. the .md it guards actually exists and lists the required skills
    md = ROOT / "references" / "constraints" / f"{stem}.md"
    ok(f"{stem}.md exists", md.is_file())
    applies = m._md_applies_to(md)
    ok(f"{stem}.md applies-to covers all required skills",
       all(s.lower() in applies for s in required), f"applies={applies} required={required}")

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
