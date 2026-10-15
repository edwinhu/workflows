"""Contract tests for get_cell_map.py and check_notebook.sh (marimo itself is not required)."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).parent
CELL_MAP = HERE / "get_cell_map.py"
CHECK = HERE / "check_notebook.sh"

NOTEBOOK = '''import marimo
app = marimo.App()


@app.cell
def load(pd):
    df = pd.DataFrame()
    n = 3
    return df, n


@app.cell
def show(df, n):
    print(df)
    return


@app.cell
def single():
    z = 1
    return z


def plain(a):
    return a
'''


def nb(tmp_path, text=NOTEBOOK, name="nb.py"):
    f = tmp_path / name
    f.write_text(text)
    return str(f)


def cell_map(*args):
    return subprocess.run([sys.executable, str(CELL_MAP), *args], capture_output=True, text=True)


def test_json_output_maps_cells_inputs_outputs_and_lines(tmp_path):
    p = cell_map(nb(tmp_path), "--json")
    assert p.returncode == 0
    assert json.loads(p.stdout) == {
        "load": {"lineno": 6, "inputs": ["pd"], "outputs": ["df", "n"]},
        "show": {"lineno": 13, "inputs": ["df", "n"], "outputs": []},
        "single": {"lineno": 19, "inputs": [], "outputs": ["z"]},
    }


def test_text_output_lists_cells_by_line(tmp_path):
    p = cell_map(nb(tmp_path))
    assert p.returncode == 0
    assert p.stdout.startswith("Found 3 cells:\n")
    assert "  load (line 6)\n    inputs:  pd\n    outputs: df, n\n" in p.stdout
    assert "  show (line 13)\n    inputs:  df, n\n    outputs: (none)\n" in p.stdout
    assert p.stdout.index("load (line") < p.stdout.index("show (line") < p.stdout.index("single (line")


def test_same_named_cells_collapse_to_the_last_one(tmp_path):
    text = "app = None\n\n@app.cell\ndef _(a):\n    return a\n\n@app.cell\ndef _(b):\n    return b\n"
    out = json.loads(cell_map(nb(tmp_path, text), "--json").stdout)
    assert out == {"_": {"lineno": 8, "inputs": ["b"], "outputs": ["b"]}}


def test_no_args_is_usage_exit_1():
    p = cell_map()
    assert p.returncode == 1
    assert p.stdout == "Usage: python get_cell_map.py <notebook.py> [--json]\n"


def test_missing_file_exit_1(tmp_path):
    p = cell_map(str(tmp_path / "nope.py"))
    assert p.returncode == 1
    assert p.stdout == f"Error: File not found: {tmp_path / 'nope.py'}\n"


def test_syntax_error_exit_1(tmp_path):
    p = cell_map(nb(tmp_path, "def (\n", "bad.py"))
    assert p.returncode == 1
    assert p.stdout.startswith("Syntax error in notebook:")


needs_uv = pytest.mark.skipif(shutil.which("uv") is None, reason="check_notebook.sh runs python via uv")


def check(*args):
    return subprocess.run(["bash", str(CHECK), *args], capture_output=True, text=True)


def test_check_no_args_usage_exit_1():
    p = check()
    assert p.returncode == 1
    assert p.stdout == "Usage: check_notebook.sh <notebook.py> [notebook2.py ...]\n"


def test_check_missing_file_warns_exit_1(tmp_path):
    p = check(str(tmp_path / "nope.py"))
    assert p.returncode == 1
    assert p.stdout == f"Warning: File not found: {tmp_path / 'nope.py'}\n"


@needs_uv
def test_check_valid_notebook_runs_all_steps(tmp_path):
    f = nb(tmp_path)
    p = check(f)
    assert p.returncode == 0
    assert f"=== Checking: {f} ===" in p.stdout
    assert "1. Syntax check...\n   OK" in p.stdout
    assert "2. Marimo check..." in p.stdout
    assert "3. Cell structure...\nFound 3 cells:" in p.stdout


@needs_uv
def test_check_syntax_error_fails_before_later_steps(tmp_path):
    f = nb(tmp_path, "def (\n", "bad.py")
    p = check(f)
    assert p.returncode == 1
    assert "   FAILED" in p.stdout
    assert "2. Marimo check" not in p.stdout


@needs_uv
def test_check_continues_after_a_failing_notebook_and_exits_1(tmp_path):
    bad = nb(tmp_path, "def (\n", "bad.py")
    good = nb(tmp_path, NOTEBOOK, "good.py")
    p = check(bad, good)
    assert p.returncode == 1
    assert f"=== Checking: {good} ===" in p.stdout
