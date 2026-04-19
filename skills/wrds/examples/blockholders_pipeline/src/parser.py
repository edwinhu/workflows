"""Parse SC 13D/G filings (Volkova pipeline, Python port).

One module, pure-function API so it is ProcessPoolExecutor-friendly.

Public entry point: ``parse_filing(path)`` returns a list of dicts with one
entry per (filer, subject) pair encoded in the SEC-HEADER block. Each dict
contains::

    filename, accession, form_type, file_date,
    fil_cik, fil_name, sbj_cik, sbj_name,
    max_prc, item12, cusip6

Mirrors R scripts 2–6 in Volkova's Block_Codes repository.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# 1. Split the SGML envelope into header / body / documents
# ---------------------------------------------------------------------------

_HEADER_RE = re.compile(r"<SEC-HEADER>.*?</SEC-HEADER>", re.DOTALL | re.IGNORECASE)
_DOC_RE = re.compile(r"<DOCUMENT>(.*?)</DOCUMENT>", re.DOTALL | re.IGNORECASE)
_TEXT_RE = re.compile(r"<TEXT>(.*?)</TEXT>", re.DOTALL | re.IGNORECASE)
_FILENAME_IN_DOC_RE = re.compile(r"<FILENAME>\s*(.*)", re.IGNORECASE)
_TYPE_IN_DOC_RE = re.compile(r"<TYPE>\s*(.*)", re.IGNORECASE)

# Whole SGML header key=value patterns
_ACCESSION_RE = re.compile(r"ACCESSION NUMBER:\s*(\S+)")
_SUBMISSION_TYPE_RE = re.compile(r"CONFORMED SUBMISSION TYPE:\s*(\S.*?)\s*\n")
_FILED_AS_OF_RE = re.compile(r"FILED AS OF DATE:\s*(\d{8})")


def _strip_html(html: str) -> str:
    """Convert HTML fragment to plain text. Prefer lxml, fallback to naive regex."""
    try:
        from lxml import html as lxml_html

        root = lxml_html.fromstring(html)
        # Replace block-level tags with newlines to preserve row structure
        for br in root.xpath(".//br"):
            br.tail = "\n" + (br.tail or "")
        text = root.text_content()
        return text
    except Exception:
        # Very loose fallback
        text = re.sub(r"<(br|/p|/div|/tr|/td)\b[^>]*>", "\n", html, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = text.replace("&nbsp;", " ").replace("&#160;", " ")
        text = re.sub(r"&[a-zA-Z#0-9]{1,8};", " ", text)
        return text


# ---------------------------------------------------------------------------
# 2. Parse SEC-HEADER block into (SUBJECT COMPANY, FILED BY) tuples
# ---------------------------------------------------------------------------

_COMPANY_HEADER_RE = re.compile(
    r"(SUBJECT COMPANY|FILED BY|SUBJECT-COMPANY|FILED-BY)\s*:\s*\n"
    r"(.*?)"
    r"(?=\n(?:SUBJECT COMPANY|FILED BY|SUBJECT-COMPANY|FILED-BY)\s*:|\Z)",
    re.DOTALL | re.IGNORECASE,
)


def _kv(block: str, key: str) -> Optional[str]:
    """Grab `KEY: <whitespace> value` — whitespace between colon and value varies."""
    m = re.search(rf"{re.escape(key)}\s*:[\t ]*([^\n]*)", block)
    if not m:
        return None
    v = m.group(1).strip()
    return v or None


def parse_header(header: str) -> dict:
    """Return dict with accession / form_type / file_date / subject / filers."""
    accession = None
    form_type = None
    file_date = None

    m = _ACCESSION_RE.search(header)
    if m:
        accession = m.group(1)
    m = _SUBMISSION_TYPE_RE.search(header)
    if m:
        form_type = m.group(1).strip()
    m = _FILED_AS_OF_RE.search(header)
    if m:
        file_date = m.group(1)

    subjects: list[dict] = []
    filers: list[dict] = []

    for m in _COMPANY_HEADER_RE.finditer(header):
        role = m.group(1).upper().replace("-", " ")
        body = m.group(2)
        info = {
            "cik": _kv(body, "CENTRAL INDEX KEY"),
            "name": _kv(body, "COMPANY CONFORMED NAME"),
            "sic": _kv(body, "STANDARD INDUSTRIAL CLASSIFICATION"),
            "irs": _kv(body, "IRS NUMBER"),
            "inc_state": _kv(body, "STATE OF INCORPORATION"),
            "fyear_end": _kv(body, "FISCAL YEAR END"),
        }
        if role.startswith("SUBJECT"):
            subjects.append(info)
        else:
            filers.append(info)

    return {
        "accession": accession,
        "form_type": form_type,
        "file_date": file_date,
        "subjects": subjects,
        "filers": filers,
    }


# ---------------------------------------------------------------------------
# 3. Extract primary document body (mirrors R get_body)
# ---------------------------------------------------------------------------


def extract_body(sgml: str) -> str:
    """Return plain-text body of the primary document."""
    m = _DOC_RE.search(sgml)
    if not m:
        return ""
    doc = m.group(1)

    # Filename extension controls HTML vs text handling
    ext = ""
    mfn = _FILENAME_IN_DOC_RE.search(doc)
    if mfn:
        filename = mfn.group(1).strip()
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # Carve out the <TEXT>...</TEXT> (or fall back to the whole document)
    mt = _TEXT_RE.search(doc)
    inner = mt.group(1) if mt else doc

    if ext in {"htm", "html", "xml", "xls", "xlsx"}:
        return _strip_html(inner)
    # Raw text (rare for modern filings, common for 1994-2003)
    return inner


# ---------------------------------------------------------------------------
# 4. Percent-position extraction (mirrors R get.lines + get.prc + get.max.prc)
# ---------------------------------------------------------------------------

_PCT_REGEXES = [
    re.compile(r"(\d{1,4}(?:[.,]\d{0,7})?\s?%|\d{0,3}(?:\.\d{1,7})?\s?%)"),
    re.compile(r"-0-"),
    re.compile(r"\d{0,3}\.\d{1,7}"),
]

_PERCENT_LINE_RE = re.compile(r"percent", re.IGNORECASE)


def _blank_strip(lines: list[str]) -> list[str]:
    return [ln for ln in lines if re.search(r"\S", ln)]


def _get_lines(body: str) -> list[str]:
    """For each 'percent' keyword, keep 16-line window starting at that line."""
    lines = body.split("\n")
    lines = lines[:3000]
    lines = _blank_strip(lines)
    out: list[str] = []
    for i, ln in enumerate(lines):
        if _PERCENT_LINE_RE.search(ln):
            window = " \n".join(lines[i : i + 16])
            out.append(window)
    return out


def _locate_prc(line: str) -> list[str]:
    lo = line.lower()
    for rx in _PCT_REGEXES:
        found = [m for m in rx.findall(lo) if m is not None and m != ""]
        if found:
            return found
    return []


def _get_prc_strings(all_windows: list[str]) -> list[str]:
    """Try progressively more lines (3,6,9,12,15) per window until a match."""
    if not all_windows:
        return []
    for end in (3, 6, 9, 12, 15):
        collected: list[str] = []
        for w in all_windows:
            first_n = " ".join(w.split("\n")[:end])
            cleaned = re.sub(r"(?<=\s)\s+|^\s+|\s+$", "", first_n)
            cleaned = cleaned.replace("240.13", "")
            cleaned = cleaned.replace("-0-%", "0%")
            cleaned = re.sub(r"\bnone\b|\bn/a\b|\bless\b|-0-|lessthan5%", "0  %", cleaned, flags=re.IGNORECASE)
            collected.extend(_locate_prc(cleaned))
        if collected:
            return collected
    return []


def _get_max_prc(prc_strings: list[str]) -> float:
    """Strip %, parse numeric, apply row-number correction, take max≤100."""
    vals: list[float] = []
    for s in prc_strings:
        t = s.replace("%", "").strip()
        t = t.replace(",", ".")  # some filings use European decimal
        try:
            v = float(t)
        except ValueError:
            continue
        # Row-number correction: row 9 / row 11 prefixes
        if v // 100 == 9:
            v -= 900
        if v // 100 == 11:
            v -= 1100
        if v // 10 == 11:
            v -= 110
        if 0 <= v <= 100:
            vals.append(v)
    if not vals:
        return 0.0
    return max(vals)


def parse_percent(body: str) -> float:
    windows = _get_lines(body)
    prc_strings = _get_prc_strings(windows)
    return _get_max_prc(prc_strings)


# ---------------------------------------------------------------------------
# 5. Identity code (Item 12 "Type of reporting person")
# ---------------------------------------------------------------------------

_CODE_LIST = ["bd", "bk", "ic", "iv", "ia", "ep", "hc", "sa", "cp", "co", "pn", "in", "fi", "oo"]


def _build_code_regexes() -> list[re.Pattern]:
    variants = [
        ["broker\\s+dealer", "bd"],
        ["bank", "bk"],
        ["insurance\\s+company", "ic"],
        ["investment\\s+company", "iv"],
        ["investment\\s+advisor", "ia"],
        ["employee\\s+benefit", "ep"],
        ["holding\\s+company", "hc"],
        ["savings\\s+association", "sa"],
        ["church\\s+plan", "cp"],
        ["corporation", "co\\s", "c0"],
        ["partnership", "pn"],
        ["individual", "in"],
        ["non-U\\.S\\.\\s+institution", "fi"],
        ["other", "oo", "o0", "00", "0\\.0", "o\\.o", "o\\.0", "0\\.o"],
    ]
    regexes: list[re.Pattern] = []
    for i, grp in enumerate(variants):
        extra = [
            f"{_CODE_LIST[i]}2",
            f"{_CODE_LIST[i]}page",
            f"person{_CODE_LIST[i]}",
        ]
        pat = "|".join(f"(\\b{x}\\b)" for x in grp + extra)
        regexes.append(re.compile(pat, re.IGNORECASE))
    return regexes


_CODE_REGEXES = _build_code_regexes()

_REPORTING_PERSON_RE = re.compile(
    r"type\s+(?:of|in|or)\s+reporting\s+person", re.IGNORECASE
)
_REPORTING_PERSON_ALT_RE = re.compile(
    r"type\s+(?:of|in|or)\s+person\s+reporting", re.IGNORECASE
)


def _get_item12_line(body: str) -> Optional[str]:
    """First-pass line-based extractor (mirrors R get_phares)."""
    lines = [ln.lower() for ln in body.split("\n") if re.search(r"\S", ln)]
    hit_indices = [i for i, ln in enumerate(lines) if _REPORTING_PERSON_RE.search(ln)]
    if not hit_indices:
        return None
    for offset in range(0, 6):
        for idx in hit_indices:
            if idx + offset >= len(lines):
                continue
            target = lines[idx + offset]
            matches: list[str] = []
            for code, rx in zip(_CODE_LIST, _CODE_REGEXES):
                if rx.search(target):
                    matches.append(code)
            if matches:
                return "|".join(matches)
    return None


def _get_item12_oneline(body: str) -> Optional[str]:
    """Second-pass collapsed extractor (mirrors R get_phares_one_line)."""
    lines = [ln for ln in body.split("\n") if re.search(r"\S", ln)][:3000]
    text = " ".join(lines).lower()
    text = re.sub(r"\s+", " ", text).strip()
    locs = [m.start() for m in _REPORTING_PERSON_RE.finditer(text)]
    if not locs:
        locs = [m.start() for m in _REPORTING_PERSON_ALT_RE.finditer(text)]
    if not locs:
        return None
    for span in (20, 40, 60, 80, 100, 120, 160):
        matches: list[str] = []
        fragments = [text[start : start + span] for start in locs]
        for code, rx in zip(_CODE_LIST, _CODE_REGEXES):
            if any(rx.search(frag) for frag in fragments):
                matches.append(code)
        if matches:
            return "|".join(matches)
    return None


def parse_item12(body: str, fil_cik: Optional[str] = None) -> Optional[str]:
    """Fidelity special-case + two-pass matcher."""
    if fil_cik and fil_cik.lstrip("0") == "315066":
        return "hc|in"
    res = _get_item12_line(body)
    if res is not None:
        return res
    return _get_item12_oneline(body)


# ---------------------------------------------------------------------------
# 6. CUSIP extractor (6-digit and 8-digit)
# ---------------------------------------------------------------------------

_CUSIP_BLOCK_RE = re.compile(
    r"((?:\n.*){6})CUSIP.*((?:\n.*){4})", re.IGNORECASE
)
_CUSIP_CANDIDATE_RE = re.compile(
    r"\b(?=\d.*\d)[A-Za-z0-9]{9}\b|\b\d[A-Za-z0-9]{5}-?[A-Za-z0-9]{2}-?[A-Za-z0-9]\b|"
    r"\d[A-Za-z0-9]{5}(?:\s[A-Za-z0-9]{2}\s[A-Za-z0-9]|-[A-Za-z0-9]{2}-[A-Za-z0-9])"
)


def parse_cusip(body: str) -> Optional[str]:
    m = _CUSIP_BLOCK_RE.search(body)
    if not m:
        return None
    block = m.group(0)
    cand = _CUSIP_CANDIDATE_RE.search(block)
    if not cand:
        return None
    cusip = cand.group(0).replace(" ", "").replace("-", "").upper()
    return cusip[:8] if len(cusip) >= 6 else None


# ---------------------------------------------------------------------------
# 7. End-to-end parse
# ---------------------------------------------------------------------------


def parse_filing(path: str | Path) -> list[dict]:
    """Parse a single SGML filing. Emits one row per (subject, filer) pair.

    Most filings have exactly one subject and one filer, so the usual output
    is a single-element list. Multi-filer joint 13Gs produce multiple rows.
    """
    path = Path(path)
    try:
        raw = path.read_text(encoding="latin-1", errors="replace")
    except OSError:
        return []

    m = _HEADER_RE.search(raw)
    if not m:
        return []
    header_text = m.group(0)
    hdr = parse_header(header_text)

    body_text = extract_body(raw)

    max_prc = parse_percent(body_text)
    cusip6 = parse_cusip(body_text)
    cusip6 = cusip6[:6] if cusip6 else None

    rows: list[dict] = []
    filers = hdr["filers"] or [{"cik": None, "name": None}]
    subjects = hdr["subjects"] or [{"cik": None, "name": None}]

    for fil in filers:
        item12 = parse_item12(body_text, fil_cik=fil.get("cik"))
        for sbj in subjects:
            rows.append(
                {
                    "filename": path.name,
                    "accession": hdr["accession"],
                    "form_type": hdr["form_type"],
                    "file_date": hdr["file_date"],
                    "fil_cik": fil.get("cik"),
                    "fil_name": fil.get("name"),
                    "sbj_cik": sbj.get("cik"),
                    "sbj_name": sbj.get("name"),
                    "max_prc": max_prc,
                    "item12": item12,
                    "cusip6": cusip6,
                }
            )
    return rows
