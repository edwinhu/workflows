#!/usr/bin/env -S uv run python3
"""Derive the writing workflow's on-disk approval artifacts from craft's approvals.

`writing_section_index.py` refuses to parse anything without a well-formed
`<proj>/.planning/.state/review.json`, and `check-all.py` scopes itself from
`<proj>/.planning/ACTIVE_WORKFLOW.md` — with no such file `_applies` returns True
unconditionally and every `ds-*`/`dev-*`/`typst-*` hard constraint runs on a writing
project. This shim writes both.

It is an ADAPTER, never a second authority. Every field is mapped from an approval
craft already carries:

  plan_file / plan_hash                  ← craft's planPath / planHash
  approved_session_id / approved_at      ← the user's ExitPlanMode approval
  reviewer_session_id / reviewed_at      ← the craft RUN that authorizes implementation
                                           (its run id and dispatch time)

What this receipt does NOT assert: a second human review. It satisfies the parser's
two-distinct-approvals schema, nothing more. The genuine independent review in a
craft-native flow is the per-task verifier plus the review lenses — they run DOWNSTREAM
of this file and gate the result, so they cannot be encoded in something that must exist
before they run. An earlier draft mapped this field to craft's plan-lens review, which
does not exist at this point (plan lenses run inside the dispatch, after the shim) and may
not exist at all (a run may drop them).

The plan is never copied: a writing project sets `plansDirectory` to `./.planning`,
so craft's approved plan already IS the generated plan the parser authenticates.

CLI:
  writing_receipt.py --project <proj> --plan <planPath> --plan-hash <hash>
                     --approved-session <id> --reviewer-session <id>
                     --domain <legal|econ|general>
                     [--approved-at <utc>] [--reviewed-at <utc>]

Exit 0 on success, 1 on a named refusal, 2 on usage error. It refuses rather than
emit a receipt the parser would reject.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

DOMAINS = ("legal", "econ", "general")

# Mirrors writing_section_index.py's own validators; a receipt this shim accepts and
# the parser then rejects is the failure mode the whole script exists to prevent.
_HASH_RE = re.compile(r"[0-9a-f]{64}")
_GENERATED_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\.md")
_UTC_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")
_PLAN_DOMAIN_RE = re.compile(
    r"(?m)^\s*(?:[-*]\s*)?(?:\*\*)?Domain(?:\*\*)?\s*:\s*(\S+)\s*$", re.IGNORECASE
)

RECEIPT_FIELDS = (
    "workflow",
    "plan_file",
    "plan_hash",
    "approved_session_id",
    "approved_at",
    "status",
    "reviewer_session_id",
    "reviewed_at",
)


class ReceiptRefusal(Exception):
    """The inputs cannot produce a receipt the vendored parser would accept."""


def utc_stamp(moment: datetime) -> str:
    """Strict UTC form the parser's `_strict_utc` accepts: millisecond precision, Z."""
    moment = moment.astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def parse_utc(value: str, label: str) -> datetime:
    if not isinstance(value, str) or not _UTC_RE.fullmatch(value):
        raise ReceiptRefusal(
            f"{label} must be a strict UTC timestamp of the form 2026-08-10T14:03:07.000Z; got {value!r}."
        )
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ReceiptRefusal(f"{label} is not a real instant: {value!r} ({error}).") from error


def _plan_basename(project: Path, plan: Path) -> str:
    planning = project / ".planning"
    if not project.is_dir():
        raise ReceiptRefusal(f"--project is not a directory: {project}.")
    if not planning.is_dir():
        raise ReceiptRefusal(
            f"--project has no .planning/ directory: {planning}. A writing project sets craft's "
            "plansDirectory to ./.planning so the approved plan lands there."
        )
    try:
        plan_real = plan.resolve(strict=True)
    except OSError as error:
        raise ReceiptRefusal(f"--plan does not resolve to an existing file: {plan} ({error}).") from error
    if not plan_real.is_file():
        raise ReceiptRefusal(f"--plan is not a regular file: {plan}.")
    if plan_real.parent != planning.resolve():
        raise ReceiptRefusal(
            f"--plan must be a direct child of {planning}; got {plan_real}. The plan is never copied — "
            "point craft's plansDirectory at ./.planning instead."
        )
    name = plan_real.name
    if name == "PLAN.md":
        raise ReceiptRefusal(
            "--plan basename PLAN.md is rejected by writing_section_index.py as retired legacy planning input."
        )
    if (
        not _GENERATED_NAME_RE.fullmatch(name)
        or PurePosixPath(name).name != name
        or "\\" in name
    ):
        raise ReceiptRefusal(
            f"--plan basename {name!r} is not a safe generated direct-child Markdown basename."
        )
    return name


