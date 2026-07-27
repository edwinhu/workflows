"""L2 / LINK-02 — Resolve every ISS N-PX `fundid` to a SEC `seriesId`.

Both identifiers are **time-invariant fund identities**: ISS reuses a `fundid`
for the life of a fund, and a SEC `seriesId` is assigned once at registration.
So this is a *per-fund* resolution applied across all years, not a per-year
match. A fundid resolved from any one year's evidence is resolved for all of
its years.

Tiers (precision-descending; `match_tier` records which one fired)
-----------------------------------------------------------------
1. `iss_seriesid`     ISS itself reports the seriesid (2023+ only), and the
                      fundid votes only in that era.
2. `propagated`       Same exact-ID resolution, but the fundid also has
                      pre-2023 votes, so the id is carried back over the stable
                      fundid. Tiers 1 and 2 are mechanically identical; the
                      label only records which era the evidence covers.
3. `cik_scoped_name`  Unresolved fundid that nonetheless carries an ISS
                      `fundcik`: TF-IDF the ISS `fundname` against the series
                      and class names of *that registrant only*. An exact CIK
                      plus like-to-like full fund names -> strict threshold.
4. `inst_scoped_name` Unresolved fundid whose ISS *institution* has resolved
                      siblings: those siblings imply a set of SEC CIKs for the
                      fund family, and the match is scoped to that CIK set.
                      (This tier is not in the original plan. It was added
                      because the diagnostic below showed `fundcik` and
                      `seriesid` populate together in ISS — only 148 fundids
                      have a CIK but no seriesid — so tier 3 alone is a no-op
                      and 68% of fundids would otherwise fall straight into the
                      unscoped regime.)
5. `crsp_name`        ISS `fundname` -> CRSP `fund_summary2.fund_name` ->
                      `crsp_fundno` -> `crsp_cik_map.series_cik`. CRSP RETAINS
                      DEFUNCT FUNDS, so it reaches the pre-2010 cohort the SEC
                      annual masters (snapshots of then-active registrants,
                      2010+) never list. Scoped by `mgmt_name`, which plays the
                      same role for CRSP that `institutionid` plays for ISS.
                      Also yields `crsp_fundno`, which is what L3 needs anyway.
6. `global_name`      Unscoped TF-IDF over the union of ALL name vintages.
                      **Never accepted on score alone**: a match must also be
                      unambiguous (top-1 beats top-2 by a margin) and carry a
                      second independent signal (the ISS institution's family
                      token appears in the SEC entity/series name, or the score
                      is a normalised-name identity AND that name belongs to
                      exactly one series in the corpus). Every candidate is
                      written to `data/output/l2_adjudication_candidates.csv`.
7. `unresolved`       Left null; downstream falls back to family/regex.

Two guards apply to every fuzzy tier. Candidates must agree on their
digit-bearing tokens and on any trailing series designator ("Russell 2000" vs
"Russell 1000", "SBL Fund Series N" vs "Series H" both score ~0.9-1.0 on a
char-ngram cosine but are different funds), and a name that maps to several
series can only be accepted where a scope disambiguates it.

Why names, not tickers: ISS N-PX carries no fund ticker (its `cusip` is the
*issuer's*, not the fund's), so there is no ISS-side ticker pre-pass. `fundcik`
is the only exact-ID lever besides `seriesid`.

Name handling follows the L2a findings: 31% of series changed `series_name` at
least once, so the corpus is the LONG table of every (series, name, vintage) —
matching any vintage resolves the series. Some vintages embed the rename
history in the name itself ("... (formerly named ...)"), so both the pre- and
post-rename forms are emitted. `series_name` -> `series_id` is not unique, so
ties are broken toward the series with the longer/more current observed span
and every tie broken is logged.

Outputs
-------
`data/processed/fundid_seriesid.parquet`
    One row per `fundid`: `fundid, seriesid, match_tier, match_score,
    n_vote_rows, first_year, last_year, fundname_modal` plus diagnostic columns
    (`iss_nonregistrant`, `crsp_fundno`, `tna_latest`, ...).
`data/output/l2_adjudication_candidates.csv`
    Every fuzzy candidate considered, with the tier, scope, score and accept
    decision — the audit trail for the non-exact tiers.
`data/output/l2_adjudication_ties.csv`
    Name -> multiple series_id collisions and how each was broken.
`data/output/l2_adjudication_multi_seriesid.csv`
    Fundids ISS reports under more than one seriesid (fund reorganisations).
`data/output/l2_adjudication_unresolved.csv`
    Top-3 best-guess candidates for every fundid no tier accepted, so the tail
    can be hand-worked without re-running the matcher.

Run: python scripts/linking/build_fundid_seriesid.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cit"))

import numpy as np
import polars as pl
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn

from config_obs import (  # noqa: E402
    FUNDID_SERIESID,
    L2_ADJUDICATION_CANDIDATES,
    L2_ADJUDICATION_MULTISID,
    L2_ADJUDICATION_TIES,
    L2_ADJUDICATION_UNRESOLVED,
    L2_CAND_THRESHOLD,
    L2_CIK_SCOPED_THRESH,
    L2_CRSP_EXACTISH,
    L2_CRSP_SCOPED_THRESH,
    L2_CRSP_TRUST_PREFIX_RE,
    L2_CRSP_CLASS_SUFFIX_RE,
    L2_CLASSNAME_MIN_CHARS,
    L2_CLASSNAME_MIN_TOKENS,
    L2_FAMILY_STOPWORDS,
    L2_FORMERLY_RE,
    L2_GENERIC_CLASS_RE,
    L2_AMPERSAND_FOLD,
    L2_DESIGNATOR_RE,
    L2_DIGIT_TOKEN_RE,
    L2_GLOBAL_EXACTISH,
    L2_GLOBAL_FAMILY_THRESH,
    L2_GLOBAL_MARGIN,
    L2_GLOBAL_THRESH,
    L2_INST_SCOPED_THRESH,
    L2_ISS_SERIESID_ERA,
    L2_LEGAL_SUFFIX_RE,
    L2_NONREGISTRANT_RE,
    L2_PAREN_RE,
    L2_TFIDF_ANALYZER,
    L2_TFIDF_NGRAM,
    L2_TFIDF_NGRAM_ALT,
    L2_TFIDF_TOP_K,
    CRSP_CIK_MAP,
    FUND_SUMMARY2,
    L2_SHARES_WEIGHT_FIRST_YEAR,
    NPX_RAW,
    NPX_SERIESID,
    PARQUET_COMPRESSION,
    SAMPLE_END,
    SAMPLE_START,
    SEC_SERIES_MASTER_SERIES,
    SEC_SERIES_NAMES_LONG,
)

pl.Config.set_tbl_rows(60)
pl.Config.set_tbl_cols(20)
pl.Config.set_fmt_str_lengths(60)


def rule(title):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


# ---------------------------------------------------------------------------
# name normalisation
# ---------------------------------------------------------------------------
def norm(col, drop_formerly=True):
    """Uppercase, drop parentheticals, punctuation and legal suffixes."""
    e = pl.col(col).str.to_uppercase()
    if drop_formerly:
        e = e.str.replace_all(L2_FORMERLY_RE, " ")
    e = e.str.replace_all(L2_PAREN_RE, " ")
    e = e.str.replace_all(r"[^A-Z0-9]+", " ")
    e = e.str.replace_all(L2_LEGAL_SUFFIX_RE, " ")
    e = e.str.replace_all(r"\s+", " ").str.strip_chars()
    for pat, rep in L2_AMPERSAND_FOLD:
        e = e.str.replace_all(pat, rep)
    return e.str.replace_all(r"\s+", " ").str.strip_chars()


def digit_key(col):
    """Sorted multiset of the digit-bearing tokens in a normalised name.

    These tokens ("500", "2000", "2X") carry most of a fund name's
    discriminating information and almost none of its character mass, so a
    char-ngram cosine barely notices when they differ: "Russell 2000" scores
    ~0.97 against "Russell 1000". Comparing the keys is the guard.
    """
    return (
        pl.col(col).str.split(" ")
        .list.eval(pl.element().filter(pl.element().str.contains(L2_DIGIT_TOKEN_RE)))
        .list.sort().list.join(" ")
    )


def designator(col):
    """Trailing "SERIES N" / "PORTFOLIO 2" designator, if any."""
    return pl.col(col).str.extract(L2_DESIGNATOR_RE, 1)


def norm_formerly_tail(col):
    """The *pre-rename* name buried inside a '(formerly named X)' parenthetical."""
    e = (
        pl.col(col)
        .str.to_uppercase()
        .str.extract(r"\((?:FORMERLY|FORMALLY|F/K/A|FKA|PREVIOUSLY|NEE)[^A-Z0-9]*([^)]*)\)", 1)
    )
    e = e.str.replace_all(r"^(NAMED|KNOWN AS|CALLED)\s+", " ")
    e = e.str.replace_all(r"[^A-Z0-9]+", " ")
    e = e.str.replace_all(L2_LEGAL_SUFFIX_RE, " ")
    return e.str.replace_all(r"\s+", " ").str.strip_chars()


def family_token(col):
    """Reduce an ISS `institutionname` to its distinguishing family word."""
    e = norm(col)
    for w in L2_FAMILY_STOPWORDS:
        e = e.str.replace_all(rf"\b{w}\b", " ")
    e = e.str.replace_all(r"\s+", " ").str.strip_chars()
    return e.str.split(" ").list.first()


# ---------------------------------------------------------------------------
# 1. ISS side
# ---------------------------------------------------------------------------
rule("L2 — loading ISS N-PX fund identities")

npx_sid = pl.scan_parquet(NPX_SERIESID).with_columns(
    pl.col("meetingdate").dt.year().alias("year")
)

# per-fundid vote volume, era span, and the ISS-reported ids
fund_ids = (
    npx_sid.group_by("fundid")
    .agg(
        n_vote_rows=pl.len(),
        first_year=pl.col("year").min(),
        last_year=pl.col("year").max(),
        n_rows_pre=(pl.col("year") < L2_ISS_SERIESID_ERA).sum(),
        n_rows_era=(pl.col("year") >= L2_ISS_SERIESID_ERA).sum(),
        n_seriesid=pl.col("seriesid").drop_nulls().n_unique(),
    )
    .collect(engine="streaming")
)

# modal seriesid per fundid (ties -> the id observed in the most years, then id)
#
# (P) The modal pick is right for 15 of the 16 multi-seriesid fundids: those are
# fund REORGANISATIONS (MF->ETF conversions, trust migrations) or single-year
# blips, where one id genuinely dominates and the other is a successor or an
# artifact, so taking the mode picks the fund's real identity.
#
# It is a KNOWN, BOUNDED approximation for exactly one: fundid 6008319 (JHVIT),
# where ISS conflates two distinct SEC series -- "Strategic Equity Allocation
# Trust" and "Disciplined Value International Trust" -- that are unrelated and
# have both been independently active since <=2012. That is not a reorganisation
# and there is no correct single answer: the split is ~54/46, so the mode
# discards a near-equal amount of real volume from the other series. It is also
# the largest such fundid (90,136 vote rows, 61% of all 31,264 within-key
# seriesid conflicts panel-wide).
#
# Left as-is deliberately. This fundid is `block=='active'` in
# npx_crsp_link.parquet -- as are all 16 -- so no index-block statistic can move
# however it resolves, and splitting one ISS fundid into two identities would
# mean inventing a fundid the vote panel does not have. Resolving it belongs
# here, at one row per fundid, never on the 143.8M-row panel: see
# config_obs.NPX_DEDUP_COLS for why widening the panel's dedup key to include
# seriesid would double-count votes rather than separate them.
sid_counts = (
    npx_sid.filter(pl.col("seriesid").is_not_null())
    .group_by(["fundid", "seriesid"])
    .agg(n=pl.len(), yr_max=pl.col("year").max(), yr_min=pl.col("year").min())
    .collect(engine="streaming")
    .sort(["fundid", "n", "yr_max", "seriesid"], descending=[False, True, True, False])
)
modal_sid = sid_counts.group_by("fundid", maintain_order=True).head(1).select(
    "fundid", pl.col("seriesid").alias("iss_seriesid")
)

# modal fundcik per fundid
cik_counts = (
    npx_sid.filter(pl.col("fundcik").is_not_null())
    .group_by(["fundid", "fundcik"])
    .agg(n=pl.len())
    .collect(engine="streaming")
    .sort(["fundid", "n", "fundcik"], descending=[False, True, False])
)
modal_cik = cik_counts.group_by("fundid", maintain_order=True).head(1).select(
    "fundid", pl.col("fundcik").alias("iss_fundcik")
)

# ISS names / institution (only npx.parquet carries them)
names = (
    pl.scan_parquet(NPX_RAW)
    .select(["fundid", "institutionid", "institutionname", "fundname"])
    .group_by(["fundid", "institutionid", "institutionname", "fundname"])
    .agg(n=pl.len())
    .collect(engine="streaming")
    .sort(["fundid", "n", "fundname"], descending=[False, True, False])
    .group_by("fundid")
    .head(1)
    .select(
        "fundid",
        "institutionid",
        pl.col("institutionname").alias("institutionname_modal"),
        pl.col("fundname").alias("fundname_modal"),
    )
)

fund = (
    fund_ids.join(modal_sid, on="fundid", how="left")
    .join(modal_cik, on="fundid", how="left")
    .join(names, on="fundid", how="left")
    .with_columns(
        iss_nonregistrant=pl.col("institutionname_modal")
        .fill_null("")
        .str.contains(L2_NONREGISTRANT_RE),
        fundname_norm=norm("fundname_modal"),
        family=family_token("institutionname_modal"),
    )
    .with_columns(iss_digits=digit_key("fundname_norm"),
                  iss_desig=designator("fundname_norm"))
)
assert fund["fundid"].n_unique() == fund.height, "fundid not unique in ISS dim"
print(f"distinct fundids                       : {fund.height:,}")
print(f"  appear in {L2_ISS_SERIESID_ERA}+                       : "
      f"{fund.filter(pl.col('n_rows_era') > 0).height:,}")
print(f"  with >=1 ISS seriesid (exact)         : "
      f"{fund.filter(pl.col('n_seriesid') > 0).height:,}")
print(f"  with >1 distinct ISS seriesid         : "
      f"{fund.filter(pl.col('n_seriesid') > 1).height:,}")
print(f"  with fundcik but NO seriesid          : "
      f"{fund.filter((pl.col('iss_fundcik').is_not_null()) & (pl.col('n_seriesid') == 0)).height:,}")
print(f"  with NEITHER seriesid nor fundcik     : "
      f"{fund.filter((pl.col('iss_fundcik').is_null()) & (pl.col('n_seriesid') == 0)).height:,}")
print(f"  ISS non-registrant (trailing '*')     : {fund['iss_nonregistrant'].sum():,}")
print(f"total N-PX vote rows                   : {fund['n_vote_rows'].sum():,}")

# --- multi-seriesid fundids: log before choosing the modal id ---------------
multi = sid_counts.join(
    fund.filter(pl.col("n_seriesid") > 1).select("fundid", "fundname_modal",
                                                 "institutionname_modal"),
    on="fundid", how="inner",
).sort(["fundid", "n"], descending=[False, True])
multi = multi.join(modal_sid, on="fundid", how="left").with_columns(
    chosen=pl.col("seriesid") == pl.col("iss_seriesid")
)
multi.write_csv(L2_ADJUDICATION_MULTISID)
print(f"\n{fund.filter(pl.col('n_seriesid') > 1).height} fundids carry >1 ISS seriesid "
      f"(fund reorganisations: one dominant id plus a successor id appearing only in the\n"
      f"later years). Modal id kept; all {multi.height} (fundid, seriesid) pairs logged to "
      f"{L2_ADJUDICATION_MULTISID.name}.")

# ---------------------------------------------------------------------------
# 2. THE DECISIVE DIAGNOSTIC — how much of the pre-2023 panel does exact-ID
#    propagation already cover, and how much work is left for the name tiers?
# ---------------------------------------------------------------------------
rule("DIAGNOSTIC — share of pre-2023 vote rows resolvable from the 2023+ era")

exact_ids = fund.filter(pl.col("n_seriesid") > 0)["fundid"]
byyear = (
    npx_sid.group_by("year")
    .agg(rows=pl.len(), rows_exact=pl.col("fundid").is_in(exact_ids.to_list()).sum())
    .sort("year")
    .collect(engine="streaming")
    .with_columns(share_exact=(pl.col("rows_exact") / pl.col("rows")).round(4))
)
print(byyear)
pre = byyear.filter(pl.col("year") < L2_ISS_SERIESID_ERA)
print(
    f"\nPRE-{L2_ISS_SERIESID_ERA}: {pre['rows_exact'].sum():,} / {pre['rows'].sum():,} vote rows "
    f"= {pre['rows_exact'].sum() / pre['rows'].sum():.1%} already resolved by exact-ID propagation."
)
print(
    f"Remaining for the name tiers: {fund.filter(pl.col('n_seriesid') == 0).height:,} fundids "
    f"carrying {fund.filter(pl.col('n_seriesid') == 0)['n_vote_rows'].sum():,} vote rows "
    f"({fund.filter(pl.col('n_seriesid') == 0)['n_vote_rows'].sum() / fund['n_vote_rows'].sum():.1%} "
    f"of the panel)."
)

# ---------------------------------------------------------------------------
# 3. SEC name corpus — every (series_id, name) pair across ALL vintages
# ---------------------------------------------------------------------------
rule("SEC name corpus")

long = pl.read_parquet(SEC_SERIES_NAMES_LONG)
smaster = pl.read_parquet(SEC_SERIES_MASTER_SERIES).select(
    "series_id", "year_first_seen", "year_last_seen", "n_years"
)

series_side = long.select(
    "series_id", "cik", "entity_name",
    name=norm("series_name"), src=pl.lit("series_name"),
)
formerly_side = long.select(
    "series_id", "cik", "entity_name",
    name=norm_formerly_tail("series_name"), src=pl.lit("series_name_formerly"),
).filter(pl.col("name").is_not_null() & (pl.col("name").str.len_chars() >= L2_CLASSNAME_MIN_CHARS))
class_side = (
    long.with_columns(cn=norm("class_name"))
    .filter(
        (pl.col("cn").str.len_chars() >= L2_CLASSNAME_MIN_CHARS)
        & (pl.col("cn").str.split(" ").list.len() >= L2_CLASSNAME_MIN_TOKENS)
        & ~pl.col("cn").str.contains(L2_GENERIC_CLASS_RE)
    )
    .select("series_id", "cik", "entity_name", name="cn", src=pl.lit("class_name"))
)

corpus = (
    pl.concat([series_side, formerly_side, class_side])
    .filter(pl.col("name").str.len_chars() > 3)
    .group_by(["name", "series_id", "cik"])
    .agg(entity_name=pl.col("entity_name").first(), src=pl.col("src").first())
    .join(smaster, on="series_id", how="left")
    .with_columns(entity_norm=norm("entity_name"))
)
print(f"corpus rows (name x series x cik)       : {corpus.height:,}")
print(f"  distinct normalised names             : {corpus['name'].n_unique():,}")
print(f"  distinct series_id                    : {corpus['series_id'].n_unique():,}")
print(f"  from series_name                      : {corpus.filter(pl.col('src') == 'series_name').height:,}")
print(f"  from '(formerly ...)' tails           : {corpus.filter(pl.col('src') == 'series_name_formerly').height:,}")
print(f"  from non-generic class_name           : {corpus.filter(pl.col('src') == 'class_name').height:,}")

# many-to-one hazard: one name -> several series. Prefer the longer/more current
# observed span; log every collision.
corpus = corpus.sort(
    ["name", "year_last_seen", "n_years", "series_id"],
    descending=[False, True, True, False],
).with_columns(rank_in_name=pl.int_range(pl.len()).over("name"),
               name_n_series=pl.col("series_id").n_unique().over("name"),
               digits=digit_key("name"), desig=designator("name"))
ties = corpus.filter(pl.col("name").is_duplicated()).select(
    "name", "series_id", "cik", "entity_name", "year_first_seen", "year_last_seen",
    "n_years", preferred=pl.col("rank_in_name") == 0,
)
ties.write_csv(L2_ADJUDICATION_TIES)
n_amb = corpus.filter(pl.col("name").is_duplicated())["name"].n_unique()
print(f"  names mapping to >1 series_id         : {n_amb:,} "
      f"({ties.height:,} rows) -> {L2_ADJUDICATION_TIES.name}; "
      f"tie broken on (year_last_seen, n_years)")

# ---------------------------------------------------------------------------
# 4. one global TF-IDF candidate pass; each tier then filters by its own scope
# ---------------------------------------------------------------------------
rule("TF-IDF candidate generation")

# (P) ORDER IS LOAD-BEARING. `todo` feeds BOTH the TF-IDF left corpus (.to_list())
# and the row->fundid map (with_row_index). polars filter/join order is not
# guaranteed; when the corpus order shifts, DIFFERENT rows tie at the
# top_n/threshold boundary so a different candidate SET survives -- not a
# different winner, which is why tie-break fixes do nothing. Measured on a
# sibling copy: two cold runs differed on 93 match_tier / 172 crsp_fundno / 1
# block. `corpus` is already pinned at its own sort below; `crsp_todo` inherits
# this order.
todo = fund.filter((pl.col("n_seriesid") == 0) & (pl.col("fundname_norm").str.len_chars() > 3)).sort("fundid")
print(f"fundids needing a name match            : {todo.height:,}")

L_names = todo["fundname_norm"].to_list()
R_names = corpus["name"].to_list()


def candidates(ngram):
    vec = TfidfVectorizer(analyzer=L2_TFIDF_ANALYZER, ngram_range=ngram, min_df=1)
    vec.fit(L_names + R_names)
    M = sp_matmul_topn(
        vec.transform(L_names), vec.transform(R_names).T,
        top_n=L2_TFIDF_TOP_K, threshold=L2_CAND_THRESHOLD, sort=True,
    ).tocoo()
    return pl.DataFrame(
        {"row": M.row.astype(np.int32), "col": M.col.astype(np.int32),
         "score": M.data.astype(np.float64)}
    )


cand = candidates(L2_TFIDF_NGRAM)
print(f"candidate pairs @ ngram {L2_TFIDF_NGRAM}, thresh {L2_CAND_THRESHOLD}: {cand.height:,}")

ISS_COLS = ["fundid", "fundname_norm", "fundname_modal", "institutionid",
            "institutionname_modal", "family", "iss_fundcik", "n_vote_rows",
            "iss_nonregistrant", "iss_digits", "iss_desig", "last_year"]

cand = (
    cand.join(todo.with_row_index("row").with_columns(pl.col("row").cast(pl.Int32))
              .select("row", *ISS_COLS),
              on="row", how="left")
    .join(corpus.with_row_index("col").with_columns(pl.col("col").cast(pl.Int32))
          .select("col", "series_id", "cik", "entity_name", "entity_norm", "name",
                  "src", "year_last_seen", "n_years", "rank_in_name", "name_n_series",
                  "digits", "desig"),
          on="col", how="left")
    .drop("row", "col")
)


def token_guard(df):
    """Drop candidates whose digit-bearing tokens or series designator disagree.

    A char-ngram cosine cannot see the difference between "Russell 2000" and
    "Russell 1000", or between "SBL Fund Series N" and "SBL Fund Series H";
    both score ~0.9-1.0. Those tokens are compared exactly instead.
    """
    before = df.height
    out = df.filter(
        (pl.col("iss_digits") == pl.col("digits"))
        & (
            pl.col("iss_desig").is_null() | pl.col("desig").is_null()
            | (pl.col("iss_desig") == pl.col("desig"))
        )
    )
    print(f"  token guard (digits + series designator): dropped "
          f"{before - out.height:,} of {before:,} candidate pairs")
    return out


cand = token_guard(cand)

# ---------------------------------------------------------------------------
# 4b. CRSP name corpus — the only source that retains DEFUNCT funds
# ---------------------------------------------------------------------------
# The SEC annual masters are point-in-time snapshots of then-active registrants
# starting in 2010, so a fund that voted in 2008 and liquidated in 2009 is
# absent from them entirely. CRSP keeps it. `crsp_cik_map` then carries that
# fund's `series_cik` (S000...), which is the seriesId we want -- and the
# `crsp_fundno` picked up on the way is exactly what L3 needs for
# `index_fund_flag` / `tna_latest`, so it is recorded on the output.
rule("CRSP name corpus (fund_summary2 + crsp_cik_map)")

cikmap = pl.read_parquet(CRSP_CIK_MAP).select("crsp_fundno", "series_cik").unique()
fsum = (
    pl.read_parquet(FUND_SUMMARY2)
    .filter(pl.col("fund_name").is_not_null())
    .join(cikmap, on="crsp_fundno", how="left")
    .with_columns(
        core=pl.col("fund_name")
        .str.replace(L2_CRSP_TRUST_PREFIX_RE, "")
        .str.replace(L2_CRSP_CLASS_SUFFIX_RE, ""),
        # mgmt_name is often null; the trust prefix of `fund_name` names the
        # same family, so the scope string is the union of the two.
        mgmt_norm=norm("mgmt_name").fill_null("") + " " + norm("fund_name"),
    )
)
print(f"fund_summary2 rows with a fund_name    : {fsum.height:,} "
      f"({fsum['crsp_fundno'].n_unique():,} crsp_fundno)")
print(f"  of which carry a series_cik          : {fsum['series_cik'].is_not_null().sum():,}")
print(f"  dead funds (dead_flag='Y')           : {(fsum['dead_flag'] == 'Y').sum():,}")

crsp_corpus = (
    pl.concat([
        fsum.select("crsp_fundno", "series_cik", "mgmt_norm", "tna_latest", "dead_flag",
                    name=norm("fund_name")),
        fsum.select("crsp_fundno", "series_cik", "mgmt_norm", "tna_latest", "dead_flag",
                    name=norm("core")),
    ])
    .filter(pl.col("name").str.len_chars() > 3)
    .unique(subset=["name", "crsp_fundno"])
    .with_columns(digits=digit_key("name"), desig=designator("name"),
                  name_n_fundno=pl.col("crsp_fundno").n_unique().over("name"),
                  name_n_series=pl.col("series_cik").n_unique().over("name"))
    # (P) same ORDER-IS-DATA hazard as `todo`: this frame is the right-hand TF-IDF
    # corpus AND the col->fundno map, and .unique() above is order-dependent.
    .sort("crsp_fundno", "name")
    # prefer the live, larger share class when a name maps to several fundnos
    .sort(["name", "dead_flag", "tna_latest", "crsp_fundno"],
          descending=[False, False, True, False], nulls_last=True)
    .with_columns(rank_in_name=pl.int_range(pl.len()).over("name"))
)
print(f"CRSP corpus rows (name x crsp_fundno)  : {crsp_corpus.height:,} "
      f"({crsp_corpus['name'].n_unique():,} distinct names)")

crsp_todo = todo  # narrowed per-pass below; the matmul is done once
CR_names = crsp_corpus["name"].to_list()
vec_c = TfidfVectorizer(analyzer=L2_TFIDF_ANALYZER, ngram_range=L2_TFIDF_NGRAM, min_df=1)
vec_c.fit(L_names + CR_names)
Mc = sp_matmul_topn(
    vec_c.transform(L_names), vec_c.transform(CR_names).T,
    top_n=L2_TFIDF_TOP_K, threshold=L2_CAND_THRESHOLD, sort=True,
).tocoo()
crsp_cand = (
    pl.DataFrame({"row": Mc.row.astype(np.int32), "col": Mc.col.astype(np.int32),
                  "score": Mc.data.astype(np.float64)})
    .join(crsp_todo.with_row_index("row").with_columns(pl.col("row").cast(pl.Int32))
          .select("row", *ISS_COLS), on="row", how="left")
    .join(crsp_corpus.with_row_index("col").with_columns(pl.col("col").cast(pl.Int32))
          .select("col", "crsp_fundno", "mgmt_norm", "tna_latest", "name",
                  "digits", "desig", "name_n_fundno", "rank_in_name",
                  series_id=pl.col("series_cik"), name_n_series=pl.col("name_n_series")),
          on="col", how="left")
    .drop("row", "col")
)
print(f"CRSP candidate pairs                   : {crsp_cand.height:,}")
crsp_cand = token_guard(crsp_cand).with_columns(
    # `family_agree` here means the ISS institution's family token appears in
    # the CRSP management-company / trust string -- the CRSP analogue of the
    # institution scope, and the same column name `best()` sorts on.
    family_agree=(
        pl.col("family").is_not_null()
        & (pl.col("family").str.len_chars() >= 3)
        & pl.col("mgmt_norm").str.contains(pl.col("family"), literal=True)
    )
)

# ---------------------------------------------------------------------------
# 5. institution -> CIK set, from the institution's already-resolved siblings
# ---------------------------------------------------------------------------
sid2cik = corpus.select("series_id", "cik").unique()
fundid2inst = fund.select("fundid", "institutionid")


def build_inst_cik(resolved_pairs):
    """institutionid -> set of SEC CIKs implied by that institution's resolved funds."""
    from_series = (
        resolved_pairs.join(fundid2inst, on="fundid", how="left")
        .join(sid2cik, left_on="seriesid", right_on="series_id", how="inner")
        .select("institutionid", "cik")
    )
    from_iss_cik = (
        fund.filter(pl.col("iss_fundcik").is_not_null())
        .select("institutionid",
                cik=pl.col("iss_fundcik").cast(pl.Int64).cast(pl.Utf8).str.zfill(10))
    )
    return pl.concat([from_series, from_iss_cik]).unique().drop_nulls()


