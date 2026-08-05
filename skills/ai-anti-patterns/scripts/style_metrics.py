#!/usr/bin/env python3
"""Stylometric feature extraction + human-likeness scoring for legal prose.

Measures the rhythm/diction features where LLM prose diverges from genuine
human legal scholarship, and scores any draft against empirical targets
derived from the pre-2020 law-review corpus (see docs/STYLE_SPEC.md).

Pure-Python / stdlib only. Complements the ai-tic phrase-density linter:
that one catches *lexical* tells (banned phrases); this one catches
*structural* tells (sentence rhythm, triad rate, diction).

Usage:
    from style_metrics import compute_features, score_text, HUMAN_STATS
    feats = compute_features(open("draft.txt").read())
    report = score_text(open("draft.txt").read())   # z-distances + composite

CLI:
    python3 style_metrics.py draft.txt           # composite score + per-feature z
    python3 style_metrics.py --lint draft.txt    # line-level findings (linter)
    python3 style_metrics.py --lint --json draft.txt
    python3 style_metrics.py --features draft.txt # raw features only
"""
from __future__ import annotations

import json
import math
import os
import re
import statistics
import sys

# --------------------------------------------------------------------------
# Text normalization: de-wrap hard-wrapped OCR, de-hyphenate line breaks.
# --------------------------------------------------------------------------

_PAGE_NUM = re.compile(r"^\s*\d+\s*$")
_FOOTNOTE_LEAD = re.compile(r"^\s*\d{1,4}\.\s")  # "12. " footnote leaders


def normalize_text(text: str) -> str:
    """Collapse hard line wraps into flowing prose.

    Joins end-of-line hyphenated words ("Califor-\nnia" -> "California"),
    joins remaining wrapped lines with spaces, and collapses whitespace.
    """
    lines = text.split("\n")
    out: list[str] = []
    for ln in lines:
        s = ln.rstrip()
        if not s:
            out.append("\n")  # paragraph break marker
            continue
        if _PAGE_NUM.match(s):
            continue
        if s.endswith("-") and not s.endswith("--"):
            out.append(s[:-1])  # de-hyphenate: join with next, no space
        else:
            out.append(s + " ")
    joined = "".join(out)
    joined = re.sub(r"[ \t]+", " ", joined)
    joined = re.sub(r"\n{2,}", "\n", joined)
    return joined.strip()


# --------------------------------------------------------------------------
# Sentence segmentation with legal-abbreviation guard.
# --------------------------------------------------------------------------

# Abbreviations whose trailing period must NOT end a sentence.
_ABBREV = {
    "u.s", "v", "vs", "no", "nos", "art", "arts", "sec", "secs", "para",
    "pp", "p", "ch", "cf", "e.g", "i.e", "ibid", "id", "et", "al", "inc",
    "co", "corp", "ltd", "ass'n", "dept", "ed", "eds", "rev", "j", "jj",
    "mr", "mrs", "ms", "dr", "prof", "st", "stat", "supp", "f", "f.2d",
    "f.3d", "n", "nn", "fed", "reg", "cir", "ct", "u.s.c", "c.f.r",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct",
    "nov", "dec",
}

_SENT_END = re.compile(r"([.!?][\"')\]]?)\s+(?=[\"'(\[A-Z0-9])")


def split_sentences(text: str) -> list[str]:
    """Heuristic sentence splitter tolerant of legal abbreviations."""
    # Provisional split on terminal punctuation + space + capital.
    pieces = _SENT_END.split(text)
    # _SENT_END.split keeps the captured punctuation; reassemble.
    sents: list[str] = []
    buf = ""
    i = 0
    while i < len(pieces):
        chunk = pieces[i]
        if i + 1 < len(pieces) and re.fullmatch(r"[.!?][\"')\]]?", pieces[i + 1] or ""):
            buf += chunk + pieces[i + 1]
            # Decide whether the boundary is real by inspecting the last token.
            last = re.search(r"([A-Za-z][A-Za-z.']*)[.!?][\"')\]]?$", buf)
            tok = last.group(1).lower() if last else ""
            if tok in _ABBREV or (len(tok) == 1 and tok.isalpha()):
                buf += " "  # false boundary: keep accumulating
            else:
                sents.append(buf.strip())
                buf = ""
            i += 2
        else:
            buf += chunk
            i += 1
    if buf.strip():
        sents.append(buf.strip())
    # Final cleanup: drop empties, require at least one letter.
    return [s for s in sents if re.search(r"[A-Za-z]", s)]


