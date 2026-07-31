#!/usr/bin/env -S uv run python3
"""Stage 4: Pure-regex lint pass for drafts.

Catches the four most expensive cite-fidelity failure modes before they reach
the cite-check stage. NLM-free except for one optional `nlm sources` listing
to enable the bibkey-not-in-nlm check.

Checks (defaults in **bold**):
  1. **hand-typed-cite** (WARN): footnote `[^N]:` body contains Bluebook
     patterns (`L. Rev.`, `Vol. N`, italicized title + year, U.S.C. §, etc.)
     but no `[@bibkey]` reference. Tag with `lint-allow-handcite` to silence.
  2. **bundled-cites** (WARN): three or more distinct `[@key]` references in
     one sentence; promotes topic-tag-citation failure mode.
  3. missing-nlm-quote (ERROR, **`--strict` only**): every `[@key]` must have
     a preceding `<!-- nlm-quote @key: "..." -->` within 6 lines.
  4. **bibkey-not-in-nlm** (ERROR): a cited bibkey is not present in the NLM
     notebook under its bibkey-as-title (only runs if the project has
     `--nlm-notebook` is supplied from the authenticated generated plan).

Project context is supplied explicitly by the canonical hook or caller; this
linter never reads retired workflow markers.

Usage (run from inside the writing project):
  uv run lint_drafts.py --project-root .             # all drafts/*.md
  uv run lint_drafts.py --project-root . "drafts/Part I (Draft).md"
  uv run lint_drafts.py --strict                     # require nlm-quote evidence
  uv run lint_drafts.py --skip nlm                   # offline (no NLM listing)
  uv run lint_drafts.py --skip bundled               # turn off bundled warnings
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import CROSSREF_PREFIXES, parse_sources_listing  # noqa: E402

# Bluebook signal patterns. These appearing inside a footnote body without an
# accompanying [@bibkey] suggest a hand-typed citation that bypasses the bib.
BLUEBOOK_PATTERNS = [
    (r"\b\d+\s+[A-Z][A-Za-z.&\s]{0,40}\bL\.\s*Rev\.\s*\d", "vol-LRev-page"),
    (r"\b\d+\s+[A-Z][A-Za-z.&\s]{0,40}\bJ\.\s*\d",       "vol-J-page"),
    (r"\bU\.\s*S\.\s*C\.\s*§", "USC-section"),
    (r"\bSup\.\s*Ct\.\s*\d", "vol-SupCt-page"),
    (r"\bF\.\s*Supp\.\s*\d", "vol-FSupp-page"),
    (r"\bF\.\s*\d+d\b",      "F-reporter"),
    (r"_[A-Z][^_\n]{8,80}_,\s*\d{4}",            "italic-title-year"),
    (r"\*[A-Z][^*\n]{8,80}\*,\s*\d{4}",          "italic-title-year-asterisk"),
    (r"\b(?:Vol|vol)\.\s*\d+",                   "Vol.-N"),
]
BLUEBOOK_REGEXES = [(re.compile(p), name) for p, name in BLUEBOOK_PATTERNS]

HANDCITE_OK_TAG = "lint-allow-handcite"
NLM_QUOTE_LOOKBACK = 6


class Issue:
    def __init__(self, file: str, line: int, code: str, severity: str, msg: str):
        self.file = file
        self.line = line
        self.code = code
        self.severity = severity
        self.msg = msg

    def __str__(self) -> str:
        return f"{self.file}:{self.line}: {self.severity:5s} [{self.code}] {self.msg}"


def parse_footnote_defs(text: str) -> list[tuple[str, int, int]]:
    pattern = re.compile(r"^\[\^([^\]]+)\]:\s*", re.MULTILINE)
    matches = list(pattern.finditer(text))
    out: list[tuple[str, int, int]] = []
    for i, m in enumerate(matches):
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        bb = text.find("\n\n", body_start, body_end)
        if bb != -1:
            body_end = bb
        out.append((m.group(1), body_start, body_end))
    return out


def cited_keys_with_locations(text: str) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    cite_re = re.compile(
        r"\[([^\[\]]*?@[^\[\]]+?)\]|(?<![\[\w])@([A-Za-z][A-Za-z0-9_:\-./]+)"
    )
    for m in cite_re.finditer(text):
        if m.group(1):
            for part in m.group(1).split(";"):
                km = re.search(r"@([A-Za-z][A-Za-z0-9_:\-./]+)", part)
                if not km:
                    continue
                key = km.group(1).rstrip(".,")
                if key.startswith(CROSSREF_PREFIXES):
                    continue
                out.append((key, m.start(), text.count("\n", 0, m.start()) + 1))
        else:
            key = m.group(2).rstrip(".,")
            if key.startswith(CROSSREF_PREFIXES):
                continue
            out.append((key, m.start(), text.count("\n", 0, m.start()) + 1))
    return out


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def check_handtyped_footnote_cites(text: str, file_label: str) -> list[Issue]:
    issues: list[Issue] = []
    for label, s, e in parse_footnote_defs(text):
        body = text[s:e]
        if HANDCITE_OK_TAG in body:
            continue
        has_bracket_cite = bool(re.search(r"\[[^\]]*?@[A-Za-z]", body))
        has_bare_cite = bool(re.search(
            r"(?:^|[\s({\[])@[A-Za-z][A-Za-z0-9_:\-./]+", body))
        for rx, name in BLUEBOOK_REGEXES:
            for m in rx.finditer(body):
                if has_bracket_cite or has_bare_cite:
                    break
                hit_line = line_of(text, s + m.start())
                snippet = body[max(0, m.start() - 10):m.end() + 30]
                snippet = re.sub(r"\s+", " ", snippet).strip()[:120]
                issues.append(Issue(
                    file_label, hit_line, "hand-typed-cite", "WARN",
                    f"footnote [^{label}] has Bluebook pattern ({name}) but "
                    f"no [@bibkey] reference: …{snippet}…"
                ))
                break
    return issues


def check_bundled_cites(text: str, file_label: str) -> list[Issue]:
    issues: list[Issue] = []
    pos = 0
    sentence_re = re.compile(r"[\.\?!]\s+|\n\n+")
    for m in sentence_re.finditer(text):
        sent = text[pos:m.start() + 1]
        if sent.strip():
            keys = set()
            for km in re.finditer(r"@([A-Za-z][A-Za-z0-9_:\-./]+)", sent):
                k = km.group(1).rstrip(".,")
                if not k.startswith(CROSSREF_PREFIXES):
                    keys.add(k)
            if len(keys) >= 3:
                line = text.count("\n", 0, pos) + 1
                preview = re.sub(r"\s+", " ", sent.strip())[:160]
                issues.append(Issue(
                    file_label, line, "bundled-cites", "WARN",
                    f"sentence has {len(keys)} distinct cites "
                    f"({', '.join(sorted(keys))}): {preview}…"
                ))
        pos = m.end()
    return issues


def check_missing_nlm_quote(text: str, file_label: str) -> list[Issue]:
    issues: list[Issue] = []
    quote_re = re.compile(r"<!--\s*nlm-quote\s+@([A-Za-z][A-Za-z0-9_:\-./]+)")
    quotes_by_line: dict[int, set[str]] = {}
    for m in quote_re.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        quotes_by_line.setdefault(line, set()).add(m.group(1))
    for key, _offset, line in cited_keys_with_locations(text):
        ok = False
        for back in range(NLM_QUOTE_LOOKBACK + 1):
            if key in quotes_by_line.get(line - back, set()):
                ok = True
                break
        if not ok:
            issues.append(Issue(
                file_label, line, "missing-nlm-quote", "ERROR",
                f"[@{key}] has no preceding `<!-- nlm-quote @{key}: ... -->` "
                f"within {NLM_QUOTE_LOOKBACK} lines"
            ))
    return issues


def check_bibkey_not_in_nlm(text: str, file_label: str,
                             nlm_titles: set[str]) -> list[Issue]:
    issues: list[Issue] = []
    seen: set[tuple[str, int]] = set()
    for key, _offset, line in cited_keys_with_locations(text):
        if (key, line) in seen:
            continue
        seen.add((key, line))
        if key not in nlm_titles:
            issues.append(Issue(
                file_label, line, "bibkey-not-in-nlm", "ERROR",
                f"`{key}` is cited but missing from the NLM notebook "
                "(can't be cite-checked)"
            ))
    return issues


def render(issues: list[Issue]) -> str:
    if not issues:
        return "✓ no issues\n"
    by_file: dict[str, list[Issue]] = {}
    for i in issues:
        by_file.setdefault(i.file, []).append(i)
    lines: list[str] = []
    for f, items in by_file.items():
        lines.append(f"\n{f}")
        for i in sorted(items, key=lambda x: (x.line, x.code)):
            lines.append(f"  L{i.line:<5d} {i.severity:<5s} [{i.code}] {i.msg}")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project-root", type=Path, required=True,
                    help="Authenticated writing project root (supplied by the hook).")
    ap.add_argument("--nlm-notebook", default="",
                    help="Notebook identifier from the authenticated generated plan.")
    ap.add_argument("files", nargs="*", type=Path,
                    help="Files to lint (default: all drafts/*.md).")
    ap.add_argument("--strict", action="store_true",
                    help="Require an `<!-- nlm-quote @key -->` comment within "
                         f"{NLM_QUOTE_LOOKBACK} lines preceding each [@key].")
    ap.add_argument("--skip", action="append", default=[],
                    choices=["handcite", "bundled", "nlm-quote", "nlm"],
                    help="Suppress a check (repeatable).")
    args = ap.parse_args()

    project_root = args.project_root.resolve()
    if not project_root.is_dir():
        print(f"error: project root is not a directory: {project_root}", file=sys.stderr)
        return 2

    files = [f if f.is_absolute() else (project_root / f) for f in args.files]
    if not files:
        files = sorted((project_root / "drafts").glob("*.md"))

    nlm_titles: set[str] | None = None
    notebook = args.nlm_notebook.strip()
    if "nlm" not in args.skip and notebook:
        try:
            nlm_titles = set(parse_sources_listing(notebook).keys())
        except Exception as e:  # noqa: BLE001
            print(f"warning: NLM source list unavailable ({e}); skipping "
                  "bibkey-not-in-nlm check", file=sys.stderr)

    all_issues: list[Issue] = []
    for f in files:
        if not f.exists():
            print(f"warning: missing file {f}", file=sys.stderr)
            continue
        text = f.read_text()
        label = f.name
        if "handcite" not in args.skip:
            all_issues.extend(check_handtyped_footnote_cites(text, label))
        if "bundled" not in args.skip:
            all_issues.extend(check_bundled_cites(text, label))
        if args.strict and "nlm-quote" not in args.skip:
            all_issues.extend(check_missing_nlm_quote(text, label))
        if nlm_titles is not None:
            all_issues.extend(check_bibkey_not_in_nlm(text, label, nlm_titles))

    print(render(all_issues))
    errors = sum(1 for i in all_issues if i.severity == "ERROR")
    warns = sum(1 for i in all_issues if i.severity == "WARN")
    print(f"summary: {errors} ERROR, {warns} WARN", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