exact_pairs = fund.filter(pl.col("n_seriesid") > 0).select(
    "fundid", seriesid=pl.col("iss_seriesid"))
inst_cik = build_inst_cik(exact_pairs)
print(f"\ninstitution->CIK pairs from exactly-resolved siblings: {inst_cik.height:,} "
      f"({inst_cik['institutionid'].n_unique():,} institutions)")
cov = todo.join(inst_cik.select("institutionid").unique(), on="institutionid", how="semi")
print(f"unresolved fundids whose institution has a CIK set: {cov.height:,} "
      f"({cov['n_vote_rows'].sum():,} vote rows)")

# ---------------------------------------------------------------------------
# 6. tier assignment over the candidate pool
# ---------------------------------------------------------------------------
rule("fuzzy tier assignment")

cand = cand.with_columns(
    fundcik10=pl.col("iss_fundcik").cast(pl.Int64).cast(pl.Utf8).str.zfill(10)
)
cand = cand.with_columns(
    inst_scope=pl.lit(False),
    cik_scope=pl.col("cik") == pl.col("fundcik10"),
    family_agree=(
        pl.col("family").is_not_null()
        & (pl.col("family").str.len_chars() >= 3)
        & (
            pl.col("entity_norm").str.contains(pl.col("family"), literal=True)
            | pl.col("name").str.contains(pl.col("family"), literal=True)
        )
    ),
)


