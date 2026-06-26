#!/usr/bin/env -S uv run python3
"""
plan_table_core — the shared S1 parser core for compiled-runner plan tables.

Extracted (pass-#9 follow-up) from the byte-near-identical internals of
scripts/ds/ds_plan_table.py and scripts/dev/dev_plan_table.py once 2+ instances proved
the shape empirical (canonical: docs/common-infra-candidates.md, seam S1). It holds the
domain-AGNOSTIC mechanics:
  - markdown-table location (by an exact required-header set) + cell extraction
    (prefix-tolerant, so 'failing test (write first)' satisfies the column 'failing test'),
  - id / dependency token canonicalization (tolerant of `**T1**`, `1.`, em-dash / `after N`),
  - the DAG checks: dangling-dep detection, 3-color-DFS cycle check, level toposort.

The PER-DOMAIN seam (D3) stays in each domain parser: the Task dataclass fields, the
column-map (which cells map to which fields), per-cell validation, and any prose-section
lifts. Each domain keeps its public API (parse_plan / toposort / find_task_table / Task /
ParseResult) and delegates these internals here, so the compiler and the guard that import
it can never disagree, and there is ONE copy of the table+DAG logic.

⚠ S5/P27 HARD CONSTRAINT — this core does ENUMERATION + task-to-task DAG ONLY. It never
joins a work-item to a PRODUCED artifact (that correspondence may be semantic — multi-source
enumeration — and lives OUTSIDE the parser, in the domain's gateProbe/verify). Do NOT add a
work-item↔artifact join here; the deps it resolves are plan-internal task references.
"""

from __future__ import annotations

import re

# id token at the start of a Task cell: **T1**, T1, T1., 1., 1 — capture the bare key (e.g. "T1", "1")
ID_RE = re.compile(r"^\s*\**\s*((?:[A-Za-z]+)?\d+)\s*\**\.?")
# done marker: a checked box `[x]`
DONE_RE = re.compile(r"`?\[x\]`?", re.I)
# tokens that mean "no dependencies"
NO_DEPS = {"", "-", "--", "---", "—", "–", "n/a", "none"}
# a dependency reference token inside the Deps cell: T1, 1, t10 …
DEP_TOK_RE = re.compile(r"(?:[A-Za-z]+)?\d+")
# an inline pause marker in any cell: ⏸ PAUSE: <text>  (also accepts "PAUSE:" without the glyph)
PAUSE_RE = re.compile(r"(?:⏸\s*)?PAUSE:\s*(.+?)(?:\s*$)", re.I)

_SEP_RE = re.compile(r"^\|?[\s:|-]+\|[\s:|-]+\|?$")


def split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def col_index(header, name) -> int:
    """Index of the column whose header equals `name` or starts with it — tolerant of
    parenthetical/qualifier suffixes the plan templates use (e.g. 'failing test (write first)'
    satisfies the required column 'failing test'). -1 if absent."""
    for i, h in enumerate(header):
        if h == name or h.startswith(name + " ") or h.startswith(name + "("):
            return i
    return -1


def has_col(header, name) -> bool:
    return col_index(header, name) >= 0


def cell(header, cells, name) -> str:
    i = col_index(header, name)
    try:
        return cells[i].strip() if i >= 0 else ""
    except IndexError:
        return ""


def canon_id(token: str) -> str:
    """Normalise an id token to its canonical key: strip markdown, keep the prefix+digits."""
    m = ID_RE.match(token)
    return m.group(1) if m else token.strip().strip("*").strip()


def find_table(text: str, required: set[str]):
    """Return (header_cells_lower, [row_cell_lists]) for the first markdown table whose header
    (exact, lowercased) is a superset of `required`; (None, None) if absent. Same detection the
    guard uses — pass the same `required` set in the guard and the compiler so they agree."""
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not (line.startswith("|") and "|" in line[1:]):
            continue
        header = [c.strip().lower() for c in line.strip("|").split("|")]
        sep = lines[i + 1].strip() if i + 1 < len(lines) else ""
        is_sep = bool(_SEP_RE.match(sep)) and "-" in sep
        if is_sep and required.issubset(set(header)):
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].strip().startswith("|"):
                rows.append(split_row(lines[j]))
                j += 1
            return header, rows
    return None, None


def parse_deps(deps_cell: str) -> list[str]:
    """A Deps cell → a list of canonical dependency ids. Tolerates `after T1, T2`, bare `T1, T2`,
    and the no-deps tokens (—, ---, none, n/a, …). Plan-internal task refs only (never artifacts)."""
    norm = deps_cell.strip().strip("`").strip().lower()
    if norm in NO_DEPS:
        return []
    body = re.sub(r"^after\s+", "", deps_cell.strip(), flags=re.I)
    return [canon_id(t) for t in DEP_TOK_RE.findall(body)]


def check_acyclic(deps_map: dict[str, list[str]]) -> bool:
    """True iff the deps graph (id → [dep ids], already filtered to present ids) has a cycle.
    3-color DFS. The caller appends a domain-worded violation if this returns True."""
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in deps_map}

    def visit(u) -> bool:
        color[u] = GREY
        for v in deps_map.get(u, []):
            if color.get(v) == GREY or (color.get(v) == WHITE and visit(v)):
                return True
        color[u] = BLACK
        return False

    return any(color[n] == WHITE and visit(n) for n in list(deps_map))


def toposort_ids(deps_map: dict[str, list[str]]) -> list[list[str]]:
    """Dependency levels: level k holds ids whose deps are all in levels < k. deps already
    filtered to present ids. Cycle-safe (a stuck layer is emitted whole to avoid an infinite loop)."""
    placed: set[str] = set()
    levels: list[list[str]] = []
    while len(placed) < len(deps_map):
        layer = [i for i in deps_map if i not in placed and all(d in placed for d in deps_map[i])]
        if not layer:  # cycle (already reported) — avoid infinite loop
            layer = [i for i in deps_map if i not in placed]
        levels.append(sorted(layer, key=lambda x: [int(n) for n in re.findall(r"\d+", x)] or [0]))
        placed.update(layer)
    return levels
