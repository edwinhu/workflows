#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""Build a served-form expert report .docx from markdown drafts.

    uv run python3 build_docx.py PROJECT_DIR [--output PATH] [--caption FILE] [--bib FILE]
                                 [--draft-header] [--exhibits DIR] [--pdf]
                                 [--typography smallcaps|plain]

Pipeline: combine drafts/*Draft*.md (law-review-docx's ordering, frontmatter strip, footnote
label prefixing, include sentinels) -> normalise citation locators, mark [TO SUPPLY: ...] ->
bib -> CSL JSON with legacy-shaped entries normalised (normalize_csl) -> pandoc --citeproc with
the Bluebook expert-report CSL to the JSON AST -> AST pass (citation paren-wrap strip, Id.
capitalisation, paragraph and heading number+tab, continuation divs, asterisk break, ordinal
points, signature, caption, exhibits) -> pandoc to docx with the generated reference template ->
OOXML pass (tabs, highlight, docket non-breaking hyphens, footnote separators, heading spacing,
continuation indent, draft header) -> checks that fail the build.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Optional
from xml.sax.saxutils import escape

try:
    import yaml
except ModuleNotFoundError:  # `uv run python3 build_docx.py` does not read the PEP 723 block
    import os
    if __name__ != "__main__":
        raise
    if os.environ.get("EXPERT_REPORT_REEXEC") or not shutil.which("uv"):
        sys.exit("ERROR: pyyaml is required (run with `uv run --script build_docx.py` or install pyyaml)")
    os.environ["EXPERT_REPORT_REEXEC"] = "1"
    os.execvp("uv", ["uv", "run", "--quiet", "--script", __file__, *sys.argv[1:]])

SKILL = Path(__file__).resolve().parents[1]
TEMPLATE = SKILL / "references" / "templates" / "expert_report_template.docx"
CSL = SKILL / "assets" / "bluebook-expert-report.csl"
HEADER_TEXT = "DRAFT, PRIVILEGED AND CONFIDENTIAL"
TYPOGRAPHY = ("smallcaps", "plain")


def _law_review():
    """law-review-docx's combining helpers (ordering, frontmatter, footnote prefixes, includes)."""
    path = SKILL.parent / "law-review-docx" / "scripts" / "build_docx.py"
    spec = importlib.util.spec_from_file_location("law_review_build_docx", path)
    if spec is None or spec.loader is None:
        sys.exit(f"ERROR: cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _strip_metadata():
    """strip_metadata.py (this directory), loaded by path under a unique name."""
    path = Path(__file__).resolve().parent / "strip_metadata.py"
    spec = importlib.util.spec_from_file_location("expert_report_strip_metadata", path)
    if spec is None or spec.loader is None:
        sys.exit(f"ERROR: cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------------------------- caption

def _frontmatter(text: str) -> dict:
    m = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def load_caption(project: Path, caption_file: Optional[Path]) -> tuple[Optional[dict], Optional[str]]:
    """--caption FILE, else <proj>/caption.yaml, else `caption:` in the writing plan's frontmatter."""
    if caption_file is not None:
        if not caption_file.exists():
            sys.exit(f"ERROR: --caption {caption_file} does not exist")
        return yaml.safe_load(caption_file.read_text()) or {}, str(caption_file)
    own = project / "caption.yaml"
    if own.exists():
        return yaml.safe_load(own.read_text()) or {}, str(own)
    for plan in sorted((project / ".planning").glob("*.md")):
        fm = _frontmatter(plan.read_text())
        if fm.get("workflow") == "writing" and isinstance(fm.get("caption"), dict):
            return fm["caption"], str(plan)
    return None, None


def _lines(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    return [ln for ln in str(value).strip().splitlines() if ln.strip()]


def _p(text: str = "", style: str = "CaptionLeft", *, bold: bool = False, first_line: int = 0,
       size: Optional[int] = None) -> str:
    ppr = f'<w:pStyle w:val="{style}"/>' + (f'<w:ind w:firstLine="{first_line}"/>' if first_line else "")
    rpr = ("<w:b/><w:bCs/>" if bold else "") + (f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>' if size else "")
    if text.startswith("[TO SUPPLY:"):
        rpr += '<w:highlight w:val="yellow"/>'
    mark = f"<w:rPr>{rpr}</w:rPr>" if rpr else ""
    run = f'<w:r>{mark}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>' if text else ""
    return f"<w:p><w:pPr>{ppr}{mark}</w:pPr>{run}</w:p>"


def caption_xml(cap: dict) -> str:
    """Page-1 caption as served: court centred, then a 2 x 4788-twip table whose bottom rule
    (under the left cell) and inside rule form the bracket; parties left, case no. and title right."""
    out = [_p(line, "CaptionCourt", bold=True) for line in _lines(cap.get("court"))]
    out.append(_p("", "CaptionCourt"))
    if cap.get("plaintiffs") or cap.get("defendants") or not cap.get("matter"):
        left = [_p(x) for x in _lines(cap.get("plaintiffs"))]
        left += [_p(), _p(cap.get("plaintiffs_label", "Plaintiffs,"), first_line=2070), _p(size=16),
                 _p("v.", first_line=360), _p(size=16), _p()]
        left += [_p(x) for x in _lines(cap.get("defendants"))]
        left += [_p(), _p(cap.get("defendants_label", "Defendants."), first_line=2070), _p(), _p()]
    else:  # "In re ..." caption: the matter name, padded to the adversarial column's height
        matter = [_p(x) for x in _lines(cap.get("matter"))]
        left = matter + [_p() for _ in range(max(0, 10 - len(matter)))] + [_p(size=16), _p(size=16)]
    right = [_p(str(cap.get("case_number", "")), "CaptionRight"), _p(style="CaptionRight"),
             _p(style="CaptionRight"), _p(style="CaptionRight")]
    right += [_p(x, "CaptionRight", bold=True) for x in _lines(cap.get("report_title"))]
    nil = lambda side: f'<w:{side} w:val="nil"/>'  # noqa: E731
    one = lambda side: f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>'  # noqa: E731
    tbl = ("<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>"
           '<w:tblInd w:w="0" w:type="dxa"/><w:tblBorders>'
           + nil("top") + nil("left") + one("bottom") + nil("right") + nil("insideH") + one("insideV")
           + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/>'
           '<w:right w:w="108" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0480" w:firstRow="0" '
           'w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
           '<w:tblGrid><w:gridCol w:w="4788"/><w:gridCol w:w="4788"/></w:tblGrid><w:tr>'
           '<w:tc><w:tcPr><w:tcW w:w="4788" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>' + "".join(left) + "</w:tc>"
           '<w:tc><w:tcPr><w:tcW w:w="4788" w:type="dxa"/><w:tcBorders>' + nil("top") + nil("bottom")
           + '</w:tcBorders><w:vAlign w:val="top"/></w:tcPr>' + "".join(right) + "</w:tc></w:tr></w:tbl>")
    out.append(tbl)
    return "".join(out)


# --------------------------------------------------------------------------- markdown passes

CITE_GROUP = re.compile(r"\[([^\[\]]*?@[^\[\]]*)\]")
CITE_ITEM = re.compile(r"^(\s*[^@]*?)(-?@[\w:.#$%&\-+?<>~/]+)(.*)$", re.S)


def _brace_locator(loc: str) -> str:
    if loc.startswith("{"):
        return loc
    inner = "p. " + loc[3:].strip() if loc.startswith("at ") else loc
    inner = re.sub(r"(?<!\\)([*&])", r"\\\1", inner)
    return "{" + inner + "}"


def normalize_locators(md: str) -> str:
    """[@k, at 4 ¶ 4] -> [@k, {p. 4 ¶ 4}]; any other locator is braced verbatim.

    Pandoc guesses a label for an unbraced or bare-braced locator and gets single numbers wrong
    (`{45}` loses its page label while `{6}` keeps it), which decides whether the CSL prints "at".
    The draft's "at" becomes an explicit page label; the CSL puts "at" back where Bluebook wants it.
    """
    def group(m: re.Match) -> str:
        parts = []
        for item in m.group(1).split(";"):
            im = CITE_ITEM.match(item)
            if not im:
                parts.append(item)
                continue
            pre, key, rest = im.groups()
            if rest.startswith(","):
                loc = rest[1:].strip()
                rest = ", " + _brace_locator(loc) if loc else ""
            parts.append(pre + key + rest)
        return "[" + ";".join(parts) + "]"
    return CITE_GROUP.sub(group, md)


def mark_placeholders(md: str) -> tuple[str, int]:
    """Wrap each [TO SUPPLY: ...] (nested brackets allowed) in the Placeholder character style."""
    out, i, n = [], 0, 0
    while True:
        j = md.find("[TO SUPPLY:", i)
        if j < 0:
            out.append(md[i:])
            break
        depth, k = 0, j
        while k < len(md):
            depth += {"[": 1, "]": -1}.get(md[k], 0)
            if depth == 0:
                break
            k += 1
        body = md[j:k + 1].replace("[", "\\[").replace("]", "\\]")
        out.append(md[i:j] + "[" + body + ']{custom-style="Placeholder"}')
        n += 1
        i = k + 1
    return "".join(out), n


PROTECT = ("title", "shorttitle", "subtitle", "titleaddon", "journaltitle", "journal",
           "shortjournal", "booktitle", "maintitle", "eventtitle", "series")
FIELD = re.compile(r"(?<![\w-])(%s)(\s*=\s*)" % "|".join(PROTECT), re.I)


def protect_bib(text: str) -> str:
    """Brace title-like fields so pandoc's biblatex reader does not sentence-case them."""
    out, i = [], 0
    for m in FIELD.finditer(text):
        if m.start() < i:
            continue
        start = m.end()
        if start >= len(text) or text[start] not in '{"':
            continue
        if text[start] == "{":
            depth, k = 0, start
            while k < len(text):
                depth += {"{": 1, "}": -1}.get(text[k], 0)
                if depth == 0:
                    break
                k += 1
            inner = text[start + 1:k]
        else:
            k = start + 1
            depth = 0
            while k < len(text) and not (text[k] == '"' and depth == 0):
                depth += {"{": 1, "}": -1}.get(text[k], 0)
                k += 1
            inner = text[start + 1:k]
        wrapped = inner.startswith("{") and inner.endswith("}") and _balanced_whole(inner)
        value = "{" + inner + "}" if wrapped else "{{" + inner + "}}"
        out.append(text[i:start] + value)
        i = k + 1
    out.append(text[i:])
    return "".join(out)


def _scan_value(text: str, k: int) -> tuple[str, int]:
    """One biblatex field value starting at text[k]: {braced}, "quoted" or a bare token."""
    if text[k] == "{":
        depth, j = 0, k
        while j < len(text):
            depth += {"{": 1, "}": -1}.get(text[j], 0)
            if depth == 0:
                return text[k + 1:j], j + 1
            j += 1
        return text[k + 1:], len(text)
    if text[k] == '"':
        depth, j = 0, k + 1
        while j < len(text) and not (text[j] == '"' and depth == 0):
            depth += {"{": 1, "}": -1}.get(text[j], 0)
            j += 1
        return text[k + 1:j], j + 1
    m = re.match(r"[^,}\s]+", text[k:])
    return (m.group(0), k + m.end()) if m else ("", k + 1)


def bib_fields(text: str) -> dict[str, dict[str, str]]:
    """{key: {"_type": entry type, field: raw value}} for every entry, legacy fields included.

    pandoc's biblatex reader drops `reporter` and folds `institution`, `organization` and
    `howpublished` of a @misc into one `publisher`; normalize_csl needs them apart."""
    out: dict[str, dict[str, str]] = {}
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s{}]+)\s*,", text):
        etype = m.group(1).lower()
        if etype in ("comment", "string", "preamble"):
            continue
        fields, k = {"_type": etype}, m.end()
        while k < len(text):
            while k < len(text) and text[k] in " \t\r\n,":
                k += 1
            if k >= len(text) or text[k] == "}":
                break
            fm = re.match(r"([\w\-:.]+)\s*=\s*", text[k:])
            if not fm:
                break
            value, k = _scan_value(text, k + fm.end())
            fields[fm.group(1).lower()] = value.strip()
        out[m.group(2)] = fields
    return out


def _latex_text(values: dict[tuple[str, str], str]) -> dict[tuple[str, str], str]:
    """Raw biblatex values -> plain text, through pandoc's own reader (one call)."""
    if not values:
        return {}
    keys = list(values)
    bib = "\n".join("@misc{v%d, title = {{%s}}}" % (i, values[k]) for i, k in enumerate(keys))
    res = subprocess.run(["pandoc", "-f", "biblatex", "-t", "csljson"], input=bib,
                         capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"ERROR: pandoc could not read bib field values:\n{res.stderr}")
    got = {e["id"]: e.get("title", "") for e in json.loads(res.stdout)}
    return {k: got.get(f"v{i}", values[k]) for i, k in enumerate(keys)}


LEGACY_RAW = ("reporter", "institution", "court", "organization", "howpublished")
UNREPORTED = re.compile(r"^(?:WL|LEXIS|[\w. ]+ LEXIS)$")
# a release or committee report: the issuing body never prints as an author
AGENCY_GENRE = re.compile(r"(?:Release|Rep\.)$")
# a code cite at the head of a title: "17 C.F.R. § 230.405 (Definitions), current through ..."
CODE_CITE = re.compile(r"^(\d+ (?:U\.S\.C\.|C\.F\.R\.)(?: Supp\.(?: [IVX]+)?)?\s*§+[\s ]*[\w.\-]+"
                       r"|[A-Z][\w.]*(?: [A-Z][\w.]*)* Code Ann\. tit\. \d+, §+[\s ]*[\w.\-]+)")
HOW_NUMBER = re.compile(r"^(.*?)\s+No\.\s+(\S+)$")


def normalize_csl(items: list[dict], raw: dict[str, dict[str, str]]) -> list[dict]:
    """Legacy-shaped entries -> the CSL shape bib-conventions.md documents, in memory.

    Precedence (references/bib-conventions.md "Legacy-shaped entries"): an additive field beats
    the legacy one it duplicates (journaltitle > reporter, type/number > howpublished); a @misc
    takes its CSL type from its fields; note and annote are dropped. Nothing is ever read from
    `note`: a reporter cite there may be an affirmance or reversal that shares the caption."""
    out = []
    for item in items:
        it = dict(item)
        r = raw.get(it["id"], {"_type": ""})
        for f in ("note", "annote"):
            it.pop(f, None)
        if not it.get("container-title") and r.get("reporter"):
            it["container-title"] = r["reporter"]
        court = r.get("institution") or r.get("court")
        cited = all(it.get(f) for f in ("volume", "container-title", "page"))
        if it.get("type") in ("", "document") and r.get("_type") == "misc":
            if it.get("event"):                                    # expert report, deposition
                it["type"] = "report"
                it.pop("author", None)
            elif court and (r.get("reporter") or cited):
                it["type"] = "legal_case"
            elif it.get("genre") and it.get("number"):             # release, committee report
                it["type"] = "report"
            elif CODE_CITE.match(it.get("title", "")):
                it["type"] = "legislation"
                it.pop("author", None)
            elif it.get("author") and r.get("howpublished"):       # firm memo
                it["type"] = "report"
                if not it.get("genre"):
                    m = HOW_NUMBER.match(r["howpublished"])
                    it["genre"], num = (m.group(1), m.group(2)) if m else (r["howpublished"], None)
                    if num and not it.get("number"):
                        it["number"] = num
            if court:
                it["publisher"] = court
            else:
                it.pop("publisher", None)
        if it.get("type") == "report" and it.get("genre") and it.get("number"):
            if AGENCY_GENRE.search(it["genre"]):
                it.pop("author", None)
            cite = f"{it['genre']} No. {it['number']}"
            if it.get("title", "").startswith(cite):               # the title only restates the cite
                it.pop("title", None)
        if it.get("type") == "legislation":
            m = CODE_CITE.match(it.get("title", ""))
            if m:
                it["title"] = m.group(1)
        if it.get("type") == "legal_case" and it.get("number") and cited \
                and not UNREPORTED.match(it["container-title"]):
            it.pop("number")                                       # a reported case prints no docket
        if it.get("type") in ("report", "legal_case") and it.get("number") and not it.get("genre") \
                and not re.search(r"\bNos?\.", it["number"]):
            it["number"] = "No. " + it["number"]                   # a bare docket reads "No. X"
        out.append(it)
    return out


def csl_bibliography(bib_text: str) -> list[dict]:
    """bib -> CSL JSON (pandoc, titles protected) -> normalize_csl."""
    res = subprocess.run(["pandoc", "-f", "biblatex", "-t", "csljson"], input=protect_bib(bib_text),
                         capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"ERROR: pandoc could not read the bibliography:\n{res.stderr}")
    raw = bib_fields(bib_text)
    plain = _latex_text({(k, f): v for k, fields in raw.items() for f, v in fields.items()
                         if f in LEGACY_RAW and v})
    for (k, f), v in plain.items():
        raw[k][f] = v
    return normalize_csl(json.loads(res.stdout), raw)


def _balanced_whole(s: str) -> bool:
    depth = 0
    for idx, ch in enumerate(s):
        depth += {"{": 1, "}": -1}.get(ch, 0)
        if depth == 0 and idx < len(s) - 1:
            return False
    return depth == 0


# Under `typography: plain` (court-document style) these macros' small caps become italic;
# every other small-caps run (journals, authors, short names) becomes roman.
PLAIN_ITALIC = ("book-title", "memo-title")
SMALL_CAPS = re.compile(r'\s*font-variant="small-caps"')


def plain_csl(csl: str) -> str:
    def macro(m: re.Match) -> str:
        return SMALL_CAPS.sub(' font-style="italic"' if m.group(1) in PLAIN_ITALIC else "", m.group(0))
    out = re.sub(r'<macro name="([^"]+)">.*?</macro>', macro, csl, flags=re.S)
    return SMALL_CAPS.sub("", out)


def resolve_typography(flag: Optional[str], cap: Optional[dict]) -> str:
    """--typography, else caption `typography:`, else small caps (the served footnotes)."""
    value = str(flag or (cap or {}).get("typography") or "smallcaps").strip().lower()
    if value not in TYPOGRAPHY:
        sys.exit(f"ERROR: typography must be one of {', '.join(TYPOGRAPHY)}; got {value!r}")
    return value


# --------------------------------------------------------------------------- AST pass

def Str(s: str) -> dict:
    return {"t": "Str", "c": s}


def Div(style: str, blocks: list) -> dict:
    return {"t": "Div", "c": [["", [], [["custom-style", style]]], blocks]}


def Para(inlines: list) -> dict:
    return {"t": "Para", "c": inlines}


def raw(xml: str) -> dict:
    return {"t": "RawBlock", "c": ["openxml", xml]}


PAGE_BREAK = raw('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')


def stringify(x: Any) -> str:
    if isinstance(x, list):
        return "".join(stringify(v) for v in x)
    if not isinstance(x, dict):
        return ""
    t = x.get("t")
    if t == "Str":
        return x["c"]
    if t in ("Space", "SoftBreak", "LineBreak"):
        return " "
    if t in ("Emph", "Strong", "SmallCaps", "Strikeout", "Underline", "Superscript", "Subscript"):
        return stringify(x["c"])
    if t in ("Span", "Quoted", "Cite", "Link"):
        return stringify(x["c"][-1] if t != "Link" else x["c"][1])
    if t == "Note":
        return ""
    return ""


SIGNAL_ABBREV = {"cf.", "e.g.", "i.e.", "accord.", "v.", "no.", "nos."}


def _sentence_start(prev: list) -> bool:
    for x in reversed(prev):
        if x["t"] in ("Space", "SoftBreak"):
            continue
        s = stringify(x).strip()
        if not s:
            continue
        return s[-1] in ".?!" and s.split()[-1].lower() not in SIGNAL_ABBREV
    return True


def _capitalize(inlines: list) -> bool:
    for x in inlines:
        if x["t"] == "Str":
            if x["c"][:1].islower():
                x["c"] = x["c"][0].upper() + x["c"][1:]
            return True
        if x["t"] in ("Emph", "Strong", "SmallCaps"):
            if _capitalize(x["c"]):
                return True
        elif x["t"] == "Span":
            if _capitalize(x["c"][1]):
                return True
        elif x["t"] != "Space":
            return True
    return False


def strip_paren_wrap(rendered: list) -> list:
    """Undo pandoc's ' (' ... ')' wrap around a citation that is not first in a footnote.

    Pandoc wraps every bracketed citation after a note's first in a leading Space, Str "(" and
    a closing ")" (law-review-docx: "Pandoc-Citeproc Paren-Wrap Inside Footnotes"). The CSL
    never begins a citation with "(", so the signature is unambiguous.
    """
    i = 1 if rendered and rendered[0]["t"] == "Space" else 0
    if len(rendered) <= i or rendered[i]["t"] != "Str" or not rendered[i]["c"].startswith("("):
        return rendered
    last = rendered[-1]
    if last["t"] != "Str" or not last["c"].endswith(")"):
        return rendered
    out = rendered[i:]
    out[0] = Str(out[0]["c"][1:])
    out[-1] = Str(out[-1]["c"][:-1])
    return [x for x in out if not (x["t"] == "Str" and x["c"] == "")]


SECTION_NO = re.compile(r"^\d[\w.\-]*$")
SUBSECTION = re.compile(r"^\((?:[a-z]{1,4}|[ivxl]+|[A-Z]|\d{1,2})\)")


def join_subsections(rendered: list) -> list:
    """`§ 230.405` + `(a)` -> `§ 230.405(a)`: a subsection-only pin follows the section with no
    space (the CSL joins title and pin with one). A year `(2026)` never matches."""
    out = list(rendered)
    for x in out:
        if x["t"] == "Span":
            x["c"][1] = join_subsections(x["c"][1])
        elif x["t"] in ("Emph", "Strong", "SmallCaps"):
            x["c"] = join_subsections(x["c"])
    i = 1
    while i < len(out) - 1:
        before = stringify(out[max(0, i - 4):i]).split()
        if (out[i]["t"] == "Space" and out[i + 1]["t"] == "Str" and SUBSECTION.match(out[i + 1]["c"])
                and len(before) >= 2 and SECTION_NO.match(before[-1]) and before[-2].startswith("§")):
            del out[i]
            continue
        i += 1
    return out


TITLE_SECTION = re.compile(r"§[\s\u00a0]*([\w.\-]+)$")


def _last_str(inlines: list) -> Optional[dict]:
    for x in reversed(inlines):
        if x["t"] == "Str":
            return x
        if x["t"] == "Span":
            found = _last_str(x["c"][1])
        elif x["t"] in ("Emph", "Strong", "SmallCaps"):
            found = _last_str(x["c"])
        elif x["t"] == "Space":
            continue
        else:
            return None
        if found is not None:
            return found
    return None


def merge_statute_section(rendered: list) -> list:
    """`tit. 8, § 144` + pin `§ 144(d)(2)` -> `tit. 8, § 144(d)(2)`: a section pin on a title
    that already ends in a section replaces that section. Bluebook never writes `§ N § M`."""
    out = list(rendered)
    for x in out:
        if x["t"] == "Span":
            x["c"][1] = merge_statute_section(x["c"][1])
    i = 1
    while i < len(out) - 3:
        if (out[i]["t"] == "Space" and out[i + 1] == Str("§") and out[i + 2]["t"] == "Space"
                and out[i + 3]["t"] == "Str" and TITLE_SECTION.search(stringify(out[:i]))):
            leaf = _last_str(out[:i])
            if leaf is not None and TITLE_SECTION.search(leaf["c"]):
                leaf["c"] = leaf["c"][:TITLE_SECTION.search(leaf["c"]).start(1)]
            elif leaf is not None and re.fullmatch(r"[\w.\-]+", leaf["c"]):
                leaf["c"] = ""  # `§`, Space, `144`: drop the number, keep `§ `
            else:
                i += 1
                continue
            del out[i:i + 3]
            continue
        i += 1
    return out


def fix_note_inlines(inlines: list) -> None:
    for idx, x in enumerate(inlines):
        if x["t"] == "Cite":
            rendered = join_subsections(merge_statute_section(strip_paren_wrap(x["c"][1])))
            # the text before the citation already carries its space
            x["c"][1] = rendered
            if _sentence_start(inlines[:idx]):
                _capitalize(rendered)
            nxt = inlines[idx + 1] if idx + 1 < len(inlines) else None
            if (nxt and nxt["t"] == "Str" and nxt["c"].startswith(".")
                    and stringify(rendered).endswith(".")):
                nxt["c"] = nxt["c"][1:]
        elif x["t"] in ("Emph", "Strong", "SmallCaps", "Quoted"):
            fix_note_inlines(x["c"] if x["t"] != "Quoted" else x["c"][1])
        elif x["t"] == "Span":
            fix_note_inlines(x["c"][1])
    inlines[:] = [x for x in inlines if not (x["t"] == "Str" and x["c"] == "")]


def walk_notes(node: Any) -> None:
    if isinstance(node, list):
        for v in node:
            walk_notes(v)
    elif isinstance(node, dict):
        if node.get("t") == "Note":
            for blk in node["c"]:
                _fix_block(blk)
            return
        for v in node.values():
            if isinstance(v, (list, dict)):
                walk_notes(v)


def _fix_block(blk: dict) -> None:
    if blk["t"] in ("Para", "Plain"):
        fix_note_inlines(blk["c"])
    elif blk["t"] in ("BlockQuote",):
        for b in blk["c"]:
            _fix_block(b)
    elif blk["t"] == "Div":
        for b in blk["c"][1]:
            _fix_block(b)


CONTINUATION = "Continuation Marker"  # rewritten in the OOXML pass to Body Text, firstLine 0
NUM_RE = re.compile(r"^\d{1,3}\.$")
HEAD_NUM_RE = re.compile(r"^(?:[IVXLC]+|[A-Z]|\d{1,2}|[a-z])\.$")
ORDINALS = {"first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
            "ninth", "tenth", "finally", "last", "lastly"}


def _number_tab(inlines: list, pattern: re.Pattern) -> bool:
    if len(inlines) >= 2 and inlines[0]["t"] == "Str" and pattern.match(inlines[0]["c"]) \
            and inlines[1]["t"] == "Space":
        inlines[0] = Str(inlines[0]["c"] + "\t")
        del inlines[1]
        return True
    return False


def transform_body(blocks: list, cap: Optional[dict]) -> dict:
    stats = {"numbered": 0, "signature": "none"}
    out = []
    for b in blocks:
        if b["t"] == "Div" and "continuation" in b["c"][0][1]:
            # carries on the paragraph above a block quote: Body Text, flush left, never numbered
            b = Div(CONTINUATION, b["c"][1])
        elif b["t"] == "Header":
            _number_tab(b["c"][2], HEAD_NUM_RE)
        elif b["t"] == "Para":
            ins = b["c"]
            if _number_tab(ins, NUM_RE):
                stats["numbered"] += 1
            elif re.fullmatch(r"\*( \*){2,}", stringify(ins).strip()):
                b = Div("Asterisk Break", [Para([Str("*\t*\t*\t*")])])
            elif ins and ins[0]["t"] == "Emph" and stringify(ins[0]).strip(" ,.").lower() in ORDINALS:
                b = Div("Ordinal Point", [Para([Str("•\t")] + ins)])
        out.append(b)

    # Signature block: short unnumbered paragraphs after the last numbered one are the drafts' own
    # signature lines; style them. With none, generate name (right) and date (left) from the caption.
    last_num = max((i for i, b in enumerate(out) if b["t"] == "Para" and b["c"]
                    and b["c"][0]["t"] == "Str" and NUM_RE.match(b["c"][0]["c"].rstrip("\t"))),
                   default=-1)
    tail = []
    for i in range(len(out) - 1, last_num, -1):
        b = out[i]
        if b["t"] == "Para" and len(stringify(b["c"])) <= 120:
            tail.insert(0, i)
        else:
            break
    expert = str((cap or {}).get("expert", "")).strip()
    if tail:
        for i in tail:
            text = stringify(out[i]["c"]).lower()
            sig = "signature" in text or (expert and expert.lower() in text)
            out[i] = Div("Signature" if sig else "Signature Date", [out[i]])
        stats["signature"] = f"styled {len(tail)} draft line(s)"
    elif expert:
        date = str((cap or {}).get("date", "")).strip()
        out.append(Div("Signature", [Para([Str(expert)])]))
        date_inl = [Str(date)] if date else [{"t": "Span", "c": [["", [], [["custom-style", "Placeholder"]]],
                                                                 [Str("[TO SUPPLY: date]")]]}]
        out.append(Div("Signature Date", [Para(date_inl)]))
        stats["signature"] = "generated from caption"
    blocks[:] = out
    return stats


def list_blocks(blocks: list) -> list:
    """Markdown lists -> Ordinal Point paragraphs with a literal mark and tab. Word sets a list
    numbering suffix in Arial whatever the level fonts say, which fails the --pdf font check."""
    out = []
    for blk in blocks:
        if blk.get("t") not in ("BulletList", "OrderedList"):
            out.append(blk)
            continue
        ordered = blk["t"] == "OrderedList"
        start, items = (blk["c"][0][0], blk["c"][1]) if ordered else (1, blk["c"])
        for k, item in enumerate(items):
            mark = f"{start + k}.\t" if ordered else "•\t"
            first = True
            for sub in list_blocks(item):
                if first and sub.get("t") in ("Plain", "Para"):
                    out.append(Div("Ordinal Point", [Para([Str(mark)] + sub["c"])]))
                    first = False
                else:
                    out.append(sub)
    return out


def exhibit_blocks(paths: list[Path]) -> tuple[list, list[str]]:
    blocks, names = [], []
    for n, path in enumerate(paths):
        letter = chr(ord("A") + n)
        names.append(f"EXHIBIT {letter}: {path.name}")
        blocks.append(Div("Exhibit Title", [Para([Str(f"EXHIBIT {letter}")])]))
        blocks.append(PAGE_BREAK)
        if path.suffix.lower() == ".md":
            md, _ = mark_placeholders(_law_review().strip_frontmatter(path.read_text()))
            ast = json.loads(subprocess.run(["pandoc", "-f", "markdown-auto_identifiers", "-t", "json"],
                                            input=md, capture_output=True, text=True, check=True).stdout)
            for b in ast["blocks"]:
                if b["t"] == "Header":
                    b = Div("Exhibit Heading", [Para(b["c"][2])])
                blocks.append(b)
        else:
            blocks.append(Para([Str(f"[Attached separately: {path.name}]")]))
    return blocks, names


# --------------------------------------------------------------------------- OOXML pass

RPR_TAIL = re.compile(r"<w:(?:u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|"
                      r"specVanish|oMath)\b")


def _rpr_insert(rpr_inner: str, element: str) -> str:
    m = RPR_TAIL.search(rpr_inner)
    return rpr_inner[:m.start()] + element + rpr_inner[m.start():] if m else rpr_inner + element


def tabs_to_elements(xml: str) -> str:
    def t(m: re.Match) -> str:
        if "\t" not in m.group(2):
            return m.group(0)
        pieces = m.group(2).split("\t")
        return '<w:tab/>'.join(f'<w:t xml:space="preserve">{p}</w:t>' if p else "" for p in pieces)
    return re.sub(r"(<w:t(?:\s[^>]*)?>)([^<]*)</w:t>", t, xml)


def highlight_placeholders(xml: str) -> str:
    def run(m: re.Match) -> str:
        r = m.group(0)
        if not re.search(r'<w:rStyle w:val="Placeholder"\s*/>', r) or "<w:highlight" in r:
            return r
        return re.sub(r"<w:rPr>(.*?)</w:rPr>",
                      lambda mm: "<w:rPr>" + _rpr_insert(mm.group(1), '<w:highlight w:val="yellow"/>') + "</w:rPr>",
                      r, count=1, flags=re.S)
    return re.sub(r"<w:r>(?:(?!</w:r>).)*</w:r>", run, xml, flags=re.S)


