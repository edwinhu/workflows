#!/usr/bin/env -S uv run --with pypdf python3
"""Compute the mechanical workshop deck checks over an approved plan's declared artifacts.

WHY THIS EXISTS
    Upstream's `typst-widow-detection.py` shells to a `detect_widows.py` that exists nowhere on
    this machine and returns *no violations* when the detector is absent; upstream's
    `typst-overflow.py` returns `[]` when it finds no slides, when `typst` is missing, and for
    every driver exit code other than `1` -- including the `2` its own driver exits on a missing
    dependency. Both report green precisely when nothing was measured. Neither is vendored; this
    probe owns WID and OVR natively.

    Every computed check here FAILS CLOSED. A missing tool, a missing file, an unreadable PDF, a
    malformed Slide Spec, an unparseable `## Source Paper`, `## Source Inventory` or
    `## Outputs and Verification`, or a driver exit code this probe does not recognise is a FAIL
    with a machine-written reason -- never a clean line, never a skip. A check that cannot fail is
    not a check.

WHAT IT DELIBERATELY DOES NOT DO
    FID, CONV and VIS are judgements. They are enumerated with the literal status
    MODEL-EVALUATED -- never PASS -- and settled by the deck-fidelity, deck-convention and
    visual-integrity lenses. ENUM asserts both that a line was emitted for every matrix ID *and*
    that those three carry MODEL-EVALUATED status, so a later edit cannot route a judgement
    through a computed status unnoticed.

CONTRACT
    stdout: exactly one line per MATRIX ID, in matrix order, as
            `[<ID>] <STATUS> | <detail> | <evidence>`.
    exit:   non-zero iff a COMPUTED check FAILs, so a gate reads the status without parsing.

DEFINITIONS
    Check semantics: ${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md
    Plan grammar:    ${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/slide-spec-grammar.md

USAGE
    workshop-deck.py --plan .planning/<plan>.md --project-dir DIR [--json report.json]
    workshop-deck.py --plan <plan> --project-dir DIR --slides presentation/slides.typ
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL_ROOT = HERE.parent
# The constraint corpus is owned by the typst plugin; this skill holds no copy. The env override
# exists so the contract suite can point the probe at a scratch corpus without touching the real one.
CONSTRAINT_RUNNER = Path(
    os.environ.get(
        "WORKSHOP_CONSTRAINT_RUNNER",
        Path.home() / ".claude" / "skills" / "typst" / "references" / "checkers" / "workshop"
        / "run-constraints.py",
    )
)
OVERFLOW_DRIVER = HERE / "checks" / "check-overflow.sh"
VALIDATION_TYP = HERE / "validation.typ"

# The matrix in references/workshop-checks.md, in matrix order. ENUM asserts that a line was
# emitted for every ID here -- the whole point of computing ENUM rather than claiming it.
MATRIX = ["CMP", "CON", "SPEC", "NOTE", "INV", "WID", "OVR", "ENUM", "FID", "CONV", "VIS"]

# Checks no script can settle. Reported as MODEL-EVALUATED, never PASS/FAIL/N/A.
MODEL_EVALUATED = {
    "FID": (
        "Claim fidelity: whether the claim beside a cited ID is what the source paper says is a "
        "judgement over the paper, not a property of the built file. Lens: deck-fidelity."
    ),
    "CONV": (
        "Convention: the Typst/Touying conventions and plan proportions the vendored constraints "
        "cannot express are a judgement over the deck. Lens: deck-convention."
    ),
    "VIS": (
        "Visual integrity: whether a diagram is legible at venue scale and says what its slide "
        "claims is a judgement over the diagram source. Lens: visual-integrity."
    ),
}

# A widow is a page's final line holding exactly one token of at most this many characters. Fixed
# here rather than left to the reader: an unstated "short" gives two honest implementations two
# different checks, and the laxest one never fires.
WIDOW_MAX_TOKEN_CHARS = 12

SPEC_COLUMNS = ["slide", "section", "takeaway", "bullets", "inventory", "visual", "notes"]
INVENTORY_COLUMNS = ["id", "kind", "source"]
OUTPUT_COLUMNS = ["artifact", "path"]
SOURCE_PAPER_COLUMNS = ["field", "value"]

# `## Source Paper` must declare both. `path` is how deck-fidelity locates the paper -- the paper
# differs per run, so it cannot be a static lens `ref`.
REQUIRED_PAPER_FIELDS = ["path", "title"]

# `Kind` must agree with the ID's letter (slide-spec-grammar.md).
KIND_BY_LETTER = {"F": "figure", "T": "table", "R": "result", "A": "argument"}
INVENTORY_ID_RE = re.compile(r"^[FTRA][0-9]+$")

# The four artifacts `## Outputs and Verification` must declare. Every one is a file the probe
# opens or writes; a runner handed prose cannot open a file.
REQUIRED_ARTIFACTS = ["deck", "notes", "deck-pdf", "notes-pdf"]

SUBPROCESS_TIMEOUT = 300


def result(status: str, detail: str, evidence: str = "") -> dict:
    """One check line. `reason_source` records WHO wrote `detail` -- always this script."""
    return {"status": status, "detail": detail, "evidence": evidence, "reason_source": "runner"}


def model_line(check: str) -> dict:
    return {
        "status": "MODEL-EVALUATED",
        "detail": MODEL_EVALUATED[check],
        "evidence": "",
        "reason_source": "model-required",
    }


# --------------------------------------------------------------------------------------------
# Plan parsing
# --------------------------------------------------------------------------------------------


class GrammarError(ValueError):
    """A clause of the plan grammar was violated. Always FAIL CLOSED, never a skip."""


def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_delimiter(line: str) -> bool:
    body = line.strip().strip("|")
    return bool(body) and "-" in body and set(body) <= set("-: |")


def _section_lines(plan_text: str, heading: str) -> list[str] | None:
    """Lines under `## <heading>`, up to the next heading of any level. None if absent."""
    lines = plan_text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if re.match(rf"^\s*##\s+{re.escape(heading)}\s*$", line):
            start = i + 1
            break
    if start is None:
        return None
    body: list[str] = []
    for line in lines[start:]:
        if re.match(r"^\s*#{1,6}\s", line):
            break
        body.append(line)
    return body


def _pipe_table(plan_text: str, heading: str, columns: list[str]) -> list[list[str]]:
    """Return the body rows of the pipe table under `## <heading>`, header validated.

    "A pipe table follows the heading" means the FIRST non-blank line under it is a pipe row, a
    delimiter row follows, and body rows run to the first blank line. Anything else is a
    GrammarError: an unparsed blob must never reach a check as if it were a table.
    """
    body = _section_lines(plan_text, heading)
    if body is None:
        raise GrammarError(f"plan has no `## {heading}` heading")

    first = None
    for i, line in enumerate(body):
        if line.strip():
            first = i
            break
    if first is None:
        raise GrammarError(f"`## {heading}` is empty")
    if not body[first].strip().startswith("|"):
        raise GrammarError(
            f"no pipe table follows `## {heading}`: the first non-blank line under it is "
            f"{body[first].strip()!r}"
        )
    if first + 1 >= len(body) or not _is_delimiter(body[first + 1]):
        raise GrammarError(
            f"no pipe table follows `## {heading}`: its header row is not followed by a "
            "`|---|` delimiter row"
        )

    header = _split_row(body[first])
    lowered = [h.lower() for h in header]
    if lowered != columns:
        expected = " | ".join(c.title() for c in columns)
        found = " | ".join(header) or "(nothing)"
        if sorted(lowered) == sorted(columns):
            raise GrammarError(
                f"`## {heading}` header row is not in the required order {expected}; found {found}"
            )
        raise GrammarError(
            f"`## {heading}` header row must be exactly {expected}; found {found}"
        )

    rows: list[list[str]] = []
    for line in body[first + 2:]:
        if not line.strip() or not line.strip().startswith("|"):
            break
        cells = _split_row(line)
        if len(cells) != len(columns):
            raise GrammarError(
                f"`## {heading}` row has {len(cells)} cells, expected {len(columns)}: "
                f"{line.strip()}"
            )
        empty = [columns[i].title() for i, c in enumerate(cells) if not c]
        if empty:
            raise GrammarError(
                f"`## {heading}` row has an empty {', '.join(empty)} cell: {line.strip()}"
            )
        rows.append(cells)

    if not rows:
        raise GrammarError(f"`## {heading}` table has a header but zero body rows")
    return rows


def normalize_title(title: str) -> str:
    """The join key shared by the `Slide` cell, the deck's `=== ` line and the `== ` notes heading.

    Strip, collapse internal whitespace runs, compare CASE-SENSITIVELY (slide-spec-grammar.md).
    Case-folding here would silently admit a deck whose titles differ from the approved plan.
    """
    return re.sub(r"\s+", " ", title).strip()


def parse_slide_spec(plan_text: str) -> list[dict]:
    """Parse `## Slide Spec` (R7). Raises GrammarError on every malformed clause."""
    rows = _pipe_table(plan_text, "Slide Spec", SPEC_COLUMNS)
    return [dict(zip(SPEC_COLUMNS, cells)) for cells in rows]


def parse_source_inventory(plan_text: str) -> list[dict]:
    """Parse `## Source Inventory` (R7b) as a validated table, never as a blob of tokens.

    A regex sweep over the section text would admit an unparsed blob and let INV match by
    substring; the ID set INV compares against has to be a set of whole, validated tokens.
    """
    rows = _pipe_table(plan_text, "Source Inventory", INVENTORY_COLUMNS)
    items: list[dict] = []
    seen: set[str] = set()
    for cells in rows:
        item = dict(zip(INVENTORY_COLUMNS, cells))
        ident, kind = item["id"], item["kind"].lower()
        if not INVENTORY_ID_RE.match(ident):
            raise GrammarError(
                f"`## Source Inventory` ID {ident!r} does not match `^[FTRA][0-9]+$`"
            )
        if ident in seen:
            raise GrammarError(f"`## Source Inventory` declares ID {ident!r} more than once")
        expected = KIND_BY_LETTER[ident[0]]
        if kind != expected:
            raise GrammarError(
                f"`## Source Inventory` row {ident} has Kind {item['kind']!r}, but the ID's "
                f"letter {ident[0]!r} requires {expected!r}"
            )
        seen.add(ident)
        items.append(item)
    return items


def parse_source_paper(plan_text: str, root: Path) -> dict[str, str]:
    """Parse `## Source Paper` (R7c). Raises GrammarError on every unparseable clause.

    The unresolvable-`path` clause is the load-bearing one: deck-fidelity judges FID by reading the
    paper at this path, so a path resolving to nothing leaves the model side judging the deck
    against nothing while every computed line still reads clean.
    """
    rows = _pipe_table(plan_text, "Source Paper", SOURCE_PAPER_COLUMNS)
    fields: dict[str, list[str]] = {}
    for field, value in rows:
        fields.setdefault(field.lower(), []).append(value)

    missing = [f for f in REQUIRED_PAPER_FIELDS if f not in fields]
    if missing:
        raise GrammarError(
            f"`## Source Paper` is missing the mandatory row(s) {', '.join(missing)}; "
            "deck-fidelity locates the paper through this table and nowhere else"
        )

    # Every declared `path` is checked, not merely the first: a second row must not be able to hide
    # behind a resolvable one.
    for value in fields["path"]:
        paper = Path(value).expanduser()
        resolved = paper if paper.is_absolute() else root / paper
        if not resolved.is_file():
            raise GrammarError(
                f"`## Source Paper` declares path `{value}`, which resolves to `{resolved}` and is "
                "not a file; a lens told to read a paper the plan never located reads nothing"
            )
    return {k: v[0] for k, v in fields.items()}


def parse_outputs(plan_text: str) -> dict[str, str]:
    """Parse `## Outputs and Verification` (R8) into the four declared artifact paths.

    Takes the role `## Data Outputs` has in ds-dq.py: an absent, empty or unparseable section is
    FAIL CLOSED, and every path this probe opens must appear here.
    """
    rows = _pipe_table(plan_text, "Outputs and Verification", OUTPUT_COLUMNS)
    declared: dict[str, str] = {}
    for artifact, path in rows:
        key = artifact.lower()
        if key not in REQUIRED_ARTIFACTS:
            raise GrammarError(
                f"`## Outputs and Verification` declares Artifact {artifact!r}, which is outside "
                f"the fixed set {' | '.join(REQUIRED_ARTIFACTS)}"
            )
        if key in declared:
            raise GrammarError(
                f"`## Outputs and Verification` declares Artifact {artifact!r} more than once"
            )
        declared[key] = path
    missing = [a for a in REQUIRED_ARTIFACTS if a not in declared]
    if missing:
        raise GrammarError(
            "`## Outputs and Verification` is missing the mandatory row(s) "
            f"{', '.join(missing)}; the probe compiles both sources and reads the deck, so each "
            "is an artifact it opens"
        )
    return declared


# --------------------------------------------------------------------------------------------
# Artifact readers
# --------------------------------------------------------------------------------------------

# Leading whitespace is allowed: `=== ` titles sit indented inside `#slide[...]` blocks and Typst
# still reads them as headings.
SLIDE_TITLE_RE = re.compile(r"^[ \t]*===(?!=)[ \t]+(\S.*?)[ \t]*$", re.MULTILINE)
NOTES_HEADING_RE = re.compile(r"^[ \t]*==(?!=)[ \t]+(\S.*?)[ \t]*$", re.MULTILINE)
INV_CALL_RE = re.compile(r"#inv\s*\(([^)]*)\)")
INV_ARG_RE = re.compile(r'"([^"]*)"')


def deck_titles(deck_text: str) -> list[str]:
    """Titles of the slides the deck actually builds. A commented-out `=== ` line builds nothing,
    so it must not satisfy a Slide Spec row either."""
    return [m.group(1) for m in SLIDE_TITLE_RE.finditer(strip_typst_comments(deck_text))]


def notes_headings(notes_text: str) -> list[str]:
    return [m.group(1) for m in NOTES_HEADING_RE.finditer(strip_typst_comments(notes_text))]


def strip_typst_comments(source: str) -> str:
    """Blank out `//` line comments and `/* ... */` block comments, preserving every offset.

    A commented-out `#inv(...)` renders nothing, so matching it would let a slide that declares
    nothing read clean -- the vacuous pass inside the very check R5/R11 exist to close. Comment
    bodies are replaced by spaces (newlines kept) so offsets of the surviving source are unchanged.
    Typst block comments nest, so depth is counted.

    String literals are DELIBERATELY NOT tracked. Typst *markup* treats `"` as ordinary text, so a
    valid deck may carry an odd number of quotes (an inch mark, an opened quotation); a stripper
    that enters string mode on one unpaired `"` leaves every later comment intact, and a commented
    `#inv(` then reads as a real emission -- verified as a live vacuous pass. The cost is a
    conservative over-strip when a quoted string legitimately contains `//` (a URL), which can only
    remove a real call and produce a FALSE FAIL, never a false clean. Failing closed on an
    ambiguous parse is the whole of R11; failing open to protect a URL inverts it.
    """
    out = list(source)
    i, n = 0, len(source)
    depth = 0

    def blank(idx: int) -> None:
        if out[idx] != "\n":
            out[idx] = " "

    while i < n:
        if depth:
            if source.startswith("/*", i):
                depth += 1
                blank(i)
                blank(i + 1)
                i += 2
                continue
            if source.startswith("*/", i):
                depth -= 1
                blank(i)
                blank(i + 1)
                i += 2
                continue
            blank(i)
            i += 1
            continue
        if source.startswith("//", i):
            while i < n and source[i] != "\n":
                blank(i)
                i += 1
            continue
        if source.startswith("/*", i):
            depth = 1
            blank(i)
            blank(i + 1)
            i += 2
            continue
        i += 1
    return "".join(out)


def deck_slide_citations(deck_text: str) -> list[tuple[str, list[str], int]]:
    """(title, cited IDs, number of REAL `#inv(` calls) for each `=== ` slide, in source order.

    A slide runs from its title line to the next title line or EOF; only calls inside that span
    count, so an `#inv(` on one slide cannot vouch for the slide beside it. Comments are stripped
    first: a commented-out call is not an emission, and counting one would make the silent-slide
    guard unfailable.
    """
    deck_text = strip_typst_comments(deck_text)
    matches = list(SLIDE_TITLE_RE.finditer(deck_text))
    out: list[tuple[str, list[str], int]] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(deck_text)
        span = deck_text[m.end():end]
        calls = INV_CALL_RE.findall(span)
        ids: list[str] = []
        for args in calls:
            ids.extend(INV_ARG_RE.findall(args))
        out.append((m.group(1), ids, len(calls)))
    return out


# --------------------------------------------------------------------------------------------
# Computed checks
# --------------------------------------------------------------------------------------------


def check_cmp(deck_src: Path, notes_src: Path, deck_pdf: Path, notes_pdf: Path, root: Path) -> dict:
    """R11: absent `typst`, an absent source, or a compile that produced no file is a FAIL."""
    if shutil.which("typst") is None:
        return result(
            "FAIL",
            "`typst` is not on PATH, so neither document could be compiled and nothing was "
            "measured. This is precisely upstream's failure mode.",
            "compiled=0 of 2",
        )

    problems: list[str] = []
    evidence: list[str] = []
    compiled = 0
    for src, pdf in ((deck_src, deck_pdf), (notes_src, notes_pdf)):
        if not src.is_file():
            problems.append(f"declared source `{src}` does not exist on disk")
            continue
        try:
            pdf.parent.mkdir(parents=True, exist_ok=True)
            if pdf.exists():
                pdf.unlink()
            proc = subprocess.run(
                ["typst", "compile", "--root", str(root), str(src), str(pdf)],
                capture_output=True,
                text=True,
                timeout=SUBPROCESS_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            problems.append(f"{src.name}: typst compile timed out after {SUBPROCESS_TIMEOUT}s")
            continue
        except (OSError, FileNotFoundError) as exc:
            problems.append(f"{src.name}: could not run typst: {exc}")
            continue
        compiled += 1
        stderr = " ".join(proc.stderr.split())
        evidence.append(f"{src.name}: exit={proc.returncode} out={pdf.name} stderr={stderr or '(empty)'}")
        if proc.returncode != 0:
            problems.append(f"{src.name}: typst compile exited {proc.returncode}: {stderr}")
            continue
        if stderr:
            problems.append(f"{src.name}: typst compile wrote a diagnostic to stderr: {stderr}")
        if not pdf.is_file() or pdf.stat().st_size == 0:
            problems.append(
                f"{src.name}: compile reported success but produced no output file at `{pdf}`"
            )

    if compiled == 0:
        problems.append("zero files were compiled; compiling nothing is a FAIL, not a clean run")
    if problems:
        return result("FAIL", "; ".join(problems), " | ".join(evidence) or f"compiled={compiled} of 2")
    return result(
        "PASS",
        f"`{deck_src.name}` and `{notes_src.name}` both compile clean and produced their "
        "declared output files.",
        " | ".join(evidence),
    )


def check_con(presentation_dir: Path) -> dict:
    """R3/R11: read the runner's JSON, not its status; zero inspected files is a FAIL."""
    if not CONSTRAINT_RUNNER.is_file():
        return result("FAIL", f"vendored constraint runner is absent at `{CONSTRAINT_RUNNER}`.")
    if not presentation_dir.is_dir():
        return result(
            "FAIL",
            f"resolved presentation directory `{presentation_dir}` does not exist, so every "
            "constraint module would glob an empty tree and report clean having opened no file.",
        )

    if shutil.which("uv"):
        cmd = ["uv", "run", "--with", "lxml", "python3", str(CONSTRAINT_RUNNER), str(presentation_dir)]
    else:
        cmd = [sys.executable, str(CONSTRAINT_RUNNER), str(presentation_dir)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=SUBPROCESS_TIMEOUT)
    except subprocess.TimeoutExpired:
        return result("FAIL", f"constraint runner timed out after {SUBPROCESS_TIMEOUT}s.")
    except (OSError, FileNotFoundError) as exc:
        return result("FAIL", f"could not run the constraint runner: {exc}")

    # Exit 1 is a violation verdict, not a crash: the runner exits 1 for a violation AND for an
    # infrastructure failure, and the JSON is what tells them apart.
    try:
        report = json.loads(proc.stdout)
    except ValueError as exc:
        return result(
            "FAIL",
            f"constraint runner emitted unparseable JSON (exit {proc.returncode}): {exc}",
            " ".join((proc.stdout + proc.stderr).split())[:1500],
        )
    # Valid JSON is not yet a report: `[]`, `null` and `"ok"` all decode without raising, and
    # `.get()` on any of them raises AttributeError, which would kill the probe before it emitted a
    # single line -- silence a gate reads as "no checks" rather than "could not check".
    if not isinstance(report, dict):
        return result(
            "FAIL",
            f"constraint runner emitted JSON that is not an object (exit {proc.returncode}): "
            f"decoded a {type(report).__name__}, so no module verdict could be read and nothing "
            "was measured.",
            " ".join((proc.stdout + proc.stderr).split())[:1500],
        )

    passed = report.get("passed") or []
    failed = report.get("failed") or []
    errors = report.get("errors") or []
    skipped = report.get("skipped") or []
    inspected = report.get("inspected_total")
    if inspected is None:
        inspected = sum(
            e.get("inspected", 0)
            for key in ("passed", "failed", "errors", "skipped")
            for e in (report.get(key) or [])
        )

    evidence = (
        f"exit={proc.returncode} modules={report.get('modules')} inspected_total={inspected} "
        f"passed={len(passed)} failed={[f.get('name') for f in failed]} "
        f"errors={[e.get('name') for e in errors]} skipped={[s.get('name') for s in skipped]}"
    )

    problems: list[str] = []
    if report.get("error"):
        problems.append(f"the runner could not run: {report['error']}")
    if inspected == 0:
        problems.append(
            "the summed inspected-file count is zero: every module globbed an empty tree and "
            "reported clean having opened no file"
        )
    if errors:
        problems.append(
            "module(s) raised and therefore checked nothing: "
            + "; ".join(f"{e.get('name')}: {e.get('error')}" for e in errors)
        )
    if skipped:
        problems.append(
            "module(s) were skipped: "
            + "; ".join(f"{s.get('name')}: {s.get('reason')}" for s in skipped)
        )
    if failed:
        problems.append(
            "constraint failure(s): "
            + "; ".join(
                f"{f.get('name')} [{f.get('severity')}] "
                f"({len(f.get('violations') or [])} violation(s))"
                for f in failed
            )
        )
    if problems:
        return result("FAIL", "; ".join(problems), evidence)
    return result(
        "PASS",
        f"{report.get('modules')} vendored constraint module(s) reported no failure, no error and "
        f"no skip over {inspected} inspected file(s).",
        evidence,
    )


