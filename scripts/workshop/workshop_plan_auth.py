#!/usr/bin/env python3
"""Authenticate the workshop receipt + receipt-selected generated plan.

ONE authenticator for both workshop orchestrators. `workflows/workshop-generate.js`
and `workflows/workshop-verify.js` each carried a near-identical
`parseStrictReceipt` + `authenticatePlan` pair that opened `.planning/.state/review.json`
and the selected plan with `node:fs` and hashed them with `node:crypto`. Workflow
scripts are pure control flow — the runtime rejects `import()`, `import.meta`,
`process`, and `Buffer` — so neither script ever executed: both threw at the
import line before dispatching a single agent.

The file opening and hashing move here; every check that is pure data comparison
stays in the workflows, which now re-run the strict receipt parse over the
authenticated bytes (`artifacts.receipt.text`) rather than trusting a verdict
handed to them. Authentication is deliberately NOT delegated to an agent: the
slide index already comes from a parser the workflow re-checks, and asking a
dispatched agent to vouch for its own inputs is not authentication.

Usage:
    workshop_plan_auth.py --authenticate /abs/project [--plan-hash <hex64>]
    workshop_plan_auth.py --verify <bundle.json> [--findings <result.json>]
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from artifact_snapshot import (
    ArtifactAuthError,
    reject_symlinks,
    snapshot_artifact,
    verify_bundle,
)

# The strict receipt schema — byte-for-byte the same constraint set the JS
# `authenticatePlan` enforced. Every element of it is load-bearing; see the
# per-check comments in `authenticate()`.
RECEIPT_KEYS = (
    "workflow",
    "plan_file",
    "plan_hash",
    "approved_session_id",
    "approved_at",
    "status",
    "reviewer_session_id",
    "reviewed_at",
)
RESERVED_PLAN_FILES = frozenset(
    {
        "PLAN.md",
        "PLAN_REVIEWED.md",
        "REVIEW.md",
        "AUTOMATED_REVIEW.md",
        "HUMAN_REVIEW.md",
        "IMPLEMENT_COMPLETE.md",
        "VALIDATION.md",
    }
)
HEX64 = re.compile(r"^[0-9a-f]{64}$")
UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
SAFE_PLAN_FILE = re.compile(r"^[^./\\][^/\\]*\.md$")


def _reject_constant(token: str):
    raise ValueError(f"review.json values must be strings, got {token}")


def parse_strict_receipt(content: str) -> dict:
    """Parse review.json as a flat object of string values, or raise.

    Mirrors the hand-rolled JS `parseStrictReceipt`: exactly one top-level object,
    no duplicate fields, every value a string (so a nested object, array, number,
    boolean, or null is rejected rather than coerced), and no trailing content.
    """

    def pairs_hook(pairs):
        seen = {}
        for key, value in pairs:
            if key in seen:
                raise ValueError("review.json contains duplicate fields")
            if not isinstance(value, str):
                raise ValueError("review.json values must be strings")  # noqa: TRY004
            seen[key] = value
        return seen

    parsed = json.loads(
        content.strip(),
        object_pairs_hook=pairs_hook,
        parse_constant=_reject_constant,
    )
    if not isinstance(parsed, dict):
        raise ValueError("review.json must be one object")  # noqa: TRY004
    return parsed


def strict_utc(value: str) -> datetime:
    """Accept only a millisecond-precision UTC stamp that round-trips exactly.

    The JS test was `UTC.test(v) && new Date(Date.parse(v)).toISOString() === v`,
    which rejects rollover (2026-02-31 -> March) as well as malformed shapes.
    `strptime` raises on the same rollover, and the re-format compares the
    canonical rendering back against the input.
    """
    if not isinstance(value, str) or not UTC.match(value):
        raise ValueError(f"not a strict millisecond UTC timestamp: {value!r}")
    parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    if parsed.strftime("%Y-%m-%dT%H:%M:%S.") + f"{parsed.microsecond // 1000:03d}Z" != value:
        raise ValueError(f"timestamp does not round-trip: {value!r}")
    return parsed


def authenticate(project_dir: Path, expected_plan_hash: str = "") -> dict:
    """Snapshot + authenticate the receipt and the receipt-selected generated plan.

    Returns the bundle the workflows consume through `args`. Every violation is
    fatal: the bundle carries `ok: false` and a non-empty `violations` list, and
    the caller must not dispatch.
    """
    bundle: dict = {
        "ok": False,
        "violations": [],
        "projectDir": str(project_dir.absolute()),
        "projectReal": "",
        "planPath": "",
        "planHash": "",
        "artifacts": {},
    }
    try:
        root_real = project_dir.resolve(strict=True)
    except OSError as error:
        bundle["violations"].append(f"projectDir does not resolve: {error}")
        return bundle
    bundle["projectReal"] = str(root_real)

    planning = root_real / ".planning"
    state_dir = planning / ".state"
    receipt_path = state_dir / "review.json"
    # The snapshot below is O_NOFOLLOW, which covers review.json's own final
    # component. These lstat checks cover the containing chain a leaf snapshot
    # cannot speak to — a symlinked `.planning` or `.planning/.state` would
    # otherwise redirect the whole authentication to an attacker-chosen tree.
    try:
        reject_symlinks([planning, state_dir, receipt_path], "workshop generated-plan authentication")
        receipt_snapshot = snapshot_artifact(receipt_path, root_real)
    except ArtifactAuthError as error:
        bundle["violations"].append(f"receipt: {error}")
        return bundle
    bundle["artifacts"]["receipt"] = receipt_snapshot

    try:
        receipt = parse_strict_receipt(receipt_snapshot["text"])
    except (ValueError, json.JSONDecodeError) as error:
        bundle["violations"].append(f"receipt: invalid strict receipt JSON ({error})")
        return bundle

    violations = bundle["violations"]
    if set(receipt) != set(RECEIPT_KEYS) or len(receipt) != len(RECEIPT_KEYS):
        violations.append(
            "receipt: review.json must carry exactly the eight strict receipt keys, "
            f"got {sorted(receipt)}"
        )
        return bundle
    if receipt["workflow"] != "workshop":
        violations.append(f"receipt: workflow must be \"workshop\", got {receipt['workflow']!r}")
    if receipt["status"] != "APPROVED":
        violations.append(f"receipt: status must be \"APPROVED\", got {receipt['status']!r}")
    if not HEX64.match(receipt["plan_hash"]):
        violations.append("receipt: plan_hash must be a lowercase hex sha256")
    if not receipt["approved_session_id"].strip() or not receipt["reviewer_session_id"].strip():
        violations.append("receipt: approved_session_id and reviewer_session_id must be non-empty")
    elif receipt["approved_session_id"] == receipt["reviewer_session_id"]:
        # NO SELF-REVIEW: the session that approved the plan cannot be the session
        # that reviewed it.
        violations.append("receipt: approved_session_id and reviewer_session_id must differ")
    try:
        approved_at = strict_utc(receipt["approved_at"])
        reviewed_at = strict_utc(receipt["reviewed_at"])
        if reviewed_at <= approved_at:
            violations.append("receipt: reviewed_at must be strictly after approved_at")
    except ValueError as error:
        violations.append(f"receipt: {error}")
    plan_file = receipt["plan_file"]
    # Safe direct child of .planning: no leading dot, no traversal, no separator,
    # and never one of the retired fixed planning-authority filenames.
    if not SAFE_PLAN_FILE.match(plan_file) or plan_file in RESERVED_PLAN_FILES:
        violations.append(f"receipt: plan_file is not a safe non-reserved direct child: {plan_file!r}")
        return bundle
    if violations:
        return bundle

    plan_path = planning / plan_file
    try:
        reject_symlinks([plan_path], "workshop generated-plan authentication")
        plan_snapshot = snapshot_artifact(plan_path, root_real)
    except ArtifactAuthError as error:
        violations.append(f"plan: {error}")
        return bundle
    bundle["artifacts"]["plan"] = plan_snapshot
    bundle["planPath"] = plan_snapshot["path"]
    bundle["planHash"] = plan_snapshot["hash"]

    if plan_snapshot["hash"] != receipt["plan_hash"]:
        violations.append("plan: current bytes do not hash to the receipt plan_hash")
    if expected_plan_hash and plan_snapshot["hash"] != expected_plan_hash:
        violations.append("plan: current bytes do not hash to the caller's expected planHash")
    bundle["ok"] = not violations
    return bundle


def finalize(bundle: dict, result: dict) -> dict:
    """Apply drift verdicts to a workflow return value.

    The workflow cannot re-stat anything, so the entry hashes it returns are
    provisional. Drift can only ever make the gate worse: an artifact that moved
    under the agents earns a critical `artifact-integrity` finding and forces the
    gate false. `finalPlanHash` keeps the meaning it had when the orchestrator
    computed it in-process — the snapshot hash if the plan held still, the empty
    string if it did not.
    """
    report = verify_bundle(bundle)
    drifted = set(report["drifted"])
    artifacts = bundle.get("artifacts") or {}
    integrity: list[dict] = []
    for key, label in (
        ("plan", "Authenticated generated plan"),
        ("receipt", "Combined review receipt"),
    ):
        if key in drifted:
            integrity.append(
                {
                    "severity": "critical",
                    "area": "artifact-integrity",
                    "section": "deck",
                    "planHash": bundle.get("planHash", ""),
                    "detail": f"{label} path, identity, metadata, or bytes changed during asynchronous work.",
                    "location": (artifacts.get(key) or {}).get("path", ""),
                    "retryKey": f"deck:artifact-integrity:{key}",
                }
            )
    result["findings"] = integrity + list(result.get("findings") or [])
    result["finalPlanHash"] = "" if "plan" in drifted else (artifacts.get("plan") or {}).get("hash", "")
    result["artifactVerification"] = report["artifacts"]
    result["driftedArtifacts"] = report["drifted"]
    result["driftVerified"] = True
    result["verifyRequired"] = False
    if drifted:
        result["overallPass"] = False
        if "substratePass" in result:
            result["substratePass"] = False
        result["verdict"] = "ISSUES FOUND (artifact drift)"
        summary = result.get("summary")
        if isinstance(summary, dict):
            summary["critical"] = int(summary.get("critical", 0)) + len(integrity)
            summary["total"] = int(summary.get("total", 0)) + len(integrity)
            if "blocking" in summary:
                summary["blocking"] = int(summary.get("blocking", 0)) + len(integrity)
            result["summary"] = summary
    return {"verification": report, "result": result}


USAGE = (
    "usage: workshop_plan_auth.py --authenticate /abs/project [--plan-hash <hex64>]\n"
    "       workshop_plan_auth.py --verify <bundle.json> [--findings <result.json>]"
)


def main() -> int:
    argv = sys.argv[1:]
    if len(argv) >= 2 and argv[0] == "--authenticate":
        expected_hash = ""
        rest = argv[2:]
        if rest:
            if len(rest) != 2 or rest[0] != "--plan-hash":
                print(USAGE, file=sys.stderr)
                return 2
            expected_hash = rest[1]
        bundle = authenticate(Path(argv[1]), expected_hash)
        print(json.dumps(bundle, indent=2, ensure_ascii=False))
        return 0 if bundle["ok"] else 1
    if len(argv) >= 2 and argv[0] == "--verify":
        bundle = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        if len(argv) == 4 and argv[2] == "--findings":
            outcome = finalize(bundle, json.loads(Path(argv[3]).read_text(encoding="utf-8")))
            print(json.dumps(outcome["result"], indent=2, ensure_ascii=False))
            return 0 if outcome["verification"]["ok"] else 1
        if len(argv) != 2:
            print(USAGE, file=sys.stderr)
            return 2
        report = verify_bundle(bundle)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if report["ok"] else 1
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
