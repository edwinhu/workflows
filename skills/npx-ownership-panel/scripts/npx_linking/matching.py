"""Fund-name matching craft, as a reusable reference implementation.

WHY THIS MODULE DOES NOT REPLACE THE BUILDERS' OWN COPIES
--------------------------------------------------------
`build_fundid_seriesid.py` (L2), `build_npx_crsp_link.py` (L3) and
`build_npx_crsp_link_gap.py` (L3b) each carry their own inlined `norm()` /
`digit_*()` / `family_token*()` helpers, and **the three `norm()`s are not the
same function**:

    L2   uppercase -> drop "(formerly ...)" -> drop parentheticals
         -> strip to [A-Z0-9] -> drop legal suffixes -> fold "SandP" -> "S P"
    L3   ... but the ampersand is PRESERVED through the first punctuation strip
         ([A-Z0-9&]) and folded BEFORE the final strip, so "S&P" and "SandP"
         converge on the same tokens rather than on different ones.
    L3b  ... L3 plus the acronym-dot fold ("U.S." -> "US" before the punctuation
         strip, because ISS writes the dots and CRSP does not, and the L2/L3
         normaliser turned that into a two-token "U S").

Those differences are not accidents; each was added to fix a measured failure
and each shifts the accepted match set. Folding them into a single shared
function would change at least two of the three builders' output, and all three
outputs are validated and committed. So the builders keep their copies and this
module reproduces all three **variants** verbatim, for reuse by future work and
as executable documentation of the recipe.

`parity_report()` proves the reproduction is exact: it lifts each builder's own
function source out of the file with `ast`, evaluates it and the variant here on
the same real fund names, and asserts elementwise equality. Run it with

    python -m scripts.linking parity

CRAFT NOTES (each of these exists because it caught a real error)
----------------------------------------------------------------
* **Digit-token guard.** Char-ngram cosine is nearly blind to digits: they carry
  most of a fund name's discriminating information and almost none of its
  character mass. "Russell 2000" scores ~0.97 against "Russell 1000". The guard
  requires the *multiset* of digit-bearing tokens to be identical, and any
  trailing `SERIES <X>` designator to agree exactly. It drops ~12% of candidate
  pairs.
* **The guard is POSITIONAL.** It is evaluated against the query FORM that
  produced the candidate, not the raw ISS name. A match won through a
  leading-code strip ("6721 500 Index B" -> "500 Index B") has already lost the
  code and is never asked to reproduce it; a match won on the full name still
  must reproduce every digit token. Otherwise the guard blocks every insurance
  sub-account.
* **Ampersand fold.** ISS writes "SandP" where every other source writes "S&P".
  Fold before tokenising or the digit guard sees different token sets for the
  same fund.
* **Trust-prefix dominance.** CRSP `fund_name` is `"Trust: Fund; Class X"`, so
  within-family char-ngram similarity is dominated by the shared prefix and
  family agreement is NOT an independent signal in the 0.80-0.85 band — the
  top-1 is systematically the *wrong sibling*. Hold >=0.90 scoped; an identity
  claim (a master's name IS its feeder's name once structural words are gone)
  needs >=0.97, because the 0.90-0.97 band is almost entirely sibling confusion.
* **Never strip the sponsor token from the query.** Dropping it let a BlackRock
  master match an Allspring fund. Strip it as an ADDITIONAL form, never as a
  replacement, and police the result with the cross-family rule.
* **Score on max(bare, institution-appended).** Appending the ISS institution
  shifts scores DOWN ~0.05-0.10 at every quantile (char-ngram cosine is
  length-weighted, so the appended segment adds noise in proportion to its
  length) — but it rescues master-feeder cases where only the CRSP side names
  the family. Complementary, not substitutes.
* **Fund names are not identifying.** 124 CRSP funds are named "...S&P 500
  Index..." across 48 management companies. The institution is the disambiguator.
"""
import ast
from dataclasses import dataclass

import numpy as np
import polars as pl
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn

from ._config import LINKING_DIR, cfg