_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")


def words(text: str) -> list[str]:
    return _WORD.findall(text)


# --------------------------------------------------------------------------
# Lexicons.
# --------------------------------------------------------------------------

HEDGES = {
    "may", "might", "could", "would", "perhaps", "possibly", "arguably",
    "presumably", "seemingly", "apparently", "relatively", "somewhat",
    "fairly", "rather", "quite", "generally", "typically", "often",
    "sometimes", "likely", "unlikely", "suggest", "suggests", "suggested",
    "indicate", "indicates", "appear", "appears", "tend", "tends",
    "tendency", "potential", "potentially", "largely", "broadly",
    "essentially", "virtually", "presumptively", "ostensibly", "plausibly",
}

# Transition / connective vocabulary LLMs over-use.
TRANSITIONS = {
    "moreover", "furthermore", "additionally", "however", "nevertheless",
    "nonetheless", "thus", "therefore", "hence", "consequently", "indeed",
    "accordingly", "ultimately", "notably", "importantly", "crucially",
    "significantly", "fundamentally", "essentially", "specifically",
    "particularly", "namely", "conversely", "similarly", "likewise",
    "meanwhile", "subsequently", "overall", "thereby", "whereas",
}

# Latinate-diction suffixes (proxy for Latin/Romance-derived vocabulary).
_LATINATE_SUF = re.compile(
    r".+(tion|sion|ment|ity|ities|ous|ive|ization|isation|ance|ence|"
    r"ical|ically|alize|alise|ate|ates|ation)$"
)

# Be-verbs for passive detection.
_BE = {"be", "is", "are", "was", "were", "been", "being", "am"}
_PASSIVE = re.compile(
    r"\b(is|are|was|were|be|been|being|am)\b\s+(\w+ly\s+)?(\w+(ed|en|n|t))\b",
    re.IGNORECASE,
)
# Irregular past participles commonly used in passives.
_IRREG_PP = {
    "made", "given", "taken", "held", "found", "seen", "shown", "brought",
    "drawn", "known", "written", "done", "set", "put", "left", "sought",
    "thought", "understood", "construed", "read",
}

# Rule-of-three triad: "A, B, and C" (serial-comma list of exactly/at least 3).
_TRIAD = re.compile(
    r"\b[\w][\w'-]*(?:\s+[\w'-]+){0,3},\s+[\w'-]+(?:\s+[\w'-]+){0,3},\s+"
    r"(?:and|or)\s+[\w'-]+",
)


# --------------------------------------------------------------------------
# Feature computation.
# --------------------------------------------------------------------------

def _safe_mean(xs):
    return statistics.fmean(xs) if xs else 0.0


def _safe_std(xs):
    return statistics.pstdev(xs) if len(xs) > 1 else 0.0


