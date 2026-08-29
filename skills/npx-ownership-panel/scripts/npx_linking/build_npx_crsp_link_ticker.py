"""L3d — the `via_sec_ticker` tier. UPDATES `data/processed/npx_crsp_link.parquet`.

An EXACT-ID linking route that bypasses `crsp_cik_map` entirely.

THE GAP
-------
Until now a fund carrying a SEC `seriesid` could reach CRSP only through
`crsp_cik_map.series_cik`. **Gap A** is the 930 fundids / 4,056,760 vote rows
(2.81% of the panel) whose seriesId is absent from that map — and ZERO of the
930 are recoverable by repairing the join, so `crsp_cik_map` is a dead end for
them (VERIFY 0 reproduces both facts).

THE ROUTE
---------
    ISS fundid -> SEC seriesid -> sec_series_names_long.class_ticker
               -> fund_summary2.ticker -> crsp_fundno

Both endpoints are exact identifiers. Nothing fuzzy decides the match; the
name, where it is used at all, only CORROBORATES a claim the tickers have
already made.

THE HAZARD, AND THE CORRECTION TO THE BRIEF
-------------------------------------------
Tickers are recycled. The brief proposed accepting a match when the families
agree OR **the ticker is unique in `fund_summary2`**.

**The uniqueness escape does not work, and it fails exactly where it matters.**
`fund_summary2` is a LATEST-SNAPSHOT pull — one row per `crsp_fundno` holding
that class's last observed ticker — so a SEQUENTIALLY reused ticker appears on
only the surviving fund and is "unique" by construction. Uniqueness in this
table can detect only a CONCURRENT collision, and sequential reuse is the whole
failure mode. VERIFY C asserts this on the brief's own headline funds: SSPSX
(BlackRock Small/Mid Cap Growth, dead) now sits on State Street Institutional
Premier Growth Equity, and MNCCX (Federated Mini-Cap Index, dead) on Manning &
Napier Pro-Blend Conservative Term — **both are `n_crsp_fundno == 1`.** The
uniqueness path would have accepted both. It is not implemented.

THE ACCEPT LADDER — three independent second signals, any one suffices
---------------------------------------------------------------------
1. `multi_ticker` — >= 2 distinct SEC class tickers of the same series land on
   the SAME CRSP fund unit. Two independent exact IDs agreeing. No name floor,
   deliberately: this is what recovers genuine RENAMES whose names no longer
   resemble each other (Phoenix -> Virtus scores 0.030 on names).
2. `family` — a family token shared between {ISS institution} U {SEC
   entity_name, every vintage} and {CRSP fund_name, mgmt_name}, word-boundary
   anchored with L3c's plural fold. Using every SEC vintage is what carries a
   rebrand: the Claymore ETFs file under "Invesco Exchange-Traded Fund Trust"
   in the later masters, bridging Claymore -> Guggenheim -> Invesco with no
   succession table.
3. `name` — SEC series_name vs CRSP fund name cosine >= 0.45, digit-guard
   clean. Corroboration on an exact-ID claim, so the bar sits far below L3b's
   0.97 identity bar; calibration and the declined 0.28-0.45 band are in
   `config_obs.L3D_NAME_SOLO_THRESH` and `l3d_name_only_band.csv`.

Anything with none of the three is REJECTED and logged verbatim.

Outputs
-------
`data/processed/npx_crsp_link.parquet`  UPDATED IN PLACE (same 26,686 rows)
`data/output/l3d_accepted_matches.csv`  every accepted match, auditable
`data/output/l3d_candidates.csv`        every (fundid, unit) pair considered
`data/output/l3d_rejected.csv`          every rejection, with its reason
`data/output/l3d_ticker_collisions.csv` every candidate ticker on >1 CRSP fund
`data/output/l3d_name_only_band.csv`    the declined 0.28-0.45 corroboration band
`data/output/l3d_audit_sample.csv`      the reproducible random-20 hand audit
`data/output/l3d_coverage_by_year.csv`  vote-row coverage before vs after
`data/output/l3d_block_changes.csv`     every fundid whose block moved
`data/output/l3d_flag_disagreements.csv` index_fund_flag disagreeing in a unit
`data/output/l3d_tna_hazard.csv`        TNA per vote row for the new links
`data/output/l3d_residual_gap_a.csv`    what is left of Gap A, and why

Run: python scripts/linking/build_npx_crsp_link_ticker.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cit"))

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402
from sklearn.feature_extraction.text import TfidfVectorizer  # noqa: E402

from config_obs import (  # noqa: E402
    CRSP_CIK_MAP,
    FUND_SUMMARY2,
    FUNDID_SERIESID,
    L2_AMPERSAND_FOLD,
    L2_FAMILY_STOPWORDS,
    L2_LEGAL_SUFFIX_RE,
    L2_TFIDF_ANALYZER,
    L2_TFIDF_NGRAM,
    L3_CLASS_SUFFIX_RE,
    L3B_ACRONYM_DOT_RE,
    L3B_FAMILY_MIN_CHARS,
    L3B_STRATEGY_STOPWORDS,
    L3C_DIGIT_SPLIT_RULES,
    L3D_ACCEPTED,
    L3D_APPLY_DIGIT_GUARD,
    L3D_AUDIT_N,
    L3D_AUDIT_SAMPLE,
    L3D_AUDIT_SEED,
    L3D_BLOCK_CHANGES,
    L3D_CANDIDATES,
    L3D_COLLISIONS,
    L3D_COVERAGE_BY_YEAR,
    L3D_EXCLUDE_BLOCK,
    L3D_FLAG_DISAGREEMENTS,
    L3D_MULTI_TICKER_MIN,
    L3D_NAME_CAND_FLOOR,
    L3D_NAME_ONLY_BAND,
    L3D_NAME_SOLO_THRESH,
    L3D_REJECTED,
    L3D_REQUIRE_STRICT_PLURALITY,
    L3D_RESIDUAL,
    L3D_TICKER_RE,
    L3D_TIER,
    L3D_TNA_HAZARD,
    MFLINK1,
    NPX_CRSP_LINK,
    NPX_SERIESID,
    PARQUET_COMPRESSION,
    SAMPLE_END,
    SAMPLE_START,
    SEC_SERIES_NAMES_LONG,
)

pl.Config.set_tbl_rows(60)
pl.Config.set_fmt_str_lengths(60)
pl.Config.set_tbl_width_chars(220)


def rule(title):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


# ---------------------------------------------------------------------------
# 0. normalisation — the L2/L3b/L3c stack, reused verbatim
# ---------------------------------------------------------------------------
FAMILY_STOP = set(L2_FAMILY_STOPWORDS) | set(L3B_STRATEGY_STOPWORDS)


def normstr(s):
    """L2's normaliser + L3b's acronym fold + L3c's alpha<->digit split."""
    s = (s or "").upper()
    s = re.sub(L3B_ACRONYM_DOT_RE, r"\1", s)          # U.S. -> US
    s = s.replace("&", " AND ")
    for pat, rep in L2_AMPERSAND_FOLD:                # SandP / S AND P -> S P
        s = re.sub(pat, rep, s)
    s = re.sub(r"\bS AND P\b", "S P", s)
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    s = re.sub(L2_LEGAL_SUFFIX_RE, " ", s)
    for pat, rep in L3C_DIGIT_SPLIT_RULES:            # RUSSELL2000 -> RUSSELL 2000
        s = re.sub(pat, rep.replace("${1} ${2}", r"\1 \2"), s)
    return re.sub(r"\s+", " ", s).strip()


