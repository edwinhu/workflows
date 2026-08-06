#!/usr/bin/env -S uv run python3
"""Deterministic mechanical floor for a draft against its authenticated receipt-selected generated plan.

The probe checks citation resolution, unresolved citation markers, claim traces, and
numeric consistency against the canonical plan. It never reads PRECIS.md or
OUTLINE.md and never upgrades its advisory numeric check into dataset provenance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from writing_section_index import _frontmatter, _read_regular_bytes, build_index

_BIBKEY_DEF = re.compile(r"@\w+\s*\{\s*([^,\s]+)", re.MULTILINE)
_EXTRA_CITES = re.compile(r"@([A-Za-z][\w:-]+)")
_CITE_NEEDED = re.compile(r"\[CITE-NEEDED[^\]]*\]", re.IGNORECASE)
_CLAIM = re.compile(r"CLAIM-\d+")
_STAT = re.compile(
    r"(?<![\w.])(?:\$?\d[\d,]*(?:\.\d+)?\s*(?:%|billion|million|thousand|bn|mn|B|M)?"
    r"(?![A-Za-z])|n\s*=\s*\d[\d,]*)",
    re.IGNORECASE,
)
_LEGAL_CTX = re.compile(r"(§|U\.?S\.?C\.?|C\.?F\.?R\.?|Rule|DGCL|No\.|art\.|§§)\s*$", re.IGNORECASE)
_SPELLED = re.compile(
    r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)"
    r"[\w-]*\s+(percent|petitions?|deals?|days?|cases?|funds?)\b",
    re.IGNORECASE,
)


def _draft_cites(text: str) -> set[str]:
    keys: set[str] = set()
    for group in re.findall(r"\[([^\]]*@[^\]]+)\]", text):
        keys.update(_EXTRA_CITES.findall(group))
    return keys


def _line_of(text: str, needle: str) -> int:
    index = text.find(needle)
    return text.count("\n", 0, index) + 1 if index >= 0 else 0


def _norm_num(value: str) -> str:
    value = re.sub(r"[\s,]", "", value).lower().rstrip(".")
    for long, short in (
        ("billion", "b"),
        ("million", "m"),
        ("thousand", "k"),
        ("bn", "b"),
        ("mn", "m"),
    ):
        value = value.replace(long, short)
    return value


def probe(
    draft_path: Path,
    bib_path: Path | None,
    plan_path: Path,
    expected_plan_hash: str = "",
) -> dict:
    # Each consumed artifact is opened no-follow and identity-checked before and
    # after its read. Never authorize one pathname then consume another's bytes.
    index = build_index(plan_path)
    authentication_errors = list(index.violations)
    selected = next(
        (
            section
            for section in index.sections
            if Path(section.draft_file).absolute() == draft_path.absolute()
        ),
        None,
    )
    if index.plan_path and Path(index.plan_path).absolute() != plan_path.absolute():
        authentication_errors.append("supplied plan path differs from receipt-selected plan_file")
    if selected is None:
        authentication_errors.append("supplied draft path is not a receipt-authenticated Section Outputs draft path")
    if index.review_status != "APPROVED":
        authentication_errors.append("writing implementation requires APPROVED combined review state")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_plan_hash):
        authentication_errors.append("--plan-hash must be a lowercase 64-hex authenticated plan hash")
    expected_bib = Path(index.bib_path).absolute() if index.bib_path else None
    if bib_path is None or expected_bib is None or bib_path.absolute() != expected_bib:
        authentication_errors.append("--bib must equal the exact receipt-authenticated Source Plan Bibliography path")

    root = Path(index.plan_path).parent.parent if index.plan_path else plan_path.parent.parent
    plan_bytes = b""
    text = ""
    bib_bytes = b""
    if not authentication_errors:
        try:
            plan_bytes = _read_regular_bytes(plan_path, root)
            text = _read_regular_bytes(draft_path, root).decode("utf-8")
            bib_bytes = _read_regular_bytes(bib_path, root)  # type: ignore[arg-type]
        except (OSError, UnicodeDecodeError):
            authentication_errors.append("plan, draft, and exact Source Plan bibliography must be stable project-contained regular non-symlink files")
    plan_hash = hashlib.sha256(plan_bytes).hexdigest() if plan_bytes else ""
    if authentication_errors:
        return {
            "section": draft_path.stem,
            "pass": False,
            "artifactsPresent": bool(plan_bytes and text and bib_bytes),
            "planHash": plan_hash,
            "evidence": {"planAuthentication": authentication_errors},
            "scope": {"checked": ["plan-authentication"], "notChecked": []},
            "citesChecked": 0,
            "claims": [],
        }
    plan_text = plan_bytes.decode("utf-8")
    if expected_plan_hash != plan_hash:
        return {
            "section": draft_path.stem,
            "pass": False,
            "artifactsPresent": draft_path.is_file() and plan_path.is_file(),
            "planHash": plan_hash,
            "evidence": {
                "planHashMismatch": [
                    f"expected {expected_plan_hash}, observed {plan_hash} for {plan_path}"
                ]
            },
            "scope": {"checked": ["plan-hash"], "notChecked": []},
            "citesChecked": 0,
            "claims": [],
        }

    evidence: dict = {}
    bib = set(_BIBKEY_DEF.findall(bib_bytes.decode("utf-8", errors="ignore")))
    cited = _draft_cites(text)
    unresolved = sorted(key for key in cited if key not in bib)
    if unresolved:
        evidence["bibUnresolved"] = [
            f"@{key} @ {draft_path.name}:{_line_of(text, '@' + key)}"
            for key in unresolved
        ]

    needed = _CITE_NEEDED.findall(text)
    if needed:
        evidence["citeNeeded"] = [
            f"{marker} @ {draft_path.name}:{_line_of(text, marker)}" for marker in needed
        ]

    # `selected` was identity-authorized before snapshot consumption above.
    expected_claims = selected.primary_claims  # type: ignore[union-attr]
    implements, artifact_hash, frontmatter_errors = _frontmatter(text)
    if frontmatter_errors or implements != expected_claims or artifact_hash != plan_hash:
        evidence["implementsMismatch"] = [
            f"expected implements {expected_claims!r} and plan_hash {plan_hash}; observed {implements!r} and {artifact_hash or 'missing'}",
            *frontmatter_errors,
        ]
    claims = sorted(set(_CLAIM.findall(text)))
    plan_claims = sorted(set(_CLAIM.findall(plan_text)))
    if expected_claims and not claims:
        evidence["claimIdsMissing"] = [f"{draft_path.name}: no CLAIM-NN / implements trace"]
    unknown_claims = sorted(set(claims) - set(plan_claims))
    if unknown_claims:
        evidence["claimsNotInPlan"] = unknown_claims

    plan_numbers = {_norm_num(match) for match in _STAT.findall(plan_text)}
    rich: list[tuple[str, int]] = []
    for match in _STAT.finditer(text):
        token = match.group(0)
        if not re.search(r"[%$]|n\s*=|B\b|M\b", token, re.IGNORECASE):
            continue
        if _LEGAL_CTX.search(text[max(0, match.start() - 12) : match.start()]):
            continue
        rich.append((token, text.count("\n", 0, match.start()) + 1))
    unmatched = [
        f"{token} @ {draft_path.name}:{line}"
        for token, line in rich
        if _norm_num(token) not in plan_numbers
    ]
    evidence["dataProvenance"] = {
        "mode": "consistency-only",
        "comparedAgainst": str(plan_path),
        "unmatchedVsPlan": unmatched,
        "spelledOutNotChecked": sorted({match.group(0) for match in _SPELLED.finditer(text)}),
        "note": "Numeric consistency against authenticated receipt-selected generated plan only; this does not verify dataset provenance or spelled-out quantities.",
    }

    floor_fail = bool(
        evidence.get("bibUnresolved")
        or evidence.get("citeNeeded")
        or evidence.get("claimIdsMissing")
        or evidence.get("claimsNotInPlan")
        or evidence.get("draftNotSelected")
        or evidence.get("implementsMismatch")
    )
    return {
        "section": draft_path.stem,
        "pass": not floor_fail,
        "artifactsPresent": draft_path.is_file() and plan_path.is_file(),
        "planHash": plan_hash,
        "evidence": evidence,
        "scope": {
            "checked": [
                "plan-hash",
                "bib-resolution",
                "cite-needed-markers",
                "claim-id-trace-vs-PLAN",
                "numeric-consistency-vs-PLAN (NOT dataset provenance)",
            ],
            "notChecked": [
                "quote-in-source fidelity (→ source-verify)",
                "claim-actually-supported-by-source (→ writing-verify/source-verify)",
                "coverage / prose-quality / transitions / thesis (→ writing-verify)",
                "spelled-out quantities",
                "dataset provenance (number→cell)",
            ],
        },
        "citesChecked": len(cited),
        "claims": claims,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("draft")
    parser.add_argument("--bib", default="")
    parser.add_argument("--plan", required=True)
    parser.add_argument("--plan-hash", required=True)
    args = parser.parse_args()
    result = probe(
        Path(args.draft),
        Path(args.bib) if args.bib else None,
        Path(args.plan),
        args.plan_hash,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