__all__ = [
    "NORM_VARIANTS",
    "normalize_name",
    "digit_token_list",
    "digit_token_key",
    "designator",
    "family_token",
    "family_tokens",
    "tfidf_candidates",
    "digit_guard_mask",
    "cross_family_verdict",
    "parity_report",
]

NORM_VARIANTS = ("l2", "l3", "l3b")


# ---------------------------------------------------------------------------
# name normalisation — one function per builder variant, verbatim
# ---------------------------------------------------------------------------
def normalize_name(col, variant="l3b", drop_formerly=True):
    """Normalise a fund/entity name column to the matcher's token space.

    `variant` selects the builder whose behaviour is reproduced exactly:
    ``"l2"`` (build_fundid_seriesid), ``"l3"`` (build_npx_crsp_link) or
    ``"l3b"`` (build_npx_crsp_link_gap, the most complete recipe and the
    default for new work).

    `drop_formerly` is honoured only by the L2 variant, which is the only one
    that exposes it — the corpus builder needs the un-stripped form so the
    pre-rename name buried in "(formerly named X)" can be emitted as its own
    corpus entry.
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
        raise ValueError(f"unknown norm variant {variant!r}; expected one of {NORM_VARIANTS}")

    e = pl.col(col).str.to_uppercase()
    e = e.str.replace_all(cfg.L2_FORMERLY_RE, " ")
    if variant == "l3b":
        # "U.S." -> "US" BEFORE the punctuation strip, which would otherwise
        # leave a two-token "U S" against CRSP's one-token "US".
        e = e.str.replace_all(cfg.L3B_ACRONYM_DOT_RE, "${1}")
    e = e.str.replace_all(cfg.L2_PAREN_RE, " ")
    e = e.str.replace_all(r"[^A-Z0-9&]+", " ")
    for pat, rep in cfg.L2_AMPERSAND_FOLD:
        e = e.str.replace_all(pat, rep)
    e = e.str.replace_all(r"[^A-Z0-9]+", " ")
    e = e.str.replace_all(cfg.L2_LEGAL_SUFFIX_RE, " ")
    return e.str.replace_all(r"\s+", " ").str.strip_chars()


def digit_token_list(expr):
    """Sorted LIST of the digit-bearing tokens in an already-normalised name.

    The L3/L3b form. Compare two of these for equality to apply the guard.
    """
    if isinstance(expr, str):
        expr = pl.col(expr)
    return (
        expr.str.split(" ")
        .list.eval(pl.element().filter(pl.element().str.contains(cfg.L2_DIGIT_TOKEN_RE)))
        .list.sort()
    )


def digit_token_key(col):
    """Space-joined form of :func:`digit_token_list` (the L2 form)."""
    return digit_token_list(col).list.join(" ")


def designator(col):
    """A trailing series/portfolio designator: "SBL Fund Series H" -> "H"."""
    expr = pl.col(col) if isinstance(col, str) else col
    return expr.str.extract(cfg.L2_DESIGNATOR_RE, 1)


def family_token(col, variant="l3"):
    """FIRST distinguishing token of an institution name (the L2/L3 form).

    Brittle in both directions — "John Hancock Funds, LLC" reduces to "JOHN"
    (which appears in nothing) and "RS Investment Management" to "RS" (too
    short to be a signal). Prefer :func:`family_tokens` for new work.
    """
    e = normalize_name(col, variant=variant)
    for w in cfg.L2_FAMILY_STOPWORDS:
        e = e.str.replace_all(rf"\b{w}\b", " ")
    e = e.str.replace_all(r"\s+", " ").str.strip_chars()
    return e.str.split(" ").list.first()


def family_tokens(col, stop_both_sources=None):
    """EVERY distinctive token of an institution name (the L3b form).

    Recovers HANCOCK, DIMENSIONAL, BLACKROCK, TRANSAMERICA, NORTHWESTERN — all
    of which :func:`family_token` misses. Two rules learned the hard way:

    * the family stoplist must apply to BOTH token sources, not just the
      institution side ("Strategic Partners Mutual Funds" otherwise emits
      STRATEGIC, and MUTUAL is a substring of MASSMUTUAL);
    * containment tests against these tokens must be word-boundary anchored,
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
                     threshold=None, analyzer=None):
    """Char-ngram TF-IDF cosine top-k, the ING recipe used by all three tiers.

    Returns a DataFrame of ``(row, col, score)`` where `row` indexes
    `left_names` and `col` indexes `right_names`. The vectoriser is fit on the
    UNION of both sides so the two corpora share an idf.

    Defaults come from `config_obs` (`L2_TFIDF_*`): `char_wb` (2,4), top 25,
    candidate floor 0.60. Generating candidates is cheap; the accept rules are
    where precision is bought.
    """
    ngram = ngram or cfg.L2_TFIDF_NGRAM
    top_k = top_k or cfg.L2_TFIDF_TOP_K
    threshold = cfg.L2_CAND_THRESHOLD if threshold is None else threshold
    analyzer = analyzer or cfg.L2_TFIDF_ANALYZER

    left_names = list(left_names)
    right_names = list(right_names)
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


