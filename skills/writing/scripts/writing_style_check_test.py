#!/usr/bin/env -S uv run python3
"""writing_style_check_test.py — run DIRECTLY, not under pytest.

    uv run python3 writing_style_check_test.py

The style rules a regex settles are constraints on the CLI contract: checks/writing/constraints/
writing-style.py (Ship diction, ALL-CAPS emphasis, every register) and checks/writing/<register>/
constraints/register-crossing.py (legal, econ, general). Each case writes a draft into a temporary project and
runs the member as bin/workflow-check does, asserting the exit code and the findings it prints.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STYLE = ROOT / "checks" / "writing" / "constraints" / "writing-style.py"
LEGAL = ROOT / "checks" / "writing" / "legal" / "constraints" / "register-crossing.py"
ECON = ROOT / "checks" / "writing" / "econ" / "constraints" / "register-crossing.py"
GENERAL = ROOT / "checks" / "writing" / "general" / "constraints" / "register-crossing.py"

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

LAW_REVIEW_MARKERS = "As explained supra, This Article argues the point; see Part II.B.\n"

LEGAL_OK = "As Part II above explains, see supra note 4; Section 10(b) of the Exchange Act applies.\n"
LEGAL_BAD = "As Section 2 above explains, the rule fails.\n"
LEGAL_PAPER = "This paper argues that the rule fails.\n"
LEGAL_INLINE = "The court so held in Guth v. Loft, Inc., 5 A.2d 503, 510 (Del. 1939), and later cases agree.\n"
LEGAL_FOOTNOTED = """The court so held in Guth v. Loft.[^1] Later cases agree.^[Weinberger v. UOP, Inc., 457 A.2d 701 (Del. 1983).]

[^1]: Guth v. Loft, Inc., 5 A.2d 503, 510 (Del. 1939); see 8 Del. C. § 144; 73 Harv. L. Rev. 1041.
"""


def run(check: Path, draft: str, name: str = "drafts/Intro.md") -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(draft)
        p = subprocess.run([sys.executable, str(check), "--project-dir", d, "--files", str(f)],
                           capture_output=True, text=True, check=False)
        return p.returncode, p.stdout + p.stderr


def main() -> int:
    failures = []

    def expect(name, cond, detail):
        print(("ok   " if cond else "FAIL ") + name)
        if not cond:
            failures.append(f"{name}: {detail}")

    for check in (STYLE, LEGAL, ECON, GENERAL):
        rc, out = run(check, CLEAN)
        expect(f"{check.parent.parent.name}/{check.name}: clean draft exits 0 with only its count line",
               rc == 0 and len(out.strip().splitlines()) == 1, f"rc={rc} out={out!r}")

    rc, out = run(STYLE, SHIP)
    expect("ship diction exits 1", rc == 1, f"rc={rc} {out}")
    expect("ship diction names both phrases on line 1",
           out.count("drafts/Intro.md:1: writing-style SHIP-DICTION") == 2, out)
    expect("quoted diction is skipped", ":2:" not in out, out)

    rc, out = run(STYLE, CAPS)
    expect("caps emphasis exits 1", rc == 1 and "ALL-CAPS: `NOT`" in out, out)
    expect("acronyms are not emphasis", "SEC" not in out, out)

    rc, out = run(STYLE, LAW_REVIEW_MARKERS)
    expect("writing-style, which every register inherits, judges no register marker", rc == 0, out)
    rc, out = run(LEGAL, LAW_REVIEW_MARKERS)
    expect("supra, This Article and Part II.B pass in the legal register", rc == 0, out)
    rc, out = run(ECON, LAW_REVIEW_MARKERS)
    expect("econ register flags supra, This Article and Part II.B",
           rc == 1 and out.count("register-crossing REGISTER-CROSSING") == 3, out)
    rc, out = run(GENERAL, LAW_REVIEW_MARKERS)
    expect("general register flags supra, This Article and Part II.B",
           rc == 1 and out.count("drafts/Intro.md:1: register-crossing REGISTER-CROSSING") == 3, out)
    rc, out = run(GENERAL, LEGAL_PAPER)
    expect("general register flags `This paper`: a memo names itself", rc == 1 and "REGISTER-CROSSING: `This paper`" in out, out)
    rc, out = run(GENERAL, LEGAL_BAD)
    expect("a section cross-reference is no crossing in the general register", rc == 0, out)
    rc, out = run(GENERAL, LEGAL_INLINE)
    expect("INLINE-CITE is not a general-register rule", "INLINE-CITE" not in out, out)

    rc, out = run(LEGAL, LEGAL_OK)
    expect("a statute's Section 10(b) is not a cross-reference", rc == 0, out)
    rc, out = run(LEGAL, LEGAL_BAD)
    expect("legal register flags `Section 2 above`", rc == 1 and "REGISTER-CROSSING" in out, out)

    rc, out = run(LEGAL, LEGAL_PAPER)
    expect("legal register flags `This paper`", rc == 1 and "REGISTER-CROSSING: `This paper`" in out, out)
    rc, out = run(ECON, LEGAL_PAPER)
    expect("`This paper` is the econ self-reference", rc == 0, out)

    rc, out = run(LEGAL, LEGAL_INLINE)
    expect("a full citation in law review body text is INLINE-CITE",
           rc == 1 and "drafts/Intro.md:1: register-crossing INLINE-CITE" in out, out)
    rc, out = run(LEGAL, LEGAL_FOOTNOTED)
    expect("citations in footnotes, inline or defined, are not INLINE-CITE", rc == 0, out)
    rc, out = run(ECON, LEGAL_INLINE)
    expect("INLINE-CITE is a law review rule only", "INLINE-CITE" not in out, out)

    rc, out = run(ECON, LEGAL_OK)
    expect("econ register flags Part II and supra", rc == 1 and out.count("REGISTER-CROSSING") == 2, out)

    rc, out = run(LEGAL, LEGAL_BAD, name="drafts/Intro.typ")
    expect("a Typst draft is prose too", rc == 1 and "drafts/Intro.typ:1:" in out, out)
    for check in (STYLE, LEGAL, ECON, GENERAL):
        rc, out = run(check, SHIP + LEGAL_BAD, name="LICENSE.txt")
        expect(f"{check.parent.parent.name}/{check.name}: a file it does not read is an explicit empty scope",
               rc == 0 and "nothing in scope (" in out.splitlines()[0], out)

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("all cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