def digit_tokens(s):
    return sorted(t for t in s.split() if any(c.isdigit() for c in t))


def family_tokens(s):
    """Every distinctive token >= L3B_FAMILY_MIN_CHARS, stopwords removed."""
    return {t for t in normstr(s).split()
            if len(t) >= L3B_FAMILY_MIN_CHARS and t.isalpha() and t not in FAMILY_STOP}


def family_hit(src_tokens, haystack):
    """L3c's `\\b<stem>S?\\b` plural-tolerant, both-ends-anchored family test."""
    hay = normstr(haystack)
    for t in sorted(src_tokens):
        stem = t[:-1] if (t.endswith("S") and len(t) - 1 >= L3B_FAMILY_MIN_CHARS) else t
        if re.search(rf"\b{re.escape(stem)}S?\b", hay):
            return t
    return None


# VERIFY P — the substring hole L3b's word-boundary rule exists to close is
# still closed by the plural fold (L3c asserted the same regression).
assert family_hit({"MUTUAL"}, "MassMutual Premier Small Capitalization Value") is None
assert family_hit({"PROSHARE"}, "ProShares Trust: ProShares Ultra Russell2000") == "PROSHARE"
assert family_hit({"BLACKROCK"}, "State Street Institutional Funds") is None


# ---------------------------------------------------------------------------
# 1. inputs + VERIFY 0 — reproduce the measured gap before touching anything
# ---------------------------------------------------------------------------
rule("L3d — inputs, and VERIFY 0: the state L3c left behind")

base = pl.read_parquet(NPX_CRSP_LINK)
N_FUNDIDS = base.height
BASE_COLS = base.columns
assert base["fundid"].n_unique() == N_FUNDIDS, "fundid not unique in npx_crsp_link"

# RE-RUN GUARD. L3c documented the trap (§10.5 of the investigation doc): this
# builder is idempotent on the PARQUET but NOT on the CSV audit trail — a second
# run finds its own accepts already linked, accepts 0, and overwrites every
# `l3d_*.csv` with an empty accept set, destroying the evidence for the links
# actually in the file. Refuse instead of silently doing that.
if (base["crsp_match_tier"] == L3D_TIER).any():
    n_already = (base["crsp_match_tier"] == L3D_TIER).sum()
    sys.exit(
        f"REFUSING TO RE-RUN: {NPX_CRSP_LINK} already carries {n_already:,} "
        f"`{L3D_TIER}` links. A second run would accept 0 and overwrite the "
        f"l3d_*.csv audit trail with an empty accept set. Restore the pre-L3d "
        f"parquet (or re-run the L3/L3b/L3c chain) before running this again.")

TOTAL_ROWS = base["n_vote_rows"].cast(pl.Float64).sum()   # uint32 -> float64 (HAZARD)
print(f"npx_crsp_link (as built by L3c)    : {base.height:,} rows x {base.width} cols")
print(f"panel vote rows                    : {TOTAL_ROWS:,.0f}")
print(f"crsp_fundno coverage, BEFORE       : "
      f"{100 * base.filter(pl.col('crsp_fundno').is_not_null())['n_vote_rows'].cast(pl.Float64).sum() / TOTAL_ROWS:.3f}%")

unlinked = base.filter(pl.col("crsp_fundno").is_null()
                       & (pl.col("block") != L3D_EXCLUDE_BLOCK)
                       & ~pl.col("iss_nonregistrant"))
gap_a = unlinked.filter(pl.col("seriesid").is_not_null())
gap_b = unlinked.filter(pl.col("seriesid").is_null())
for lab, g in [("GAP A (seriesid present)", gap_a), ("GAP B (no seriesid)", gap_b)]:
    r = g["n_vote_rows"].cast(pl.Float64).sum()
    print(f"{lab:34s}: {g.height:,} fundids, {r:,.0f} vote rows "
          f"({100 * r / TOTAL_ROWS:.2f}% of the panel)")

cikmap = pl.read_parquet(CRSP_CIK_MAP)
in_map = gap_a.join(cikmap.filter(pl.col("series_cik").is_not_null())
                    .select(seriesid="series_cik").unique(), on="seriesid", how="semi")
print(f"\nof Gap A's seriesIds, present in crsp_cik_map: {in_map.height:,} / {gap_a.height:,}")
print("  -> `crsp_cik_map` is a DEAD END for Gap A. This tier does not repair "
      "that join; it opens a second, independent exact-ID path.")

# Gap B: the brief asked whether any Gap B fundid carries a seriesid elsewhere.
l2 = pl.read_parquet(FUNDID_SERIESID).select("fundid", l2_seriesid="seriesid")
gb = gap_b.join(l2, on="fundid", how="left")
n_gb = gb.filter(pl.col("l2_seriesid").is_not_null()).height
print(f"\nGap B fundids carrying a seriesid in fundid_seriesid.parquet: {n_gb:,}")
print("  (L3 nulls `seriesid` on npx_crsp_link only for ISS non-registrants, "
      "which this tier excludes, so Gap B contributes no candidates — checked, "
      "not assumed.)")

fs = pl.read_parquet(FUND_SUMMARY2)
snl = pl.read_parquet(SEC_SERIES_NAMES_LONG)
# A crsp_fundno can carry more than one wficn in MFLINK1 (measured: 341 of
# 49,975). `keep="first"` with no sort picks by row order — an undefined
# choice on the linking critical path. Sorted so the pick is STATED.
mflink = (pl.read_parquet(MFLINK1)
          .sort(["crsp_fundno", "wficn"])
          .unique(subset=["crsp_fundno"], keep="first", maintain_order=True))
