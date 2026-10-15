#!/usr/bin/env python3
"""The source a caption maps to is that caption's opinion: it contains the caption's reporter citation.

Usage: check-source-identity.py <addendum.typ> [<docs dir>]
       check-source-identity.py --project-dir P [--plan X] [--files F ...]   (the constraint contract)

check-quotes.py proves the excerpt is verbatim in whatever file the caption's name maps to; it
cannot tell that the file is the wrong opinion. This reads the citation printed under each caption
('87 F.3d 536') and FAILS a reading whose mapped source does not contain it, or whose caption block
carries no reporter citation to compare. Plan-declared non-court readings and readings with no
resolvable source are not judged here (check-quotes reports both). A reading with no reporter citation
(a blog statement, an agency release) is identified by its caption title (the bold title, or a long
descriptive line under it) or an SEC-style release number ('33-11389') occurring in the source, and
fails only when none does.
"""
import importlib.util
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

REPORTERS = (
    r"U\.\s?S\.|S\.\s?Ct\.|L\.\s?Ed\.(?:\s?2d)?|F\.\s?(?:[234]d|4th)|F\.\s?Supp\.(?:\s?[23]d)?|F\.\s?App['’]x|F\.R\.D\.|B\.R\.|"
    r"A\.(?:\s?[23]d)?|N\.E\.(?:\s?[23]d)?|N\.W\.(?:\s?2d)?|S\.E\.(?:\s?2d)?|S\.W\.(?:\s?[23]d)?|P\.(?:\s?[23]d)?|"
    r"So\.(?:\s?[23]d)?|Cal\.\s?Rptr\.(?:\s?[23]d)?|N\.Y\.S\.(?:\s?[23]d)?|Del\.\s?Ch\.|F\.(?!\s?Supp)"
)
CITE_RE = re.compile(rf"(?<![\w.])(\d{{1,4}})\s+({REPORTERS})\s+(\d{{1,5}})(?!\d)")


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def compact(s: str) -> str:
    """Case, spacing and dots folded out, so '87 F.3d 536' and '87 F. 3d 536' compare equal."""
    return re.sub(r"[\s. ]+", "", s).lower()


def citation_of(block: str) -> str | None:
    m = CITE_RE.search(block)
    return m.group(0) if m else None


MIN_LINE = 40
RELEASE_RE = re.compile(r"(?<![\d-])\d{2}-\d{4,6}(?![\d-])")
BOLD_TITLE_RE = re.compile(r'#text\([^)]*weight:\s*"bold"[^)]*\)\[')


def title_of(block: str, addendum) -> str | None:
    m = BOLD_TITLE_RE.search(block)
    if not m:
        return None
    open_at = m.end() - 1
    return block[open_at + 1 : addendum._match_bracket(block, open_at, "[", "]") - 1]


def identified_without_cite(block: str, text: str, addendum) -> bool:
    """A non-court reading: its bold title or a long descriptive line, else any release number in the block, occurs in the source."""
    title = title_of(block, addendum)
    have = compact(text)
    if title and compact(title) and compact(title) in have:
        return True
    # A blog post's bold caption title is the editor's, its printed title the line under it; a line
    # shorter than MIN_LINE compact chars ('CLS Blue Sky Blog') would match any source.
    lines = (ln.strip().rstrip("\\").strip() for ln in BOLD_TITLE_RE.sub("", block).splitlines())
    if any(len(compact(ln)) >= MIN_LINE and compact(ln) in have for ln in lines):
        return True
    return any(re.search(rf"(?<![\d-]){re.escape(n)}(?![\d-])", text) for n in RELEASE_RE.findall(block))


def caption_blocks(src: str, addendum) -> list[str]:
    """The whole `#align(center)[ ... ]` block of each reading caption, in caption order."""
    out = []
    for m in addendum.CAPTION_RE.finditer(src):
        start = src.rfind("#align(center)", 0, m.end())
        open_at = src.index("[", start)
        out.append(src[open_at + 1 : addendum._match_bracket(src, open_at, "[", "]") - 1])
    return out


def identity(typ: Path, docs_dir: Path, plan_declared) -> tuple[int, list[str], int, list[str]]:
    """(exit, `typ:1: ...` findings, readings judged, readings a plain-text source left unchecked)."""
    quotes, addendum = _load("check-quotes"), _load("check-addendum")
    src = typ.read_text(encoding="utf-8")
    blocks = caption_blocks(src, addendum)
    rows = [r.split("\x1f") for r in quotes.resolve(typ, docs_dir, plan_declared) if r and not r.startswith("!")]
    findings, unchecked, judged = [], [], 0
    for i, row in enumerate(rows):
        caption, path, status = row[0], row[1], row[2]
        if status != "OK":
            continue
        judged += 1
        label = f'reading {i + 1} "{caption[:60]}"'
        cite = citation_of(blocks[i]) if i < len(blocks) else None
        text, _ = quotes.load_source(Path(path))
        if cite is None:
            if not identified_without_cite(blocks[i] if i < len(blocks) else "", text, addendum):
                findings.append(f"{typ}:1: {label}: no reporter citation under the caption, and neither its title "
                                f"nor a release number in it occurs in {Path(path).name} — the mapped source may "
                                f"be a different document")
            continue
        want = compact(cite)
        have = compact(text)
        if re.search(rf"(?<!\d){re.escape(want)}(?!\d)", have):
            continue
        if path.endswith(".txt"):
            # The CourtListener/RECAP fallback yields a court slip opinion, which carries no
            # reporter citation to find; say so loudly rather than fail the route.
            unchecked.append(f"{typ.name} reading {i + 1}: IDENTITY NOT CHECKED — {Path(path).name} is plain text "
                             f"without '{cite}'")
        else:
            findings.append(f"{typ}:1: {label}: caption cites '{cite}' but that citation is not found in "
                            f"{Path(path).name} — the mapped source may be a different opinion")
    return (1 if findings else 0), findings, judged, unchecked


def report(typ: Path, docs_dir: Path, plan_declared) -> int:
    rc, findings, judged, unchecked = identity(typ, docs_dir, plan_declared)
    print("\n".join(findings + unchecked) if findings or unchecked
          else f"PASS source identity: {judged} reading(s) carry their caption's citation")
    return rc


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print("usage: check-source-identity.py <addendum.typ> [<docs dir>]", file=sys.stderr)
        return 2
    typ = Path(sys.argv[1])
    return report(typ, Path(sys.argv[2]) if len(sys.argv) == 3 else _load("check-quotes").docs_dir_for(typ, []), [])


def judge(typ: Path, ctx: dict) -> tuple[int, list[str], str]:
    quotes = _load("check-quotes")
    plan_declared = []
    if ctx["plan"]:
        try:
            plan_declared = quotes.noncourt(Path(ctx["plan"]).read_text(encoding="utf-8"))
        except OSError as e:
            return 2, [], f"could not read the plan {ctx['plan']}: {e}"
    rc, findings, judged, unchecked = identity(typ, quotes.docs_dir_for(typ, ctx["given"]), plan_declared)
    ctx.setdefault("notes", []).append(f"{typ.name}: {judged - len(unchecked)} of {judged} reading(s) identity-checked"
                                       + "".join(f"; {u}" for u in unchecked))
    return rc, findings, "\n".join(findings)


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    from _elide_contract import run, wanted
    if wanted():
        sys.exit(run("check-source-identity", lambda p: p.suffix == ".typ", judge, "addendum(s)", ".typ addendum"))
    sys.exit(main())
