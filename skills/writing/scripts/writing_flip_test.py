#!/usr/bin/env -S uv run python3
"""writing_flip_test.py — prove every gate check FLIPS.

A check demonstrated only passing is indistinguishable from one that always errors.
This suite asserts, for each check, that it exits 0 on a clean project and NON-ZERO on
a project broken in exactly the one way that check exists to catch.

The broken projects are GENERATED here from `fixtures/clean`, one variant per check,
each differing from clean by a single edit. They used to be 60 stored files under
`fixtures/broken/`; storing them made the flip a claim in a README that nothing
re-checked. Generating them makes it a gate that runs every time.

Each variant differs from clean in exactly ONE dimension — otherwise a single shared
defect (a missing receipt, say) drives every check non-zero for the same reason and the
flip demonstrates nothing about the check's own subject.

Exit 0 when every check flips; non-zero otherwise.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLEAN = HERE.parent / "fixtures" / "clean"
SECTION_INDEX = HERE / "writing_section_index.py"
GATE_PROBE = HERE / "writing_gate_probe.py"
PROSE_GATE = HERE / "writing_prose_gate.py"
PLAN_NAME = "writing-fixture-plan.md"

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1
        print(f"  ok  {name}")
    else:
        _f += 1
        print(f"FAIL  {name} {extra}")


def run(*argv: str) -> tuple[int, str]:
    """Run a gate command; return (exit code, combined output)."""
    proc = subprocess.run(["uv", "run", "python3", *argv], capture_output=True, text=True)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def fresh() -> Path:
    """A throwaway copy of fixtures/clean. Never mutate the fixture itself."""
    root = Path(tempfile.mkdtemp(prefix="wr-flip-"))
    dst = root / "proj"
    shutil.copytree(CLEAN, dst)
    return dst


def plan_of(proj: Path) -> Path:
    return proj / ".planning" / PLAN_NAME


def plan_hash(proj: Path) -> str:
    return hashlib.sha256(plan_of(proj).read_bytes()).hexdigest()


def edit(path: Path, old: str, new: str) -> None:
    """Replace exactly once, and refuse if the anchor is gone — a break that silently
    applied to nothing would make the variant identical to clean, and the check would
    'fail to flip' for a reason that is this suite's bug rather than the gate's."""
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"flip fixture anchor not unique in {path}: {old!r} occurs {text.count(old)}x")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# ── the breaks, one per check ────────────────────────────────────────────────
def break_grammar(proj: Path) -> None:
    """Delete a required PLAN heading — GRAMMAR's subject — then RE-DERIVE every hash that
    edit invalidates, so the missing heading is the only defect left.

    Editing the plan changes its sha256, and writing_section_index.py authenticates the plan
    against the receipt BEFORE it parses anything: without this re-derivation the run aborts at
    the hash gate reporting only "hash does not match", `sections: []`, and the grammar dimension
    is never exercised at all — the GRAMMAR row would silently assert what the RECEIPT row
    already asserts. Measured: that is exactly what happened before this was added.
    """
    edit(plan_of(proj),
         "## Counterarguments\n- Administrability favors the status quo, and Part II answers with a bounded test.\n\n",
         "")
    new_hash = plan_hash(proj)
    receipt = proj / ".planning" / ".state" / "review.json"
    data = json.loads(receipt.read_text(encoding="utf-8"))
    data["plan_hash"] = new_hash
    receipt.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    # Every outline and draft pins the plan hash in its frontmatter; each is a separate binding.
    for artifact in sorted((proj / "outlines").glob("*.md")) + sorted((proj / "drafts").glob("*.md")):
        text = artifact.read_text(encoding="utf-8")
        artifact.write_text(
            re.sub(r"^plan_hash: [0-9a-f]{64}$", f"plan_hash: {new_hash}", text, count=1, flags=re.M),
            encoding="utf-8")


def break_receipt(proj: Path) -> None:
    """A receipt field the parser refuses."""
    edit(proj / ".planning" / ".state" / "review.json", '"status": "APPROVED"', '"status": "PENDING"')


def break_cite(proj: Path) -> None:
    """A citation whose bibkey is in no bibliography."""
    d = proj / "drafts" / "Introduction (Draft).md"
    d.write_text(d.read_text(encoding="utf-8").rstrip("\n")
                 + "\nThe gap was first named in an unavailable source [@nosuchkey2021].\n",
                 encoding="utf-8")


def break_claim(proj: Path) -> None:
    """A section that no longer implements the claim the map assigns it."""
    edit(proj / "drafts" / "Part I. The Gap (Draft).md", "implements: [CLAIM-01]", "implements: []")


def break_prose(proj: Path) -> None:
    """A hard-severity AI-tell span."""
    d = proj / "drafts" / "Introduction (Draft).md"
    d.write_text(d.read_text(encoding="utf-8").rstrip("\n")
                 + "\nThe reform stands as a testament to the value of a bounded test.\n",
                 encoding="utf-8")


# ── the checks, each run against clean and against its own break ─────────────
def check_index(proj: Path) -> int:
    return run(str(SECTION_INDEX), str(proj))


def check_probe(draft: str):
    def go(proj: Path) -> int:
        return run(str(GATE_PROBE), str(proj / "drafts" / draft),
                   "--bib", str(proj / "references" / "sources.bib"),
                   "--plan", str(plan_of(proj)), "--plan-hash", plan_hash(proj))
    return go


def check_prose(proj: Path) -> int:
    return run(str(PROSE_GATE), "--project", str(proj), "--style", "general")


# The MARKER is what makes a flip attributable. Asserting only "non-zero" is what let the
# GRAMMAR row pass while testing the receipt binding instead: the plan edit invalidated the
# hash, the parser aborted before parsing grammar, and the row silently duplicated RECEIPT.
# Each case therefore also asserts the failure output names its OWN subject.
CASES = [
    ("GRAMMAR",   check_index,                               break_grammar, "sections in order"),
    ("RECEIPT",   check_index,                               break_receipt, "review.json"),
    ("CITE",      check_probe("Introduction (Draft).md"),    break_cite,    "bibUnresolved"),
    ("CLAIM",     check_probe("Part I. The Gap (Draft).md"), break_claim,   "implements"),
    ("PROSE",     check_prose,                               break_prose,   "hard"),
]

for label, check, apply_break, marker in CASES:
    clean_proj = fresh()
    clean_rc, _ = check(clean_proj)
    ok(f"{label}: exits 0 on a clean project", clean_rc == 0, f"exit {clean_rc}")

    broken_proj = fresh()
    apply_break(broken_proj)
    broken_rc, broken_out = check(broken_proj)
    ok(f"{label}: exits non-zero on a project broken in exactly this way",
       broken_rc != 0, f"exit {broken_rc} — the check did not detect its own subject")
    ok(f"{label}: the failure names its own subject ({marker!r})",
       marker in broken_out,
       f"— exited {broken_rc} but never mentioned {marker!r}, so the flip is attributable to "
       f"something else. Output: {broken_out[:200]!r}")

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