print(f"\nfund_summary2 (CLASS grain)        : {fs.height:,} crsp_fundnos")
print(f"sec_series_names_long              : {snl.height:,} rows")

todo = pl.concat([gap_a, gap_b])
print(f"\ntarget population (all unlinked, non-{L3D_EXCLUDE_BLOCK}): {todo.height:,} fundids")

# ---------------------------------------------------------------------------
# 2. ticker normalisation on both sides
# ---------------------------------------------------------------------------
rule("ticker normalisation — identical rule on both corpora")

sec_tk_raw = snl.filter(pl.col("class_ticker").is_not_null()).select(
    "series_id", tk=pl.col("class_ticker").str.strip_chars().str.to_uppercase()).unique()
sec_tk = sec_tk_raw.filter(pl.col("tk").str.contains(L3D_TICKER_RE))
print(f"SEC  class_ticker  : {sec_tk_raw.height:,} distinct (series, ticker) -> "
      f"{sec_tk.height:,} keep ({sec_tk_raw.height - sec_tk.height:,} fail {L3D_TICKER_RE})")

crsp_tk_raw = fs.filter(pl.col("ticker").is_not_null()).with_columns(
    tk=pl.col("ticker").str.strip_chars().str.to_uppercase())
crsp_tk = crsp_tk_raw.filter(pl.col("tk").str.contains(L3D_TICKER_RE)).with_columns(
    unit=pl.when(pl.col("crsp_portno").is_not_null())
    .then(pl.format("P{}", pl.col("crsp_portno").cast(pl.Int64)))
    .otherwise(pl.format("F{}", pl.col("crsp_fundno").cast(pl.Int64))))
print(f"CRSP fund_summary2 : {crsp_tk_raw.height:,} classes with a ticker -> "
      f"{crsp_tk.height:,} keep, {crsp_tk['tk'].n_unique():,} distinct tickers")

# ---------------------------------------------------------------------------
# 2b. VERIFY C — ticker reuse, and why "unique in fund_summary2" is NOT a signal
# ---------------------------------------------------------------------------
rule("VERIFY C — ticker reuse, and the correction to the brief's uniqueness rule")

tk_census = crsp_tk.group_by("tk").agg(
    n_crsp_fundno=pl.col("crsp_fundno").n_unique(),
    n_unit=pl.col("unit").n_unique(),
    n_mgmt_cd=pl.col("mgmt_cd").n_unique())
print("CONCURRENT collisions inside the latest-snapshot fund_summary2:")
print(tk_census.group_by("n_crsp_fundno").agg(n_tickers=pl.len()).sort("n_crsp_fundno"))
n_multi = tk_census.filter(pl.col("n_crsp_fundno") > 1).height
n_multi_fam = tk_census.filter(pl.col("n_mgmt_cd") > 1).height
print(f"  {n_multi:,} tickers on >1 crsp_fundno ({100 * n_multi / tk_census.height:.1f}%); "
      f"{n_multi_fam:,} of those cross a mgmt_cd")

print("\nBUT `fund_summary2` is a LATEST-SNAPSHOT pull — one row per crsp_fundno "
      "carrying that class's LAST observed ticker. A ticker reused SEQUENTIALLY "
      "therefore appears on only the surviving fund and is 'unique' by "
      "construction. Uniqueness can detect a CONCURRENT collision and nothing "
      "else, and sequential reuse is the entire failure mode.\n")
print("  the brief's own headline funds, measured:")
_demo = []
for tk, iss in [("SSPSX", "BLACKROCK MASTER SMALL CAP GROWTH PORTFOLIO"),
                ("MNCCX", "FEDERATED MINI-CAP INDEX FUND"),
                ("SPIAX", "MORGAN STANLEY S&P 500 INDEX FUND")]:
    row = crsp_tk.filter(pl.col("tk") == tk)
    n = tk_census.filter(pl.col("tk") == tk)["n_crsp_fundno"]
    n = int(n[0]) if len(n) else 0
    nm = row["fund_name"][0] if row.height else "(absent from CRSP)"
    # A backslash inside an f-string expression is Python >= 3.12 only, so this
    # module did not PARSE on 3.11 -- the stage could never run there. Bind the
    # quoted literal outside the f-string instead.
    _verdict = '"unique"' if n == 1 else "collides"
    print(f"    {tk}  ISS {iss}\n          CRSP {nm}\n          n_crsp_fundno = {n}"
          f"  -> {_verdict}")
    _demo.append(n)
assert _demo[0] == 1 and _demo[1] == 1, \
    "VERIFY C: the reused tickers are no longer unique — re-derive the finding"
print("\n  Two of the three are reuses onto an unrelated family and BOTH are "
      "unique. The uniqueness escape is not implemented; every accept below "
      "carries a positive second signal instead.")

# ---------------------------------------------------------------------------
# 3. candidate pairs: fundid -> seriesid -> ticker -> CRSP fund unit
# ---------------------------------------------------------------------------
rule("candidate construction (exact ID both ends)")

todo_sid = todo.filter(pl.col("seriesid").is_not_null())
sids = todo_sid["seriesid"].unique()
sec_scope = snl.filter(pl.col("series_id").is_in(sids.implode()))
sec_scope_tk = sec_tk.filter(pl.col("series_id").is_in(sids.implode()))
n_tk_per_series = sec_scope_tk.group_by("series_id").agg(n_sec_tk=pl.len())
print(f"Gap A seriesIds                    : {len(sids):,}")
print(f"  carrying >= 1 usable SEC ticker  : {n_tk_per_series.height:,}")

hits = sec_scope_tk.join(
    crsp_tk.select("tk", "crsp_fundno", "unit", "fund_name", "mgmt_name", "mgmt_cd"),
    on="tk", how="inner")
print(f"  with a ticker present in CRSP    : {hits['series_id'].n_unique():,}")
print(f"  (series, ticker, crsp class) hits: {hits.height:,}")

# --- unit choice: strict plurality of distinct tickers ---
unit_rank = (hits.group_by(["series_id", "unit"])
             .agg(n_tk_unit=pl.col("tk").n_unique())
             .sort(["series_id", "n_tk_unit", "unit"], descending=[False, True, False]))
