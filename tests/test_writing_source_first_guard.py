#!/usr/bin/env python3
"""Tests for scripts/writing-source-first-guard.py — the blocking PreToolUse source-first
gate carried by user-agents/writing.md.

Every test drives the guard AS A SUBPROCESS with a synthetic PreToolUse payload on stdin,
because the exit code is the whole contract: 0 = allowed, 2 = refused.

State lives in gettempdir() keyed by a digest of the payload's `cwd`, so each test uses its
own tmp_path as the project and is therefore independent of every other test and of any
real session.

Run with:  python3 -m pytest tests/test_writing_source_first_guard.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GUARD = REPO_ROOT / "scripts" / "writing-source-first-guard.py"


def run(payload, raw: str | None = None) -> subprocess.CompletedProcess:
    stdin = raw if raw is not None else json.dumps(payload)
    return subprocess.run(
        [sys.executable, str(GUARD)],
        input=stdin,
        capture_output=True,
        text=True,
    )


def read_reference(project: Path, name: str = "source.md") -> dict:
    ref = project / "references" / name
    ref.parent.mkdir(parents=True, exist_ok=True)
    ref.write_text("The SEC adopted Rule 10b5-1 in 2000.\n")
    return {
        "tool_name": "Read",
        "tool_input": {"file_path": str(ref)},
        "cwd": str(project),
    }


def draft_write(project: Path, content: str) -> dict:
    return {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(project / "drafts" / "section-01.md"),
            "content": content,
        },
        "cwd": str(project),
    }


# --------------------------------------------------------------------------
# the core gate
# --------------------------------------------------------------------------

def test_refused_when_no_source_read(tmp_path):
    r = run(draft_write(tmp_path, "Rule 10b5-1 plans are widely used by executives.\n"))
    assert r.returncode == 2, (r.returncode, r.stdout, r.stderr)
    assert "BLOCKED" in r.stderr


def test_allowed_after_a_reference_was_read(tmp_path):
    rec = run(read_reference(tmp_path))
    assert rec.returncode == 0, rec.stderr

    r = run(draft_write(tmp_path, "Rule 10b5-1 plans are widely used by executives.\n"))
    assert r.returncode == 0, (r.returncode, r.stderr)


def test_bash_read_in_command_position_records_the_source(tmp_path):
    ref = tmp_path / "references" / "source.md"
    ref.parent.mkdir(parents=True)
    ref.write_text("body\n")
    rec = run({
        "tool_name": "Bash",
        "tool_input": {"command": f"rg 'Rule' {ref}"},
        "cwd": str(tmp_path),
    })
    assert rec.returncode == 0

    r = run(draft_write(tmp_path, "A sourced sentence about the rule.\n"))
    assert r.returncode == 0, r.stderr


def test_merely_mentioning_a_reference_path_is_not_a_read(tmp_path):
    # `echo` is not a reader: the path appears, but nothing was read.
    rec = run({
        "tool_name": "Bash",
        "tool_input": {"command": "echo references/source.md"},
        "cwd": str(tmp_path),
    })
    assert rec.returncode == 0

    r = run(draft_write(tmp_path, "An unsourced sentence about the rule.\n"))
    assert r.returncode == 2, (r.returncode, r.stderr)


def test_read_of_a_nonexistent_reference_reads_nothing(tmp_path):
    rec = run({
        "tool_name": "Read",
        "tool_input": {"file_path": str(tmp_path / "references" / "missing.md")},
        "cwd": str(tmp_path),
    })
    assert rec.returncode == 0

    r = run(draft_write(tmp_path, "An unsourced sentence about the rule.\n"))
    assert r.returncode == 2, (r.returncode, r.stderr)


# --------------------------------------------------------------------------
# THE HOLE IN TEACHING'S VERSION: a short claim is still a claim
# --------------------------------------------------------------------------

def test_short_unsourced_claim_is_refused(tmp_path):
    """Teaching's guard exempts any write under 50 chars containing two spaces or a blank
    line, so this exact sentence slips through there. Here it must be REFUSED."""
    claim = "The SEC adopted Rule 10b5-1 in 2000.\n"
    assert len(claim) < 50 and "  " not in claim  # short, and not even the two-space case
    r = run(draft_write(tmp_path, claim))
    assert r.returncode == 2, (r.returncode, r.stderr)

    short_with_spaces = "Rule  10b5-1\n\nwas adopted.\n"
    assert len(short_with_spaces) < 50 and "  " in short_with_spaces and "\n\n" in short_with_spaces
    r2 = run(draft_write(tmp_path, short_with_spaces))
    assert r2.returncode == 2, (r2.returncode, r2.stderr)


# --------------------------------------------------------------------------
# exemptions and non-gated paths
# --------------------------------------------------------------------------

def test_formatting_only_edit_is_allowed_without_a_source(tmp_path):
    # Same words, different whitespace/emphasis — adds no content.
    r = run({
        "tool_name": "Edit",
        "tool_input": {
            "file_path": str(tmp_path / "drafts" / "section-01.md"),
            "old_string": "The rule *binds* issuers.",
            "new_string": "The rule **binds**\nissuers.",
        },
        "cwd": str(tmp_path),
    })
    assert r.returncode == 0, (r.returncode, r.stderr)


def test_pure_deletion_is_allowed_without_a_source(tmp_path):
    r = run({
        "tool_name": "Edit",
        "tool_input": {
            "file_path": str(tmp_path / "drafts" / "section-01.md"),
            "old_string": "The rule binds issuers and their agents.",
            "new_string": "The rule binds issuers",
        },
        "cwd": str(tmp_path),
    })
    assert r.returncode == 0, (r.returncode, r.stderr)


def test_non_gated_path_is_allowed_without_a_source(tmp_path):
    r = run({
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "notes" / "scratch.md"),
            "content": "Anything at all, unsourced.\n",
        },
        "cwd": str(tmp_path),
    })
    assert r.returncode == 0, (r.returncode, r.stderr)


def test_multiedit_to_a_draft_is_gated(tmp_path):
    r = run({
        "tool_name": "MultiEdit",
        "tool_input": {
            "file_path": str(tmp_path / "drafts" / "section-01.md"),
            "edits": [
                {"old_string": "a", "new_string": "a new unsourced clause about the rule"},
            ],
        },
        "cwd": str(tmp_path),
    })
    assert r.returncode == 2, (r.returncode, r.stderr)


# --------------------------------------------------------------------------
# unreadable payload
# --------------------------------------------------------------------------

def test_unparseable_payload_refuses():
    r = run(None, raw="{not json at all")
    assert r.returncode == 2, (r.returncode, r.stdout, r.stderr)
    assert "REFUSED" in r.stderr


def test_payload_with_non_object_tool_input_refuses(tmp_path):
    r = run({"tool_name": "Write", "tool_input": "oops", "cwd": str(tmp_path)})
    assert r.returncode == 2, (r.returncode, r.stderr)


# --------------------------------------------------------------------------
# state isolation
# --------------------------------------------------------------------------

def test_source_read_in_one_project_does_not_satisfy_another(tmp_path):
    project_a = tmp_path / "a"
    project_b = tmp_path / "b"
    (project_a / "drafts").mkdir(parents=True)
    (project_b / "drafts").mkdir(parents=True)

    assert run(read_reference(project_a)).returncode == 0
    assert run(draft_write(project_a, "A sourced sentence.\n")).returncode == 0
    assert run(draft_write(project_b, "An unsourced sentence.\n")).returncode == 2


if __name__ == "__main__":
    sys.exit(subprocess.call([sys.executable, "-m", "pytest", __file__, "-q"]))
