"""L3c — the `digit_split_name` tier. UPDATES `data/processed/npx_crsp_link.parquet`.

L3b's engine, with ONE change. Everything that made L3b precise is reused
verbatim from the `L3B_*` constants — the 0.97 identity bar, `max(bare,
institution-appended)` scoring, the cross-family veto with its ID-based
succession exception, the mgmt_cd scope with its 2% share floor, the lifespan
guard, the token minimums. Each of those clauses is the residue of a hand
audit and none of them is relaxed here.

THE BUG THIS FIXES (measured, VERIFY 0b reproduces it)
------------------------------------------------------
The digit-token guard exists because char-ngram cosine is nearly blind to
digits: "Russell 2000" scores ~0.97 against "Russell 1000". It requires the
multiset of digit-BEARING tokens to be identical on both sides.

But **ISS separates digits from words and CRSP FUSES them**:

    ISS  `PROSHARES ULTRA RUSSELL 2000 GROWTH`
    CRSP `ProShares Trust: ProShares Ultra Russell2000 Growth`

ISS tokenises to {"2000"}; CRSP to {"RUSSELL2000"}. The multisets differ, so
the guard VETOES a correct match. The entire ProShares Ultra Russell family is
unlinked today despite being present in CRSP.

THE FIX
-------
Insert a boundary at every alpha<->digit transition, on BOTH sides, before
tokenising: `RUSSELL2000` -> `RUSSELL 2000`, `S P500` -> `S P 500`.

Three ordering rules, each of which was necessary:

1. **The split is applied to the SCORING strings too, not only to the guard.**
   MEASURED: the fusion costs real char-ngram mass. `PROSHARES ULTRA RUSSELL
   2000 GROWTH` against the CRSP `fund` form scores **0.833 unsplit, 1.000
   split**; `... RUSSELL 3000` scores **0.620 unsplit, 1.000 split**. At the
   0.97 identity bar a guard-only fix would still have rejected every one of
   them — the guard would have stopped vetoing and the threshold would have
   done the vetoing instead. Applied symmetrically to both corpora so they
   stay comparable.

2. **The leading internal-code strip runs BEFORE the split, on the raw token.**
   `L3B_LEAD_CODE_RE` recognises `2DBE`, `ZWJ4`, `6721` as VA sub-account
   codes. Splitting first turns those into `2 DBE` / `ZWJ 4` and defeats the
   pattern, losing the whole sub-account population that L3b's `lead_drop` /
   `lead_drop2` forms exist to reach. Order: normalise -> strip -> split.

3. **The SERIES-DESIGNATOR guard stays on the UNSPLIT string.**
   `L2_DESIGNATOR_RE` anchors on a trailing 1-2 character code; splitting `2A`
   into `2 A` would break the anchor and let "Series 2A" match "Series 2B".
   The digit guard needs the split, the designator guard needs the raw token,
   and both are still required.

THE GUARD'S REAL PURPOSE STILL HOLDS
------------------------------------
"Russell 2000" must still not match "Russell 1000", and it does not: the split
is symmetric, so the comparison becomes {"2000"} vs {"1000"} — still unequal,
still vetoed. **VERIFY R asserts this on the live corpus** over the synthetic
pair and over every real ProShares Ultra Russell cross-pair, and prints the
scores so the rejection is visible rather than asserted.

Population
----------
Every fundid still without a `crsp_fundno` after L3b that is not an ISS
non-registrant (`block != 'asset_owner'`). That is the same predicate L3b's own
`todo` used, so this tier sees exactly the funds L3b could not place and every
accept is attributable to the normalisation change.

Precision remains the binding constraint. A mis-link imports another fund's
`index_fund_flag` (a block) and its `tna_latest` (a vote weight); a fund left
unlinked loses only its weight and keeps its block. VERIFY 4 prints the
TNA-per-vote-row tail for every link this tier adds.

Outputs
-------
`data/processed/npx_crsp_link.parquet`  UPDATED IN PLACE (same 26,686 rows;
    only previously-null crsp_fundno/wficn/index_fund_flag/tna_latest filled)
`data/output/l3c_accepted_matches.csv`       every accepted match, auditable
`data/output/l3c_audit_sample.csv`           the reproducible random-20 audit
`data/output/l3c_candidates.csv`             every candidate over the score bar
`data/output/l3c_unmatched.csv`              what is left, with its reason
`data/output/l3c_coverage_by_year.csv`       vote-row coverage before vs after
`data/output/l3c_block_changes.csv`          every fundid whose block moved
`data/output/l3c_tna_hazard.csv`             TNA per vote row for the new links
`data/output/l3c_digit_guard_regression.csv` the Russell 2000/1000 regression
`data/output/l3c_digit_fusion_pairs.csv`     pairs the fix un-vetoed

Run: python scripts/linking/build_npx_crsp_link_gap2.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cit"))

import numpy as np
import polars as pl
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn

from config_obs import (  # noqa: E402
    CRSP_CIK_MAP,
    FUND_SUMMARY2,
    FUNDID_SERIESID,
    L2_AMPERSAND_FOLD,
    L2_DESIGNATOR_RE,
    L2_DIGIT_TOKEN_RE,
    L2_FAMILY_STOPWORDS,
    L2_FORMERLY_RE,
    L2_LEGAL_SUFFIX_RE,
    L2_PAREN_RE,
    L2_TFIDF_ANALYZER,
    L2_TFIDF_NGRAM,
    L3_CLASS_SUFFIX_RE,
    L3C_ACCEPTED,
    L3B_ACRONYM_DOT_RE,
    L3C_AUDIT_N,
    L3C_AUDIT_SAMPLE,
    L3C_AUDIT_SEED,
    L3C_BLOCK_CHANGES,
    L3B_CAND_THRESHOLD,
    L3C_CANDIDATES,
    L3C_DIGIT_FUSION,
    L3C_DIGIT_SPLIT_RULES,
    L3C_EXCLUDE_BLOCK,
    L3C_FAMILY_PLURAL_FOLD,
    L3C_REGRESSION,
    L3C_REGRESSION_PAIRS,
    L3C_COVERAGE_BY_YEAR,
    L3B_EXACT_NAME_IDENTITY,
    L3B_EXACT_TIERS,
    L3B_FAMILY_GATE,
    L3B_FAMILY_MISMATCH_FLAG,
    L3B_FAMILY_MIN_CHARS,
    L3B_FAMILY_NAME_TOKEN_MIN_CHARS,
    L3B_FAMILY_NAME_TOKEN_NEEDS_FIRM,
    L3B_FAMILY_STOP_BOTH_SOURCES,
    L3B_FAMILY_WORD_BOUNDARY,
    L3B_GLOBAL_MARGIN,
    L3B_GLOBAL_THRESH,
    L3B_LEAD_CODE_MAX,
    L3B_LEAD_CODE_RE,
    L3B_LIFESPAN_SLACK_YEARS,
    L3B_MIN_MATCH_TOKENS,
    L3B_MIN_MATCH_TOKENS_GLOBAL,
    L3B_MIN_MATCH_TOKENS_STRICT,
    L3B_MIN_NAME_CHARS,
    L3B_MIN_NAME_TOKENS,
    L3B_SCOPE_MIN_SHARE,
    L3B_SCOPE_PASSES,
    L3B_SPONSOR_KEEP_MIN_TOKENS,
    L3B_SUCCESSION_MIN_SHARE,
    L3B_SCOPED_MARGIN,
    L3B_SCOPED_THRESH,
    L3B_REQUIRE_DISTINCTIVE_TOKEN,
    L3B_STRATEGY_STOPWORDS,
    L3B_STRICT_TOKEN_SCORE,
    L3B_STRUCTURAL_WORDS,
    L3B_TAIL_SEP_RE,
    L3B_TFIDF_TOP_K,
    L3C_TIER,
    L3C_TNA_HAZARD,
    L3C_UNMATCHED,
    L3B_WRAPPER_RE,
    MFLINK1,
    NPX_CRSP_LINK,
    NPX_SERIESID,
    PARQUET_COMPRESSION,
    SAMPLE_END,
    SAMPLE_START,
)

pl.Config.set_tbl_rows(60)
pl.Config.set_tbl_cols(24)
pl.Config.set_fmt_str_lengths(60)


def rule(title):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


# ---------------------------------------------------------------------------
# name normalisation — L2/L3's recipe plus the acronym-dot fold, applied
# IDENTICALLY to both sides so the two corpora stay comparable
# ---------------------------------------------------------------------------
def norm(col):
    e = pl.col(col).str.to_uppercase()
    e = e.str.replace_all(L2_FORMERLY_RE, " ")
    # "U.S." -> "US" (ISS writes the dots, CRSP does not). Before the
    # punctuation strip, which would otherwise make it two tokens "U S".
    e = e.str.replace_all(L3B_ACRONYM_DOT_RE, "${1}")
    e = e.str.replace_all(L2_PAREN_RE, " ")
    e = e.str.replace_all(r"[^A-Z0-9&]+", " ")
    for pat, rep in L2_AMPERSAND_FOLD:
        e = e.str.replace_all(pat, rep)
    e = e.str.replace_all(r"[^A-Z0-9]+", " ")
    e = e.str.replace_all(L2_LEGAL_SUFFIX_RE, " ")
    return e.str.replace_all(r"\s+", " ").str.strip_chars()


def core(e):
    """Remove the structural words that differ between a master and its feeder."""
    for w in L3B_STRUCTURAL_WORDS:
        e = e.str.replace_all(rf"\b{w}\b", " ")
    return e.str.replace_all(r"\s+", " ").str.strip_chars()


def drop_lead_code(e, n=1):
    """Drop exactly `n` leading internal sub-account code tokens (if present).

    Each level is its own query form. A single greedy strip would eat the "500"
    in "6721 500 Index B" -- the identity of the fund -- and leave "INDEX B".

    Runs on the RAW (unsplit) normalised name, BEFORE `digit_split`. The pattern
    recognises `2DBE`, `ZWJ4`, `6721` as sub-account codes; splitting them first
    would turn those into "2 DBE" / "ZWJ 4" and defeat it, losing the whole VA
    sub-account population these query forms exist to reach.
    """
    for _ in range(n):
        e = e.str.replace(L3B_LEAD_CODE_RE, "")
    return e.str.strip_chars()


def digit_split(e):
    """THE L3c FIX. Insert a boundary at every alpha<->digit transition.

    ISS separates digits from words, CRSP FUSES them:
        ISS  `PROSHARES ULTRA RUSSELL 2000 GROWTH`   -> digit tokens {"2000"}
        CRSP `... ProShares Ultra Russell2000 Growth`-> {"RUSSELL2000"}
    The digit guard compares those multisets exactly, so it VETOED a correct
    match. Splitting on both sides makes both {"2000"} and the pair survives.

    Applied to the SCORING strings as well as to the guard, because MEASURED the
    fusion also costs real char-ngram mass: that pair scores 0.833 unsplit and
    1.000 split; `PROSHARES ULTRA RUSSELL 3000` scores 0.620 unsplit and 1.000
    split. At the 0.97 identity bar a guard-only fix would have changed nothing
    -- the threshold would simply have done the vetoing the guard stopped doing.

    Symmetric by construction, which is why the guard's PURPOSE survives:
    "Russell 2000" vs "Russell 1000" becomes {"2000"} vs {"1000"}, still
    unequal, still vetoed. VERIFY R asserts that on the live corpus.
    """
    for pat, rep in L3C_DIGIT_SPLIT_RULES:
        e = e.str.replace_all(pat, rep)
    return e.str.replace_all(r"\s+", " ").str.strip_chars()


def digit_tokens(e):
    return (
        e.str.split(" ")
        .list.eval(pl.element().filter(pl.element().str.contains(L2_DIGIT_TOKEN_RE)))
        .list.sort()
    )


def designator(e):
    return e.str.extract(L2_DESIGNATOR_RE, 1)


FAMILY_STOP = set(L2_FAMILY_STOPWORDS) | set(L3B_STRATEGY_STOPWORDS)


def family_tokens(col):
    """Every distinctive token of an ISS institution name, not just the first.

    L3 used `first token after the stopwords`, which is brittle in both
    directions: "John Hancock Funds, LLC" reduces to "JOHN" (which appears in
    nothing) and "RS Investment Management Co. LLC" to "RS" (too short to be a
    signal at all). Taking every remaining token of >= L3B_FAMILY_MIN_CHARS
    recovers HANCOCK, DIMENSIONAL, BLACKROCK, TRANSAMERICA, NORTHWESTERN.
    """
    e = norm(col)
    for w in (sorted(FAMILY_STOP) if L3B_FAMILY_STOP_BOTH_SOURCES
              else L2_FAMILY_STOPWORDS):
        e = e.str.replace_all(rf"\b{w}\b", " ")
    e = e.str.replace_all(r"\s+", " ").str.strip_chars()
    return e.str.split(" ").list.eval(
        pl.element().filter(pl.element().str.len_chars() >= L3B_FAMILY_MIN_CHARS))


def fundname_family_token(names):
    """The FIRST NON-STOPWORD token of an ISS fund name, as a family claim.

    An ISS fund name often declares its own family where the institution name
    does not: "BLACKROCK MASTER SMALL CAP GROWTH PORTFOLIO" (the motivating
    false positive), "MFS VARIABLE INSURANCE TRUST II - MFS STRATEGIC VALUE"
    (institution "Massachusetts Financial Services Company" yields only
    MASSACHUSETTS), "THE BOSTON COMPANY LARGE CAP CORE PORTFOLIO" (institution
    "Mellon Capital Management" yields only MELLON). First NON-stopword rather
    than literal first is what turns "THE BOSTON COMPANY ..." into BOSTON.
    """
    out = []
    for n in names:
        tok = None
        for t in (n or "").split(" "):
            if (len(t) >= L3B_FAMILY_NAME_TOKEN_MIN_CHARS and t.isalpha()
                    and t not in FAMILY_STOP):
                tok = t
                break
        out.append([tok] if tok else [])
    return out


def fam_pat(tok, min_chars):
    """Word-boundary pattern for a family token, tolerant of a plural S.

    THE SECOND L3c FIX, and it is what actually links the ProShares funds. ISS
    writes the firm singular ("ProShare Advisors LLC" -> PROSHARE), CRSP writes
    it plural ("ProShares Trust: ProShares Ultra Russell2000 Growth" under
    mgmt "ProFunds Group"). `\\bPROSHARE\\b` does not match "PROSHARES" -- the
    trailing S is a word character and the boundary fails -- so the cross-family
    veto read one firm as two and killed the whole family before the top-1 was
    even chosen. It then failed the ID-based succession escape too, and
    correctly: ProShare's exact-tier siblings are 7 of 71 (9.9%) under the
    mgmt_cd CRSP files the dead Ultra Russell classes under, below the 0.20 bar
    and inside the band where the measured false positives live. That escape is
    the wrong instrument here -- this is not a succession, it is one firm
    spelled two ways.

    The pattern becomes `\\b<stem>S?\\b`, stem = the token with a trailing S
    removed when that still leaves `min_chars` characters. Anchored at BOTH
    ends, so the substring failure this rule exists to prevent is untouched:
    `\\bMUTUALS?\\b` still cannot reach the MUTUAL inside "MASSMUTUAL". VERIFY P
    asserts that rather than claiming it.
    """
    if not L3C_FAMILY_PLURAL_FOLD:
        return pl.lit(r"\b") + tok + pl.lit(r"\b")
    stem = (pl.when(tok.str.len_chars() - 1 >= min_chars)
            .then(tok.str.replace(r"S$", "")).otherwise(tok))
    return pl.lit(r"\b") + stem + pl.lit(r"S?\b")



def n_tokens(e):
    return e.str.split(" ").list.len()


def usable(e):
    return (e.str.len_chars() >= L3B_MIN_NAME_CHARS) & (
        e.str.split(" ").list.len() >= L3B_MIN_NAME_TOKENS
    )


# ---------------------------------------------------------------------------
# 1. inputs + VERIFY 0 (reproduce the measured gap before touching anything)
# ---------------------------------------------------------------------------
rule("L3c — inputs, and VERIFY 0: the state L3b left behind")

base = pl.read_parquet(NPX_CRSP_LINK)
N_FUNDIDS = base.height
BASE_COLS = base.columns
assert base["fundid"].n_unique() == N_FUNDIDS, "fundid not unique in npx_crsp_link"
print(f"npx_crsp_link (as built by L3)     : {base.height:,} rows x {base.width} cols")

TOTAL_ROWS = base["n_vote_rows"].sum()
gap = base.filter(pl.col("seriesid").is_not_null() & pl.col("crsp_fundno").is_null())
print(f"\nGAP: seriesid present, crsp_fundno NULL")
print(f"  fundids                          : {gap.height:,}")
print(f"  vote rows                        : {gap['n_vote_rows'].sum():,} "
      f"({gap['n_vote_rows'].sum() / TOTAL_ROWS:.2%} of the panel)")

cikmap = pl.read_parquet(CRSP_CIK_MAP)
in_map = gap.join(
    cikmap.filter(pl.col("series_cik").is_not_null())
    .select(seriesid="series_cik").unique(), on="seriesid", how="semi")
print(f"  of those seriesIds, present in crsp_cik_map: {in_map.height:,} "
      f"-> the gap is a POPULATION boundary, not a broken join")

fund = pl.read_parquet(FUNDID_SERIESID).select(
    "fundid", "institutionid", "first_year", "last_year")
fs = pl.read_parquet(FUND_SUMMARY2)
mflink = pl.read_parquet(MFLINK1).unique(subset=["crsp_fundno"], keep="first")
print(f"\nfund_summary2 (CLASS grain)        : {fs.height:,} crsp_fundnos")

# ---------------------------------------------------------------------------
# 2. the population this tier runs on
# ---------------------------------------------------------------------------
rule("target population")

todo = (
    base.filter(pl.col("crsp_fundno").is_null()
                & (pl.col("block") != L3C_EXCLUDE_BLOCK)
                & ~pl.col("iss_nonregistrant"))
    .join(fund, on="fundid", how="left")
)
print(f"fundids with NO crsp_fundno, not {L3C_EXCLUDE_BLOCK}: {todo.height:,} "
      f"({todo['n_vote_rows'].sum():,} vote rows, "
      f"{todo['n_vote_rows'].sum() / TOTAL_ROWS:.2%} of the panel)")
print(f"  of which carry an L2 seriesId      : "
      f"{todo.filter(pl.col('seriesid').is_not_null()).height:,} "
      f"({todo.filter(pl.col('seriesid').is_not_null())['n_vote_rows'].sum():,} rows)")
print(f"  of which L2 never resolved at all  : "
      f"{todo.filter(pl.col('seriesid').is_null()).height:,} "
      f"({todo.filter(pl.col('seriesid').is_null())['n_vote_rows'].sum():,} rows)")
print("\nThis is exactly the predicate L3b's own `todo` used, so this tier sees "
      "the funds L3b could not place and nothing else. Every accept below is "
      "therefore attributable to the digit-split normalisation change.")

# ---------------------------------------------------------------------------
# 2b. VERIFY 0b — reproduce the BUG on the raw strings, before any machinery
# ---------------------------------------------------------------------------
rule("VERIFY 0b — reproduce the digit-fusion bug")

_bug = pl.DataFrame({
    "iss": ["PROSHARES ULTRA RUSSELL 2000 GROWTH", "PROSHARES ULTRA RUSSELL 3000"],
    "crsp": ["ProShares Trust: ProShares Ultra Russell2000 Growth",
             "ProShares Trust: ProShares Ultra Russell3000"],
})
# split the trust prefix off the RAW string: norm() turns ":" into a space, so
# splitting AFTER normalising silently compares against the trust-qualified name
# and understates the score.
_bug = (_bug.with_columns(crsp_fund=pl.col("crsp").str.split(":").list.last())
        .with_columns(q=norm("iss"), c=norm("crsp_fund")))
_bug = _bug.with_columns(qs=digit_split(pl.col("q")), cs=digit_split(pl.col("c")))
_bug = _bug.with_columns(
    q_dig_L3b=digit_tokens(pl.col("q")), c_dig_L3b=digit_tokens(pl.col("c")),
    q_dig_L3c=digit_tokens(pl.col("qs")), c_dig_L3c=digit_tokens(pl.col("cs")))
for r in _bug.iter_rows(named=True):
    print(f"\n  ISS  {r['iss']}\n  CRSP {r['crsp']}")
    print(f"    L3b digit tokens : {r['q_dig_L3b']} vs {r['c_dig_L3b']}  -> "
          f"{'MATCH' if r['q_dig_L3b'] == r['c_dig_L3b'] else 'VETOED (the bug)'}")
    print(f"    L3c digit tokens : {r['q_dig_L3c']} vs {r['c_dig_L3c']}  -> "
          f"{'MATCH' if r['q_dig_L3c'] == r['c_dig_L3c'] else 'VETOED'}")
assert (_bug["q_dig_L3b"] != _bug["c_dig_L3b"]).all(), \
    "VERIFY 0b: the bug did not reproduce — L3b's guard already accepted these"
assert (_bug["q_dig_L3c"] == _bug["c_dig_L3c"]).all(), \
    "VERIFY 0b: the fix did not fire — L3c's guard still vetoes these"
print("\n  reproduced: L3b vetoes both, L3c accepts both.")

# ---------------------------------------------------------------------------
# 3. CRSP corpus at fund-unit grain, in both name spaces
# ---------------------------------------------------------------------------
rule("CRSP corpus (fund-unit grain, `full` and `core` name spaces)")

fs_cls = fs.select(
    "crsp_fundno", "index_fund_flag", "tna_latest", "fund_name", "mgmt_name",
    "mgmt_cd", "dead_flag", crsp_last_year=pl.col("caldt").dt.year(),
).join(mflink, on="crsp_fundno", how="left")


def agg_classes(pairs, key):
    """Collapse CRSP share classes to the fund level (L3's helper, verbatim).

    `tna_latest` SUMMED across classes, `index_fund_flag` the modal non-null
    flag, representative `crsp_fundno` = largest class by TNA.
    """
    d = pairs.join(fs_cls, on="crsp_fundno", how="left")

    def modal(col, out):
        return (
            d.filter(pl.col(col).is_not_null())
            .group_by([key, col]).agg(n=pl.len())
            .sort([key, "n", col], descending=[False, True, False])
            .group_by(key).head(1)
            .select(key, pl.col(col).alias(out))
        )

    rep = (
        d.sort([key, "tna_latest", "crsp_fundno"], descending=[False, True, False],
               nulls_last=True)
        .group_by(key).head(1)
        .select(key, crsp_fundno=pl.col("crsp_fundno"),
                crsp_fund_name=pl.col("fund_name"))
    )
    b = d.group_by(key).agg(
        n_crsp_classes=pl.col("crsp_fundno").n_unique(),
        tna_latest=pl.col("tna_latest").sum(),
        n_tna=pl.col("tna_latest").is_not_null().sum(),
        n_flags=pl.col("index_fund_flag").drop_nulls().n_unique(),
        crsp_last_year=pl.col("crsp_last_year").max(),
    ).with_columns(
        tna_latest=pl.when(pl.col("n_tna") > 0).then(pl.col("tna_latest")).otherwise(None)
    ).drop("n_tna")
    for c, o in [("index_fund_flag", "index_fund_flag"), ("wficn", "wficn"),
                 ("mgmt_cd", "mgmt_cd"), ("mgmt_name", "mgmt_name")]:
        b = b.join(modal(c, o), on=key, how="left")
    return b.join(rep, on=key, how="left")


named = fs.filter(pl.col("fund_name").is_not_null()).with_columns(
    unit=pl.when(pl.col("crsp_portno").is_not_null())
    .then(pl.format("P{}", pl.col("crsp_portno").cast(pl.Int64)))
    .otherwise(pl.format("F{}", pl.col("crsp_fundno").cast(pl.Int64)))
)
unit_agg = agg_classes(named.select("unit", "crsp_fundno"), "unit")
print(f"named crsp_fundnos                 : {named.height:,} "
      f"-> {named['unit'].n_unique():,} fund units")

# "<Trust>: <Fund>; <Class> Shares" -> both "<Trust> <Fund>" and "<Fund>"
unit_names = (
    named.with_columns(b=pl.col("fund_name").str.replace(L3_CLASS_SUFFIX_RE, ""))
    .with_columns(s=pl.col("b").str.split(":").list.last(),
                  t=pl.when(pl.col("b").str.contains(":", literal=True))
                  .then(pl.col("b").str.split(":").list.first()).otherwise(pl.lit("")))
    .select("unit", "b", "s", "t")
    .with_columns(n_short=norm("s"), n_trust=norm("t"))
)


def strip_leading(name, stop_tokens, keep_min=L3B_SPONSOR_KEEP_MIN_TOKENS):
    """Drop leading tokens of `name` that also occur in `stop_tokens`.

    The sponsor prefix. CRSP repeats the sponsor INSIDE the fund name
    ("BlackRock Index Funds, Inc: BlackRock S&P 500 Index Fund") while an ISS
    MASTER name does not ("S&P 500 Index Master Portfolio"), and that prefix is
    about a third of the character mass. Emitted as an ADDITIONAL corpus form,
    never as a replacement, and the tokens are never guessed: on the CRSP side
    they must already appear in that fund's own trust prefix, on the ISS side in
    its own institution name.

    A reviewer asked for this to be removed, on the grounds that it caused the
    one cross-family error found in audit (BLACKROCK MASTER SMALL CAP GROWTH ->
    Allspring Small Company Growth, 0.911). The mechanism was right, the remedy
    is not: removing it costs 91 fundids / ~320K vote rows and loses 5 of the
    reviewer's own 10 reference matches, INCLUDING the largest ("S&P 500 Index
    Master Portfolio" -> BlackRock S&P 500 Index Fund, 67,320 vote rows). The
    Allspring error is killed instead by the CROSS-FAMILY RULE below, which is
    computed on the UNSTRIPPED ISS name and institution and on the unit's full
    trust-qualified CRSP name, so it bites whether or not a match came through a
    stripped form. See LEARNINGS.
    """
    tk = name.split(" ")
    while len(tk) > keep_min and tk[0] in stop_tokens:
        tk = tk[1:]
    return " ".join(tk)


_ns = unit_names["n_short"].to_list()
_nt = [set(x.split(" ")) if x else set() for x in unit_names["n_trust"].to_list()]
unit_names = unit_names.with_columns(
    n_nosponsor=pl.Series([strip_leading(a, b) for a, b in zip(_ns, _nt)]))
print(f"corpus names with a sponsor prefix stripped: "
      f"{(unit_names['n_nosponsor'] != unit_names['n_short']).sum():,} "
      f"(emitted ALONGSIDE the unstripped forms, never replacing them)")

corpus = pl.concat([
    unit_names.select("unit", n_raw=norm("b"), src=pl.lit("trust_fund")),
    unit_names.select("unit", n_raw=pl.col("n_short"), src=pl.lit("fund")),
    unit_names.filter(pl.col("n_nosponsor") != pl.col("n_short"))
    .select("unit", n_raw=pl.col("n_nosponsor"), src=pl.lit("fund_nosponsor")),
]).unique(subset=["unit", "n_raw"], keep="first")
# The family haystack is the unit's FULL trust-qualified name, so `family_agree`
# is the same no matter which corpus form won the match -- a sponsor-stripped
# form must not be able to hide the family from the cross-family rule.
unit_hay = (unit_names.select("unit", unit_hay=norm("b"))
            .group_by("unit").agg(unit_hay=pl.col("unit_hay").str.join(" ")))
# THE L3c CHANGE, corpus side. `n_raw` is L3b's string verbatim; `n_full` is the
# same string with a boundary at every alpha<->digit transition. Everything
# downstream -- TF-IDF, the `core` space, the digit guard -- runs on `n_full`.
# `c_desig` alone stays on `n_raw`: L2_DESIGNATOR_RE anchors on a trailing 1-2
# character code and splitting "2A" into "2 A" would break the anchor and let
# "Series 2A" match "Series 2B". `c_digits_raw` is kept only as a diagnostic, to
# isolate exactly which pairs this fix un-vetoed.
corpus = (
    corpus.with_columns(n_full=digit_split(pl.col("n_raw")))
    .with_columns(n_core=core(pl.col("n_full")))
    .with_columns(c_digits=digit_tokens(pl.col("n_full")),
                  c_digits_raw=digit_tokens(pl.col("n_raw")),
                  c_desig=designator(pl.col("n_raw")))
    .join(unit_agg, on="unit", how="left")
    .join(unit_hay, on="unit", how="left")
    .with_columns(mgmt_norm=norm("mgmt_name").fill_null(""),
                  unit_hay=pl.col("unit_hay").fill_null(""))
)
print(f"corpus rows                        : {corpus.height:,} "
      f"({corpus['n_full'].n_unique():,} distinct `full` names, "
      f"{corpus['n_core'].n_unique():,} distinct `core` names)")
_fused = corpus.filter(pl.col("n_full") != pl.col("n_raw"))
print(f"corpus names the digit split CHANGED: {_fused.height:,} "
      f"({_fused['unit'].n_unique():,} CRSP fund units) — e.g. "
      f"{_fused['n_raw'].to_list()[:1]} -> {_fused['n_full'].to_list()[:1]}")

# ---------------------------------------------------------------------------
# 4. ISS query forms
# ---------------------------------------------------------------------------
rule("ISS query forms")

q = todo.with_columns(
    # trust-qualified with a dash/colon: the tail segment is the fund, mirroring
    # the ":" split already applied to the CRSP side. Greedy `.+` takes the LAST
    # separator.
    fundname_tail=pl.col("fundname_modal").str.extract(L3B_TAIL_SEP_RE, 1),
    # a separate-account wrapper names the fund it actually holds in parens;
    # L2_PAREN_RE throws that away, which is backwards for a VA entry.
    fundname_paren=pl.when(pl.col("fundname_modal").str.contains(L3B_WRAPPER_RE))
    .then(pl.col("fundname_modal").str.extract(L2_PAREN_RE, 1)).otherwise(None),
).with_columns(
    family_inst=family_tokens("institutionname_modal"),
    f_name=norm("fundname_modal"),
).with_columns(
    f_lead_drop=drop_lead_code(pl.col("f_name"), 1),
    f_lead_drop2=drop_lead_code(pl.col("f_name"), L3B_LEAD_CODE_MAX),
    f_tail_segment=pl.when(pl.col("fundname_tail").is_not_null())
    .then(norm("fundname_tail")).otherwise(None),
    f_paren_underlying=pl.when(pl.col("fundname_paren").is_not_null())
    .then(norm("fundname_paren")).otherwise(None),
    inst_norm=norm("institutionname_modal"),
)
# The two family-token sources stay SEPARATE: institution tokens are firm names
# by construction, a fund-name token is only a family claim once corroborated
# against a firm name (see L3B_FAMILY_NAME_TOKEN_NEEDS_FIRM).
_nt = [t[0] if t else None for t in fundname_family_token(q["f_name"].to_list())]
q = q.rename({"family_inst": "family"}).with_columns(
    name_tok=pl.Series(_nt, dtype=pl.String))
q = q.with_columns(
    # plural-tolerant, same as every other family-token test: ISS's fund name
    # says PROSHARES and its institution name says PROSHARE.
    nt_in_inst=pl.when(pl.col("name_tok").is_null()).then(False).otherwise(
        pl.col("inst_norm").str.contains(
            fam_pat(pl.col("name_tok").fill_null("zzzz"),
                    L3B_FAMILY_NAME_TOKEN_MIN_CHARS))))
# The ISS side's OWN sponsor prefix ("MORGAN STANLEY S&P 500 INDEX FUND"),
# stripped symmetrically with the CRSP side and only with tokens that actually
# appear in the ISS institution name.
_fn = q["f_name"].to_list()
_it = [set(t for t in (x or "").split(" ") if len(t) >= 3)
       for x in q["inst_norm"].to_list()]
q = q.with_columns(
    f_sponsor_drop=pl.Series([strip_leading(a, b) for a, b in zip(_fn, _it)]))
# a derived form only exists as a form when it actually changed the string
for _f in ("lead_drop", "lead_drop2", "sponsor_drop"):
    q = q.with_columns(**{f"f_{_f}": pl.when(pl.col(f"f_{_f}") != pl.col("f_name"))
                          .then(pl.col(f"f_{_f}")).otherwise(None)})

q = q.with_columns(
    f_lead_drop2=pl.when(pl.col("f_lead_drop2") != pl.col("f_lead_drop").fill_null(""))
    .then(pl.col("f_lead_drop2")).otherwise(None))

qry = pl.concat([
    q.select("fundid", "institutionid", "family", "n_vote_rows", "first_year",
             "last_year", "fundname_modal", "institutionname_modal", "seriesid",
             "name_tok", "nt_in_inst",
             gap_form=pl.lit(f), n_raw=pl.col(f"f_{f}"))
    for f in ("name", "lead_drop", "lead_drop2", "sponsor_drop", "tail_segment",
              "paren_underlying")
], how="vertical").drop_nulls("n_raw")
# APPEND the ISS institution to the query string. CRSP `fund_name` already
# carries the family ("BlackRock Index Funds, Inc: BlackRock S&P 500 Index
# Fund"), so appending it to the ISS side makes the two comparable and folds
# family agreement into the similarity itself rather than bolting it on as a
# filter. Measured by the reviewer on the motivating pair: cross-family margin
# +0.319 -> +0.439, while the within-family margin only compresses +0.238 ->
# +0.143 (JPMorgan Insurance Trust Equity Index vs ...Small Cap Core), still far
# above the 0.02 bar. Both the bare and appended strings are matched; the bare
# score is retained because the exact-identity escape for adviser/succession
# mismatches has to be judged on the FUND NAME, not on a string that contains
# the very institution name that disagrees.
#
# THE L3c CHANGE, query side. The query forms are built from the RAW normalised
# name -- the leading internal-code strip has already run above, on the raw
# leading token, because splitting "2DBE" into "2 DBE" first would defeat
# L3B_LEAD_CODE_RE. Only now is the alpha<->digit boundary inserted, and from
# here on `n_full` IS the split string: TF-IDF, the `core` space, the digit
# guard and the token count all use it. `q_desig` alone stays on `n_raw`.
qry = (
    qry.with_columns(n_full=digit_split(pl.col("n_raw")))
    .with_columns(n_core=core(pl.col("n_full")),
                  inst_full=digit_split(norm("institutionname_modal")))
    .with_columns(inst_core=core(pl.col("inst_full")))
    .with_columns(
        n_full_app=pl.col("n_full") + pl.lit(" ") + pl.col("inst_full"),
        n_core_app=pl.col("n_core") + pl.lit(" ") + pl.col("inst_core"))
    # Guards and token counts are ALWAYS computed on the bare fund name: the
    # appended institution is context, not identity, and must not be able to
    # satisfy the digit guard or the distinctive-token rule on its own.
    .with_columns(q_digits=digit_tokens(pl.col("n_full")),
                  q_digits_raw=digit_tokens(pl.col("n_raw")),
                  q_desig=designator(pl.col("n_raw")),
                  q_bare=pl.col("n_full"))
)
print(qry.group_by("gap_form").agg(rows=pl.len(),
                                   fundids=pl.col("fundid").n_unique()).sort("rows",
                                                                             descending=True))
_qf = qry.filter(pl.col("n_full") != pl.col("n_raw"))
print(f"\nISS query names the digit split CHANGED: {_qf.height:,} "
      f"({_qf['fundid'].n_unique():,} fundids) — the ISS side usually already "
      f"separates its digits, so most of the work is on the CRSP side")

# ---------------------------------------------------------------------------
# 5. TF-IDF, once per name space
# ---------------------------------------------------------------------------
rule("TF-IDF candidate generation (two spaces)")

cands = []
for space, qvar in (("full", "bare"), ("core", "bare"),
                    ("full", "app"), ("core", "app")):
    qcol = f"n_{space}" + ("_app" if qvar == "app" else "")
    ccol = f"n_{space}"
    L = qry.filter(usable(pl.col(qcol)))
    R = corpus.filter(usable(pl.col(ccol))).with_columns(
        name_n_units=pl.col("unit").n_unique().over(ccol))
    ln, rn = L[qcol].to_list(), R[ccol].to_list()
    vec = TfidfVectorizer(analyzer=L2_TFIDF_ANALYZER, ngram_range=L2_TFIDF_NGRAM, min_df=1)
    vec.fit(ln + rn)
    M = sp_matmul_topn(vec.transform(ln), vec.transform(rn).T, top_n=L3B_TFIDF_TOP_K,
                       threshold=L3B_CAND_THRESHOLD, sort=True).tocoo()
    c = pl.DataFrame({"row": M.row.astype(np.int32), "col": M.col.astype(np.int32),
                      "score": M.data.astype(np.float64)})
    c = (
        c.join(L.with_row_index("row").with_columns(pl.col("row").cast(pl.Int32))
               .select("row", "fundid", "institutionid", "family", "name_tok",
                       "nt_in_inst", "n_vote_rows", "q_bare",
                       "first_year", "last_year", "fundname_modal",
                       "institutionname_modal", "seriesid", "gap_form",
                       "q_digits", "q_digits_raw", "q_desig", q_name=pl.col(qcol)),
               on="row", how="left")
        .join(R.with_row_index("col").with_columns(pl.col("col").cast(pl.Int32))
              .select("col", "unit", "src", "crsp_fund_name", "mgmt_cd", "mgmt_name",
                      "mgmt_norm", "crsp_last_year", "name_n_units", "c_digits",
                      "c_digits_raw", "c_desig", "n_full", "unit_hay",
                      c_name=pl.col(ccol)),
              on="col", how="left")
        .drop("row", "col").rename({"n_full": "c_full"})
        .with_columns(space=pl.lit(space), qvar=pl.lit(qvar))
    )
    print(f"space {space:4s} / query {qvar:4s}: {len(ln):,} query names x "
          f"{len(rn):,} corpus names -> {c.height:,} candidate pairs")
    cands.append(c)

cand = pl.concat(cands, how="vertical")

# --- guards ---------------------------------------------------------------
n0 = cand.height
cand = cand.filter(
    pl.col("crsp_last_year").is_null()
    | (pl.col("crsp_last_year") >= pl.col("first_year") - L3B_LIFESPAN_SLACK_YEARS))
print(f"dropped by the lifespan guard      : {n0 - cand.height:,}")

n0 = cand.height
cand = cand.with_columns(
    # THE FIX, at the point of use. `q_digits`/`c_digits` are the multisets of
    # the SPLIT strings, so "RUSSELL2000" no longer reads as one opaque
    # digit-bearing token; `*_raw` are L3b's multisets, kept to isolate exactly
    # which pairs the fix un-vetoed.
    digits_match=pl.col("q_digits") == pl.col("c_digits"),
    digits_match_raw=pl.col("q_digits_raw") == pl.col("c_digits_raw"),
    # ...but the DESIGNATOR guard stays on the unsplit string. Splitting "2A"
    # into "2 A" would break L2_DESIGNATOR_RE's trailing anchor and let
    # "Series 2A" match "Series 2B".
    desig_match=(pl.col("q_desig").is_null() & pl.col("c_desig").is_null())
    | (pl.col("q_desig") == pl.col("c_desig")),
).with_columns(
    digit_fusion=~pl.col("digits_match_raw") & pl.col("digits_match"))
n_dig = cand.filter(~pl.col("digits_match")).height
n_des = cand.filter(pl.col("digits_match") & ~pl.col("desig_match")).height
n_fus = cand.filter(pl.col("digit_fusion")).height
fusion_pairs = (
    cand.filter(pl.col("digit_fusion"))
    .select("fundid", "fundname_modal", "institutionname_modal", "n_vote_rows",
            "gap_form", "space", "q_name", "c_name", "crsp_fund_name", "mgmt_name",
            "q_digits_raw", "c_digits_raw", "q_digits", "score")
    .sort("score", descending=True)
    # CSV has no nested type; the digit multisets are the whole point of this
    # log, so they are flattened rather than dropped.
    .with_columns(pl.col("q_digits_raw", "c_digits_raw", "q_digits")
                  .list.join("|"))
)
cand = cand.filter(pl.col("digits_match") & pl.col("desig_match"))
print(f"dropped by the digit-token guard   : {n_dig:,} (Russell 2000 vs 1000); "
      f"by the series-designator guard: {n_des:,} — {n0 - cand.height:,} total")
print("  (the guard is evaluated on the QUERY FORM used, so a `lead_drop` match "
      "is not asked to find `6721` in the CRSP name — that is the exemption)")
print(f"\nL3c: candidate pairs the DIGIT SPLIT un-vetoed (L3b's guard rejected "
      f"them, this one does not): {n_fus:,} over "
      f"{fusion_pairs['fundid'].n_unique():,} fundids")
if fusion_pairs.height:
    pl.Config.set_fmt_str_lengths(44)
    print(fusion_pairs.head(15).select("fundname_modal", "crsp_fund_name",
                                       "q_digits_raw", "c_digits_raw", "q_digits",
                                       "score"))
    pl.Config.set_fmt_str_lengths(60)
fusion_pairs.write_csv(L3C_DIGIT_FUSION)

# ---------------------------------------------------------------------------
# VERIFY R — the guard's REAL purpose must still hold: Russell 2000 != 1000
# ---------------------------------------------------------------------------
rule("VERIFY R — regression: \"Russell 2000\" must still NOT match \"Russell 1000\"")

print("The digit guard exists because char-ngram cosine is nearly blind to "
      "digits. Relaxing it is exactly the thing that could break it, so the "
      "rejection is MEASURED here rather than argued: the score is shown (it is "
      "high — that is the point) and the guard is shown to veto anyway.\n")

_rvec = TfidfVectorizer(analyzer=L2_TFIDF_ANALYZER, ngram_range=L2_TFIDF_NGRAM,
                        min_df=1).fit(corpus["n_full"].to_list())


def _score(a, b):
    A, B = _rvec.transform(a), _rvec.transform(b)
    return np.asarray(A.multiply(B).sum(axis=1)).ravel()


# Both the WRONG cross-index pair and the RIGHT same-index pair, so the check
# shows the guard DISCRIMINATING rather than simply blocking everything. The
# right-hand partner of each pair is that ISS name's true CRSP counterpart,
# taken from `fund_summary2` by exact string.
_right_crsp = {
    "PROSHARES ULTRA RUSSELL 2000": "ProShares Trust: ProShares Ultra Russell2000",
    "PROSHARES ULTRA RUSSELL 2000 GROWTH":
        "ProShares Trust: ProShares Ultra Russell2000 Growth",
    "PROSHARES ULTRA RUSSELL 1000 VALUE":
        "ProShares Trust: ProShares Ultra Russell1000 Value",
}
reg = pl.concat([
    pl.DataFrame({"iss": [p[0] for p in L3C_REGRESSION_PAIRS],
                  "crsp": [p[1] for p in L3C_REGRESSION_PAIRS],
                  "kind": ["cross_index_WRONG"] * len(L3C_REGRESSION_PAIRS)}),
    pl.DataFrame({"iss": [p[0] for p in L3C_REGRESSION_PAIRS],
                  "crsp": [_right_crsp[p[0]] for p in L3C_REGRESSION_PAIRS],
                  "kind": ["same_index_RIGHT"] * len(L3C_REGRESSION_PAIRS)}),
])
reg = (
    reg# split the trust prefix off the RAW string: norm() turns ":" into a
    # space, so splitting AFTER normalising silently compares against the
    # trust-qualified name and understates the score.
    .with_columns(crsp_fund=pl.col("crsp").str.split(":").list.last())
    .with_columns(q=norm("iss"), c=norm("crsp_fund"))
    .with_columns(qs=digit_split(pl.col("q")), cs=digit_split(pl.col("c")))
    .with_columns(q_dig=digit_tokens(pl.col("qs")), c_dig=digit_tokens(pl.col("cs")))
    .with_columns(guard_passes=pl.col("q_dig") == pl.col("c_dig"))
)
reg = reg.with_columns(
    score_L3b=pl.Series(_score(reg["q"].to_list(), reg["c"].to_list())),
    score_L3c=pl.Series(_score(reg["qs"].to_list(), reg["cs"].to_list())),
).with_columns(
    accepted=pl.col("guard_passes") & (pl.col("score_L3c") >= L3B_SCOPED_THRESH))
for r in reg.iter_rows(named=True):
    print(f"  [{r['kind']}]")
    print(f"    ISS  {r['iss']}")
    print(f"    CRSP {r['crsp']}")
    print(f"    char-ngram score: L3b(unsplit) {r['score_L3b']:.4f}  "
          f"L3c(split) {r['score_L3c']:.4f}   (bar is {L3B_SCOPED_THRESH})")
    print(f"    digit tokens {r['q_dig']} vs {r['c_dig']} -> guard "
          f"{'PASSES' if r['guard_passes'] else 'VETOES'}"
          f"  =>  {'ACCEPTED' if r['accepted'] else 'REJECTED'}\n")
reg.select("kind", "iss", "crsp", "guard_passes", "score_L3b", "score_L3c",
           "accepted", q_dig=pl.col("q_dig").list.join("|"),
           c_dig=pl.col("c_dig").list.join("|")).write_csv(L3C_REGRESSION)

_wrong = reg.filter(pl.col("kind") == "cross_index_WRONG")
_right = reg.filter(pl.col("kind") == "same_index_RIGHT")
assert not _wrong["guard_passes"].any(), \
    "REGRESSION FAILURE: the digit guard let a Russell 2000/1000 cross-pair through"
assert not _wrong["accepted"].any(), "REGRESSION FAILURE: a cross-index pair accepted"
assert _right["guard_passes"].all(), \
    "REGRESSION FAILURE: the digit guard vetoes the CORRECT same-index pair"
print(f"  PASS — all {_wrong.height} cross-index pairs vetoed by the digit guard "
      f"despite scoring up to {_wrong['score_L3c'].max():.4f}; all "
      f"{_right.height} same-index pairs pass it.")

# ...and the same claim tested against the LIVE candidate set: no surviving
# candidate may pair an ISS Russell-N name with a CRSP Russell-M name, M != N.
_rus = cand.filter(pl.col("q_bare").str.contains(r"\bRUSSELL\b")
                   & pl.col("c_name").str.contains(r"\bRUSSELL\b"))
_rus = _rus.with_columns(
    q_idx=pl.col("q_bare").str.extract(r"RUSSELL (\d{3,4})", 1),
    c_idx=pl.col("c_name").str.extract(r"RUSSELL (\d{3,4})", 1))
_bad = _rus.filter(pl.col("q_idx").is_not_null() & pl.col("c_idx").is_not_null()
                   & (pl.col("q_idx") != pl.col("c_idx")))
print(f"  live check: {_rus.height:,} surviving Russell-vs-Russell candidate "
      f"pairs, of which {_bad.height} cross a different index number")
assert _bad.height == 0, "REGRESSION FAILURE: a live Russell cross-index pair survived"

# family_agree: ANY distinctive token of the ISS institution name found in the
# CRSP management-company name or in the CRSP fund's own trust-qualified name.
cand = cand.with_row_index("cid").with_columns(
    q_ntok=n_tokens(pl.col("q_bare")),
    # tokens of the matched name that are NOT strategy/structural words
    q_ndistinct=pl.col("q_bare").str.split(" ").list.eval(
        pl.element().filter(~pl.element().is_in(sorted(FAMILY_STOP)))).list.len(),
    mgmt_scope=pl.lit(False))

# ---------------------------------------------------------------------------
# VERIFY P — the plural fold must NOT reopen the substring hole
# ---------------------------------------------------------------------------
rule("VERIFY P — plural fold: MUTUAL still must not bridge to MASSMUTUAL")

_pv = pl.DataFrame({
    "tok": ["MUTUAL", "MUTUAL", "PROSHARE", "PROSHARES", "MELLON", "YORK"],
    "hay": ["MASSMUTUAL PREMIER SMALL CAPITALIZATION VALUE FUND",
            "MUTUAL SERIES FUND INC",
            "PROFUNDS GROUP PROSHARES TRUST PROSHARES ULTRA RUSSELL 2000 GROWTH",
            "PROSHARE ADVISORS",
            "MASSMUTUAL SELECT MELLON",
            "NEW YORKER FUNDS"],
    "want": [False, True, True, True, True, False],
}).with_columns(hit=pl.col("hay").str.contains(fam_pat(pl.col("tok"), 4)))
print(_pv)
assert (_pv["hit"] == _pv["want"]).all(), \
    "VERIFY P FAILURE: the plural fold changed a family-token verdict it must not"
print("  PASS — the plural fold crosses PROSHARE/PROSHARES and nothing else; "
      "MUTUAL still does not reach MASSMUTUAL and YORK still does not reach "
      "YORKER.")

_fa = (
    cand.select("cid", "family",
                hay=pl.col("mgmt_norm") + pl.lit(" ") + pl.col("unit_hay"))
    .explode("family").drop_nulls("family")
    # word boundaries, NOT substring: "MUTUAL" must not bridge to "MASSMUTUAL";
    # tolerant of a plural S on either side (fam_pat), which is what lets ISS's
    # "ProShare" reach CRSP's "ProShares".
    .filter(pl.col("hay").str.contains(
        fam_pat(pl.col("family"), L3B_FAMILY_MIN_CHARS),
        literal=not L3B_FAMILY_WORD_BOUNDARY))
    .select("cid").unique()
)
_NT = pl.col("name_tok").fill_null("\u0000nomatch")
_NTPAT = fam_pat(_NT, L3B_FAMILY_NAME_TOKEN_MIN_CHARS)
cand = cand.with_columns(
    strong_hit=pl.col("cid").is_in(_fa["cid"]),
    # a fund-name token is a family token only once some FIRM is called that:
    # the CRSP management company, or the ISS institution
    nt_in_mgmt=pl.col("name_tok").is_not_null()
    & pl.col("mgmt_norm").str.contains(_NTPAT),
    nt_in_hay=pl.col("name_tok").is_not_null()
    & (pl.col("mgmt_norm") + pl.lit(" ") + pl.col("unit_hay")).str.contains(_NTPAT),
).drop("cid")
cand = cand.with_columns(
    nt_is_family=pl.col("nt_in_mgmt") | (pl.col("nt_in_inst") & pl.col("nt_in_hay"))
    if L3B_FAMILY_NAME_TOKEN_NEEDS_FIRM
    else pl.col("name_tok").is_not_null())
cand = cand.with_columns(
    family_agree=pl.col("strong_hit")
    | (pl.col("nt_is_family") & pl.col("nt_in_hay")),
    has_family_token=(pl.col("family").list.len() > 0) | pl.col("nt_is_family"),
)
print(f"candidates with a family bridge    : {cand['family_agree'].sum():,} / "
      f"{cand.height:,}")

# ---------------------------------------------------------------------------
# 6. institution -> mgmt_cd scope, seeded from EXACT tiers only
# ---------------------------------------------------------------------------
rule("scope: institution -> CRSP management company")

fundid2inst = base.select("fundid").join(fund.select("fundid", "institutionid"),
                                         on="fundid", how="left")
fno2mgmt = fs.select("crsp_fundno", "mgmt_cd").drop_nulls()
exact_linked = (
    base.filter(pl.col("crsp_match_tier").is_in(list(L3B_EXACT_TIERS)))
    .select("fundid", "crsp_fundno").join(fno2mgmt, on="crsp_fundno", how="left")
)
print(f"fundids linked by an EXACT tier    : {exact_linked.height:,} "
      f"(scope is seeded from these only — seeding it from fuzzy links would "
      f"make the scope circular with the thing it gates)")


def build_inst_mgmt(pairs):
    """institutionid -> the CRSP mgmt_cds its already-linked funds sit under.

    A mgmt_cd must carry at least L3B_SCOPE_MIN_SHARE of the institution's
    linked siblings. Three of BlackRock's 823 siblings sit under Allspring's
    code (legacy funds CRSP files under their acquirer), and without the share
    floor those three let a BlackRock master match an Allspring fund at 1.00.
    """
    d = (pairs.join(fundid2inst, on="fundid", how="left")
         .select("institutionid", "mgmt_cd").drop_nulls())
    return (d.group_by(["institutionid", "mgmt_cd"]).agg(n=pl.len())
            .with_columns(share=pl.col("n") / pl.col("n").sum().over("institutionid"))
            .filter(pl.col("share") >= L3B_SCOPE_MIN_SHARE)
            .select("institutionid", "mgmt_cd"))


inst_mgmt = build_inst_mgmt(exact_linked.select("fundid", "mgmt_cd"))
print(f"institution -> mgmt_cd pairs       : {inst_mgmt.height:,} "
      f"({inst_mgmt['institutionid'].n_unique():,} institutions)")
cov = todo.join(fund.select("fundid", "institutionid"), on="fundid", how="left") \
          .join(inst_mgmt.select("institutionid").unique(), on="institutionid", how="semi")
print(f"target fundids whose institution has a scope: {cov.height:,} "
      f"({cov['n_vote_rows'].sum():,} vote rows)")


# ---------------------------------------------------------------------------
# 6a. collapse the bare and appended passes: SELECT on the appended score,
#     RETAIN the bare-name score for the exact-identity escape
# ---------------------------------------------------------------------------
rule("bare vs appended-institution scores")

# Per (fundid, CRSP unit) keep BOTH scores and select on the MAX.
#
# MEASURED, and it is why neither signal can be used alone. Appending the
# institution shifts the whole distribution DOWN ~0.10 (q50 0.574 -> 0.472,
# q95 0.845 -> 0.728), because the ISS institution string and the CRSP trust
# string are different renderings of the same family ("John Hancock Funds, LLC"
# vs "John Hancock Funds II: ...") and char-ngram cosine is length-weighted, so
# the appended segment adds noise in proportion to its length and drowns a short
# fund name. Selecting on the appended score alone yields 122 fundids / 473K
# vote rows against 221 / 740K on the bare name -- it loses two thirds of the
# tier. But the appended score is exactly what RESCUES the master-feeder case
# the tier exists for, where the ISS master name has no sponsor and the CRSP
# feeder name does ("S&P 500 Index Master Portfolio" vs "BlackRock S&P 500 Index
# Fund" is 0.66 bare and far higher appended).
#
# The two signals are complementary, not substitutes: bare wins where ISS
# already carries the family, appended wins where only CRSP does. Taking the max
# keeps both and dilutes neither, and the cross-family rule below is what stops
# the max from being a licence -- a family-disagreeing pair still needs a bare
# NAME identity.
_agg = (cand.group_by(["fundid", "unit"]).agg(
    score_app=pl.col("score").filter(pl.col("qvar") == "app").max(),
    score_name=pl.col("score").filter(pl.col("qvar") == "bare").max())
    .with_columns(pl.col("score_app").fill_null(0.0),
                  pl.col("score_name").fill_null(0.0))
    .with_columns(score_max=pl.max_horizontal("score_app", "score_name")))
_n_bare, _n_app = (cand.filter(pl.col("qvar") == "bare").height,
                   cand.filter(pl.col("qvar") == "app").height)
# representative row per (fundid, unit) = its best-scoring pass
cand = (cand.sort(["fundid", "unit", "score"], descending=[False, False, True])
        .unique(subset=["fundid", "unit"], keep="first", maintain_order=True)
        .join(_agg, on=["fundid", "unit"], how="left")
        .drop("score").rename({"score_max": "score"}))
print(f"candidate pairs: {_n_bare:,} bare + {_n_app:,} appended -> "
      f"{cand.height:,} distinct (fundid, CRSP fund) pairs, scored on the max")
_both = cand.filter((pl.col("score_name") > 0) & (pl.col("score_app") > 0))
print(f"\nscore distribution, on the {_both.height:,} pairs scored by both passes:")
for _x in (0.5, 0.75, 0.9, 0.95, 0.99):
    print(f"  q{int(_x * 100):<3} bare {_both['score_name'].quantile(_x):.4f}  "
          f"appended {_both['score_app'].quantile(_x):.4f}  "
          f"delta {_both['score_app'].quantile(_x) - _both['score_name'].quantile(_x):+.4f}")
print(f"pairs where the APPENDED score is the higher of the two: "
      f"{cand.filter(pl.col('score_app') > pl.col('score_name')).height:,} "
      f"({cand.filter((pl.col('score_app') > pl.col('score_name')) & (pl.col('score') >= 0.9)).height:,} of them >= 0.90)")

# ---------------------------------------------------------------------------
# 6b. the CROSS-FAMILY RULE (applied to CANDIDATES, not to winners)
# ---------------------------------------------------------------------------
rule("cross-family rule")

# The ID-based succession evidence: what share of THIS institution's
# exact-tier-linked siblings sit under THIS management company. Built from
# seriesId/ticker links only, so the name matcher cannot manufacture it.
inst_mgmt_share = (
    exact_linked.join(fundid2inst, on="fundid", how="left")
    .select("institutionid", "mgmt_cd").drop_nulls()
    .group_by(["institutionid", "mgmt_cd"]).agg(n_sib=pl.len())
    .with_columns(mgmt_share=pl.col("n_sib") / pl.col("n_sib").sum()
                  .over("institutionid"))
)
cand = cand.join(inst_mgmt_share, on=["institutionid", "mgmt_cd"], how="left") \
           .with_columns(mgmt_share=pl.col("mgmt_share").fill_null(0.0),
                         n_sib=pl.col("n_sib").fill_null(0))

if L3B_FAMILY_GATE:
    # A master portfolio's feeder is in the same family by construction, so a
    # sub-identity fuzzy match across families has no structural justification.
    # An EXACT name identity across nominally different advisers usually does:
    # an adviser subsidiary (Boston Management and Research -> Eaton Vance) or a
    # succession (Reich & Tang's California Investment Trust -> Shelton). The
    # identity is judged on the BARE fund name, never on the appended string,
    # which contains the institution name that disagrees.
    #
    # Applied to CANDIDATES, before the top-1 is chosen, so a rejected candidate
    # cannot crowd out a correct in-family one -- measured: "2DBR Mid Cap Value
    # Equity Fund" matched "John Hancock Value Equity Fund" (wrong sibling) under
    # winner-level filtering and matches "John Hancock Funds II: Mid Cap Value
    # Equity Fund" (right) under candidate-level.
    cand = cand.with_columns(
        family_gate=pl.when(~pl.col("has_family_token")).then(pl.lit("no_family_token"))
        .when(pl.col("family_agree")).then(pl.lit("direct"))
        # An exact bare-name identity is necessary but NOT sufficient across
        # families: MEASURED on the 53 survivors of the identity-only rule, the
        # wrong ones cluster at low scope support -- MFS/Sun Life High Yield ->
        # Victory High Yield (0.05), DSM Large Cap Growth -> Voya (0.07), RCB
        # Small Cap Value -> SEI (0.11) -- while the genuine subsidiary and
        # succession cases sit at 0.28-1.00 (Eaton Vance 1.00, Gartmore 1.00,
        # Shelton 0.88, Allspring 0.80, Guggenheim 0.72, Virtus 0.61, State
        # Street 0.50). So the ID-based attestation is required as well.
        .when((pl.col("score_name") >= L3B_EXACT_NAME_IDENTITY)
              & (pl.col("mgmt_share") >= L3B_SUCCESSION_MIN_SHARE))
        .then(pl.lit(L3B_FAMILY_MISMATCH_FLAG))
        .otherwise(pl.lit("cross_family")))
    n0 = cand.height
    vetoed = cand.filter(pl.col("family_gate") == "cross_family")
    cand = cand.filter(pl.col("family_gate") != "cross_family")
    print(f"candidate pairs rejected as cross-family below name identity: "
          f"{n0 - cand.height:,} of {n0:,} ({vetoed['fundid'].n_unique():,} fundids "
          f"affected)")
    print(cand.group_by("family_gate").agg(candidates=pl.len(),
                                           fundids=pl.col("fundid").n_unique())
          .sort("candidates", descending=True))
else:
    cand = cand.with_columns(family_gate=pl.lit("gate_off"))


def with_scope(df, im):
    return df.drop("mgmt_scope", strict=False).join(
        im.with_columns(mgmt_scope=pl.lit(True)), on=["institutionid", "mgmt_cd"],
        how="left").with_columns(mgmt_scope=pl.col("mgmt_scope").fill_null(False))


def best(df, mask, thresh):
    """Top-scoring in-scope candidate per fundid, with the top-2 UNIT margin.

    Collapsed to the best row per (fundid, unit) first: one fundid can reach the
    same CRSP fund through several query forms / spaces and that is agreement,
    not ambiguity. The margin is then taken across DISTINCT CRSP funds, which is
    the ambiguity that matters — L3 measured that within a family the top-1 is
    systematically the wrong sibling, and a near-tie is exactly that case.
    """
    sub = (
        df.filter(mask & (pl.col("score") >= thresh))
        .sort(["fundid", "score", "family_agree", "crsp_last_year", "unit"],
              descending=[False, True, True, True, False])
        .unique(subset=["fundid", "unit"], keep="first", maintain_order=True)
    )
    top = sub.group_by("fundid").head(1)
    second = (
        sub.join(top.select("fundid", top_unit="unit"), on="fundid", how="left")
        .filter(pl.col("unit") != pl.col("top_unit"))
        .group_by("fundid").agg(score2=pl.col("score").max(),
                                n_rivals=pl.len())
    )
    return (
        top.join(second, on="fundid", how="left")
        .with_columns(score2=pl.col("score2").fill_null(0.0),
                      n_rivals=pl.col("n_rivals").fill_null(0))
        .with_columns(margin=pl.col("score") - pl.col("score2"))
    )


# ---------------------------------------------------------------------------
# 7. accept
# ---------------------------------------------------------------------------
rule(f"tier {L3C_TIER} — accept")

print("""ACCEPT RULES — each clause is here because a hand audit measured the
failure it prevents. Two audit rounds; both are recorded in LEARNINGS.

 ROUND 1 (score bar 0.90, L2's accept logic reused verbatim): 6 of 20 correct.
  - The `core` space deletes FUND/PORTFOLIO/TRUST/SERIES on purpose, so short
    generic names collapse ("Small Company Fund" -> "SMALL FUND"). L2's unscoped
    second signal, "this name maps to exactly ONE corpus unit", INVERTS there: a
    real fund name ("US LARGE CAP VALUE") is shared by many units and is
    rejected, while a degenerate one that happens to be unique sails through.
    -> the score-only path is REMOVED, and a matched name must carry >= %d
       tokens (>= %d unscoped; >= %d only with scope AND family AND >= %.2f).
  - `family_agree` used the FIRST institution token after the stopwords: "JOHN"
    for John Hancock, "RS" for RS Investment Management.
    -> every institution token >= %d chars now counts (HANCOCK, DIMENSIONAL).

 ROUND 2 (those fixed, bar still 0.90): ~60%% correct, and EVERY error was the
 same shape -- right family, wrong sibling ("Preferred Income II" -> "Preferred
 Income ETF", "Small Company Value" -> "Small Cap Value") -- scoring 0.907-0.923
 while essentially every correct match scored >= 0.97.
    -> the bar is 0.97. This tier claims a master's name IS its feeder's name
       once structural words and the sponsor prefix are removed; that is an
       IDENTITY claim, so it is held to identity.

 scoped   : in the institution's CRSP management scope, score >= %.2f, margin
            >= %.3f over the runner-up CRSP FUND.
 unscoped : score >= %.2f, margin >= %.2f, AND a family bridge. No score-only path.
""" % (L3B_MIN_MATCH_TOKENS, L3B_MIN_MATCH_TOKENS_GLOBAL,
       L3B_MIN_MATCH_TOKENS_STRICT, L3B_STRICT_TOKEN_SCORE,
       L3B_FAMILY_MIN_CHARS, L3B_SCOPED_THRESH, L3B_SCOPED_MARGIN,
       L3B_GLOBAL_THRESH, L3B_GLOBAL_MARGIN))

# Threshold calibration: appending the institution shifts the whole score
# distribution, so a bar calibrated on bare fund names does not transfer.
print("\ncandidate winners available at each appended-score bar "
      "(in-scope top-1 per fundid, before the margin/token rules):")
_cal = best(with_scope(cand, inst_mgmt), pl.col("mgmt_scope"), 0.0)
print("      appended-score bar ->      0.80     0.85     0.90     0.95")
for _b in (0.00, 0.80, 0.90, 0.95, 0.97, 0.999):
    _row = f"  bare-name >= {_b:.3f}:  "
    for _t in (0.80, 0.85, 0.90, 0.95):
        _c = _cal.filter((pl.col("score") >= _t) & (pl.col("score_name") >= _b))
        _row += f"{_c.height:>4}f/{_c['n_vote_rows'].sum() // 1000:>5}k "
    print(_row)
print("  (fundids / thousands of vote rows available at each joint bar; the "
      "APPENDED score carries family agreement, the BARE score carries fund "
      "identity -- round 2 measured the 0.90-0.97 bare band as systematically "
      "the wrong sibling of the right family, so both bars are needed)")

print("\n  the motivating family, PROSHARES ULTRA RUSSELL — the funds the digit "
      "guard was vetoing:")
_bl = _cal.filter(pl.col("fundname_modal").str.to_uppercase()
                  .str.contains("PROSHARES ULTRA RUSSELL"))
if _bl.height:
    for _r in _bl.sort("n_vote_rows", descending=True).iter_rows(named=True):
        print(f"    {_r['fundname_modal']}\n      -> {_r['crsp_fund_name']}")
        print(f"         appended {_r['score']:.4f}  bare {_r['score_name']:.4f}  "
              f"margin {_r['margin']:.4f}  family_agree={_r['family_agree']}")
else:
    print("    no in-scope candidate at all")

accepted, g_all = [], None
remaining = set(todo["fundid"].to_list())
rej_log = []
for i in range(L3B_SCOPE_PASSES):
    sc = best(with_scope(cand.filter(pl.col("fundid").is_in(list(remaining))), inst_mgmt),
              pl.col("mgmt_scope"), L3B_SCOPED_THRESH)
    sc = sc.with_columns(
        ok_margin=pl.col("margin") >= L3B_SCOPED_MARGIN,
        ok_tokens=(pl.col("q_ntok") >= L3B_MIN_MATCH_TOKENS)
        | ((pl.col("q_ntok") >= L3B_MIN_MATCH_TOKENS_STRICT)
           & pl.col("family_agree") & (pl.col("score") >= L3B_STRICT_TOKEN_SCORE)))
    n_tie = sc.filter(~pl.col("ok_margin")).height
    n_tok = sc.filter(pl.col("ok_margin") & ~pl.col("ok_tokens")).height
    rej_log.append(sc.filter(~(pl.col("ok_margin") & pl.col("ok_tokens")))
                   .with_columns(reject_reason=pl.when(~pl.col("ok_margin"))
                                 .then(pl.lit("sibling near-tie in scope"))
                                 .otherwise(pl.lit("query name too generic"))))
    scoped = sc.filter(pl.col("ok_margin") & pl.col("ok_tokens")).drop(
        "ok_margin", "ok_tokens").with_columns(
        crsp_match_tier=pl.lit(L3C_TIER), accept_path=pl.lit("scoped"))
    accepted.append(scoped)
    remaining -= set(scoped["fundid"].to_list())
    print(f"pass {i + 1} scoped   (>= {L3B_SCOPED_THRESH}): {scoped.height:,} accepted, "
          f"{scoped['n_vote_rows'].sum():,} vote rows  "
          f"[rejected: {n_tie:,} sibling near-tie, {n_tok:,} too generic]")

    g_all = best(cand.filter(pl.col("fundid").is_in(list(remaining))), pl.lit(True),
                 L3B_GLOBAL_THRESH)
    g_all = g_all.with_columns(
        ok_margin=pl.col("margin") >= L3B_GLOBAL_MARGIN,
        ok_tokens=pl.col("q_ntok") >= L3B_MIN_MATCH_TOKENS_GLOBAL,
        ok_family=pl.col("family_agree"))
    g_all = g_all.with_columns(
        accept=pl.col("ok_margin") & pl.col("ok_tokens") & pl.col("ok_family"))
    rej_log.append(g_all.filter(~pl.col("accept")).with_columns(
        reject_reason=pl.when(~pl.col("ok_family")).then(pl.lit("no family bridge"))
        .when(~pl.col("ok_margin")).then(pl.lit("ambiguous top-1"))
        .otherwise(pl.lit("query name too generic"))).drop("accept"))
    glob = g_all.filter(pl.col("accept")).drop(
        "accept", "ok_margin", "ok_tokens", "ok_family").with_columns(
        crsp_match_tier=pl.lit(L3C_TIER), accept_path=pl.lit("unscoped"))
    accepted.append(glob)
    remaining -= set(glob["fundid"].to_list())
    print(f"pass {i + 1} unscoped (>= {L3B_GLOBAL_THRESH}): {glob.height:,} accepted, "
          f"{glob['n_vote_rows'].sum():,} vote rows  [rejected: "
          f"{g_all.filter(~pl.col('ok_family')).height:,} no family bridge, "
          f"{g_all.filter(pl.col('ok_family') & ~pl.col('ok_margin')).height:,} ambiguous, "
          f"{g_all.filter(pl.col('ok_family') & pl.col('ok_margin') & ~pl.col('ok_tokens')).height:,} too generic]")

    if i + 1 < L3B_SCOPE_PASSES:
        # Only the UNSCOPED pass can reveal a new management company.
        inst_mgmt = build_inst_mgmt(pl.concat(
            [exact_linked.select("fundid", "mgmt_cd"),
             glob.select("fundid", "mgmt_cd")], how="vertical_relaxed"))

cand = with_scope(cand, inst_mgmt)  # so the candidate log carries the real flag

# --- watchlist: the named targets, and what happened to each ---
rule("watchlist — the funds this tier was pointed at, and what happened")
acc_ids = set(pl.concat(accepted, how="diagonal_relaxed")["fundid"].to_list())
WATCH_RE = (r"(?i)PROSHARES ULTRA RUSSELL|SEASONS SERIES|MUTUAL OF AMERICA|"
            r"INVESTMENT CORPORATION|CAPSTONE|GE INSTITUTIONAL")
watch = (todo.filter(pl.col("fundname_modal").str.contains(WATCH_RE)
                     | pl.col("institutionname_modal").str.contains(WATCH_RE))
         .sort("n_vote_rows", descending=True).head(20))
for row in watch.iter_rows(named=True):
    f = row["fundid"]
    top = (cand.filter(pl.col("fundid") == f)
           .sort(["mgmt_scope", "score"], descending=[True, True]).head(1))
    verdict = "ACCEPTED" if f in acc_ids else "not matched"
    print(f"\n  {row['fundname_modal'][:70]}  ({row['n_vote_rows']:,} rows) "
          f"[{row['institutionname_modal'][:40]}] -> {verdict}")
    if top.height:
        t = top.to_dicts()[0]
        print(f"    best candidate: {str(t['crsp_fund_name'])[:70]}")
        print(f"    score {t['score']:.4f}  bare {t['score_name']:.4f}  "
              f"scope={t['mgmt_scope']}  family={t['family_agree']}  "
              f"ntok={t['q_ntok']}  form={t['gap_form']}/{t['space']}  "
              f"fusion={t['digit_fusion']}")
    else:
        print("    no candidate over the 0.30 generation threshold at all")

fuzzy = pl.concat(accepted, how="diagonal_relaxed")
assert fuzzy["fundid"].n_unique() == fuzzy.height, "a fundid was accepted twice"
fuzzy = fuzzy.join(
    unit_agg.select("unit", "crsp_fundno", "index_fund_flag", "tna_latest", "wficn",
                    "n_crsp_classes"),
    on="unit", how="left").rename({"score": "crsp_match_score"})
_fus_acc = fuzzy.filter(pl.col("digit_fusion"))
print(f"\nTOTAL accepted                     : {fuzzy.height:,} fundids, "
      f"{fuzzy['n_vote_rows'].sum():,} vote rows "
      f"({fuzzy['n_vote_rows'].sum() / TOTAL_ROWS:.2%} of the panel)")
print(f"  of which the DIGIT SPLIT is what un-vetoed the winning pair: "
      f"{_fus_acc.height:,} fundids, {_fus_acc['n_vote_rows'].sum():,} vote rows "
      f"— the rest are pairs whose SCORE the split lifted over the bar, or that "
      f"the shifted idf weights moved")
print(fuzzy.group_by("accept_path", "gap_form", "space").agg(
    fundids=pl.len(), vote_rows=pl.col("n_vote_rows").sum()).sort("vote_rows",
                                                                  descending=True))

# ---------------------------------------------------------------------------
# 8. merge into the master IN PLACE — fill nulls only, never overwrite
# ---------------------------------------------------------------------------
rule("updating npx_crsp_link in place")

new = fuzzy.select(
    "fundid", nf_crsp_fundno="crsp_fundno", nf_wficn="wficn",
    nf_index_fund_flag="index_fund_flag", nf_tna_latest="tna_latest",
    nf_n_crsp_classes="n_crsp_classes", nf_tier="crsp_match_tier",
    nf_score="crsp_match_score")
assert base.join(new.select("fundid"), on="fundid", how="semi")["crsp_fundno"] \
    .null_count() == new.height, "L3c tried to overwrite an existing link"

IDX_MAP = {"D": "index", "B": "passive", "E": "passive"}
out = (
    base.join(new, on="fundid", how="left")
    .with_columns(
        l3b_new=pl.col("nf_crsp_fundno").is_not_null(),
        crsp_fundno=pl.coalesce("crsp_fundno", "nf_crsp_fundno"),
        wficn=pl.coalesce("wficn", "nf_wficn"),
        index_fund_flag=pl.coalesce("index_fund_flag", "nf_index_fund_flag"),
        tna_latest=pl.coalesce("tna_latest", "nf_tna_latest"),
        n_crsp_classes=pl.coalesce("n_crsp_classes", "nf_n_crsp_classes"),
        crsp_match_tier=pl.when(pl.col("nf_tier").is_not_null()).then(pl.col("nf_tier"))
        .otherwise(pl.col("crsp_match_tier")),
        crsp_match_score=pl.coalesce("crsp_match_score", "nf_score"),
    )
    # block/block_source are recomputed ONLY for the rows this tier filled; every
    # other row keeps L3's answer byte-for-byte.
    .with_columns(
        block=pl.when(~pl.col("l3b_new")).then(pl.col("block"))
        .when(pl.col("index_fund_flag") == "D").then(pl.lit("index"))
        .when(pl.col("index_fund_flag").is_in(["B", "E"])).then(pl.lit("passive"))
        .otherwise(pl.lit("active")),
        block_source=pl.when(~pl.col("l3b_new")).then(pl.col("block_source"))
        .when(pl.col("index_fund_flag").is_not_null()).then(pl.lit("crsp_flag"))
        .otherwise(pl.lit("crsp_active")),
    )
)
changes = (
    out.filter(pl.col("l3b_new"))
    .join(base.select("fundid", old_block="block", old_source="block_source"),
          on="fundid", how="left")
    .filter(pl.col("block") != pl.col("old_block"))
    .select("fundid", "fundname_modal", "institutionname_modal", "n_vote_rows",
            "old_block", "old_source", "block", "block_source", "index_fund_flag",
            "tna_latest", "crsp_match_score")
    .sort("n_vote_rows", descending=True)
)
out = out.drop([c for c in out.columns if c.startswith("nf_")] + ["l3b_new"])
out = out.select(BASE_COLS).sort("fundid")

assert out.height == N_FUNDIDS, f"row count changed: {out.height} != {N_FUNDIDS}"
assert out["fundid"].n_unique() == out.height, "fundid not unique after the update"
assert out.columns == BASE_COLS, "column set or order changed"
assert out.filter(pl.col("iss_nonregistrant"))["crsp_fundno"].null_count() == \
    out.filter(pl.col("iss_nonregistrant")).height, "a non-registrant gained a link"
# every pre-existing link is untouched
chk = base.filter(pl.col("crsp_fundno").is_not_null()).select(
    "fundid", "crsp_fundno", "crsp_match_tier", "index_fund_flag", "tna_latest",
    "block", "block_source").join(
    out.select("fundid", n_fundno="crsp_fundno", n_tier="crsp_match_tier",
               n_flag="index_fund_flag", n_tna="tna_latest", n_block="block",
               n_src="block_source"), on="fundid", how="inner")
assert chk.filter((pl.col("crsp_fundno") != pl.col("n_fundno"))
                  | (pl.col("crsp_match_tier") != pl.col("n_tier"))
                  | (pl.col("block") != pl.col("n_block"))
                  | (pl.col("block_source") != pl.col("n_src"))).height == 0, \
    "an existing link was modified"
print(f"pre-existing links preserved       : {chk.height:,} / {chk.height:,}")

out.write_parquet(NPX_CRSP_LINK, compression=PARQUET_COMPRESSION)
print(f"wrote {NPX_CRSP_LINK} — {out.height:,} rows x {out.width} cols")

# ---------------------------------------------------------------------------
# 9. VERIFY 1 — coverage before vs after, by year
# ---------------------------------------------------------------------------
rule("VERIFY 1 — vote-row coverage of crsp_fundno, before vs after")

fy = (
    pl.scan_parquet(NPX_SERIESID)
    .select("fundid", year=pl.col("meetingdate").dt.year())
    .group_by(["fundid", "year"]).agg(n=pl.len())
    .collect(engine="streaming")
    .filter(pl.col("year").is_between(SAMPLE_START, SAMPLE_END))
)
fy = fy.join(
    base.select("fundid", "iss_nonregistrant", old_fno=pl.col("crsp_fundno")),
    on="fundid", how="left").join(
    out.select("fundid", new_fno=pl.col("crsp_fundno")), on="fundid", how="left")

byyear = (
    fy.group_by("year").agg(
        rows=pl.col("n").sum(),
        rows_before=pl.col("n").filter(pl.col("old_fno").is_not_null()).sum(),
        rows_after=pl.col("n").filter(pl.col("new_fno").is_not_null()).sum(),
        rows_reg=pl.col("n").filter(~pl.col("iss_nonregistrant").fill_null(False)).sum(),
        rows_reg_before=pl.col("n").filter(pl.col("old_fno").is_not_null()
                                           & ~pl.col("iss_nonregistrant").fill_null(False)).sum(),
        rows_reg_after=pl.col("n").filter(pl.col("new_fno").is_not_null()
                                          & ~pl.col("iss_nonregistrant").fill_null(False)).sum(),
    ).sort("year")
    .with_columns(
        pct_before=100 * pl.col("rows_before") / pl.col("rows"),
        pct_after=100 * pl.col("rows_after") / pl.col("rows"),
        pct_reg_before=100 * pl.col("rows_reg_before") / pl.col("rows_reg"),
        pct_reg_after=100 * pl.col("rows_reg_after") / pl.col("rows_reg"),
    ).with_columns(delta=pl.col("pct_after") - pl.col("pct_before"),
                   delta_reg=pl.col("pct_reg_after") - pl.col("pct_reg_before"))
)
print(byyear.select("year", "rows", "pct_before", "pct_after", "delta",
                    "pct_reg_before", "pct_reg_after", "delta_reg").with_columns(
    pl.selectors.float().round(2)))
byyear.write_csv(L3C_COVERAGE_BY_YEAR)

t, b_, a_ = fy["n"].sum(), fy.filter(pl.col("old_fno").is_not_null())["n"].sum(), \
    fy.filter(pl.col("new_fno").is_not_null())["n"].sum()
reg = fy.filter(~pl.col("iss_nonregistrant").fill_null(False))
tr, br, ar = reg["n"].sum(), reg.filter(pl.col("old_fno").is_not_null())["n"].sum(), \
    reg.filter(pl.col("new_fno").is_not_null())["n"].sum()
print(f"\nPANEL-WIDE, all rows     : {b_ / t:.3%} -> {a_ / t:.3%} "
      f"(+{100 * (a_ - b_) / t:.2f}pp, {a_ - b_:,} vote rows recovered)")
print(f"PANEL-WIDE, registrant   : {br / tr:.3%} -> {ar / tr:.3%} "
      f"(+{100 * (ar - br) / tr:.2f}pp)")

# ---------------------------------------------------------------------------
# 10. VERIFY 2 — the 20-match hand audit
# ---------------------------------------------------------------------------
rule("VERIFY 1b — what the appended-institution signal CHANGED")

# For every accepted fundid, what would the BARE-name score alone have picked?
_bare_top = (cand.filter(pl.col("score_name") > 0)
             .sort(["fundid", "score_name"], descending=[False, True])
             .unique(subset=["fundid"], keep="first", maintain_order=True)
             .select("fundid", bare_unit="unit", bare_crsp="crsp_fund_name",
                     bare_score="score_name"))
_chg = (fuzzy.select("fundid", "fundname_modal", "institutionname_modal", "unit",
                     "crsp_fund_name", "n_vote_rows", "crsp_match_score",
                     "score_name")
        .join(_bare_top, on="fundid", how="left"))
_moved = _chg.filter(pl.col("bare_unit").is_not_null()
                     & (pl.col("unit") != pl.col("bare_unit")))
_new = _chg.filter(pl.col("bare_unit").is_null()
                   | (pl.col("score_name") < L3B_SCOPED_THRESH))
print(f"accepted matches whose TARGET differs from the bare-name top-1 : "
      f"{_moved.height:,} ({_moved['n_vote_rows'].sum():,} vote rows)")
print(f"accepted matches the bare name alone could not have reached at all "
      f"(bare score < {L3B_SCOPED_THRESH}): {_new.height:,} "
      f"({_new['n_vote_rows'].sum():,} vote rows) — these are the appended "
      f"signal's own recall")
if _moved.height:
    pl.Config.set_fmt_str_lengths(46)
    print(_moved.sort("n_vote_rows", descending=True).head(15).select(
        "fundname_modal", "institutionname_modal", "crsp_fund_name", "bare_crsp",
        "n_vote_rows"))
    pl.Config.set_fmt_str_lengths(60)

rule(f"VERIFY 2 — random {L3C_AUDIT_N}-match hand audit (seed {L3C_AUDIT_SEED})")

acc_out = fuzzy.select(
    "fundid", "fundname_modal", "institutionname_modal", "seriesid", "n_vote_rows",
    "first_year", "last_year", "gap_form", "space", "accept_path", "q_name",
    "c_name", "crsp_fund_name", "mgmt_name", "crsp_fundno", "index_fund_flag",
    "tna_latest", "n_crsp_classes", "crsp_match_score", "score2", "margin",
    "n_rivals", "family_gate", "family_agree", "score_name", "mgmt_share",
    "n_sib", "mgmt_scope", "name_n_units", "digit_fusion",
).sort("n_vote_rows", descending=True)
acc_out.write_csv(L3C_ACCEPTED)
print(f"wrote {acc_out.height:,} accepted matches to {L3C_ACCEPTED}")

_fm = acc_out.filter(pl.col("family_gate") == L3B_FAMILY_MISMATCH_FLAG)
print(f"\n{L3B_FAMILY_MISMATCH_FLAG} survivors — accepted despite a family "
      f"mismatch, on an exact BARE-NAME identity ({_fm.height:,} matches, "
      f"{_fm['n_vote_rows'].sum():,} vote rows). Every one listed:")
for _r in _fm.sort("n_vote_rows", descending=True).iter_rows(named=True):
    print(f"\n  ISS  : {_r['fundname_modal']}  ({_r['n_vote_rows']:,} rows)")
    print(f"  inst : {_r['institutionname_modal']}")
    print(f"  CRSP : {_r['crsp_fund_name']}")
    print(f"  mgmt : {_r['mgmt_name']}")
    print(f"  bare-name score {_r['score_name']:.4f}  scope support "
          f"{_r['n_sib']} siblings ({_r['mgmt_share']:.1%})")

# This tier accepts far fewer than L3C_AUDIT_N matches, so a random sample of
# the accepts is the whole accept set and audits only one side of the bar. Pad
# to L3C_AUDIT_N with the highest-scoring DECLINED top-1s — the rows a reviewer
# most needs to see, because they are where a wrong threshold would show up
# first. `verdict` says which side of the line each row is on.
audit = acc_out.sample(n=min(L3C_AUDIT_N, acc_out.height), seed=L3C_AUDIT_SEED,
                       shuffle=True).with_columns(verdict=pl.lit("ACCEPTED"),
                                                  reject_reason=pl.lit(""))
_need = L3C_AUDIT_N - audit.height
if _need > 0 and rej_log:
    _rej = (pl.concat(rej_log, how="diagonal_relaxed")
            .unique(subset=["fundid"], keep="first")
            .join(acc_out.select("fundid"), on="fundid", how="anti")
            .sort("score", descending=True).head(_need)
            .join(unit_agg.select("unit", "crsp_fundno", "index_fund_flag",
                                  "tna_latest", "n_crsp_classes"),
                  on="unit", how="left")
            .rename({"score": "crsp_match_score"})
            .with_columns(verdict=pl.lit("DECLINED"), accept_path=pl.lit("—")))
    audit = pl.concat([audit, _rej.select(audit.columns)], how="vertical_relaxed")
    print(f"\n(only {acc_out.height} accepts exist, so the audit sample is padded "
          f"with the {_rej.height} highest-scoring DECLINED top-1s — the rows "
          f"nearest the bar, which is where a wrong threshold would show first)")
audit.write_csv(L3C_AUDIT_SAMPLE)
pl.Config.set_fmt_str_lengths(80)
for r in audit.iter_rows(named=True):
    print(f"\n  [{r['verdict']}{(' — ' + r['reject_reason']) if r['reject_reason'] else ''}]")
    print(f"\n  ISS  : {r['fundname_modal']}")
    print(f"  inst : {r['institutionname_modal']}")
    print(f"  CRSP : {r['crsp_fund_name']}")
    print(f"  score {r['crsp_match_score']:.4f}  margin {r['margin']:.4f}  "
          f"form={r['gap_form']}/{r['space']}  path={r['accept_path']}  "
          f"rows={r['n_vote_rows']:,}  flag={r['index_fund_flag']}  "
          f"tna={r['tna_latest']}")
    print(f"  mgmt : {r['mgmt_name']}")
    print(f"  family gate={r['family_gate']}  bare-name score {r['score_name']:.4f}  "
          f"(mgmt scope support {r['n_sib']} siblings, {r['mgmt_share']:.1%})")
    print(f"  q    : {r['q_name']}")
    print(f"  c    : {r['c_name']}")
pl.Config.set_fmt_str_lengths(60)

# ---------------------------------------------------------------------------
# 11. VERIFY 3 — block reassignments
# ---------------------------------------------------------------------------
rule("VERIFY 3 — block reassignments caused by this tier")

print(f"fundids whose block MOVED          : {changes.height:,} "
      f"({changes['n_vote_rows'].sum():,} vote rows)")
if changes.height:
    print(changes.group_by("old_block", "old_source", "block").agg(
        fundids=pl.len(), vote_rows=pl.col("n_vote_rows").sum()).sort("vote_rows",
                                                                      descending=True))
    print("\ntop 25 by vote rows:")
    print(changes.head(25).select("fundname_modal", "institutionname_modal",
                                  "n_vote_rows", "old_block", "old_source", "block",
                                  "index_fund_flag", "crsp_match_score"))
changes.write_csv(L3C_BLOCK_CHANGES)

print("\nblock totals, vote-row-weighted, before -> after:")
# `n_vote_rows` is uint32 (schema note §10.1): the group SUMS are fine, but
# `100 * <u32>` wraps -- 100 x 81.2M is 8.1e9, past the u32 ceiling -- and the
# inherited version of this print reported the index block at 6.3% of a panel
# where it is 36.1%. Cast before multiplying, and reconcile.
cmp = (
    base.group_by("block").agg(before=pl.col("n_vote_rows").cast(pl.Float64).sum())
    .join(out.group_by("block").agg(
        after=pl.col("n_vote_rows").cast(pl.Float64).sum()), on="block")
    .with_columns(pct_before=100.0 * pl.col("before") / TOTAL_ROWS,
                  pct_after=100.0 * pl.col("after") / TOTAL_ROWS)
    .sort("after", descending=True)
)
assert abs(cmp["before"].sum() - TOTAL_ROWS) < 1 and \
    abs(cmp["after"].sum() - TOTAL_ROWS) < 1, \
    "block sums do not reconcile to the panel total — check the uint32 cast"
print(cmp.with_columns(pl.selectors.float().round(3)))

# ---------------------------------------------------------------------------
# 12. VERIFY 4 — TNA hazard on the links this tier adds
# ---------------------------------------------------------------------------
rule("VERIFY 4 — TNA-per-vote-row tail for the NEW links")

haz = (
    fuzzy.filter(pl.col("tna_latest").is_not_null())
    .with_columns(tna_per_row=pl.col("tna_latest") / pl.col("n_vote_rows"))
    .sort("tna_per_row", descending=True)
    .select("fundname_modal", "institutionname_modal", "n_vote_rows", "tna_latest",
            "tna_per_row", "crsp_fund_name", "crsp_match_score", "gap_form",
            "accept_path")
)
print(f"new links carrying a tna_latest    : {haz.height:,} / {fuzzy.height:,}")
if haz.height:
    print(f"total TNA added ($M, distinct crsp_fundno): "
          f"{fuzzy.unique(subset=['crsp_fundno'])['tna_latest'].sum():,.0f}")
    print(f"median TNA ($M)                    : {haz['tna_latest'].median():,.1f}")
    print("\ntop 15 by TNA per vote row (the ones to audit — a low-vote-row fundid "
          "inheriting mega-fund TNA is the L3 VERIFY-4b failure mode):")
    print(haz.head(15))
    print("\ntop 10 by absolute TNA:")
    print(haz.sort("tna_latest", descending=True).head(10).select(
        "fundname_modal", "crsp_fund_name", "n_vote_rows", "tna_latest",
        "crsp_match_score"))
haz.write_csv(L3C_TNA_HAZARD)
print("\nNOTE (master-feeder): a master portfolio's assets are the SUM of its "
      "feeders'. Linking a master to ONE feeder's CRSP record gives it that "
      "feeder's TNA, which UNDERSTATES the master. The bias is downward in the "
      "within-block weight — the safe direction — but it is a bias, not equality.")

# ---------------------------------------------------------------------------
# 13. VERIFY 5 — what is left, and why
# ---------------------------------------------------------------------------
rule("VERIFY 5 — the residual after this tier")

left = out.filter(pl.col("crsp_fundno").is_null() & (pl.col("block") != "asset_owner"))
print(f"still unlinked (non asset_owner)   : {left.height:,} fundids, "
      f"{left['n_vote_rows'].sum():,} vote rows "
      f"({left['n_vote_rows'].sum() / TOTAL_ROWS:.2%} of the panel)")
KINDS = {
    "master_feeder": r"(?i)\bMASTER\b",
    "separate_account_VA": r"(?i)\b(SEPARATE ACCOUNT|SUB[ -]?ACCOUNT|VA[ -]?\d|"
                           r"VARIABLE ACCOUNT|CREF)\b",
    "variable_insurance_trust": r"(?i)\b(VARIABLE INSURANCE|VIT|VIP|"
                                r"VARIABLE (PRODUCT|SERIES|PORTFOLIO))\b",
    "collective_trust": r"(?i)\b(COLLECTIVE|COMMINGLED|GROUP TRUST|CIT)\b",
    "central_fund": r"(?i)\bCENTRAL FUND\b",
    "non_us": r"(?i)\b(N\.?V\.?|S\.?A\.?|PLC|LUX|SICAV|CANADA|UK)\b",
}
resid = left.with_columns([
    pl.col("fundname_modal").fill_null("").str.contains(rx).alias(k)
    for k, rx in KINDS.items()])
for k in KINDS:
    s = resid.filter(pl.col(k))
    print(f"  {k:<26} {s.height:>5} fundids {s['n_vote_rows'].sum():>10,} vote rows "
          f"({100 * s['n_vote_rows'].sum() / left['n_vote_rows'].sum():>5.1f}% of residual)")
anyk = resid.filter(pl.any_horizontal([pl.col(k) for k in KINDS]))
print(f"  {'ANY of the above':<26} {anyk.height:>5} fundids "
      f"{anyk['n_vote_rows'].sum():>10,} vote rows "
      f"({100 * anyk['n_vote_rows'].sum() / left['n_vote_rows'].sum():>5.1f}%)")

# The structural question is not "what is it called" but "did the CRSP corpus
# ever offer it a plausible twin". Bucketing on the best score this tier could
# find answers that directly.
bestsc = (cand.group_by("fundid").agg(best=pl.col("score").max())
          .join(left.select("fundid", "n_vote_rows", "seriesid"), on="fundid",
                how="inner"))
noc = left.join(cand.select("fundid").unique(), on="fundid", how="anti")
print(f"\nwhy the residual is a residual — best score this tier could find:")
print(f"  {'no candidate at all (<0.30)':<32} {noc.height:>5} fundids "
      f"{noc['n_vote_rows'].sum():>10,} vote rows")
for lo, hi in [(0.30, 0.70), (0.70, 0.90), (0.90, 0.97), (0.97, 1.01)]:
    s = bestsc.filter(pl.col("best").is_between(lo, hi, closed="left"))
    print(f"  best in [{lo:.2f}, {hi:.2f})".ljust(34) + f"{s.height:>5} fundids "
          f"{s['n_vote_rows'].sum():>10,} vote rows"
          + ("   <- over the bar but no scope/family/margin" if lo >= 0.97 else ""))
print(f"\n  of the residual, {left.filter(pl.col('seriesid').is_not_null()).height:,} "
      f"fundids ({left.filter(pl.col('seriesid').is_not_null())['n_vote_rows'].sum():,} "
      f"vote rows) still carry a seriesId — i.e. they are REGISTERED with the SEC "
      f"and simply are not in CRSP's mutual-fund database at all")
print("\ntop 20 unlinked by vote rows:")
print(left.sort("n_vote_rows", descending=True).head(20).select(
    "fundname_modal", "institutionname_modal", "n_vote_rows", "seriesid", "block"))
resid.sort("n_vote_rows", descending=True).write_csv(L3C_UNMATCHED)

# candidate log
cand.sort(["fundid", "score"], descending=[False, True]).filter(
    pl.col("score") >= L3B_SCOPED_THRESH).select(
    "fundid", "fundname_modal", "institutionname_modal", "n_vote_rows", "gap_form",
    "space", "q_name", "c_name", "unit", "crsp_fund_name", "mgmt_name", "score",
    "family_agree", "mgmt_scope", "name_n_units",
    "digit_fusion").write_csv(L3C_CANDIDATES)
print(f"\nwrote the candidate log to {L3C_CANDIDATES}")

rule("L3c done")
print(f"{NPX_CRSP_LINK}: {out.height:,} fundids, "
      f"{out['crsp_fundno'].is_not_null().sum():,} with a crsp_fundno "
      f"({base['crsp_fundno'].is_not_null().sum():,} before)")