def best(df, mask, thresh, tier):
    """Top-scoring in-scope candidate per fundid, with the top-2 margin.

    Candidates are first collapsed to one row per (fundid, name): a single
    normalised name can point at several series (the many-to-one hazard), and
    that collision is already settled by the corpus tie-break
    (`rank_in_name`, ordered on year_last_seen then n_years). Collapsing first
    keeps the margin test measuring what it is meant to measure -- ambiguity
    between *different* candidate names -- instead of re-penalising a
    same-name collision that has already been adjudicated.
    """
    sub = (
        df.filter(mask & (pl.col("score") >= thresh))
        .sort(["fundid", "score", "family_agree", "rank_in_name", "series_id"],
              descending=[False, True, True, False, False])
        .unique(subset=["fundid", "name"], keep="first", maintain_order=True)
    )
    # margin over the next-best candidate pointing at a DIFFERENT series
    top = sub.group_by("fundid", maintain_order=True).head(1)
    second = (
        sub.join(top.select("fundid", top_series="series_id"), on="fundid", how="left")
        .filter(pl.col("series_id") != pl.col("top_series"))
        .group_by("fundid")
        .agg(score2=pl.col("score").max())
    )
    return (
        top.join(second, on="fundid", how="left")
        .with_columns(
            score2=pl.col("score2").fill_null(0.0),
            match_tier=pl.lit(tier),
        )
        .with_columns(margin=pl.col("score") - pl.col("score2"))
    )


