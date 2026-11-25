"""Contract tests for wrap_commands.py."""
import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).with_name("wrap_commands.py")
_spec = importlib.util.spec_from_file_location("wrap_commands", SCRIPT)
wc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wc)

LONG = (
    "python3 code/build_summary.py --input data/processed_input.csv"
    " --output out/summary_report.csv --panel-start 2028-01-01"
    " --panel-end 2029-12-31 --precision 4"
)


def joined(lines):
    return " ".join(" ".join(ln[:-2] if ln.endswith(" \\") else ln for ln in lines).split())


def fence(*body, info="command"):
    return "\n".join([f"```{info}", *body, "```"]) + "\n"


def block_lines(md):
    lines = md.splitlines()
    start = lines.index("```command")
    return lines[start + 1 : lines.index("```", start + 1)]


@pytest.mark.parametrize("width", [40, 60, 80])
def test_lines_fit_and_join_back(width):
    lines = wc.wrap_command(LONG, width)
    assert len(lines) > 1
    assert all(len(ln) <= width for ln in lines)
    assert all(ln.endswith(" \\") for ln in lines[:-1])
    assert not lines[-1].endswith("\\")
    assert joined(lines) == LONG


def test_breaks_only_before_flags():
    for ln in wc.wrap_command(LONG, 40)[1:]:
        assert ln.startswith("  --")


def test_flag_value_never_separated_from_its_flag():
    lines = wc.wrap_command(LONG, 40)
    assert any("--panel-start 2028-01-01" in ln for ln in lines)
    assert any("--precision 4" in ln for ln in lines)


def test_fills_greedily():
    lines = wc.wrap_command(LONG, 80)
    assert lines[0] == "python3 code/build_summary.py --input data/processed_input.csv \\"
    assert len(lines) == 3


def test_short_flag_is_a_break_point():
    cmd = "tool --alpha aaaaaaaaaaaaaaaa -n 5 --beta bbbbbbbbbbbbbbbbbbbb"
    assert wc.wrap_command(cmd, 40) == [
        "tool --alpha aaaaaaaaaaaaaaaa -n 5 \\",
        "  --beta bbbbbbbbbbbbbbbbbbbb",
    ]


def test_continuation_marker_counts_toward_width():
    cmd = "tool --a " + "x" * 30 + " --b 1"
    assert wc.wrap_command(cmd, 40) == ["tool \\", "  --a " + "x" * 30 + " \\", "  --b 1"]


def test_quoted_flag_lookalike_is_one_token():
    cmd = 'tool --title "a title with --not-a-flag inside" --out out/file.csv --mode fast'
    assert wc.wrap_command(cmd, 46) == [
        "tool \\",
        '  --title "a title with --not-a-flag inside" \\',
        "  --out out/file.csv --mode fast",
    ]


def test_comment_is_one_token():
    assert wc.segments("tool --a 1 # see --b") == ["tool", "--a 1 # see --b"]


def test_negative_number_and_bare_dash_are_not_flags():
    assert wc.segments("tool --x -1 - --y 2") == ["tool", "--x -1 -", "--y 2"]


def test_unbreakable_run_raises():
    with pytest.raises(wc.WrapError):
        wc.wrap_command("tool " + "x" * 90 + " --flag 1", 80)


def test_markdown_wraps_only_command_fences():
    md = "# Runbook\n\n" + fence(LONG) + "\n" + fence(LONG, info="text")
    out = wc.wrap_markdown(md, 80)
    assert all(len(ln) <= 80 for ln in block_lines(out))
    assert out.endswith(fence(LONG, info="text"))


def test_fitting_command_is_left_as_written():
    md = fence("python3 a.py \\", "    --x 1", "python3 b.py --y 2")
    assert wc.wrap_markdown(md, 80) == md


def test_existing_continuations_are_joined_before_rewrapping():
    half = LONG.index(" --panel-start")
    md = fence(LONG[:half] + " \\", "      " + LONG[half + 1 :])
    lines = block_lines(wc.wrap_markdown(md, 60))
    assert all(len(ln) <= 60 for ln in lines)
    assert joined(lines) == LONG


def test_longer_outer_fence_shields_inner_command_fence():
    md = "````markdown\n" + fence(LONG) + "````\n"
    assert wc.wrap_markdown(md, 80) == md


def test_indented_fence_in_list_item():
    md = "1. Step:\n\n    ```command\n    " + LONG + "\n    ```\n"
    lines = wc.wrap_markdown(md, 80).splitlines()[3:-1]
    assert len(lines) > 1
    assert all(ln.startswith("    ") and len(ln) - 4 <= 80 for ln in lines)
    assert joined([ln.strip() for ln in lines[:-1]] + [lines[-1].strip()]) == LONG


def test_cli_exit_codes(tmp_path):
    src = tmp_path / "RUNBOOK.md"
    src.write_text(fence(LONG), encoding="utf-8")

    def run(*args):
        return subprocess.run([sys.executable, "-I", str(SCRIPT), *args],
                              capture_output=True, text=True)

    ok = run("--width", "60", str(src))
    assert ok.returncode == 0
    assert all(len(ln) <= 60 for ln in ok.stdout.splitlines())
    assert run(str(tmp_path / "absent.md")).returncode == 2
    assert run("--width", "5", str(src)).returncode == 2
    src.write_text(fence("tool " + "x" * 90), encoding="utf-8")
    bad = run(str(src))
    assert bad.returncode == 1
    assert "cannot wrap" in bad.stderr
