#!/usr/bin/env -S uv run python3
"""Constraint: writing-outline-sync — OUTLINE.md section structure and
empirical numbers should match the draft files in drafts/.

Phase-aware framing (reads .planning/ACTIVE_WORKFLOW.md for phase:):
  - outline / setup / draft : OUTLINE is canonical (plan leads prose)
  - review / revise / validate / complete : drafts are canonical (prose leads plan)
  - unknown / missing : default to drafts-canonical

Three structural checks:
  1. Draft file with no ### section in OUTLINE, or OUTLINE ### with no draft.
  2. Draft ## subsection letter (A., B., ...) not in OUTLINE's subsection list.
     Also flags OUTLINE letters absent from draft (planned but unwritten).
  3. Draft ### sub-subsection whose key phrase is absent from OUTLINE body.

One number-anchoring check:
  4. Empirical numbers in OUTLINE Introduction / Conclusion bullets not found
     in any draft (stale restatement). Scoped to Preview/Restatement bullets;
     skips Key-Sources, Claim-to-Part Map, citation-lead lines.

Severity: soft — advisory, always exits 0.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

CONSTRAINT = "writing-outline-sync"
APPLIES_TO = ["writing-draft", "writing-verify", "writing-revise"]
SEVERITY = "soft"

# Phase sets
_OUTLINE_CANONICAL = frozenset({"setup", "outline", "draft"})
_DRAFT_CANONICAL = frozenset({"review", "revise", "validate", "complete"})

# Number patterns
_NUM_SIGNAL = re.compile(
    r"\d+(?:[.,]\d+)*\s*(?:%|×|x\b|\bof\b|\bmirror-valid\b|\bitems\b|\bfirms\b|\bflips\b)"
)
_NUM_TOKEN = re.compile(r"\d+(?:[.,]\d+)*")
_CITATION_LEAD = re.compile(
    r"^\s*[-*]\s+\*?\*?[A-Z][a-z]+(?:[A-Z][a-z]+)?(?:/[A-Z][a-z]+)?\s+\d{4}"
)

# Structure patterns
_FRONTMATTER_FENCE = re.compile(r"^---\s*$", re.MULTILINE)
_BOLD_LETTER_BULLET = re.compile(r"^\s*[-*]\s+\*\*([A-Z])[\.\d]", re.MULTILINE)
_H4_LETTER_HEADER = re.compile(r"^####\s+([A-Z])\.", re.MULTILINE)
_H2_LETTER_DRAFT = re.compile(r"^##\s+([A-Z])\.", re.MULTILINE)
_H3_DRAFT = re.compile(r"^###\s+(.+)$", re.MULTILINE)
_H1_DRAFT = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_STOP_WORDS = frozenset({"the", "a", "an", "of", "in", "and", "or", "for", "to", "by"})


def _strip_frontmatter(text: str) -> str:
    if not text.lstrip().startswith("---"):
        return text
    m = _FRONTMATTER_FENCE.search(text, 3)
    return text[m.end() :] if m else text


def _part_key(text: str) -> str:
    m = re.match(r"(Part\s+[IVX\d]+|Introduction|Conclusion)", text.strip(), re.IGNORECASE)
    return m.group(1).lower() if m else text.lower().split(".")[0].strip()


def _detect_phase(cwd: Path) -> str:
    aw = cwd / ".planning" / "ACTIVE_WORKFLOW.md"
    if not aw.is_file():
        return "unknown"
    text = aw.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"^phase:\s*(\w+)", text, re.MULTILINE)
    return m.group(1).lower() if m else "unknown"


def _h3_covered(header: str, outline_body: str) -> bool:
    """True if all significant words in the ### header appear (individually)
    in the outline body.  Uses whole-word search to avoid 'pass' matching
    'passive'. Words shorter than 4 chars are skipped to reduce noise."""
    words = [
        w for w in re.sub(r"[^\w\s]", " ", header.lower()).split()
        if w not in _STOP_WORDS and len(w) >= 4
    ]
    if not words:
        return True
    # Use \b word-boundary so 'force' doesn't match 'performance'
    return all(re.search(r"\b" + re.escape(w) + r"\b", outline_body) for w in words)


def _parse_outline(path: Path) -> dict:
    """Returns {part_key: {header, letters, text}}."""
    text = _strip_frontmatter(path.read_text(encoding="utf-8", errors="ignore"))
    parts: dict = {}
    chunks = re.split(r"^(###\s+.+)$", text, flags=re.MULTILINE)
    for header_line, body in zip(chunks[1::2], chunks[2::2]):
        header_text = re.sub(r"^###\s+", "", header_line.strip())
        key = _part_key(header_text)
        # Truncate body before any ## subsection (avoids capturing Claim-to-Part
        # Map, Key Sources, Open Questions that bleed into the last ### body)
        h2_cut = re.search(r"^##\s+", body, re.MULTILINE)
        clean_body = body[: h2_cut.start()] if h2_cut else body
        letters: set[str] = set(_BOLD_LETTER_BULLET.findall(clean_body))
        letters |= set(_H4_LETTER_HEADER.findall(clean_body))
        parts[key] = {"header": header_text, "letters": letters, "text": clean_body}
    return parts


def _parse_draft(path: Path) -> dict:
    text = _strip_frontmatter(path.read_text(encoding="utf-8", errors="ignore"))
    h1 = _H1_DRAFT.search(text)
    part_key = _part_key(h1.group(1)) if h1 else _part_key(
        path.stem.replace(" (Draft)", "").replace("(Draft)", "")
    )
    return {
        "part_key": part_key,
        "h2_letters": _H2_LETTER_DRAFT.findall(text),
        "h3_texts": _H3_DRAFT.findall(text),
        "filename": path.name,
    }


def _extract_number_bullets(section_text: str) -> list[str]:
    result = []
    for line in section_text.splitlines():
        if not line.strip().startswith(("-", "*", "+")):
            continue
        if _CITATION_LEAD.match(line):
            continue
        if _NUM_SIGNAL.search(line):
            result.append(line)
    return result


def _numbers_in_bullet(bullet: str) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for m in _NUM_SIGNAL.finditer(bullet):
        tok = _NUM_TOKEN.search(m.group(0))
        if tok and tok.group(0) not in seen:
            seen.add(tok.group(0))
            result.append(tok.group(0))
    return result


def check(context: dict) -> list[str]:
    cwd = Path(context.get("cwd", "."))
    outline_path = cwd / ".planning" / "OUTLINE.md"
    drafts_dir = cwd / "drafts"

    if not outline_path.is_file() or not drafts_dir.is_dir():
        return []

    draft_files = sorted(drafts_dir.glob("*.md"))
    if not draft_files:
        return []

    phase = _detect_phase(cwd)
    outline_canonical = phase in _OUTLINE_CANONICAL
    plab = f"phase={phase}"

    outline = _parse_outline(outline_path)
    drafts = [_parse_draft(p) for p in draft_files]
    draft_map: dict = {d["part_key"]: d for d in drafts}

    all_draft_text = "\n".join(
        p.read_text(encoding="utf-8", errors="ignore") for p in draft_files
    ).lower()

    violations: list[str] = []

    # ── Checks 1–3: structural matching ──────────────────────────────────────
    for draft in drafts:
        key = draft["part_key"]
        fname = draft["filename"]

        if key not in outline:
            if outline_canonical:
                msg = (
                    f"drafts/{fname} [{plab}]: part '{key}' not in OUTLINE — "
                    f"draft was created without a matching OUTLINE ### section"
                )
            else:
                msg = (
                    f"drafts/{fname} [{plab}]: part '{key}' has no ### section "
                    f"in .planning/OUTLINE.md — OUTLINE is missing this part"
                )
            violations.append(msg)
            continue

        outline_letters = outline[key]["letters"]
        draft_letters = set(draft["h2_letters"])
        oh = outline[key]["header"]

        # Draft ## not in OUTLINE
        for letter in sorted(draft_letters - outline_letters):
            if outline_canonical:
                violations.append(
                    f"drafts/{fname} [{plab}]: ## {letter}. added in draft but "
                    f"not planned in OUTLINE under '{oh}' — "
                    f"update OUTLINE or confirm this subsection belongs"
                )
            else:
                violations.append(
                    f"drafts/{fname} [{plab}]: ## {letter}. exists in draft but "
                    f"is not listed in OUTLINE under '{oh}' — OUTLINE may be stale"
                )

        # OUTLINE letter not in draft
        for letter in sorted(outline_letters - draft_letters):
            if outline_canonical:
                violations.append(
                    f"drafts/{fname} [{plab}]: ## {letter}. planned in OUTLINE "
                    f"under '{oh}' not yet drafted — section missing from draft"
                )
            else:
                violations.append(
                    f".planning/OUTLINE.md [{plab}]: ## {letter}. planned under "
                    f"'{oh}' has no ## {letter}. in drafts/{fname} — "
                    f"not yet drafted, or renamed in draft"
                )

        # Draft ### not mentioned in OUTLINE body
        # Strip hyphens so "pass-through" in OUTLINE matches "pass through" in header
        outline_body_lower = outline[key]["text"].lower().replace("-", " ")
        for h3 in draft["h3_texts"]:
            if _h3_covered(h3, outline_body_lower):
                continue
            if outline_canonical:
                violations.append(
                    f"drafts/{fname} [{plab}]: ### {h3} added without a "
                    f"corresponding entry in OUTLINE under '{oh}'"
                )
            else:
                violations.append(
                    f"drafts/{fname} [{plab}]: ### {h3} not mentioned in "
                    f"OUTLINE under '{oh}' — OUTLINE may need a new entry"
                )

    # ── Check 4: number-anchoring in Introduction and Conclusion ─────────────
    for target_key in ("introduction", "conclusion"):
        if target_key not in outline:
            continue
        section_header = outline[target_key]["header"]
        for bullet in _extract_number_bullets(outline[target_key]["text"]):
            tokens = _numbers_in_bullet(bullet)
            for token in tokens:
                pattern = re.compile(r"(?<!\d)" + re.escape(token) + r"(?!\d)")
                if not pattern.search(all_draft_text):
                    short = bullet.strip()[:120]
                    if outline_canonical:
                        violations.append(
                            f".planning/OUTLINE.md ({section_header}) [{plab}]: "
                            f"number '{token}' from OUTLINE not in draft — "
                            f"draft may not yet implement: \"{short}\""
                        )
                    else:
                        violations.append(
                            f".planning/OUTLINE.md ({section_header}) [{plab}]: "
                            f"number '{token}' not found in any draft — "
                            f"OUTLINE restatement may be stale: \"{short}\""
                        )
                    break  # one violation per bullet

    return violations


if __name__ == "__main__":
    vs = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if vs:
        for v in vs:
            print(f"WARN: {v}")
        sys.exit(0)  # soft — advisory only
    print(f"PASS: {CONSTRAINT}")