def with_inst_scope(df, ic):
    return df.drop("inst_scope", strict=False).join(
        ic.with_columns(inst_scope=pl.lit(True)),
        on=["institutionid", "cik"], how="left",
    ).with_columns(inst_scope=pl.col("inst_scope").fill_null(False))


accepted = []
remaining = set(todo["fundid"].to_list())

# --- tier 3: CIK-scoped -----------------------------------------------------
t3 = best(cand, pl.col("cik_scope"), L2_CIK_SCOPED_THRESH, "cik_scoped_name")
t3 = t3.filter(pl.col("fundid").is_in(list(remaining)))
accepted.append(t3)
remaining -= set(t3["fundid"].to_list())
print(f"tier cik_scoped_name  (>= {L2_CIK_SCOPED_THRESH}): {t3.height:,} fundids, "
      f"{t3['n_vote_rows'].sum():,} vote rows")

# --- tiers 4 and 5, bootstrapped -------------------------------------------
# The CIK set for an institution is seeded from its exactly-resolved funds and
# then GROWN by the *unscoped* global tier: a family that registered its funds
# across several trusts only reveals the later CIKs once one of its funds has
# been matched outside the scope. (Growing it from the scoped tier's own
# matches would be circular -- every inst-scoped match is in the scope by
# construction and adds no CIK.) Two passes; the second scope is a strict
# superset, so it can only add fundids, never revise one already accepted.
for i in range(2):
    t4 = best(with_inst_scope(cand.filter(pl.col("fundid").is_in(list(remaining))), inst_cik),
              pl.col("inst_scope"), L2_INST_SCOPED_THRESH, "inst_scoped_name")
    accepted.append(t4)
    remaining -= set(t4["fundid"].to_list())
    print(f"tier inst_scoped_name (>= {L2_INST_SCOPED_THRESH}) pass {i + 1}: "
          f"{t4.height:,} fundids, {t4['n_vote_rows'].sum():,} vote rows "
          f"(scope: {inst_cik.height:,} institution-CIK pairs)")

    # --- tier: CRSP-side name match -----------------------------------------
    # Only rows whose crsp_fundno actually carries a series_cik can resolve a
    # seriesId; the rest of the CRSP match is still kept (outside the tier) as
    # the TNA weight for the power-weighted coverage report below.
    c_pool = crsp_cand.filter(
        pl.col("fundid").is_in(list(remaining)) & pl.col("series_id").is_not_null()
    )
    tc = best(c_pool, pl.col("family_agree"), L2_CRSP_SCOPED_THRESH, "crsp_name")
    tc_u = best(
        c_pool.filter(~pl.col("fundid").is_in(tc["fundid"].to_list())),
        (pl.col("name_n_fundno") == 1) & (pl.col("name_n_series") == 1),
        L2_CRSP_EXACTISH, "crsp_name",
    )
    tc = pl.concat([tc, tc_u], how="diagonal_relaxed")
    accepted.append(tc)
    remaining -= set(tc["fundid"].to_list())
    print(f"tier crsp_name        (>= {L2_CRSP_SCOPED_THRESH} mgmt-scoped, "
          f"or >= {L2_CRSP_EXACTISH} on a globally unique CRSP name) pass {i + 1}: "
          f"{tc.height:,} fundids, {tc['n_vote_rows'].sum():,} vote rows")

    g_all = best(cand.filter(pl.col("fundid").is_in(list(remaining))),
                 pl.lit(True), L2_GLOBAL_FAMILY_THRESH, "global_name")
    # The unscoped tier never accepts on score alone. It needs an unambiguous
    # top-1 (margin over the next candidate NAME) plus a second, independent
    # signal: either the ISS institution's family token shows up in the SEC
    # entity/series name, or the score is a normalised-name identity AND that
    # name belongs to exactly one series in the whole corpus. Without the
    # uniqueness clause a generic portfolio name scores 1.0 against a dozen
    # unrelated registrants and the top-1 pick is arbitrary.
    g_all = g_all.with_columns(
        accept=(pl.col("margin") >= L2_GLOBAL_MARGIN)
        & (
            # a family token found in the SEC entity name IS a scope, just a
            # fuzzy one, so it earns the scoped threshold
            (pl.col("family_agree") & (pl.col("score") >= L2_GLOBAL_FAMILY_THRESH))
            | (
                (pl.col("score") >= L2_GLOBAL_EXACTISH)
                & (pl.col("name_n_series") == 1)
            )
        )
    )
    t5 = g_all.filter(pl.col("accept")).drop("accept")
    accepted.append(t5)
    remaining -= set(t5["fundid"].to_list())
    print(f"tier global_name      (>= {L2_GLOBAL_FAMILY_THRESH} w/ family agreement, "
          f"else >= {L2_GLOBAL_EXACTISH} on a globally unique name) pass {i + 1}: "
          f"{t5.height:,} fundids accepted, {t5['n_vote_rows'].sum():,} vote rows")
    if i == 0:
        inst_cik = build_inst_cik(
            pl.concat([exact_pairs,
                       pl.concat(accepted, how="diagonal_relaxed")
                       .select("fundid", seriesid=pl.col("series_id"))])
        )

