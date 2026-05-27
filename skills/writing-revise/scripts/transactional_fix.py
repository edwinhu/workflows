#!/usr/bin/env -S uv run --with lxml python3
"""Transactional fix engine for prose-rhythm-loop fixes (and similar
structured-tuple revise passes) inside /writing-revise.

Reads a YAML fix-list from `.planning/prose-rhythm/AUDIT.md` and applies
all fixes to a .docx (or .md) in a single transaction. Validates every
needle before applying any edit, cross-checks against PINS.md, saves
exactly once at the end. Logs each applied fix to CHANGELOG.md.

Iron laws enforced:

1. **Transactional save:** every `target_text` must validate (count == 1)
   before ANY edit is applied. If any needle fails, the entire batch is
   aborted and the failure is surfaced. No partial saves.

2. **Footnote/bookmark pin respect:** every proposed `target_text` is
   cross-referenced against PINS.md spans. If a fix's text overlaps a
   pinned span without an explicit `preserve_pin: <ref_id>` field, it is
   refused — preventing silent NOTEREF orphaning.

3. **Structured fix-targeting only:** the fix-list YAML schema requires
   (paragraph_index, sentence_idx, dimension, target_text, new_text).
   Natural-language fix descriptions are rejected.

Usage:
    transactional_fix.py --draft path/to/draft.docx \\
                         --state-dir .planning/prose-rhythm \\
                         --iteration 3

Exit codes:
    0 — all fixes applied + saved + logged
    1 — validation failed (specific needle reasons in stderr); nothing saved
    2 — pin conflict (lists offending fixes); nothing saved
    3 — IO/zipfile error; nothing saved
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML required. Install via `uv add pyyaml` or run via "
          "`uv run --with pyyaml --with lxml python3 ...`", file=sys.stderr)
    sys.exit(3)


@dataclass
class Fix:
    paragraph_index: int
    sentence_idx: int | None
    dimension: str
    action: str
    target_text: str
    new_text: str
    rationale: str = ""
    preserve_pin: str | None = None


def parse_fix_list(audit_md: Path, iteration: int) -> list[Fix]:
    """Extract the structured fix-list YAML block for the given iteration
    from AUDIT.md. The block must be tagged with `## Iteration N` and
    contain a `fixes:` YAML key."""
    text = audit_md.read_text(encoding="utf-8")
    # Find the iteration section
    header_re = re.compile(rf"^##\s+Iteration\s+{iteration}\b", re.MULTILINE)
    m = header_re.search(text)
    if not m:
        raise SystemExit(
            f"AUDIT.md has no `## Iteration {iteration}` section.")
    # Use a negative lookahead to exclude "## Iteration N Summary" which
    # would otherwise truncate the section before its fixes block.
    next_m = re.search(r"^##\s+Iteration\s+\d+(?!\s+Summary)\b",
                       text[m.end():], re.MULTILINE)
    section = text[m.end():m.end() + next_m.start()] if next_m else text[m.end():]

    # Preferred: ```yaml ... ``` block containing `fixes:`
    yaml_blocks = re.findall(r"```ya?ml\s*\n(.*?)\n```", section, re.DOTALL)
    fix_block = None
    for blk in yaml_blocks:
        if "fixes:" in blk:
            fix_block = blk
            break

    # Fallback 1: bare `fixes: []` on its own line (auditor sometimes drops it
    # outside a fence when there are no fixes to emit).
    if fix_block is None:
        m = re.search(r"^\s*fixes:\s*\[\s*\]\s*$", section, re.MULTILINE)
        if m:
            fix_block = "fixes: []"

    # Fallback 2: bare `fixes:` followed by a list (auditor dropped the fence
    # but the YAML is still parseable from the line).
    if fix_block is None:
        m = re.search(
            r"^(\s*fixes:\s*\n(?:\s*-\s+.*\n(?:\s+[^\n]*\n)*)+)",
            section, re.MULTILINE)
        if m:
            fix_block = m.group(1)

    if fix_block is None:
        raise SystemExit(
            f"Iteration {iteration} section in AUDIT.md has no `fixes:` "
            "block (looked for ```yaml fence, bare `fixes: []`, and bare "
            "`fixes:` list). The auditor must emit a structured fix-tuple "
            "block — even an empty list (`fixes: []`) is fine.")

    data = yaml.safe_load(fix_block)
    if not isinstance(data, dict) or "fixes" not in data:
        raise SystemExit("Malformed YAML: top-level `fixes:` key missing.")
    # `fixes: []` parses to {"fixes": None} in some YAML versions — normalize.
    if data["fixes"] is None:
        data["fixes"] = []

    fixes = []
    for i, raw in enumerate(data["fixes"]):
        if not isinstance(raw, dict):
            raise SystemExit(f"Fix #{i} is not a mapping.")
        required = ["paragraph_index", "dimension", "action", "target_text", "new_text"]
        missing = [k for k in required if k not in raw]
        if missing:
            raise SystemExit(
                f"Fix #{i} missing required fields: {missing}. "
                "All fixes must be structured tuples.")
        fixes.append(Fix(
            paragraph_index=int(raw["paragraph_index"]),
            sentence_idx=raw.get("sentence_idx"),
            dimension=raw["dimension"],
            action=raw["action"],
            target_text=raw["target_text"],
            new_text=raw["new_text"],
            rationale=raw.get("rationale", ""),
            preserve_pin=raw.get("preserve_pin"),
        ))
    return fixes


def load_pins(pins_md: Path) -> list[dict[str, Any]]:
    """Read PINS.md and return list of pin spans. Format expected:

    ```yaml
    pins:
      - paragraph_index: 5
        sentence_idx: 3
        ref_id: _Ref_fn13
        span_text_around: "...active electorate."
    ```
    """
    if not pins_md.exists():
        return []
    text = pins_md.read_text(encoding="utf-8")
    blocks = re.findall(r"```ya?ml\s*\n(.*?)\n```", text, re.DOTALL)
    for blk in blocks:
        if "pins:" in blk:
            data = yaml.safe_load(blk)
            return data.get("pins", []) or []
    return []


def is_docx(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            if f.read(4) != b"PK\x03\x04":
                return False
        with zipfile.ZipFile(path) as z:
            return "word/document.xml" in z.namelist()
    except (OSError, zipfile.BadZipFile):
        return False


def validate_needles(draft_xml: str, fn_xml: str, fixes: list[Fix]) -> list[str]:
    """Each target_text must occur exactly once in either document.xml or
    footnotes.xml combined namespace. Return list of error strings (empty
    if all valid)."""
    errors = []
    for i, fix in enumerate(fixes):
        if not fix.target_text:
            # Insertions don't need needle validation, but they need a
            # paragraph anchor. Skip needle check.
            continue
        doc_count = draft_xml.count(fix.target_text)
        fn_count = fn_xml.count(fix.target_text)
        total = doc_count + fn_count
        if total == 0:
            errors.append(
                f"Fix #{i} (¶{fix.paragraph_index} {fix.dimension}): "
                f"needle not found: {fix.target_text[:80]!r}")
        elif total > 1:
            errors.append(
                f"Fix #{i} (¶{fix.paragraph_index} {fix.dimension}): "
                f"needle is ambiguous ({total} matches): "
                f"{fix.target_text[:80]!r}. Use a longer context window.")
    return errors


def check_pin_conflicts(fixes: list[Fix], pins: list[dict[str, Any]]) -> list[str]:
    """For each fix without `preserve_pin`, check if its target_text
    overlaps any pin's `span_text_around`."""
    conflicts = []
    for i, fix in enumerate(fixes):
        if fix.preserve_pin:
            continue  # User explicitly handled this
        for pin in pins:
            pin_text = pin.get("span_text_around", "")
            if not pin_text or not fix.target_text:
                continue
            # Overlap heuristic: any pin span shares ≥30 chars with target
            for window in range(min(len(pin_text), len(fix.target_text)) - 30 + 1):
                substr = pin_text[window:window + 30]
                if substr and substr in fix.target_text:
                    conflicts.append(
                        f"Fix #{i} (¶{fix.paragraph_index} {fix.dimension}): "
                        f"target_text overlaps pin {pin.get('ref_id', '?')} "
                        f"at ¶{pin.get('paragraph_index', '?')}. "
                        f"Add `preserve_pin: {pin.get('ref_id', '?')}` to "
                        "the fix tuple and specify how the citation is preserved, "
                        "or choose a different target_text.")
                    break
    return conflicts


