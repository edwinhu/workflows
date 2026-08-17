#!/usr/bin/env -S uv run --with lxml python3
"""Run the vendored `typst-*` constraint modules over one presentation directory.

CONTRACT
    run-constraints.py <dir>
    stdout: JSON {"passed": [...], "failed": [...], "errors": [...], "skipped": [...]}
    exit 0  ONLY when `failed`, `errors` and `skipped` are all empty AND the summed `inspected`
            is greater than zero.
    exit 1  every other outcome -- a violation, an unimportable or uncallable module, a run that
            inspected nothing, or a run that could not happen at all (no argument, not a
            directory, no modules beside this file). The last group still prints the four keys,
            with an `error` string beside them, so the reader never has to parse a status code.

    It is shipped as a standalone `mechanicalCheck`, and craft gates on exit codes: a runner that
    prints a non-empty `failed` and exits 0 is a check that cannot fail. `scripts/workshop-deck.py`
    settles CON from the JSON, not the status -- a violation exit and an infrastructure failure are
    both exit 1 and are told apart by which key is populated, so exit 1 must never be read as a
    crash.

WHY `inspected`
    Every vendored module locates its own inputs by globbing `cwd` and `cwd/presentation` and
    returns `[]` when it finds nothing (typst-slide-format.py:12-19). A report of violations alone
    therefore reads identically whether a module examined a deck and found it clean or never opened
    a file. Each entry carries the number of DISTINCT EXISTING FILES that module actually read,
    measured by instrumenting `open`/`Path.open`/`Path.read_text`/`Path.read_bytes` for the duration
    of its `check()` call -- observed, not inferred from a re-implementation of its globbing.

WHY NOT check-all.py
    Upstream auto-discovers the whole plugin constraint tree plus `skills/*/references/*.py`, and
    scopes by reading `.planning/ACTIVE_WORKFLOW.md`. craft writes no such file, so upstream's
    `_detect_workflow` returns None, `_applies` then returns True for everything, and writing's
    prose lints fire on a Typst deck. This runner discovers ONLY the `typst-*.py` files co-located
    beside it and applies no workflow detection.
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True  # keep the vendored corpus free of __pycache__

import builtins  # noqa: E402
import importlib.util  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
from pathlib import Path  # noqa: E402

HERE = Path(__file__).resolve().parent


def discover() -> list[Path]:
    """Only the typst-*.py modules sitting beside this file. No tree walk, no skill scan."""
    return sorted(p for p in HERE.glob("typst-*.py") if p.name != Path(__file__).name)


def import_module(py_path: Path):
    spec = importlib.util.spec_from_file_location(py_path.stem.replace("-", "_"), py_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def severity(mod) -> str:
    value = str(getattr(mod, "SEVERITY", "soft") or "soft").strip().lower()
    return "hard" if value == "hard" else "soft"


class ReadCounter:
    """Count distinct existing files opened for reading inside the `with` block."""

    def __init__(self) -> None:
        self.paths: set[str] = set()

    def _record(self, target) -> None:
        try:
            if isinstance(target, int):  # already-open fd
                return
            p = Path(os.fspath(target))
            if p.is_file():
                self.paths.add(str(p.resolve()))
        except Exception:
            pass

    def __enter__(self) -> "ReadCounter":
        counter = self
        self._open = builtins.open
        self._io_open = io.open
        self._p_open = Path.open
        self._p_text = Path.read_text
        self._p_bytes = Path.read_bytes

        def open_(file, *a, **kw):
            counter._record(file)
            return counter._open(file, *a, **kw)

        def p_open(self_p, *a, **kw):
            counter._record(self_p)
            return counter._p_open(self_p, *a, **kw)

        def p_text(self_p, *a, **kw):
            counter._record(self_p)
            return counter._p_text(self_p, *a, **kw)

        def p_bytes(self_p, *a, **kw):
            counter._record(self_p)
            return counter._p_bytes(self_p, *a, **kw)

        builtins.open = open_
        io.open = open_
        Path.open = p_open
        Path.read_text = p_text
        Path.read_bytes = p_bytes
        return self

    def __exit__(self, *exc) -> None:
        builtins.open = self._open
        io.open = self._io_open
        Path.open = self._p_open
        Path.read_text = self._p_text
        Path.read_bytes = self._p_bytes

    @property
    def count(self) -> int:
        return len(self.paths)


def fail_closed(message: str) -> int:
    """A run that could not happen still emits the four keys, so the reader parses JSON, not status."""
    print(
        json.dumps(
            {"passed": [], "failed": [], "errors": [], "skipped": [], "modules": 0,
             "inspected_total": 0, "error": message},
            indent=2,
        )
    )
    print(message, file=sys.stderr)
    return 1


def main() -> int:
    if len(sys.argv) < 2:
        return fail_closed("usage: run-constraints.py <presentation-dir>")
    target = Path(sys.argv[1])
    if not target.is_dir():
        return fail_closed(f"not a directory: {target}")

    modules = discover()
    if not modules:
        return fail_closed(f"no typst-*.py modules beside {HERE}")

    context = {"cwd": str(target.resolve())}
    results: dict[str, list] = {"passed": [], "failed": [], "errors": [], "skipped": []}

    for py_path in modules:
        name = py_path.stem
        try:
            mod = import_module(py_path)
        except Exception as exc:  # an unimportable module checked nothing
            results["errors"].append({"name": name, "inspected": 0, "error": f"{type(exc).__name__}: {exc}"})
            continue

        check_fn = getattr(mod, "check", None)
        if not callable(check_fn):
            results["skipped"].append({"name": name, "inspected": 0, "reason": "no callable check()"})
            continue

        counter = ReadCounter()
        try:
            with counter:
                violations = check_fn(dict(context))
        except Exception as exc:
            results["errors"].append(
                {"name": name, "inspected": counter.count, "error": f"{type(exc).__name__}: {exc}"}
            )
            continue

        if violations:
            results["failed"].append(
                {
                    "name": name,
                    "inspected": counter.count,
                    "severity": severity(mod),
                    "violations": violations,
                }
            )
        else:
            results["passed"].append({"name": name, "inspected": counter.count})

    results["modules"] = len(modules)
    results["inspected_total"] = sum(
        e["inspected"] for key in ("passed", "failed", "errors", "skipped") for e in results[key]
    )
    print(json.dumps(results, indent=2))
    clean = not (results["failed"] or results["errors"] or results["skipped"])
    return 0 if (clean and results["inspected_total"] > 0) else 1


if __name__ == "__main__":
    sys.exit(main())
