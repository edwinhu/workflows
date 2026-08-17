"""TOCTOU-hardened artifact snapshotting for workflow authenticate pre-steps.

Workflow orchestrator scripts are pure control flow: the runtime rejects
``import()``, ``import.meta``, ``process``, and ``Buffer``, so a workflow can
neither open a file nor hash bytes. Authentication is not control flow anyway —
it is a deterministic, trusted-layer job, and pushing it into a dispatched agent
would ask the untrusted party to vouch for itself. It therefore lives in the
deterministic pre-step each skill already runs, and the authenticated bundle is
handed to the workflow through ``args``.

This module is the single implementation of that discipline, shared by every
domain authenticator (writing, workshop, ...). It must stay identical across
domains: a weakened copy in one workflow is a hole in all of them.
"""

import hashlib
import os
import stat
from pathlib import Path

# Fields a re-snapshot must reproduce exactly for an artifact to count as
# unchanged. `text` is deliberately absent — `hash` already covers the bytes.
IDENTITY_FIELDS = ("real", "hash", "dev", "ino", "size", "mtime_ns", "ctime_ns")


class ArtifactAuthError(Exception):
    """A snapshot could not be taken with the required identity guarantees."""


def same_state(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
        and left.st_size == right.st_size
        and left.st_mtime_ns == right.st_mtime_ns
        and left.st_ctime_ns == right.st_ctime_ns
    )


def snapshot_regular(path: Path, root: Path) -> tuple[bytes, os.stat_result, Path]:
    """TOCTOU-hardened read of one regular, project-contained, non-symlink file.

    Ported from the JS ``snapshotArtifact`` the writing/workshop orchestrators used
    to run in-process before workflow scripts were confined to pure control flow.
    The discipline is identical and must stay identical: open with ``O_NOFOLLOW``,
    ``fstat`` the descriptor, compare that opened identity against an ``lstat`` of
    the path both BEFORE and AFTER the read, and re-resolve the realpath after the
    read so a swapped path or mutated inode fails closed rather than yielding bytes.
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode):
            raise OSError("not a regular file")
        root_real = root.resolve()
        real = path.resolve(strict=True)
        if not real.is_relative_to(root_real):
            raise OSError("path escapes project")
        before_path = os.stat(path, follow_symlinks=False)
        if stat.S_ISLNK(before_path.st_mode) or not same_state(opened, before_path):
            raise OSError("path identity changed before read")
        chunks: list[bytes] = []
        while chunk := os.read(fd, 1024 * 1024):
            chunks.append(chunk)
        after_fd = os.fstat(fd)
        after_path = os.stat(path, follow_symlinks=False)
        if (
            stat.S_ISLNK(after_path.st_mode)
            or path.resolve(strict=True) != real
            or not same_state(opened, after_fd)
            or not same_state(opened, after_path)
        ):
            raise OSError("path changed during read")
        return b"".join(chunks), opened, real
    finally:
        os.close(fd)


def snapshot_artifact(path: Path, root: Path) -> dict:
    """Authenticate one artifact and return its content plus stable identity."""
    try:
        data, opened, real = snapshot_regular(path, root)
        text = data.decode("utf-8")
    except (OSError, ValueError, UnicodeDecodeError) as error:
        raise ArtifactAuthError(
            f"requires a stable regular non-symlink project-contained UTF-8 artifact: {path} ({error})"
        ) from error
    return {
        "path": str(path),
        "real": str(real),
        "hash": hashlib.sha256(data).hexdigest(),
        "text": text,
        # Serialized as strings: nanosecond timestamps and large inode numbers
        # exceed JS Number precision, and the workflow never does arithmetic on them.
        "dev": str(opened.st_dev),
        "ino": str(opened.st_ino),
        "size": str(opened.st_size),
        "mtime_ns": str(opened.st_mtime_ns),
        "ctime_ns": str(opened.st_ctime_ns),
    }


def reject_symlinks(paths, label: str = "authentication") -> None:
    """Fail closed if any of `paths` is a symbolic link (or cannot be lstat'd).

    The snapshot itself is ``O_NOFOLLOW``, which covers the artifact's own final
    component. This covers the *containing* chain (``.planning``, ``.planning/.state``)
    that a snapshot of the leaf cannot speak to.
    """
    for path in paths:
        try:
            info = os.stat(path, follow_symlinks=False)
        except OSError as error:
            raise ArtifactAuthError(f"{label} could not stat {path}: {error}") from error
        if stat.S_ISLNK(info.st_mode):
            raise ArtifactAuthError(f"{label} rejects symbolic links: {path}")


def verify_bundle(bundle: dict) -> dict:
    """Re-snapshot every authenticated artifact and report per-artifact match."""
    root_real = Path(bundle.get("projectReal") or bundle.get("projectDir") or "/")
    artifacts = bundle.get("artifacts") or {}
    records: list[dict] = []
    drifted: list[str] = []
    for key, snapshot in artifacts.items():
        path = Path(snapshot.get("path", ""))
        try:
            current = snapshot_artifact(path, root_real)
        except ArtifactAuthError as error:
            records.append({"key": key, "path": str(path), "match": False, "reason": str(error)})
            drifted.append(key)
            continue
        mismatched = [name for name in IDENTITY_FIELDS if current.get(name) != snapshot.get(name)]
        if mismatched:
            records.append(
                {
                    "key": key,
                    "path": str(path),
                    "match": False,
                    "reason": "identity changed during review: " + ", ".join(mismatched),
                }
            )
            drifted.append(key)
        else:
            records.append({"key": key, "path": str(path), "match": True, "hash": current["hash"]})
    return {"ok": not drifted, "artifacts": records, "drifted": drifted}