top_unit = unit_rank.group_by("series_id", maintain_order=True).head(1)
runner = (unit_rank.join(top_unit.select("series_id", "unit"),
                         on=["series_id", "unit"], how="anti")
          .group_by("series_id").agg(n_tk_runner=pl.col("n_tk_unit").max()))
series_unit = (top_unit.join(runner, on="series_id", how="left")
               .with_columns(pl.col("n_tk_runner").fill_null(0))
               .join(n_tk_per_series, on="series_id", how="left"))
n_multi_unit = unit_rank.group_by("series_id").agg(n=pl.len()).filter(pl.col("n") > 1).height
n_tie = series_unit.filter(pl.col("n_tk_unit") == pl.col("n_tk_runner")).height
print(f"  series whose tickers span >1 CRSP fund unit: {n_multi_unit:,} "
      f"(of which {n_tie:,} are ties -> rejected as ambiguous_unit)")

# --- per-unit CRSP descriptive text, for the family + name tests ---
unit_text = (crsp_tk.group_by("unit").agg(
    crsp_names=pl.col("fund_name").drop_nulls().unique(),
    crsp_mgmts=pl.col("mgmt_name").drop_nulls().unique()))
sec_entities = sec_scope.group_by("series_id").agg(
    sec_entities=pl.col("entity_name").drop_nulls().unique())
sec_names = sec_scope.select("series_id", "series_name").drop_nulls().unique()
hit_tks = hits.group_by(["series_id", "unit"]).agg(hit_tickers=pl.col("tk").unique())

cand = (todo_sid.select("fundid", "seriesid", "fundname_modal", "institutionname_modal",
                        "n_vote_rows", "block", "block_source")
        .join(series_unit, left_on="seriesid", right_on="series_id", how="inner")
        .join(sec_entities, left_on="seriesid", right_on="series_id", how="left")
        .join(unit_text, on="unit", how="left")
        .join(hit_tks, left_on=["seriesid", "unit"], right_on=["series_id", "unit"],
              how="left"))
print(f"\ncandidate fundids                  : {cand.height:,} "
      f"({cand['n_vote_rows'].cast(pl.Float64).sum():,.0f} vote rows, "
      f"{100 * cand['n_vote_rows'].cast(pl.Float64).sum() / TOTAL_ROWS:.4f}% of the panel)")

# ---------------------------------------------------------------------------
# 4. SIGNAL 3 — name corroboration (TF-IDF, digit-guarded)
# ---------------------------------------------------------------------------
rule("SIGNAL 3 — name corroboration (SEC series_name vs CRSP fund name)")

pairs = cand.select("seriesid", "unit").unique()
q = (sec_names.filter(pl.col("series_id").is_in(pairs["seriesid"].unique().implode()))
     .with_columns(n=pl.col("series_name").map_elements(normstr, return_dtype=pl.String))
     .filter(pl.col("n").str.len_chars() > 0))
_u = crsp_tk.filter(pl.col("unit").is_in(pairs["unit"].unique().implode()))
c = (pl.concat([
    _u.select("unit", nm=pl.col("fund_name").str.replace(L3_CLASS_SUFFIX_RE, "")),
    _u.select("unit", nm=pl.col("fund_name").str.replace(L3_CLASS_SUFFIX_RE, "")
              .str.split(":").list.last())]).unique()
    .with_columns(n=pl.col("nm").map_elements(normstr, return_dtype=pl.String))
    .filter(pl.col("n").str.len_chars() > 0))
print(f"SEC query names {q.height:,} (over {q['series_id'].n_unique():,} series) x "
      f"CRSP corpus names {c.height:,} (over {c['unit'].n_unique():,} units)")

vec = TfidfVectorizer(analyzer=L2_TFIDF_ANALYZER, ngram_range=L2_TFIDF_NGRAM)
vec.fit(q["n"].to_list() + c["n"].to_list())
QM, CM = vec.transform(q["n"].to_list()), vec.transform(c["n"].to_list())
qi, ci = {}, {}
for i, s in enumerate(q["series_id"]):
    qi.setdefault(s, []).append(i)
for i, u in enumerate(c["unit"]):
    ci.setdefault(u, []).append(i)

rows = []
for sid, unit in pairs.iter_rows():
    ii, jj = qi.get(sid, []), ci.get(unit, [])
    if not ii or not jj:
        rows.append((sid, unit, 0.0, None, None, False))
        continue
    S = (QM[ii] @ CM[jj].T).toarray()
    if L3D_APPLY_DIGIT_GUARD:                     # veto pairs whose digits differ
        for a, i in enumerate(ii):
            for b, j in enumerate(jj):
                if digit_tokens(q["n"][i]) != digit_tokens(c["n"][j]):
                    S[a, b] = 0.0
    a, b = np.unravel_index(S.argmax(), S.shape)
    rows.append((sid, unit, float(S.max()), q["n"][ii[a]], c["n"][jj[b]], True))
name_sig = pl.DataFrame(
    rows, schema=["seriesid", "unit", "name_score", "sec_name", "crsp_name", "scored"],
    orient="row")
n_vetoed = name_sig.filter(pl.col("name_score") == 0.0).height
print(f"scored {name_sig.height:,} (series, unit) pairs; "
      f"{n_vetoed:,} scored 0 (digit guard or no comparable name)")
cand = cand.join(name_sig, on=["seriesid", "unit"], how="left")

# ---------------------------------------------------------------------------
# 5. SIGNALS 1 and 2 — multi-ticker corroboration and the family bridge
# ---------------------------------------------------------------------------
rule("SIGNALS 1 & 2 — multi-ticker corroboration, family bridge")

fam_tok, fam_hay = [], []
for r in cand.iter_rows(named=True):
    src = family_tokens(r["institutionname_modal"] or "")
    for e in (r["sec_entities"] or []):
        src |= family_tokens(e)
    hay = " | ".join(list(r["crsp_names"] or []) + list(r["crsp_mgmts"] or []))
    fam_tok.append(family_hit(src, hay))
    fam_hay.append(hay)
cand = cand.with_columns(
    family_token=pl.Series(fam_tok, dtype=pl.String),
    crsp_haystack=pl.Series(fam_hay, dtype=pl.String))