def _read_text(path: Path) -> tuple[str | None, str]:
    if not path.is_file():
        return None, f"`{path}` is absent or is not a file"
    try:
        return path.read_text(encoding="utf-8"), ""
    except OSError as exc:
        return None, f"could not read `{path}`: {exc}"


def check_spec(
    spec_rows: list[dict] | None,
    spec_error: str | None,
    deck_src: Path,
    paper_error: str | None = None,
) -> dict:
    """R6/R7/R7c: a one-to-one join on the normalized title. Never a count, never a position."""
    if spec_rows is None:
        return result("FAIL", f"`## Slide Spec` is malformed or absent: {spec_error}")
    if paper_error is not None:
        return result("FAIL", f"`## Source Paper` is unparseable: {paper_error}")
    deck_text, err = _read_text(deck_src)
    if deck_text is None:
        return result("FAIL", f"built deck: {err}")

    built = deck_titles(deck_text)
    if not built:
        return result(
            "FAIL",
            f"built deck `{deck_src.name}` has no `=== ` slide title line; comparing an empty set "
            "against the spec is a pass having compared nothing.",
            f"spec_rows={len(spec_rows)} built_slides=0",
        )

    spec_keys = [normalize_title(r["slide"]) for r in spec_rows]
    built_keys = [normalize_title(t) for t in built]

    dup_spec = sorted({k for k in spec_keys if spec_keys.count(k) > 1})
    dup_built = sorted({k for k in built_keys if built_keys.count(k) > 1})
    if dup_spec or dup_built:
        return result(
            "FAIL",
            "the Slide Spec <-> deck join must be one-to-one, but a normalized title repeats: "
            f"spec={dup_spec} deck={dup_built}",
            f"spec_rows={len(spec_rows)} built_slides={len(built)}",
        )

    unbuilt = [r["slide"] for r in spec_rows if normalize_title(r["slide"]) not in set(built_keys)]
    unspecified = [t for t in built if normalize_title(t) not in set(spec_keys)]
    evidence = f"spec_rows={len(spec_rows)} built_slides={len(built)}"
    if unbuilt or unspecified:
        return result(
            "FAIL",
            "Slide Spec and built deck do not correspond by normalized title: "
            f"{len(unbuilt)} spec row(s) with no built slide ({'; '.join(unbuilt) or 'none'}); "
            f"{len(unspecified)} built slide(s) with no spec row ({'; '.join(unspecified) or 'none'})",
            evidence,
        )
    return result(
        "PASS",
        f"all {len(spec_rows)} Slide Spec row(s) and all {len(built)} built slide(s) correspond "
        "one-to-one by normalized title.",
        evidence,
    )