# A docket or release number must not break at its hyphens: two or more hyphen-joined segments
# with a digit (1:24-cv-00999-UNA, 2019-0001-ABC, CV-24-0999-PHX-ABC), or any hyphenated number
# right after "No." (33-7391). Ordinary hyphens (well-known, 10b-5, 10-K) stay breakable.
DOCKET = re.compile(r"(?<![\w\-])(?:(?<=No\. )|(?<=NO\. ))[A-Za-z0-9:.]+(?:-[A-Za-z0-9]+)+(?![\w\-])"
                    r"|(?<![\w\-])(?=[A-Za-z0-9:.\-]*\d)[A-Za-z0-9:.]+(?:-[A-Za-z0-9]+){2,}(?![\w\-])")


def nobreak_dockets(xml: str) -> str:
    """Hyphens inside docket numbers -> w:noBreakHyphen, splitting the w:t around each one."""
    def t(m: re.Match) -> str:
        text = m.group(2)
        if "-" not in text or not DOCKET.search(text):
            return m.group(0)
        marked = DOCKET.sub(lambda d: d.group(0).replace("-", "\x00"), text)
        return '<w:noBreakHyphen/>'.join(f'<w:t xml:space="preserve">{p}</w:t>' if p else ""
                                          for p in marked.split("\x00"))
    return re.sub(r"(<w:t(?:\s[^>]*)?>)([^<]*)</w:t>", t, xml)


