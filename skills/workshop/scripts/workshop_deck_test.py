#!/usr/bin/env python3
"""Contract suite for ${CLAUDE_PLUGIN_ROOT}/skills/workshop/scripts/workshop-deck.py.

WHY THIS EXISTS
    The defect the probe removes is a check that reports clean when it could not run: upstream's
    `typst-widow-detection.py` returns *no violations* when its detector is absent, and
    `typst-overflow.py` treats every driver exit code other than 1 -- including the 2 its own driver
    exits on a missing dependency -- as clean. A suite that only ever saw green would carry that
    defect forward unnoticed.

    So every computed check is exercised against a deck broken to trip exactly it, and each
    FAIL-path test asserts on THAT check's own emitted line plus the exit code -- never on a bare
    non-zero exit, which an unrelated check's failure already supplies.

    Only `fixtures/clean/` is shipped. Each test stages that project into tmp_path and applies its
    own mutation there, so the break is readable beside the assertion it justifies instead of
    sitting in a committed variant nothing names.

    The second contract is the ds discipline verbatim: FID, CONV and VIS carry MODEL-EVALUATED
    status and are NEVER reported as PASS.

    uv run --with pypdf --with pytest python3 -m pytest \\
        ${CLAUDE_PLUGIN_ROOT}/skills/workshop/scripts/workshop_deck_test.py -q
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

RUNNER = Path(__file__).resolve().parent / "workshop-deck.py"
SKILL_ROOT = RUNNER.parent.parent
FIXTURES = SKILL_ROOT / "fixtures"
CLEAN = FIXTURES / "clean"

MATRIX = ["CMP", "CON", "SPEC", "NOTE", "INV", "WID", "OVR", "ENUM", "FID", "CONV", "VIS"]
MODEL_EVALUATED_CHECKS = ("FID", "CONV", "VIS")
COMPUTED_CHECKS = ("CMP", "CON", "SPEC", "NOTE", "INV", "WID", "OVR", "ENUM")
# ENUM is a meta-check over the emitted line set: a line WAS emitted for each ID even on a run where
# every artifact check failed closed, so it stays PASS there. These are the ones that must all go
# red when the plan declares nothing the probe can open.
ARTIFACT_CHECKS = ("CMP", "CON", "SPEC", "NOTE", "INV", "WID", "OVR")

# Everything the probe's subprocesses reach for, minus `typst`: check-overflow.sh needs a shell and
# uv, and run-constraints.py is invoked through uv when uv is on PATH.
_PASSTHROUGH_BINARIES = (
    "bash", "sh", "env", "uv", "python3", "python",
    "cp", "rm", "cat", "echo", "dirname", "basename", "mktemp", "sed", "grep",
)

LINE_RE = re.compile(r"^\[([A-Z]+)\] (\S+) \| (.*?) \| (.*)$")


def _load_module():
    spec = importlib.util.spec_from_file_location("workshop_deck", RUNNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


workshop_deck = _load_module()


# ------------------------------------------------------------------------------------------------
# Staging and invocation
# ------------------------------------------------------------------------------------------------


def stage(tmp_path: Path, *, plan: str | None = None) -> Path:
    """Copy the clean fixture project into tmp_path; a test then mutates its copy in place.

    Fixtures are never run in place: the probe compiles PDFs beside the sources.
    """
    root = tmp_path / "project"
    shutil.copytree(CLEAN, root)
    if plan is not None:
        (root / "plan.md").write_text(plan, encoding="utf-8")
    return root


def deck_src(root: Path) -> Path:
    return root / "presentation" / "slides.typ"


def notes_src(root: Path) -> Path:
    return root / "presentation" / "notes.typ"


def substitute(path: Path, old: str, new: str, *, count: int = 1) -> None:
    """Rewrite `old` as `new`, asserting it appeared exactly `count` times first.

    Without the count assertion a clean fixture that drifted would turn a mutation into a no-op and
    the test built on it would go green having broken nothing -- the vacuous pass in test form.
    """
    text = path.read_text(encoding="utf-8")
    found = text.count(old)
    assert found == count, (
        f"clean fixture drifted: {path.name} holds {found} occurrence(s) of {old!r}, expected "
        f"{count}; this mutation no longer breaks what its test asserts on"
    )
    path.write_text(text.replace(old, new), encoding="utf-8")


# ------------------------------------------------------------------------------------------------
# Mutations -- each breaks the staged clean project along exactly one axis
# ------------------------------------------------------------------------------------------------


CLEAN_BULLETS = (
    "- Ownership concentration rises across the sample window",
    "- Payout ratios move with it in the same direction",
    "- Coverage is annual and unbalanced at the edges",
    "- Entry and exit are modelled explicitly",
    "- The point estimate survives firm and year effects",
    "- The event study shows the same jump",
)
CLEAN_FINAL_LINE = "The estimate is stable across every specification."


def break_con_banned_package(root: Path) -> None:
    """Name a banned package: two vendored constraint modules ban `cetz-plot` outright."""
    substitute(deck_src(root), "#let inv(..ids) = none",
               "// charting via cetz-plot was considered and rejected\n#let inv(..ids) = none")


def break_cmp_uncompilable_notes(root: Path) -> None:
    """Call a function `notes.typ` never defines, so `typst compile` exits non-zero."""
    substitute(notes_src(root), "= Speaker notes",
               "#this-function-does-not-exist()\n\n= Speaker notes")


def break_spec_extra_built_slide(root: Path) -> None:
    """Append a fourth built slide -- and its notes section -- that no Slide Spec row declares."""
    with deck_src(root).open("a", encoding="utf-8") as fh:
        fh.write(
            "\n#pagebreak()\n\n"
            "=== An unspecified bonus slide appears.\n"
            '#inv("F2")\n\n'
            "- Nobody planned this slide\n\n"
            "- It is in the deck all the same\n\n"
            "It is here without a Slide Spec row.\n"
        )
    with notes_src(root).open("a", encoding="utf-8") as fh:
        fh.write("\n== An unspecified bonus slide appears.\n\n- Say something about the bonus slide.\n")


def break_spec_retitled_slide(root: Path) -> None:
    """Retitle the third slide in BOTH sources: cardinality is preserved, correspondence is not."""
    substitute(deck_src(root), "=== Blockholders raise dividends by four points.",
               "=== Blockholders raise payout by four points.")
    substitute(notes_src(root), "== Blockholders raise dividends by four points.",
               "== Blockholders raise payout by four points.")


def break_note_missing_section(root: Path) -> None:
    """Drop the third slide's notes section, leaving a built slide nothing narrates."""
    substitute(
        notes_src(root),
        "\n== Blockholders raise dividends by four points.\n\n"
        "- Give the point estimate once.\n\n"
        "- Then move to the event study.\n",
        "",
    )


def break_inv_undeclared_id(root: Path) -> None:
    """Cite `R9`, which `## Source Inventory` never declares."""
    substitute(deck_src(root), '#inv("R1", "F2")', '#inv("R9", "F2")')


def break_inv_no_call(root: Path) -> None:
    """Strip the second slide's `#inv(` call entirely (R5 emission)."""
    substitute(deck_src(root),
               '=== The panel spans 1994 through 2019.\n#inv("T3", "A4")\n',
               "=== The panel spans 1994 through 2019.\n")


def break_inv_commented_line_call(root: Path) -> None:
    """Comment out the second slide's only `#inv(` call with a `//` line comment."""
    substitute(deck_src(root), '#inv("T3", "A4")', '// #inv("T3", "A4")')


def break_inv_commented_block_call(root: Path) -> None:
    """Comment out the second slide's only `#inv(` call with a `/* ... */` block comment."""
    substitute(deck_src(root), '#inv("T3", "A4")', '/* #inv("T3", "A4") */')


def add_unpaired_quote(root: Path) -> None:
    """Put an inch mark in the deck's markup: one lone `"` a valid Typst deck may legitimately carry.

    Typst markup treats `"` as ordinary text, so quote parity carries no meaning there. A stripper
    that tracks string literals reads everything after this mark as being inside a string and stops
    removing comments, so a commented `#inv(` below it survives into the match and reads as a real
    emission. The clean fixture's quotes are balanced, so without this mutation only the in-sync
    path is exercised and the comment tests cannot fail against the defect they name.
    """
    substitute(deck_src(root), "Ownership and payout: a fixture deck",
               'Ownership and payout: a 6" fixture deck')


