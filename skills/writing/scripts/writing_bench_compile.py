#!/usr/bin/env -S uv run python3
"""Compile a writing-bench JSON document into the canonical writing plan.

The bench is the collaborative surface where the user and Claude co-author an
outline; its state is one JSON document. This script is the ONLY bridge from that
state to the artifacts the writing workflow already parses:

  <proj>/.planning/<slug>.md   the eight-heading plan grammar
  <proj>/outlines/<Section>.md one per level-1 node, at the path the plan names

It is a COMPILER, never a second authority: every value is mapped from the bench,
nothing is invented, and a bench that cannot produce a plan the parser would accept
is refused whole rather than written partly. `writing_section_index.py` hashes the
plan and `review.json` binds that hash, so a silent rewrite of an approved plan
breaks the hash contract — hence `--force`.

CLI:
  writing_bench_compile.py --bench <bench.json> --project <proj> --slug <slug>
                           [--title <str>] [--force]
  writing_bench_compile.py --bench <bench.json> --source-requests

The second form writes nothing: it prints a JSON array of the open source requests (nodes
marked `needs` with no pin, and unpinned leaves below level 1 that are not scaffold/claude),
each {id, position, text, path, needs}, for the librarian to take one at a time.

Compiling refuses, before writing anything, a bench with an open source request, a pin whose
artifact is missing on disk, a pinned key absent from the one bibliography named by
srcmeta.bibliography, or a section name too long for the filesystem. `--force` also deletes the
outline files the OLD plan named that the new plan does not (printed as `removed: <path>`).

Exit 0 on success, 1 with every reason it refused, 2 on usage error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from plan_hash import plan_hash as _plan_hash  # noqa: E402

INTENT_FIELDS = ("thesis", "audience", "purpose", "hook", "scope", "domain")
DOMAINS = ("legal", "econ", "general")
# Genres whose argument headings ARE the claims, so a level-1 node may be a claim.
HEADS_ARE_CLAIMS = ("amicus", "expert", "comment")
_BIB_KEY_RE = re.compile(r"@\w+\s*[{(]\s*([^,\s]+)\s*,")
# Only text the user has accepted may compile. "scaffold" is the bench's own
# placeholder and "claude" is an unreviewed suggestion; both are proposals.
UNACCEPTED = {"scaffold": "still scaffold text", "claude": "still an unaccepted Claude suggestion"}
_SLUG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
_CID_RE = re.compile(r"CLAIM-[0-9]{2}")

REVIEW_SURFACES = (
    "Whole-plan claim and structure review.",
    "Citation fidelity and final user review.",
)


class Refusal(Exception):
    """Carries every reason at once; a partial plan is never written."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.reasons = reasons


# ── Bench shape ──────────────────────────────────────────────────────────────


class Node:
    __slots__ = ("children", "cid", "id", "kind", "needs", "position", "short", "source", "status", "text")

    def __init__(self, raw: object, position: str) -> None:
        data = raw if isinstance(raw, dict) else {}
        self.text = str(data.get("text") or "").strip()
        self.status = str(data.get("status") or "").strip().lower()
        self.source = str(data.get("source") or "").strip()
        self.kind = str(data.get("kind") or "").strip().lower()
        self.cid = str(data.get("cid") or "").strip()
        self.id = str(data.get("id") or "").strip()
        self.needs = data.get("needs") is True
        self.short = str(data.get("short") or "").strip()
        self.position = position
        children = data.get("children")
        self.children = [
            Node(child, f"{position}.{index + 1}")
            for index, child in enumerate(children if isinstance(children, list) else [])
        ]

    @property
    def name(self) -> str:
        """The section name for a level-1 node: the short title when set, else the text."""
        return self.short or self.text

    def walk(self):
        yield self
        for child in self.children:
            yield from child.walk()

    def descendants(self):
        for child in self.children:
            yield from child.walk()

    def claim_nodes(self, heads_are_claims: bool):
        return self.walk() if heads_are_claims else self.descendants()