def compute_features(raw: str) -> dict:
    """Return a dict of stylometric features for a text block.

    All rates are per-1000-words unless noted, so they are length-robust.
    """
    text = normalize_text(raw)
    sents = split_sentences(text)
    toks = words(text.lower())
    n_words = len(toks)
    n_sents = len(sents)
    feats: dict[str, float] = {}

    # --- Sentence length distribution -------------------------------------
    slens = [len(words(s)) for s in sents]
    slens = [n for n in slens if n > 0]
    mean_sl = _safe_mean(slens)
    std_sl = _safe_std(slens)
    feats["sent_len_mean"] = mean_sl
    feats["sent_len_std"] = std_sl
    # Burstiness as coefficient of variation (length-robust).
    feats["sent_len_cv"] = (std_sl / mean_sl) if mean_sl else 0.0
    # Mean absolute adjacent-sentence length delta (rhythm).
    deltas = [abs(slens[i] - slens[i - 1]) for i in range(1, len(slens))]
    feats["adj_delta_mean"] = _safe_mean(deltas)
    # Normalized adjacent delta (delta / mean length).
    feats["adj_delta_norm"] = (_safe_mean(deltas) / mean_sl) if mean_sl else 0.0
    # Fraction of "short" (<12w) and "long" (>30w) sentences -- humans vary.
    feats["frac_short_sent"] = (sum(1 for n in slens if n < 12) / len(slens)) if slens else 0.0
    feats["frac_long_sent"] = (sum(1 for n in slens if n > 30) / len(slens)) if slens else 0.0

    per1000 = (1000.0 / n_words) if n_words else 0.0

    # --- Rule-of-three triads ---------------------------------------------
    feats["triad_per_1000"] = len(_TRIAD.findall(text)) * per1000

    # --- Comma / subordinate-clause depth ---------------------------------
    commas = text.count(",")
    feats["commas_per_sent"] = (commas / n_sents) if n_sents else 0.0
    # Subordinator density (relative + subordinating conjunctions).
    subord = re.findall(
        r"\b(which|who|whom|whose|that|because|although|though|while|"
        r"whereas|since|unless|if|when|where|wherein|whereby|insofar)\b",
        text, re.IGNORECASE,
    )
    feats["subord_per_1000"] = len(subord) * per1000

    # --- Hedge density -----------------------------------------------------
    feats["hedge_per_1000"] = sum(1 for w in toks if w in HEDGES) * per1000

    # --- Passive voice -----------------------------------------------------
    n_passive = len(_PASSIVE.findall(text))
    # add irregular participles after be-verbs
    n_passive += len(re.findall(
        r"\b(is|are|was|were|be|been|being)\b\s+(\w+ly\s+)?(" +
        "|".join(_IRREG_PP) + r")\b", text, re.IGNORECASE))
    feats["passive_per_1000"] = n_passive * per1000
    feats["passive_per_sent"] = (n_passive / n_sents) if n_sents else 0.0

    # --- Latinate vs Anglo-Saxon diction ----------------------------------
    content = [w for w in toks if len(w) >= 3]
    lat = sum(1 for w in content if _LATINATE_SUF.match(w))
    feats["latinate_ratio"] = (lat / len(content)) if content else 0.0
    # Mean word length (Latinate words are longer; another diction proxy).
    feats["word_len_mean"] = _safe_mean([len(w) for w in toks])
    feats["frac_long_words"] = (sum(1 for w in toks if len(w) >= 8) / n_words) if n_words else 0.0

    # --- Transition vocabulary --------------------------------------------
    trans_hits = [w for w in toks if w in TRANSITIONS]
    feats["transition_per_1000"] = len(trans_hits) * per1000
    feats["transition_types"] = len(set(trans_hits))
    # Sentence-initial transitions (the classic AI tell).
    n_init = sum(1 for s in sents
                 if (words(s.lower())[:1] or [""])[0] in TRANSITIONS)
    feats["sent_init_trans_frac"] = (n_init / n_sents) if n_sents else 0.0

    # --- Punctuation rates -------------------------------------------------
    feats["emdash_per_1000"] = (text.count("—") + text.count("--")) * per1000
    feats["colon_per_1000"] = text.count(":") * per1000
    feats["semicolon_per_1000"] = text.count(";") * per1000

    # --- Paragraph structure ----------------------------------------------
    paras = [p for p in text.split("\n") if p.strip()]
    if paras:
        psc = [len(split_sentences(p)) for p in paras]
        psc = [c for c in psc if c > 0]
        feats["para_sent_count_mean"] = _safe_mean(psc)
    else:
        feats["para_sent_count_mean"] = float(n_sents)

    feats["_n_words"] = float(n_words)
    feats["_n_sents"] = float(n_sents)
    return feats