def break_inv_empty_call(root: Path) -> None:
    """Keep the call and remove its IDs: an emission that declares nothing."""
    substitute(deck_src(root), '#inv("T3", "A4")', "#inv()")


def break_inv_cites_f10(root: Path) -> None:
    """Cite `F10` from every slide -- whole-token matching, against a `F1`-only inventory."""
    for call in ('#inv("R1", "A4")', '#inv("T3", "A4")', '#inv("R1", "F2")'):
        substitute(deck_src(root), call, '#inv("F10")')


def break_inv_boilerplate_emission(root: Path) -> None:
    """Emit the same declared ID from every slide -- the hole a membership-only INV cannot see.

    `A4` is declared in `## Source Inventory`, so every emitted token is declared and the deck's
    cited set is a subset of the inventory. Only per-slide set equality against each row's own
    `Inventory` cell distinguishes this deck from one whose citations correspond to its content.
    """
    for call in ('#inv("R1", "A4")', '#inv("T3", "A4")', '#inv("R1", "F2")'):
        substitute(deck_src(root), call, '#inv("A4")')


def break_ovr_frame_overflow(root: Path) -> None:
    """Cram 25 bullets onto one slide so its content runs off the frame."""
    substitute(deck_src(root), CLEAN_BULLETS[0], "\n".join(
        f"- Robustness note {i} is spelled out at length on this slide" for i in range(1, 26)))


def break_wid_widow(root: Path, final_line: str) -> None:
    """Replace the deck's last line, which is the last line of the last page."""
    substitute(deck_src(root), CLEAN_FINAL_LINE, final_line)


def break_wid_no_extractable_text(root: Path) -> None:
    """Insert a page holding only a filled rectangle: zero text, hence zero widows."""
    substitute(deck_src(root), "\n== Motivation\n",
               "\n#rect(width: 12cm, height: 6cm, fill: gray)\n\n#pagebreak()\n\n== Motivation\n")


def break_wid_every_page_skipped(root: Path) -> None:
    """Rewrite the deck as four wholly skippable pages: the title, then three bare section names.

    Every page is in the skip set, so the page count clears R10's floor while the scan covers
    nothing. Also leaves the deck with zero `=== ` title lines, which is SPEC's empty-set case.
    """
    deck_src(root).write_text(
        '#set page(paper: "presentation-16-9", margin: 2em)\n'
        "#set text(size: 20pt)\n\n"
        "Ownership and payout: a fixture deck\n\n"
        "#pagebreak()\n\nMotivation\n\n#pagebreak()\n\nData\n\n#pagebreak()\n\nResult\n",
        encoding="utf-8",
    )


def break_wid_page_count_below_floor(root: Path) -> None:
    """Cram all three slides onto one page: one handout page against three Slide Spec body rows."""
    deck_src(root).write_text(
        "#let inv(..ids) = none\n\n"
        '#set page(paper: "presentation-16-9", margin: 2em)\n'
        "#set text(size: 9pt)\n\n"
        "=== Concentrated ownership predicts higher payout.\n"
        '#inv("R1", "A4")\n\n'
        "Both series move together across the whole window.\n\n"
        "=== The panel spans 1994 through 2019.\n"
        '#inv("T3", "A4")\n\n'
        "Coverage is stable after the first three years.\n\n"
        "=== Blockholders raise dividends by four points.\n"
        '#inv("R1", "F2")\n\n'
        f"{CLEAN_FINAL_LINE}\n",
        encoding="utf-8",
    )


def add_pause_steps(root: Path) -> None:
    """Give each content slide two `#pause` steps, branching on `sys.inputs` as the theme does.

    The two builds then differ in page count -- 7 handout pages against 13 overlay pages -- which is
    the only thing that can identify which build the probe measured.
    """
    substitute(deck_src(root), "#let inv(..ids) = none",
               "#let inv(..ids) = none\n"
               '#let handout = sys.inputs.at("handout", default: "false") == "true"\n'
               "#let pause = if handout { none } else { pagebreak(weak: true) }")
    for bullet in CLEAN_BULLETS:
        substitute(deck_src(root), bullet, f"{bullet}\n\n#pause")


class Report(dict):
    """The probe's stdout, parsed back into the check lines a gate reads."""

    def __init__(self, code: int, stdout: str, stderr: str):
        super().__init__()
        self.code = code
        self.stdout = stdout
        self.stderr = stderr
        self.order: list[str] = []
        for line in stdout.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            check, status, detail, evidence = m.groups()
            self.order.append(check)
            self[check] = {"status": status, "detail": detail, "evidence": evidence, "line": line}

    def status(self, check: str) -> str:
        assert check in self, f"no line emitted for {check}:\n{self.stdout}\n{self.stderr}"
        return self[check]["status"]


def probe(root: Path, *, runner: Path = RUNNER, env: dict | None = None,
          args: tuple[str, ...] = ()) -> Report:
    """Run the probe as the gate runs it and parse the emitted check lines.

    A scratch skill copy gets its own scratch constraint corpus: the real one belongs to the
    typst plugin and no test may stub or delete it.
    """
    if runner != RUNNER:
        env = dict(os.environ if env is None else env)
        env["WORKSHOP_CONSTRAINT_RUNNER"] = str(
            runner.parent.parent / "constraints" / "run-constraints.py")
    proc = subprocess.run(
        [sys.executable, str(runner), "--plan", str(root / "plan.md"),
         "--project-dir", str(root), *args],
        capture_output=True, text=True, env=env, check=False,
    )
    report = Report(proc.returncode, proc.stdout, proc.stderr)
    assert report.order, f"probe emitted no check line:\n{proc.stdout}\n{proc.stderr}"
    return report


def assert_only_failure(report: Report, check: str) -> None:
    """The named check FAILed and nothing else did: the FAIL cannot be someone else's."""
    assert report.status(check) == "FAIL", report[check]
    for other in ARTIFACT_CHECKS:
        if other != check:
            assert report.status(other) == "PASS", (other, report[other])
    assert report.code == 1, report.stdout


def plan_text() -> str:
    return (CLEAN / "plan.md").read_text(encoding="utf-8")


def replace_section(text: str, heading: str, new_body: str) -> str:
    """Replace the body under `## <heading>`, up to the next H2. Used to break one clause."""
    pattern = re.compile(rf"(^## {re.escape(heading)}\n)(.*?)(?=^## )", re.MULTILINE | re.DOTALL)
    new_text, n = pattern.subn(lambda m: m.group(1) + new_body, text)
    assert n == 1, f"fixture plan drifted: `## {heading}` not found exactly once"
    return new_text