def _legacy_node(raw: object, position: str) -> dict:
    """Normalize a legacy beat/claim/counter record into a modern node dict."""
    if isinstance(raw, str):
        return {"text": raw, "status": "agreed", "source": "", "kind": "", "children": []}
    data = raw if isinstance(raw, dict) else {}
    node = {
        "text": data.get("text") or data.get("title") or "",
        # Legacy records predate the status field; they were accepted content in the
        # old shape, so migrating them as "scaffold" would refuse every legacy bench.
        "status": data.get("status") or "agreed",
        "source": data.get("source") or data.get("key") or "",
        "kind": data.get("kind") or "",
        "children": [
            _legacy_node(child, position)
            for child in (data.get("children") or data.get("beats") or [])
        ],
    }
    cid = data.get("cid") or data.get("id") or ""
    if node["kind"] == "claim" or _CID_RE.fullmatch(str(cid)):
        node["kind"] = "claim"
        node["cid"] = str(cid)
    return node


def load_outline(bench: dict) -> list[Node]:
    """Return the level-1 nodes, migrating the legacy shape the page also migrates."""
    outline = bench.get("outline")
    if isinstance(outline, list) and outline:
        return [Node(raw, str(index + 1)) for index, raw in enumerate(outline)]

    sections = bench.get("sections")
    if not isinstance(sections, list) or not sections:
        return []
    migrated: list[dict] = []
    for section in sections:
        data = section if isinstance(section, dict) else {}
        migrated.append(
            {
                "text": data.get("text") or data.get("title") or data.get("name") or "",
                "status": data.get("status") or "agreed",
                "source": "",
                "kind": "",
                "children": [
                    _legacy_node(beat, "")
                    for beat in (data.get("beats") or data.get("children") or [])
                ],
            }
        )
    names = [str(entry["text"]).strip() for entry in migrated]

    # Top-level claims/counters arrays attach to the section they name; a record that
    # names none lands in the first section, which is where the page puts it too.
    for key, kind in (("claims", "claim"), ("counters", "counter")):
        for raw in bench.get(key) or []:
            data = raw if isinstance(raw, dict) else {"text": raw}
            node = _legacy_node(data, "")
            node["kind"] = kind
            if kind == "claim" and not node.get("cid"):
                node["cid"] = str(data.get("cid") or data.get("id") or "")
            target = str(data.get("section") or "").strip()
            index = names.index(target) if target in names else 0
            migrated[index]["children"].append(node)

    return [Node(raw, str(index + 1)) for index, raw in enumerate(migrated)]


# ── Validation ───────────────────────────────────────────────────────────────


def _obj(bench: dict, key: str) -> dict:
    value = bench.get(key)
    return value if isinstance(value, dict) else {}


def _heads_are_claims(bench: dict) -> bool:
    return str(_obj(bench, "intent").get("genre") or "").strip().lower() in HEADS_ARE_CLAIMS


def _name_max(project: Path) -> int:
    probe = project.absolute()
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        return int(os.pathconf(probe, "PC_NAME_MAX"))
    except (OSError, ValueError):
        return 255


def _bib_keys(path: Path) -> set[str]:
    return set(_BIB_KEY_RE.findall(path.read_text(encoding="utf-8", errors="replace")))


def _check_sources(
    bench: dict, sections: list[Node], sources: dict[str, str], project: Path, reasons: list[str]
) -> None:
    pinned: dict[str, str] = {}
    for section in sections:
        for node in section.walk():
            if node.source in sources:
                pinned.setdefault(node.source, node.position)

    for key, position in pinned.items():
        artifact = sources[key]
        if artifact and not (project / artifact).exists():
            reasons.append(
                f"artifact {artifact} for {key} does not exist; recall is not a source "
                f"(pinned at outline position {position})."
            )

    bibliography = str(_obj(bench, "srcmeta").get("bibliography") or "").strip()
    if not bibliography or not pinned:
        return
    bib_path = project / bibliography
    if not bib_path.is_file():
        reasons.append(
            f"bibliography {bibliography} does not exist; the librarian appends every entry to the "
            "one bibliography srcmeta.bibliography names."
        )
        return
    have = _bib_keys(bib_path)
    others = [
        path
        for path in sorted((project / "references").rglob("*.bib"))
        if path.resolve() != bib_path.resolve()
    ]
    for key, position in pinned.items():
        if key in have:
            continue
        elsewhere = next((path for path in others if key in _bib_keys(path)), None)
        if elsewhere is not None:
            reasons.append(
                f"pinned key {key!r} (outline position {position}) is not in {bibliography} but is in "
                f"{elsewhere}; append the entry to the one bibliography {bibliography}."
            )
        else:
            reasons.append(
                f"pinned key {key!r} (outline position {position}) has no entry in {bibliography}; "
                "recall is not a source."
            )