cand = with_inst_scope(cand, inst_cik)
print(f"  global candidates clearing the score bar but REJECTED in the final pass "
      f"(ambiguous or no second signal): {g_all.filter(~pl.col('accept')).height:,}")
print(f"  of which rejected on margin < {L2_GLOBAL_MARGIN}: "
      f"{g_all.filter(pl.col('margin') < L2_GLOBAL_MARGIN).height:,}; "
      f"on missing second signal: "
      f"{g_all.filter((pl.col('margin') >= L2_GLOBAL_MARGIN) & ~pl.col('accept')).height:,} "
      f"(of which {g_all.filter((pl.col('margin') >= L2_GLOBAL_MARGIN) & ~pl.col('accept') & (pl.col('score') >= L2_GLOBAL_EXACTISH) & (pl.col('name_n_series') > 1)).height:,} "
      f"were exact-score matches on a name shared by several series)")

fuzzy = pl.concat(accepted, how="diagonal_relaxed")
assert fuzzy["fundid"].n_unique() == fuzzy.height, "a fundid was accepted by two tiers"

# --- adjudication log: every candidate considered in a fuzzy tier ----------
adj = (
    pl.concat([cand.with_columns(side=pl.lit("sec")),
               crsp_cand.with_columns(side=pl.lit("crsp"),
                                      entity_name=pl.col("mgmt_norm"))],
              how="diagonal_relaxed")
    .filter(pl.col("score") >= L2_INST_SCOPED_THRESH)
    .join(fuzzy.select("fundid", chosen_series="series_id", chosen_name="name",
                       chosen_tier="match_tier"),
          on="fundid", how="left")
    # the winning ROW, not merely any row pointing at the winning series
    .with_columns(accepted=(pl.col("series_id") == pl.col("chosen_series"))
                  & (pl.col("name") == pl.col("chosen_name")))
    .sort(["n_vote_rows", "fundid", "score"], descending=[True, False, True])
    .select("fundid", "fundname_modal", "institutionname_modal", "family", "n_vote_rows",
            "iss_fundcik", "iss_nonregistrant", "side", "series_id", "crsp_fundno", "cik",
            "entity_name", "name", "src", "score", "cik_scope", "inst_scope",
            "family_agree", "rank_in_name", "name_n_series",
            "chosen_tier", "chosen_series", "accepted")
)
adj.write_csv(L2_ADJUDICATION_CANDIDATES)
print(f"\nwrote {adj.height:,} candidate rows (score >= {L2_INST_SCOPED_THRESH}) to "
      f"{L2_ADJUDICATION_CANDIDATES.name}")

