#!/usr/bin/env -S uv run python3
"""
Tests for references/constraints/check-all.py APPLIES_TO scoping (D-w-8 / the documented gotcha:
check-all previously IGNORED APPLIES_TO and ran every constraint on every project → writing's
authoring-lint constraints fired on workshop decks, keeping constraintsPassed permanently false).

Asserts:
  • workshop project → writing-* phantom constraints SKIPPED, typst-* RUN, no permanent error
    (scored-tics-patterns, a no-check() helper, is skipped not errored);
  • writing project → writing-* RUN (no regression), typst-* SKIPPED;
  • no `workflow:` field → everything runs (back-compat: undetected workflow can't scope).

Run:  uv run python3 tests/check_all_applies_to_test.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECK_ALL = ROOT / "references" / "constraints" / "check-all.py"
PASS = 0
FAIL = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  ✗ {name} {extra}")


def run(workflow_line):
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / ".planning"
        p.mkdir(parents=True)
        (p / "ACTIVE_WORKFLOW.md").write_text(f"---\n{workflow_line}\n---\n")
        r = subprocess.run([sys.executable, str(CHECK_ALL), td], capture_output=True, text=True)
        out = r.stdout
        j = json.loads(out[: out.rfind("}") + 1])
        return j


def names(bucket):
    return [(x if isinstance(x, str) else x.get("name", "")) for x in bucket]


def status(j, frag):
    for b in ("skipped", "failed", "passed", "errors", "conventions"):
        if any(frag in n for n in names(j[b])):
            return b
    return "absent"


def test_workshop():
    j = run("workflow: workshop")
    check("workshop: writing-stop-triggers SKIPPED (phantom no longer rides the gate)",
          status(j, "writing-stop-triggers") == "skipped", status(j, "writing-stop-triggers"))
    check("workshop: topic-change-protocol SKIPPED", status(j, "topic-change-protocol") == "skipped")
    check("workshop: post-subagent-enforcement SKIPPED", status(j, "post-subagent-enforcement") == "skipped")
    check("workshop: typst-notes-structure RUNS (not skipped)",
          status(j, "typst-notes-structure") in ("passed", "failed"), status(j, "typst-notes-structure"))
    check("workshop: scored-tics no-check module SKIPPED, not errored",
          not any("scored-tics" in n for n in names(j["errors"])))
    check("workshop: NO permanent errors (broken-module gate gap closed)", len(j["errors"]) == 0, str(j["errors"]))


def test_writing():
    j = run("workflow: writing")
    check("writing: writing-stop-triggers RUNS (its own constraint — no regression)",
          status(j, "writing-stop-triggers") in ("passed", "failed"), status(j, "writing-stop-triggers"))
    check("writing: typst-notes-structure SKIPPED (not a writing constraint)",
          status(j, "typst-notes-structure") == "skipped", status(j, "typst-notes-structure"))


def test_two_dir_layout():
    # The REAL workshop layout (opv-parity Scenario C): ACTIVE_WORKFLOW.md at PROJECT-ROOT/.planning,
    # but check-all is run from presentation/. _detect_workflow must walk UP to find it — else the
    # phantoms still fire in production (the wiring gap a co-located unit test misses).
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / ".planning").mkdir(parents=True)
        (root / ".planning" / "ACTIVE_WORKFLOW.md").write_text("---\nworkflow: workshop\nphase: 4\n---\n")
        pres = root / "presentation"
        pres.mkdir()
        r = subprocess.run([sys.executable, str(CHECK_ALL), str(pres)], capture_output=True, text=True)
        out = r.stdout
        j = json.loads(out[: out.rfind("}") + 1])
        check("two-dir: workflow detected from project-root (walked up from presentation/)",
              status(j, "writing-stop-triggers") == "skipped", status(j, "writing-stop-triggers"))
        check("two-dir: typst constraints still RUN", status(j, "typst-notes-structure") in ("passed", "failed"))
        check("two-dir: 0 permanent errors", len(j["errors"]) == 0, str(j["errors"]))


def test_no_workflow():
    j = run("note: no workflow field here")
    # back-compat: workflow undetected → run everything; only no-check helpers get skipped.
    check("no-workflow: writing-stop-triggers RUNS (back-compat, can't scope)",
          status(j, "writing-stop-triggers") in ("passed", "failed"), status(j, "writing-stop-triggers"))
    check("no-workflow: typst-notes-structure RUNS (back-compat)",
          status(j, "typst-notes-structure") in ("passed", "failed"))


def main():
    for t in (test_workshop, test_writing, test_two_dir_layout, test_no_workflow):
        t()
    total = PASS + FAIL
    print(f"\n{PASS}/{total} passed" + ("" if FAIL == 0 else f"  ({FAIL} FAILED)"))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