# Features used in the composite human-likeness score. Curated to the robust
# human-vs-AI discriminators (|Cohen's d| >= ~0.7 on the full corpus build),
# dropping near-zero-gap features (hedges, triads, commas, subordination) and
# collapsing redundant diction/length proxies to one representative each.
# See docs/STYLE_SPEC.md for the empirical gap table.
SCORE_FEATURES = [
    # Rhythm / burstiness -- the prime "AI cadence" tells.
    "sent_len_cv", "adj_delta_norm", "sent_len_std", "frac_short_sent",
    "para_sent_count_mean",
    # Diction / nominalization.
    "word_len_mean", "latinate_ratio",
    # Syntax / voice.
    "passive_per_1000",
    # Punctuation fingerprints.
    "emdash_per_1000", "semicolon_per_1000",
    # Connective over-use (kept as a classic tell even though gap is modest).
    "transition_per_1000",
]

# Populated by build_style_spec.py and pasted here. Each entry:
#   feature -> {"human_mean", "human_std", "ai_mean", "direction"}
# direction = sign of (human - ai); used only for reporting.
HUMAN_STATS: dict[str, dict] = {}

_STATS_PATH = os.path.join(os.path.dirname(__file__), "style_stats.json")
if os.path.exists(_STATS_PATH):
    try:
        with open(_STATS_PATH) as fh:
            HUMAN_STATS = json.load(fh)
    except (OSError, ValueError):
        HUMAN_STATS = {}


# Reference unit size: HUMAN_STATS are calibrated on ~160-word windows
# (matching the AI law-sample size), so longer drafts are scored window-wise.
WINDOW_WORDS = 160


def window_features(raw: str, window_words: int = WINDOW_WORDS) -> list[dict]:
    """Split a draft into ~window_words units and return per-unit features.

    Short drafts (< 1.5x the window) are scored as a single unit. This keeps
    length-sensitive features (sentence-length SD, burstiness) comparable to
    the reference distribution regardless of draft length.
    """
    text = normalize_text(raw)
    sents = split_sentences(text)
    total = sum(len(words(s)) for s in sents)
    if total < window_words * 1.5 or len(sents) < 4:
        f = compute_features(raw)
        return [f] if f["_n_words"] else []
    units, cur, cur_w = [], [], 0
    for s in sents:
        cur.append(s)
        cur_w += len(words(s))
        if cur_w >= window_words:
            units.append(compute_features(" ".join(cur)))
            cur, cur_w = [], 0
    if cur_w >= window_words * 0.5 and cur:
        units.append(compute_features(" ".join(cur)))
    return [u for u in units if u["_n_words"] >= 60 and u["_n_sents"] >= 3]


def score_text(raw: str, stats: dict | None = None) -> dict:
    """Score a draft against human targets.

    Returns per-feature z-distance from the human mean and a composite
    human-likeness score in [0, 100] (100 = indistinguishable from the
    human distribution on the scored features). Long drafts are split into
    ~160-word windows and averaged so the score is length-robust.
    """
    stats = stats if stats is not None else HUMAN_STATS
    units = window_features(raw)
    if not units:
        return {"error": "draft too short / no prose extracted"}
    # Average features across windows for the report.
    feats = {k: _safe_mean([u[k] for u in units]) for k in units[0]}
    if not stats:
        return {"features": feats, "error": "no HUMAN_STATS loaded; run build_spec.py full"}
    # Composite is the mean of per-window composites (more faithful than
    # scoring the averaged features).
    win_composites = [score_text_from_features(u, stats) for u in units]
    composite_windows = round(_safe_mean(win_composites), 1)
    per_feature = {}
    zs = []
    for name in SCORE_FEATURES:
        if name not in stats:
            continue
        h_mean = stats[name]["human_mean"]
        h_std = stats[name]["human_std"] or 1e-9
        val = feats.get(name, 0.0)
        z = (val - h_mean) / h_std
        ai_mean = stats[name].get("ai_mean")
        # Flag = the draft sits on the AI side of the human mean, far out.
        ai_side = (ai_mean is not None and
                   ((ai_mean > h_mean and val > h_mean) or
                    (ai_mean < h_mean and val < h_mean)))
        per_feature[name] = {
            "value": round(val, 4),
            "human_mean": round(h_mean, 4),
            "ai_mean": round(ai_mean, 4) if ai_mean is not None else None,
            "z": round(z, 2),
            "flag": abs(z) > 2.0 and ai_side,
        }
        zs.append(abs(z))
    mean_abs_z = _safe_mean(zs)
    return {
        "composite_human_likeness": composite_windows,
        "mean_abs_z": round(mean_abs_z, 3),
        "n_windows": len(units),
        "flags": [k for k, v in per_feature.items() if v["flag"]],
        "per_feature": per_feature,
        "features": {k: round(v, 4) for k, v in feats.items()},
    }


