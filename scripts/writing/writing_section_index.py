#!/usr/bin/env -S uv run python3
"""Compile an authenticated generated writing plan into a deterministic index.

The native generated file selected by ``.planning/.state/review.json`` is the
sole modern writing specification. Retired planning Markdown is detected only
as conversion input or provenance and is never read for canonical values.

CLI: python3 writing_section_index.py /abs/project[/|/.planning|/.planning/<generated>.md]
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath

REQUIRED_SECTIONS = (
    "Writing Intent",
    "Claims",
    "Counterarguments",
    "Document Structure",
    "Claim → Section Map",
    "Source Plan",
    "Section Outputs",
    "Review Surfaces",
)
LEGACY_FILES = ("PLAN.md", "PRECIS.md", "OUTLINE.md", "ACTIVE_WORKFLOW.md")
REVIEW_FIELDS = {
    "workflow",
    "plan_file",
    "plan_hash",
    "approved_session_id",
    "approved_at",
    "status",
    "reviewer_session_id",
    "reviewed_at",
}
_HASH_RE = re.compile(r"[0-9a-f]{64}")
_GENERATED_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\.md")
_CLAIM_RE = re.compile(r"\bCLAIM-([0-9]{2})\b")
_CLAIM_LIKE_RE = re.compile(r"\bCLAIM-([0-9]+)\b", re.IGNORECASE)
_CLAIM_DEFINITION_RE = re.compile(
    r"(?m)^\s*[-*]\s+(?:\*\*)?(CLAIM-[0-9]{2})(?:\*\*)?\s*:\s*\S"
)
_CITEKEY_RE = re.compile(r"@([A-Za-z][\w:-]+)")
_PLACEHOLDER_RE = re.compile(
    r"\b(TBA|TBD|develop this|to be (written|drafted)|\d+\s*pgs?)\b",
    re.IGNORECASE,
)


def _canon_claim(num: str) -> str:
    return f"CLAIM-{int(num):02d}"


def claims_in(text: str) -> set[str]:
    return {_canon_claim(match.group(1)) for match in _CLAIM_RE.finditer(text)}


def section_slug(name: str) -> str:
    value = unicodedata.normalize("NFC", name).strip()
    value = re.sub(r"\s*\((Outline|Draft)\)\s*$", "", value, flags=re.IGNORECASE)
    return re.sub(r"[^\w]+", "-", value, flags=re.UNICODE).strip("-")


@dataclass
class Section:
    name: str
    order: int
    outline_file: str
    draft_file: str
    primary_claims: list[str]
    implements: list[str]
    dependencies: list[str]
    sources_pinned: bool
    granular: bool
    granularity_note: str
    prev_name: str
    next_name: str
    claim_ok: bool
    outline_current: bool
    draft_current: bool
    outline_issues: list[str]
    draft_issues: list[str]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "order": self.order,
            "outlineFile": self.outline_file,
            "draftFile": self.draft_file,
            "primaryClaims": self.primary_claims,
            "implements": self.implements,
            "dependencies": self.dependencies,
            "sourcesPinned": self.sources_pinned,
            "granular": self.granular,
            "granularityNote": self.granularity_note,
            "prevName": self.prev_name,
            "nextName": self.next_name,
            "claimOk": self.claim_ok,
            "outlineCurrent": self.outline_current,
            "draftCurrent": self.draft_current,
            "outlineIssues": self.outline_issues,
            "draftIssues": self.draft_issues,
        }


@dataclass
class IndexResult:
    sections: list[Section] = field(default_factory=list)
    style: str = "unspecified"
    plan_file: str = ""
    plan_path: str = ""
    plan_hash: str = ""
    review_status: str = ""
    precis_path: str = ""
    outline_path: str = ""
    bib_path: str = ""
    source_plan: dict[str, str] = field(default_factory=dict)
    review_surfaces: list[str] = field(default_factory=list)
    layout: str = "missing"
    conversion_required: bool = False
    legacy_paths: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    stale_approval: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations and bool(self.sections) and bool(self.plan_hash)

    def _semantics(self) -> dict:
        return {
            "planFile": self.plan_file,
            "planHash": self.plan_hash,
            "style": self.style,
            "bibPath": self.bib_path,
            "sourcePlan": self.source_plan,
            "reviewSurfaces": self.review_surfaces,
            "sections": [
                {
                    "name": section.name,
                    "order": section.order,
                    "outlineFile": section.outline_file,
                    "draftFile": section.draft_file,
                    "primaryClaims": section.primary_claims,
                    "dependencies": section.dependencies,
                    "prevName": section.prev_name,
                    "nextName": section.next_name,
                }
                for section in self.sections
            ],
        }

    def to_dict(self) -> dict:
        semantics = self._semantics()
        semantic_hash = hashlib.sha256(
            json.dumps(semantics, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
        return {
            "style": self.style,
            "ok": self.ok,
            "planFile": self.plan_file,
            "planPath": self.plan_path,
            "planHash": self.plan_hash,
            "reviewStatus": self.review_status,
            "precisPath": self.precis_path,
            "outlinePath": self.outline_path,
            "bibPath": self.bib_path,
            "sourcePlan": self.source_plan,
            "reviewSurfaces": self.review_surfaces,
            "layout": self.layout,
            "conversionRequired": self.conversion_required,
            "legacyPaths": self.legacy_paths,
            "violations": self.violations,
            "artifactViolations": [
                issue
                for section in self.sections
                for issue in [*section.outline_issues, *section.draft_issues]
            ],
            "staleApproval": self.stale_approval,
            "sections": [section.to_dict() for section in self.sections],
            "integrity": {
                "schemaVersion": 1,
                "compiler": "writing-section-index",
                "semanticHash": semantic_hash,
                "semantics": semantics,
            },
        }


def _locations(arg: Path) -> tuple[Path, Path, Path | None]:
    candidate = arg.absolute()
    if candidate.suffix.lower() == ".md":
        planning = candidate.parent
        return planning.parent, planning, candidate
    if candidate.name == ".planning":
        return candidate.parent, candidate, None
    if (candidate / ".planning").is_dir():
        return candidate, candidate / ".planning", None
    return candidate.parent, candidate, None


def _same_state(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
        and left.st_size == right.st_size
        and left.st_mtime_ns == right.st_mtime_ns
        and left.st_ctime_ns == right.st_ctime_ns
    )


def _read_regular_bytes(path: Path, root: Path) -> bytes:
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
        if stat.S_ISLNK(before_path.st_mode) or not _same_state(opened, before_path):
            raise OSError("path identity changed before read")
        chunks: list[bytes] = []
        while chunk := os.read(fd, 1024 * 1024):
            chunks.append(chunk)
        after_fd = os.fstat(fd)
        after_path = os.stat(path, follow_symlinks=False)
        if (
            stat.S_ISLNK(after_path.st_mode)
            or path.resolve(strict=True) != real
            or not _same_state(opened, after_fd)
            or not _same_state(opened, after_path)
        ):
            raise OSError("path changed during read")
        return b"".join(chunks)
    finally:
        os.close(fd)


def _read(path: Path, root: Path) -> str:
    try:
        return _read_regular_bytes(path, root).decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _strict_utc(value: object) -> bool:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value
    ):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _safe_generated_name(value: object) -> bool:
    return (
        isinstance(value, str)
        and value != "PLAN.md"
        and bool(_GENERATED_NAME_RE.fullmatch(value))
        and PurePosixPath(value).name == value
        and "\\" not in value
    )


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    value: dict[str, object] = {}
    for key, field in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON field: {key}")
        value[key] = field
    return value


def _load_receipt(planning: Path, result: IndexResult) -> dict | None:
    receipt_path = planning / ".state" / "review.json"
    try:
        receipt = json.loads(
            _read_regular_bytes(receipt_path, planning.parent).decode("utf-8"),
            object_pairs_hook=_unique_object,
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        result.violations.append(
            "Missing or malformed `.planning/.state/review.json`; native Plan approval must bind the exact generated writing plan first."
        )
        return None
    if not isinstance(receipt, dict) or set(receipt) != REVIEW_FIELDS:
        result.violations.append(
            "review.json must contain exactly workflow, plan_file, plan_hash, approved_session_id, approved_at, status, reviewer_session_id, and reviewed_at."
        )
        return None
    if receipt.get("workflow") != "writing":
        result.violations.append("review.json does not authenticate the writing workflow.")
    if not _safe_generated_name(receipt.get("plan_file")):
        result.violations.append(
            "review.json plan_file must be a safe generated direct-child Markdown basename and cannot be PLAN.md."
        )
    if not isinstance(receipt.get("plan_hash"), str) or not _HASH_RE.fullmatch(receipt["plan_hash"]):
        result.violations.append("review.json plan_hash must be lowercase 64-hex SHA-256.")
    if not isinstance(receipt.get("approved_session_id"), str) or not receipt["approved_session_id"].strip():
        result.violations.append("review.json approved_session_id must be non-empty.")
    if not _strict_utc(receipt.get("approved_at")):
        result.violations.append("review.json approved_at must be a strict UTC timestamp.")
    status = receipt.get("status")
    if status not in {"PENDING", "APPROVED", "ISSUES_FOUND"}:
        result.violations.append("review.json status must be PENDING, APPROVED, or ISSUES_FOUND.")
    reviewer = receipt.get("reviewer_session_id")
    reviewed_at = receipt.get("reviewed_at")
    if status == "PENDING":
        if reviewer != "" or reviewed_at != "":
            result.violations.append("PENDING review.json must leave reviewer_session_id and reviewed_at empty.")
    else:
        if not isinstance(reviewer, str) or not reviewer.strip() or not _strict_utc(reviewed_at):
            result.violations.append(
                "Final review.json must contain a non-empty reviewer_session_id and strict reviewed_at."
            )
        elif reviewer == receipt.get("approved_session_id"):
            result.violations.append("Plan approval and independent review sessions must differ.")
        elif _strict_utc(receipt.get("approved_at")) and datetime.fromisoformat(
            reviewed_at.replace("Z", "+00:00")
        ) <= datetime.fromisoformat(receipt["approved_at"].replace("Z", "+00:00")):
            result.violations.append("Independent review must be strictly later than native Plan approval.")
    return receipt if not result.violations else None


def _select_plan(
    root: Path, planning: Path, requested: Path | None, result: IndexResult
) -> tuple[Path | None, bytes]:
    result.legacy_paths = [
        str((planning / name).resolve())
        for name in LEGACY_FILES
        if (planning / name).is_file()
    ]
    receipt = _load_receipt(planning, result)
    if receipt is None:
        if result.legacy_paths:
            result.layout = "legacy-only"
            result.conversion_required = True
            result.violations.insert(
                0,
                "Legacy writing planning files are conversion input only; create a fresh native generated plan and combined hidden review receipt.",
            )
        return None, b""

    plan_file = f".planning/{receipt['plan_file']}"
    plan_path = planning / receipt["plan_file"]
    result.plan_file = plan_file
    result.plan_path = str(plan_path.absolute())
    result.review_status = receipt["status"]
    result.layout = "canonical-with-legacy-provenance" if result.legacy_paths else "canonical"

    if requested is not None and requested.absolute() != plan_path.absolute():
        result.violations.append(
            f"Requested plan `{requested}` does not match review.json plan_file `{plan_file}`."
        )
        return None, b""
    try:
        if plan_path.resolve(strict=True).parent != planning.resolve():
            raise OSError
        plan_bytes = _read_regular_bytes(plan_path, root)
        plan_bytes.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        result.violations.append(f"Cannot read authenticated generated plan `{plan_file}` as a regular UTF-8 file.")
        return None, b""
    actual = hashlib.sha256(plan_bytes).hexdigest()
    if actual != receipt["plan_hash"]:
        result.violations.append(
            f"Generated plan `{plan_file}` hash does not match `.planning/.state/review.json`."
        )
        return None, b""
    result.plan_hash = actual
    return plan_path, plan_bytes


def _extract_h2_sections(text: str) -> tuple[dict[str, str], list[str]]:
    headings: list[str] = []
    bodies: list[list[str]] = []
    current = -1
    for raw in text.splitlines():
        match = re.match(r"^##\s+(.+?)\s*$", raw)
        if match:
            headings.append(match.group(1).strip())
            bodies.append([])
            current += 1
        elif current >= 0:
            bodies[current].append(raw)
    expected = list(REQUIRED_SECTIONS)
    if headings != expected:
        return {}, [
            "Generated writing plan level-two headings must be exactly these eight sections in order: "
            + ", ".join(f"`## {heading}`" for heading in expected)
            + f". Observed: {headings!r}."
        ]
    blocks = {
        heading: "\n".join(body).strip()
        for heading, body in zip(headings, bodies, strict=True)
    }
    violations = [
        f"Generated writing plan section `## {heading}` is empty."
        for heading, body in blocks.items()
        if not body
    ]
    return blocks, violations


def _labeled_values(block: str, label: str, violations: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    pattern = re.compile(
        r"(?m)^\s*(?:[-*]\s*)?(?:\*\*)?([A-Za-z][A-Za-z /_-]*?)(?:\*\*)?\s*:\s*(.+?)\s*$"
    )
    for match in pattern.finditer(block):
        key = re.sub(r"\s+", " ", match.group(1).strip()).lower()
        if key in values:
            violations.append(f"{label} contains duplicate `{key.title()}:` labels.")
        else:
            values[key] = match.group(2).strip()
    return values


def _markdown_table(block: str, label: str) -> tuple[list[str], list[dict[str, str]], list[str]]:
    nonempty = [line.strip() for line in block.splitlines() if line.strip()]
    errors: list[str] = []
    if len(nonempty) < 3 or any(not line.startswith("|") or not line.endswith("|") for line in nonempty):
        return [], [], [f"{label} must contain only a leading-and-trailing-pipe Markdown table with at least one data row."]
    cells = [[cell.strip() for cell in line[1:-1].split("|")] for line in nonempty]
    width = len(cells[0])
    if width == 0 or any(len(row) != width for row in cells):
        errors.append(f"{label} contains a malformed row with the wrong number of cells.")
    if not all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells[1]):
        errors.append(f"{label} separator row is malformed.")
    headers = [re.sub(r"\s+", " ", cell).lower() for cell in cells[0]]
    if len(headers) != len(set(headers)):
        errors.append(f"{label} contains duplicate columns.")
    if errors:
        return [], [], errors
    rows = [dict(zip(headers, row, strict=True)) for row in cells[2:]]
    if any(any(value == "" for value in row.values()) for row in rows):
        errors.append(f"{label} contains an empty data cell.")
    return headers, rows, errors


def _structure_order(block: str) -> list[str]:
    return [match.group(1).strip() for match in re.finditer(r"(?m)^###\s+(.+?)\s*$", block)]


def _safe_relative(path_text: str) -> bool:
    path = PurePosixPath(path_text)
    return bool(path_text) and not path.is_absolute() and ".." not in path.parts and "\\" not in path_text


def _split_dependencies(value: str) -> list[str]:
    if not value or value.strip().lower() in {"-", "none", "n/a"}:
        return []
    return [piece.strip() for piece in re.split(r"\s*(?:,|;)\s*", value) if piece.strip()]


def _frontmatter(text: str) -> tuple[list[str], str, list[str]]:
    if not text.startswith("---\n"):
        return [], "", ["missing YAML frontmatter"]
    closing = re.search(r"^---$", text[4:], re.MULTILINE)
    if closing is None:
        return [], "", ["unterminated YAML frontmatter"]
    block = text[4 : 4 + closing.start()]
    errors: list[str] = []
    implements_matches = re.findall(r"(?m)^implements:\s*\[(.*?)\]\s*$", block)
    hash_matches = re.findall(r"(?m)^plan_hash:\s*([0-9a-f]{64})\s*$", block)
    if len(implements_matches) != 1:
        errors.append("frontmatter must contain exactly one `implements: [...]` field")
    if len(hash_matches) != 1:
        errors.append("frontmatter must contain exactly one lowercase 64-hex `plan_hash:` field")
    implements: list[str] = []
    if len(implements_matches) == 1:
        raw = implements_matches[0].strip()
        if raw:
            pieces = [piece.strip() for piece in raw.split(",")]
            if any(not re.fullmatch(r"CLAIM-[0-9]{2}", piece) for piece in pieces):
                errors.append("implements must contain only comma-separated exact CLAIM-NN identifiers")
            elif len(pieces) != len(set(pieces)):
                errors.append("implements must not contain duplicate claims")
            else:
                implements = pieces
    return implements, hash_matches[0] if len(hash_matches) == 1 else "", errors


def _granularity(outline_text: str) -> tuple[bool, str]:
    if not outline_text.strip():
        return False, "outline file missing or empty"
    placeholder = _PLACEHOLDER_RE.search(outline_text)
    if placeholder:
        return False, f"placeholder marker present: '{placeholder.group(0)}'"
    bullets = [
        line
        for line in outline_text.splitlines()
        if re.match(r"^\s*(?:[-*]|\d+\.)\s+\S", line)
    ]
    if len(bullets) < 3:
        return False, f"bare-headings: only {len(bullets)} bullet-level points"
    return True, ""


def build_index(project_or_planning: Path) -> IndexResult:
    root, planning, requested = _locations(project_or_planning)
    result = IndexResult()
    plan_path, plan_bytes = _select_plan(root, planning, requested, result)
    if plan_path is None:
        return result
    plan_text = plan_bytes.decode("utf-8")

    blocks, violations = _extract_h2_sections(plan_text)
    result.violations.extend(violations)
    if violations:
        return result

    intent = _labeled_values(blocks["Writing Intent"], "Writing Intent", result.violations)
    for field_name in ("thesis", "audience", "purpose", "hook", "scope", "domain"):
        if not intent.get(field_name):
            result.violations.append(f"Writing Intent is missing `{field_name.title()}:`.")
    result.style = intent.get("domain", "unspecified").lower()
    if result.style not in {"legal", "econ", "general"}:
        result.violations.append("Writing Intent `Domain:` must be legal, econ, or general.")

    noncanonical_claims = sorted(
        {
            match.group(0).upper()
            for match in _CLAIM_LIKE_RE.finditer(blocks["Claims"])
            if not re.fullmatch(r"CLAIM-[0-9]{2}", match.group(0))
        }
    )
    if noncanonical_claims:
        result.violations.append(
            "Claims contains noncanonical identifiers; use exact CLAIM-NN form: "
            + ", ".join(noncanonical_claims)
            + "."
        )
    claim_ids = [match.group(1) for match in _CLAIM_DEFINITION_RE.finditer(blocks["Claims"])]
    duplicates = sorted({claim for claim in claim_ids if claim_ids.count(claim) > 1})
    if not claim_ids:
        result.violations.append("Claims must define at least one stable claim as `- **CLAIM-NN**: ...`.")
    if duplicates:
        result.violations.append(f"Claims contains duplicate identifiers: {', '.join(duplicates)}.")
    claims = set(claim_ids)

    order = _structure_order(blocks["Document Structure"])
    if not order:
        result.violations.append("Document Structure must contain ordered `### Section Name` headings.")
    if len(order) != len(set(order)):
        result.violations.append("Document Structure contains duplicate section headings.")

    map_headers, map_rows, map_errors = _markdown_table(blocks["Claim → Section Map"], "Claim → Section Map")
    result.violations.extend(map_errors)
    claim_map: dict[str, str] = {}
    if map_headers != ["claim", "section"] or not map_rows:
        result.violations.append("Claim → Section Map must have exact `Claim` and `Section` columns.")
    else:
        for row in map_rows:
            row_claims = sorted(claims_in(row["claim"]))
            if len(row_claims) != 1 or row["claim"] != row_claims[0]:
                result.violations.append("Each Claim → Section Map row must name exactly one bare CLAIM-NN.")
                continue
            claim = row_claims[0]
            if claim in claim_map:
                result.violations.append(f"Claim → Section Map maps {claim} more than once.")
            claim_map[claim] = row["section"]
        missing = sorted(claims - set(claim_map))
        unknown = sorted(set(claim_map) - claims)
        if missing:
            result.violations.append(f"Claim → Section Map is missing: {', '.join(missing)}.")
        if unknown:
            result.violations.append(f"Claim → Section Map references undefined claims: {', '.join(unknown)}.")
        bad_sections = sorted({section for section in claim_map.values() if section not in order})
        if bad_sections:
            result.violations.append(f"Claim → Section Map references unknown sections: {', '.join(bad_sections)}.")

    source_plan = _labeled_values(blocks["Source Plan"], "Source Plan", result.violations)
    bibliography = source_plan.get("bibliography", "")
    bibliography_path = (root / bibliography).absolute() if bibliography else None
    bibliography_real = bibliography_path.resolve() if bibliography_path is not None else None
    if (
        not bibliography
        or not _safe_relative(bibliography)
        or bibliography_path is None
        or bibliography_real is None
        or not bibliography_real.is_relative_to(root.resolve())
    ):
        result.violations.append("Source Plan requires a traversal-free project-contained `Bibliography:` path.")
    for source_field in ("notebook", "notebook url", "key sources"):
        if not source_plan.get(source_field, ""):
            result.violations.append(
                f"Source Plan requires a non-empty `{source_field.title()}:` value; use `none` for an intentional absence."
            )
    result.source_plan = source_plan
    if bibliography_path is not None and bibliography_path.is_relative_to(root.resolve()):
        result.bib_path = str(bibliography_path)

    output_headers, output_rows, output_errors = _markdown_table(blocks["Section Outputs"], "Section Outputs")
    result.violations.extend(output_errors)
    output_by_section: dict[str, dict[str, str]] = {}
    if output_headers != ["section", "outline", "draft", "depends on"] or not output_rows:
        result.violations.append("Section Outputs must have exactly the Section, Outline, Draft, and Depends On columns.")
    else:
        if [row["section"] for row in output_rows] != order:
            result.violations.append("Section Outputs rows must appear in the same order as Document Structure.")
        for row in output_rows:
            name = row["section"]
            if name in output_by_section:
                result.violations.append(f"Section Outputs contains duplicate row `{name}`.")
            output_by_section[name] = row
        missing_outputs = [name for name in order if name not in output_by_section]
        extra_outputs = [name for name in output_by_section if name not in order]
        if missing_outputs:
            result.violations.append(f"Section Outputs is missing sections: {', '.join(missing_outputs)}.")
        if extra_outputs:
            result.violations.append(f"Section Outputs references unknown sections: {', '.join(extra_outputs)}.")

    result.review_surfaces = [
        match.group(1).strip()
        for match in re.finditer(r"(?m)^\s*[-*]\s+(\S.*?)\s*$", blocks["Review Surfaces"])
    ]
    if not result.review_surfaces:
        result.violations.append("Review Surfaces must contain at least one bullet.")

    order_index = {name: index for index, name in enumerate(order)}
    root_real = root.resolve()
    for index, name in enumerate(order):
        row = output_by_section.get(name)
        if row is None:
            continue
        outline_rel, draft_rel = row["outline"], row["draft"]
        if not _safe_relative(outline_rel) or not outline_rel.startswith("outlines/"):
            result.violations.append(f"Section `{name}` has invalid outline output `{outline_rel}`.")
        if not _safe_relative(draft_rel) or not draft_rel.startswith("drafts/"):
            result.violations.append(f"Section `{name}` has invalid draft output `{draft_rel}`.")
        dependencies = _split_dependencies(row["depends on"])
        for dependency in dependencies:
            if dependency not in order_index:
                result.violations.append(f"Section `{name}` depends on unknown section `{dependency}`.")
            elif order_index[dependency] >= index:
                result.violations.append(
                    f"Section `{name}` dependency `{dependency}` must precede it in Document Structure."
                )

        outline_path = root / outline_rel
        draft_path = root / draft_rel
        if not outline_path.resolve().is_relative_to(root_real):
            result.violations.append(f"Section `{name}` outline output escapes the project through a symlink.")
        if not draft_path.resolve().is_relative_to(root_real):
            result.violations.append(f"Section `{name}` draft output escapes the project through a symlink.")
        outline_text = _read(outline_path, root)
        draft_text = _read(draft_path, root)
        primary = sorted(
            [claim for claim, section in claim_map.items() if section == name],
            key=lambda claim: int(claim.split("-")[1]),
        )

        outline_issues: list[str] = []
        outline_implements: list[str] = []
        if outline_text:
            outline_implements, outline_hash, frontmatter_errors = _frontmatter(outline_text)
            outline_issues.extend(f"Section `{name}` outline {error}." for error in frontmatter_errors)
            if outline_hash and outline_hash != result.plan_hash:
                outline_issues.append(f"Section `{name}` outline is bound to stale plan hash `{outline_hash}`.")
            if outline_implements != primary:
                outline_issues.append(
                    f"Section `{name}` outline implements must equal mapped claims exactly: {primary!r}; observed {outline_implements!r}."
                )
        else:
            outline_issues.append(f"Section `{name}` outline is missing.")
        granular, note = _granularity(outline_text)
        if not granular:
            outline_issues.append(f"Section `{name}` outline is not granular: {note}.")

        draft_issues: list[str] = []
        draft_implements: list[str] = []
        if draft_text:
            draft_implements, draft_hash, frontmatter_errors = _frontmatter(draft_text)
            draft_issues.extend(f"Section `{name}` draft {error}." for error in frontmatter_errors)
            if draft_hash and draft_hash != result.plan_hash:
                draft_issues.append(f"Section `{name}` draft is bound to stale plan hash `{draft_hash}`.")
            if draft_implements != primary:
                draft_issues.append(
                    f"Section `{name}` draft implements must equal mapped claims exactly: {primary!r}; observed {draft_implements!r}."
                )
        else:
            draft_issues.append(f"Section `{name}` draft is missing.")

        implements = draft_implements if draft_text else outline_implements
        result.sections.append(
            Section(
                name=name,
                order=index,
                outline_file=str(outline_path.absolute()),
                draft_file=str(draft_path.absolute()),
                primary_claims=primary,
                implements=implements,
                dependencies=dependencies,
                sources_pinned=bool(_CITEKEY_RE.search(outline_text)),
                granular=granular,
                granularity_note=note,
                prev_name=order[index - 1] if index else "",
                next_name=order[index + 1] if index + 1 < len(order) else "",
                claim_ok=implements == primary if (outline_text or draft_text) else True,
                outline_current=not outline_issues,
                draft_current=not draft_issues,
                outline_issues=outline_issues,
                draft_issues=draft_issues,
            )
        )
    return result


def main() -> int:
    if len(sys.argv) != 2:
        print(
            "usage: writing_section_index.py /abs/project[/|/.planning|/.planning/<generated>.md]",
            file=sys.stderr,
        )
        return 2
    result = build_index(Path(sys.argv[1]))
    print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