def check_note(deck_src: Path, notes_src: Path) -> dict:
    """R6: every built slide has a `== <title>` notes section under the same normalized key."""
    deck_text, err = _read_text(deck_src)
    if deck_text is None:
        return result("FAIL", f"built deck: {err}")
    notes_text, err = _read_text(notes_src)
    if notes_text is None:
        return result("FAIL", f"speaker notes: {err}")

    built = deck_titles(deck_text)
    if not built:
        return result(
            "FAIL",
            f"built deck `{deck_src.name}` has no `=== ` slide title line, so no notes key exists "
            "to check against.",
            "built_slides=0",
        )
    headings = notes_headings(notes_text)
    if not headings:
        return result(
            "FAIL",
            f"`{notes_src.name}` has no `== ` heading; an empty comparison is not a pass.",
            f"built_slides={len(built)} notes_headings=0",
        )
    keys = {normalize_title(h) for h in headings}
    missing = [t for t in built if normalize_title(t) not in keys]
    evidence = f"built_slides={len(built)} notes_headings={len(headings)}"
    if missing:
        return result(
            "FAIL",
            f"{len(missing)} built slide(s) have no `notes.typ` section under the same normalized "
            f"title key: {'; '.join(missing)}",
            evidence,
        )
    return result(
        "PASS",
        f"all {len(built)} built slide(s) have a notes section under the same normalized title key.",
        evidence,
    )