def score_text_from_features(feats: dict, stats: dict) -> float:
    """Composite human-likeness in [0,100] from a precomputed feature dict."""
    zs = []
    for name in SCORE_FEATURES:
        if name not in stats:
            continue
        h_std = stats[name]["human_std"] or 1e-9
        zs.append(abs((feats.get(name, 0.0) - stats[name]["human_mean"]) / h_std))
    mean_abs_z = _safe_mean(zs)
    return 100.0 * math.exp(-mean_abs_z / 2.0)


# --------------------------------------------------------------------------
# Localization: turn the distributional score into line-level lint findings.
# --------------------------------------------------------------------------

import bisect  # noqa: E402

# Sentence-initial transitions worth flagging (throat-clearing openers).
_INIT_TRANS = (
    "Moreover|Furthermore|Additionally|However|Nevertheless|Nonetheless|"
    "Thus|Therefore|Hence|Consequently|Indeed|Accordingly|Ultimately|"
    "Notably|Importantly|Crucially|Significantly|Fundamentally|Specifically|"
    "Particularly|Conversely|Similarly|Likewise|Meanwhile|Subsequently|Overall"
)
_RE_INIT_TRANS = re.compile(
    r"(?:^|(?<=[.!?])\s+|(?<=\n))(" + _INIT_TRANS + r")\b", re.MULTILINE)
_RE_EMDASH = re.compile(r"\s?(—|--)\s?")
# Egregious nominalizations: long Latinate words + classic -ization/-ality.
_RE_NOMINAL = re.compile(
    r"\b\w*(?:ization|isation|ality|alities|tiveness|fulness)\b"
    r"|\b\w{11,}(?:tion|sion|ment|ance|ence)\b", re.IGNORECASE)


# --------------------------------------------------------------------------
# False precision: spurious decimal places in summary prose.
#
# THE RULE. "a rate of 1.3771 percent" in an abstract is not more accurate than "about one and a
# half percent"; it is less readable and it implies a precision the estimate does not carry. Exact
# figures are legitimate NEXT TO THE EXHIBIT that backs them, which is why every table, cell,
# caption row and code block below is excluded rather than the rule being softened. Motivating
# edits (all made): "1.3771 percent" -> "about one and a half percent"; "6,612 of 575,553 testable
# items --- 1.15 percent" -> "about one percent of testable items"; "85.63 percent of the testable
# universe" -> "roughly six in seven".
#
# BIASED HARD TOWARD FALSE NEGATIVES. A bare numeral needs 3+ decimals; a percentage needs 2+.
# Everything that carries digits for a NON-summary reason is excluded by construction:
#   * years, section/rule/statute cites, docket and page numbers carry no decimal point at all,
#     and the ones that could (`Rule 14a-8`, `§ 240.14a-101`, `S. 1670`) are additionally guarded
#     by the citation-lead lookback;
#   * version numbers and dotted identifiers (`0.5.0`, `Python 3.11.4`) are rejected by the
#     `(?<![\d.])` / `(?![\d.])` guards — a digit-dot on either side disqualifies the match;
#   * money keeps its cents: a currency-symbol lead is skipped outright, and $1,234.56 has only
#     two decimals and no percent unit besides;
#   * tables (markdown rows, Typst `#table(...)` / `table.cell(...)`), fenced code, blockquoted
#     source material and footnotes are masked out before the scan.
# A line must also read as PROSE — four or more alphabetic words — so a bare `[0.3952],` cell that
# escaped the table mask still cannot fire.
_FP_BARE_DECIMALS = 3
_FP_PCT_DECIMALS = 2

