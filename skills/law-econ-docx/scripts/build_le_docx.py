#!/usr/bin/env -S uv run python3
"""Build a Law & Economics manuscript DOCX from markdown via pandoc.

    uv run python3 build_le_docx.py PAPER.md [-o OUT.docx] [--pdf]
    uv run python3 build_le_docx.py PROJECT_DIR                 # drafts/*.md, sorted

Target: Journal of Law and Economics / Journal of Legal Studies / JLEO and the
job-market papers written for that audience — author-date citations with a
reference list, double spaced throughout, Chicago Manual of Style.

Why this is a sibling of law-review-docx's build_docx.py and not a --style flag
-------------------------------------------------------------------------------
The two pipelines share their *machinery* and disagree on nearly every *policy*:

  shared (imported from build_docx.py, one maintenance point)
      include sentinels, frontmatter stripping, footnote-label prefixing,
      widow control, the booktabs table restyle, docx-repair, PDF rendering,
      the acknowledgment-footnote injector, the svgBlip vector-figure attacher

  divergent (why a flag would have branched inside almost every function)
      citations   footnote citations, suppressed bibliography, Bluebook CSL
                  vs. in-text author-date + a printed reference list, CMOS CSL
      linting     bluebook_lint / stacked-footnote detection is meaningless here
                  (JLE forbids purely bibliographic footnotes outright)
      structure   "Part I..VI" ordering + a Word TOC field
                  vs. numeric sections, no TOC, JLE back-matter order
      typography  small caps + Times law-review template
                  vs. Latin Modern + double spacing

Extending build_docx.py would have meant an `if style == "le"` in build(),
parse_metadata(), sort_key(), get_prefix(), and the pandoc argv — five branch
points in a 1,500-line file, for a pipeline that shares no policy. Importing the
machinery gets the reuse without the branching.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import zipfile
import shutil
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SKILLS / "law-review-docx" / "scripts"))

from build_docx import (  # noqa: E402
    strip_frontmatter,
    resolve_includes,
    prefix_footnotes,
    force_widow_control,
    style_tables,
    convert_to_pdf,
    inject_acknowledgement,
    attach_svg_blips,
)

TEMPLATE = SKILLS / "writing-legal" / "templates" / "law_econ_template.docx"
DEFAULT_CSL = Path(__file__).resolve().parent.parent / "assets" / "chicago-author-date.csl"

LINE_RULE = {"double": 480, "onehalf": 360, "single": 240}

# Latin Modern Roman advance widths relative to Times-Roman (the model baked
# into build_docx._text_twips). Measured against the sample table.
LM_WIDTH_FACTOR = 1.15

# Headings that must not take a section number. JLE's manuscript order is
# Title page / Abstract / Text / Footnotes / Appendixes / Reference list /
# Tables / Figure legends / Figures — everything outside "Text" is back matter.
BACK_MATTER_RE = re.compile(
    r"^(abstract|references?(\s+list)?|reference list|bibliography|works cited|"
    r"acknowledgment[s]?|acknowledgement[s]?|appendix\b.*|appendixes|appendices|"
    r"figure legends?|tables?|notes|data appendix|online appendix.*)$",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# input assembly
# ---------------------------------------------------------------------------

def _numeric_key(p: Path) -> tuple:
    """Sort drafts/01-intro.md, 02-model.md ... numerically, else alphabetically."""
    m = re.match(r"^(\d+)", p.stem)
    return (0, int(m.group(1)), p.stem) if m else (1, 0, p.stem)


def collect_sources(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    for pattern in ("drafts/*.md", "*.md"):
        found = sorted(target.glob(pattern), key=_numeric_key)
        found = [f for f in found if f.name.upper() != "README.MD"]
        if found:
            return found
    sys.exit(f"ERROR: no markdown found under {target}")


def assemble(sources: list[Path]) -> str:
    """Concatenate sources, keeping the FIRST file's YAML frontmatter as the
    document metadata and dropping the rest."""
    head = sources[0].read_text()
    front = ""
    if head.startswith("---"):
        end = head.find("\n---", 3)
        if end != -1:
            front = head[: end + 4].rstrip() + "\n\n"
    body = strip_frontmatter(head)

    for i, src in enumerate(sources[1:], start=1):
        text = strip_frontmatter(src.read_text())
        # Namespace footnote labels per file so two sections can both use [^1].
        text = prefix_footnotes(text, f"s{i}")
        body += "\n\n" + text

    return front + resolve_includes(body)


REFS_DIV_RE = re.compile(r"^:::\s*\{#refs[^}]*\}", re.MULTILINE)


def ensure_reference_list(md: str) -> str:
    """Guarantee the reference list is emitted, and in JLE's back-matter slot.

    citeproc drops the bibliography wherever a ``::: {#refs}`` div sits, or at
    the very end if there is none. JLE puts the reference list AFTER the
    appendixes, which is also the end — so appending is correct, but the
    heading has to be explicit or the list arrives unlabeled.
    """
    if REFS_DIV_RE.search(md):
        return md
    if re.search(r"^#{1,2}\s+References?\b", md, re.MULTILINE | re.IGNORECASE):
        # Author wrote the heading but no div — anchor the list under it.
        return md.rstrip() + "\n\n::: {#refs}\n:::\n"
    return md.rstrip() + "\n\n# References\n\n::: {#refs}\n:::\n"


# ---------------------------------------------------------------------------
# post-build docx passes
# ---------------------------------------------------------------------------

def _rewrite(docx: Path, fn) -> None:
    with zipfile.ZipFile(docx) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    if not fn(parts):
        return
    tmp = docx.with_suffix(".docx.tmp")
    with zipfile.ZipFile(docx) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, parts[item.filename])
    shutil.move(tmp, docx)


_P_RE = re.compile(r"<w:p(?:\s[^>]*)?>.*?</w:p>", re.DOTALL)
_H1_RE = re.compile(r'<w:pStyle w:val="Heading1"\s*/>')
_H23_RE = re.compile(r'<w:pStyle w:val="Heading([23])"\s*/>')
_T_RE = re.compile(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>")


def unnumber_back_matter(docx: Path) -> None:
    """Retag back-matter Heading1s so Word's auto-numbering skips them.

    Without this, "References" and "Appendix A" get section numbers 8., 9. —
    and, worse, they consume numbers the body sections should have had.
    """
    warned = {"n": 0}

    def fn(parts: dict) -> bool:
        doc = parts["word/document.xml"].decode("utf-8")
        in_back_matter = False
        out, last = [], 0
        for m in _P_RE.finditer(doc):
            block = m.group(0)
            if _H1_RE.search(block):
                text = "".join(_T_RE.findall(block)).strip()
                # Once back matter starts it does not stop — every later H1
                # (Appendix B, References) is back matter too.
                if in_back_matter or BACK_MATTER_RE.match(text):
                    in_back_matter = True
                    out.append(doc[last:m.start()])
                    out.append(_H1_RE.sub(
                        '<w:pStyle w:val="UnnumberedHeading"/>', block, count=1))
                    last = m.end()
            elif in_back_matter and _H23_RE.search(block):
                warned["n"] += 1
        if not out:
            return False
        out.append(doc[last:])
        parts["word/document.xml"] = "".join(out).encode("utf-8")
        return True

    _rewrite(docx, fn)
    if warned["n"]:
        print(
            f"WARN: {warned['n']} sub-heading(s) inside the appendixes still carry body "
            "section numbers (Word numbers H2/H3 from the last numbered H1). JLE restarts "
            "appendix numbering per appendix — either keep appendixes flat or number their "
            "subheads by hand (A.1, A.2).",
            file=sys.stderr,
        )


_MATH_RUN_RE = re.compile(r"<m:r>(?!\s*<m:rPr>|\s*<w:rPr>)")
_MATH_RPR = ('<w:rPr><w:rFonts w:ascii="Latin Modern Math" w:hAnsi="Latin Modern Math" '
             'w:cs="Latin Modern Math"/></w:rPr>')


# Word takes the math typeface from settings.xml, NOT from run properties, so
# the run stamping below is not sufficient on its own. Pandoc regenerates
# settings.xml from scratch and does not carry the reference doc's copy, so the
# template's m:mathPr is lost in every build and must be re-injected here.
_MATH_PR = (
    '<m:mathPr>'
    '<m:mathFont m:val="Latin Modern Math"/>'
    '<m:brkBin m:val="before"/>'
    '<m:brkBinSub m:val="--"/>'
    '<m:smallFrac m:val="0"/>'
    '<m:dispDef/>'
    '<m:lMargin m:val="0"/>'
    '<m:rMargin m:val="0"/>'
    '<m:wrapRight/>'
    '<m:intLim m:val="subSup"/>'
    '<m:naryLim m:val="undOvr"/>'
    '</m:mathPr>'
)


def set_math_font(docx: Path) -> None:
    """Point both math font mechanisms at Latin Modern Math.

    Two separate stamps are needed, for two different consumers:

    * ``settings.xml``'s ``m:mathPr/m:mathFont`` — this is what **Word** uses,
      and run properties do not override it. The template carries it, but
      pandoc regenerates ``settings.xml`` and drops it, so every build must
      re-inject it or Word renders the math in Cambria Math while the body text
      is correctly Latin Modern.
    * an explicit ``w:rFonts`` on every ``m:r`` — LibreOffice and x2t ignore
      ``m:mathFont`` entirely and would otherwise use their own default serif.

    Neither alone is enough; a document can look right in one renderer and
    wrong in the other. (LibreOffice ignores the run font too — see the
    skill's "Known limitation" — but the stamp is still correct to emit.)
    """
    def fn(parts: dict) -> bool:
        changed = False

        doc = parts["word/document.xml"].decode("utf-8")
        new, n = _MATH_RUN_RE.subn("<m:r>" + _MATH_RPR, doc)
        if n:
            parts["word/document.xml"] = new.encode("utf-8")
            changed = True

        key = "word/settings.xml"
        if key in parts:
            s = parts[key].decode("utf-8")
            if "m:mathFont" not in s:
                # m:mathPr sits late in the w:settings child order; both of
                # these anchors precede it. The m: namespace is already
                # declared on w:settings by pandoc's writer.
                for anchor in ("<w:decimalSymbol", "<w:listSeparator", "</w:settings>"):
                    if anchor in s:
                        s = s.replace(anchor, _MATH_PR + anchor, 1)
                        parts[key] = s.encode("utf-8")
                        changed = True
                        break

        return changed

    _rewrite(docx, fn)


def set_line_spacing(docx: Path, mode: str) -> None:
    """Override the template's double spacing (for circulating drafts only)."""
    if mode == "double":
        return
    target = LINE_RULE[mode]

    def fn(parts: dict) -> bool:
        xml = parts["word/styles.xml"].decode("utf-8")
        new = re.sub(r'w:line="480"', f'w:line="{target}"', xml)
        if new == xml:
            return False
        parts["word/styles.xml"] = new.encode("utf-8")
        return True

    _rewrite(docx, fn)


def check_abstract_length(md: str, limit: int = 150) -> None:
    m = re.search(r"^abstract:\s*[|>]?\s*\n((?:[ \t]+.*\n)+)", md, re.MULTILINE)
    if not m:
        m = re.search(r'^abstract:\s*"?(.+?)"?\s*$', md, re.MULTILINE)
    if not m:
        return
    words = len(re.sub(r"\s+", " ", m.group(1)).split())
    if words > limit:
        print(f"WARN: abstract is {words} words; JLE enforces a strict {limit}-word limit",
              file=sys.stderr)


def check_citation_footnotes(md: str) -> None:
    """JLE: 'Footnotes must be substantive and cannot contain purely
    bibliographic material. Simple citations must be in the text.'"""
    bad = []
    for m in re.finditer(r"^\[\^([^\]]+)\]:\s*(.+)$", md, re.MULTILINE):
        body = m.group(2).strip()
        stripped = re.sub(r"\[?@[\w:.#$%&+?<>~/-]+(?:,[^\];]*)?\]?", "", body)
        stripped = re.sub(r"[\s;,.()\[\]]", "", stripped)
        if body and not stripped:
            bad.append(m.group(1))
    if bad:
        print(f"WARN: footnote(s) {', '.join(bad[:8])} contain only citations. JLE requires "
              "footnotes to be substantive — move bare citations into the text as "
              "author-date parentheticals.", file=sys.stderr)


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

def build(target: Path, output: Path | None, *, spacing: str = "double",
          bibliography: Path | None = None, csl: Path | None = None,
          pdf: bool = False, acknowledgement: str = "") -> Path:
    if not TEMPLATE.exists():
        sys.exit(f"ERROR: template not found at {TEMPLATE}\n"
                 "       regenerate it: uv run python3 scripts/make_le_template.py")

    sources = collect_sources(target)
    md = ensure_reference_list(assemble(sources))
    check_abstract_length(md)
    check_citation_footnotes(md)

    root = target if target.is_dir() else target.parent
    if bibliography is None:
        for cand in (root / "references" / "sources.bib", root / "references.bib",
                     root / "sources.bib"):
            if cand.exists():
                bibliography = cand
                break
    csl = csl or DEFAULT_CSL

    if output is None:
        stem = (target.stem if target.is_file() else target.name)
        output = root / f"{stem}.docx"

    # Write the combined file next to the SOURCES, not next to the output:
    # relative image paths in the markdown resolve against the input file's
    # directory, so an -o outside the project would otherwise drop every figure.
    tmp_md = root / f".{output.stem}.combined.md"
    tmp_md.write_text(md)
    resource_path = ":".join(dict.fromkeys(str(s.parent.resolve()) for s in sources))

    cmd = [
        "pandoc", str(tmp_md),
        "-o", str(output),
        f"--reference-doc={TEMPLATE}",
        "--from=markdown+footnotes+tex_math_dollars+raw_tex",
        "--to=docx",
        "--wrap=none",
        f"--resource-path={resource_path}",
        "--filter=pandoc-crossref",
        "-M", "tblPrefix=table", "-M", "figPrefix=figure", "-M", "eqnPrefix=equation",
        "-M", "tableTitle=Table", "-M", "figureTitle=Figure",
        # Chicago sets "Table 1. Caption", not pandoc-crossref's "Table 1: Caption".
        "-M", "titleDelim=.",
        "-M", "link-citations=true",
        "-M", "reference-section-title=",
    ]
    if bibliography and bibliography.exists():
        cmd += ["--citeproc", f"--bibliography={bibliography}"]
        if csl.exists():
            cmd += [f"--csl={csl}"]
        else:
            print(f"WARN: CSL not found at {csl}; pandoc will use its default "
                  "(NOT Chicago author-date)", file=sys.stderr)
    else:
        print(f"INFO: no bibliography found (looked for references/sources.bib under "
              f"{root}); @citations will render literally", file=sys.stderr)

    result = subprocess.run(cmd, capture_output=True, text=True)
    tmp_md.unlink(missing_ok=True)
    if result.returncode != 0:
        sys.exit(f"ERROR: pandoc failed:\n{result.stderr}")
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)

    # Vector figures first: every later pass rewrites document.xml, and the
    # blip match keys off the media parts pandoc just wrote. Figures are looked
    # for beside the SOURCES (the L&E layout puts figure1.png next to paper.md)
    # as well as in the project's figures/ and drafts/ dirs, so both the
    # single-file and the project-dir invocation find their SVGs.
    figure_dirs = [s.parent.resolve() for s in sources]
    figure_dirs += [root / "figures", root / "drafts", root]
    attach_svg_blips(output, root, search_dirs=list(dict.fromkeys(figure_dirs)))

    # JLE: "An acknowledgment note should be included and placed at the
    # beginning of the footnotes." A symbol-marked (*) note keeps it out of the
    # numbered run, which is exactly the convention.
    if acknowledgement:
        inject_acknowledgement(output, acknowledgement, None)

    unnumber_back_matter(output)
    set_math_font(output)
    set_line_spacing(output, spacing)
    force_widow_control(output)
    # Latin Modern Roman sets ~15% wider than the Times metrics style_tables
    # models; without the correction it sizes columns short and Word breaks
    # words mid-token ("errors" -> "erro" / "r").
    style_tables(output, width_factor=LM_WIDTH_FACTOR)

    print(f"Output:   {output}")
    print(f"Sections: {len(sources)}")
    print(f"Spacing:  {spacing}")
    print(f"Words:    ~{len(md.split()):,}")

    if pdf:
        p = convert_to_pdf(output)
        if p:
            print(f"PDF:      {p}")
    return output


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Build a Law & Economics manuscript DOCX (JLE / JLS / JLEO house style)")
    ap.add_argument("target", type=Path, help="paper.md, or a project dir with drafts/*.md")
    ap.add_argument("-o", "--output", type=Path)
    ap.add_argument("--spacing", choices=list(LINE_RULE), default="double",
                    help="double (JLE submission requirement, default); onehalf/single "
                         "for internal circulation only")
    ap.add_argument("--bibliography", type=Path)
    ap.add_argument("--csl", type=Path, help=f"default: {DEFAULT_CSL.name} (CMOS 18e author-date)")
    ap.add_argument("--acknowledgement", default="",
                    help="text of the unnumbered (*) acknowledgment note")
    ap.add_argument("--pdf", action="store_true")
    a = ap.parse_args()
    if not a.target.exists():
        sys.exit(f"ERROR: {a.target} does not exist")
    build(a.target, a.output, spacing=a.spacing, bibliography=a.bibliography,
          csl=a.csl, pdf=a.pdf, acknowledgement=a.acknowledgement)


if __name__ == "__main__":
    main()