cand = cand.with_columns(
    sig_multi=(pl.col("n_tk_unit") >= L3D_MULTI_TICKER_MIN)
    & (pl.col("n_tk_unit") > pl.col("n_tk_runner") if L3D_REQUIRE_STRICT_PLURALITY
       else pl.lit(True)),
    sig_family=pl.col("family_token").is_not_null(),
    sig_name=pl.col("name_score") >= L3D_NAME_SOLO_THRESH,
    ambiguous=pl.col("n_tk_unit") == pl.col("n_tk_runner"),
)
for lab, e in [("multi_ticker", pl.col("sig_multi")), ("family", pl.col("sig_family")),
               ("name >= %.2f" % L3D_NAME_SOLO_THRESH, pl.col("sig_name"))]:
    s = cand.filter(e)
    print(f"  {lab:16s}: {s.height:4,} fundids  "
          f"{s['n_vote_rows'].cast(pl.Float64).sum():>9,.0f} vote rows")

# ---------------------------------------------------------------------------
# 6. accept / reject
# ---------------------------------------------------------------------------
rule(f"tier {L3D_TIER} — accept")

cand = cand.with_columns(
    accept=(~pl.col("ambiguous"))
    & (pl.col("sig_multi") | pl.col("sig_family") | pl.col("sig_name")),
    accept_path=pl.when(pl.col("n_tk_unit") == pl.col("n_tk_runner")).then(None)
    .when(pl.col("sig_multi")).then(pl.lit("multi_ticker"))
    .when(pl.col("sig_family")).then(pl.lit("family"))
    .when(pl.col("sig_name")).then(pl.lit("name")).otherwise(None),
    reject_reason=pl.when(pl.col("n_tk_unit") == pl.col("n_tk_runner"))
    .then(pl.lit("ambiguous_unit: tickers split evenly across CRSP fund units"))
    .when(pl.col("name_score") >= L3D_NAME_CAND_FLOOR)
    .then(pl.lit("no family bridge, single ticker, name corroboration below bar"))
    .otherwise(pl.lit("no family bridge, single ticker, name CONTRADICTS "
                      "(likely reused ticker)")))

acc = cand.filter(pl.col("accept"))
rej = cand.filter(~pl.col("accept"))
print(cand.group_by("accept", "accept_path").agg(
    fundids=pl.len(), vote_rows=pl.col("n_vote_rows").cast(pl.Float64).sum())
    .sort(["accept", "vote_rows"], descending=[True, True]))
print(f"\nACCEPTED : {acc.height:,} fundids, "
      f"{acc['n_vote_rows'].cast(pl.Float64).sum():,.0f} vote rows "
      f"({100 * acc['n_vote_rows'].cast(pl.Float64).sum() / TOTAL_ROWS:.4f}% of the panel)")
print(f"REJECTED : {rej.height:,} fundids, "
      f"{rej['n_vote_rows'].cast(pl.Float64).sum():,.0f} vote rows")
assert acc["fundid"].n_unique() == acc.height, "a fundid was accepted twice"

# ---------------------------------------------------------------------------
# 7. class -> fund-unit aggregation (L3's helper, verbatim)
# ---------------------------------------------------------------------------
rule("collapsing CRSP share classes to the fund unit")

fs_cls = fs.select("crsp_fundno", "index_fund_flag", "tna_latest", "fund_name",
                   "mgmt_name", "dead_flag").join(mflink, on="crsp_fundno", how="left")
units = crsp_tk.filter(pl.col("unit").is_in(acc["unit"].unique().implode())).select(
    "unit", "crsp_fundno").unique()
d = units.join(fs_cls, on="crsp_fundno", how="left")


def modal(col, out):
    return (d.filter(pl.col(col).is_not_null())
            .group_by(["unit", col]).agg(n=pl.len())
            .sort(["unit", "n", col], descending=[False, True, False])
            .group_by("unit", maintain_order=True).head(1).select("unit", pl.col(col).alias(out)))


rep = (d.sort(["unit", "tna_latest", "crsp_fundno"], descending=[False, True, False],
              nulls_last=True)
       .group_by("unit", maintain_order=True).head(1)
       .select("unit", crsp_fundno="crsp_fundno", crsp_fund_name="fund_name"))
agg = d.group_by("unit").agg(
    n_crsp_classes=pl.col("crsp_fundno").n_unique(),
    tna_latest=pl.col("tna_latest").sum(),
    n_tna=pl.col("tna_latest").is_not_null().sum(),
    n_flags=pl.col("index_fund_flag").drop_nulls().n_unique(),
).with_columns(
    tna_latest=pl.when(pl.col("n_tna") > 0).then(pl.col("tna_latest")).otherwise(None)).drop("n_tna")
for col, out in [("index_fund_flag", "index_fund_flag"), ("wficn", "wficn"),
                 ("mgmt_name", "mgmt_name")]:
    agg = agg.join(modal(col, out), on="unit", how="left")
agg = agg.join(rep, on="unit", how="left")

dis = agg.filter(pl.col("n_flags") > 1)
print(f"fund units resolved                : {agg.height:,}")
print(f"  index_fund_flag DISAGREES across classes in: {dis.height:,} units "
      "(modal non-null kept; logged)")
if dis.height:
    print(dis.select("unit", "crsp_fund_name", "n_crsp_classes", "n_flags",
                     "index_fund_flag"))
dis.write_csv(L3D_FLAG_DISAGREEMENTS)

fuzzy = acc.join(agg.drop("n_flags"), on="unit", how="left")
assert fuzzy["crsp_fundno"].null_count() == 0, "a unit failed to resolve a crsp_fundno"
print(f"\nTNA over DISTINCT crsp_fundno      : "
      f"${fuzzy.unique(subset=['crsp_fundno'])['tna_latest'].sum() / 1e3:,.2f}B "
      f"(never summed over fundid — L3 measured $63.51T that way vs $32.20T correct)")

# ---------------------------------------------------------------------------
# 8. update npx_crsp_link in place
# ---------------------------------------------------------------------------
rule("updating npx_crsp_link in place")

new = fuzzy.select("fundid", nf_crsp_fundno="crsp_fundno", nf_wficn="wficn",
                   nf_index_fund_flag="index_fund_flag", nf_tna_latest="tna_latest",
                   nf_n_crsp_classes="n_crsp_classes",
                   nf_score="name_score")
assert base.join(new.select("fundid"), on="fundid", how="semi")["crsp_fundno"] \
    .null_count() == new.height, "L3d tried to overwrite an existing link"