_RE_FALSE_PRECISION = re.compile(
    r"(?<![\d.])\d[\d,]*\.(?P<dec>\d+)(?![\d.])"
    r"(?P<unit>\s*(?:%|percent(?:age\s+points?)?|pp)\b)?"
)
# A token that, sitting immediately before the number, makes it an IDENTIFIER rather than a
# measurement: a cite, a locator, a version. `\s*$` anchors it to the number itself.
_RE_CITE_LEAD = re.compile(
    r"(?:§|¶|\bRule|\bRules|\bSection|\bSecs?\.|\bNos?\.|\bPub\.\s*L\.|\bStat\.|\barts?\.|"
    r"\bchs?\.|\bpp?\.|\bnotes?|\bnn?\.|\bOrder|\bRelease|\bDocket|\bForm|\bItem|\bReg\.|"
    r"\bC\.F\.R\.|\bU\.S\.C\.|\bS\.|\bH\.R\.|\bDGCL|\bversion|\bv\.|\bat)\s*$",
    re.IGNORECASE)
_RE_CURRENCY_LEAD = re.compile(r"[$€£¥₹]\s*$")
_RE_PROSE_WORD = re.compile(r"[A-Za-z]{3,}")

_FP_FENCE = re.compile(r"^\s*(?:```|~~~)")
_FP_MD_TABLE_ROW = re.compile(r"^\s*\|")
_FP_BLOCKQUOTE = re.compile(r"^\s*>")
_FP_MD_FN_DEF = re.compile(r"^\s*\[\^[^\]]*\]:")
_FP_TYPST_CELL = re.compile(r"\btable\.cell\s*\(")
_FP_TYPST_TABLE = re.compile(r"#(?:table|figure|grid)\s*(?=\()")
_FP_TYPST_FOOTNOTE = re.compile(r"#footnote\s*(?=\[)")
_FP_MD_INLINE_FN = re.compile(r"\^(?=\[)")


def _fp_closer(text: str, opener: int, open_ch: str, close_ch: str) -> int:
    """Index of the delimiter closing `text[opener]`, or -1 when the construct never closes."""
    depth = 0
    for i in range(opener, len(text)):
        if text[i] == open_ch:
            depth += 1
        elif text[i] == close_ch:
            depth -= 1
            if depth == 0:
                return i
    return -1


def mask_non_prose(raw: str) -> str:
    """Blank every region that is not running prose, preserving length and line offsets.

    Scoped to the false-precision rule ON PURPOSE: every other finding in this module scores the
    raw text, and widening the mask would silently move em-dash, transition and nominalization
    findings that have nothing to do with this change.
    """
    chars = list(raw)

    def blank(a: int, b: int) -> None:
        for i in range(max(0, a), min(b, len(chars))):
            if chars[i] != "\n":
                chars[i] = " "

    # Balanced constructs first — they span lines, so they must be measured on the original text.
    for rx, o, c in ((_FP_TYPST_TABLE, "(", ")"),
                     (_FP_TYPST_FOOTNOTE, "[", "]"),
                     (_FP_MD_INLINE_FN, "[", "]")):
        for m in rx.finditer(raw):
            closer = _fp_closer(raw, m.end(), o, c)
            blank(m.start(), closer + 1 if closer != -1 else m.end())

    # Then line-shaped exclusions.
    off, in_fence = 0, False
    for line in raw.split("\n"):
        end = off + len(line)
        if _FP_FENCE.match(line):
            in_fence = not in_fence
            blank(off, end)
        elif (in_fence or _FP_MD_TABLE_ROW.match(line) or _FP_BLOCKQUOTE.match(line)
              or _FP_MD_FN_DEF.match(line) or _FP_TYPST_CELL.search(line)):
            blank(off, end)
        off = end + 1
    return "".join(chars)


