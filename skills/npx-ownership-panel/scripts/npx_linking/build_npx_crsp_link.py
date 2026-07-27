"""L3 / LINK-03, DATA-01 — build `data/processed/npx_crsp_link.parquet`.

One row per ISS `fundid` (26,686), carrying the CRSP identity the observed-vote
layer actually needs: `crsp_fundno`, `index_fund_flag` (the index/passive block
split), `tna_latest` (the pre-2024 vote weight), `wficn`, and the resulting
`block`.

The SEC `seriesId` that L2 resolved is a BRIDGE, not the goal. Where L2 found
one we join through it; where it did not, we match the ISS `fundname` straight
against CRSP `fund_summary2.fund_name`, bypassing seriesId entirely.

MEASURED RESULT, contrary to the plan's premise: that second path does NOT close
the early panel. `crsp_fundno` coverage lands ~2pp BELOW L2's seriesId coverage
in every year, 2006-07 included. CRSP does retain defunct funds (every
`dead_flag='Y'` fundno carries a name), but that is not what the residual is
made of. CRSP's database covers registered OPEN-END funds, and ~30% of the
unlinked vote volume is fund types it structurally never covers: master
portfolios in master-feeder structures (the master files its own N-PX because it
holds the securities, while CRSP tracks only the feeder), insurance separate
accounts and VA subaccounts, and variable insurance trusts. They have real SEC
seriesIds, which is exactly why L2 reaches them and this task cannot. The gap
between the two coverage numbers IS that population. See VERIFY 1b.

Tiers (precision-descending, recorded in `crsp_match_tier`):
  via_seriesid      exact  L2 seriesId -> crsp_cik_map.series_cik -> crsp_fundno
  via_ticker        exact  L2 seriesId -> SEC class ticker -> fund_summary2.ticker
  via_l2_crsp_name  exact  L2 round 2's own `crsp_fundno`, consumed not re-derived
  crsp_name_scoped  fuzzy  TF-IDF fundname -> fund_name, scoped to the management
                           companies implied by the institution's linked siblings
  crsp_name_global  fuzzy  unscoped TF-IDF, never accepted on score alone
  unlinked

`fund_summary2` is CLASS-grained (a `crsp_fundno` is one share class), so every
tier aggregates classes up to the fund: `tna_latest` is SUMMED across a fund's
classes and `index_fund_flag` is the modal non-null flag (disagreements logged).

What the unlinked lose is `tna_latest` -- the pre-2024 vote WEIGHT -- not the
`block`, which is assigned for 100% of fundids (an unlinked index master lands
in `block='index'` via the name-regex fallback). VERIFY 4c measures whether that
matters by recomputing every (item, block) For-fraction on TNA-carrying funds
only: it does not.

Outputs
-------
`data/processed/npx_crsp_link.parquet`   the master, one row per fundid
`data/output/l3_coverage_by_year.csv`    vote-row coverage 2005-2025, 2 denominators
`data/output/l3_coverage_by_tier.csv`    fundids and vote rows per tier x block
`data/output/l3_tna_materiality.csv`     does the TNA-missing residual move direction?
`data/output/l3_adjudication_candidates.csv`  every fuzzy candidate considered
`data/output/l3_adjudication_unlinked.csv`    top-3 guesses for the residual
`data/output/l3_flag_disagreements.csv`  funds whose classes carry different flags

Run: python scripts/linking/build_npx_crsp_link.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cit"))

import numpy as np
import polars as pl
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn

from config_obs import (  # noqa: E402
    CLEAN_NPX,
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
    L3_APPLY_DIGIT_GUARD,
    L3_L2_CRSP_TIER,
    L3_ADJUDICATION_CANDIDATES,
    L3_ADJUDICATION_UNLINKED,
    L3_CAND_THRESHOLD,
    L3_CLASS_SUFFIX_RE,
    L3_COVERAGE_BY_TIER,
    L3_COVERAGE_BY_YEAR,
    L3_FLAG_DISAGREEMENTS,
    L3_GLOBAL_EXACTISH,
    L3_GLOBAL_MARGIN,
    L3_GLOBAL_THRESH,
    L3_INDEX_FLAG_MAP,
    L3_INDEX_NAME_BASE,
    L3_INDEX_NAME_EXT,
    L3_IN_INSTITUTIONAL,
    L3_LIFESPAN_SLACK_YEARS,
    L3_SCOPE_PASSES,
    L3_SCOPED_THRESH,
    L3_TFIDF_TOP_K,
    L3_TNA_MATERIALITY,
    L3_UNANIMITY_HI,
    L3_UNANIMITY_LO,
    MFLINK1,
    NPX_CRSP_LINK,
    NPX_SERIESID,
    PARQUET_COMPRESSION,
    SAMPLE_END,
    SAMPLE_START,
    SEC_SERIES_MASTER,
    VOTE_DIR_USABLE,
)

pl.Config.set_tbl_rows(60)
pl.Config.set_tbl_cols(24)
pl.Config.set_fmt_str_lengths(58)

IDX_RE = rf"(?i)\b({L3_INDEX_NAME_BASE}|{L3_INDEX_NAME_EXT})\b"


def rule(title):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


# ---------------------------------------------------------------------------
# name normalisation (same recipe as L2, so the two corpora are comparable)
# ---------------------------------------------------------------------------
def norm(col):
    e = pl.col(col).str.to_uppercase()
    e = e.str.replace_all(L2_FORMERLY_RE, " ")
    e = e.str.replace_all(L2_PAREN_RE, " ")
    e = e.str.replace_all(r"[^A-Z0-9&]+", " ")
    # ISS spells the ampersand out inside a token ("SandP 500"); every other
    # source writes "S&P". Folded before the punctuation strip so the digit
    # guard and the vectoriser see one spelling.
    for pat, rep in L2_AMPERSAND_FOLD:
        e = e.str.replace_all(pat, rep)
    e = e.str.replace_all(r"[^A-Z0-9]+", " ")
    e = e.str.replace_all(L2_LEGAL_SUFFIX_RE, " ")
    return e.str.replace_all(r"\s+", " ").str.strip_chars()


def digit_tokens(col):
    """The multiset of digit-bearing tokens in a normalised name, sorted."""
    return (
        pl.col(col).str.split(" ")
        .list.eval(pl.element().filter(pl.element().str.contains(L2_DIGIT_TOKEN_RE)))
        .list.sort()
    )


def designator(col):
    """A trailing series/portfolio designator ("SBL Fund Series H" -> "H")."""
    return pl.col(col).str.extract(L2_DESIGNATOR_RE, 1)


def family_token(col):
    e = norm(col)
    for w in L2_FAMILY_STOPWORDS:
        e = e.str.replace_all(rf"\b{w}\b", " ")
    e = e.str.replace_all(r"\s+", " ").str.strip_chars()
    return e.str.split(" ").list.first()


# ---------------------------------------------------------------------------
# 1. inputs
# ---------------------------------------------------------------------------
rule("L3 — inputs")

fund = pl.read_parquet(FUNDID_SERIESID)
N_FUNDIDS = fund.height
assert fund["fundid"].n_unique() == N_FUNDIDS, "fundid not unique in L2 output"
print(f"L2 fundid_seriesid                 : {N_FUNDIDS:,} fundids "
      f"({fund['n_vote_rows'].sum():,} vote rows)")
print(f"  with a seriesid                  : {fund['seriesid'].is_not_null().sum():,}")
print(f"  ISS non-registrants              : {fund['iss_nonregistrant'].sum():,} "
      f"({fund.filter('iss_nonregistrant')['n_vote_rows'].sum():,} vote rows)")

fs = pl.read_parquet(FUND_SUMMARY2)
assert fs["crsp_fundno"].n_unique() == fs.height, "fund_summary2 not one row per fundno"
print(f"\nfund_summary2 (CLASS grain)        : {fs.height:,} crsp_fundnos")
print(f"  fund_name / mgmt_name non-null   : {fs['fund_name'].is_not_null().mean():.1%} / "
      f"{fs['mgmt_name'].is_not_null().mean():.1%}")
print(f"  index_fund_flag D/B/E            : "
      f"{fs['index_fund_flag'].value_counts().sort('count', descending=True).to_dicts()}")

cikmap = pl.read_parquet(CRSP_CIK_MAP)
# Dedup on the join key BEFORE merging so a fundid can never fan out.
sid2fno = (
    cikmap.filter(pl.col("series_cik").is_not_null())
    .select(series_cik=pl.col("series_cik"), crsp_fundno=pl.col("crsp_fundno"))
    .unique()
)
print(f"\ncrsp_cik_map                       : {cikmap.height:,} rows, "
      f"{sid2fno['series_cik'].n_unique():,} series_ciks, "
      f"{sid2fno.height:,} (series, fundno) pairs")

# A crsp_fundno can carry MORE THAN ONE wficn in MFLINK1, and `keep="first"` with
# no preceding sort picks by whatever row order the parquet happens to have —
# an undefined choice on the linking critical path, since wficn is how S12
# holdings reach a fund. Measured on mflink1_cache: 50,380 rows, 49,975 distinct
# crsp_fundno, and 341 fundnos (0.68%) mapping to more than one wficn.
#
# There is no discriminator in this file to break the tie ON — it has exactly two
# columns — so this cannot be resolved into a *right* answer here. What it can be
# is DECLARED: sort first so the pick is stated (lowest wficn) rather than
# inherited from row order, and print the count so the magnitude is visible
# instead of silent. The remaining question, which wficn is correct for those 341,
# is a domain question for MFLINK and is flagged, not guessed.
_mf_raw = pl.read_parquet(MFLINK1)
_mf_amb = int(
    _mf_raw.group_by("crsp_fundno").agg(pl.col("wficn").n_unique().alias("k"))
    .filter(pl.col("k") > 1).height
)
mflink = (
    _mf_raw.sort(["crsp_fundno", "wficn"])
    .unique(subset=["crsp_fundno"], keep="first", maintain_order=True)
)
print(f"mflink1 dedup                      : {_mf_raw.height:,} rows -> "
      f"{mflink.height:,} crsp_fundno; {_mf_amb:,} map to >1 wficn and are "
      f"resolved by lowest wficn (stated, not row order)")
print(f"mflink1 (deduped on fundno)        : {mflink.height:,} rows")

# ---------------------------------------------------------------------------
# 2. class -> fund aggregation helper
# ---------------------------------------------------------------------------
fs_cls = fs.select(
    "crsp_fundno", "index_fund_flag", "tna_latest", "fund_name", "mgmt_name",
    "mgmt_cd", "dead_flag",
    crsp_last_year=pl.col("caldt").dt.year(),
).join(mflink, on="crsp_fundno", how="left")


def agg_classes(pairs, key):
    """Collapse CRSP share classes to the fund level for one grouping key.

    `pairs` is (key, crsp_fundno). Returns one row per key with the summed
    fund-level TNA, the modal non-null `index_fund_flag`, a representative
    `crsp_fundno` (largest class by TNA) and the modal `wficn` / mgmt company.
    """
    d = pairs.join(fs_cls, on="crsp_fundno", how="left")

    def modal(col, out):
        return (
            d.filter(pl.col(col).is_not_null())
            .group_by([key, col]).agg(n=pl.len())
            .sort([key, "n", col], descending=[False, True, False])
            .group_by(key, maintain_order=True).head(1)
            .select(key, pl.col(col).alias(out))
        )

    flag = modal("index_fund_flag", "index_fund_flag")
    wf = modal("wficn", "wficn")
    mgc = modal("mgmt_cd", "mgmt_cd")
    mgn = modal("mgmt_name", "mgmt_name")
    rep = (
        d.sort([key, "tna_latest", "crsp_fundno"], descending=[False, True, False],
               nulls_last=True)
        .group_by(key, maintain_order=True).head(1)
        .select(key, crsp_fundno=pl.col("crsp_fundno"), crsp_fund_name=pl.col("fund_name"))
    )
    base = d.group_by(key).agg(
        n_crsp_classes=pl.col("crsp_fundno").n_unique(),
        tna_latest=pl.col("tna_latest").sum(),
        n_tna=pl.col("tna_latest").is_not_null().sum(),
        n_flags=pl.col("index_fund_flag").drop_nulls().n_unique(),
        crsp_last_year=pl.col("crsp_last_year").max(),
        n_dead=(pl.col("dead_flag") == "Y").sum(),
    ).with_columns(
        tna_latest=pl.when(pl.col("n_tna") > 0).then(pl.col("tna_latest")).otherwise(None)
    ).drop("n_tna")
    return (
        base.join(rep, on=key, how="left").join(flag, on=key, how="left")
        .join(wf, on=key, how="left").join(mgc, on=key, how="left")
        .join(mgn, on=key, how="left")
    )


# ---------------------------------------------------------------------------
# 3. tier 1 — via_seriesid
# ---------------------------------------------------------------------------
rule("tier via_seriesid — L2 seriesId -> crsp_cik_map -> crsp_fundno")

sid_agg = agg_classes(sid2fno.rename({"series_cik": "seriesid"}), "seriesid")
print(f"seriesids resolvable in CRSP       : {sid_agg.height:,}")
print(f"  classes per series (mean)        : {sid_agg['n_crsp_classes'].mean():.2f}")
disagree = sid_agg.filter(pl.col("n_flags") > 1)
print(f"  series whose classes DISAGREE on index_fund_flag: {disagree.height:,} "
      f"({disagree.height / max(sid_agg.filter(pl.col('n_flags') > 0).height, 1):.2%} of "
      f"flagged series) -> modal flag kept, all logged")

t1 = (
    fund.filter(pl.col("seriesid").is_not_null())
    .select("fundid", "seriesid")
    .join(sid_agg, on="seriesid", how="inner")
    .with_columns(crsp_match_tier=pl.lit("via_seriesid"), crsp_match_score=pl.lit(1.0))
)
assert t1["fundid"].n_unique() == t1.height, "via_seriesid fanned out a fundid"
print(f"\nfundids linked                     : {t1.height:,}")

# ---------------------------------------------------------------------------
# 4. tier 2 — via_ticker (seriesIds CRSP's CIK map does not carry)
# ---------------------------------------------------------------------------
rule("tier via_ticker — seriesId -> SEC class ticker -> CRSP ticker")

sec_tick = (
    pl.read_parquet(SEC_SERIES_MASTER)
    .select("series_id", ticker=pl.col("class_ticker").str.to_uppercase().str.strip_chars())
    .filter(pl.col("ticker").str.len_chars() >= 3)
    .unique()
)
# A ticker is only usable as an identifier if it points at exactly one series on
# the SEC side and exactly one fundno on the CRSP side.
sec_uniq = sec_tick.group_by("ticker").agg(n=pl.col("series_id").n_unique()).filter(pl.col("n") == 1)
crsp_tick = (
    fs.select("crsp_fundno", ticker=pl.col("ticker").str.to_uppercase().str.strip_chars())
    .filter(pl.col("ticker").str.len_chars() >= 3)
    .unique()
)
crsp_uniq = crsp_tick.group_by("ticker").agg(n=pl.col("crsp_fundno").n_unique()).filter(pl.col("n") == 1)
bridge = (
    sec_tick.join(sec_uniq.select("ticker"), on="ticker", how="semi")
    .join(crsp_tick.join(crsp_uniq.select("ticker"), on="ticker", how="semi"),
          on="ticker", how="inner")
    .select(seriesid=pl.col("series_id"), crsp_fundno=pl.col("crsp_fundno"))
    .unique()
)
print(f"unambiguous SEC<->CRSP ticker pairs : {bridge.height:,} "
      f"({bridge['seriesid'].n_unique():,} seriesids)")

need2 = fund.join(t1.select("fundid"), on="fundid", how="anti").filter(
    pl.col("seriesid").is_not_null() & ~pl.col("iss_nonregistrant")
)
tick_agg = agg_classes(bridge.join(need2.select("seriesid").unique(), on="seriesid",
                                   how="semi"), "seriesid")
t2 = (
    need2.select("fundid", "seriesid").join(tick_agg, on="seriesid", how="inner")
    .with_columns(crsp_match_tier=pl.lit("via_ticker"), crsp_match_score=pl.lit(1.0))
)
assert t2["fundid"].n_unique() == t2.height, "via_ticker fanned out a fundid"
print(f"seriesids L2 found but CRSP's CIK map does not carry: {need2['seriesid'].n_unique():,} "
      f"({need2.height:,} fundids, {need2['n_vote_rows'].sum():,} vote rows)")
print(f"fundids linked by the ticker bridge : {t2.height:,} "
      f"({t2.join(fund.select('fundid', 'n_vote_rows'), on='fundid')['n_vote_rows'].sum():,} vote rows)")

exact = pl.concat([t1, t2], how="diagonal_relaxed")

# ---------------------------------------------------------------------------
# 5. CRSP fund-name corpus (fund grain, classes collapsed on crsp_portno)
# ---------------------------------------------------------------------------
rule("CRSP name corpus")

named = fs.filter(pl.col("fund_name").is_not_null()).with_columns(
    unit=pl.when(pl.col("crsp_portno").is_not_null())
    .then(pl.format("P{}", pl.col("crsp_portno").cast(pl.Int64)))
    .otherwise(pl.format("F{}", pl.col("crsp_fundno").cast(pl.Int64)))
)
print(f"named crsp_fundnos                 : {named.height:,} "
      f"-> {named['unit'].n_unique():,} fund units (classes collapsed on crsp_portno)")

unit_agg = agg_classes(named.select("unit", "crsp_fundno"), "unit")

# "<Trust>: <Fund>; <Class> Shares" -> both "<Trust> <Fund>" and "<Fund>" enter
# the corpus, because ISS `fundname` is sometimes trust-qualified and sometimes not.
unit_names = (
    named.with_columns(base=pl.col("fund_name").str.replace(L3_CLASS_SUFFIX_RE, ""))
    .with_columns(short=pl.col("base").str.split(":").list.last())
    .select("unit", "base", "short")
)
corpus = pl.concat([
    unit_names.select("unit", name=norm("base"), src=pl.lit("trust_fund")),
    unit_names.select("unit", name=norm("short"), src=pl.lit("fund")),
]).filter(pl.col("name").str.len_chars() > 3).unique(subset=["unit", "name"], keep="first")
corpus = (
    corpus.join(unit_agg, on="unit", how="left")
    .with_columns(mgmt_norm=norm("mgmt_name").fill_null(""))
    .with_columns(name_n_units=pl.col("unit").n_unique().over("name"))
    # (P) ORDER IS LOAD-BEARING. This frame feeds BOTH the TF-IDF corpus (via
    # .to_list()) AND the col->unit mapping (via with_row_index). polars joins do
    # not guarantee order, and the .unique(keep="first") above is itself
    # order-dependent, so without a pinned sort the corpus order varies between
    # runs and sp_matmul_topn(top_n=K) keeps a DIFFERENT candidate set among
    # near-ties. Measured on a sibling copy of this ladder: two cold runs differed
    # on 93 match_tier / 172 crsp_fundno / 1 block. Not a tie-break bug -- the
    # corpus index itself was moving underneath the matcher.
    .sort("unit", "name", "src")
)
print(f"corpus rows                        : {corpus.height:,} "
      f"({corpus['name'].n_unique():,} distinct names; "
      f"{corpus.filter(pl.col('name_n_units') > 1)['name'].n_unique():,} shared by >1 unit)")
print(f"corpus units carrying an index flag: "
      f"{unit_agg['index_fund_flag'].is_not_null().sum():,} / {unit_agg.height:,}")

# ---------------------------------------------------------------------------
# 5b. tier — L2's own CRSP resolution, consumed rather than re-derived
# ---------------------------------------------------------------------------
rule(f"tier {L3_L2_CRSP_TIER} — L2's `crsp_fundno`, consumed as an exact input")

if "crsp_fundno" in fund.columns:
    # L2 round 2 added a CRSP name tier of its own and emits `crsp_fundno`.
    # L3 consumes it instead of re-deriving the same match. The column is
    # CLASS-grained (one share class), so it is lifted to the fund unit and
    # aggregated exactly as the other tiers are -- otherwise an L2-sourced fund
    # would carry one class's TNA while a seriesId-sourced one carries the
    # whole fund's, and the two would not be comparable as vote weights.
    # Same undefined choice as the mflink1 dedup above: no sort, so `keep="first"`
    # picks a unit for a fundno that spans units by row order. Sort so the pick is
    # stated (lowest unit) rather than inherited.
    fno2unit = (
        named.select("crsp_fundno", "unit")
        .sort(["crsp_fundno", "unit"])
        .unique(subset=["crsp_fundno"], keep="first", maintain_order=True)
    )
    l2c = (
        fund.join(exact.select("fundid"), on="fundid", how="anti")
        .filter(pl.col("crsp_fundno").is_not_null() & ~pl.col("iss_nonregistrant"))
        .select("fundid", l2_fundno="crsp_fundno")
        .join(fno2unit, left_on="l2_fundno", right_on="crsp_fundno", how="left")
    )
    t2b = (
        l2c.filter(pl.col("unit").is_not_null())
        .join(unit_agg, on="unit", how="inner")
        .with_columns(crsp_match_tier=pl.lit(L3_L2_CRSP_TIER), crsp_match_score=pl.lit(1.0))
        .drop("l2_fundno", "unit")
    )
    # a fundno CRSP gives no name has no unit; keep it as a singleton class
    t2c = (
        l2c.filter(pl.col("unit").is_null()).drop("unit")
        .rename({"l2_fundno": "crsp_fundno"})
        .join(fs_cls.drop("fund_name", "mgmt_name", "dead_flag"), on="crsp_fundno", how="left")
        .with_columns(n_crsp_classes=pl.lit(1, dtype=pl.UInt32),
                      n_flags=pl.lit(0, dtype=pl.UInt32),
                      crsp_match_tier=pl.lit(L3_L2_CRSP_TIER), crsp_match_score=pl.lit(1.0))
    )
    print(f"fundids L2 reached that the exact ID tiers did not: {l2c.height:,} "
          f"({t2b.height:,} lift to a named CRSP fund unit, {t2c.height:,} to an "
          f"unnamed singleton class)")
    exact = pl.concat([exact, t2b, t2c], how="diagonal_relaxed")
    assert exact["fundid"].n_unique() == exact.height, f"{L3_L2_CRSP_TIER} fanned out a fundid"
else:
    print("L2 output carries no `crsp_fundno` column (pre-round-2 vintage) — tier skipped")

# ---------------------------------------------------------------------------
# 6. TF-IDF candidates for everything the exact tiers did not reach
# ---------------------------------------------------------------------------
rule("TF-IDF candidate generation (ISS fundname -> CRSP fund_name)")

todo = (
    fund.join(exact.select("fundid"), on="fundid", how="anti")
    .filter(~pl.col("iss_nonregistrant"))
    .with_columns(fundname_norm=norm("fundname_modal"),
                  family=family_token("institutionname_modal"))
    .filter(pl.col("fundname_norm").str.len_chars() > 3)
    # (P) same reason as `corpus` above: this frame is both the TF-IDF left-hand
    # corpus and the row->fundid map, and it comes out of an anti-join whose row
    # order polars does not guarantee. Pin it.
    .sort("fundid")
)
print(f"fundids needing a CRSP name match  : {todo.height:,} "
      f"({todo['n_vote_rows'].sum():,} vote rows)")
print(f"  of which L2 left unresolved      : "
      f"{todo.filter(pl.col('match_tier') == 'unresolved').height:,}")
print(f"  of which L2 resolved but CRSP has no such series: "
      f"{todo.filter(pl.col('match_tier') != 'unresolved').height:,}")

L_names = todo["fundname_norm"].to_list()
R_names = corpus["name"].to_list()
vec = TfidfVectorizer(analyzer=L2_TFIDF_ANALYZER, ngram_range=L2_TFIDF_NGRAM, min_df=1)
vec.fit(L_names + R_names)
M = sp_matmul_topn(vec.transform(L_names), vec.transform(R_names).T,
                   top_n=L3_TFIDF_TOP_K, threshold=L3_CAND_THRESHOLD, sort=True).tocoo()
cand = pl.DataFrame({"row": M.row.astype(np.int32), "col": M.col.astype(np.int32),
                     "score": M.data.astype(np.float64)})
print(f"candidate pairs @ {L2_TFIDF_NGRAM}, thresh {L3_CAND_THRESHOLD}: {cand.height:,}")

cand = (
    cand.join(todo.with_row_index("row").with_columns(pl.col("row").cast(pl.Int32))
              .select("row", "fundid", "fundname_norm", "fundname_modal", "institutionid",
                      "institutionname_modal", "family", "n_vote_rows", "first_year",
                      "last_year", "seriesid"),
              on="row", how="left")
    .join(corpus.with_row_index("col").with_columns(pl.col("col").cast(pl.Int32))
          .select("col", "unit", "name", "src", "crsp_fund_name", "mgmt_cd", "mgmt_name",
                  "mgmt_norm", "crsp_last_year", "name_n_units"),
          on="col", how="left")
    .drop("row", "col")
)

# Lifespan guard: a CRSP fund whose last summary predates the ISS fund's first
# vote cannot be the same fund. Independent of the name score, and it bites
# exactly where the name tiers work (dead early-panel funds).
n_before = cand.height
cand = cand.filter(
    pl.col("crsp_last_year").is_null()
    | (pl.col("crsp_last_year") >= pl.col("first_year") - L3_LIFESPAN_SLACK_YEARS)
)
print(f"candidates dropped by the lifespan guard (CRSP fund died before the ISS "
      f"fund first voted): {n_before - cand.height:,}")

cand = cand.with_columns(
    family_agree=(
        pl.col("family").is_not_null() & (pl.col("family").str.len_chars() >= 3)
        & (pl.col("mgmt_norm").str.contains(pl.col("family"), literal=True)
           | pl.col("name").str.contains(pl.col("family"), literal=True))
    ),
    mgmt_scope=pl.lit(False),
)

# Digit-token / designator guard (L2 round 2's, same corpus, same failure mode):
# char-ngram TF-IDF underweights exactly the tokens that discriminate between
# sibling funds of one family, which is the regime the fuzzy tiers work in.
if L3_APPLY_DIGIT_GUARD:
    n_before = cand.height
    cand = cand.with_columns(
        digits_match=digit_tokens("fundname_norm") == digit_tokens("name"),
        desig_match=(designator("fundname_norm").is_null()
                     & designator("name").is_null())
        | (designator("fundname_norm") == designator("name")),
    )
    n_dig = cand.filter(~pl.col("digits_match")).height
    n_des = cand.filter(pl.col("digits_match") & ~pl.col("desig_match")).height
    cand = cand.filter(pl.col("digits_match") & pl.col("desig_match"))
    print(f"candidates dropped by the digit-token guard: {n_dig:,} "
          f"(e.g. Russell 2000 vs Russell 1000); by the series-designator guard: "
          f"{n_des:,} (e.g. SBL Fund Series 0 vs Series H) — {n_before - cand.height:,} total")

# ---------------------------------------------------------------------------
# 7. institution -> management-company scope, bootstrapped
# ---------------------------------------------------------------------------
fundid2inst = fund.select("fundid", "institutionid")


def build_inst_mgmt(linked_units):
    """institutionid -> the CRSP mgmt_cds its already-linked funds sit under."""
    return (
        linked_units.join(fundid2inst, on="fundid", how="left")
        .select("institutionid", "mgmt_cd").drop_nulls().unique()
    )


inst_mgmt = build_inst_mgmt(exact.select("fundid", "mgmt_cd"))
print(f"\ninstitution->mgmt_cd pairs from exactly-linked siblings: {inst_mgmt.height:,} "
      f"({inst_mgmt['institutionid'].n_unique():,} institutions)")
cov = todo.join(inst_mgmt.select("institutionid").unique(), on="institutionid", how="semi")
print(f"unlinked fundids whose institution has a mgmt scope: {cov.height:,} "
      f"({cov['n_vote_rows'].sum():,} vote rows)")


def with_mgmt_scope(df, im):
    return df.drop("mgmt_scope", strict=False).join(
        im.with_columns(mgmt_scope=pl.lit(True)), on=["institutionid", "mgmt_cd"], how="left"
    ).with_columns(mgmt_scope=pl.col("mgmt_scope").fill_null(False))


def best(df, mask, thresh, tier):
    """Top-scoring in-scope candidate per fundid, with the top-2 margin.

    Candidates are collapsed to one row per (fundid, name) FIRST: one
    normalised name can point at several CRSP units, and the margin test is
    meant to measure ambiguity between *different* candidate names, not
    re-penalise a same-name collision (L2 finding).
    """
    sub = (
        df.filter(mask & (pl.col("score") >= thresh))
        .sort(["fundid", "score", "family_agree", "crsp_last_year", "unit"],
              descending=[False, True, True, True, False])
        .unique(subset=["fundid", "name"], keep="first", maintain_order=True)
    )
    top = sub.group_by("fundid", maintain_order=True).head(1)
    second = (
        sub.join(top.select("fundid", top_unit="unit"), on="fundid", how="left")
        .filter(pl.col("unit") != pl.col("top_unit"))
        .group_by("fundid").agg(score2=pl.col("score").max())
    )
    return (
        top.join(second, on="fundid", how="left")
        .with_columns(score2=pl.col("score2").fill_null(0.0), crsp_match_tier=pl.lit(tier))
        .with_columns(margin=pl.col("score") - pl.col("score2"))
    )


# ---------------------------------------------------------------------------
# 8. tiers 3 and 4, bootstrapped (scoped -> global -> regrow scope -> repeat)
# ---------------------------------------------------------------------------
rule("fuzzy tier assignment")

accepted = []
remaining = set(todo["fundid"].to_list())
g_all = None

for i in range(L3_SCOPE_PASSES):
    t3 = best(with_mgmt_scope(cand.filter(pl.col("fundid").is_in(list(remaining))), inst_mgmt),
              pl.col("mgmt_scope"), L3_SCOPED_THRESH, "crsp_name_scoped")
    accepted.append(t3)
    remaining -= set(t3["fundid"].to_list())
    print(f"tier crsp_name_scoped (>= {L3_SCOPED_THRESH}) pass {i + 1}: {t3.height:,} fundids, "
          f"{t3['n_vote_rows'].sum():,} vote rows "
          f"(scope: {inst_mgmt.height:,} institution-mgmt pairs)")

    g_all = best(cand.filter(pl.col("fundid").is_in(list(remaining))), pl.lit(True),
                 L3_GLOBAL_THRESH, "crsp_name_global")
    # Never accepted on score alone (L2's "MID CAP GROWTH PORTFOLIO" guard):
    # an unambiguous top-1 (margin over the next candidate NAME) PLUS a second
    # independent signal -- the ISS family token in the CRSP management/fund
    # name, or a normalised-name identity on a name unique in the whole corpus.
    g_all = g_all.with_columns(
        accept=(pl.col("margin") >= L3_GLOBAL_MARGIN)
        & (pl.col("family_agree")
           | ((pl.col("score") >= L3_GLOBAL_EXACTISH) & (pl.col("name_n_units") == 1)))
    )
    t4 = g_all.filter(pl.col("accept")).drop("accept")
    accepted.append(t4)
    remaining -= set(t4["fundid"].to_list())
    print(f"tier crsp_name_global (>= {L3_GLOBAL_THRESH}) pass {i + 1}: {t4.height:,} fundids "
          f"accepted, {t4['n_vote_rows'].sum():,} vote rows")

    if i + 1 < L3_SCOPE_PASSES:
        # The scope only grows from the UNSCOPED tier: a scoped match is inside
        # the scope by construction and reveals no new management company.
        inst_mgmt = build_inst_mgmt(
            pl.concat([exact.select("fundid", "mgmt_cd"),
                       pl.concat(accepted, how="diagonal_relaxed").select("fundid", "mgmt_cd")])
        )

cand = with_mgmt_scope(cand, inst_mgmt)
rej = g_all.filter(~pl.col("accept"))
print(f"  global candidates over the score bar but REJECTED: {rej.height:,} "
      f"(margin < {L3_GLOBAL_MARGIN}: {g_all.filter(pl.col('margin') < L3_GLOBAL_MARGIN).height:,}; "
      f"no second signal: {rej.filter(pl.col('margin') >= L3_GLOBAL_MARGIN).height:,}, of which "
      f"{rej.filter((pl.col('margin') >= L3_GLOBAL_MARGIN) & (pl.col('score') >= L3_GLOBAL_EXACTISH) & (pl.col('name_n_units') > 1)).height:,} "
      f"scored exact on a name shared by several CRSP funds)")

fuzzy = pl.concat(accepted, how="diagonal_relaxed")
assert fuzzy["fundid"].n_unique() == fuzzy.height, "a fundid was accepted by two fuzzy tiers"
fuzzy = fuzzy.join(unit_agg.select("unit", "crsp_fundno", "index_fund_flag", "tna_latest",
                                   "wficn", "n_crsp_classes", "n_flags"),
                   on="unit", how="left").rename({"score": "crsp_match_score"})

# ---------------------------------------------------------------------------
# 9. assemble the master
# ---------------------------------------------------------------------------
rule("assembling npx_crsp_link")

links = pl.concat([
    exact.select("fundid", "crsp_fundno", "index_fund_flag", "tna_latest", "wficn",
                 "crsp_match_tier", "crsp_match_score", "n_crsp_classes", "n_flags"),
    fuzzy.select("fundid", "crsp_fundno", "index_fund_flag", "tna_latest", "wficn",
                 "crsp_match_tier", "crsp_match_score", "n_crsp_classes", "n_flags"),
], how="vertical_relaxed")
assert links["fundid"].n_unique() == links.height, "a fundid was linked twice"

# ISS non-registrants (public pensions, non-US managers) have no SEC seriesId by
# construction, so any CRSP identity they carry came from an L2 NAME match and
# is a false positive -- every one is a Canadian/UK fund matched onto a
# similarly named US registrant. They are asset owners, not link failures.
nr_linked = links.join(fund.filter("iss_nonregistrant").select("fundid"), on="fundid", how="semi")
print(f"dropped {nr_linked.height:,} CRSP links held by ISS non-registrants "
      f"(all reached through an L2 name match, none exact -- non-US funds matched onto "
      f"similarly named US registrants)")
links = links.join(fund.filter("iss_nonregistrant").select("fundid"), on="fundid", how="anti")

out = (
    fund.select("fundid", "seriesid", "match_tier", "iss_nonregistrant", "n_vote_rows",
                "fundname_modal", "institutionname_modal")
    .with_columns(seriesid=pl.when("iss_nonregistrant").then(None).otherwise(pl.col("seriesid")))
    .join(links, on="fundid", how="left")
    .with_columns(
        crsp_match_tier=pl.when(pl.col("iss_nonregistrant")).then(pl.lit("unlinked"))
        .otherwise(pl.col("crsp_match_tier").fill_null("unlinked")),
        in_institutional=pl.lit(L3_IN_INSTITUTIONAL),
        idx_name=pl.col("fundname_modal").fill_null("").str.contains(IDX_RE),
    )
    .with_columns(
        block=pl.when(pl.col("iss_nonregistrant")).then(pl.lit("asset_owner"))
        .when(pl.col("index_fund_flag") == "D").then(pl.lit("index"))
        .when(pl.col("index_fund_flag").is_in(["B", "E"])).then(pl.lit("passive"))
        .when(pl.col("crsp_fundno").is_not_null()).then(pl.lit("active"))
        .when(pl.col("idx_name")).then(pl.lit("index"))
        .otherwise(pl.lit("active")),
        block_source=pl.when(pl.col("iss_nonregistrant")).then(pl.lit("nonregistrant"))
        .when(pl.col("index_fund_flag").is_not_null()).then(pl.lit("crsp_flag"))
        .when(pl.col("crsp_fundno").is_not_null()).then(pl.lit("crsp_active"))
        .when(pl.col("idx_name")).then(pl.lit("name_regex"))
        .otherwise(pl.lit("name_default")),
    )
    .select("fundid", "seriesid", "crsp_fundno", "wficn", "index_fund_flag", "tna_latest",
            "block", "block_source", "in_institutional", "match_tier", "crsp_match_tier",
            "crsp_match_score", "iss_nonregistrant", "n_vote_rows", "n_crsp_classes",
            "fundname_modal", "institutionname_modal")
    .sort("fundid")
)

assert out.height == N_FUNDIDS, f"row count changed: {out.height} != {N_FUNDIDS} (fanout)"
assert out["fundid"].n_unique() == out.height, "fundid not unique in the output"
assert out.filter(pl.col("iss_nonregistrant"))["crsp_fundno"].null_count() == \
    out.filter(pl.col("iss_nonregistrant")).height, "a non-registrant carries a crsp_fundno"
out.write_parquet(NPX_CRSP_LINK, compression=PARQUET_COMPRESSION)
print(f"wrote {NPX_CRSP_LINK} — {out.height:,} rows x {out.width} cols")

# ---------------------------------------------------------------------------
# 10. VERIFY
# ---------------------------------------------------------------------------
rule("VERIFY 1 — vote-row coverage of crsp_fundno by year, vs L2's seriesId")

fy = (
    pl.scan_parquet(NPX_SERIESID)
    .select("fundid", year=pl.col("meetingdate").dt.year())
    .group_by(["fundid", "year"]).agg(n=pl.len())
    .collect(engine="streaming")
    .filter(pl.col("year").is_between(SAMPLE_START, SAMPLE_END))
)
fy = fy.join(out.select("fundid", "crsp_fundno", "seriesid", "iss_nonregistrant",
                        "crsp_match_tier", "block", "tna_latest"), on="fundid", how="left")
byyear = (
    fy.group_by("year").agg(
        rows=pl.col("n").sum(),
        rows_reg=pl.col("n").filter(~pl.col("iss_nonregistrant")).sum(),
        crsp=pl.col("n").filter(pl.col("crsp_fundno").is_not_null()).sum(),
        crsp_reg=pl.col("n").filter(pl.col("crsp_fundno").is_not_null()
                                    & ~pl.col("iss_nonregistrant")).sum(),
        l2_sid=pl.col("n").filter(pl.col("seriesid").is_not_null()).sum(),
        tna=pl.col("n").filter(pl.col("tna_latest").is_not_null()).sum(),
    )
    .sort("year")
    .with_columns(
        pct_crsp=(pl.col("crsp") / pl.col("rows") * 100).round(1),
        pct_crsp_reg=(pl.col("crsp_reg") / pl.col("rows_reg") * 100).round(1),
        pct_l2_seriesid=(pl.col("l2_sid") / pl.col("rows") * 100).round(1),
        pct_tna=(pl.col("tna") / pl.col("rows") * 100).round(1),
    )
    .with_columns(delta_vs_L2=(pl.col("pct_crsp") - pl.col("pct_l2_seriesid")).round(1))
)
print(byyear.select("year", "rows", "pct_l2_seriesid", "pct_crsp", "delta_vs_L2",
                    "rows_reg", "pct_crsp_reg", "pct_tna"))
byyear.write_csv(L3_COVERAGE_BY_YEAR)

tot = fy["n"].sum()
tot_c = fy.filter(pl.col("crsp_fundno").is_not_null())["n"].sum()
tot_r = fy.filter(~pl.col("iss_nonregistrant"))["n"].sum()
tot_cr = fy.filter(pl.col("crsp_fundno").is_not_null() & ~pl.col("iss_nonregistrant"))["n"].sum()
print(f"\nPANEL-WIDE crsp_fundno coverage    : {tot_c:,} / {tot:,} vote rows = {tot_c / tot:.1%}")
print(f"  registrant-only denominator      : {tot_cr:,} / {tot_r:,} = {tot_cr / tot_r:.1%}")
for y in (2006, 2007):
    r = byyear.filter(pl.col("year") == y).row(0, named=True)
    print(f"  {y}: L2 seriesId {r['pct_l2_seriesid']}% -> crsp_fundno {r['pct_crsp']}% "
          f"({r['delta_vs_L2']:+}pp; registrant-only {r['pct_crsp_reg']}%)")

rule("VERIFY 1b — what the unlinked residual actually IS")

# The plan expected CRSP to close 2006-07 because it retains defunct funds. It
# does -- every dead_flag='Y' fundno in fund_summary2 carries a name -- but that
# is not what the residual is made of. CRSP's mutual-fund database covers
# registered open-end funds; a large part of the N-PX filer population is not
# one. Master portfolios in master-feeder structures file their own N-PX (they
# hold the securities) while CRSP tracks only the FEEDER; insurance separate
# accounts and variable-annuity subaccounts are not RICs in CRSP at all.
struct_pats = {
    "master_feeder": r"\bMASTER\b|PORTFOLIO$|SERIES$",
    "separate_account_VA": r"SEPARATE ACCOUNT|\bVA-\d|VARIABLE ACCOUNT|\bCREF\b|SUBACCOUNT",
    "insurance_variable": r"INSURANCE TRUST|\bVIP\b|V\.I\.|VARIABLE",
}
resid = out.filter(pl.col("crsp_fundno").is_null() & ~pl.col("iss_nonregistrant")).with_columns(
    [pl.col("fundname_modal").fill_null("").str.to_uppercase().str.contains(v).alias(k)
     for k, v in struct_pats.items()]
)
rtot = resid["n_vote_rows"].sum()
print(f"unlinked REGISTRANT fundids        : {resid.height:,} ({rtot:,} vote rows)")
for k in struct_pats:
    s = resid.filter(pl.col(k))
    print(f"  {k:<20} {s.height:>5} fundids {s['n_vote_rows'].sum():>10,} "
          f"({s['n_vote_rows'].sum() / rtot:5.1%})")
anyk = resid.filter(pl.any_horizontal([pl.col(k) for k in struct_pats]))
print(f"  {'ANY of the above':<20} {anyk.height:>5} fundids {anyk['n_vote_rows'].sum():>10,} "
      f"({anyk['n_vote_rows'].sum() / rtot:5.1%})  <- outside CRSP's open-end universe")
print(f"\nunlinked ISS non-registrants (asset owners, NOT link failures): "
      f"{out.filter('iss_nonregistrant').height:,} fundids "
      f"({out.filter('iss_nonregistrant')['n_vote_rows'].sum():,} vote rows)")
print(f"\nblock is assigned for {out.filter(pl.col('block').is_not_null()).height:,} / "
      f"{N_FUNDIDS:,} fundids (100%) — an unlinked master portfolio still lands in the "
      f"index block via the name fallback; what it loses is `tna_latest`, i.e. the "
      f"pre-2024 vote WEIGHT, not the block.")

rule("VERIFY 2 — coverage by crsp_match_tier")

tier = (
    out.group_by("crsp_match_tier").agg(fundids=pl.len(), vote_rows=pl.col("n_vote_rows").sum())
    .with_columns(pct_fundids=(pl.col("fundids") / N_FUNDIDS * 100).round(1),
                  pct_vote_rows=(pl.col("vote_rows") / out["n_vote_rows"].sum() * 100).round(1))
    .sort("vote_rows", descending=True)
)
print(tier)
print("\nby tier x block:")
tb = (out.group_by("crsp_match_tier", "block")
      .agg(fundids=pl.len(), vote_rows=pl.col("n_vote_rows").sum())
      .sort(["crsp_match_tier", "vote_rows"], descending=[False, True]))
print(tb)
tb.write_csv(L3_COVERAGE_BY_TIER)

rule("VERIFY 3 — index_fund_flag distribution and block assignment")

print(out.group_by("index_fund_flag").agg(fundids=pl.len(),
                                          vote_rows=pl.col("n_vote_rows").sum())
      .sort("fundids", descending=True))
blk = (out.group_by("block", "block_source")
       .agg(fundids=pl.len(), vote_rows=pl.col("n_vote_rows").sum(),
            tna_B=(pl.col("tna_latest").sum() / 1e3).round(1))
       .sort(["block", "vote_rows"], descending=[False, True]))
print(blk)
print("\nblock totals (fundid- and vote-row-weighted):")
print(out.group_by("block").agg(fundids=pl.len(), vote_rows=pl.col("n_vote_rows").sum())
      .with_columns(pct_fundids=(pl.col("fundids") / N_FUNDIDS * 100).round(1),
                    pct_vote_rows=(pl.col("vote_rows") / out["n_vote_rows"].sum() * 100).round(1))
      .sort("vote_rows", descending=True))
print(f"\nin_institutional = True on all {out['in_institutional'].sum():,} rows "
      f"(the registered subset of the 13F block; the block's SIZE comes from "
      f"pass.parquet, its observed DIRECTION only from these registered filers)")

rule("VERIFY 4 — tna_latest")

lk = out.filter(pl.col("crsp_fundno").is_not_null())
print(f"linked fundids                     : {lk.height:,}")
print(f"  tna_latest non-null              : {lk['tna_latest'].is_not_null().mean():.1%}")
print(f"  vote-row-weighted non-null       : "
      f"{lk.filter(pl.col('tna_latest').is_not_null())['n_vote_rows'].sum() / lk['n_vote_rows'].sum():.1%}")
print(f"  median TNA ($M)                  : {lk['tna_latest'].median():,.1f}")
# ISS fundid is often share-class-grained, so several fundids share one CRSP
# fund and its TNA. Summing over fundids double-counts; the magnitude check has
# to be done over DISTINCT crsp_fundnos.
# Not merely a count: the SURVIVING row's tna_latest is summed below, so which
# row wins changes the printed total. Sorted so it is the largest TNA for that
# fundno rather than whichever row came first.
uniq = (
    lk.sort(["crsp_fundno", "tna_latest"], descending=[False, True], nulls_last=True)
    .unique(subset=["crsp_fundno"], keep="first", maintain_order=True)
)
print(f"  total TNA over distinct crsp_fundnos: ${uniq['tna_latest'].sum() / 1e6:,.2f}T "
      f"across {uniq.height:,} funds (summing over fundids would double-count to "
      f"${lk['tna_latest'].sum() / 1e6:,.2f}T -- {lk.height:,} fundids map to "
      f"{uniq.height:,} CRSP funds). NB `tna_latest` is TNA at each fund's LAST summary "
      f"date, so a dead fund contributes its TNA at death: this is not a point-in-time "
      f"industry total.")
print("\ntop 20 linked funds by tna_latest ($M):")
print(lk.sort("tna_latest", descending=True, nulls_last=True).head(20)
      .select("fundname_modal", "institutionname_modal", "tna_latest", "index_fund_flag",
              "block", "crsp_match_tier"))

rule("VERIFY 4b — weight-concentration hazard (matters for T3's pre-2024 weight)")

# `tna_latest` is the pre-2024 vote WEIGHT, so a mis-linked fundid does not just
# lose a fund -- it imports another fund's size. The failure mode is asymmetric:
# a fuzzy match that lands on a mega-fund gives a fundid with a handful of vote
# rows an enormous weight. Example found in this build: ISS fundids "VANGUARD
# TOTAL BOND MARKET INDEX FUND" and "...MARKET II" (13 vote rows each, 2012 only)
# were resolved by an L2 NAME tier onto S000002848 = Vanguard Total *Stock*
# Market Index Fund, and so inherit its $2.0T. T3 should weight within-block, and
# these rows are listed here so the tail can be audited or trimmed.
FUZZY_L2 = ("cik_scoped_name", "inst_scoped_name", "global_name")
FUZZY_L3 = ("crsp_name_scoped", "crsp_name_global")
haz = (
    out.filter(
        pl.col("tna_latest").is_not_null()
        & (pl.col("match_tier").is_in(FUZZY_L2) | pl.col("crsp_match_tier").is_in(FUZZY_L3))
    )
    .with_columns(tna_per_vote=pl.col("tna_latest") / pl.col("n_vote_rows"))
    .sort("tna_per_vote", descending=True)
)
print(f"fundids whose CRSP identity came through a fuzzy tier (L2 name or L3 name) "
      f"AND carry a TNA: {haz.height:,}")
print(f"  their share of total fundid-grain TNA: "
      f"{haz['tna_latest'].sum() / out['tna_latest'].sum():.1%}")
print("\ntop 12 by TNA per vote row (the ones to audit):")
print(haz.head(12).select("fundname_modal", "institutionname_modal", "n_vote_rows",
                          "tna_latest", "match_tier", "crsp_match_tier"))

rule("VERIFY 4c — is the TNA-missing residual material to block DIRECTION?")

# The unlinked lose `tna_latest`, i.e. the pre-2024 vote WEIGHT, not the block.
# The plan's design decision is that direction is near-unanimous within a block
# and therefore weighting-insensitive -- but that has to be MEASURED, not
# asserted. The direct test: recompute each (item, block) For-fraction using
# only the funds that DO carry a TNA, and see how far it moves from the
# all-funds figure. If the residual mattered, the two would diverge.
cell = (
    pl.scan_parquet(CLEAN_NPX)
    .select("fundid", "itemonagendaid", "vote_dir")
    .filter(pl.col("vote_dir").is_in(VOTE_DIR_USABLE))
    .join(out.select("fundid", "block", has_tna=pl.col("tna_latest").is_not_null()).lazy(),
          on="fundid", how="left")
    .group_by(["itemonagendaid", "block"])
    .agg(n_all=pl.len(),
         f_all=(pl.col("vote_dir") == "For").sum(),
         n_tna=pl.col("has_tna").sum(),
         f_tna=((pl.col("vote_dir") == "For") & pl.col("has_tna")).sum())
    .collect(engine="streaming")
    .with_columns(
        for_all=pl.col("f_all") / pl.col("n_all"),
        for_tna=pl.when(pl.col("n_tna") > 0)
        .then(pl.col("f_tna") / pl.col("n_tna")).otherwise(None),
    )
    .with_columns(
        delta=(pl.col("for_all") - pl.col("for_tna")).abs(),
        near_unanimous=(pl.col("for_all") >= L3_UNANIMITY_HI)
        | (pl.col("for_all") <= L3_UNANIMITY_LO),
        crosses_majority=((pl.col("for_all") >= 0.5) != (pl.col("for_tna") >= 0.5)),
    )
)
mat = (
    cell.filter(pl.col("block") != "asset_owner")
    .group_by("block").agg(
        cells=pl.len(),
        vote_rows=pl.col("n_all").sum(),
        pct_rows_near_unanimous=(pl.col("n_all").filter("near_unanimous").sum()
                                 / pl.col("n_all").sum() * 100).round(1),
        rows_no_tna=(pl.col("n_all") - pl.col("n_tna")).sum(),
        pct_no_tna_rows_in_unanimous_cell=(
            (pl.col("n_all") - pl.col("n_tna")).filter("near_unanimous").sum()
            / (pl.col("n_all") - pl.col("n_tna")).sum() * 100).round(1),
        cells_zero_tna=(pl.col("n_tna") == 0).sum(),
        rows_zero_tna=pl.col("n_all").filter(pl.col("n_tna") == 0).sum(),
        median_abs_delta=pl.col("delta").median().round(5),
        p99_abs_delta=pl.col("delta").quantile(0.99).round(4),
        cells_crossing_majority=pl.col("crosses_majority").sum(),
        pct_cells_crossing=(pl.col("crosses_majority").mean() * 100).round(3),
    )
    .sort("vote_rows", descending=True)
)
print("Recomputing each (item, block) For-fraction on TNA-carrying funds only:")
print(mat.select("block", "vote_rows", "pct_rows_near_unanimous", "rows_no_tna",
                 "pct_no_tna_rows_in_unanimous_cell"))
print(mat.select("block", "median_abs_delta", "p99_abs_delta", "cells_crossing_majority",
                 "pct_cells_crossing", "cells_zero_tna", "rows_zero_tna"))
mat.write_csv(L3_TNA_MATERIALITY)
idx = mat.filter(pl.col("block") == "index").row(0, named=True)
print(f"\nVERDICT for the index block (the one the headline result turns on): dropping every "
      f"fund that lacks a TNA moves its For-fraction by a median of "
      f"{idx['median_abs_delta']:.5f} and {idx['p99_abs_delta']:.4f} at the 99th percentile; "
      f"it changes which side of 50% the block sits on in {idx['cells_crossing_majority']:,} of "
      f"{idx['cells']:,} item-cells ({idx['pct_cells_crossing']}%); and only "
      f"{idx['cells_zero_tna']:,} cells ({idx['rows_zero_tna']:,} vote rows of "
      f"{idx['vote_rows']:,}) have NO TNA-carrying fund at all. The residual is immaterial "
      f"to block direction — which is the quantity the counterfactual uses.")

rule("VERIFY 5 — known-shop check")

checks = [
    ("VANGUARD 500 INDEX", "index"), ("FIDELITY CONTRAFUND", "active"),
    ("ISHARES CORE S&P 500", "index"), ("SPDR S&P 500", "index"),
    ("HARRIS ASSOCIATES", "active"), ("DODGE & COX", "active"),
]
for pat, want in checks:
    hits = out.filter(
        pl.col("fundname_modal").fill_null("").str.to_uppercase().str.contains(pat, literal=True)
        | pl.col("institutionname_modal").fill_null("").str.to_uppercase()
        .str.contains(pat, literal=True)
    )
    if hits.is_empty():
        print(f"  {pat:<24} NO MATCH IN ISS")
        continue
    dist = hits.group_by("block").agg(n=pl.len()).sort("n", descending=True)
    top = dist.row(0, named=True)["block"]
    ok = "OK  " if top == want else "MISS"
    print(f"  {ok} {pat:<24} want={want:<7} got={top:<7} "
          f"({hits.height} fundids: {dict(zip(dist['block'], dist['n']))})")

rule("adjudication logs")

adj = (
    cand.join(fuzzy.select("fundid", chosen_unit="unit", chosen_tier="crsp_match_tier"),
              on="fundid", how="left")
    .with_columns(accepted=pl.col("unit") == pl.col("chosen_unit"))
    .filter(pl.col("score") >= L3_SCOPED_THRESH)
    .sort(["n_vote_rows", "fundid", "score"], descending=[True, False, True])
    .select("fundid", "fundname_modal", "institutionname_modal", "family", "n_vote_rows",
            "first_year", "last_year", "seriesid", "unit", "crsp_fund_name", "mgmt_name",
            "name", "src", "score", "mgmt_scope", "family_agree", "name_n_units",
            "crsp_last_year", "chosen_tier", "accepted")
)
adj.write_csv(L3_ADJUDICATION_CANDIDATES)
print(f"wrote {adj.height:,} candidate rows (>= {L3_SCOPED_THRESH}) to "
      f"{L3_ADJUDICATION_CANDIDATES.name}")

unl = (
    cand.filter(pl.col("fundid").is_in(list(remaining)))
    .sort(["fundid", "score"], descending=[False, True])
    .unique(subset=["fundid", "unit"], keep="first", maintain_order=True)
    .group_by("fundid", maintain_order=True).head(3)
    .sort(["n_vote_rows", "fundid", "score"], descending=[True, False, True])
    .select("fundid", "fundname_modal", "institutionname_modal", "n_vote_rows", "first_year",
            "last_year", "unit", "crsp_fund_name", "mgmt_name", "name", "score",
            "mgmt_scope", "family_agree")
)
unl.write_csv(L3_ADJUDICATION_UNLINKED)
print(f"wrote {unl.height:,} best-guess rows for {unl['fundid'].n_unique():,} unlinked fundids "
      f"to {L3_ADJUDICATION_UNLINKED.name}")

dis = (
    sid2fno.join(disagree.select("seriesid"), left_on="series_cik", right_on="seriesid",
                 how="semi")
    .join(fs.select("crsp_fundno", "fund_name", "index_fund_flag", "tna_latest"),
          on="crsp_fundno", how="left")
    .sort(["series_cik", "crsp_fundno"])
)
dis.write_csv(L3_FLAG_DISAGREEMENTS)
print(f"wrote {dis.height:,} class rows for {disagree.height:,} seriesids whose classes "
      f"disagree on index_fund_flag to {L3_FLAG_DISAGREEMENTS.name}")

rule("L3 done")
print(f"{NPX_CRSP_LINK}: {out.height:,} fundids, "
      f"{out.filter(pl.col('crsp_fundno').is_not_null()).height:,} with a crsp_fundno "
      f"({tot_c / tot:.1%} of vote rows; {tot_cr / tot_r:.1%} registrant-only)")
