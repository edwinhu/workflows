#!/usr/bin/env python3
"""Tamper suite for the extracted artifact authenticator.

Proves that `scripts/writing/writing_section_index.py`'s TOCTOU-hardened
snapshot/verify/finalize layer fails CLOSED: every tamper below must raise
`ArtifactAuthError` or report `match: False` for the specific artifact key —
never merely "return something different".

Top-level-assert script, not pytest: `scripts/check-tests.sh` routes
`tests/*.py` files defining `def test_` to pytest, and this filename cannot be
imported as a module. Run it directly:

    python3 tests/writing-artifact-authenticator.test.py
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import json
import os
import shutil
import signal
import stat
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "writing" / "writing_section_index.py"

_spec = importlib.util.spec_from_file_location("writing_section_index", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
wsi = importlib.util.module_from_spec(_spec)
# Register before exec: dataclass field resolution looks the defining module up in
# sys.modules, and a module absent from it raises on Python 3.14.
sys.modules["writing_section_index"] = wsi
_spec.loader.exec_module(wsi)


# ── fixture ──────────────────────────────────────────────────────────────────
# Same shape as tests/writing_section_index_test.py's `write_project`, which is
# the only known plan grammar that compiles cleanly (ok: True).

PLAN = """# Article

## Writing Intent
- **Thesis**: The rule should change.
- **Audience**: Legal academics.
- **Purpose**: Establish the case for reform.
- **Hook**: The existing rule fails in a recurring case.
- **Scope**: Federal doctrine; state law is excluded.
- **Domain**: legal

## Claims
- **CLAIM-01**: The current rule creates a predictable gap.
- **CLAIM-02**: A narrower replacement closes that gap.

## Counterarguments
- Administrability favors the status quo → Part II answers with a bounded test.

## Document Structure
### Introduction
Frames the problem and previews both claims.

### Part I. The Gap
Establishes CLAIM-01.

### Part II. The Repair
Establishes CLAIM-02 and answers the counterargument.

### Conclusion
States the payoff.

## Claim → Section Map
| Claim | Section |
|---|---|
| CLAIM-01 | Part I. The Gap |
| CLAIM-02 | Part II. The Repair |

## Source Plan
- **Bibliography**: references/sources.bib
- **Notebook**: none
- **Notebook URL**: none
- **Key Sources**: case2024; article2025

## Section Outputs
| Section | Outline | Draft | Depends On |
|---|---|---|---|
| Introduction | outlines/Introduction.md | drafts/Introduction (Draft).md | - |
| Part I. The Gap | outlines/Part I. The Gap.md | drafts/Part I. The Gap (Draft).md | Introduction |
| Part II. The Repair | outlines/Part II. The Repair.md | drafts/Part II. The Repair (Draft).md | Part I. The Gap |
| Conclusion | outlines/Conclusion.md | drafts/Conclusion (Draft).md | Part II. The Repair |