def false_precision_hits(raw: str) -> list[tuple[int, str]]:
    """[(offset, matched_text)] for every spurious-precision figure in summary prose."""
    masked = mask_non_prose(raw)
    line_start = 0
    line_bounds: list[tuple[int, int]] = []
    for line in masked.split("\n"):
        line_bounds.append((line_start, line_start + len(line)))
        line_start += len(line) + 1

    hits: list[tuple[int, str]] = []
    for m in _RE_FALSE_PRECISION.finditer(masked):
        decimals = len(m.group("dec"))
        is_pct = bool(m.group("unit"))
        if decimals < (_FP_PCT_DECIMALS if is_pct else _FP_BARE_DECIMALS):
            continue
        lead = masked[max(0, m.start() - 40):m.start()]
        if _RE_CURRENCY_LEAD.search(lead) or _RE_CITE_LEAD.search(lead):
            continue
        a, b = next((p for p in line_bounds if p[0] <= m.start() <= p[1]), (0, len(masked)))
        if len(_RE_PROSE_WORD.findall(masked[a:b])) < 4:
            continue
        hits.append((m.start(), m.group(0).strip()))
    return hits


def _line_offsets(raw: str) -> list[int]:
    offs = [0]
    for i, ch in enumerate(raw):
        if ch == "\n":
            offs.append(i + 1)
    return offs


def _lineno(offs: list[int], pos: int) -> int:
    return bisect.bisect_right(offs, pos)  # 1-based line number