# --- the residual: top-3 best-guess candidates for every fundid no tier could
#     accept, so the tail can be hand-worked without re-running the matcher.
unres_cand = (
    cand.filter(pl.col("fundid").is_in(list(remaining)))
    .sort(["fundid", "score"], descending=[False, True])
    .unique(subset=["fundid", "series_id"], keep="first", maintain_order=True)
    .group_by("fundid", maintain_order=True).head(3)
    .sort(["n_vote_rows", "fundid", "score"], descending=[True, False, True])
    .select("fundid", "fundname_modal", "institutionname_modal", "n_vote_rows",
            "iss_nonregistrant", "series_id", "entity_name", "name", "src", "score",
            "inst_scope", "family_agree")
)
unres_cand.write_csv(L2_ADJUDICATION_UNRESOLVED)
print(f"wrote {unres_cand.height:,} best-guess rows for "
      f"{unres_cand['fundid'].n_unique():,} unresolved fundids to "
      f"{L2_ADJUDICATION_UNRESOLVED.name}")

# --- n-gram sensitivity -----------------------------------------------------
alt = candidates(L2_TFIDF_NGRAM_ALT)
alt_top = (
    alt.join(todo.with_row_index("row").with_columns(pl.col("row").cast(pl.Int32))
             .select("row", "fundid"), on="row", how="left")
    .join(corpus.with_row_index("col").with_columns(pl.col("col").cast(pl.Int32))
          .select("col", "series_id"), on="col", how="left")
    .sort(["fundid", "score"], descending=[False, True])
    .group_by("fundid", maintain_order=True).head(1).select("fundid", alt_series="series_id")
)
base_top = (
    cand.sort(["fundid", "score"], descending=[False, True])
    .group_by("fundid", maintain_order=True).head(1).select("fundid", "series_id")
)
sens = base_top.join(alt_top, on="fundid", how="inner")
print(f"n-gram sensitivity: top-1 series differs between {L2_TFIDF_NGRAM} and "
      f"{L2_TFIDF_NGRAM_ALT} on {(sens['series_id'] != sens['alt_series']).sum():,} of "
      f"{sens.height:,} fundids "
      f"({(sens['series_id'] != sens['alt_series']).mean():.1%})")