def scratch_skill(tmp_path: Path) -> Path:
    """A writable copy of the skill, so a part it reaches for can be removed or stubbed.

    The constraint corpus lives in the typst plugin, not in this skill, so it is copied in
    beside the scratch skill as `constraints/` and reached through
    `WORKSHOP_CONSTRAINT_RUNNER` (see `probe`).
    """
    dest = tmp_path / "skill"
    shutil.copytree(
        SKILL_ROOT, dest,
        ignore=shutil.ignore_patterns("fixtures", "__pycache__", "*.pyc", ".pytest_cache"),
    )
    shutil.copytree(
        CONSTRAINT_RUNNER.parent, dest / "constraints",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    return dest


def scratch_constraint_runner(skill: Path) -> Path:
    return skill / "constraints" / "run-constraints.py"


def scratch_runner(tmp_path: Path) -> Path:
    return scratch_skill(tmp_path) / "scripts" / "workshop-deck.py"


def _bindir(tmp_path: Path, name: str) -> Path:
    bindir = tmp_path / name
    bindir.mkdir(parents=True, exist_ok=True)
    for binary in _PASSTHROUGH_BINARIES:
        found = shutil.which(binary)
        if found and not (bindir / binary).exists():
            (bindir / binary).symlink_to(found)
    return bindir


def env_without_typst(tmp_path: Path) -> dict:
    """os.environ with a PATH holding every binary the probe shells out to EXCEPT typst."""
    bindir = _bindir(tmp_path, "bin-no-typst")
    assert shutil.which("typst", path=str(bindir)) is None
    env = dict(os.environ)
    env["PATH"] = str(bindir)
    return env


def env_with_silent_typst(tmp_path: Path) -> dict:
    """A `typst` that exits 0 and writes no file: a compile that produced nothing."""
    bindir = _bindir(tmp_path, "bin-silent-typst")
    fake = bindir / "typst"
    fake.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake.chmod(0o755)
    env = dict(os.environ)
    env["PATH"] = str(bindir)
    return env


def env_with_nonpdf_typst(tmp_path: Path) -> dict:
    """A `typst` that exits 0 and writes a non-PDF byte string to its output path.

    Both compile invocations put the output last, so this yields a non-empty file that satisfies
    `compile_handout`'s produced-a-file guard and then drives `PdfReader` into its error branch.
    """
    bindir = _bindir(tmp_path, "bin-nonpdf-typst")
    fake = bindir / "typst"
    fake.write_text(
        '#!/bin/sh\nfor a in "$@"; do out="$a"; done\n'
        'printf \'NOT-A-PDF: a byte string no reader can parse\' > "$out"\nexit 0\n',
        encoding="utf-8",
    )
    fake.chmod(0o755)
    env = dict(os.environ)
    env["PATH"] = str(bindir)
    return env


def stub_constraint_runner(skill: Path, report: dict, *, exit_code: int = 1) -> None:
    """Replace the vendored constraint runner with one replaying a fixed JSON report."""
    runner = scratch_constraint_runner(skill)
    runner.write_text(
        "import json, sys\n"
        f"print(json.dumps({report!r}))\n"
        f"sys.exit({exit_code})\n",
        encoding="utf-8",
    )


def stub_overflow_driver(skill: Path, output: str, *, exit_code: int = 0) -> None:
    """Replace the vendored overflow driver with one replaying fixed output and a fixed status."""
    driver = skill / "scripts" / "checks" / "check-overflow.sh"
    driver.write_text(f"#!/bin/bash\ncat <<'EOF'\n{output}\nEOF\nexit {exit_code}\n", encoding="utf-8")
    driver.chmod(0o755)


# ------------------------------------------------------------------------------------------------
# GREEN: the clean fixture
# ------------------------------------------------------------------------------------------------


def test_clean_fixture_exits_zero_with_every_computed_check_passing(tmp_path: Path):
    report = probe(stage(tmp_path))
    assert report.code == 0, report.stdout
    for check in COMPUTED_CHECKS:
        assert report.status(check) == "PASS", (check, report[check])


def test_clean_fixture_emits_exactly_one_line_per_matrix_id_in_matrix_order(tmp_path: Path):
    report = probe(stage(tmp_path))
    assert report.order == MATRIX, report.stdout


def test_the_tests_matrix_has_not_drifted_from_the_probe():
    # If the probe gains a check and this list does not, every assertion below silently stops
    # covering it -- the drift the checks file's Iron Law forbids.
    assert list(workshop_deck.MATRIX) == MATRIX, (list(workshop_deck.MATRIX), MATRIX)


def test_no_model_evaluated_check_is_ever_computed_in_the_probe():
    assert set(workshop_deck.MODEL_EVALUATED) == set(MODEL_EVALUATED_CHECKS)
    assert not set(workshop_deck.MODEL_EVALUATED) & set(COMPUTED_CHECKS)


@pytest.mark.parametrize("check", MODEL_EVALUATED_CHECKS)
def test_judgement_checks_are_never_pass(check: str, tmp_path: Path):
    for mutate in (None, break_con_banned_package, break_inv_no_call):
        name = mutate.__name__ if mutate else "clean"
        root = stage(tmp_path / name)
        if mutate:
            mutate(root)
        report = probe(root)
        assert report.status(check) == "MODEL-EVALUATED", (name, check, report[check])
        assert report.status(check) != "PASS"


# ------------------------------------------------------------------------------------------------
# CMP -- including R11: absent typst, an absent declared source, a compile that produced no file
# ------------------------------------------------------------------------------------------------


def test_cmp_fails_when_a_declared_source_does_not_compile(tmp_path: Path):
    root = stage(tmp_path)
    break_cmp_uncompilable_notes(root)
    report = probe(root)
    assert report.status("CMP") == "FAIL", report["CMP"]
    assert "notes.typ" in report["CMP"]["detail"]
    assert report.code == 1


def test_cmp_fails_closed_when_typst_is_absent(tmp_path: Path):
    # `typst` off PATH fails WID by R11 too, so a bare exit-code assertion would be satisfied by
    # `[CMP] PASS` beside `[WID] FAIL` while CMP compiled nothing. Both lines are named.
    report = probe(stage(tmp_path), env=env_without_typst(tmp_path))
    assert report.status("CMP") == "FAIL", report["CMP"]
    assert "not on PATH" in report["CMP"]["detail"]
    assert "compiled=0 of 2" in report["CMP"]["evidence"]
    assert report.status("WID") == "FAIL", report["WID"]
    assert "not on PATH" in report["WID"]["detail"]
    assert report.code == 1


def test_cmp_fails_when_a_declared_source_does_not_exist_on_disk(tmp_path: Path):
    root = stage(tmp_path)
    (root / "presentation" / "notes.typ").unlink()
    report = probe(root)
    assert report.status("CMP") == "FAIL", report["CMP"]
    assert "does not exist on disk" in report["CMP"]["detail"]
    assert "notes.typ" in report["CMP"]["detail"]
    assert report.code == 1


def test_cmp_fails_when_a_compile_produces_no_output_file(tmp_path: Path):
    # A `typst` that exits 0 silently and writes nothing: compiling zero files is a FAIL, not a
    # clean run. Upstream's shape is exactly this -- success status, nothing measured.
    report = probe(stage(tmp_path), env=env_with_silent_typst(tmp_path))
    assert report.status("CMP") == "FAIL", report["CMP"]
    assert "produced no output file" in report["CMP"]["detail"]
    assert report.code == 1


# ------------------------------------------------------------------------------------------------
# CON -- the runner's JSON is read, not its status
# ------------------------------------------------------------------------------------------------


def test_con_fails_on_a_hard_constraint_violation(tmp_path: Path):
    root = stage(tmp_path)
    break_con_banned_package(root)
    report = probe(root)
    assert report.status("CON") == "FAIL", report["CON"]
    assert "typst-cetz-diagrams" in report["CON"]["detail"]
    assert "hard" in report["CON"]["detail"]
    assert report.code == 1


def test_con_reads_the_runners_json_rather_than_treating_exit_1_as_a_crash(tmp_path: Path):
    # The runner exits 1 for a violation AND for an infrastructure failure. CON must tell them
    # apart by the JSON: here the exit is 1 and the verdict still names the failing module.
    root = stage(tmp_path)
    break_con_banned_package(root)
    report = probe(root)
    assert "exit=1" in report["CON"]["evidence"], report["CON"]
    assert "inspected_total=" in report["CON"]["evidence"]
    assert "typst-cetz-diagrams" in report["CON"]["evidence"]
    assert "could not run" not in report["CON"]["detail"]


def test_con_fails_when_no_module_inspected_a_file(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    stub_constraint_runner(skill, {
        "modules": 15,
        "passed": [{"name": f"typst-{i}", "inspected": 0} for i in range(15)],
        "failed": [], "errors": [], "skipped": [], "inspected_total": 0,
    })
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("CON") == "FAIL", report["CON"]
    assert "inspected-file count is zero" in report["CON"]["detail"]
    assert report.code == 1


def test_con_fails_on_a_non_empty_errors_list(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    stub_constraint_runner(skill, {
        "modules": 15,
        "passed": [{"name": "typst-tables", "inspected": 2}],
        "failed": [],
        "errors": [{"name": "typst-computed-values", "inspected": 0, "error": "ImportError: lxml"}],
        "skipped": [], "inspected_total": 2,
    })
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("CON") == "FAIL", report["CON"]
    assert "typst-computed-values" in report["CON"]["detail"]
    assert "checked nothing" in report["CON"]["detail"]
    assert report.code == 1


def test_con_fails_on_a_non_empty_skipped_list(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    stub_constraint_runner(skill, {
        "modules": 15,
        "passed": [{"name": "typst-tables", "inspected": 2}],
        "failed": [], "errors": [],
        "skipped": [{"name": "typst-images", "inspected": 0, "reason": "no callable check()"}],
        "inspected_total": 2,
    })
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("CON") == "FAIL", report["CON"]
    assert "typst-images" in report["CON"]["detail"]
    assert "skipped" in report["CON"]["detail"]
    assert report.code == 1


def test_con_fails_when_a_failed_module_is_reported_beside_a_zero_exit(tmp_path: Path):
    # A runner that prints a failed[] and exits 0 is a check that cannot fail. CON reads the JSON,
    # so the verdict does not follow the status.
    skill = scratch_skill(tmp_path)
    stub_constraint_runner(skill, {
        "modules": 15,
        "passed": [{"name": "typst-tables", "inspected": 2}],
        "failed": [{"name": "typst-slide-format", "inspected": 2, "severity": "hard",
                    "violations": [{"line": 4, "found": "three pauses"}]}],
        "errors": [], "skipped": [], "inspected_total": 4,
    }, exit_code=0)
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("CON") == "FAIL", report["CON"]
    assert "typst-slide-format" in report["CON"]["detail"]
    assert "exit=0" in report["CON"]["evidence"]
    assert report.code == 1


def test_con_fails_on_unparseable_runner_output(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    scratch_constraint_runner(skill).write_text(
        "print('not json at all')\n", encoding="utf-8")
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("CON") == "FAIL", report["CON"]
    assert "unparseable JSON" in report["CON"]["detail"]
    assert report.code == 1


def test_con_fails_on_its_own_line_over_an_empty_presentation_dir(tmp_path: Path):
    # CMP fails here too (both declared sources are gone), so a bare non-zero exit would not show
    # that CON reported FAIL rather than being masked by CMP's. Both lines are named, and CON's
    # detail is the inspected-count one: every vendored module globs its own inputs and returns []
    # over an empty tree, so "clean" there is clean having opened no file.
    root = stage(tmp_path)
    for stale in (root / "presentation").iterdir():
        stale.unlink()
    assert not list((root / "presentation").iterdir())
    report = probe(root)
    assert report.status("CON") == "FAIL", report["CON"]
    assert "inspected-file count is zero" in report["CON"]["detail"], report["CON"]
    assert "inspected_total=0" in report["CON"]["evidence"], report["CON"]
    assert report.status("CMP") == "FAIL", report["CMP"]
    assert "does not exist on disk" in report["CMP"]["detail"], report["CMP"]
    assert report.code == 1


def test_con_fails_closed_when_the_vendored_runner_is_absent(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    scratch_constraint_runner(skill).unlink()
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("CON") == "FAIL", report["CON"]
    assert "constraint runner is absent" in report["CON"]["detail"]
    assert report.code == 1


# ------------------------------------------------------------------------------------------------
# The constraint runner's own exit contract (R3): it is shipped as a standalone mechanicalCheck
# ------------------------------------------------------------------------------------------------


CONSTRAINT_RUNNER = (Path.home() / ".claude" / "skills" / "typst" / "references" / "checkers"
                     / "workshop" / "run-constraints.py")


def run_constraints(target: Path) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, str(CONSTRAINT_RUNNER), str(target)],
        capture_output=True, text=True, check=False,
    )
    return proc.returncode, json.loads(proc.stdout)


def test_run_constraints_exits_zero_on_the_clean_fixture(tmp_path: Path):
    code, report = run_constraints(stage(tmp_path) / "presentation")
    assert code == 0, report
    assert report["failed"] == [] and report["errors"] == [] and report["skipped"] == []
    assert report["inspected_total"] > 0, report


def test_run_constraints_exits_one_on_a_hard_violation(tmp_path: Path):
    root = stage(tmp_path)
    break_con_banned_package(root)
    code, report = run_constraints(root / "presentation")
    assert code == 1, report
    names = [f["name"] for f in report["failed"]]
    # Two vendored modules ban cetz-plot, so the banned line trips both; the contract under test is
    # the exit status beside a populated failed[], not which modules caught it.
    assert "typst-cetz-diagrams" in names, report["failed"]
    assert all(f["severity"] == "hard" for f in report["failed"]), report["failed"]
    assert report["inspected_total"] > 0, report


def test_run_constraints_exits_one_when_nothing_was_inspected(tmp_path: Path):
    # Every vendored module globs its own inputs and returns [] when it finds none, so an empty
    # tree reads exactly like a clean deck. Exit 0 here would be a check that cannot fail.
    empty = tmp_path / "empty"
    empty.mkdir()
    code, report = run_constraints(empty)
    assert code == 1, report
    assert report["inspected_total"] == 0, report
    assert report["failed"] == [] and report["errors"] == [], report


# ------------------------------------------------------------------------------------------------
# SPEC -- both directions, and never a row count
# ------------------------------------------------------------------------------------------------


def test_spec_fails_when_a_built_slide_has_no_spec_row(tmp_path: Path):
    root = stage(tmp_path)
    break_spec_extra_built_slide(root)
    report = probe(root)
    assert report.status("SPEC") == "FAIL", report["SPEC"]
    assert "1 built slide(s) with no spec row" in report["SPEC"]["detail"]
    assert "An unspecified bonus slide appears." in report["SPEC"]["detail"]
    assert "0 spec row(s) with no built slide" in report["SPEC"]["detail"]
    assert report.code == 1


def test_spec_fails_when_a_spec_row_has_no_built_slide(tmp_path: Path):
    text = plan_text().replace(
        "| Blockholders raise dividends by four points. | Result |",
        "| A planned slide nobody built. | Result | Never built | None | R1 | none | Unwritten |\n"
        "| Blockholders raise dividends by four points. | Result |",
    )
    report = probe(stage(tmp_path, plan=text))
    assert report.status("SPEC") == "FAIL", report["SPEC"]
    assert "1 spec row(s) with no built slide" in report["SPEC"]["detail"]
    assert "A planned slide nobody built." in report["SPEC"]["detail"]
    assert report.code == 1


def test_spec_does_not_degenerate_into_a_row_count(tmp_path: Path):
    # Three spec rows, three built slides, one title different: cardinality matches and
    # correspondence does not. A count comparison would report this deck clean.
    root = stage(tmp_path)
    break_spec_retitled_slide(root)
    report = probe(root)
    assert report.status("SPEC") == "FAIL", report["SPEC"]
    assert "1 spec row(s) with no built slide" in report["SPEC"]["detail"]
    assert "1 built slide(s) with no spec row" in report["SPEC"]["detail"]
    assert "spec_rows=3 built_slides=3" in report["SPEC"]["evidence"]
    # INV goes red on the same mutation, and correctly: the retitled slide matches no Slide Spec
    # row, so its emitted set has no `Inventory` cell to equal and INV fails closed rather than
    # passing an equality nobody evaluated. Asserting SPEC alone here would forbid that.
    assert report.status("INV") == "FAIL", report["INV"]
    assert "match no Slide Spec row by normalized title" in report["INV"]["detail"]
    for other in ARTIFACT_CHECKS:
        if other not in ("SPEC", "INV"):
            assert report.status(other) == "PASS", (other, report[other])
    assert report.code == 1, report.stdout


def test_spec_fails_when_the_built_deck_has_no_title_line_at_all(tmp_path: Path):
    # An empty built set compared against the spec is a pass having compared nothing.
    root = stage(tmp_path)
    break_wid_every_page_skipped(root)
    report = probe(root)
    assert report.status("SPEC") == "FAIL", report["SPEC"]
    assert "no `=== ` slide title line" in report["SPEC"]["detail"]
    assert "built_slides=0" in report["SPEC"]["evidence"]
    assert report.code == 1


SPEC_HEADER = "| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |"
SPEC_SEP = "|---|---|---|---|---|---|---|"


def _spec_case(body: str) -> str:
    return replace_section(plan_text(), "Slide Spec", body)


MALFORMED_SPEC_CASES = {
    "absent heading": (
        plan_text().replace("## Slide Spec", "## Slide Plan"),
        "no `## Slide Spec` heading",
    ),
    "no pipe table": (
        _spec_case("\nThe slides are described in the paragraph above.\n\n"),
        "no pipe table follows",
    ),
    "wrong header names": (
        _spec_case(
            "\n| Slide | Section | Takeaway | Bullets | Inventory | Visual | Speaker |\n"
            f"{SPEC_SEP}\n"
            "| A slide. | Motivation | It argues something | Two bullets | R1 | none | Say it |\n\n"
        ),
        "header row must be exactly",
    ),
    "wrong header order": (
        _spec_case(
            "\n| Slide | Takeaway | Section | Bullets | Inventory | Visual | Notes |\n"
            f"{SPEC_SEP}\n"
            "| A slide. | It argues something | Motivation | Two bullets | R1 | none | Say it |\n\n"
        ),
        "not in the required order",
    ),
    "six-cell row": (
        _spec_case(
            f"\n{SPEC_HEADER}\n{SPEC_SEP}\n"
            "| A slide. | Motivation | It argues something | Two bullets | R1 | none |\n\n"
        ),
        "row has 6 cells, expected 7",
    ),
    "empty cell": (
        _spec_case(
            f"\n{SPEC_HEADER}\n{SPEC_SEP}\n"
            "| A slide. | Motivation | It argues something | Two bullets | R1 |  | Say it |\n\n"
        ),
        "empty Visual cell",
    ),
    "zero body rows": (
        _spec_case(f"\n{SPEC_HEADER}\n{SPEC_SEP}\n\n"),
        "zero body rows",
    ),
}


@pytest.mark.parametrize("clause", sorted(MALFORMED_SPEC_CASES))
def test_spec_fails_on_each_malformed_clause(clause: str, tmp_path: Path):
    text, expected = MALFORMED_SPEC_CASES[clause]
    report = probe(stage(tmp_path, plan=text))
    assert report.status("SPEC") == "FAIL", (clause, report["SPEC"])
    assert "malformed or absent" in report["SPEC"]["detail"], (clause, report["SPEC"])
    assert expected in report["SPEC"]["detail"], (clause, report["SPEC"])
    # A Slide Spec the probe cannot parse leaves WID without its floor, so that must fail too.
    assert report.status("WID") == "FAIL", (clause, report["WID"])
    assert report.code == 1


# ------------------------------------------------------------------------------------------------
# `## Source Paper` (R7c) -- every unparseable clause, reported on SPEC's own line
#
# deck-fidelity locates the paper through this table and nowhere else, so an unparseable section
# leaves the model side judging the deck against nothing while every computed line still reads
# clean. The computed side fails closed here instead.
# ------------------------------------------------------------------------------------------------


PAPER_HEADER = "| Field | Value |"
PAPER_SEP = "|---|---|"


def _paper_case(body: str) -> str:
    return replace_section(plan_text(), "Source Paper", body)


UNPARSEABLE_PAPER_CASES = {
    "absent heading": (
        plan_text().replace("## Source Paper", "## The Paper"),
        "plan has no `## Source Paper` heading",
    ),
    "no pipe table": (
        _paper_case("\n`paper.md` -- the fixture source.\n\n"),
        "no pipe table follows",
    ),
    "wrong header names": (
        _paper_case(f"\n| Key | Value |\n{PAPER_SEP}\n| path | paper.md |\n| title | A Paper |\n\n"),
        "header row must be exactly",
    ),
    "wrong header order": (
        _paper_case(f"\n| Value | Field |\n{PAPER_SEP}\n| paper.md | path |\n| A Paper | title |\n\n"),
        "not in the required order",
    ),
    "three-cell row": (
        _paper_case(f"\n{PAPER_HEADER}\n{PAPER_SEP}\n| path | paper.md | pdf |\n\n"),
        "row has 3 cells, expected 2",
    ),
    "empty cell": (
        _paper_case(f"\n{PAPER_HEADER}\n{PAPER_SEP}\n| path |  |\n| title | A Paper |\n\n"),
        "empty Value cell",
    ),
    "missing mandatory title row": (
        _paper_case(f"\n{PAPER_HEADER}\n{PAPER_SEP}\n| path | paper.md |\n\n"),
        "missing the mandatory row(s) title",
    ),
    "missing mandatory path row": (
        _paper_case(f"\n{PAPER_HEADER}\n{PAPER_SEP}\n| title | A Paper |\n\n"),
        "missing the mandatory row(s) path",
    ),
    "path that does not resolve": (
        _paper_case(
            f"\n{PAPER_HEADER}\n{PAPER_SEP}\n| path | papers/never-written.pdf |\n"
            "| title | A Paper |\n\n"
        ),
        "is not a file",
    ),
    "zero body rows": (
        _paper_case(f"\n{PAPER_HEADER}\n{PAPER_SEP}\n\n"),
        "zero body rows",
    ),
}


@pytest.mark.parametrize("clause", sorted(UNPARSEABLE_PAPER_CASES))
def test_spec_fails_on_each_unparseable_source_paper_clause(clause: str, tmp_path: Path):
    text, expected = UNPARSEABLE_PAPER_CASES[clause]
    report = probe(stage(tmp_path, plan=text))
    assert report.status("SPEC") == "FAIL", (clause, report["SPEC"])
    assert "`## Source Paper` is unparseable" in report["SPEC"]["detail"], (clause, report["SPEC"])
    assert expected in report["SPEC"]["detail"], (clause, report["SPEC"])
    assert report.code == 1


def test_source_paper_path_must_resolve_even_when_every_other_section_is_clean(tmp_path: Path):
    # The deck compiles, the constraints pass and the notes match: nothing but the paper path is
    # wrong, so SPEC's FAIL cannot be borrowed from another check's breakage.
    text, _ = UNPARSEABLE_PAPER_CASES["path that does not resolve"]
    report = probe(stage(tmp_path, plan=text))
    assert_only_failure(report, "SPEC")
    assert "not a file" in report["SPEC"]["detail"], report["SPEC"]


# ------------------------------------------------------------------------------------------------
# NOTE
# ------------------------------------------------------------------------------------------------


def test_note_fails_when_a_built_slide_has_no_notes_section(tmp_path: Path):
    root = stage(tmp_path)
    break_note_missing_section(root)
    report = probe(root)
    assert report.status("NOTE") == "FAIL", report["NOTE"]
    assert "Blockholders raise dividends by four points." in report["NOTE"]["detail"]
    assert_only_failure(report, "NOTE")


def test_note_fails_when_the_notes_source_is_absent(tmp_path: Path):
    root = stage(tmp_path)
    (root / "presentation" / "notes.typ").unlink()
    report = probe(root)
    assert report.status("NOTE") == "FAIL", report["NOTE"]
    assert "absent or is not a file" in report["NOTE"]["detail"]
    assert report.code == 1


def test_note_fails_when_the_notes_source_has_no_heading(tmp_path: Path):
    root = stage(tmp_path)
    (root / "presentation" / "notes.typ").write_text(
        "#set page(margin: 2cm)\n\nJust prose, no headings at all.\n", encoding="utf-8")
    report = probe(root)
    assert report.status("NOTE") == "FAIL", report["NOTE"]
    assert "no `== ` heading" in report["NOTE"]["detail"]
    assert "notes_headings=0" in report["NOTE"]["evidence"]
    assert report.code == 1


# ------------------------------------------------------------------------------------------------
# INV -- R5 emission, R7b grammar, whole-token matching
# ------------------------------------------------------------------------------------------------


def test_inv_fails_on_an_id_the_deck_cites_but_the_inventory_never_declares(tmp_path: Path):
    root = stage(tmp_path)
    break_inv_undeclared_id(root)
    report = probe(root)
    assert report.status("INV") == "FAIL", report["INV"]
    assert "R9" in report["INV"]["detail"]
    assert_only_failure(report, "INV")


def test_inv_fails_when_a_built_slide_carries_no_inv_call(tmp_path: Path):
    root = stage(tmp_path)
    break_inv_no_call(root)
    report = probe(root)
    assert report.status("INV") == "FAIL", report["INV"]
    assert "carry no `#inv(` call" in report["INV"]["detail"]
    assert "The panel spans 1994 through 2019." in report["INV"]["detail"]
    assert report.code == 1


@pytest.mark.parametrize("form", ["line", "block"])
def test_inv_fails_when_a_slides_only_inv_call_is_inside_a_typst_comment(form: str, tmp_path: Path):
    # R5: a commented-out call renders nothing, so the slide declares nothing. Matching raw source
    # let exactly this deck read clean -- a vacuous pass inside the check written to prevent one.
    # Both comment forms are exercised: a `//` line comment and a `/* ... */` block comment.
    root = stage(tmp_path)
    (break_inv_commented_line_call if form == "line" else break_inv_commented_block_call)(root)
    report = probe(root)
    assert report.status("INV") == "FAIL", (form, report["INV"])
    assert "carry no `#inv(` call" in report["INV"]["detail"], (form, report["INV"])
    assert "The panel spans 1994 through 2019." in report["INV"]["detail"], (form, report["INV"])
    # The comment renders nothing, so the deck still compiles and every other check still passes:
    # the FAIL is INV's own, not borrowed from a break elsewhere.
    assert_only_failure(report, "INV")


@pytest.mark.parametrize("form", ["line", "block"])
def test_inv_fails_when_a_commented_call_follows_an_unpaired_quote(form: str, tmp_path: Path):
    # R5's string-literal clause. The deck carries an inch mark before the commented call, so a
    # stripper that tracks string literals is inside a string when it reaches the comment, leaves it
    # standing, and reads the commented `#inv(` as a real emission -- INV then certifies a slide
    # that declares nothing. This is the case the balanced-quote fixture cannot reach.
    root = stage(tmp_path)
    add_unpaired_quote(root)
    (break_inv_commented_line_call if form == "line" else break_inv_commented_block_call)(root)
    report = probe(root)
    assert report.status("INV") == "FAIL", (form, report["INV"])
    assert "carry no `#inv(` call" in report["INV"]["detail"], (form, report["INV"])
    assert "The panel spans 1994 through 2019." in report["INV"]["detail"], (form, report["INV"])
    assert_only_failure(report, "INV")


def test_inv_fails_when_an_inv_call_quotes_no_id(tmp_path: Path):
    root = stage(tmp_path)
    break_inv_empty_call(root)
    report = probe(root)
    assert report.status("INV") == "FAIL", report["INV"]
    assert "no quoted ID argument" in report["INV"]["detail"]
    assert report.code == 1


def test_inv_matches_whole_token_so_f1_does_not_satisfy_a_citation_of_f10(tmp_path: Path):
    # R7b: a substring or prefix match would admit `F10` against a declared `F1` and INV would
    # certify a citation nothing declares.
    text = replace_section(
        plan_text(), "Source Inventory",
        "\n| ID | Kind | Source |\n|---|---|---|\n| F1 | figure | Figure 1, the sole declared item |\n\n",
    )
    root = stage(tmp_path, plan=text)
    break_inv_cites_f10(root)
    report = probe(root)
    assert report.status("INV") == "FAIL", report["INV"]
    assert "F10" in report["INV"]["detail"]
    assert "declared=['F1']" in report["INV"]["evidence"], report["INV"]
    assert report.code == 1


def test_inv_fails_when_every_slide_emits_the_same_declared_id(tmp_path: Path):
    # R5's membership clause: every slide emitting the identical boilerplate `#inv("A4")` keeps the
    # cited set inside `## Source Inventory`, so a membership-only INV reports clean over a deck in
    # which no slide's citations correspond to its content -- the grep-on-prose weakness the
    # emission requirement exists to remove. Only per-slide set equality against that slide's own
    # `Inventory` cell catches it.
    root = stage(tmp_path)
    break_inv_boilerplate_emission(root)
    report = probe(root)
    assert report.status("INV") == "FAIL", report["INV"]
    detail = report["INV"]["detail"]
    assert "3 built slide(s) emit an ID set differing from their own Slide Spec" in detail, detail
    # Both directions, named per slide: row 1 omits R1, row 2 omits T3, row 3 emits an A4 its cell
    # never declares while omitting both of the IDs the cell does declare.
    assert "omits R1 that cell declares" in detail, detail
    assert "omits T3 that cell declares" in detail, detail
    assert "emits A4 its `Inventory` cell does not declare, and omits F2, R1" in detail, detail
    # The membership half is SATISFIED here -- no emitted ID is undeclared. If this assertion ever
    # fires, the FAIL came from the membership test and the test stopped discriminating.
    assert "not declared in `## Source Inventory`" not in detail, detail
    assert "cited=['A4']" in report["INV"]["evidence"], report["INV"]
    assert_only_failure(report, "INV")


INV_HEADER = "| ID | Kind | Source |"
INV_SEP = "|---|---|---|"


def _inv_case(body: str) -> str:
    return replace_section(plan_text(), "Source Inventory", body)


UNPARSEABLE_INVENTORY_CASES = {
    "absent heading": (
        plan_text().replace("## Source Inventory", "## Sources"),
        "no `## Source Inventory` heading",
    ),
    "no pipe table": (
        _inv_case("\nThe inventory is still to be built.\n\n"),
        "no pipe table follows",
    ),
    "wrong header names": (
        _inv_case(f"\n| ID | Type | Source |\n{INV_SEP}\n| F2 | figure | Figure 2 |\n\n"),
        "header row must be exactly",
    ),
    "wrong header order": (
        _inv_case(f"\n| Kind | ID | Source |\n{INV_SEP}\n| figure | F2 | Figure 2 |\n\n"),
        "not in the required order",
    ),
    "two-cell row": (
        _inv_case(f"\n{INV_HEADER}\n{INV_SEP}\n| F2 | figure |\n\n"),
        "row has 2 cells, expected 3",
    ),
    "empty cell": (
        _inv_case(f"\n{INV_HEADER}\n{INV_SEP}\n| F2 | figure |  |\n\n"),
        "empty Source cell",
    ),
    "malformed id": (
        _inv_case(f"\n{INV_HEADER}\n{INV_SEP}\n| fig-2 | figure | Figure 2 |\n\n"),
        "does not match `^[FTRA][0-9]+$`",
    ),
    "duplicate id": (
        _inv_case(
            f"\n{INV_HEADER}\n{INV_SEP}\n| F2 | figure | Figure 2 |\n| F2 | figure | Figure 2 again |\n\n"
        ),
        "more than once",
    ),
    "kind disagrees with the id letter": (
        _inv_case(f"\n{INV_HEADER}\n{INV_SEP}\n| F2 | table | Figure 2 |\n\n"),
        "requires 'figure'",
    ),
    "zero rows": (
        _inv_case(f"\n{INV_HEADER}\n{INV_SEP}\n\n"),
        "zero body rows",
    ),
}


@pytest.mark.parametrize("clause", sorted(UNPARSEABLE_INVENTORY_CASES))
def test_inv_fails_on_each_unparseable_inventory_clause(clause: str, tmp_path: Path):
    text, expected = UNPARSEABLE_INVENTORY_CASES[clause]
    report = probe(stage(tmp_path, plan=text))
    assert report.status("INV") == "FAIL", (clause, report["INV"])
    assert "absent, empty or unparseable" in report["INV"]["detail"], (clause, report["INV"])
    assert expected in report["INV"]["detail"], (clause, report["INV"])
    assert report.code == 1


# ------------------------------------------------------------------------------------------------
# WID -- R9's handout build, R10's inequality, R10's skip floor, R11's fail-closed set
# ------------------------------------------------------------------------------------------------


def test_wid_fires_on_a_twelve_character_single_token_final_line(tmp_path: Path):
    root = stage(tmp_path)
    break_wid_widow(root, "Blockholder.")  # one token, exactly 12 characters
    report = probe(root)
    assert report.status("WID") == "FAIL", report["WID"]
    assert "Blockholder." in report["WID"]["detail"]
    assert_only_failure(report, "WID")


def test_wid_does_not_fire_on_a_thirteen_character_single_token_final_line(tmp_path: Path):
    # The threshold is fixed at 12 characters in the checks file. The control deck differs from the
    # widow deck by one character, so a probe that drifted the threshold fails here.
    assert workshop_deck.WIDOW_MAX_TOKEN_CHARS == 12
    root = stage(tmp_path)
    break_wid_widow(root, "Blockholders.")  # the same line, one character longer
    report = probe(root)
    assert report.status("WID") == "PASS", report["WID"]
    assert report.code == 0


def test_wid_passes_when_a_conforming_deck_has_more_pages_than_spec_rows(tmp_path: Path):
    # R10 is an INEQUALITY: the title slide and the section dividers own no Slide Spec row, so a
    # conforming deck has strictly more handout pages than body rows. An equality test would be
    # permanently red, which is how a check gets waived.
    report = probe(stage(tmp_path))
    assert report.status("WID") == "PASS", report["WID"]
    evidence = report["WID"]["evidence"]
    assert "pages=7 body_rows=3 scanned=3" in evidence, evidence
    assert "section divider" in evidence, evidence
    assert report.code == 0


def overlay_page_count(root: Path, tmp_path: Path) -> int:
    """Compile the deck the way a bare `typst compile` would -- no `--input handout=true`."""
    out = tmp_path / "overlay.pdf"
    proc = subprocess.run(
        ["typst", "compile", "--root", str(root), str(root / "presentation" / "slides.typ"), str(out)],
        capture_output=True, text=True, check=False,
    )
    assert proc.returncode == 0, proc.stderr
    from pypdf import PdfReader
    return len(PdfReader(str(out)).pages)


def test_wid_measures_the_handout_build_not_the_overlay_expanded_one(tmp_path: Path):
    # R9's build identity. The fixture's three content slides carry two `#pause` steps each, and
    # `pause` branches on sys.inputs exactly as the vendored theme does. The handout build
    # collapses the steps -- one page per slide, plus the title and the three dividers -- while the
    # overlay build expands them. Without this the probe could compile the overlay build and still
    # satisfy R10's page floor and scanned floor vacuously, on far more pages than there are
    # slides, scanning pages that belong to no slide at all.
    root = stage(tmp_path)
    add_pause_steps(root)
    report = probe(root)
    assert report.status("WID") == "PASS", report["WID"]
    evidence = report["WID"]["evidence"]
    assert "pages=7 body_rows=3 scanned=3" in evidence, evidence
    assert report.code == 0

    # The two builds genuinely differ, so `pages=7` identifies the handout one rather than merely
    # being a number the overlay build would have produced too.
    overlay = overlay_page_count(root, tmp_path)
    assert overlay == 13, overlay
    assert overlay > 7


def test_wid_fails_when_the_handout_page_count_is_below_the_body_row_count(tmp_path: Path):
    root = stage(tmp_path)
    break_wid_page_count_below_floor(root)
    report = probe(root)
    assert report.status("WID") == "FAIL", report["WID"]
    assert "1 page(s) but the Slide Spec has 3 body row(s)" in report["WID"]["detail"]
    assert report.code == 1


def test_wid_fails_when_every_page_was_skipped(tmp_path: Path):
    # R10's skip floor: four pages, every one of them skippable. Without the floor a
    # skip-everything bug scans nothing and reports clean.
    root = stage(tmp_path)
    break_wid_every_page_skipped(root)
    report = probe(root)
    assert report.status("WID") == "FAIL", report["WID"]
    assert "only 0 handout page(s) were actually scanned" in report["WID"]["detail"]
    assert "scanned=0" in report["WID"]["evidence"]
    assert report.code == 1


def test_wid_fails_on_a_page_with_no_extractable_text(tmp_path: Path):
    # Outlined fonts and image-only slides produce zero text, hence zero widows: clean because
    # nothing was measured. A no-text page is a FAIL, not a skip.
    root = stage(tmp_path)
    break_wid_no_extractable_text(root)
    report = probe(root)
    assert report.status("WID") == "FAIL", report["WID"]
    assert "no extractable text" in report["WID"]["detail"]
    assert report.code == 1


def test_wid_fails_closed_when_pypdf_is_unimportable(tmp_path: Path):
    shadow = tmp_path / "shadow"
    (shadow / "pypdf").mkdir(parents=True)
    (shadow / "pypdf" / "__init__.py").write_text(
        "raise ImportError('pypdf is unavailable in this environment')\n", encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(shadow) + os.pathsep + env.get("PYTHONPATH", "")
    report = probe(stage(tmp_path), env=env)
    assert report.status("WID") == "FAIL", report["WID"]
    assert "`pypdf` is unimportable" in report["WID"]["detail"]
    assert report.code == 1


def test_wid_fails_closed_when_the_handout_pdf_cannot_be_read(tmp_path: Path):
    # R11's fourth fail-closed condition: the PDF unreadable. The compile reports success and
    # leaves a non-empty file, so a probe that only guarded the compile would go on to read zero
    # pages and report zero widows -- clean because nothing was parsed.
    report = probe(stage(tmp_path), env=env_with_nonpdf_typst(tmp_path))
    assert report.status("WID") == "FAIL", report["WID"]
    assert "handout PDF could not be read" in report["WID"]["detail"], report["WID"]
    assert report.code == 1


def test_wid_fails_closed_when_the_vendored_validation_typ_is_absent(tmp_path: Path):
    # WID measures the HANDOUT build, through the wrapper the overflow driver uses. Without
    # validation.typ there is no wrapper, so there is no measurement.
    skill = scratch_skill(tmp_path)
    (skill / "scripts" / "validation.typ").unlink()
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("WID") == "FAIL", report["WID"]
    assert "validation.typ` is absent" in report["WID"]["detail"]
    assert report.code == 1


# ------------------------------------------------------------------------------------------------
# OVR -- the driver's exit code read strictly, plus its measured-nothing tells
# ------------------------------------------------------------------------------------------------


def test_ovr_fails_when_the_driver_reports_overflow(tmp_path: Path):
    root = stage(tmp_path)
    break_ovr_frame_overflow(root)
    report = probe(root)
    assert report.status("OVR") == "FAIL", report["OVR"]
    assert "reports frame overflow" in report["OVR"]["detail"]
    assert "exit=1" in report["OVR"]["evidence"]
    assert report.code == 1


def test_ovr_fails_closed_when_the_driver_exits_two(tmp_path: Path):
    # THE upstream defect reproduced exactly: check-overflow.sh exits 2 when its vendored
    # validation.typ is missing, and typst-overflow.py called that clean.
    skill = scratch_skill(tmp_path)
    (skill / "scripts" / "validation.typ").unlink()
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("OVR") == "FAIL", report["OVR"]
    assert "validation.typ` is absent" in report["OVR"]["detail"]
    assert report.code == 1


def test_ovr_fails_closed_on_an_unrecognised_driver_exit_code(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    stub_overflow_driver(skill, "Error: Failed to compile overflow check wrapper", exit_code=2)
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("OVR") == "FAIL", report["OVR"]
    assert "exited 2" in report["OVR"]["detail"]
    assert "neither 0 (clean) nor 1" in report["OVR"]["detail"]
    assert report.code == 1


def test_ovr_fails_closed_when_typst_is_unavailable(tmp_path: Path):
    report = probe(stage(tmp_path), env=env_without_typst(tmp_path))
    assert report.status("OVR") == "FAIL", report["OVR"]
    assert report["OVR"]["evidence"].startswith("exit=2"), report["OVR"]
    assert report.code == 1


def test_ovr_fails_closed_when_the_vendored_driver_is_absent(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    (skill / "scripts" / "checks" / "check-overflow.sh").unlink()
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("OVR") == "FAIL", report["OVR"]
    assert "overflow driver is absent" in report["OVR"]["detail"]
    assert report.code == 1


def test_ovr_fails_when_the_driver_exits_zero_reporting_zero_physical_pages(tmp_path: Path):
    # Verified upstream: `echo '[]' | python3 overflow.py` prints `Physical pages: 0` and exits 0.
    # A clean verdict over zero pages is a pass having measured nothing.
    skill = scratch_skill(tmp_path)
    stub_overflow_driver(skill, "Physical pages: 0\n✓ No overflow detected (handout mode)")
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("OVR") == "FAIL", report["OVR"]
    assert "Physical pages: 0" in report["OVR"]["detail"]
    assert report.code == 1


def test_ovr_fails_when_the_driver_exits_zero_with_no_validation_metadata(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    stub_overflow_driver(skill, "Warning: No validation metadata found")
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("OVR") == "FAIL", report["OVR"]
    assert "No validation metadata found" in report["OVR"]["detail"]
    assert report.code == 1


def test_ovr_fails_when_the_driver_exits_zero_reporting_no_page_count_at_all(tmp_path: Path):
    skill = scratch_skill(tmp_path)
    stub_overflow_driver(skill, "✓ No overflow detected (handout mode)")
    report = probe(stage(tmp_path), runner=skill / "scripts" / "workshop-deck.py")
    assert report.status("OVR") == "FAIL", report["OVR"]
    assert "reported no physical page count" in report["OVR"]["detail"]
    assert report.code == 1


# ------------------------------------------------------------------------------------------------
# `## Outputs and Verification` (R8) -- every clause, plus opening an undeclared artifact
# ------------------------------------------------------------------------------------------------


OUT_HEADER = "| Artifact | Path |"
OUT_SEP = "|---|---|"
OUT_ROWS = (
    "| deck | presentation/slides.typ |\n"
    "| notes | presentation/notes.typ |\n"
    "| deck-pdf | presentation/slides.pdf |\n"
    "| notes-pdf | presentation/notes.pdf |\n"
)


def _out_case(body: str) -> str:
    return replace_section(plan_text(), "Outputs and Verification", body)


UNPARSEABLE_OUTPUT_CASES = {
    "absent heading": (
        plan_text().replace("## Outputs and Verification", "## Deliverables"),
        "no `## Outputs and Verification` heading",
    ),
    "no pipe table": (
        _out_case("\nThe deck and the notes, rendered, in the presentation directory.\n\n"),
        "no pipe table follows",
    ),
    "wrong header names": (
        _out_case(f"\n| Output | Path |\n{OUT_SEP}\n{OUT_ROWS}\n"),
        "header row must be exactly",
    ),
    "wrong header order": (
        _out_case(f"\n| Path | Artifact |\n{OUT_SEP}\n| presentation/slides.typ | deck |\n\n"),
        "not in the required order",
    ),
    "three-cell row": (
        _out_case(f"\n{OUT_HEADER}\n{OUT_SEP}\n| deck | presentation/slides.typ | CMP |\n\n"),
        "row has 3 cells, expected 2",
    ),
    "empty cell": (
        _out_case(f"\n{OUT_HEADER}\n{OUT_SEP}\n| deck |  |\n\n"),
        "empty Path cell",
    ),
    "artifact outside the fixed set": (
        _out_case(f"\n{OUT_HEADER}\n{OUT_SEP}\n{OUT_ROWS}| handout | presentation/handout.pdf |\n\n"),
        "which is outside the fixed set",
    ),
    "duplicate artifact": (
        _out_case(f"\n{OUT_HEADER}\n{OUT_SEP}\n{OUT_ROWS}| deck | presentation/other.typ |\n\n"),
        "more than once",
    ),
    "fewer than the four required rows": (
        _out_case(
            f"\n{OUT_HEADER}\n{OUT_SEP}\n"
            "| deck | presentation/slides.typ |\n| notes | presentation/notes.typ |\n\n"
        ),
        "missing the mandatory row(s) deck-pdf, notes-pdf",
    ),
    "zero body rows": (
        _out_case(f"\n{OUT_HEADER}\n{OUT_SEP}\n\n"),
        "zero body rows",
    ),
}


@pytest.mark.parametrize("clause", sorted(UNPARSEABLE_OUTPUT_CASES))
def test_every_artifact_check_fails_on_each_unparseable_outputs_clause(clause: str, tmp_path: Path):
    text, expected = UNPARSEABLE_OUTPUT_CASES[clause]
    report = probe(stage(tmp_path, plan=text))
    for check in ARTIFACT_CHECKS:
        assert report.status(check) == "FAIL", (clause, check, report[check])
        assert "unparseable" in report[check]["detail"], (clause, check, report[check])
    assert expected in report["CMP"]["detail"], (clause, report["CMP"])
    # A line was still emitted for every ID, which is all ENUM asserts.
    assert report.status("ENUM") == "PASS", report["ENUM"]
    assert report.code == 1


def test_opening_an_artifact_no_row_declares_is_a_fail(tmp_path: Path):
    root = stage(tmp_path)
    (root / "presentation" / "other.typ").write_text('=== A slide.\n#inv("R1")\n', encoding="utf-8")
    report = probe(root, args=("--slides", "presentation/other.typ"))
    for check in ARTIFACT_CHECKS:
        assert report.status(check) == "FAIL", (check, report[check])
    assert "never declared" in report["CMP"]["detail"]
    assert report.code == 1


def test_an_unreadable_plan_still_emits_every_line_and_exits_non_zero(tmp_path: Path):
    proc = subprocess.run(
        [sys.executable, str(RUNNER), "--plan", str(tmp_path / "absent.md")],
        capture_output=True, text=True, check=False,
    )
    report = Report(proc.returncode, proc.stdout, proc.stderr)
    assert report.order == MATRIX, proc.stdout
    for check in ARTIFACT_CHECKS:
        assert report.status(check) == "FAIL", (check, report[check])
        assert "could not read the approved plan" in report[check]["detail"]
    assert proc.returncode == 1, proc.stdout + proc.stderr


def test_the_json_report_mirrors_the_emitted_lines(tmp_path: Path):
    root = stage(tmp_path)
    out = tmp_path / "report.json"
    report = probe(root, args=("--json", str(out)))
    payload = json.loads(out.read_text(encoding="utf-8"))
    for check in MATRIX:
        assert payload[check]["status"] == report.status(check), check
    assert payload["_declared"]["slide_spec_rows"] == 3, payload["_declared"]


# ------------------------------------------------------------------------------------------------
# ENUM's own non-vacuity
#
# The full pipeline assigns every MATRIX key before calling check_enum, so `missing` is empty BY
# CONSTRUCTION on that path and an end-to-end assertion could not have exercised the FAIL branch.
# These call check_enum on inputs the pipeline cannot produce.
# ------------------------------------------------------------------------------------------------


def _enum_input(**overrides: str) -> dict:
    checks = {c: {"status": "PASS"} for c in MATRIX if c != "ENUM"}
    for model in MODEL_EVALUATED_CHECKS:
        checks[model] = {"status": "MODEL-EVALUATED"}
    for check, status in overrides.items():
        checks[check] = {"status": status}
    return checks


def test_enum_fails_and_names_every_missing_check():
    partial = _enum_input()
    del partial["WID"], partial["OVR"]
    verdict = workshop_deck.check_enum(partial)
    assert verdict["status"] == "FAIL", verdict
    assert "WID" in verdict["detail"] and "OVR" in verdict["detail"], verdict["detail"]
    assert verdict["reason_source"] == "runner"


def test_enum_fails_when_nothing_ran_at_all():
    # An enumeration over an empty line set enumerates nothing, so this is its own FAIL branch
    # rather than the "these IDs are missing" one.
    verdict = workshop_deck.check_enum({})
    assert verdict["status"] == "FAIL", verdict
    assert "enumeration over nothing" in verdict["detail"], verdict
    assert verdict["reason_source"] == "runner"


def test_enum_fails_when_only_one_check_ever_reported():
    verdict = workshop_deck.check_enum({"CMP": {"status": "PASS"}})
    assert verdict["status"] == "FAIL", verdict
    for check in MATRIX:
        if check not in ("ENUM", "CMP"):
            assert check in verdict["detail"], f"{check} not named among the missing"


@pytest.mark.parametrize("check", MODEL_EVALUATED_CHECKS)
def test_enum_fails_when_a_model_id_is_routed_through_a_pass(check: str):
    verdict = workshop_deck.check_enum(_enum_input(**{check: "PASS"}))
    assert verdict["status"] == "FAIL", verdict
    assert f"{check}=PASS" in verdict["detail"], verdict["detail"]
    assert "judgement" in verdict["detail"]


@pytest.mark.parametrize("check", MODEL_EVALUATED_CHECKS)
def test_enum_fails_when_a_model_id_carries_any_other_computed_status(check: str):
    verdict = workshop_deck.check_enum(_enum_input(**{check: "N/A"}))
    assert verdict["status"] == "FAIL", verdict
    assert f"{check}=N/A" in verdict["detail"], verdict["detail"]


def test_enum_passes_only_when_every_line_is_present_and_correctly_labelled():
    verdict = workshop_deck.check_enum(_enum_input())
    assert verdict["status"] == "PASS", verdict
    assert verdict["reason_source"] == "runner"
