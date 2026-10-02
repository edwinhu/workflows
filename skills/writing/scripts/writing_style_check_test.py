#!/usr/bin/env -S uv run python3
"""writing_style_check_test.py — run DIRECTLY, not under pytest.

    uv run python3 writing_style_check_test.py

Each case builds a temporary project and runs the check as a subprocess, asserting the exit
code and the rules it names.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

CHECK = Path(__file__).resolve().parent / "writing_style_check.py"

CLEAN = """---
title: fixture
---
# Introduction

The Commission should withdraw the proposal because it raises compliance costs without a
matching benefit. Section 2 sets out the cost estimate; Section 3 answers the objection.

```python
x = "utilize at this point in time"
```

| term | note |
|---|---|
| utilize | in a table, not prose |
"""

SHIP = """Due to the fact that the rule is new, issuers utilize the safe harbor.
The issuer said it would "utilize every remedy" — a quotation, not our diction.
"""

CAPS = "This is NOT the standard the court applied, and the SEC staff agreed.\n"

GENERAL_CROSS = "As explained supra, This Article argues the point; see Part II.B.\n"

LEGAL_OK = "As Part II above explains, see supra note 4; Section 10(b) of the Exchange Act applies.\n"
LEGAL_BAD = "As Section 2 above explains, the rule fails.\n"


def run(draft: str | None, style: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as d:
        if draft is not None:
            (Path(d) / "drafts").mkdir()
            (Path(d) / "drafts" / "Intro.md").write_text(draft)
        p = subprocess.run([sys.executable, str(CHECK), "--project", d, "--style", style],
                           capture_output=True, text=True, check=False)
        return p.returncode, p.stdout


def main() -> int:
    failures = []

    def expect(name, cond, detail):
        print(("ok   " if cond else "FAIL ") + name)
        if not cond:
            failures.append(f"{name}: {detail}")

    rc, out = run(CLEAN, "general")
    expect("clean draft exits 0", rc == 0 and out == "", f"rc={rc} out={out!r}")

    rc, out = run(SHIP, "general")
    expect("ship diction exits 1", rc == 1, f"rc={rc}")
    expect("ship diction names both phrases on line 1",
           out.count("drafts/Intro.md:1: SHIP-DICTION") == 2, out)
    expect("quoted diction is skipped", ":2:" not in out, out)

    rc, out = run(CAPS, "general")
    expect("caps emphasis exits 1", rc == 1 and "ALL-CAPS: `NOT`" in out, out)
    expect("acronyms are not emphasis", "SEC" not in out, out)

    rc, out = run(GENERAL_CROSS, "general")
    expect("general register flags supra, This Article and Part II.B",
           rc == 1 and out.count("REGISTER-CROSSING") == 3, out)

    rc, out = run(GENERAL_CROSS, "legal")
    expect("the same markers pass in the legal register", rc == 0, out)

    rc, out = run(LEGAL_OK, "legal")
    expect("a statute's Section 10(b) is not a cross-reference", rc == 0, out)
    rc, out = run(LEGAL_BAD, "legal")
    expect("legal register flags `Section 2 above`", rc == 1 and "REGISTER-CROSSING" in out, out)

    rc, out = run(LEGAL_OK, "econ")
    expect("econ register flags Part II and supra", rc == 1 and out.count("REGISTER-CROSSING") == 2, out)

    rc, _ = run(None, "general")
    expect("no drafts directory is a refusal", rc == 2, f"rc={rc}")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("all cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