def validate(bench: dict, sections: list[Node], project: Path | None = None) -> list[str]:
    reasons: list[str] = []
    project = project if project is not None else Path(".")
    heads = _heads_are_claims(bench)

    intent = _obj(bench, "intent")
    for field in INTENT_FIELDS:
        if not str(intent.get(field) or "").strip():
            reasons.append(f"intent.{field} is empty; the plan parser refuses empty Writing Intent values.")
    domain = str(intent.get("domain") or "").strip().lower()
    if domain and domain not in DOMAINS:
        reasons.append(f"intent.domain is {domain!r}; it must be one of legal, econ, general.")

    srcmeta = _obj(bench, "srcmeta")
    if not str(srcmeta.get("bibliography") or "").strip():
        reasons.append("srcmeta.bibliography is empty; Source Plan requires a bibliography path.")

    sources: dict[str, str] = {}
    for entry in bench.get("sources") or []:
        data = entry if isinstance(entry, dict) else {}
        key = str(data.get("key") or "").strip()
        if key:
            sources[key] = str(data.get("artifact") or "").strip()

    if not sections:
        reasons.append("the bench has no sections; outline[] must contain at least one level-1 node.")

    name_max = _name_max(project)
    seen_names: dict[str, str] = {}
    for section in sections:
        if not section.text:
            reasons.append(f"section at outline position {section.position} has empty text.")
            continue
        for label, value in (("section", section.text), ("short title of section", section.short)):
            if any(bad in value for bad in ("|", "/", "\\", "\n")):
                reasons.append(
                    f"{label} {value!r} contains a character that cannot appear in an "
                    "outline filename or a Markdown table cell (one of | / \\)."
                )
        name = section.name
        if name in seen_names:
            reasons.append(
                f"two sections share the name {name!r} "
                f"(outline positions {seen_names[name]} and {section.position})."
            )
        else:
            seen_names[name] = section.position
        for basename in (f"{name}.md", f"{name} (Draft).md"):
            if len(basename.encode("utf-8")) > name_max:
                reasons.append(
                    f"section at outline position {section.position} would need the file name "
                    f"{basename[:40]!r}… of {len(basename.encode('utf-8'))} bytes, over the "
                    f"filesystem limit of {name_max}; set a short title for it in the bench."
                )
                break

    claim_positions: dict[str, list[str]] = {}
    for section in sections:
        for node in section.walk():
            if node.status in UNACCEPTED:
                reasons.append(
                    f"node at outline position {node.position} is {UNACCEPTED[node.status]} "
                    f"(status {node.status!r}): {node.text!r} — accept it in the bench before compiling."
                )
            if node.needs and not node.source:
                reasons.append(
                    f"node at outline position {node.position} is an open source request "
                    f"({node.text!r}); run the librarian for it, or clear the flag in the bench."
                )
            if node.source:
                if node.source not in sources:
                    reasons.append(
                        f"node at outline position {node.position} pins source key {node.source!r}, "
                        "which is not in sources[]."
                    )
                elif not sources[node.source]:
                    reasons.append(
                        f"source key {node.source!r}, pinned at outline position {node.position}, "
                        "has an empty artifact; recall is not a source."
                    )
            if node.kind == "claim":
                if not _CID_RE.fullmatch(node.cid):
                    reasons.append(
                        f"claim at outline position {node.position} has cid {node.cid!r}; "
                        "a claim requires a stable CLAIM-NN identifier."
                    )
                else:
                    claim_positions.setdefault(node.cid, []).append(node.position)

    _check_sources(bench, sections, sources, project, reasons)

    # Outside the heads-are-claims genres a level-1 claim has no section to map to.
    if not heads:
        for section in sections:
            if section.kind == "claim":
                reasons.append(
                    f"claim {section.cid or '(no cid)'} at outline position {section.position} is a "
                    "level-1 node and so has no section to map it to; nest it under a section "
                    "(the amicus, expert and comment genres allow a level-1 claim)."
                )

    for cid, positions in sorted(claim_positions.items()):
        if len(positions) > 1:
            reasons.append(f"duplicate claim id {cid} at outline positions {', '.join(positions)}.")
    if not claim_positions:
        reasons.append("the bench defines no claims; the plan grammar requires at least one CLAIM-NN.")

    return reasons


