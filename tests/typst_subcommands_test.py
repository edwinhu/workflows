#!/usr/bin/env python3
"""Every `typst <subcommand>` a script shells out to must exist in the installed typst.

This is the check that was missing when bib_to_entries.parse_existing and
expand_citations both called `typst eval`, a subcommand typst 0.13 does not have.
Both failed on every invocation. parse_existing's own docstring calls itself "the
one guard against a citation changing unread", so the guard was dead and nothing
said so — one of the two call sites had no test at all, and the other surfaced
only as a confusing SystemExit inside an unrelated assertion.

The subcommand list is read from `typst --help` rather than hard-coded, so this
also catches the reverse drift: typst removing or renaming a subcommand a script
depends on.

Run: pixi run test tests/typst_subcommands_test.py
"""

import os
import re
import shutil
import subprocess
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_DIR = os.path.join(REPO_ROOT, "skills", "docx-typst", "scripts")

# `[typst, "eval", …]` or `["typst", "eval", …]` — the argv head of a subprocess call.
_CALL = re.compile(r'''\[\s*(?:typst|["']typst["'])\s*,\s*["']([a-z][a-z-]*)["']''')


def _installed_subcommands():
    typst = shutil.which("typst")
    if not typst:
        return None
    out = subprocess.run([typst, "--help"], capture_output=True, text=True).stdout
    if "Commands:" not in out:
        return None
    block = out.split("Commands:", 1)[1].split("Options:", 1)[0]
    return {m.group(1) for m in re.finditer(r"^\s{2}([a-z][a-z-]*)\s", block, re.M)}


def _call_sites():
    sites = []
    for name in sorted(os.listdir(SCRIPT_DIR)):
        if not name.endswith(".py"):
            continue
        path = os.path.join(SCRIPT_DIR, name)
        with open(path, encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                for m in _CALL.finditer(line):
                    sites.append((name, lineno, m.group(1)))
    return sites


def test_the_probe_finds_the_call_sites():
    """Guard the guard: a regex that matches nothing would pass the real test silently."""
    assert _call_sites(), f"no `typst <sub>` call sites found under {SCRIPT_DIR}"


@pytest.mark.skipif(shutil.which("typst") is None, reason="typst not installed")
def test_every_typst_subcommand_used_actually_exists():
    have = _installed_subcommands()
    assert have, "could not read the subcommand list from `typst --help`"
    bad = [(f, n, s) for f, n, s in _call_sites() if s not in have]
    assert not bad, (
        "script(s) shell out to a typst subcommand this typst does not have:\n"
        + "\n".join(f"  {f}:{n} calls `typst {s}`" for f, n, s in bad)
        + f"\ninstalled subcommands: {sorted(have)}"
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