# ---------------------------------------------------------------------------
# 7. assemble the output
# ---------------------------------------------------------------------------
rule("assembling fundid_seriesid.parquet")

# --- fund size: TNA per fundid, needed for the power-weighted coverage report.
# Two independent routes, and the distinction matters for the metric's validity:
#   * a RESOLVED fundid reaches CRSP through its seriesId (exact);
#   * an UNRESOLVED fundid can still be name-matched to a crsp_fundno even when
#     that fundno has no series_cik -- which is what keeps the weighted metric
#     from being circular. Without it, unresolved funds would carry zero weight
#     and weighted coverage would tautologically read ~100%.
sid2fundno = (
    pl.read_parquet(CRSP_CIK_MAP)
    .filter(pl.col("series_cik").is_not_null())
    .select(seriesid="series_cik", crsp_fundno="crsp_fundno")
)
fundno_tna = (
    pl.read_parquet(FUND_SUMMARY2).select("crsp_fundno", "tna_latest", "index_fund_flag")
)
# TNA of a series = sum over its share classes
series_tna = (
    sid2fundno.join(fundno_tna, on="crsp_fundno", how="left")
    .group_by("seriesid")
    .agg(tna_from_series=pl.col("tna_latest").sum(),
         n_crsp_fundno=pl.col("crsp_fundno").n_unique(),
         crsp_fundno_any=pl.col("crsp_fundno").min())
)
# name-matched CRSP fund for fundids that never resolved (weighting only)
crsp_weight_match = (
    best(crsp_cand, pl.col("family_agree"), L2_CRSP_SCOPED_THRESH, "weight_only")
    .select("fundid", crsp_fundno_named="crsp_fundno")
    .join(fundno_tna.select("crsp_fundno", tna_from_name="tna_latest"),
          left_on="crsp_fundno_named", right_on="crsp_fundno", how="left")
)

out = (
    fund.join(
        fuzzy.select("fundid", fuzzy_series="series_id", fuzzy_tier="match_tier",
                     fuzzy_score="score", fuzzy_fundno="crsp_fundno"),
        on="fundid", how="left",
    )
    .with_columns(
        seriesid=pl.coalesce("iss_seriesid", "fuzzy_series"),
        match_tier=pl.when(pl.col("iss_seriesid").is_not_null() & (pl.col("n_rows_pre") == 0))
        .then(pl.lit("iss_seriesid"))
        .when(pl.col("iss_seriesid").is_not_null())
        .then(pl.lit("propagated"))
        .otherwise(pl.col("fuzzy_tier").fill_null("unresolved")),
        match_score=pl.when(pl.col("iss_seriesid").is_not_null())
        .then(None)
        .otherwise(pl.col("fuzzy_score")),
    )
    .join(series_tna, on="seriesid", how="left")
    .join(crsp_weight_match, on="fundid", how="left")
    .with_columns(
        crsp_fundno=pl.coalesce("fuzzy_fundno", "crsp_fundno_any", "crsp_fundno_named"),
        tna_latest=pl.coalesce("tna_from_series", "tna_from_name"),
    )
    .select(
        "fundid", "seriesid", "match_tier", "match_score", "n_vote_rows",
        "first_year", "last_year", "fundname_modal",
        # diagnostic extras (additive; the six required columns are above)
        "institutionid", "institutionname_modal", "iss_fundcik", "iss_nonregistrant",
        "n_seriesid", "crsp_fundno", "tna_latest",
    )
    .sort("n_vote_rows", descending=True)
)
assert out["fundid"].n_unique() == out.height, "fundid is not unique in the output"
assert out.filter(pl.col("match_tier") == "unresolved")["seriesid"].null_count() == \
    out.filter(pl.col("match_tier") == "unresolved").height, "unresolved rows carry a seriesid"
assert out.filter(pl.col("match_tier") != "unresolved")["seriesid"].null_count() == 0, \
    "resolved rows missing a seriesid"
out.write_parquet(FUNDID_SERIESID, compression=PARQUET_COMPRESSION)
print(f"wrote {out.height:,} rows -> {FUNDID_SERIESID}")

# ---------------------------------------------------------------------------
# 8. VERIFICATION
# ---------------------------------------------------------------------------
rule("VERIFY — resolution by tier (fundid count and vote-row weighted)")
tier_tbl = (
    out.group_by("match_tier")
    .agg(n_fundids=pl.len(), vote_rows=pl.col("n_vote_rows").sum(),
         mean_score=pl.col("match_score").mean())
    .with_columns(
        pct_fundids=(pl.col("n_fundids") / out.height * 100).round(2),
        pct_vote_rows=(pl.col("vote_rows") / out["n_vote_rows"].sum() * 100).round(2),
    )
    .sort("vote_rows", descending=True)
)
print(tier_tbl)
resolved_ids = out.filter(pl.col("seriesid").is_not_null())["fundid"].to_list()
print(f"\nRESOLVED overall: {len(resolved_ids):,}/{out.height:,} fundids "
      f"({len(resolved_ids) / out.height:.1%}); "
      f"{out.filter(pl.col('seriesid').is_not_null())['n_vote_rows'].sum():,}/"
      f"{out['n_vote_rows'].sum():,} vote rows "
      f"({out.filter(pl.col('seriesid').is_not_null())['n_vote_rows'].sum() / out['n_vote_rows'].sum():.1%})")
nonreg = out.filter(pl.col("iss_nonregistrant"))
print(f"of the unresolved, ISS non-registrants (pension plans / non-US managers "
      f"with no SEC seriesId by construction): "
      f"{nonreg.filter(pl.col('seriesid').is_null()).height:,} fundids, "
      f"{nonreg.filter(pl.col('seriesid').is_null())['n_vote_rows'].sum():,} vote rows")