out = (base.join(new, on="fundid", how="left").with_columns(
    l3d_new=pl.col("nf_crsp_fundno").is_not_null(),
    crsp_fundno=pl.coalesce("crsp_fundno", "nf_crsp_fundno"),
    wficn=pl.coalesce("wficn", "nf_wficn"),
    index_fund_flag=pl.coalesce("index_fund_flag", "nf_index_fund_flag"),
    tna_latest=pl.coalesce("tna_latest", "nf_tna_latest"),
    n_crsp_classes=pl.coalesce("n_crsp_classes", "nf_n_crsp_classes"),
    crsp_match_tier=pl.when(pl.col("nf_crsp_fundno").is_not_null())
    .then(pl.lit(L3D_TIER)).otherwise(pl.col("crsp_match_tier")),
    crsp_match_score=pl.coalesce("crsp_match_score", "nf_score"),
).with_columns(
    # block/block_source recomputed ONLY for the rows this tier filled
    block=pl.when(~pl.col("l3d_new")).then(pl.col("block"))
    .when(pl.col("index_fund_flag") == "D").then(pl.lit("index"))
    .when(pl.col("index_fund_flag").is_in(["B", "E"])).then(pl.lit("passive"))
    .otherwise(pl.lit("active")),
    block_source=pl.when(~pl.col("l3d_new")).then(pl.col("block_source"))
    .when(pl.col("index_fund_flag").is_not_null()).then(pl.lit("crsp_flag"))
    .otherwise(pl.lit("crsp_active")),
))
changes = (out.filter(pl.col("l3d_new"))
           .join(base.select("fundid", old_block="block", old_source="block_source"),
                 on="fundid", how="left")
           .filter(pl.col("block") != pl.col("old_block"))
           .select("fundid", "fundname_modal", "institutionname_modal", "n_vote_rows",
                   "old_block", "old_source", "block", "block_source",
                   "index_fund_flag", "tna_latest")
           .sort("n_vote_rows", descending=True))
out = out.drop([c for c in out.columns if c.startswith("nf_")] + ["l3d_new"])
out = out.select(BASE_COLS).sort("fundid")

assert out.height == N_FUNDIDS, f"row count changed: {out.height} != {N_FUNDIDS}"
assert out["fundid"].n_unique() == out.height, "fundid not unique after the update"
assert out.columns == BASE_COLS, "column set or order changed"
assert out.filter(pl.col("iss_nonregistrant"))["crsp_fundno"].null_count() == \
    out.filter(pl.col("iss_nonregistrant")).height, "a non-registrant gained a link"
chk = (base.filter(pl.col("crsp_fundno").is_not_null())
       .select("fundid", "crsp_fundno", "crsp_match_tier", "index_fund_flag",
               "tna_latest", "block", "block_source")
       .join(out.select("fundid", n_fundno="crsp_fundno", n_tier="crsp_match_tier",
                        n_flag="index_fund_flag", n_tna="tna_latest",
                        n_block="block", n_src="block_source"),
             on="fundid", how="inner"))
assert chk.filter((pl.col("crsp_fundno") != pl.col("n_fundno"))
                  | (pl.col("crsp_match_tier") != pl.col("n_tier"))
                  | (pl.col("block") != pl.col("n_block"))
                  | (pl.col("block_source") != pl.col("n_src"))).height == 0, \
    "an existing link was modified"
print(f"pre-existing links preserved       : {chk.height:,} / {chk.height:,}")
print(f"rows: {out.height:,} (unchanged)   fundid unique: {out['fundid'].n_unique() == out.height}")

out.write_parquet(NPX_CRSP_LINK, compression=PARQUET_COMPRESSION)
print(f"wrote {NPX_CRSP_LINK} — {out.height:,} rows x {out.width} cols")

# ---------------------------------------------------------------------------
# 9. VERIFY 1 — coverage before vs after, panel and by year
# ---------------------------------------------------------------------------
rule("VERIFY 1 — vote-row coverage of crsp_fundno, before vs after")

fy = (pl.scan_parquet(NPX_SERIESID)
      .select("fundid", year=pl.col("meetingdate").dt.year())
      .group_by(["fundid", "year"]).agg(n=pl.len())
      .collect(engine="streaming")
      .filter(pl.col("year").is_between(SAMPLE_START, SAMPLE_END)))
fy = (fy.join(base.select("fundid", "iss_nonregistrant", old_fno="crsp_fundno"),
              on="fundid", how="left")
      .join(out.select("fundid", new_fno="crsp_fundno"), on="fundid", how="left"))
reg = ~pl.col("iss_nonregistrant").fill_null(False)
byyear = (fy.group_by("year").agg(
    rows=pl.col("n").sum(),
    rows_before=pl.col("n").filter(pl.col("old_fno").is_not_null()).sum(),
    rows_after=pl.col("n").filter(pl.col("new_fno").is_not_null()).sum(),
    rows_reg=pl.col("n").filter(reg).sum(),
    rows_reg_before=pl.col("n").filter(pl.col("old_fno").is_not_null() & reg).sum(),
    rows_reg_after=pl.col("n").filter(pl.col("new_fno").is_not_null() & reg).sum(),
).sort("year").with_columns(
    pct_before=100 * pl.col("rows_before") / pl.col("rows"),
    pct_after=100 * pl.col("rows_after") / pl.col("rows"),
    pct_reg_before=100 * pl.col("rows_reg_before") / pl.col("rows_reg"),
    pct_reg_after=100 * pl.col("rows_reg_after") / pl.col("rows_reg"),
).with_columns(delta=pl.col("pct_after") - pl.col("pct_before"),
               delta_reg=pl.col("pct_reg_after") - pl.col("pct_reg_before")))
print(byyear.select("year", "rows", "pct_before", "pct_after", "delta",
                    "pct_reg_before", "pct_reg_after", "delta_reg")
      .with_columns(pl.selectors.float().round(3)))
byyear.write_csv(L3D_COVERAGE_BY_YEAR)

t = fy["n"].sum()
b_ = fy.filter(pl.col("old_fno").is_not_null())["n"].sum()
a_ = fy.filter(pl.col("new_fno").is_not_null())["n"].sum()
r = fy.filter(reg)
tr, br, ar = r["n"].sum(), r.filter(pl.col("old_fno").is_not_null())["n"].sum(), \
    r.filter(pl.col("new_fno").is_not_null())["n"].sum()
print(f"\nPANEL-WIDE, all rows     : {b_ / t:.4%} -> {a_ / t:.4%} "
      f"(+{100 * (a_ - b_) / t:.3f}pp, {a_ - b_:,} vote rows recovered)")