def parse_inventory_cell(cell: str) -> list[str]:
    """The whole tokens a Slide Spec `Inventory` cell names. Raises GrammarError on a non-ID token.

    Tokens are split on commas, semicolons and whitespace and compared WHOLE against the ID
    grammar, so a cell reading `F1 and F10` cannot smuggle a citation past INV as free prose.
    """
    tokens = [t.strip().strip("`") for t in re.split(r"[,;]|\s+", cell)]
    tokens = [t for t in tokens if t]
    if not tokens:
        raise GrammarError("a Slide Spec `Inventory` cell names no ID at all")
    for token in tokens:
        if not INVENTORY_ID_RE.match(token):
            raise GrammarError(
                f"Slide Spec `Inventory` cell {cell!r} names {token!r}, which is not an ID "
                "matching `^[FTRA][0-9]+$`"
            )
    return tokens


def check_inv(
    deck_src: Path,
    inventory: list[dict] | None,
    inventory_error: str | None,
    spec_rows: list[dict] | None,
    spec_error: str | None,
) -> dict:
    """R5/R7b/R11: PER-SLIDE set equality against that slide's own `Inventory` cell.

    Membership in `## Source Inventory` is the second half of the check, never the whole of it: a
    membership test lets every slide emit the same boilerplate `#inv("A1")` and report clean over a
    deck in which no slide's citations correspond to its content, which is the grep-on-prose
    weakness the emission requirement exists to remove. The emitted set of each built slide must
    EQUAL the `Inventory` cell of the Slide Spec row carrying its normalized title key, and any
    difference in either direction is a FAIL. An unmatched slide or row has nothing to compare
    against, so it fails closed rather than passing an equality nobody evaluated.
    """
    if inventory is None:
        return result(
            "FAIL",
            f"`## Source Inventory` is absent, empty or unparseable: {inventory_error}",
        )
    declared = {item["id"] for item in inventory}
    if spec_rows is None:
        return result(
            "FAIL",
            "`## Slide Spec` is malformed or absent, so no slide's `Inventory` cell exists to "
            f"compare its emitted IDs against: {spec_error}",
            f"declared={sorted(declared)}",
        )
    deck_text, err = _read_text(deck_src)
    if deck_text is None:
        return result("FAIL", f"built deck: {err}")

    slides = deck_slide_citations(deck_text)
    if not slides:
        return result(
            "FAIL",
            f"built deck `{deck_src.name}` has no `=== ` slide title line, so no slide could be "
            "checked for an `#inv(` call.",
            f"declared={sorted(declared)}",
        )

    silent = [title for title, ids, calls in slides if calls == 0]
    if silent:
        return result(
            "FAIL",
            f"{len(silent)} built slide(s) carry no `#inv(` call, so their citations cannot be "
            f"recovered at all: {'; '.join(silent)}",
            f"slides={len(slides)} declared={sorted(declared)}",
        )
    empty_calls = [title for title, ids, calls in slides if calls and not ids]
    if empty_calls:
        return result(
            "FAIL",
            f"{len(empty_calls)} built slide(s) emit an `#inv()` call with no quoted ID argument: "
            f"{'; '.join(empty_calls)}",
            f"slides={len(slides)} declared={sorted(declared)}",
        )

    cited: set[str] = set()
    for _title, ids, _calls in slides:
        cited.update(ids)
    if not cited:
        return result(
            "FAIL",
            f"built deck `{deck_src.name}` emits no inventory ID at all; an empty cited set is "
            "contained in anything, which is a pass having compared nothing.",
            f"declared={sorted(declared)}",
        )

    try:
        cells: dict[str, set[str]] = {}
        for row in spec_rows:
            key = normalize_title(row["slide"])
            if key in cells:
                raise GrammarError(
                    f"`## Slide Spec` declares the normalized title {key!r} on more than one row, "
                    "so no single `Inventory` cell belongs to that slide"
                )
            cells[key] = set(parse_inventory_cell(row["inventory"]))
    except GrammarError as exc:
        return result(
            "FAIL",
            f"a Slide Spec `Inventory` cell is unusable as an ID set: {exc}",
            f"slides={len(slides)} cited={sorted(cited)} declared={sorted(declared)}",
        )

    built_keys = [normalize_title(title) for title, _ids, _calls in slides]
    per_slide = " ".join(
        f"{normalize_title(t)!r}: emitted={sorted(set(ids))} "
        f"cell={sorted(cells.get(normalize_title(t), set()))}"
        for t, ids, _calls in slides
    )
    evidence = (
        f"slides={len(slides)} cited={sorted(cited)} declared={sorted(declared)} | {per_slide}"
    )

    problems: list[str] = []

    dup_built = sorted({k for k in built_keys if built_keys.count(k) > 1})
    if dup_built:
        problems.append(
            "the built deck repeats the normalized title(s) "
            f"{', '.join(repr(k) for k in dup_built)}, so no slide's emission maps to one row"
        )

    # Whole-token equality, never containment: `F1` must not satisfy a citation of `F10`.
    undeclared_deck = sorted(i for i in cited if i not in declared)
    if undeclared_deck:
        problems.append(
            f"{len(undeclared_deck)} ID(s) emitted by the built deck are not declared in "
            f"`## Source Inventory`: {', '.join(undeclared_deck)}"
        )
    undeclared_spec = sorted({i for cell in cells.values() for i in cell if i not in declared})
    if undeclared_spec:
        problems.append(
            f"{len(undeclared_spec)} ID(s) named by a Slide Spec `Inventory` cell are not declared "
            f"in `## Source Inventory`: {', '.join(undeclared_spec)}"
        )

    unmatched_slides = [t for t in built_keys if t not in cells]
    unmatched_rows = [k for k in cells if k not in set(built_keys)]
    if unmatched_slides:
        problems.append(
            f"{len(unmatched_slides)} built slide(s) match no Slide Spec row by normalized title, "
            "so their emitted IDs have no declared set to equal: "
            + "; ".join(unmatched_slides)
        )
    if unmatched_rows:
        problems.append(
            f"{len(unmatched_rows)} Slide Spec row(s) match no built slide, so their `Inventory` "
            "cell was never compared against anything: " + "; ".join(unmatched_rows)
        )

    # The check itself: per-slide SET EQUALITY, both directions named separately.
    diffs: list[str] = []
    compared = 0
    for title, ids, _calls in slides:
        key = normalize_title(title)
        if key not in cells:
            continue
        compared += 1
        emitted, cell = set(ids), cells[key]
        extra = sorted(emitted - cell)
        missing = sorted(cell - emitted)
        if extra or missing:
            diffs.append(
                f"{key!r}: emits {', '.join(extra) or 'nothing'} its `Inventory` cell does not "
                f"declare, and omits {', '.join(missing) or 'nothing'} that cell declares"
            )
    if diffs:
        problems.append(
            f"{len(diffs)} built slide(s) emit an ID set differing from their own Slide Spec "
            f"`Inventory` cell: {'; '.join(diffs)}"
        )
    if compared == 0:
        problems.append(
            "no built slide was matched to a Slide Spec row, so zero set comparisons were made; "
            "an empty comparison is a pass having compared nothing"
        )

    if problems:
        return result("FAIL", "; ".join(problems), evidence)
    return result(
        "PASS",
        f"each of the {compared} built slide(s) emits exactly the ID set its own Slide Spec "
        f"`Inventory` cell declares, and all {len(cited)} emitted ID(s) are declared in "
        "`## Source Inventory`, matched whole-token.",
        evidence,
    )


