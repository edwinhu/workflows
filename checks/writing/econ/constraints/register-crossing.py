#!/usr/bin/env -S uv run python3
"""Constraint: register-crossing — a marker of another domain's register in this register's prose, and in a
law review a full citation in body text. The register is this file's workflow level,
checks/writing/<register>/constraints/; the rules are checks/writing/constraints/writing-style.py's."""
import importlib.util
from pathlib import Path

REGISTER = Path(__file__).resolve().parents[1].name
_spec = importlib.util.spec_from_file_location(
    "writing_style", Path(__file__).resolve().parents[2] / "constraints" / "writing-style.py")
style = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(style)

if __name__ == "__main__":
    raise SystemExit(style.main("register-crossing", lambda path: style.crossing(path, REGISTER)))