# Word draws the rule's weight from the run's font: 0.60 pt under Times New Roman, 0.72 pt (as
# served) under Calibri, the served file's theme default. Calibri on these two runs only.
SEPARATOR = ('<w:footnote w:type="{typ}" w:id="{id}"><w:p><w:pPr>'
             '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
             '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
             '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:{typ}/></w:r></w:p></w:footnote>')


def fix_footnotes_part(xml: str) -> str:
    for typ, fid in (("separator", "-1"), ("continuationSeparator", "0")):
        new = SEPARATOR.format(typ=typ, id=fid)
        xml, n = re.subn(r'<w:footnote w:type="%s"[^>]*>.*?</w:footnote>' % typ, new, xml, count=1, flags=re.S)
        if n == 0:
            xml = re.sub(r"(<w:footnotes\b[^>]*>)", r"\1" + new, xml, count=1)
    return xml


def nbsp_sections(xml: str) -> str:
    """A non-breaking space after § and §§, within a w:t and across a run boundary in one
    paragraph (Word broke a line after "§" in the real report)."""
    xml = re.sub(r"(<w:t(?:\s[^>]*)?>)([^<]*)</w:t>",
                 lambda m: m.group(1) + re.sub(r"(§+) ", "\\1\u00a0", m.group(2)) + "</w:t>", xml)
    return re.sub(r"(§+</w:t>(?:(?!<w:t[\s>]|</w:p>).)*<w:t(?:\s[^>]*)?>) ", "\\1\u00a0", xml, flags=re.S)