def apply_fixes(doc_path: Path, fixes: list[Fix]) -> tuple[int, int]:
    """Apply all fixes in one transaction. Returns (doc_changes, fn_changes)."""
    with zipfile.ZipFile(doc_path) as z:
        members = {n: z.read(n) for n in z.namelist()}

    doc_xml = members["word/document.xml"].decode("utf-8")
    fn_xml = members.get("word/footnotes.xml", b"").decode("utf-8")

    doc_changes = 0
    fn_changes = 0
    for fix in fixes:
        if not fix.target_text:
            # Pure insertion — caller-specific; skip in this engine
            continue
        if doc_xml.count(fix.target_text) == 1:
            doc_xml = doc_xml.replace(fix.target_text, fix.new_text, 1)
            doc_changes += 1
        elif fn_xml and fn_xml.count(fix.target_text) == 1:
            fn_xml = fn_xml.replace(fix.target_text, fix.new_text, 1)
            fn_changes += 1
        else:
            # Should not happen — validate_needles caught this
            raise SystemExit(
                f"Internal error: needle disappeared between validation and "
                f"apply for fix: {fix.target_text[:80]!r}")

    members["word/document.xml"] = doc_xml.encode("utf-8")
    if fn_xml:
        members["word/footnotes.xml"] = fn_xml.encode("utf-8")

    tmp = doc_path.with_suffix(doc_path.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)
    os.replace(tmp, doc_path)
    return doc_changes, fn_changes


