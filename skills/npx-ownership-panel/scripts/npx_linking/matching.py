"""matching.py — fund-name matching craft, as a reusable reference implementation.

Adapted from the mirror project's `scripts/linking/matching.py`, with the
project-specific config inlined into `linking_config.py` so this module stands
alone. Every rule below exists because it caught a real, measured error.

READ THIS BEFORE TUNING A THRESHOLD.

CRAFT NOTES
-----------
* **Exact-ID first, fuzzy last.** This module is the TAIL of the pipeline, not
  its strategy. Measured: `via_seriesid` alone supplies 19,327 of 21,191 links.
  If you find yourself tuning the matcher to raise coverage, you are probably
  missing an exact-ID path.

* **Digit-token guard.** Char-ngram cosine is nearly blind to digits: they carry
  most of a fund name's discriminating information and almost none of its
  character mass. "Russell 2000" scores ~0.97 against "Russell 1000". Index
  funds differ ONLY by the number. The guard requires the *multiset* of
  digit-bearing tokens to be identical, and any trailing `SERIES <X>` designator
  to agree exactly. It drops ~12% of candidate pairs.

* **The guard is POSITIONAL.** Evaluate it against the query FORM that produced
  the candidate, not the raw ISS name. A match won through a leading-code strip
  ("6721 500 Index B" -> "500 Index B") has already lost the code and is never
  asked to reproduce it; a match won on the full name must reproduce every digit
  token. Otherwise the guard blocks every insurance sub-account.

* **Ampersand fold.** ISS writes "SandP" where every other source writes "S&P".
  Fold before tokenising, or the digit guard sees different token sets for the
  same fund.

* **Trust-prefix dominance.** CRSP `fund_name` is `"Trust: Fund; Class X"`, so
  within-family char-ngram similarity is dominated by the shared prefix, and
  family agreement is NOT an independent signal in the 0.80-0.85 band — the
  top-1 is systematically the *wrong sibling*. Hold >=0.90 scoped; an identity
  claim needs >=0.97, because 0.90-0.97 is almost entirely sibling confusion.

* **Never strip the sponsor token from the query.** Dropping it let a BlackRock
  master match an Allspring fund. Strip it as an ADDITIONAL form, never as a
  replacement, and police the result with the cross-family rule.

* **Score on max(bare, institution-appended).** Appending the ISS institution
  shifts scores DOWN ~0.05-0.10 at every quantile (char-ngram cosine is
  length-weighted, so the appended segment adds noise in proportion to its
  length) — but it rescues master-feeder cases where only the CRSP side names
  the family. Complementary, not substitutes. Take the max of the two.

* **Fund names are not identifying.** 124 CRSP funds are named "...S&P 500
  Index..." across 48 management companies. The institution is the disambiguator.

NORM VARIANTS
-------------
Three normalisers exist because each was added to fix a measured failure:

    l2    uppercase -> drop "(formerly ...)" -> drop parentheticals
          -> strip to [A-Z0-9] -> drop legal suffixes -> fold "SandP" -> "S P"
    l3    ... but the ampersand is PRESERVED through the first punctuation strip
          ([A-Z0-9&]) and folded BEFORE the final strip, so "S&P" and "SandP"
          converge on the same tokens rather than on different ones.
    l3b   ... l3 plus the acronym-dot fold ("U.S." -> "US" before the
          punctuation strip, because ISS writes the dots and CRSP does not).

`l3b` is the most complete recipe and the default for new work. Switching an
existing pipeline between variants CHANGES ITS OUTPUT — pick one and re-run the
coverage report if you change it.

Requires: polars, numpy, scikit-learn, sparse_dot_topn.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
import polars as pl
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn

from linking_config import cfg

__all__ = [
    "NORM_VARIANTS", "normalize_name", "digit_token_list", "digit_token_key",
    "designator", "family_token", "family_tokens", "tfidf_candidates",
    "digit_guard_mask", "cross_family_verdict", "FamilyVerdict", "best_of_forms",
]

NORM_VARIANTS = ("l2", "l3", "l3b")


# ---------------------------------------------------------------------------
# name normalisation
# ---------------------------------------------------------------------------
def normalize_name(col, variant: str = "l3b", drop_formerly: bool = True):
    """Normalise a fund/entity name column to the matcher's token space.

    `drop_formerly` is honoured only by the l2 variant, which is the only one
    that needs the un-stripped form: the corpus builder emits the pre-rename
    name buried in "(formerly named X)" as its own corpus entry.
    """
    if variant == "l2":
        e = pl.col(col).str.to_uppercase()
        if drop_formerly:
            e = e.str.replace_all(cfg.L2_FORMERLY_RE, " ")
        e = e.str.replace_all(cfg.L2_PAREN_RE, " ")
        e = e.str.replace_all(r"[^A-Z0-9]+", " ")
        e = e.str.replace_all(cfg.L2_LEGAL_SUFFIX_RE, " ")
        e = e.str.replace_all(r"\s+", " ").str.strip_chars()
        for pat, rep in cfg.L2_AMPERSAND_FOLD:
            e = e.str.replace_all(pat, rep)
        return e.str.replace_all(r"\s+", " ").str.strip_chars()

    if variant not in ("l3", "l3b"):
        raise ValueError(f"unknown norm variant {variant!r}; expected {NORM_VARIANTS}")

    e = pl.col(col).str.to_uppercase()
    e = e.str.replace_all(cfg.L2_FORMERLY_RE, " ")
    if variant == "l3b":
        e = e.str.replace_all(cfg.L3B_ACRONYM_DOT_RE, "${1}")
    e = e.str.replace_all(cfg.L2_PAREN_RE, " ")
    # Ampersand survives this strip so the fold below can see "S&P".
    e = e.str.replace_all(r"[^A-Z0-9&]+", " ")
    for pat, rep in cfg.L2_AMPERSAND_FOLD:
        e = e.str.replace_all(pat, rep)
    e = e.str.replace_all(r"[^A-Z0-9]+", " ")
    e = e.str.replace_all(cfg.L2_LEGAL_SUFFIX_RE, " ")
    return e.str.replace_all(r"\s+", " ").str.strip_chars()


def digit_token_list(expr):
    """Sorted LIST of digit-bearing tokens in an ALREADY-NORMALISED name."""
    if isinstance(expr, str):
        expr = pl.col(expr)
    return (
        expr.str.split(" ")
        .list.eval(pl.element().filter(pl.element().str.contains(cfg.L2_DIGIT_TOKEN_RE)))
        .list.sort()
    )


def digit_token_key(col):
    """Space-joined form of :func:`digit_token_list`."""
    return digit_token_list(col).list.join(" ")


def designator(col):
    """Trailing series/portfolio designator: "SBL Fund Series H" -> "H"."""
    expr = pl.col(col) if isinstance(col, str) else col
    return expr.str.extract(cfg.L2_DESIGNATOR_RE, 1)


def family_token(col, variant: str = "l3"):
    """FIRST distinguishing token of an institution name.

    Brittle in both directions — "John Hancock Funds, LLC" reduces to "JOHN"
    (which appears in nothing) and "RS Investment Management" to "RS" (too short
    to signal). Prefer :func:`family_tokens` for new work.
    """
    e = normalize_name(col, variant=variant)
    for w in cfg.L2_FAMILY_STOPWORDS:
        e = e.str.replace_all(rf"\b{w}\b", " ")
    e = e.str.replace_all(r"\s+", " ").str.strip_chars()
    return e.str.split(" ").list.first()


def family_tokens(col, stop_both_sources: bool | None = None):
    """EVERY distinctive token of an institution name.

    Recovers HANCOCK, DIMENSIONAL, BLACKROCK, TRANSAMERICA, NORTHWESTERN — all
    of which :func:`family_token` misses. Two rules learned the hard way:

    * the stoplist must apply to BOTH token sources, not just the institution
      side ("Strategic Partners Mutual Funds" otherwise emits STRATEGIC, and
      MUTUAL is a substring of MASSMUTUAL);
    * containment tests against these tokens must be WORD-BOUNDARY anchored,
      never substring — see the MUTUAL/MASSMUTUAL false bridge.
    """
    if stop_both_sources is None:
        stop_both_sources = cfg.L3B_FAMILY_STOP_BOTH_SOURCES
    stop = set(cfg.L2_FAMILY_STOPWORDS) | set(cfg.L3B_STRATEGY_STOPWORDS)
    e = normalize_name(col, variant="l3b")
    for w in (sorted(stop) if stop_both_sources else cfg.L2_FAMILY_STOPWORDS):
        e = e.str.replace_all(rf"\b{w}\b", " ")
    e = e.str.replace_all(r"\s+", " ").str.strip_chars()
    return e.str.split(" ").list.eval(
        pl.element().filter(pl.element().str.len_chars() >= cfg.L3B_FAMILY_MIN_CHARS))


# ---------------------------------------------------------------------------
# candidate generation
# ---------------------------------------------------------------------------
def tfidf_candidates(left_names, right_names, ngram=None, top_k=None,
                     threshold=None, analyzer=None) -> pl.DataFrame:
    """Char-ngram TF-IDF cosine top-k. Returns (row, col, score).

    `row` indexes `left_names`, `col` indexes `right_names`. The vectoriser is
    fit on the UNION of both sides so the corpora share an idf.

    Generating candidates is cheap; precision is bought in the accept rules.
    Defaults: char_wb (2,4), top 100, floor 0.30.
    """
    ngram = ngram or cfg.L2_TFIDF_NGRAM
    top_k = top_k or cfg.L2_TFIDF_TOP_K
    threshold = cfg.L2_CAND_THRESHOLD if threshold is None else threshold
    analyzer = analyzer or cfg.L2_TFIDF_ANALYZER

    left_names, right_names = list(left_names), list(right_names)
    vec = TfidfVectorizer(analyzer=analyzer, ngram_range=ngram, min_df=1)
    vec.fit(left_names + right_names)
    M = sp_matmul_topn(
        vec.transform(left_names), vec.transform(right_names).T,
        top_n=top_k, threshold=threshold, sort=True,
    ).tocoo()
    return pl.DataFrame({
        "row": M.row.astype(np.int32),
        "col": M.col.astype(np.int32),
        "score": M.data.astype(np.float64),
    })


def best_of_forms(*candidate_frames: pl.DataFrame) -> pl.DataFrame:
    """max(bare, institution-appended, ...) per (row, col).

    Appending the institution shifts scores DOWN ~0.05-0.10 at every quantile,
    but rescues master-feeder cases where only the target names the family.
    Run tfidf_candidates once per query FORM and combine here — the forms are
    complementary, not substitutes.

    `form` records which query produced the winning score; the digit guard is
    POSITIONAL and must be applied against that form's normalised name.
    """
    frames = [f.with_columns(pl.lit(i).alias("form")) for i, f in enumerate(candidate_frames)]
    return (
        pl.concat(frames, how="vertical")
        .sort(["row", "col", "score"], descending=[False, False, True])
        .unique(subset=["row", "col"], keep="first")
    )


def digit_guard_mask(left_norm: str = "l_norm", right_norm: str = "r_norm"):
    """Boolean expression: does this candidate pair survive the digit guard?

    Applies to the pair of NORMALISED names that actually produced the score —
    the query form, not the raw ISS name (the guard is POSITIONAL). Requires the
    digit-token multisets to be identical and any trailing designator to agree
    (null == null counts as agreeing).
    """
    ld, rd = digit_token_list(left_norm), digit_token_list(right_norm)
    lg, rg = designator(left_norm), designator(right_norm)
    return (ld == rd) & ((lg.is_null() & rg.is_null()) | (lg == rg))


# ---------------------------------------------------------------------------
# the cross-family rule
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class FamilyVerdict:
    """Outcome of the cross-family rule. `ok` is the accept/reject."""
    ok: bool
    gate: str      # direct | family_mismatch_exact | no_family_token | veto
    reason: str


def cross_family_verdict(family_tokens_iss, target_name, target_mgmt_name,
                         bare_score, scope_support,
                         exact_threshold: float = 1.0,
                         succession_min_share: float | None = None) -> FamilyVerdict:
    """Hard cross-family veto with an ID-attested succession exception.

    A master portfolio's feeder is in the same family BY CONSTRUCTION, so a
    cross-family match is structurally impossible rather than merely unlikely.
    But a literal name-only veto deletes the genuine cases: CORPORATE
    SUCCESSIONS, where the ISS name records the family as it was when the fund
    voted and CRSP records the acquirer today (Boston Management & Research ->
    Eaton Vance; Reich & Tang -> Shelton; Gartmore -> Nationwide; Wells Fargo ->
    Allspring; GE RSP -> State Street). ~15% of the master-feeder tier's accepts
    are of that kind, and a matcher cannot tell them from an error by name.

    So the veto is hard and the exception is ID-BASED: a family-disagreeing pair
    survives only on an exact BARE-name identity (never the institution-appended
    string, which contains the disagreeing institution) AND `scope_support` —
    the share of this ISS institution's EXACT-tier (seriesId / ticker) siblings
    that CRSP files under the target's management company — at or above
    L3B_SUCCESSION_MIN_SHARE. That evidence comes from SEC series ids, so the
    name matcher cannot manufacture it. Measured separation is clean: genuine
    successions 0.28-1.00, known-wrong 0.05-0.11, band 0.111-0.275 EMPTY.
    BlackRock -> Allspring, the case that prompted the rule, scores 0.0036.

    APPLY THIS TO CANDIDATES, BEFORE the top-1 is chosen — not to winners. A
    cross-family candidate must not crowd out a correct in-family one; vetoing
    candidates is what moved "2DBR Mid Cap Value Equity Fund" off "John Hancock
    Value Equity" and onto the right sibling.

    A token counts as family evidence only if some FIRM on one side is actually
    called that. A STRATEGY word always agrees — FOCUS bridged BlackRock to DWS
    at 1.00 — which is why strategy words are stoplisted, and why no stoplist
    can be trusted to be complete.
    """
    if succession_min_share is None:
        succession_min_share = cfg.L3B_SUCCESSION_MIN_SHARE

    toks = [t for t in (family_tokens_iss or []) if t]
    if not toks:
        return FamilyVerdict(True, "no_family_token",
                             "institution name yields no token to test")

    hay = f" {(target_name or '').upper()} {(target_mgmt_name or '').upper()} "
    # Word-boundary anchored, never substring: MUTUAL would otherwise bridge to
    # MASSMUTUAL.
    agree = any(re.search(rf"\b{re.escape(t)}\b", hay) for t in toks)
    if agree:
        return FamilyVerdict(True, "direct", "family token attested on the target")

    if bare_score >= exact_threshold and scope_support >= succession_min_share:
        return FamilyVerdict(
            True, "family_mismatch_exact",
            f"bare-name identity + ID-attested succession (scope {scope_support:.2f})")

    return FamilyVerdict(
        False, "veto", f"cross-family, no ID attestation (scope {scope_support:.2f})")