def collapse_heading_spacing(xml: str) -> str:
    """A heading directly under another heading takes no space before (one blank line, as served)."""
    paras = list(re.finditer(r"<w:p\b(?:(?!<w:p\b).)*?</w:p>", xml, re.S))
    out, pos, prev_heading = [], 0, False
    for m in paras:
        p = m.group(0)
        is_heading = re.search(r'<w:pStyle w:val="Heading[1-3]"\s*/>', p) is not None
        if is_heading and prev_heading and xml[pos:m.start()].strip() == "":
            p = re.sub(r'<w:pStyle w:val="(Heading[1-3])"\s*/>', r'<w:pStyle w:val="\1"/><w:spacing w:before="0"/>', p, count=1)
        out.append(xml[pos:m.start()] + p)
        pos = m.end()
        prev_heading = is_heading
    out.append(xml[pos:])
    return "".join(out)


HDR_XML = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
           '<w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="center"/></w:pPr>'
           '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
           f"<w:t>{HEADER_TEXT}</w:t></w:r></w:p></w:hdr>")


def continuation_paragraphs(doc: str, styles: str) -> tuple[str, str]:
    """The continuation marker style -> Body Text with w:firstLine="0"; drop the marker's
    definition pandoc added to styles.xml."""
    sid = CONTINUATION.replace(" ", "")
    doc = re.sub(r'<w:pStyle w:val="%s"\s*/>' % sid, '<w:pStyle w:val="BodyText"/><w:ind w:firstLine="0"/>', doc)
    styles = re.sub(r'<w:style\b[^>]*w:styleId="%s"[^>]*>.*?</w:style>' % sid, "", styles, flags=re.S)
    return doc, styles