rule(f"VERIFY — vote-row-weighted resolution by year {SAMPLE_START}-{SAMPLE_END} (VALID-04)")
# ISS non-registrants (public pension plans, non-US managers) have no SEC
# seriesId by construction, so the second denominator excludes them: that is
# the share of the *linkable* (registered-fund) vote volume actually linked.
nonreg_ids = out.filter(pl.col("iss_nonregistrant"))["fundid"].to_list()
year_tbl = (
    npx_sid.group_by("year")
    .agg(rows=pl.len(),
         rows_nonreg=pl.col("fundid").is_in(nonreg_ids).sum(),
         rows_exact=pl.col("fundid").is_in(exact_ids.to_list()).sum(),
         rows_linked=pl.col("fundid").is_in(resolved_ids).sum())
    .sort("year")
    .collect(engine="streaming")
    .with_columns(
        pct_exact=(pl.col("rows_exact") / pl.col("rows") * 100).round(1),
        pct_linked=(pl.col("rows_linked") / pl.col("rows") * 100).round(1),
        pct_linked_reg=(pl.col("rows_linked")
                        / (pl.col("rows") - pl.col("rows_nonreg")) * 100).round(1),
    )
)
year_tbl = year_tbl.with_columns(
    valid04_target=pl.when(pl.col("year") >= 2010).then(90.0)
    .when(pl.col("year") >= 2006).then(75.0).otherwise(None)
).with_columns(
    valid04_met=pl.when(pl.col("valid04_target").is_null()).then(None)
    .otherwise(pl.col("pct_linked") >= pl.col("valid04_target"))
)
print(year_tbl)
tgt = year_tbl.filter(pl.col("valid04_target").is_not_null())
print(f"\nVALID-04: {tgt['valid04_met'].sum()}/{tgt.height} target years met.")

rule("VERIFY — POWER-WEIGHTED resolution (a row-count share weights a dead "
     "micro-cap the same as Vanguard 500)")

# (a) shares actually voted. Only usable 2024+: `totalsharesvoted` is entirely
#     null 2005-2022 and 12% populated on a different scale in 2023.
shares_tbl = (
    npx_sid.filter(pl.col("year") >= L2_SHARES_WEIGHT_FIRST_YEAR)
    .with_columns(sv=pl.col("totalsharesvoted").fill_null(0.0))
    .group_by("year")
    .agg(shares=pl.col("sv").sum(),
         shares_linked=pl.col("sv").filter(pl.col("fundid").is_in(resolved_ids)).sum(),
         rows=pl.len(),
         rows_linked=pl.col("fundid").is_in(resolved_ids).sum())
    .sort("year").collect(engine="streaming")
    .with_columns(pct_shares=(pl.col("shares_linked") / pl.col("shares") * 100).round(1),
                  pct_rows=(pl.col("rows_linked") / pl.col("rows") * 100).round(1))
)
print("(a) weighted by totalsharesvoted -- ONLY measurable 2024+ "
      "(null 2005-2022, 12% populated and off-scale in 2023):")
print(shares_tbl.select("year", "rows", "pct_rows", "shares", "pct_shares"))

u24 = shares_tbl.filter(pl.col("year") == 2024).to_dicts()[0]
print(f"\n    2024: {100 - u24['pct_rows']:.1f}% of vote ROWS unresolved but only "
      f"{100 - u24['pct_shares']:.1f}% of SHARES VOTED -> the residual is concentrated "
      f"~{(100 - u24['pct_rows']) / max(100 - u24['pct_shares'], 1e-9):.0f}x in small funds.")

# (b) A CRSP `tna_latest` weight is NOT identified for the residual, and saying
#     so is the finding. TNA is reachable only through a CRSP link, and a fundid
#     that no tier could link is overwhelmingly one that no CRSP name match
#     could reach either -- so the unresolved side carries ~zero weight by
#     construction and a TNA-weighted coverage ratio reads ~100% tautologically.
#     The counts below are printed instead of that ratio.
n_un = out.filter(pl.col("seriesid").is_null()).height
n_un_w = out.filter(pl.col("seriesid").is_null())["tna_latest"].is_not_null().sum()
print(f"\n(b) weighted by CRSP tna_latest -- NOT IDENTIFIED, reported as counts:")
print(f"    fundids carrying a TNA weight            : {out['tna_latest'].is_not_null().sum():,}/{out.height:,}")
print(f"    of the UNRESOLVED, how many carry a TNA  : {n_un_w:,}/{n_un:,} ({n_un_w / n_un:.1%})")
print("    -> TNA is reachable only THROUGH a link, so a TNA-weighted coverage")
print("       ratio would read ~100% by construction. Not reported as a metric.")
if n_un_w > 0:
    res_med = out.filter(pl.col("seriesid").is_not_null())["tna_latest"].median()
    un_med = out.filter(pl.col("seriesid").is_null())["tna_latest"].median()
    print(f"    on the sliver where both are observed, median TNA ($M): "
          f"resolved {res_med:,.1f} vs unresolved {un_med:,.1f}")

# (c) What the row-weighted number therefore means.
print("\n(c) INTERPRETATION -- the row-weighted coverage table above is a "
      "conservative FLOOR on\n    power-weighted coverage, not an estimate of it. "
      "It would understate power coverage\n    unless unresolved funds were "
      "systematically LARGER than resolved ones, and the one\n    year where both "
      "are measurable shows the opposite by a wide margin (2024: "
      f"{u24['pct_rows']:.1f}% of rows\n    linked vs {u24['pct_shares']:.1f}% of shares). "
      "No size variable exists for an unlinked dead\n    fund, so 2005-2022 "
      "power-weighted coverage is not identified from these inputs.")

print(f"\ncrsp_fundno recorded on {out['crsp_fundno'].is_not_null().sum():,} fundids "
      f"(L3 can use it directly for index_fund_flag / tna).")

rule("VERIFY — spot-check of large, well-known funds")
probes = [
    "VANGUARD 500 INDEX", "FIDELITY CONTRAFUND", "SPDR S P 500", "ISHARES CORE S P 500",
    "VANGUARD TOTAL STOCK MARKET INDEX", "SPARTAN TOTAL MARKET INDEX",
    "ISHARES RUSSELL 1000", "SCHWAB S P 500 INDEX", "BLUE CHIP GROWTH",
    "GROWTH FUND OF AMERICA",
]
sc = out.with_columns(nm=norm("fundname_modal"))
for p in probes:
    hit = sc.filter(pl.col("nm").str.contains(p, literal=True)).sort(
        "n_vote_rows", descending=True).head(2)
    if hit.height == 0:
        print(f"  {p:<42} -> no ISS fundname contains this string")
    for r in hit.iter_rows(named=True):
        print(f"  {p:<42} -> {str(r['seriesid']):<12} {r['match_tier']:<17} "
              f"score={('%.3f' % r['match_score']) if r['match_score'] else '  exact':<7} "
              f"rows={r['n_vote_rows']:>8,}  | {r['fundname_modal'][:44]}")

rule("VERIFY — largest unresolved fundids (what the residual actually is)")
print(
    out.filter(pl.col("seriesid").is_null())
    .select("fundid", "fundname_modal", "institutionname_modal", "n_vote_rows",
            "first_year", "last_year", "iss_nonregistrant")
    .head(30)
)
print("\ndone.")
