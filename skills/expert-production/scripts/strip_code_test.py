"""Contract tests for strip_code.py: what it removes, what it must keep, and that the result runs."""
import ast
import importlib.util
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent / "strip_code.py"
_spec = importlib.util.spec_from_file_location("strip_code_under_test", SCRIPT)
sc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sc)


def run(*args):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), *args], capture_output=True, text=True)


def clean(out: str) -> None:
    tree = ast.parse(out)
    assert sc.comment_tokens(out) == []
    assert sc.docstring_nodes(tree) == []


def test_comments_go_and_line_one_shebang_stays():
    src = (
        "#!/usr/bin/env python3\n"
        "# a whole-line comment\n"
        "x = 1  # trailing\n"
        'y = "# not a comment"\n'
        "z = [\n"
        "    1,  # inside brackets\n"
        "    # alone inside brackets\n"
        "    2,\n"
        "]\n"
    )
    out = sc.strip_source(src)
    clean(out)
    assert out.splitlines()[0] == "#!/usr/bin/env python3"
    assert 'y = "# not a comment"' in out
    assert "x = 1\n" in out
    ns: dict = {}
    exec(out, ns)
    assert (ns["x"], ns["y"], ns["z"]) == (1, "# not a comment", [1, 2])


def test_shebang_not_on_line_one_is_a_comment():
    out = sc.strip_source("x = 1\n#!/usr/bin/env python3\n")
    assert "#!" not in out


def test_docstrings_go_from_module_class_and_functions():
    src = (
        '"""Module doc."""\n'
        "import math\n\n\n"
        "class K:\n"
        '    """Class doc."""\n\n'
        "    def only(self):\n"
        '        """Only a docstring."""\n\n'
        "    async def coro(self):\n"
        '        """Async doc."""\n'
        "        return 2\n\n\n"
        "def f():\n"
        '    """Doc then code."""; return math.pi\n'
    )
    out = sc.strip_source(src)
    clean(out)
    assert "doc" not in out.lower()
    ns: dict = {}
    exec(out, ns)
    assert ns["K"]().only() is None
    assert ns["f"]() == pytest.approx(3.14159, rel=1e-4)


def test_multiline_string_kept_byte_for_byte():
    body = 'TEXT = """first\n    # hash inside\n\n\n\n    last"""\n'
    out = sc.strip_source('"""Doc."""\n' + body)
    assert body in out
    ns: dict = {}
    exec(out, ns)
    assert ns["TEXT"] == "first\n    # hash inside\n\n\n\n    last"


def test_module_reading_doc_keeps_it_as_an_assignment(tmp_path):
    src = tmp_path / "tool.py"
    src.write_text(
        '"""Usage: tool.py --input FILE\n\nWrites a summary.\n"""\n'
        "import sys\n\n\n"
        "def main():\n"
        "    # print usage\n"
        "    sys.stdout.write(__doc__)\n\n\n"
        'if __name__ == "__main__":\n'
        "    main()\n",
        encoding="utf-8",
    )
    dest = tmp_path / "out" / "tool.py"
    assert run(str(src), str(dest)).returncode == 0
    out = dest.read_text(encoding="utf-8")
    clean(out)
    tree = ast.parse(out)
    assert sc.reads_module_doc(tree) and sc.assigns_module_doc(tree)
    before = subprocess.run([sys.executable, str(src)], capture_output=True, text=True).stdout
    after = subprocess.run([sys.executable, str(dest)], capture_output=True, text=True).stdout
    assert after == before == "Usage: tool.py --input FILE\n\nWrites a summary.\n"


def test_doc_assignment_goes_after_future_imports():
    src = '"""Doc text."""\nfrom __future__ import annotations\n\nprint(__doc__)\n'
    out = sc.strip_source(src)
    tree = ast.parse(out)
    assert isinstance(tree.body[0], ast.ImportFrom) and tree.body[0].module == "__future__"
    assert isinstance(tree.body[1], ast.Assign) and tree.body[1].targets[0].id == "__doc__"
    assert compile(out, "x.py", "exec")


def test_doc_reader_without_docstring_gets_none_before_decorators():
    src = "import functools\n\n\n@functools.cache\ndef f():\n    return __doc__\n"
    out = sc.strip_source(src)
    tree = ast.parse(out)
    assert sc.assigns_module_doc(tree)
    ns: dict = {}
    exec(out, ns)
    assert ns["f"]() is None


def test_bad_input_is_refused_and_nothing_written(tmp_path):
    src = tmp_path / "bad.py"
    src.write_text("def broken(:\n", encoding="utf-8")
    dest = tmp_path / "dest.py"
    p = run(str(src), str(dest))
    assert p.returncode == 1
    assert "bad.py" in p.stderr
    assert not dest.exists()


def test_cli_copies_mode_and_in_place_rewrites(tmp_path):
    src = tmp_path / "run.py"
    src.write_text("#!/usr/bin/env python3\n# c\nprint(1)\n", encoding="utf-8")
    src.chmod(0o755)
    dest = tmp_path / "staged" / "run.py"
    assert run(str(src), str(dest)).returncode == 0
    assert dest.read_text() == "#!/usr/bin/env python3\nprint(1)\n"
    assert stat.S_IMODE(os.stat(dest).st_mode) == 0o755
    other = tmp_path / "other.py"
    other.write_text('"""D."""\nx = 1  # c\n', encoding="utf-8")
    assert run("--in-place", str(other)).returncode == 0
    assert other.read_text() == "x = 1\n"


def test_usage_errors_exit_two():
    assert run().returncode == 2
    assert run("--in-place").returncode == 2
    assert run("only-one-arg.py").returncode == 2


def test_encoding_cookie_source_is_written_as_utf8(tmp_path):
    src = tmp_path / "latin.py"
    src.write_bytes(b"# -*- coding: latin-1 -*-\nNAME = '\xe9t\xe9'\n")
    dest = tmp_path / "out.py"
    assert run(str(src), str(dest)).returncode == 0
    out = dest.read_text(encoding="utf-8")
    clean(out)
    ns: dict = {}
    exec(out, ns)
    assert ns["NAME"] == "\u00e9t\u00e9"


def test_stripped_script_behaves_like_its_source(tmp_path):
    src = tmp_path / "calc.py"
    src.write_text(
        '"""Doubles each argument."""\n'
        "import sys\n\n\n"
        "def double(v):\n"
        '    """Return twice v."""\n'
        "    return v * 2  # simple\n\n\n"
        "print(','.join(str(double(int(a))) for a in sys.argv[1:]))\n",
        encoding="utf-8",
    )
    dest = tmp_path / "calc_stripped.py"
    assert run(str(src), str(dest)).returncode == 0
    clean(dest.read_text(encoding="utf-8"))
    want = subprocess.run([sys.executable, str(src), "1", "5"], capture_output=True, text=True).stdout
    got = subprocess.run([sys.executable, str(dest), "1", "5"], capture_output=True, text=True).stdout
    assert got == want == "2,10\n"
