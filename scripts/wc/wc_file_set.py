#!/usr/bin/env -S uv run python3
"""
wc_file_set.py — deterministically enumerate the file SET Mode 1 Step 6 must generate
for a workflow, from the canonical "## Generation Manifest" section of its DESIGN.md.

This is wc-creator eating its own cooking: it applies the same spec→deterministic-compile
discipline wc-creator teaches every workflow (P22/P23/P28) to its OWN file generation. The
file SET (WHICH files) is a pure function of (workflow name × phases × midpoint × constraints
× the fixed conventions) — so an LLM should NOT re-enumerate it each run (that masks drift).
The per-file SPEC (WHAT each file contains) stays semantic — wc-generate's transform agents
read DESIGN prose for it; only the SET is made deterministic here.

SINGLE SOURCE OF TRUTH (P23): wc-generate.js's Discover runs this for the authoritative set,
and a generation guard can import `parse_design()` (validate = parse_design(text).violations)
so "compiles ⇔ passes gate". Emitter-canonical (P28): Mode 1 Step 3b writes the manifest
born-canonical into DESIGN.md; this parser tolerates light formatting as a back-compat shim.

Manifest format (in DESIGN.md):

    ## Generation Manifest
    <!-- wc-generate enumerates the file set from this section. Keep it canonical. -->
    workflow: myflow
    midpoint: fix                 # one of: fix | debug | revise | none
    phases: explore, design, implement
    constraints:
    - no-skip-tests | testable
    - naming-convention | convention

Usage:
  wc_file_set.py DESIGN.md [--project DIR] [--check]
    default : print {"ok", "files":[{fileId,path,kind}], "violations":[...]} as JSON; exit 0 iff ok
    --check : print only violations (one per line); exit 0 iff none (guard mode)

If there is no "## Generation Manifest" section, ok=false with a single violation — the caller
(wc-generate) then falls back to LLM enumeration (back-compat for pre-manifest DESIGNs).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

_MIDPOINTS = {"fix", "debug", "revise", "none"}
_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass
class FileSet:
    files: list[dict] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations


def _manifest_block(text: str) -> str | None:
    """Return the body of the '## Generation Manifest' section (up to the next heading), or None."""
    m = re.search(r"^##\s+Generation Manifest\s*$", text, re.M | re.I)
    if not m:
        return None
    start = m.end()
    nxt = re.search(r"^#{1,6}\s+\S", text[start:], re.M)
    return text[start: start + nxt.start()] if nxt else text[start:]


def _field(body: str, key: str) -> str | None:
    # [ \t] (not \s) so an empty value doesn't swallow the next line's content.
    m = re.search(rf"^[ \t]*{key}[ \t]*:[ \t]*(\S.*?)[ \t]*$", body, re.M | re.I)
    return m.group(1).strip() if m else None


def parse_design(text: str, project: Path | None = None) -> FileSet:
    """Deterministically enumerate the file set from DESIGN.md's Generation Manifest."""
    fs = FileSet()
    body = _manifest_block(text)
    if body is None:
        fs.violations.append("no '## Generation Manifest' section in DESIGN.md")
        return fs

    name = _field(body, "workflow")
    midpoint = (_field(body, "midpoint") or "fix").lower()
    phases_raw = _field(body, "phases") or ""

    if not name:
        fs.violations.append("manifest: missing `workflow:` name")
    elif not _SLUG.match(name):
        fs.violations.append(f"manifest: workflow name `{name}` is not a kebab-case slug")
    if midpoint not in _MIDPOINTS:
        fs.violations.append(f"manifest: midpoint `{midpoint}` not in {{fix, debug, revise, none}}")

    phases = [p.strip() for p in re.split(r"[,\n]", phases_raw) if p.strip()]
    if not phases:
        fs.violations.append("manifest: no `phases:` listed (a workflow needs ≥1 phase)")
    for p in phases:
        if not _SLUG.match(p):
            fs.violations.append(f"manifest: phase `{p}` is not a kebab-case slug")
    if len(phases) != len(set(phases)):
        fs.violations.append("manifest: duplicate phase names")

    # constraints: lines under a `constraints:` key, each `- <name> | testable|convention`
    constraints: list[tuple[str, bool]] = []
    cm = re.search(r"^\s*constraints\s*:\s*$", body, re.M | re.I)
    if cm:
        for line in body[cm.end():].splitlines():
            ls = line.strip()
            if not ls.startswith("-"):
                if ls and not ls.startswith("#"):
                    break  # left the constraints block
                continue
            item = ls.lstrip("-").strip()
            parts = [x.strip() for x in item.split("|")]
            cname = parts[0]
            kind = (parts[1].lower() if len(parts) > 1 else "convention")
            if not _SLUG.match(cname):
                fs.violations.append(f"manifest: constraint `{cname}` is not a kebab-case slug")
                continue
            constraints.append((cname, kind == "testable"))
    cnames = [c for c, _ in constraints]
    if len(cnames) != len(set(cnames)):
        fs.violations.append("manifest: duplicate constraint names")

    if fs.violations:
        return fs  # don't emit a partial/garbage set

    root = Path(project) if project else Path(".")

    def add(file_id: str, rel: str, kind: str) -> None:
        fs.files.append({"fileId": file_id, "path": str(root / rel), "kind": kind})

    add(f"skill:{name}", f"skills/{name}/SKILL.md", "skill-entry")
    if midpoint != "none":
        add(f"skill:{name}-{midpoint}", f"skills/{name}-{midpoint}/SKILL.md", "skill-midpoint")
    for p in phases:
        add(f"skill:{name}-{p}", f"skills/{name}-{p}/SKILL.md", "skill-phase")
    for cname, testable in constraints:
        add(f"constraint:{cname}.md", f"references/constraints/{cname}.md", "constraint-md")
        if testable:
            add(f"constraint:{cname}.py", f"references/constraints/{cname}.py", "constraint-py")
    if constraints:
        add("runner:check-all.py", "references/constraints/check-all.py", "runner")

    return fs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("design")
    ap.add_argument("--project")
    ap.add_argument("--check", action="store_true", help="guard mode: print violations only, exit 0 iff none")
    a = ap.parse_args()

    design_path = Path(a.design).resolve()
    if not design_path.is_file():
        print(f"DESIGN.md not found: {design_path}", file=sys.stderr)
        return 2
    project = Path(a.project).resolve() if a.project else design_path.parent
    fs = parse_design(design_path.read_text(), project)

    if a.check:
        for v in fs.violations:
            print(v)
        return 0 if fs.ok else 1

    print(json.dumps({"ok": fs.ok, "files": fs.files, "violations": fs.violations},
                     ensure_ascii=False, indent=2))
    return 0 if fs.ok else 1


if __name__ == "__main__":
    sys.exit(main())