## Review Surfaces
- Whole-plan claim and structure review.
- Citation fidelity and final user review.
"""

SECTION_CLAIMS = {
    "Introduction": [],
    "Part I. The Gap": ["CLAIM-01"],
    "Part II. The Repair": ["CLAIM-02"],
    "Conclusion": [],
}

_TEMP_DIRS: list[Path] = []


def new_temp_dir() -> Path:
    # realpath: /tmp is itself a symlink on some platforms, and the authenticator
    # compares resolved paths.
    path = Path(tempfile.mkdtemp(prefix="writing-auth-")).resolve()
    _TEMP_DIRS.append(path)
    return path


def write_project(root: Path) -> Path:
    planning = root / ".planning"
    state = planning / ".state"
    state.mkdir(parents=True)
    (root / "outlines").mkdir()
    (root / "drafts").mkdir()
    (root / "references").mkdir()
    (root / "references" / "sources.bib").write_text("@article{case2024, title={Case}}\n")
    plan_path = planning / "peaceful-article.md"
    plan_path.write_text(PLAN)
    plan_hash = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    (state / "review.json").write_text(
        json.dumps(
            {
                "workflow": "writing",
                "plan_file": plan_path.name,
                "plan_hash": plan_hash,
                "approved_session_id": "approval-session",
                "approved_at": "2026-07-31T10:00:00.000Z",
                "status": "APPROVED",
                "reviewer_session_id": "review-session",
                "reviewed_at": "2026-07-31T10:01:00.000Z",
            }
        )
    )
    for name, claims in SECTION_CLAIMS.items():
        (root / "outlines" / f"{name}.md").write_text(
            f"---\nimplements: [{', '.join(claims)}]\nplan_hash: {plan_hash}\n---\n"
            "- First point [@case2024]\n- Second point\n- Third point\n"
        )
        (root / "drafts" / f"{name} (Draft).md").write_text(
            f"---\nimplements: [{', '.join(claims)}]\nplan_hash: {plan_hash}\n---\n"
            f"{' '.join(claims)} prose.\n"
        )
    return root


def fresh_project() -> Path:
    return write_project(new_temp_dir() / "project")


def replace_in_place(path: Path, data: bytes) -> None:
    """Atomically install `data` at `path` under a brand-new inode."""
    staging = path.parent / f".swap-{path.name}"
    staging.write_bytes(data)
    os.replace(staging, path)


# ── assertion helpers ────────────────────────────────────────────────────────

PASSED: list[str] = []
FAILED: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(label)
    else:
        FAILED.append(f"{label}: {detail or 'assertion failed'}")


class Blocked(Exception):
    """The call under test did not return within the watchdog window."""


@contextlib.contextmanager
def watchdog(seconds: int):
    """Turn a blocking call into a loud failure instead of a hung suite.

    `_snapshot_regular` opens O_RDONLY without O_NONBLOCK, so if its S_ISREG
    guard ever regressed, the FIFO case below would block forever rather than
    fail. A hang is not a passing test; make it raise.
    """

    def fire(signum, frame):
        raise Blocked(f"call did not return within {seconds}s")

    previous = signal.signal(signal.SIGALRM, fire)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def expect_auth_error(label: str, fn, *, contains: str | None = None) -> None:
    try:
        fn()
    except wsi.ArtifactAuthError as error:
        if contains is not None and contains not in str(error):
            FAILED.append(f"{label}: raised ArtifactAuthError but message lacked {contains!r}: {error}")
            return
        PASSED.append(label)
    except BaseException as error:  # noqa: BLE001 - a non-ArtifactAuthError escape is a failure
        FAILED.append(f"{label}: raised {type(error).__name__} instead of ArtifactAuthError: {error}")
    else:
        FAILED.append(f"{label}: did NOT raise — the authenticator failed open")


# ── case 1: symlinked artifact ───────────────────────────────────────────────


def case_symlink() -> None:
    """Symlinked artifacts must never yield bytes.

    Three independent layers reject them, verified by mutation: O_NOFOLLOW makes
    the open itself fail ELOOP (what actually fires today); the explicit
    `S_ISLNK(before_path)` guard catches it next; and failing both, the
    lstat-vs-fstat identity comparison still mismatches, because an lstat of a
    symlink can never equal an fstat of its target. Assertions below therefore
    pin the BEHAVIOR (ArtifactAuthError) rather than any one layer's message,
    which is also what keeps them portable.
    """
    root = fresh_project()
    target = root / "drafts" / "Introduction (Draft).md"
    payload = target.read_bytes()

    # 1a: symlink pointing outside the project.
    outside = root.parent / "outside-draft.md"
    outside.write_bytes(payload)
    link = root / "drafts" / "linked-outside.md"
    link.symlink_to(outside)
    expect_auth_error(
        "1a symlink to an outside target is rejected",
        lambda: wsi.snapshot_artifact(link, root),
    )

    # 1b: symlink whose target is a perfectly valid, in-project, in-place artifact.
    # Content and containment are both fine; only the symlink-ness is wrong.
    inside_link = root / "drafts" / "linked-inside.md"
    inside_link.symlink_to(target)
    check(
        "1b symlink target is genuinely valid on its own",
        wsi.snapshot_artifact(target, root)["hash"] == hashlib.sha256(payload).hexdigest(),
        "the direct snapshot of the symlink target should succeed",
    )
    expect_auth_error(
        "1b symlink to a valid in-project artifact is still rejected",
        lambda: wsi.snapshot_artifact(inside_link, root),
    )

    # 1c: the artifact path itself replaced by a symlink to a byte-identical copy.
    copy = root / "drafts" / "copy.md"
    copy.write_bytes(payload)
    target.unlink()
    target.symlink_to(copy)
    expect_auth_error(
        "1c artifact swapped for a symlink to a byte-identical copy is rejected",
        lambda: wsi.snapshot_artifact(target, root),
    )


# ── case 2: artifact swapped between open and read ───────────────────────────


def case_swap_mid_read() -> None:
    """Deterministically exercise the AFTER-read identity check.

    `os.read` is monkeypatched inside the module so the swap lands exactly
    between the pre-read identity check and the post-read one. No sleeps, no
    threads, no race.
    """
    root = fresh_project()
    target = root / "drafts" / "Introduction (Draft).md"
    original = target.read_bytes()

    real_read = os.read
    state = {"swapped": False, "read_calls": 0}

    def swapping_read(fd, length):
        state["read_calls"] += 1
        if not state["swapped"]:
            state["swapped"] = True
            # Same bytes, brand-new inode: content is innocent, identity is not.
            replace_in_place(target, original)
        return real_read(fd, length)

    # `wsi.os` IS the global os module, so this patch is global for its duration.
    # The window is a single synchronous call and is restored in `finally`.
    os.read = swapping_read
    try:
        expect_auth_error(
            "2 artifact swapped between open and read is rejected",
            lambda: wsi.snapshot_artifact(target, root),
            contains="path changed during read",
        )
    finally:
        os.read = real_read

    check(
        "2 the swap actually happened mid-read (os.read was reached)",
        state["swapped"] and state["read_calls"] >= 1,
        f"read_calls={state['read_calls']} swapped={state['swapped']}",
    )
    check(
        "2 post-swap bytes are identical, so only identity could have caught it",
        target.read_bytes() == original,
        "the swapped-in file should be byte-identical to the original",
    )


# ── case 3: path escaping the project root ───────────────────────────────────


def case_escapes_root() -> None:
    root = fresh_project()

    # 3a: a plain regular file physically outside the root — no symlink involved.
    outside = root.parent / "outside-plain.md"
    outside.write_text("---\nimplements: []\n---\noutside\n")
    expect_auth_error(
        "3a regular file physically outside the root is rejected",
        lambda: wsi.snapshot_artifact(outside, root),
        contains="path escapes project",
    )

    # 3b: a legitimate in-project artifact authenticated against a root that
    # does not contain it (e.g. a bundle carrying the wrong projectReal).
    other_root = new_temp_dir() / "elsewhere"
    other_root.mkdir(parents=True)
    inside = root / "drafts" / "Introduction (Draft).md"
    check(
        "3b the artifact authenticates fine under its OWN root",
        isinstance(wsi.snapshot_artifact(inside, root), dict),
    )
    expect_auth_error(
        "3b symlink-free in-project artifact is rejected under a foreign root",
        lambda: wsi.snapshot_artifact(inside, other_root),
        contains="path escapes project",
    )

    # 3c: traversal out and back in through `..` still resolves outside.
    traversal = root / "drafts" / ".." / ".." / outside.name
    expect_auth_error(
        "3c `..` traversal to an outside file is rejected",
        lambda: wsi.snapshot_artifact(traversal, root),
        contains="path escapes project",
    )


# ── case 4: non-regular files ────────────────────────────────────────────────


def case_non_regular() -> None:
    root = fresh_project()

    # 4a: directory. os.open(O_RDONLY) on a directory succeeds on Linux; the
    # fstat S_ISREG check is what must reject it.
    directory = root / "drafts"
    expect_auth_error(
        "4a directory is rejected (not a regular file)",
        lambda: wsi.snapshot_artifact(directory, root),
    )

    # 4b: FIFO. The module opens O_RDONLY without O_NONBLOCK, which would block
    # forever on a writer-less FIFO. Hold it open O_RDWR (non-blocking on Linux)
    # so the module's own open returns immediately and its S_ISREG check — not a
    # timeout — is what fails closed.
    fifo = root / "drafts" / "pipe.md"
    os.mkfifo(fifo)
    holder = os.open(fifo, os.O_RDWR)
    try:
        check(
            "4b fixture really is a FIFO",
            stat.S_ISFIFO(os.lstat(fifo).st_mode),
        )
        with watchdog(10):
            expect_auth_error(
                "4b FIFO is rejected (not a regular file)",
                lambda: wsi.snapshot_artifact(fifo, root),
                contains="not a regular file",
            )
    finally:
        os.close(holder)
        fifo.unlink()

    # 4c: character device (/dev/null), if the platform exposes one.
    devnull = Path("/dev/null")
    if devnull.exists() and stat.S_ISCHR(os.lstat(devnull).st_mode):
        expect_auth_error(
            "4c character device is rejected (not a regular file)",
            lambda: wsi.snapshot_artifact(devnull, Path("/")),
            contains="not a regular file",
        )


# ── case 5: hash mismatch on re-verify ───────────────────────────────────────


def case_hash_drift() -> None:
    root = fresh_project()
    bundle = wsi.authenticate(root)
    check(
        "5 baseline bundle authenticates cleanly",
        bundle["ok"],
        json.dumps(bundle.get("violations")),
    )
    clean = wsi.verify(bundle)
    check("5 untouched bundle verifies clean", clean["ok"] and clean["drifted"] == [], json.dumps(clean["drifted"]))

    key = "section:Part I. The Gap:draft"
    snapshot = bundle["artifacts"][key]
    path = Path(snapshot["path"])
    path.write_text(snapshot["text"] + "\nSmuggled sentence added after review began.\n")

    report = wsi.verify(bundle)
    record = next(item for item in report["artifacts"] if item["key"] == key)
    check("5 verify reports ok=False after a byte edit", report["ok"] is False)
    check("5 the edited draft key is in `drifted`", report["drifted"] == [key], json.dumps(report["drifted"]))
    check("5 the edited draft record is match=False", record["match"] is False)
    check(
        "5 the mismatch reason names the hash",
        "hash" in record.get("reason", ""),
        record.get("reason", ""),
    )
    check(
        "5 every other artifact still matches",
        all(item["match"] for item in report["artifacts"] if item["key"] != key),
    )


# ── case 6: metadata-only drift (identical bytes, new inode) ─────────────────


def case_metadata_only_drift() -> None:
    """The guarantee that separates identity comparison from a plain hash check."""
    root = fresh_project()
    bundle = wsi.authenticate(root)
    check("6 baseline bundle authenticates cleanly", bundle["ok"], json.dumps(bundle.get("violations")))

    key = "section:Part II. The Repair:draft"
    snapshot = bundle["artifacts"][key]
    path = Path(snapshot["path"])
    original = path.read_bytes()
    replace_in_place(path, original)

    check(
        "6 bytes are byte-for-byte identical after the rewrite",
        path.read_bytes() == original
        and hashlib.sha256(path.read_bytes()).hexdigest() == snapshot["hash"],
    )
    check(
        "6 the inode really changed",
        str(os.stat(path).st_ino) != snapshot["ino"],
        f"ino {os.stat(path).st_ino} vs snapshot {snapshot['ino']}",
    )

    report = wsi.verify(bundle)
    record = next(item for item in report["artifacts"] if item["key"] == key)
    check("6 verify reports ok=False on metadata-only drift", report["ok"] is False)
    check("6 the rewritten draft key is in `drifted`", report["drifted"] == [key], json.dumps(report["drifted"]))
    check("6 the rewritten draft record is match=False", record["match"] is False)
    reason = record.get("reason", "")
    check("6 the reason names `ino`, not the hash", "ino" in reason and "hash" not in reason, reason)


# ── case 7: finalize end-to-end ──────────────────────────────────────────────


def case_finalize() -> None:
    root = fresh_project()
    bundle = wsi.authenticate(root)
    check("7 baseline bundle authenticates cleanly", bundle["ok"], json.dumps(bundle.get("violations")))

    drifted_section = "Part I. The Gap"
    intact_section = "Part II. The Repair"
    drifted_key = f"section:{drifted_section}:draft"
    intact_key = f"section:{intact_section}:draft"
    intact_hash = bundle["artifacts"][intact_key]["hash"]

    result = {
        "verdict": "CLEAN",
        "overallPass": True,
        "substratePass": True,
        "summary": {"critical": 0, "major": 2},
        "sections": [{"section": name} for name in SECTION_CLAIMS],
        "findings": [
            {"section": drifted_section, "severity": "major", "area": "prose", "detail": "drifted-section finding"},
            {"section": intact_section, "severity": "major", "area": "prose", "detail": "intact-section finding"},
        ],
    }

    # Mutate one section's draft between authenticate and finalize.
    drifted_path = Path(bundle["artifacts"][drifted_key]["path"])
    drifted_path.write_text(bundle["artifacts"][drifted_key]["text"] + "\nEdited mid-review.\n")

    outcome = wsi.finalize(bundle, result)
    final = outcome["result"]
    details = [str(finding.get("detail", "")) for finding in final["findings"]]

    check(
        "7 the drifted section's findings are discarded",
        "drifted-section finding" not in details,
        json.dumps(details),
    )
    check(
        "7 the intact section's findings survive",
        "intact-section finding" in details,
        json.dumps(details),
    )
    check("7 discardedFindings counts exactly one", final["discardedFindings"] == 1, str(final["discardedFindings"]))

    integrity = [
        finding
        for finding in final["findings"]
        if finding.get("area") == "artifact-integrity" and finding.get("severity") == "critical"
    ]
    check("7 exactly one critical artifact-integrity finding is added", len(integrity) == 1, json.dumps(integrity))
    check(
        "7 the integrity finding names the drifted section and its retry key",
        bool(integrity)
        and integrity[0].get("section") == drifted_section
        and integrity[0].get("retryKey") == f"document:artifact-integrity:{drifted_key}",
        json.dumps(integrity),
    )

    by_name = {section["section"]: section for section in final["sections"]}
    check(
        "7 the drifted section's finalDraftHash is emptied",
        by_name[drifted_section]["finalDraftHash"] == "",
        repr(by_name[drifted_section].get("finalDraftHash")),
    )
    check("7 the drifted section is marked unreliable", by_name[drifted_section].get("unreliable") is True)
    check(
        "7 the drifted section's UNTOUCHED outline still carries its snapshot hash",
        by_name[drifted_section]["finalOutlineHash"]
        == bundle["artifacts"][f"section:{drifted_section}:outline"]["hash"],
    )
    check(
        "7 the intact section's finalDraftHash equals its snapshot hash",
        by_name[intact_section]["finalDraftHash"] == intact_hash,
        repr(by_name[intact_section].get("finalDraftHash")),
    )
    check("7 the intact section is not marked unreliable", "unreliable" not in by_name[intact_section])

    check("7 overallPass is forced False", final["overallPass"] is False)
    check("7 substratePass is forced False", final["substratePass"] is False)
    check("7 verdict is ISSUES FOUND", final["verdict"] == "ISSUES FOUND")
    check("7 critical count is incremented", final["summary"]["critical"] == 1, json.dumps(final["summary"]))
    check("7 unreliableSections names the drifted section", final["unreliableSections"] == [drifted_section])
    check("7 driftedArtifacts names the drifted key", final["driftedArtifacts"] == [drifted_key])
    check("7 finalPlanHash survives an untouched plan", final["finalPlanHash"] == bundle["artifacts"]["plan"]["hash"])
    check("7 byKey exposes the drifted record", outcome["byKey"][drifted_key]["match"] is False)


# ── run ──────────────────────────────────────────────────────────────────────


def main() -> int:
    try:
        case_symlink()
        case_swap_mid_read()
        case_escapes_root()
        case_non_regular()
        case_hash_drift()
        case_metadata_only_drift()
        case_finalize()
    finally:
        for path in _TEMP_DIRS:
            shutil.rmtree(path, ignore_errors=True)

    for failure in FAILED:
        print(f"FAIL  {failure}")
    print(f"\nwriting-artifact-authenticator: {len(PASSED)} passed, {len(FAILED)} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