print(f"PANEL-WIDE, registrant   : {br / tr:.4%} -> {ar / tr:.4%} "
      f"(+{100 * (ar - br) / tr:.3f}pp)")

# ---------------------------------------------------------------------------
# 10. VERIFY 2 — the brief's named funds, one by one
# ---------------------------------------------------------------------------
rule("VERIFY 2 — the six funds the brief named, and what happened to each")

WATCH = [("FEDERATED MINI-CAP INDEX", "FEDERATED MINI-CAP INDEX FUND"),
         ("EQUAL WEIGHT ETF", "Guggenheim / Rydex S&P 500 Equal Weight ETF"),
         ("MORGAN STANLEY S&P 500 INDEX", "MORGAN STANLEY S&P 500 INDEX FUND"),
         ("WILMINGTON MULTI-MANAGER", "WILMINGTON MULTI-MANAGER LARGE-CAP PARAMETRIC"),
         ("MASTER SMALL CAP GROWTH", "BLACKROCK MASTER SMALL CAP GROWTH PORTFOLIO")]
for pat, label in WATCH:
    sub = cand.filter(pl.col("fundname_modal").str.to_uppercase()
                      .str.contains(pat, literal=True))
    print(f"\n  {label}")
    if not sub.height:
        print("    no candidate at all (no SEC ticker, or none present in CRSP)")
        continue
    for row in sub.sort("n_vote_rows", descending=True).head(4).iter_rows(named=True):
        v = "ACCEPTED via " + row["accept_path"] if row["accept"] else "REJECTED"
        print(f"    [{v}]  {row['fundname_modal']}  ({row['n_vote_rows']:,} rows)")
        print(f"       ISS inst   : {row['institutionname_modal']}")
        print(f"       tickers    : {sorted(row['hit_tickers'])}"
              f"  ({row['n_tk_unit']} of the series' {row['n_sec_tk']} land on this unit)")
        print(f"       CRSP       : {row['crsp_fund_name'] if 'crsp_fund_name' in row else ''}"
              f"{(row['crsp_names'] or [''])[0]}")
        print(f"       signals    : multi={row['sig_multi']} family="
              f"{row['family_token']} name={row['name_score']:.4f}")
        if not row["accept"]:
            print(f"       reason     : {row['reject_reason']}")

_bl = cand.filter(pl.col("fundname_modal").str.to_uppercase()
                  .str.contains("MASTER SMALL CAP GROWTH", literal=True))
assert _bl.height and not _bl["accept"].any(), \
    "the BlackRock master was ACCEPTED — re-check the reused-ticker guard"
print("\n  ASSERTED: the BlackRock master is REJECTED. Its only CRSP-present "
      "ticker (SSPSX, 1 of the series' 6) sits on a State Street fund; the "
      "other five BlackRock tickers are absent from CRSP entirely. This is a "
      "reused ticker, not a link.")

# ---------------------------------------------------------------------------
# 11. VERIFY 3 — every ticker collision among the candidates
# ---------------------------------------------------------------------------
rule("VERIFY 3 — ticker collisions among the candidate tickers, verbatim")

cand_tk = hits.select("tk").unique()
coll = (crsp_tk.join(cand_tk, on="tk", how="semi")
        .group_by("tk").agg(n_crsp_fundno=pl.col("crsp_fundno").n_unique(),
                            n_unit=pl.col("unit").n_unique(),
                            n_mgmt_cd=pl.col("mgmt_cd").n_unique(),
                            crsp_funds=pl.col("fund_name").unique(),
                            mgmts=pl.col("mgmt_name").drop_nulls().unique())
        .filter(pl.col("n_crsp_fundno") > 1).sort("n_crsp_fundno", descending=True))
print(f"{coll.height:,} of {cand_tk.height:,} candidate tickers sit on >1 crsp_fundno "
      f"({coll.filter(pl.col('n_mgmt_cd') > 1).height:,} cross a mgmt_cd):")
for row in coll.iter_rows(named=True):
    print(f"\n  {row['tk']}  ({row['n_crsp_fundno']} fundnos, {row['n_unit']} units, "
          f"{row['n_mgmt_cd']} mgmt_cds)")
    for f_, m in zip(row["crsp_funds"], (list(row["mgmts"]) + [""] * 9)):
        print(f"     {f_}   [{m}]")
    _s = cand.filter(pl.col("hit_tickers").list.contains(row["tk"]))
    for r2 in _s.iter_rows(named=True):
        print(f"     ISS  {r2['fundname_modal']} -> "
              f"{'ACCEPTED via ' + r2['accept_path'] if r2['accept'] else 'REJECTED'}")
coll.with_columns(pl.col("crsp_funds").list.join(" || "),
                  pl.col("mgmts").list.join(" || ")).write_csv(L3D_COLLISIONS)
print("\n  NOTE: cross-family collisions are NOT rejected on the collision alone — "
      "the strict-plurality unit choice plus the three-signal ladder already "
      "adjudicate them, and VERIFY C showed the dangerous reuses are the ones "
      "that DON'T collide. Every case above is listed with its outcome.")

# ---------------------------------------------------------------------------
# 12. VERIFY 4 — the 20-row hand-audit sample
# ---------------------------------------------------------------------------
rule(f"VERIFY 4 — reproducible {L3D_AUDIT_N}-row audit sample "
     f"(seed {L3D_AUDIT_SEED})")

aud = (fuzzy.select("fundid", "fundname_modal", "institutionname_modal",
                    ticker=pl.col("hit_tickers").list.sort().list.join(","),
                    crsp_fund_name="crsp_fund_name", mgmt_name="mgmt_name",
                    index_fund_flag="index_fund_flag", tna_latest="tna_latest",
                    accept_path="accept_path", name_score="name_score",
                    family_token="family_token", n_tk_unit="n_tk_unit",
                    n_sec_tk="n_sec_tk", n_vote_rows="n_vote_rows")
       .sample(n=min(L3D_AUDIT_N, fuzzy.height), seed=L3D_AUDIT_SEED)
       .sort("n_vote_rows", descending=True))
print(aud.select("fundname_modal", "institutionname_modal", "ticker", "crsp_fund_name",
                 "mgmt_name", "index_fund_flag", "accept_path"))
aud.write_csv(L3D_AUDIT_SAMPLE)

# ---------------------------------------------------------------------------
# 13. VERIFY 5 — blocks, and how much of the gain lands in `index`
# ---------------------------------------------------------------------------
rule("VERIFY 5 — block effect")