def postprocess(docx: Path, draft_header: bool) -> list[str]:
    with zipfile.ZipFile(docx) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    doc = parts["word/document.xml"].decode()
    doc, styles = continuation_paragraphs(doc, parts["word/styles.xml"].decode())
    parts["word/styles.xml"] = styles.encode()
    doc = nbsp_sections(nobreak_dockets(collapse_heading_spacing(highlight_placeholders(tabs_to_elements(doc)))))
    if "word/footnotes.xml" in parts:
        fn = parts["word/footnotes.xml"].decode()
        parts["word/footnotes.xml"] = nbsp_sections(nobreak_dockets(
            fix_footnotes_part(highlight_placeholders(tabs_to_elements(fn))))).encode()
    if draft_header:
        parts["word/header1.xml"] = HDR_XML.encode()
        rels = parts["word/_rels/document.xml.rels"].decode()
        parts["word/_rels/document.xml.rels"] = rels.replace(
            "</Relationships>", '<Relationship Id="rIdERHeader" Type="http://schemas.openxmlformats.org/'
            'officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>').encode()
        ct = parts["[Content_Types].xml"].decode()
        parts["[Content_Types].xml"] = ct.replace(
            "</Types>", '<Override PartName="/word/header1.xml" ContentType="application/vnd.'
            'openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>').encode()
        doc = re.sub(r"(<w:sectPr\b[^>]*>)", r'\1<w:headerReference w:type="default" r:id="rIdERHeader"/>', doc)
    parts["word/document.xml"] = doc.encode()
    # pandoc's writer drops settings/footnotePr; the served file declares its two special notes
    st = parts["word/settings.xml"].decode()
    if "<w:footnotePr>" not in st:
        decl = '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>'
        st = st.replace("<w:compat>", decl + "<w:compat>", 1) if "<w:compat>" in st else \
            re.sub(r"(<w:settings\b[^>]*>)", r"\1" + decl, st, count=1)
        parts["word/settings.xml"] = st.encode()
    sm = _strip_metadata()
    stripped = sm.strip_ooxml(parts)  # always: the owner's rule, not a flag
    tmp = docx.with_suffix(".tmp.docx")
    sm.write_zip(tmp, parts)
    tmp.replace(docx)
    return stripped