def _excerpt(raw: str, pos: int, width: int = 70) -> str:
    a = max(0, pos - width // 3)
    b = min(len(raw), pos + width)
    snip = raw[a:b].replace("\n", " ").strip()
    return ("…" if a > 0 else "") + snip + ("…" if b < len(raw) else "")


def lint_text(raw: str, stats: dict | None = None, max_per_type: int = 12) -> dict:
    """Locate the specific AI-style tells in a draft.

    Returns line-level `findings` (em-dashes, opener transitions,
    nominalizations, false precision, passive constructions, metronomic
    sentence runs) plus
    draft-level `advisories` derived from the composite z-scores (for tells
    that are about *absence* or *global rhythm*, which have no single span).
    """
    stats = stats if stats is not None else HUMAN_STATS
    offs = _line_offsets(raw)
    findings: list[dict] = []

    def add(kind, sev, pos, msg):
        findings.append({
            "line": _lineno(offs, pos), "type": kind, "severity": sev,
            "message": msg, "excerpt": _excerpt(raw, pos),
        })

    # --- Span-level regex tells -------------------------------------------
    em = list(_RE_EMDASH.finditer(raw))
    for m in em[:max_per_type]:
        add("em_dash", "high", m.start(),
            "Em-dash — humans rarely use these in legal prose; recast as a "
            "period, comma, or semicolon.")
    tr = list(_RE_INIT_TRANS.finditer(raw))
    for m in tr[:max_per_type]:
        add("opener_transition", "med", m.start(1),
            f"Sentence opens with '{m.group(1)}' — delete the throat-clearing "
            "connective.")
    nom = list(_RE_NOMINAL.finditer(raw))
    for m in nom[:max_per_type]:
        add("nominalization", "low", m.start(),
            f"Heavy nominalization '{m.group(0)}' — prefer a plain verb/short "
            "Anglo-Saxon form.")
    for pos, token in false_precision_hits(raw)[:max_per_type]:
        add("false_precision", "med", pos,
            f"false precision: {token} — prefer a rounded figure or fraction in summary "
            "prose; keep exact values next to the exhibit.")
    pv = list(_PASSIVE.finditer(raw))
    # passive is register-appropriate in law; only surface if over budget
    pv_rate = len(pv) * (1000.0 / max(1, len(words(raw))))

    # --- Metronomic sentence runs -----------------------------------------
    # Find runs of >=4 consecutive sentences within an 8-word band (no
    # rhythm variation) and runs with no short (<12w) sentence over a long
    # stretch. Report by locating each sentence's start in raw.
    text = normalize_text(raw)
    sents = [s for s in split_sentences(text) if len(words(s)) >= 3]
    slens = [len(words(s)) for s in sents]
    cursor = 0
    starts = []
    for s in sents:
        head = " ".join(words(s)[:4])
        # fuzzy-locate the sentence head in raw to get a line number
        pos = raw.find(s[:25], cursor)
        if pos < 0:
            pos = raw.lower().find(head.lower(), cursor)
        starts.append(pos if pos >= 0 else cursor)
        if pos >= 0:
            cursor = pos + 1
    i = 0
    while i < len(slens):
        j = i
        while (j + 1 < len(slens)
               and max(slens[i:j + 2]) - min(slens[i:j + 2]) <= 8):
            j += 1
        run = j - i + 1
        if run >= 4 and min(slens[i:j + 1]) >= 14:  # 4+ long, even sentences
            pos = starts[i] if starts[i] >= 0 else 0
            findings.append({
                "line": _lineno(offs, pos), "type": "metronomic_run",
                "severity": "high",
                "message": f"{run} consecutive sentences of similar length "
                           f"({min(slens[i:j+1])}-{max(slens[i:j+1])} words) — "
                           "metronomic cadence. Break it with a short sentence.",
                "excerpt": _excerpt(raw, pos),
            })
            i = j + 1
        else:
            i += 1

    findings.sort(key=lambda f: (f["line"], f["type"]))

    # --- Draft-level advisories (absence / global tells) ------------------
    advisories = []
    rep = score_text(raw, stats)
    pf = rep.get("per_feature", {})

    def adv(feat, cond_msg):
        v = pf.get(feat)
        if v and v["flag"]:
            advisories.append({"feature": feat, "z": v["z"],
                               "value": v["value"], "human_mean": v["human_mean"],
                               "message": cond_msg})

    adv("sent_len_cv", "Low burstiness: sentence lengths too uniform. Vary "
        "them — mix 5-word and 40-word sentences.")
    adv("frac_short_sent", "Few/no short sentences. Add punchy <12-word "
        "sentences for rhythm.")
    adv("semicolon_per_1000", "Almost no semicolons; humans use ~7/1000 words "
        "to join related clauses.")
    adv("word_len_mean", "Diction runs long/Latinate. De-nominalize toward "
        "shorter Anglo-Saxon words.")
    adv("latinate_ratio", "High Latinate-suffix density; prefer plainer verbs.")
    adv("emdash_per_1000", "Em-dash over-use across the draft (see line "
        "findings).")
    if pv_rate > 30:
        advisories.append({"feature": "passive_per_1000", "value": round(pv_rate, 1),
                           "message": "Passive voice unusually high even for "
                           "legal register; convert some to active."})

    return {
        "composite_human_likeness": rep.get("composite_human_likeness"),
        "n_findings": len(findings),
        "counts": {k: sum(1 for f in findings if f["type"] == k)
                   for k in sorted({f["type"] for f in findings})},
        "findings": findings,
        "advisories": advisories,
    }


def _print_lint(raw: str):
    r = lint_text(raw)
    print(f"human-likeness: {r['composite_human_likeness']}  "
          f"({r['n_findings']} findings)")
    if r["counts"]:
        print("  " + "  ".join(f"{k}={v}" for k, v in r["counts"].items()))
    print()
    for f in r["findings"]:
        print(f"L{f['line']:<5} [{f['severity']:<4}] {f['type']}")
        print(f"        {f['message']}")
        print(f"        › {f['excerpt']}")
    if r["advisories"]:
        print("\nDraft-level advisories:")
        for a in r["advisories"]:
            z = f" (z={a['z']})" if "z" in a else ""
            print(f"  • [{a['feature']}]{z} {a['message']}")


def _main(argv):
    show_features = False
    do_lint = False
    as_json = False
    args = []
    for a in argv:
        if a == "--features":
            show_features = True
        elif a == "--lint":
            do_lint = True
        elif a == "--json":
            as_json = True
        else:
            args.append(a)
    if not args:
        print(__doc__)
        return 1
    raw = open(args[0], encoding="utf-8", errors="ignore").read()
    if show_features:
        print(json.dumps(compute_features(raw), indent=2))
        return 0
    if do_lint:
        if as_json:
            print(json.dumps(lint_text(raw), indent=2))
        else:
            _print_lint(raw)
        return 0
    print(json.dumps(score_text(raw), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