nb = out.join(fuzzy.select("fundid"), on="fundid", how="semi")
print("blocks of the funds this tier recovered:")
print(nb.group_by("block", "block_source").agg(
    fundids=pl.len(), vote_rows=pl.col("n_vote_rows").cast(pl.Float64).sum(),
    tna=pl.col("tna_latest").sum()).sort("vote_rows", descending=True))
n_idx = nb.filter(pl.col("block") == "index")
print(f"\nlanding in block='index'           : {n_idx.height:,} fundids, "
      f"{n_idx['n_vote_rows'].cast(pl.Float64).sum():,.0f} vote rows "
      f"({100 * n_idx['n_vote_rows'].cast(pl.Float64).sum() / max(nb['n_vote_rows'].cast(pl.Float64).sum(), 1):.1f}% "
      "of the tier's recovered volume)")

print(f"\nblock reassignments: {changes.height:,} fundids, "
      f"{changes['n_vote_rows'].cast(pl.Float64).sum() if changes.height else 0:,.0f} vote rows")
if changes.height:
    print(changes)
changes.write_csv(L3D_BLOCK_CHANGES)

# panel block shares — cast before aggregating (the uint32 HAZARD)
bl = out.group_by("block").agg(vote_rows=pl.col("n_vote_rows").cast(pl.Float64).sum())
assert abs(bl["vote_rows"].sum() - TOTAL_ROWS) < 1, "block shares do not reconcile"
print("\npanel block distribution after L3d (reconciled to the column total):")
print(bl.with_columns(pct=100 * pl.col("vote_rows") / TOTAL_ROWS).sort("vote_rows",
                                                                      descending=True))

# ---------------------------------------------------------------------------
# 14. VERIFY 6 — TNA hazard
# ---------------------------------------------------------------------------
rule("VERIFY 6 — TNA per vote row for the links this tier adds")

haz = (fuzzy.filter(pl.col("tna_latest").is_not_null())
       .select("fundid", "fundname_modal", "crsp_fund_name", "tna_latest",
               "n_vote_rows", "accept_path",
               tna_per_row=pl.col("tna_latest") / pl.col("n_vote_rows").cast(pl.Float64))
       .sort("tna_per_row", descending=True))
print(f"{haz.height:,} of {fuzzy.height:,} new links carry a tna_latest; "
      f"median ${haz['tna_latest'].median() or 0:,.1f}M; "
      f"total ${fuzzy.unique(subset=['crsp_fundno'])['tna_latest'].sum() / 1e3:,.2f}B "
      "over distinct crsp_fundno")
print(haz.head(10))
haz.write_csv(L3D_TNA_HAZARD)

# ---------------------------------------------------------------------------
# 15. VERIFY 7 — what remains of Gap A, and why
# ---------------------------------------------------------------------------
rule("VERIFY 7 — the residual Gap A")

res = (gap_a.join(fuzzy.select("fundid"), on="fundid", how="anti")
       .join(n_tk_per_series, left_on="seriesid", right_on="series_id", how="left")
       .join(hits.group_by("series_id").agg(n_hit_tk=pl.col("tk").n_unique()),
             left_on="seriesid", right_on="series_id", how="left")
       .join(cand.select("fundid", "reject_reason", "name_score", "family_token"),
             on="fundid", how="left")
       .with_columns(residual_reason=pl.when(pl.col("n_sec_tk").is_null())
                     .then(pl.lit("series carries NO SEC class ticker"))
                     .when(pl.col("n_hit_tk").is_null())
                     .then(pl.lit("SEC tickers all absent from CRSP fund_summary2"))
                     .otherwise(pl.col("reject_reason"))))
print(f"Gap A before L3d: {gap_a.height:,} fundids / "
      f"{gap_a['n_vote_rows'].cast(pl.Float64).sum():,.0f} vote rows")
print(f"Gap A after  L3d: {res.height:,} fundids / "
      f"{res['n_vote_rows'].cast(pl.Float64).sum():,.0f} vote rows\n")
print(res.group_by("residual_reason").agg(
    fundids=pl.len(), vote_rows=pl.col("n_vote_rows").cast(pl.Float64).sum())
    .sort("vote_rows", descending=True))
res.select("fundid", "fundname_modal", "institutionname_modal", "seriesid",
           "n_vote_rows", "block", "n_sec_tk", "n_hit_tk", "name_score",
           "family_token", "residual_reason").sort(
    "n_vote_rows", descending=True).write_csv(L3D_RESIDUAL)

# ---------------------------------------------------------------------------
# 16. audit trail
# ---------------------------------------------------------------------------
rule("audit trail")

LIST_COLS = ["sec_entities", "crsp_names", "crsp_mgmts", "hit_tickers"]


def flat(df):
    return df.with_columns([pl.col(c).list.sort().list.join(" || ") for c in LIST_COLS
                            if c in df.columns])


flat(cand).drop("crsp_haystack").write_csv(L3D_CANDIDATES)
flat(rej).drop("crsp_haystack").sort("n_vote_rows", descending=True).write_csv(L3D_REJECTED)
flat(fuzzy).drop("crsp_haystack").sort("n_vote_rows", descending=True).write_csv(L3D_ACCEPTED)

band = (cand.filter(~pl.col("sig_multi"), ~pl.col("sig_family"),
                    pl.col("name_score").is_between(L3D_NAME_CAND_FLOOR,
                                                    L3D_NAME_SOLO_THRESH))
        .sort("name_score", descending=True))
flat(band).drop("crsp_haystack").write_csv(L3D_NAME_ONLY_BAND)
print(f"the DECLINED name-only band [{L3D_NAME_CAND_FLOOR}, {L3D_NAME_SOLO_THRESH}) — "
      f"{band.height:,} fundids / {band['n_vote_rows'].cast(pl.Float64).sum():,.0f} vote rows, "
      "shipped so the bar can be revisited on evidence:")
print(band.select("fundname_modal", "sec_name", "crsp_name", "name_score", "n_vote_rows"))

for p in (L3D_ACCEPTED, L3D_CANDIDATES, L3D_REJECTED, L3D_COLLISIONS,
          L3D_NAME_ONLY_BAND, L3D_AUDIT_SAMPLE, L3D_COVERAGE_BY_YEAR,
          L3D_BLOCK_CHANGES, L3D_FLAG_DISAGREEMENTS, L3D_TNA_HAZARD, L3D_RESIDUAL):
    print(f"  wrote {p}")

rule("L3d done")