def compile_handout(deck_src: Path, root: Path, out_pdf: Path) -> tuple[bool, str]:
    """Compile through the wrapper + `--input handout=true` path the overflow driver uses (R9).

    A bare `typst compile slides.typ` is the overlay-expanded build, where each `#pause` step is
    its own page and most pages end mid-build: the final line of an incomplete overlay is not a
    widow, so that build measures a different property than WID specifies.
    """
    if not VALIDATION_TYP.is_file():
        return False, f"vendored `validation.typ` is absent at `{VALIDATION_TYP}`"
    slides_dir = deck_src.parent
    val_copy = slides_dir / ".workshop-widow-validation-tmp.typ"
    wrapper = slides_dir / ".workshop-widow-tmp.typ"
    try:
        shutil.copyfile(VALIDATION_TYP, val_copy)
        wrapper.write_text(
            f'#import "{val_copy.name}": validation-rules\n'
            "#show: validation-rules\n"
            f'#include "{deck_src.name}"\n',
            encoding="utf-8",
        )
        proc = subprocess.run(
            ["typst", "compile", "--root", str(root), "--input", "handout=true",
             str(wrapper), str(out_pdf)],
            capture_output=True,
            text=True,
            timeout=SUBPROCESS_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return False, f"handout compile timed out after {SUBPROCESS_TIMEOUT}s"
    except (OSError, FileNotFoundError) as exc:
        return False, f"handout compile could not run: {exc}"
    finally:
        for tmp in (val_copy, wrapper):
            try:
                tmp.unlink()
            except OSError:
                pass
    if proc.returncode != 0:
        return False, f"handout compile exited {proc.returncode}: {' '.join(proc.stderr.split())[:800]}"
    if not out_pdf.is_file() or out_pdf.stat().st_size == 0:
        return False, "handout compile reported success but produced no PDF"
    return True, ""


def check_wid(deck_src: Path, root: Path, spec_rows: list[dict] | None, spec_error: str | None) -> dict:
    """R9/R10/R11: the handout build, an inequality on pages, and a floor on pages scanned."""
    if shutil.which("typst") is None:
        return result(
            "FAIL",
            "`typst` is not on PATH, so the handout build could not be produced and no page was "
            "scanned.",
        )
    try:
        from pypdf import PdfReader
    except Exception as exc:  # noqa: BLE001 - an unimportable reader is a FAIL, never a skip
        return result("FAIL", f"`pypdf` is unimportable, so no page text could be extracted: {exc}")
    if spec_rows is None:
        return result(
            "FAIL",
            "the Slide Spec body-row count is unknown, so neither the page-count floor nor the "
            f"scanned floor has a value to be checked against: {spec_error}",
        )
    body_rows = len(spec_rows)
    dividers = {normalize_title(r["section"]) for r in spec_rows}
    if not deck_src.is_file():
        return result("FAIL", f"built deck `{deck_src}` is absent or is not a file.")

    with tempfile.TemporaryDirectory() as tmpdir:
        out_pdf = Path(tmpdir) / "handout.pdf"
        ok, reason = compile_handout(deck_src, root, out_pdf)
        if not ok:
            return result("FAIL", reason)
        try:
            reader = PdfReader(str(out_pdf))
            pages = list(reader.pages)
        except Exception as exc:  # noqa: BLE001 - an unreadable PDF is a FAIL, never a skip
            return result("FAIL", f"handout PDF could not be read: {exc}")
        n_pages = len(pages)

        # R10: an INEQUALITY. The title slide and section dividers own no spec row, so a
        # conforming deck has strictly more pages than rows; an equality test would be
        # permanently red, which is how a check gets waived.
        if n_pages == 0 or n_pages < body_rows:
            return result(
                "FAIL",
                f"the handout build has {n_pages} page(s) but the Slide Spec has {body_rows} body "
                "row(s); the page count is the floor, so fewer pages than rows means the "
                "measurement substrate is wrong.",
                f"pages={n_pages} body_rows={body_rows}",
            )

        skipped: list[str] = []
        scanned = 0
        blank: list[int] = []
        widows: list[str] = []
        for idx, page in enumerate(pages, start=1):
            if idx == 1:
                skipped.append("page 1: title slide")
                continue
            try:
                text = page.extract_text() or ""
            except Exception as exc:  # noqa: BLE001
                return result("FAIL", f"page {idx}: text extraction raised {type(exc).__name__}: {exc}")
            lines = text.split("\n")
            while lines and not lines[-1].strip():
                lines.pop()
            lines = [ln for ln in lines if ln.strip()]
            if not lines:
                blank.append(idx)
                continue
            if len(lines) == 1 and normalize_title(lines[0]) in dividers:
                skipped.append(f"page {idx}: section divider {normalize_title(lines[0])!r}")
                continue
            scanned += 1
            final = lines[-1].strip()
            tokens = final.split()
            if len(tokens) == 1 and len(tokens[0]) <= WIDOW_MAX_TOKEN_CHARS:
                widows.append(f"page {idx}: {tokens[0]!r}")

    evidence = (
        f"pages={n_pages} body_rows={body_rows} scanned={scanned} skipped={len(skipped)} "
        f"[{'; '.join(skipped) or 'none'}] threshold<={WIDOW_MAX_TOKEN_CHARS} chars"
    )
    if blank:
        return result(
            "FAIL",
            f"{len(blank)} handout page(s) yield no extractable text at all (page(s) "
            f"{', '.join(str(p) for p in blank)}); zero text means zero widows, which is clean "
            "because nothing was measured. A no-text page is a FAIL, not a skip.",
            evidence,
        )
    # The exemption path needs its own floor: a skip-everything bug scans nothing and reports
    # clean, which is the vacuous-pass defect class reappearing inside the check.
    if scanned == 0 or scanned < body_rows:
        return result(
            "FAIL",
            f"only {scanned} handout page(s) were actually scanned against {body_rows} Slide Spec "
            "body row(s); skipping is bounded, and a scan that covers fewer pages than there are "
            "slides certifies nothing.",
            evidence,
        )
    if widows:
        return result("FAIL", f"{len(widows)} widow line(s): {'; '.join(widows)}", evidence)
    return result(
        "PASS",
        f"no widow line across the {scanned} handout page(s) actually scanned.",
        evidence,
    )


PHYSICAL_PAGES_RE = re.compile(r"Physical pages:\s*(\d+)")
NO_METADATA = "No validation metadata found"


def check_ovr(deck_src: Path) -> dict:
    """R2/R11: read the driver's exit code STRICTLY, then require it to have measured pages.

    0 = no overflow, 1 = overflow, and ANYTHING ELSE -- 2, a timeout, a missing `typst`, a missing
    vendored `validation.typ` -- is FAIL CLOSED. Exit 0 alone is insufficient: the driver prints
    `No validation metadata found` and exits 0 having measured nothing, and `overflow.py` prints
    `Physical pages: 0` and exits 0 on empty input.
    """
    if not OVERFLOW_DRIVER.is_file():
        return result("FAIL", f"vendored overflow driver is absent at `{OVERFLOW_DRIVER}`.")
    if not VALIDATION_TYP.is_file():
        return result(
            "FAIL",
            f"vendored `validation.typ` is absent at `{VALIDATION_TYP}`; the driver exits 2 "
            "without it and nothing would be measured.",
        )
    if not deck_src.is_file():
        return result("FAIL", f"built deck `{deck_src}` is absent or is not a file.")
    try:
        proc = subprocess.run(
            ["bash", str(OVERFLOW_DRIVER), str(deck_src)],
            capture_output=True,
            text=True,
            timeout=SUBPROCESS_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return result(
            "FAIL",
            f"overflow driver timed out after {SUBPROCESS_TIMEOUT}s; a timeout is not a clean run.",
        )
    except (OSError, FileNotFoundError) as exc:
        return result("FAIL", f"overflow driver could not be run: {exc}")

    output = proc.stdout + proc.stderr
    flat = " ".join(output.split())[:1500]
    evidence = f"exit={proc.returncode} output={flat or '(empty)'}"

    if proc.returncode == 1:
        return result("FAIL", "the overflow driver reports frame overflow.", evidence)
    if proc.returncode != 0:
        return result(
            "FAIL",
            f"the overflow driver exited {proc.returncode}, which is neither 0 (clean) nor 1 "
            "(overflow): it could not run, so nothing was measured.",
            evidence,
        )
    if NO_METADATA in output:
        return result(
            "FAIL",
            f"the overflow driver exited 0 but printed {NO_METADATA!r}: it emitted no validation "
            "metadata, so it measured nothing.",
            evidence,
        )
    match = PHYSICAL_PAGES_RE.search(output)
    if match is None:
        return result(
            "FAIL",
            "the overflow driver exited 0 but reported no physical page count, so there is no "
            "evidence it examined a page.",
            evidence,
        )
    if int(match.group(1)) == 0:
        return result(
            "FAIL",
            "the overflow driver exited 0 while reporting `Physical pages: 0`: a clean verdict "
            "over zero pages is a pass having measured nothing.",
            evidence,
        )
    return result(
        "PASS",
        f"the overflow driver reports no frame-overflowing slide over {match.group(1)} physical "
        "page(s).",
        evidence,
    )


def check_enum(checks: dict) -> dict:
    """Computed, not claimed: a line for every matrix ID, and MODEL-EVALUATED for the model IDs."""
    if not MATRIX or not checks:
        return result(
            "FAIL",
            "the emitted line set or the matrix is empty; an enumeration over nothing enumerates "
            "nothing.",
        )
    missing = [c for c in MATRIX if c != "ENUM" and c not in checks]
    if missing:
        return result("FAIL", f"No line emitted for {len(missing)} matrix check(s): {', '.join(missing)}.")
    mislabelled = [
        f"{c}={checks[c].get('status')}"
        for c in MODEL_EVALUATED
        if checks[c].get("status") != "MODEL-EVALUATED"
    ]
    if mislabelled:
        return result(
            "FAIL",
            f"{len(mislabelled)} judgement check(s) were not reported as MODEL-EVALUATED: "
            f"{', '.join(mislabelled)}. FID, CONV and VIS are judgements; routing one through a "
            "computed status makes the probe claim it settled what it did not.",
        )
    return result(
        "PASS",
        f"A line was emitted for all {len(MATRIX)} matrix checks, and FID/CONV/VIS carry "
        "MODEL-EVALUATED status.",
        " ".join(f"{c}={checks[c]['status']}" for c in MATRIX if c != "ENUM"),
    )


# --------------------------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------------------------


def all_fail(reason: str) -> dict:
    checks: dict[str, dict] = {}
    for check in MATRIX:
        if check in MODEL_EVALUATED:
            checks[check] = model_line(check)
        elif check != "ENUM":
            checks[check] = result("FAIL", reason)
    checks["ENUM"] = check_enum(checks)
    return {c: checks[c] for c in MATRIX}


def guarded(check: str, fn, *args) -> dict:
    """Run one check, turning any unexpected exception into that check's own FAIL line.

    A traceback out of a single check would abort the whole probe and emit ZERO lines, which a gate
    parses as "no checks" rather than "could not check" -- the silence-looks-like-a-pass shape.
    """
    try:
        return fn(*args)
    except Exception as exc:  # noqa: BLE001 - an unexpected raise is this check's FAIL, never a crash
        return result(
            "FAIL",
            f"the `{check}` check raised {type(exc).__name__}: {exc}. An unexpected raise means "
            "the dimension was not measured.",
            " ".join(traceback.format_exc().split())[:1500],
        )


def run(plan_text: str, root: Path, slides_override: str | None, notes_override: str | None) -> dict:
    """Wrapper: any escape from the check pipeline still yields a full, all-FAIL line set."""
    try:
        return _run(plan_text, root, slides_override, notes_override)
    except Exception as exc:  # noqa: BLE001 - the contract is a full line set, never a traceback
        report = {
            "_declared": {
                "project_dir": str(root),
                "internal_error": f"{type(exc).__name__}: {exc}",
                "traceback": " ".join(traceback.format_exc().split())[:2000],
            }
        }
        report.update(all_fail(
            f"the probe raised {type(exc).__name__} before it could measure this dimension: {exc}"
        ))
        return report


def _run(plan_text: str, root: Path, slides_override: str | None, notes_override: str | None) -> dict:
    def resolve(rel: str) -> Path:
        p = Path(rel).expanduser()
        return p if p.is_absolute() else root / p

    try:
        declared = parse_outputs(plan_text)
    except GrammarError as exc:
        report = {"_declared": {"project_dir": str(root), "outputs_error": str(exc)}}
        report.update(all_fail(f"`## Outputs and Verification` is unparseable: {exc}"))
        return report

    declared_resolved = {str(resolve(p).resolve()) for p in declared.values()}
    deck_src = resolve(slides_override or declared["deck"])
    notes_src = resolve(notes_override or declared["notes"])
    deck_pdf = resolve(declared["deck-pdf"])
    notes_pdf = resolve(declared["notes-pdf"])

    # Opening an artifact no row declares is a FAIL: the overrides exist for testing, not to let
    # the probe wander off the approved plan's declaration.
    undeclared = [str(p) for p in (deck_src, notes_src) if str(p.resolve()) not in declared_resolved]
    if undeclared:
        report = {"_declared": {"project_dir": str(root), "declared": declared}}
        report.update(all_fail(
            f"the probe was pointed at {', '.join(undeclared)}, which "
            "`## Outputs and Verification` never declared."
        ))
        return report

    spec_rows: list[dict] | None
    spec_error: str | None = None
    try:
        spec_rows = parse_slide_spec(plan_text)
    except GrammarError as exc:
        spec_rows, spec_error = None, str(exc)

    inventory: list[dict] | None
    inventory_error: str | None = None
    try:
        inventory = parse_source_inventory(plan_text)
    except GrammarError as exc:
        inventory, inventory_error = None, str(exc)

    paper: dict[str, str] | None
    paper_error: str | None = None
    try:
        paper = parse_source_paper(plan_text, root)
    except GrammarError as exc:
        paper, paper_error = None, str(exc)

    checks: dict[str, dict] = {}
    checks["CMP"] = guarded("CMP", check_cmp, deck_src, notes_src, deck_pdf, notes_pdf, root)
    checks["CON"] = guarded("CON", check_con, deck_src.parent)
    checks["SPEC"] = guarded("SPEC", check_spec, spec_rows, spec_error, deck_src, paper_error)
    checks["NOTE"] = guarded("NOTE", check_note, deck_src, notes_src)
    checks["INV"] = guarded(
        "INV", check_inv, deck_src, inventory, inventory_error, spec_rows, spec_error
    )
    checks["WID"] = guarded("WID", check_wid, deck_src, root, spec_rows, spec_error)
    checks["OVR"] = guarded("OVR", check_ovr, deck_src)
    for check in MODEL_EVALUATED:
        checks[check] = model_line(check)
    checks["ENUM"] = check_enum(checks)

    report = {
        "_declared": {
            "project_dir": str(root),
            "declared": declared,
            "deck_src": str(deck_src),
            "notes_src": str(notes_src),
            "deck_pdf": str(deck_pdf),
            "notes_pdf": str(notes_pdf),
            "presentation_dir": str(deck_src.parent),
            "slide_spec_rows": len(spec_rows) if spec_rows else 0,
            "inventory_ids": sorted(i["id"] for i in inventory) if inventory else [],
            "source_paper": paper if paper is not None else {"error": paper_error},
        }
    }
    report.update({c: checks[c] for c in MATRIX})
    return report


def format_lines(report: dict) -> list[str]:
    """Exactly one line per MATRIX ID, in matrix order. Silence looks exactly like a pass."""
    lines = []
    for check in MATRIX:
        entry = report.get(check) or result("FAIL", f"no line was produced for {check}.")
        detail = " ".join(str(entry.get("detail", "")).split())
        evidence = " ".join(str(entry.get("evidence", "")).split())
        lines.append(f"[{check}] {entry.get('status')} | {detail} | {evidence}")
    return lines


# --------------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="workshop-deck.py",
        description=(
            "Compute the mechanical workshop deck checks (CMP, CON, SPEC, NOTE, INV, WID, OVR, "
            "ENUM) over the artifacts declared in an approved /workshop plan's "
            "`## Outputs and Verification` table. FID, CONV and VIS are enumerated as "
            "MODEL-EVALUATED and are never computed."
        ),
        epilog="Exits non-zero iff a COMPUTED check FAILs. Every computed check fails closed.",
    )
    parser.add_argument("--plan", required=True, help="Path to the approved plan.")
    parser.add_argument("--project-dir", default=".", help="Root the declared paths are relative to.")
    parser.add_argument("--slides", help="Override the deck source path (testing). Must still be declared.")
    parser.add_argument("--notes", help="Override the notes source path (testing). Must still be declared.")
    parser.add_argument("--json", dest="json_path", help="Also write the full report as JSON to this path.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.project_dir).expanduser().resolve()
    plan_path = Path(args.plan).expanduser()

    try:
        plan_text = plan_path.read_text(encoding="utf-8")
    except OSError as exc:
        # An unreadable plan still emits every line: a bare stderr message leaves a gate reading
        # empty stdout, which parses as "no checks" rather than "could not check".
        report = {"_declared": {"project_dir": str(root), "plan_error": str(exc)}}
        report.update(all_fail(f"could not read the approved plan `{plan_path}`: {exc}"))
    else:
        report = run(plan_text, root, args.slides, args.notes)

    for line in format_lines(report):
        print(line)
    if args.json_path:
        Path(args.json_path).expanduser().write_text(
            json.dumps(report, indent=2, sort_keys=False), encoding="utf-8"
        )

    failed = any(
        isinstance(entry, dict) and entry.get("status") == "FAIL"
        for key, entry in report.items()
        if key != "_declared"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