def source_requests(sections: list[Node]) -> list[dict]:
    """Open source requests in outline order, for the librarian."""
    found: list[dict] = []

    def visit(node: Node, path: list[str], level: int) -> None:
        if not node.source:
            leaf = not node.children and level > 1 and node.status not in UNACCEPTED
            if node.needs or leaf:
                found.append(
                    {
                        "id": node.id,
                        "position": node.position,
                        "text": node.text,
                        "path": list(path),
                        "needs": node.needs,
                    }
                )
        for child in node.children:
            visit(child, [*path, node.text], level + 1)

    for section in sections:
        visit(section, [], 1)
    return found


# ── Rendering ────────────────────────────────────────────────────────────────


def _cited(node: Node) -> str:
    return f"{node.text} [@{node.source}]" if node.source else node.text


def _gloss(section: Node, claims: list[str]) -> str:
    if section.short and section.short != section.text:
        return " ".join([section.text, *([f"Establishes {', '.join(claims)}."] if claims else [])])
    if claims:
        return f"Establishes {', '.join(claims)}."
    first = next((child for child in section.descendants() if child.text), None)
    return first.text if first is not None else section.text


def render_plan(bench: dict, sections: list[Node], title: str) -> str:
    intent = _obj(bench, "intent")
    srcmeta = _obj(bench, "srcmeta")

    # Both lists stay in outline order; the Claims block and the Claim → Section Map
    # are the same claims read two ways, so they are collected in one pass.
    claim_defs: list[tuple[str, str]] = []
    claim_map: list[tuple[str, str]] = []
    counters: list[str] = []
    pinned: list[str] = []
    heads = _heads_are_claims(bench)
    for section in sections:
        for node in section.walk():
            if node.source and node.source not in pinned:
                pinned.append(node.source)
        for node in section.claim_nodes(heads):
            if node.kind == "claim":
                claim_defs.append((node.cid, node.text))
                claim_map.append((node.cid, section.name))
            elif node.kind == "counter":
                counters.append(node.text)

    by_section: dict[str, list[str]] = {}
    for cid, name in claim_map:
        by_section.setdefault(name, []).append(cid)

    lines: list[str] = ["---", "workflow: writing", "---", "", f"# {title}", ""]

    lines.append("## Writing Intent")
    for field in INTENT_FIELDS:
        value = str(intent[field]).strip()
        lines.append(f"- **{field.title()}**: {value.lower() if field == 'domain' else value}")
    lines.append("")

    lines.append("## Claims")
    for cid, text in claim_defs:
        lines.append(f"- **{cid}**: {text}")
    lines.append("")

    lines.append("## Counterarguments")
    for text in counters or ["None identified in the bench."]:
        lines.append(f"- {text}")
    lines.append("")

    lines.append("## Document Structure")
    for section in sections:
        lines.append(f"### {section.name}")
        lines.append(_gloss(section, by_section.get(section.name, [])))
        lines.append("")

    lines.append("## Claim → Section Map")
    lines.append("| Claim | Section |")
    lines.append("|---|---|")
    for cid, name in claim_map:
        lines.append(f"| {cid} | {name} |")
    lines.append("")

    lines.append("## Source Plan")
    lines.append(f"- **Bibliography**: {str(srcmeta['bibliography']).strip()}")
    lines.append(f"- **Notebook**: {str(srcmeta.get('notebook') or 'none').strip()}")
    lines.append(f"- **Notebook URL**: {str(srcmeta.get('notebookUrl') or 'none').strip()}")
    lines.append(f"- **Key Sources**: {'; '.join(pinned) if pinned else 'none'}")
    lines.append("")

    lines.append("## Section Outputs")
    lines.append("| Section | Outline | Draft | Depends On |")
    lines.append("|---|---|---|---|")
    for index, section in enumerate(sections):
        depends = sections[index - 1].name if index else "-"
        lines.append(
            f"| {section.name} | {outline_rel(section.name)} | {draft_rel(section.name)} | {depends} |"
        )
    lines.append("")

    lines.append("## Review Surfaces")
    lines.extend(f"- {surface}" for surface in REVIEW_SURFACES)
    lines.append("")
    return "\n".join(lines)


def outline_rel(name: str) -> str:
    return f"outlines/{name}.md"


def draft_rel(name: str) -> str:
    return f"drafts/{name} (Draft).md"


def render_outline(section: Node, plan_hash: str, heads: bool = False) -> str:
    claims = sorted(
        {node.cid for node in section.claim_nodes(heads) if node.kind == "claim" and node.cid},
        key=lambda cid: int(cid.split("-")[1]),
    )
    body: list[str] = []

    def emit(nodes: list[Node], depth: int) -> None:
        for node in nodes:
            body.append(f"{'  ' * depth}- {_cited(node)}")
            emit(node.children, depth + 1)

    emit(section.children, 0)
    return (
        "---\n"
        f"implements: [{', '.join(claims)}]\n"
        f"plan_hash: {plan_hash}\n"
        "---\n" + "\n".join(body) + ("\n" if body else "")
    )


