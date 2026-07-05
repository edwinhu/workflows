#!/usr/bin/env -S uv run python3
"""overflow-check.py trigger/target-extraction regression tests. Run: uv run python3 tests/overflow_check_test.py"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HOOK_PATH = Path(__file__).resolve().parents[1] / "hooks" / "overflow-check.py"
spec = importlib.util.spec_from_file_location("overflow_check", HOOK_PATH)
overflow_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overflow_check)  # noqa: E402

P, F = 0, 0


def check(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print(f"  ok  {name}")
    else:
        F += 1; print(f"  FAIL {name} {extra}")


resolve = overflow_check.resolve_typ_target

# (a) both compilers trigger; (b) flags before the target don't break extraction.
check("bare typst compile", resolve("typst compile slides.typ") == "slides.typ")
check("typst compile with --input first", resolve("typst compile --input handout=true slides.typ") == "slides.typ")
check("tinymist compile", resolve("tinymist compile slides.typ") == "slides.typ")
check("tinymist compile nested path", resolve("tinymist compile presentation/slides.typ") == "presentation/slides.typ")
check("typst compile --root form", resolve("typst compile --root . slides/lecture1.typ") == "slides/lecture1.typ")
check("cd prefix + typst compile", resolve("cd foo && typst compile slides.typ") == "slides.typ")
check("non-compile command: no trigger", resolve("typst watch slides.typ") is None)
check("unrelated command: no trigger", resolve("ls -la") is None)

# fail-open on malformed / non-Bash / non-triggering stdin.
def run_hook(stdin_text):
    return subprocess.run([sys.executable, str(HOOK_PATH)], input=stdin_text, capture_output=True, text=True, timeout=10)

check("malformed JSON -> exit 0", run_hook("not json").returncode == 0)
check("empty object -> exit 0", run_hook("{}").returncode == 0)
check("non-Bash tool -> exit 0", run_hook(json.dumps({"tool_name": "Read", "tool_input": {}})).returncode == 0)
check(
    "tinymist compile via Bash tool -> exit 0 (no crash even if plugin root / check script unresolved)",
    run_hook(json.dumps({"tool_name": "Bash", "tool_input": {"command": "tinymist compile slides.typ"}})).returncode == 0,
)

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
