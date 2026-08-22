#!/usr/bin/env python3
"""PreToolUse guard: BLOCK prose writes under `drafts/` until a source has been read.

Registered in `user-agents/writing.md`'s own `hooks:` block (`hooks:` frontmatter is
honoured for user-scoped agents, ignored for plugin-shipped ones). This enforces the
IRON LAW OF WRITING PLANNING — "training-data recall is NOT a source" — BEFORE the write
lands, where `hooks/cite-fidelity-lint.ts` only reports a fabricated citation after it is
already on disk.

It is a SOURCE-WAS-READ gate and nothing else: it records that a real read of a file under
a `references/` directory happened in this project, and refuses a content write to a file
under `drafts/` when none has. It does not inspect the prose for unsourced claims.

The matcher MUST cover the RECORDING tools (Read, Bash) as well as the guarded ones
(Edit, Write, MultiEdit): registering only the guarded ones makes the recording branches
below unreachable and every draft write blocks forever.

Blocking, not advisory: exit 2 with the reason on stderr is the only form measured to
reach the writing model.

Exit codes: 0 = allowed. 2 = refused (unsourced draft content write, or a payload this
guard cannot read — a gate that cannot run must not permit).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile

READERS = (
    "cat", "less", "more", "head", "tail", "sed", "awk", "rg", "grep", "bat",
    "pdftotext", "python3", "python", "uv", "xan", "jq",
)

# A path segment named `references` anywhere in the path — `references/foo.pdf`,
# `./references/a/b.md`, `/abs/project/references/x.txt`.
_REF_SEGMENT = re.compile(r"(?:^|/)references/")


def state_file(project: str) -> str:
    """PER PROJECT, not global, and in the system temp dir — never in the project.

    A single shared path would mean one session reading any reference satisfied
    source-first for every later session and every unrelated project, permanently,
    since nothing resets it.
    """
    digest = hashlib.sha256(os.path.realpath(project or ".").encode("utf-8")).hexdigest()[:16]
    return os.path.join(tempfile.gettempdir(), f"writing-source-first-{digest}.json")


def load_state(project: str) -> dict:
    path = state_file(project)
    if os.path.exists(path):
        try:
            with open(path) as f:
                state = json.load(f)
            if isinstance(state, dict):
                return state
        except (ValueError, OSError):
            pass
    return {"source_accessed": False}


def save_state(project: str, state: dict) -> None:
    try:
        with open(state_file(project), "w") as f:
            json.dump(state, f)
    except OSError:
        pass


def is_reference_path(path: str) -> bool:
    return bool(path) and bool(_REF_SEGMENT.search(path.replace(os.sep, "/")))


def is_draft_path(path: str) -> bool:
    return bool(path) and bool(re.search(r"(?:^|/)drafts/", path.replace(os.sep, "/")))


def reads_source(command: str) -> bool:
    """Did this command actually READ a reference, or merely mention its path?

    Substring matching on the command text would let `echo references/x.md` and
    `false references/x.md` satisfy source-first. Require a reading command in COMMAND
    POSITION with a `references/` path as one of its arguments.
    """
    for segment in re.split(r"[;&|]+|\n", command):
        tokens = segment.strip().split()
        while tokens and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", tokens[0]):
            tokens.pop(0)
        if not tokens:
            continue
        if os.path.basename(tokens[0]) not in READERS:
            continue
        if any(is_reference_path(tok) for tok in tokens[1:]):
            return True
    return False


def refuse(reason: str) -> None:
    sys.stderr.write(reason + "\n")
    sys.exit(2)


def written_text(tool_params: dict) -> str:
    """The prose this call would put into the file, across Write/Edit/MultiEdit shapes."""
    parts = [tool_params.get("content", ""), tool_params.get("new_string", "")]
    for edit in tool_params.get("edits", []) or []:
        if isinstance(edit, dict):
            parts.append(edit.get("new_string", ""))
    return "\n".join(p for p in parts if isinstance(p, str))


def replaced_text(tool_params: dict) -> str:
    parts = [tool_params.get("old_string", "")]
    for edit in tool_params.get("edits", []) or []:
        if isinstance(edit, dict):
            parts.append(edit.get("old_string", ""))
    return "\n".join(p for p in parts if isinstance(p, str))


def _normalize(text: str) -> str:
    """Word characters only, lowercased — the *content* of a passage, stripped of every
    whitespace and markup difference."""
    return re.sub(r"[^0-9a-z]+", "", text.lower())


def is_formatting_edit(old: str, new: str) -> bool:
    """Is this edit purely formatting — i.e. does it add NO content?

    CHOSEN CRITERION: the edit adds no word characters that were not already there.
    Formally, normalize both sides to their lowercased alphanumerics; the edit is
    formatting-only when the new side is empty, or is a subsequence-free *subset* in the
    strict sense of being identical to the old side (rewrapping, emphasis markers,
    heading hashes, blank lines) or strictly shorter and contained in it (a pure
    deletion).

    WHY NOT a length heuristic. Teaching's guard exempts any write under 50 characters
    containing two spaces or a blank line, which lets a SHORT UNSOURCED CLAIM through
    verbatim — "The SEC adopted Rule 10b5-1 in 2000." is 37 characters and contains
    spaces. Length is uncorrelated with whether a sentence asserts a fact. This criterion
    cannot pass prose content by construction: any newly written sentence introduces
    alphanumeric characters absent from the old side, so it is never exempt. A `Write`
    (no `old_string`) is likewise never exempt.
    """
    n_new, n_old = _normalize(new), _normalize(old)
    if not n_new:
        return True  # deletes content or moves whitespace only
    return n_new == n_old or n_new in n_old


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("payload is not a JSON object")
        tool_name = payload.get("tool_name", "")
        tool_params = payload.get("tool_input", {})
        if not isinstance(tool_params, dict):
            raise ValueError("tool_input is not a JSON object")
        project = payload.get("cwd", "") or os.getcwd()
    except Exception as exc:
        # An unreadable payload REFUSES on a gated write and allows otherwise. We cannot
        # read tool_name, so we cannot tell which this is — the file path is unknown, and
        # the gate cannot certify a source read it could not parse. Refuse.
        refuse(
            "writing-source-first-guard: REFUSED — unreadable PreToolUse payload "
            f"({type(exc).__name__}: {exc}). The guard cannot certify a source read, so the "
            "call is blocked rather than silently permitted."
        )
        return

    state = load_state(project)

    # --- record source access ---------------------------------------------------------
    if tool_name == "Read":
        file_path = tool_params.get("file_path", "") or ""
        # A Read of a path that does not exist reads nothing.
        if is_reference_path(file_path) and os.path.exists(file_path):
            state["source_accessed"] = True
            save_state(project, state)
        sys.exit(0)

    if tool_name == "Bash":
        if reads_source(tool_params.get("command", "") or ""):
            state["source_accessed"] = True
            save_state(project, state)
        sys.exit(0)

    # --- gate draft content writes ----------------------------------------------------
    # Edit ALONE would leave Write and MultiEdit unguarded — the easiest bypass is to
    # write the file instead of editing it.
    if tool_name in ("Edit", "Write", "MultiEdit"):
        file_path = tool_params.get("file_path", "") or ""
        if is_draft_path(file_path) and not state.get("source_accessed"):
            new = written_text(tool_params)
            old = replaced_text(tool_params)
            if not is_formatting_edit(old, new):
                refuse(
                    "writing-source-first-guard: BLOCKED — content write to "
                    f"{file_path} with no source read under references/ in {project}.\n"
                    "A refusal is never fixed by reshaping the write or routing it through "
                    "Bash. Read a source under the project's references/ — with Read, or a "
                    "real reading command such as rg/cat in Bash — then retry this write.\n"
                    "Prose written without opening a source is written from training recall, "
                    "which is the fabricated-citation failure mode this gate exists for.\n"
                    "Formatting-only edits (rewrapping, emphasis, deletions) are not gated."
                )

    sys.exit(0)


if __name__ == "__main__":
    main()