# ── CLI ──────────────────────────────────────────────────────────────────────


def _old_outlines(plan_path: Path, project: Path) -> list[Path]:
    """Outline files the existing plan's Section Outputs table names, under <proj>/outlines/ only."""
    try:
        text = plan_path.read_text(encoding="utf-8")
    except OSError:
        return []
    match = re.search(r"(?ms)^##\s+Section Outputs\s*$(.*?)(?=^##\s|\Z)", text)
    if not match:
        return []
    root = (project / "outlines").resolve()
    found: list[Path] = []
    for line in match.group(1).splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 2 or not cells[1].startswith("outlines/") or not cells[1].endswith(".md"):
            continue
        path = (project / cells[1]).resolve()
        if path.is_relative_to(root) and path != root:
            found.append(path)
    return found


def compile_bench(
    bench_path: Path, project: Path, slug: str, title: str | None, force: bool
) -> tuple[list[Path], list[Path]]:
    """Return (written, removed). Every check runs before the first write."""
    bench = _load_bench(bench_path)
    reasons: list[str] = []

    if not _SLUG_RE.fullmatch(slug):
        reasons.append(f"--slug {slug!r} is not a safe plan basename ([A-Za-z0-9][A-Za-z0-9._-]*).")
    if slug == "PLAN":
        reasons.append("--slug PLAN is reserved; the parser rejects PLAN.md as a generated plan.")

    plan_path = project / ".planning" / f"{slug}.md"
    if plan_path.exists() and not force:
        reasons.append(
            f"{plan_path} already exists; the plan is hashed by work, so refusing to rewrite it "
            "silently. Pass --force to overwrite deliberately."
        )

    sections = load_outline(bench)
    reasons.extend(validate(bench, sections, project))
    if reasons:
        raise Refusal(reasons)

    plan_text = render_plan(bench, sections, title.strip() if title and title.strip() else slug)
    plan_hash = _plan_hash(plan_text.encode("utf-8"))
    heads = _heads_are_claims(bench)
    old = _old_outlines(plan_path, project) if force else []

    plan_path.parent.mkdir(parents=True, exist_ok=True)
    (project / "outlines").mkdir(parents=True, exist_ok=True)
    plan_path.write_text(plan_text, encoding="utf-8")
    written = [plan_path]
    for section in sections:
        path = project / outline_rel(section.name)
        path.write_text(render_outline(section, plan_hash, heads), encoding="utf-8")
        written.append(path)

    kept = {path.resolve() for path in written}
    removed: list[Path] = []
    for path in old:
        if path not in kept and path.is_file():
            path.unlink()
            removed.append(path)
    return written, removed


def _load_bench(bench_path: Path) -> dict:
    try:
        bench = json.loads(bench_path.read_text(encoding="utf-8"))
    except OSError as error:
        raise Refusal([f"cannot read bench {bench_path}: {error}"]) from error
    except json.JSONDecodeError as error:
        raise Refusal([f"bench {bench_path} is not valid JSON: {error}"]) from error
    if not isinstance(bench, dict):
        raise Refusal([f"bench {bench_path} must be a JSON object, not {type(bench).__name__}."])
    return bench


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="writing_bench_compile.py",
        description="Compile a writing-bench JSON document into the canonical writing plan.",
    )
    parser.add_argument("--bench", required=True, type=Path)
    parser.add_argument("--project", type=Path)
    parser.add_argument("--slug")
    parser.add_argument("--title", default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--source-requests", action="store_true")
    args = parser.parse_args(argv)
    if not args.source_requests and (args.project is None or not args.slug):
        parser.error("--project and --slug are required unless --source-requests is given")

    try:
        if args.source_requests:
            print(json.dumps(source_requests(load_outline(_load_bench(args.bench))), indent=2))
            return 0
        written, removed = compile_bench(args.bench, args.project, args.slug, args.title, args.force)
    except Refusal as refusal:
        print(
            "writing_bench_compile: refusing to compile this bench.\n"
            + "\n".join(f"  - {reason}" for reason in refusal.reasons),
            file=sys.stderr,
        )
        return 1
    for path in written:
        print(path)
    for path in removed:
        print(f"removed: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