def append_changelog(changelog: Path, iteration: int, fixes: list[Fix],
                     applied_indices: list[int]) -> None:
    lines = [f"\n## Iteration {iteration} → {iteration + 1}\n"]
    for i in applied_indices:
        fix = fixes[i]
        lines.append(
            f"- ¶{fix.paragraph_index}"
            + (f" S{fix.sentence_idx}" if fix.sentence_idx is not None else "")
            + f" | dim={fix.dimension} | action={fix.action}"
            + (f" | preserve_pin={fix.preserve_pin}" if fix.preserve_pin else "")
            + (f" | rationale: {fix.rationale}" if fix.rationale else "")
        )
    with changelog.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    p = argparse.ArgumentParser(
        description="Transactional fix engine for rhythm-pass (and similar "
                    "structured-tuple fix lists) inside /writing-revise.")
    p.add_argument("--draft", required=True, type=Path,
                   help="Path to .docx (or .md) draft to edit.")
    p.add_argument("--state-dir", required=True, type=Path,
                   help="Directory containing AUDIT.md, PINS.md, CHANGELOG.md.")
    p.add_argument("--iteration", required=True, type=int,
                   help="Iteration number to apply fixes from.")
    p.add_argument("--dry-run", action="store_true",
                   help="Validate + check pins, but do not write the docx.")
    args = p.parse_args()

    state = args.state_dir
    if not state.is_dir():
        sys.exit(f"State dir not found: {state}")

    audit_md = state / "AUDIT.md"
    pins_md = state / "PINS.md"
    changelog = state / "CHANGELOG.md"
    fixcomplete = state / f"FIX_COMPLETE_{args.iteration}.md"

    if not audit_md.exists():
        sys.exit(f"AUDIT.md not found at {audit_md}")
    if not args.draft.exists():
        sys.exit(f"Draft not found at {args.draft}")
    if not is_docx(args.draft):
        sys.exit(f"Draft is not a .docx (only .docx supported in this engine): "
                 f"{args.draft}")

    fixes = parse_fix_list(audit_md, args.iteration)
    if not fixes:
        print(f"No fixes in iteration {args.iteration}; nothing to do.",
              file=sys.stderr)
        sys.exit(0)
    print(f"Loaded {len(fixes)} fix(es) from AUDIT.md iteration {args.iteration}",
          file=sys.stderr)

    # Read draft XML
    with zipfile.ZipFile(args.draft) as z:
        doc_xml = z.read("word/document.xml").decode("utf-8")
        try:
            fn_xml = z.read("word/footnotes.xml").decode("utf-8")
        except KeyError:
            fn_xml = ""

    # Iron Law 1: validate all needles
    errors = validate_needles(doc_xml, fn_xml, fixes)
    if errors:
        print("\nVALIDATION FAILED — nothing saved:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    print(f"  ✓ All {len(fixes)} needle(s) validated", file=sys.stderr)

    # Iron Law 2: check pin conflicts
    pins = load_pins(pins_md)
    conflicts = check_pin_conflicts(fixes, pins)
    if conflicts:
        print("\nPIN CONFLICT — nothing saved:", file=sys.stderr)
        for c in conflicts:
            print(f"  ✗ {c}", file=sys.stderr)
        sys.exit(2)
    if pins:
        print(f"  ✓ Pin check passed ({len(pins)} pin(s) registered)",
              file=sys.stderr)

    if args.dry_run:
        print("\nDry run — fixes validated and pin-checked, not applied.",
              file=sys.stderr)
        sys.exit(0)

    # Apply transactionally
    try:
        doc_n, fn_n = apply_fixes(args.draft, fixes)
    except Exception as e:
        print(f"\nAPPLY FAILED: {e}", file=sys.stderr)
        sys.exit(3)

    applied_indices = [i for i, f in enumerate(fixes) if f.target_text]
    append_changelog(changelog, args.iteration, fixes, applied_indices)

    # Write FIX_COMPLETE_N.md gate artifact
    fixcomplete.write_text(
        f"---\n"
        f"status: APPROVED\n"
        f"iteration: {args.iteration}\n"
        f"fixes_applied: {len(applied_indices)}\n"
        f"document_changes: {doc_n}\n"
        f"footnote_changes: {fn_n}\n"
        f"---\n\n"
        f"All {len(applied_indices)} fix(es) from iteration {args.iteration} "
        f"applied transactionally. {doc_n} change(s) in document.xml, "
        f"{fn_n} change(s) in footnotes.xml.\n",
        encoding="utf-8"
    )
    print(f"\n✓ {len(applied_indices)} fix(es) applied "
          f"({doc_n} doc, {fn_n} fn). Logged to CHANGELOG.md. "
          f"Gate artifact: {fixcomplete}", file=sys.stderr)


if __name__ == "__main__":
    main()
