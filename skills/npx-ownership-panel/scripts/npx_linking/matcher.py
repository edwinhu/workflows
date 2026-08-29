#!/usr/bin/env python3
"""ISS fund name -> SEC series name matcher: normalisation, scoring, accept bar.

Measured 2026-08-28 on the untagged ISS population (78.4M vote rows over 19,926
fundids), holding vocabulary and everything else fixed:

    Jaccard token-set        94.48% of the mutual-fund universe linked
    char 3-gram TF-IDF       97.81%
    + sparse_dot_topn top-k  98.37%
    + the variant rules here 98.84%

THE SCORER WAS THE WHOLE STORY. Vocabulary experiments that looked worth +2.6
and +3.1 points under Jaccard were measuring that scorer's slack, not a real
gain. Do not replace the scorer without re-running the negative control.

EVERY RULE ADDS A VARIANT; NONE REPLACES THE QUERY. The raw form already matches
most funds, so substituting trades one miss for another -- concatenating the
institution onto both sides scored 35.4% against 83.8% for leaving them alone.

WHAT THIS CANNOT DO. Cosine cannot tell a fund from its sibling. Measured by LLM
adjudication of all 18,975 accepted pairs, 5.1% of accepted vote rows are the
WRONG fund -- `Royce Value Trust` vs `Royce Value Fund` at 0.95, `PROSHARES
ULTRA RUSSELL 3000` vs `Ultra Russell 2000 ProShares` at 0.84. No threshold
separates those. Run `judge_matches.py` and drop the rejects; that is what takes
the panel from 98.84% linked to 97.16% linked-and-checked.
"""

from __future__ import annotations

import re

WS = re.compile(r"\s+")
NONAL = re.compile(r"[^a-z0-9 ]+")

#: 0.70, and the two digits matter. Per-band negative control 2026-08-28:
#: 0.68-0.70 is 50.0% correct on the control and 47.0% on the judged untagged
#: population. An earlier version used 0.68 because CUMULATIVE top-1 fell only
#: 0.15pp -- a statistic blind to its own margin, since 69% of accepted matches
#: are exact and score 1.000.
ACCEPT_THRESHOLD = 0.70

#: An internal id ISS prefixes on some families: 3364, 6721, 2Y61, ZW4X, 2DCN.
#:
#: TWO forms, because a bare number can be part of a real fund name. A PURE
#: DIGIT code needs 4+ digits, so "3364 JHVIT" strips while "500 Index Fund"
#: keeps its 500. A MIXED alphanumeric code needs only 3, since no fund is
#: called "ZW4X". Requiring a digit in FIRST position missed ZW4X and 2DCN
#: entirely and cost this rule most of its value.
CODE_PREFIX = re.compile(
    r"^\s*(?:[0-9]{4,6}|(?=[0-9A-Za-z]{3,6}\s)(?=[^\s]*[0-9])(?=[^\s]*[A-Za-z])"
    r"[0-9A-Za-z]{3,6})\s+(?=\S)")
#: A manager appended after a dash, which the SEC series name never carries.
#: Worth +0.28 points on its own, the largest single rule.
#:
#: Two shapes, because the sub-adviser is often named WITHOUT the word:
#:   " - SUB-ADVISER: JENNISON"          -> the label is present
#:   " - Segall Bryant and Hamill LLC"   -> only a firm suffix marks it
#: The second form requires a corporate suffix so a real name like
#: "Templeton Growth Fund - Series II" is not truncated.
SUBADV_TAIL = re.compile(r"\s[-–]\s*(?:sub[- ]?advis\w*|advis\w*)\b.*$",
                         re.IGNORECASE)
FIRM_TAIL = re.compile(
    r"\s[-–]\s*[A-Za-z][\w&.,' ]*\b(?:llc|l\.l\.c|inc|lp|l\.p|ltd|"
    r"management|managers|capital|associates|partners|advisors|advisers)\b\.?\s*$",
    re.IGNORECASE)
SLEEVE_TAIL = re.compile(r"\s+(?:equity\s+)?sleeve\b.*$", re.IGNORECASE)
FORMERLY = re.compile(r"\(\s*(?:formerly|f/?k/?a|formerly known as)\b[^)]*\)",
                      re.IGNORECASE)
FORMERLY_INNER = re.compile(
    r"\(\s*(?:formerly(?:\s+known\s+as)?|f/?k/?a)\s*:?\s*([^)]+)\)", re.IGNORECASE)
CLASS_TAIL = re.compile(r"\b(cl|class)\s+[a-z0-9]{1,3}\b|\binc\b|\bltd\b",
                        re.IGNORECASE)


def norm(s: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    return WS.sub(" ", NONAL.sub(" ", (s or "").lower())).strip()


def variants(name: str) -> list[str]:
    """Every query string worth trying for this fund. The raw form is always first."""
    s = name or ""
    out = [norm(s)]

    stripped = CODE_PREFIX.sub("", s)
    if stripped != s:
        out.append(norm(stripped))

    m = FORMERLY_INNER.search(s)
    if m:
        out.append(norm(FORMERLY.sub("", s)))   # the current name
        out.append(norm(m.group(1)))            # the former name

    for rx in (SUBADV_TAIL, FIRM_TAIL, SLEEVE_TAIL):
        t = rx.sub("", s)
        if t != s:
            out.append(norm(t))

    out.append(norm(CLASS_TAIL.sub(" ", s)))
    return [v for v in dict.fromkeys(out) if v]


def build_index(names):
    """Fit the vectoriser over the WHOLE vocabulary and return (vec, matrix, names).

    Fit globally even when candidates will be scoped: IDF computed over one
    registrant's ~15 names makes every token inside that family look rare and
    the weighting stops discriminating.
    """
    from sklearn.feature_extraction.text import TfidfVectorizer

    names = list(names)
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 3), min_df=1)
    return vec, vec.fit_transform(names), names


def match(queries, index, threshold: float = ACCEPT_THRESHOLD):
    """Best vocabulary row per query as [(row, score), ...]; row is -1 below bar.

    Uses sparse_dot_topn, which prunes to top-k DURING the multiply. Plain scipy
    builds the whole Q @ V.T first -- ~114M nonzeros over this vocabulary -- and
    dies before any max() is taken.
    """
    import numpy as np
    from sparse_dot_topn import awesome_cossim_topn

    vec, V, _names = index
    VT = V.T.tocsr()
    out = []
    Q = vec.transform([norm(q) for q in queries])
    for i in range(0, Q.shape[0], 5000):
        sim = awesome_cossim_topn(Q[i:i + 5000].tocsr(), VT, 1, 0.0).tocsr()
        sc = np.asarray(sim.max(axis=1).todense()).ravel()
        arg = np.asarray(sim.argmax(axis=1)).ravel()
        for j in range(sim.shape[0]):
            out.append((int(arg[j]) if sc[j] >= threshold else -1, float(sc[j])))
    return out