def _plan_domain(plan: Path) -> str | None:
    try:
        text = plan.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    match = _PLAN_DOMAIN_RE.search(text)
    return match.group(1).strip().lower() if match else None


def build_receipt(
    *,
    project: Path,
    plan: Path,
    plan_hash: str,
    approved_session: str,
    reviewer_session: str,
    domain: str,
    approved_at: str | None = None,
    reviewed_at: str | None = None,
) -> tuple[dict, str]:
    """Return (receipt, style) or raise ReceiptRefusal naming the reason."""
    if domain not in DOMAINS:
        raise ReceiptRefusal(f"--domain must be one of {', '.join(DOMAINS)}; got {domain!r}.")

    plan_file = _plan_basename(project, plan)

    if not isinstance(plan_hash, str) or not _HASH_RE.fullmatch(plan_hash):
        raise ReceiptRefusal(f"--plan-hash must be a lowercase 64-hex SHA-256; got {plan_hash!r}.")
    actual = hashlib.sha256(plan.resolve().read_bytes()).hexdigest()
    if actual != plan_hash:
        raise ReceiptRefusal(
            f"--plan-hash does not match the bytes of {plan_file}: expected {actual}, got {plan_hash}."
        )

    if not approved_session.strip():
        raise ReceiptRefusal("--approved-session must be non-empty.")
    if not reviewer_session.strip():
        raise ReceiptRefusal("--reviewer-session must be non-empty.")
    if approved_session == reviewer_session:
        raise ReceiptRefusal(
            "--approved-session and --reviewer-session must differ: the receipt records two distinct "
            "craft approvals (the user's plan approval and the craft run that authorizes implementation)."
        )

    plan_domain = _plan_domain(plan)
    if plan_domain is not None and plan_domain != domain:
        raise ReceiptRefusal(
            f"--domain {domain!r} contradicts the plan's `Domain: {plan_domain}`; the style written to "
            "ACTIVE_WORKFLOW.md must be the plan's own value or check-all runs the wrong domain's constraints."
        )

    now = datetime.now(timezone.utc)
    approved_text = approved_at if approved_at is not None else utc_stamp(now)
    approved_dt = parse_utc(approved_text, "--approved-at")
    reviewed_text = (
        reviewed_at
        if reviewed_at is not None
        else utc_stamp(approved_dt + timedelta(milliseconds=1))
    )
    reviewed_dt = parse_utc(reviewed_text, "--reviewed-at")
    if reviewed_dt <= approved_dt:
        raise ReceiptRefusal(
            f"--reviewed-at {reviewed_text} must be strictly later than --approved-at {approved_text}: "
            "the authorizing craft run is dispatched after the user's approval."
        )

    receipt = {
        "workflow": "writing",
        "plan_file": plan_file,
        "plan_hash": plan_hash,
        "approved_session_id": approved_session,
        "approved_at": approved_text,
        "status": "APPROVED",
        "reviewer_session_id": reviewer_session,
        "reviewed_at": reviewed_text,
    }
    assert tuple(receipt) == RECEIPT_FIELDS
    return receipt, domain


def active_workflow_text(style: str) -> str:
    return f"---\nworkflow: writing\nstyle: {style}\n---\n\nScoping marker for check-all.py — written by writing_receipt.py from craft's approved plan.\n"


def write_artifacts(project: Path, receipt: dict, style: str) -> tuple[Path, Path]:
    planning = project / ".planning"
    state = planning / ".state"
    state.mkdir(parents=True, exist_ok=True)
    receipt_path = state / "review.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    active_path = planning / "ACTIVE_WORKFLOW.md"
    active_path.write_text(active_workflow_text(style), encoding="utf-8")
    return receipt_path, active_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="writing_receipt.py",
        description="Derive .planning/.state/review.json and .planning/ACTIVE_WORKFLOW.md from craft's approvals.",
    )
    parser.add_argument("--project", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--plan-hash", required=True)
    parser.add_argument("--approved-session", required=True)
    parser.add_argument("--reviewer-session", required=True)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--approved-at", default=None)
    parser.add_argument("--reviewed-at", default=None)
    args = parser.parse_args(argv)

    project = Path(args.project).absolute()
    try:
        receipt, style = build_receipt(
            project=project,
            plan=Path(args.plan).absolute(),
            plan_hash=args.plan_hash,
            approved_session=args.approved_session,
            reviewer_session=args.reviewer_session,
            domain=args.domain,
            approved_at=args.approved_at,
            reviewed_at=args.reviewed_at,
        )
    except ReceiptRefusal as error:
        print(f"writing_receipt.py refuses: {error}", file=sys.stderr)
        return 1
    receipt_path, active_path = write_artifacts(project, receipt, style)
    print(json.dumps({"receipt": str(receipt_path), "activeWorkflow": str(active_path), **receipt}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
