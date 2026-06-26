#!/usr/bin/env -S uv run python3
"""Deterministic file-set enumerator regression tests. Run: uv run python3 tests/wc_file_set_test.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "wc"))
from wc_file_set import parse_design  # noqa: E402

P, F = 0, 0


def check(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print(f"  ok  {name}")
    else:
        F += 1; print(f"  FAIL {name} {extra}")


CANONICAL = """# DESIGN: myflow

## Generation Manifest
<!-- keep canonical -->
workflow: myflow
midpoint: fix
phases: explore, design, implement
constraints:
- no-skip-tests | testable
- naming-convention | convention

## Next section
prose
"""

fs = parse_design(CANONICAL, Path("/p"))
ids = [f["fileId"] for f in fs.files]
check("canonical: ok", fs.ok, fs.violations)
check("canonical: entry skill", "skill:myflow" in ids)
check("canonical: midpoint skill", "skill:myflow-fix" in ids)
check("canonical: one skill per phase", all(f"skill:myflow-{p}" in ids for p in ("explore", "design", "implement")))
check("canonical: testable ⇒ .md + .py", "constraint:no-skip-tests.md" in ids and "constraint:no-skip-tests.py" in ids)
check("canonical: convention ⇒ .md only", "constraint:naming-convention.md" in ids and "constraint:naming-convention.py" not in ids)
check("canonical: runner present (has constraints)", "runner:check-all.py" in ids)
check("canonical: 9 files", len(fs.files) == 9, len(fs.files))
check("canonical: absolute paths under project", all(f["path"].startswith("/p/") for f in fs.files))

# midpoint: none ⇒ no midpoint skill
fs2 = parse_design(CANONICAL.replace("midpoint: fix", "midpoint: none"), Path("/p"))
check("midpoint none: no midpoint skill", not any(i.startswith("skill:myflow-fix") for i in [f["fileId"] for f in fs2.files]))

# no manifest ⇒ not ok (caller falls back to LLM)
nf = parse_design("# DESIGN with no manifest section\nprose", Path("/p"))
check("no manifest: not ok", not nf.ok)
check("no manifest: explains why", any("Generation Manifest" in v for v in nf.violations))

# the newline bug regression: an empty `phases:` must NOT swallow the next line
BAD = """## Generation Manifest
workflow: My_Flow
midpoint: bogus
phases:
constraints:
- Bad Name | testable
"""
b = parse_design(BAD, Path("/p"))
check("bad: not ok", not b.ok)
check("bad: flags non-slug workflow name", any("not a kebab-case slug" in v and "My_Flow" in v for v in b.violations))
check("bad: flags bad midpoint", any("midpoint" in v for v in b.violations))
check("bad: empty phases ⇒ 'no phases' (not swallow 'constraints:')",
      any("no `phases:`" in v for v in b.violations) and not any("phase `constraints:`" in v for v in b.violations))
check("bad: flags non-slug constraint", any("Bad Name" in v for v in b.violations))

# duplicate phases
dup = parse_design(CANONICAL.replace("phases: explore, design, implement", "phases: a, b, a"), Path("/p"))
check("dup phases: flagged", any("duplicate phase" in v for v in dup.violations))

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