def digit_guard_mask(left_norm="l_norm", right_norm="r_norm"):
    """Boolean expression: does this candidate pair survive the digit guard?

    Applies to the pair of NORMALISED names that actually produced the score —
    the query form, not the raw ISS name (see the positional note in the module
    docstring). Requires the digit-token multisets to be identical and any
    trailing `SERIES <X>` designator to agree (null == null counts as agreeing).
    """
    ld, rd = digit_token_list(left_norm), digit_token_list(right_norm)
    lg, rg = designator(left_norm), designator(right_norm)
    return (ld == rd) & (
        (lg.is_null() & rg.is_null()) | (lg == rg)
    )


@dataclass(frozen=True)
class FamilyVerdict:
    """Outcome of the cross-family rule. `ok` is the accept/reject."""
    ok: bool
    gate: str      # direct | family_mismatch_exact | no_family_token | veto
    reason: str


def cross_family_verdict(family_tokens_iss, target_name, target_mgmt_name,
                         bare_score, scope_support,
                         exact_threshold=1.0, succession_min_share=None):
    """The cross-family rule, in its final measured form.

    A master portfolio's feeder is in the same family *by construction*, so a
    cross-family match is structurally impossible rather than merely unlikely —
    which argues for a hard veto. But a literal name-only veto deletes the
    genuine cases: **corporate successions**, where the ISS name records the
    family as it was when the fund voted and CRSP records the acquirer today
    (Boston Management & Research -> Eaton Vance; Reich & Tang -> Shelton;
    Gartmore -> Nationwide; Wells Fargo -> Allspring; GE RSP -> State Street).
    ~15% of the master-feeder tier's accepts are of that kind and a matcher
    cannot tell them from an error by name.

    So the veto is hard and the exception is **ID-based**: a family-disagreeing
    pair survives only on an exact BARE-name identity (never the
    institution-appended string, which contains the disagreeing institution)
    AND `scope_support` — the share of this ISS institution's *exact-tier*
    (seriesId / ticker) siblings that CRSP files under the target's management
    company — at or above `L3B_SUCCESSION_MIN_SHARE` (0.20). That evidence
    comes from SEC series IDs, so the name matcher cannot manufacture it. The
    measured separation is clean: genuine successions sit at 0.28-1.00, the
    known-wrong ones at 0.05-0.11, and the band 0.111-0.275 is empty.
    BlackRock -> Allspring, the case that prompted the rule, scores 0.0036.

    Apply this to CANDIDATES, before the top-1 is chosen — not to winners. A
    cross-family candidate must not be allowed to crowd out a correct in-family
    one; vetoing candidates is what let `2DBR Mid Cap Value Equity Fund` move
    off "John Hancock Value Equity" and onto the right sibling.

    A token counts as a family token only if some FIRM on one side is actually
    called that (it appears in the ISS institution name or the CRSP
    `mgmt_name`). A strategy word ALWAYS agrees — FOCUS bridged BlackRock to
    DWS at 1.00 — which is exactly why it must never count, and no stoplist can
    be trusted to be complete.
    """
    if succession_min_share is None:
        succession_min_share = cfg.L3B_SUCCESSION_MIN_SHARE

    toks = [t for t in (family_tokens_iss or []) if t]
    if not toks:
        return FamilyVerdict(True, "no_family_token",
                             "institution name yields no token to test")

    hay = f" {(target_name or '').upper()} {(target_mgmt_name or '').upper()} "
    import re
    agree = any(re.search(rf"\b{re.escape(t)}\b", hay) for t in toks)
    if agree:
        return FamilyVerdict(True, "direct", "family token attested on the target")

    if bare_score >= exact_threshold and scope_support >= succession_min_share:
        return FamilyVerdict(
            True, "family_mismatch_exact",
            f"bare-name identity + ID-attested succession (scope {scope_support:.2f})")

    return FamilyVerdict(
        False, "veto",
        f"cross-family, no ID attestation (scope {scope_support:.2f})")