# --------------------------------------------------------------------------- checks

def docx_text(xml: str) -> str:
    return "".join(re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>", xml))


def real_footnote_count(fn_xml: str) -> int:
    return sum(1 for m in re.finditer(r"<w:footnote\b([^>]*)>", fn_xml) if "w:type=" not in m.group(1))


GUEST_FIX = ("start the Windows guest: `docker start omarchy-windows`, then wait until "
             "`ssh -o ConnectTimeout=5 -o BatchMode=yes word@winvm exit` succeeds (a cold boot "
             "takes minutes; see docx-render SKILL.md, 'Word in a Windows guest')")
BODY_FONT = "TimesNewRoman"
NON_TEXT_FONTS = ("Symbol",)


def _doc_render():
    """docx-render's renderer module (plugin-root scripts/doc_render.py)."""
    path = SKILL.parents[1] / "scripts" / "doc_render.py"
    spec = importlib.util.spec_from_file_location("expert_report_doc_render", path)
    if spec is None or spec.loader is None:
        sys.exit(f"ERROR: cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def convert_pdf(docx: Path) -> Path:
    """Render through real Word in the Windows guest (word-remote); no other engine, ever."""
    pdf = docx.with_suffix(".pdf")
    pdf.unlink(missing_ok=True)
    try:
        _doc_render().convert(docx, pdf, renderer="word-remote")
    except Exception as ex:  # noqa: BLE001 - every failure is fatal and reported
        pdf.unlink(missing_ok=True)
        sys.exit(f"ERROR: --pdf renders only through Word (word-remote) and it failed: {ex}\n"
                 f"Fix: {GUEST_FIX}. No other renderer is used.")
    if not pdf.exists() or pdf.stat().st_size == 0:
        sys.exit(f"ERROR: word-remote produced no PDF at {pdf}. Fix: {GUEST_FIX}")
    return pdf


def strip_pdf_metadata(pdf: Path) -> list[str]:
    """Strip the Word PDF's metadata (strip_metadata.strip_pdf: keeps Creator and Producer), in
    process when pikepdf is importable, else through `uv run --script`."""
    sm = _strip_metadata()
    try:
        import pikepdf  # noqa: F401
    except ModuleNotFoundError:
        res = subprocess.run(["uv", "run", "--quiet", "--script", sm.__file__, str(pdf)],
                             capture_output=True, text=True)
        if res.returncode != 0:
            sys.exit(f"ERROR: could not strip PDF metadata from {pdf}:\n{res.stderr}")
        line = res.stdout.strip().splitlines()[-1]
        return [x for x in line.split(": ", 1)[1].split(", ") if x != "nothing"]
    return sm.strip_pdf(pdf)


def check_fonts(names: list[str]) -> list[str]:
    """Fonts that are not Times New Roman (subset prefixes ignored; Symbol allowed)."""
    bare = [n.split("+", 1)[-1] for n in names]
    bad = [n for n, f in zip(names, bare)
           if not f.startswith(BODY_FONT) and not f.startswith(NON_TEXT_FONTS)]
    if not any(f.startswith(BODY_FONT) for f in bare):
        bad.insert(0, "(no Times New Roman font)")
    return bad


def pdf_fonts(pdf: Path) -> list[str]:
    out = subprocess.run(["pdffonts", str(pdf)], capture_output=True, text=True).stdout
    return [ln.split()[0] for ln in out.splitlines()[2:] if ln.strip()]


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", text.lower())}


def pdf_matches_docx(doc_text: str, pdf_text: str, min_share: float = 0.9) -> bool:
    """The guest stages every job under one fixed name with no lock, so a concurrent render can
    return another document's PDF; require the docx's distinct words to be in the PDF."""
    want = _words(doc_text)
    return bool(want) and len(want & _words(pdf_text)) >= min_share * len(want)


def check_word_pdf(pdf: Path) -> str:
    """Exit unless the PDF's Producer or Creator is Microsoft Word and every text font is Times
    New Roman (a guest missing a font substitutes Cambria/Calibri and still exits 0)."""
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
    fields = dict(re.findall(r"^(Producer|Creator):\s*(.*)$", info, re.M))
    producer = fields.get("Producer", "")
    if not any("Microsoft" in v and "Word" in v for v in fields.values()):
        sys.exit(f"ERROR: {pdf} is not Microsoft Word output (Producer: {producer or '?'}, "
                 f"Creator: {fields.get('Creator', '?')}); --pdf must come from word-remote")
    bad = check_fonts(pdf_fonts(pdf))
    if bad:
        sys.exit(f"ERROR: {pdf} body font is not Times New Roman: {', '.join(bad)} "
                 "(run word-render-install-fonts in the guest)")
    return producer


# --------------------------------------------------------------------------- build

def build(project: Path, output: Optional[Path] = None, caption_file: Optional[Path] = None,
          bib: Optional[Path] = None, draft_header: bool = False, exhibits_dir: Optional[Path] = None,
          pdf: bool = False, typography: Optional[str] = None) -> Path:
    lr = _law_review()
    drafts = sorted(project.glob("drafts/*Draft*.md"), key=lr.sort_key)
    if not drafts:
        sys.exit(f"ERROR: no drafts/*Draft*.md under {project}")
    if not TEMPLATE.exists():
        sys.exit(f"ERROR: template missing at {TEMPLATE}; run make_template.py")

    cap, cap_src = load_caption(project, caption_file)
    if cap is None:
        print("WARN: no caption (no --caption, caption.yaml, or writing-plan caption:); "
              "building without the page-1 caption", file=sys.stderr)
    draft_header = draft_header or bool((cap or {}).get("draft_header"))
    typography = resolve_typography(typography, cap)

    combined = ""
    for d in drafts:
        combined += lr.prefix_footnotes(lr.strip_frontmatter(d.read_text()), lr.get_prefix(d)) + "\n\n"
    combined = lr.resolve_includes(combined)
    definitions = len(re.findall(r"^\[\^[^\]]+\]:", combined, re.M))
    combined = normalize_locators(combined)
    combined, n_placeholders = mark_placeholders(combined)

    bib = bib or next((p for p in (project / "references" / "sources.bib",) if p.exists()), None)
    if bib is None:
        bibs = sorted((project / "references").glob("*.bib"))
        bib = bibs[0] if len(bibs) == 1 else None

    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        md_path = tdp / "combined.md"
        md_path.write_text(combined)
        cmd = ["pandoc", str(md_path), "-f", "markdown-auto_identifiers", "-t", "json"]
        if bib is not None:
            if not bib.exists():
                sys.exit(f"ERROR: bibliography {bib} does not exist")
            safe = tdp / "bibliography.json"  # normalised CSL JSON: citeproc reads this, not the bib
            safe.write_text(json.dumps(csl_bibliography(bib.read_text()), ensure_ascii=False))
            csl = CSL
            if typography == "plain":
                csl = tdp / "plain.csl"
                csl.write_text(plain_csl(CSL.read_text()))
            cmd += ["--citeproc", f"--bibliography={safe}", f"--csl={csl}",
                    "-M", "suppress-bibliography=true", "-M", "link-citations=false"]
        else:
            print("WARN: no bibliography (--bib or references/sources.bib); citations stay as [@key]",
                  file=sys.stderr)
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            sys.exit(f"ERROR: pandoc failed:\n{res.stderr}")
        missing = sorted(set(re.findall(r"[Cc]itation (\S+) not found", res.stderr)))
        if missing:
            sys.exit(f"ERROR: citation keys not in {bib}: {', '.join(missing)}")
        for line in res.stderr.splitlines():
            print(line, file=sys.stderr)

        ast = json.loads(res.stdout)
        walk_notes(ast["blocks"])
        stats = transform_body(ast["blocks"], cap)
        if cap:
            ast["blocks"].insert(0, raw(caption_xml(cap)))
        ex_paths: list[Path] = []
        if exhibits_dir is not None:
            if not exhibits_dir.is_dir():
                sys.exit(f"ERROR: --exhibits {exhibits_dir} is not a directory")
            ex_paths = sorted(p for p in exhibits_dir.iterdir()
                              if p.suffix.lower() in (".md", ".pdf", ".docx", ".doc"))
        elif cap and cap.get("exhibits"):
            base = Path(cap_src).parent if cap_src else project
            ex_paths = [(base / p).expanduser() for p in cap["exhibits"]]
        ex_blocks, ex_names = exhibit_blocks(ex_paths)
        ast["blocks"] = list_blocks(ast["blocks"] + ex_blocks)

        if output is None:
            output = project / "output" / "expert-report.docx"
        output.parent.mkdir(parents=True, exist_ok=True)
        ast_path = tdp / "doc.json"
        ast_path.write_text(json.dumps(ast))
        res = subprocess.run(["pandoc", str(ast_path), "-f", "json", "-t", "docx",
                              f"--reference-doc={TEMPLATE}", "-o", str(output)],
                             capture_output=True, text=True)
        if res.returncode != 0:
            sys.exit(f"ERROR: pandoc (docx writer) failed:\n{res.stderr}")

    stripped = postprocess(output, draft_header)

    with zipfile.ZipFile(output) as z:
        doc_xml = z.read("word/document.xml").decode()
        fn_xml = z.read("word/footnotes.xml").decode() if "word/footnotes.xml" in z.namelist() else ""
    n_notes = real_footnote_count(fn_xml)
    highlighted = len(re.findall(r'<w:highlight w:val="yellow"/>', doc_xml + fn_xml))
    print(f"Output: {output}")
    print(f"Drafts: {len(drafts)} ({', '.join(d.stem for d in drafts)})")
    print(f"Caption: {cap_src or 'none'}")
    print(f"Header: {'DRAFT, PRIVILEGED AND CONFIDENTIAL' if draft_header else 'none'}")
    print(f"Typography: {typography}")
    print(f"Footnotes: {n_notes} (definitions: {definitions})")
    print(f"Numbered paragraphs: {stats['numbered']}")
    print(f"Signature: {stats['signature']}")
    print(f"Placeholders: {n_placeholders} (highlighted runs: {highlighted})")
    for name in ex_names:
        print(f"Exhibit: {name}")
    print(f"Metadata stripped: {'; '.join(stripped) or 'nothing'}")

    errors = []
    if n_notes != definitions:
        errors.append(f"footnote count {n_notes} != [^id]: definitions {definitions} "
                      "(a citation outside a footnote becomes an extra note)")
    for part, xml in (("document.xml", doc_xml), ("footnotes.xml", fn_xml)):
        text = docx_text(xml)
        for m in re.finditer(r"\[@", text):
            errors.append(f"unresolved citation in {part}: {text[m.start():m.start() + 60]!r}")
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if pdf:
        pdf_path = convert_pdf(output)
        pdf_stripped = strip_pdf_metadata(pdf_path)
        producer = check_word_pdf(pdf_path)  # after stripping: Creator and Producer must survive
        info = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True).stdout
        pages = re.search(r"Pages:\s+(\d+)", info)
        ptxt = subprocess.run(["pdftotext", str(pdf_path), "-"], capture_output=True, text=True).stdout
        if not pdf_matches_docx(docx_text(doc_xml) + " " + docx_text(fn_xml), ptxt):
            pdf_path.unlink(missing_ok=True)
            sys.exit(f"ERROR: the Word PDF does not contain this document's text: another render "
                     f"probably used the guest at the same time (one fixed job name, no lock). "
                     f"Rebuild with --pdf when no other render is running.")
        print(f"PDF: {pdf_path}")
        print(f"PDF metadata stripped: {', '.join(pdf_stripped) or 'nothing'}")
        print(f"PDF producer: {producer}")
        print(f"PDF fonts: {', '.join(pdf_fonts(pdf_path))}")
        print(f"PDF pages: {pages.group(1) if pages else '?'}")
        print(f"PDF [@ left: {ptxt.count('[@')}")
        print(f"PDF placeholders: {re.sub(r'\s+', ' ', ptxt).count('[TO SUPPLY:')}")  # may wrap
    return output


def main() -> None:
    ap = argparse.ArgumentParser(description="Build a served-form expert report .docx from markdown drafts")
    ap.add_argument("project_dir", type=Path)
    ap.add_argument("--output", "-o", type=Path)
    ap.add_argument("--caption", type=Path, help="caption YAML (default: PROJECT/caption.yaml, then the writing plan)")
    ap.add_argument("--bib", type=Path, help="bibliography (default: PROJECT/references/sources.bib)")
    ap.add_argument("--draft-header", action="store_true",
                    help=f'add the "{HEADER_TEXT}" running header (default: none, as served)')
    ap.add_argument("--exhibits", type=Path, help="directory of exhibits, lettered in filename order")
    ap.add_argument("--pdf", action="store_true", help="also render a PDF through Word in the Windows guest (word-remote) and check it")
    ap.add_argument("--typography", choices=TYPOGRAPHY,
                    help="smallcaps (default; journals, books, firm memos as served) or plain "
                         "(court-document style: roman, book and memo titles italic); "
                         "overrides caption `typography:`")
    a = ap.parse_args()
    if not a.project_dir.is_dir():
        sys.exit(f"ERROR: {a.project_dir} is not a directory")
    build(a.project_dir, a.output, a.caption, a.bib, a.draft_header, a.exhibits, a.pdf, a.typography)


if __name__ == "__main__":
    main()