# ---------------------------------------------------------------------------
# parity — prove the variants above reproduce the builders exactly
# ---------------------------------------------------------------------------
_PARITY_SPECS = (
    ("build_fundid_seriesid.py", "l2", ["norm"], "norm"),
    ("build_npx_crsp_link.py", "l3", ["norm"], "norm"),
    ("build_npx_crsp_link_gap.py", "l3b", ["norm"], "norm"),
)


def _lift(path, names):
    """Exec the named top-level defs/assignments out of a builder, in isolation.

    The builders run their whole pipeline at import time, so they cannot be
    imported. `ast` lets the pure helper functions be lifted out without
    executing anything else in the file.
    """
    tree = ast.parse(path.read_text())
    wanted = [n for n in tree.body
              if (isinstance(n, (ast.FunctionDef, ast.Assign))
                  and (getattr(n, "name", None) in names
                       or any(getattr(t, "id", None) in names
                              for t in getattr(n, "targets", []))))]
    ns = {"pl": pl, "np": np, "ast": ast}
    ns.update({k: getattr(cfg, k) for k in dir(cfg) if not k.startswith("_")})
    exec(compile(ast.Module(body=wanted, type_ignores=[]), str(path), "exec"), ns)
    return ns


def parity_report(sample=None, verbose=True):
    """Assert every variant here reproduces its builder's function exactly.

    Evaluates both on real ISS fund names, ISS institution names and CRSP fund
    names. Returns a list of ``(builder, variant, n_names, ok)``.
    """
    if sample is None:
        names = []
        link = cfg.NPX_CRSP_LINK
        if link.exists():
            df = pl.read_parquet(link, columns=["fundname_modal", "institutionname_modal"])
            names += df["fundname_modal"].drop_nulls().to_list()
            names += df["institutionname_modal"].drop_nulls().unique().to_list()
        fs2 = cfg.FUND_SUMMARY2
        if fs2.exists():
            names += (pl.read_parquet(fs2, columns=["fund_name"])["fund_name"]
                      .drop_nulls().unique().head(40_000).to_list())
        if not names:
            raise RuntimeError(
                "no name corpus available for the parity check — pass `sample=`")
        sample = names

    frame = pl.DataFrame({"name": sample})
    results = []
    for filename, variant, lift_names, fn_name in _PARITY_SPECS:
        ns = _lift(LINKING_DIR / filename, lift_names)
        theirs = frame.select(ns[fn_name]("name")).to_series()
        mine = frame.select(normalize_name("name", variant=variant)).to_series()
        ok = theirs.equals(mine)
        results.append((filename, variant, len(sample), ok))
        if verbose:
            status = "OK " if ok else "DIFF"
            print(f"  [{status}] normalize_name(variant={variant!r}) "
                  f"== {filename}:norm()  on {len(sample):,} names")
        if not ok:
            bad = frame.with_columns(theirs=theirs, mine=mine).filter(
                pl.col("theirs") != pl.col("mine"))
            raise AssertionError(
                f"{filename}: normalize_name(variant={variant!r}) diverges on "
                f"{bad.height:,} names, e.g.\n{bad.head(5)}")
    return results
