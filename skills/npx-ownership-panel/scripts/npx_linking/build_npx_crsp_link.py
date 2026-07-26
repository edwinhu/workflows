#!/usr/bin/env python3
"""build_npx_crsp_link.py — the portable ISS -> CRSP ladder.

Consumes only WRDS-derived inputs, so a fresh checkout with WRDS credentials can
produce a `fundid -> (crsp_fundno, block)` crosswalk with no project artifacts:

    npx_funds.parquet        pull_npx_funds.py    ISS fund dimension (~27K rows)
    crsp_funds.parquet       pull_crsp_funds.py   CRSP fund dimension (~75K rows)
    sec_series_master.parquet  build_sec_series_master.py   OPTIONAL (via_sec_ticker)
    family overlay CSV       hand-curated          OPTIONAL (see --family-overlay)

Output: npx_crsp_link.parquet, one row per fundid, plus a coverage report.

THE LADDER (precision-descending; the first tier that fires wins)
----------------------------------------------------------------
    iss_seriesid      exact  ISS seriesid -> crsp_cik_map.series_cik,
                             fundid votes only in the reporting era (2023+)
    propagated        exact  same id, carried back over the stable fundid to its
                             pre-2023 votes
    via_sec_ticker    exact  seriesid -> SEC class ticker -> CRSP ticker
                             (needs sec_series_master.parquet)
    crsp_name_scoped  fuzzy  scoped to mgmt companies of the institution's
                             already-linked siblings; bar 0.90
    crsp_name_global  fuzzy  unscoped; 0.85 + independent signal + 0.02 margin,
                             or 0.97 identity. Never on score alone.
    unlinked          --     no crsp_fundno. STILL GETS A BLOCK (name fallback),
                             so the crosswalk covers every fundid.

EXACT-ID TIERS ARE THE STRATEGY, NOT THE MATCHER. Read
`references/npx-crsp-linking.md` before touching a threshold; every one of them
prevents a specific measured failure.

    ./build_npx_crsp_link.py --npx-funds npx_funds.parquet \
        --crsp-funds crsp_funds.parquet --out npx_crsp_link.parquet
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from linking_config import cfg  # noqa: E402
from matching import (  # noqa: E402
    cross_family_verdict, digit_guard_mask, family_tokens, normalize_name,
    tfidf_candidates,
)

TIER_ORDER = [
    "iss_seriesid", "propagated", "via_sec_ticker", "sec_name",
    "crsp_name_scoped", "crsp_name_global", "unlinked",
]


def hdr(t: str) -> None:
    print(f"\n{'=' * 78}\n{t}\n{'=' * 78}", flush=True)


# ---------------------------------------------------------------------------
# CRSP fund units
# ---------------------------------------------------------------------------
def build_fund_units(crsp: pl.DataFrame) -> pl.DataFrame:
    """Collapse CRSP share classes to FUND units.

    `fund_summary2`/`fund_hdr` are class-grained (one row per crsp_fundno). The
    analysis unit is the fund: classes of one fund share `crsp_portno`. Where
    portno is null the class is its own singleton unit — encoded as a negative
    id so it can never collide with a real portno.

    TNA is summed across classes: that IS the fund's TNA. (The double-count
    hazard is on the ISS side — many fundids to one unit — and is handled in
    `split_tna`, not here.)
    """
    crsp = crsp.with_columns(
        pl.when(pl.col("crsp_portno").is_not_null())
          .then(pl.col("crsp_portno"))
          .otherwise(-pl.col("crsp_fundno"))
          .alias("fund_unit")
    )
    # Representative class = largest tna, ties broken by fundno for determinism.
    rep = (crsp.sort(["fund_unit", "tna_latest", "crsp_fundno"],
                     descending=[False, True, False], nulls_last=True)
               .unique(subset=["fund_unit"], keep="first")
               .select("fund_unit", "crsp_fundno", "crsp_portno", "fund_name",
                       "ticker", "mgmt_name", "mgmt_cd", "first_offer_dt", "end_dt"))

    agg = crsp.group_by("fund_unit").agg(
        # int64 everywhere — see the uint32 trap in the reference.
        pl.col("tna_latest").cast(pl.Float64).sum().alias("tna_unit"),
        pl.len().alias("n_classes"),
        # A fund is index-linked if ANY class is flagged; D (pure index) wins
        # over B/E, which win over null.
        pl.col("index_fund_flag").drop_nulls().sort().first().alias("index_fund_flag"),
        pl.col("series_cik").drop_nulls().first().alias("series_cik"),
        pl.col("end_dt").max().alias("last_end_dt"),
    )
    # DETERMINISM: polars joins do not guarantee row order, and this frame's
    # order becomes the TF-IDF target-corpus order via with_row_index below.
    # A shuffled corpus changes which candidates survive top_n at the threshold
    # boundary, so the whole ladder moves. Pin it here, once.
    return rep.join(agg, on="fund_unit", how="left").sort("fund_unit")


# ---------------------------------------------------------------------------
# Tier 1-2: exact, via SEC series id
# ---------------------------------------------------------------------------
def series_to_unit(crsp: pl.DataFrame, units: pl.DataFrame) -> pl.DataFrame:
    """series_cik (S000...) -> one CRSP fund unit.

    A series maps to several crsp_fundnos (its share classes) and therefore to
    one fund unit; where a series spans more than one unit, take the largest by
    TNA, deterministically.
    """
    return (crsp.filter(pl.col("series_cik").is_not_null())
                .join(units.select("crsp_fundno", "fund_unit", "tna_unit"),
                      on="crsp_fundno", how="inner")
                .select("series_cik", "fund_unit", "tna_unit")
                .unique()
                .sort(["series_cik", "tna_unit", "fund_unit"],
                      descending=[False, True, False], nulls_last=True)
                .unique(subset=["series_cik"], keep="first")
                .select(pl.col("series_cik").alias("seriesid"), "fund_unit")
                .sort("seriesid"))


def tier_seriesid(npx: pl.DataFrame, crsp: pl.DataFrame,
                  units: pl.DataFrame) -> pl.DataFrame:
    """ISS seriesid -> crsp_cik_map.series_cik. The majority of the crosswalk.

    A series maps to several crsp_fundnos (its share classes) and therefore to
    one fund unit; where a series spans more than one unit we take the largest
    by TNA, deterministically.
    """
    linked = npx.join(series_to_unit(crsp, units), on="seriesid", how="inner")

    # The reporting-era distinction: `iss_seriesid` means the fundid's votes are
    # confined to 2023+, where ISS actually reports the id. `propagated` means
    # the id was carried back over the stable fundid to earlier votes — the same
    # exact resolution, but worth labelling because its evidence is indirect.
    return linked.with_columns(
        pl.when(pl.col("first_vote_year") >= cfg.L2_ISS_SERIESID_ERA)
          .then(pl.lit("iss_seriesid")).otherwise(pl.lit("propagated"))
          .alias("match_tier")
    ).select("fundid", "fund_unit", "match_tier")


def tier_sec_ticker(npx: pl.DataFrame, units: pl.DataFrame,
                    sec_master: pl.DataFrame | None) -> pl.DataFrame:
    """seriesid -> SEC class ticker -> CRSP ticker. Optional, needs L1 output."""
    empty = pl.DataFrame(schema={"fundid": pl.Float64, "fund_unit": pl.Float64,
                                 "match_tier": pl.String})
    if sec_master is None:
        return empty
    cols = set(sec_master.columns)
    if not {"series_id", "class_ticker"} <= cols:
        print("  sec_series_master lacks series_id/class_ticker — tier skipped")
        return empty

    sec = (sec_master.select(pl.col("series_id").alias("seriesid"),
                             pl.col("class_ticker").alias("ticker"))
                     .filter(pl.col("ticker").is_not_null()
                             & (pl.col("ticker").str.len_chars() > 0))
                     .unique())
    # A ticker must identify ONE fund unit or it is not evidence.
    tkr = (units.filter(pl.col("ticker").is_not_null())
                .select("ticker", "fund_unit")
                .unique()
                .filter(pl.len().over("ticker") == 1))
    # DETERMINISM: unique(keep="first") is order-sensitive and joins do not
    # guarantee row order, so the surviving row must be pinned by a TOTAL sort.
    # Without this the tier picks a different fund_unit between runs.
    return (npx.filter(pl.col("seriesid").is_not_null())
               .join(sec, on="seriesid", how="inner")
               .join(tkr, on="ticker", how="inner")
               .select("fundid", "fund_unit",
                       pl.lit("via_sec_ticker").alias("match_tier"))
               .sort(["fundid", "fund_unit"])
               .unique(subset=["fundid"], keep="first"))


def tier_sec_name(remaining: pl.DataFrame, sid2unit: pl.DataFrame,
                  sec_names: pl.DataFrame | None,
                  overlay: dict[str, str]) -> pl.DataFrame:
    """ISS fund name -> SEC series name -> seriesId -> CRSP. The gap-closer.

    WHY THIS TIER EXISTS: ISS only reports `seriesid` from 2023. A fund that
    stopped voting before then has NO id, so the exact tier cannot reach it —
    and that is most of the panel by fundid count. Matching the ISS name against
    SEC SERIES names recovers the id, and the id then resolves exactly through
    crsp_cik_map. This is a name match used to obtain an IDENTIFIER, which is
    far safer than a name match used to obtain a link directly.

    Uses the CONTEMPORANEOUS name history (`sec_series_names_long`), not just
    the current name: SEC names are restated, and the current name systematically
    fails for exactly the dead mid-panel funds this tier serves.

    The SEC `entity_name` is the family for the cross-family rule.
    """
    empty = pl.DataFrame(schema={"fundid": pl.Float64, "fund_unit": pl.Float64,
                                 "match_tier": pl.String})
    if sec_names is None or remaining.is_empty():
        return empty

    tgt = (sec_names.filter(pl.col("series_name").is_not_null())
                    .select("series_id", "series_name", "entity_name")
                    .unique()
                    .with_columns(normalize_name("series_name").alias("tgt_norm"))
                    .filter(pl.col("tgt_norm").str.len_chars() > 0)
                    # DETERMINISM: sort BEFORE unique(keep="first") so the kept
                    # row is defined, then the sort also pins the corpus order.
                    .sort(["tgt_norm", "series_id", "entity_name"])
                    .unique(subset=["tgt_norm", "series_id"], keep="first")
                    .sort(["tgt_norm", "series_id"]))
    # Only series that actually reach CRSP are worth matching against.
    tgt = (tgt.join(sid2unit.rename({"seriesid": "series_id"}),
                    on="series_id", how="inner")
              .sort(["tgt_norm", "series_id", "fund_unit"]))
    if tgt.is_empty():
        return empty

    q = remaining.with_columns(
        pl.col("fundname_modal").fill_null("").alias("q_bare"),
        (pl.col("fundname_modal").fill_null("") + " " +
         pl.col("institutionname_modal").fill_null("")).alias("q_app"),
    ).with_columns(normalize_name("q_bare").alias("q_bare_norm"),
                   normalize_name("q_app").alias("q_app_norm")
                   ).filter(pl.col("q_bare_norm").str.len_chars() > 0).sort("fundid")
    if q.is_empty():
        return empty

    tgt_names = tgt["tgt_norm"].to_list()
    frames = []
    for form, col in ((0, "q_bare_norm"), (1, "q_app_norm")):
        c = tfidf_candidates(q[col].to_list(), tgt_names,
                             top_k=cfg.L2_TFIDF_TOP_K,
                             threshold=cfg.L2_CAND_THRESHOLD)
        frames.append(c.with_columns(pl.lit(form).alias("form")))
    cand = pl.concat(frames, how="vertical")
    if cand.is_empty():
        return empty

    qi = q.with_row_index("row").with_columns(pl.col("row").cast(pl.Int32))
    ti = tgt.with_row_index("col").with_columns(pl.col("col").cast(pl.Int32))
    cand = (cand.join(qi, on="row", how="inner")
                .join(ti.select("col", "tgt_norm", "series_id", "fund_unit",
                                pl.col("entity_name").alias("t_mgmt"),
                                pl.col("series_name").alias("t_name")),
                      on="col", how="inner")
                .with_columns(
                    pl.when(pl.col("form") == 0).then(pl.col("q_bare_norm"))
                      .otherwise(pl.col("q_app_norm")).alias("l_norm"),
                    pl.col("tgt_norm").alias("r_norm")))

    before = cand.height
    cand = cand.filter(digit_guard_mask("l_norm", "r_norm"))
    print(f"  sec_name digit guard: {before:,} -> {cand.height:,} pairs "
          f"({100*(before-cand.height)/max(before,1):.0f}% dropped)")
    if cand.is_empty():
        return empty

    cand = (cand.with_columns(
                pl.when(pl.col("form") == 0).then(pl.col("score"))
                  .otherwise(0.0).alias("bare_score"))
            # DETERMINISM: see fuzzy_link — sort before any .first().
            .sort(["fundid", "fund_unit", "col"])
            .group_by(["fundid", "fund_unit"], maintain_order=True)
            .agg(pl.col("score").max().alias("score"),
                 pl.col("bare_score").max().alias("bare_score"),
                 pl.col("t_mgmt").first().alias("t_mgmt"),
                 pl.col("t_name").first().alias("t_name"),
                 pl.col("institutionname_modal").first().alias("inst")))

    fam = (cand.select("inst").unique()
               .with_columns(family_tokens("inst").alias("fam_toks")))
    cand = cand.join(fam, on="inst", how="left")

    keep, gates = [], {}
    for r in cand.to_dicts():
        toks = list(r.get("fam_toks") or [])
        if overlay:
            ov = overlay.get((r.get("inst") or "").strip().upper())
            if ov:
                toks = [ov]
        # No sibling scope here (these funds have no exact-tier siblings by
        # definition), so scope_support is 0 and only the `direct` family gate
        # or a no-token institution can pass. That is deliberate: without ID
        # evidence, a cross-family name match is exactly the BlackRock ->
        # Allspring error.
        v = cross_family_verdict(toks, r.get("t_name"), r.get("t_mgmt"),
                                 r.get("bare_score") or 0.0, 0.0)
        gates[v.gate] = gates.get(v.gate, 0) + 1
        if v.ok:
            keep.append(r)
    print(f"  sec_name cross-family gates: {gates}")
    if not keep:
        return empty

    # DETERMINISM: total tie-break, as in fuzzy_link above.
    cand = pl.DataFrame(keep).sort(["fundid", "score", "fund_unit"],
                                   descending=[False, True, False])
    ranked = cand.with_columns(pl.int_range(pl.len()).over("fundid").alias("rk"))
    second = (ranked.filter(pl.col("rk") == 1)
                    .select("fundid", pl.col("score").alias("s2")))
    top = (ranked.filter(pl.col("rk") == 0)
                 .join(second, on="fundid", how="left")
                 .with_columns(pl.col("s2").fill_null(0.0)))

    # A token-bearing institution only reached here via the `direct` gate (the
    # veto killed everything else, since scope_support is 0 for these funds), so
    # having a family token IS family agreement at this point.
    top = top.with_columns(
        pl.col("fam_toks").list.len().fill_null(0).gt(0).alias("family_agreed"))

    # Family agreement earns the scoped bar (an entity-name family token IS a
    # scope, just a fuzzy one); without it, only a near-identity passes. Both
    # must be unambiguous — fund names are many-to-one.
    ok = (
        ((pl.col("score") >= cfg.L2_GLOBAL_FAMILY_THRESH) & pl.col("family_agreed"))
        | (pl.col("score") >= cfg.L2_GLOBAL_EXACTISH)
    ) & ((pl.col("score") - pl.col("s2")) >= cfg.L2_GLOBAL_MARGIN)

    return (top.filter(ok)
               .select("fundid", "fund_unit",
                       pl.lit("sec_name").alias("match_tier")))


# ---------------------------------------------------------------------------
# Fuzzy tiers
# ---------------------------------------------------------------------------
def fuzzy_link(remaining: pl.DataFrame, units: pl.DataFrame,
               resolved: pl.DataFrame, overlay: dict[str, str]) -> pl.DataFrame:
    """crsp_name_scoped + crsp_name_global.

    Query forms, per the reference:
      form 0  the ISS fund name alone (bare)
      form 1  the ISS fund name with its institution appended
    Score on max(bare, appended) — the two are complementary, not substitutes.
    NEVER replace the bare form with a sponsor-stripped one; doing that let a
    BlackRock master match an Allspring fund.

    Target form: CRSP fund_name with the class suffix stripped. The TRUST PREFIX
    IS KEPT — stripping it is what caused the cross-family false match — which is
    also why the scoped bar here is 0.90 and not 0.80 (trust-prefix dominance).
    """
    empty = pl.DataFrame(schema={"fundid": pl.Float64, "fund_unit": pl.Float64,
                                 "match_tier": pl.String})
    if remaining.is_empty():
        return empty

    tgt = (units.filter(pl.col("fund_name").is_not_null())
                .with_columns(
                    pl.col("fund_name").str.replace(cfg.L3_CLASS_SUFFIX_RE, "")
                      .alias("tgt_raw"))
                .with_columns(normalize_name("tgt_raw").alias("tgt_norm"))
                .filter(pl.col("tgt_norm").str.len_chars() > 0)
                # DETERMINISM: fixes the corpus row order -> fixes `col` indices.
                .sort(["tgt_norm", "fund_unit"]))
    if tgt.is_empty():
        return empty

    q = remaining.with_columns(
        pl.col("fundname_modal").fill_null("").alias("q_bare"),
        (pl.col("fundname_modal").fill_null("") + " " +
         pl.col("institutionname_modal").fill_null("")).alias("q_appended"),
    ).with_columns(
        normalize_name("q_bare").alias("q_bare_norm"),
        normalize_name("q_appended").alias("q_app_norm"),
    ).filter(pl.col("q_bare_norm").str.len_chars() > 0).sort("fundid")
    if q.is_empty():
        return empty

    tgt_names = tgt["tgt_norm"].to_list()
    frames = []
    for form, col in ((0, "q_bare_norm"), (1, "q_app_norm")):
        c = tfidf_candidates(q[col].to_list(), tgt_names,
                             top_k=cfg.L3_TFIDF_TOP_K,
                             threshold=cfg.L3_CAND_THRESHOLD)
        frames.append(c.with_columns(pl.lit(form).alias("form")))
    cand = pl.concat(frames, how="vertical")
    if cand.is_empty():
        return empty

    # Attach both sides. `l_norm` is the form that PRODUCED the score — the
    # digit guard is positional and must see that form, not the raw name.
    qi = q.with_row_index("row").with_columns(pl.col("row").cast(pl.Int32))
    ti = tgt.with_row_index("col").with_columns(pl.col("col").cast(pl.Int32))
    cand = (cand.join(qi, on="row", how="inner")
                .join(ti.select("col", "tgt_norm", "fund_unit",
                                pl.col("mgmt_name").alias("t_mgmt"),
                                pl.col("fund_name").alias("t_name")),
                      on="col", how="inner")
                .with_columns(
                    pl.when(pl.col("form") == 0).then(pl.col("q_bare_norm"))
                      .otherwise(pl.col("q_app_norm")).alias("l_norm"),
                    pl.col("tgt_norm").alias("r_norm")))

    before = cand.height
    cand = cand.filter(digit_guard_mask("l_norm", "r_norm"))
    print(f"  digit guard: {before:,} -> {cand.height:,} candidate pairs "
          f"({100*(before-cand.height)/max(before,1):.0f}% dropped)")
    if cand.is_empty():
        return empty

    # Collapse the two forms: max(bare, appended) per (fundid, unit), keeping
    # the bare score separately because the succession exception may only ever
    # be granted on a BARE-name identity.
    cand = (cand.with_columns(
                pl.when(pl.col("form") == 0).then(pl.col("score"))
                  .otherwise(0.0).alias("bare_score"))
            # DETERMINISM: .first() inside group_by takes whatever row the
            # grouping happens to emit first. Sort the input so "first" is a
            # defined row, not an accident of hash-map iteration order.
            .sort(["fundid", "fund_unit", "col"])
            .group_by(["fundid", "fund_unit"], maintain_order=True)
            .agg(pl.col("score").max().alias("score"),
                 pl.col("bare_score").max().alias("bare_score"),
                 pl.col("t_mgmt").first().alias("t_mgmt"),
                 pl.col("t_name").first().alias("t_name"),
                 pl.col("institutionname_modal").first().alias("inst"),
                 pl.col("last_vote_year").first().alias("last_vote_year"),
                 pl.col("first_vote_year").first().alias("first_vote_year")))

    # Scope: the mgmt companies this institution's ALREADY-EXACTLY-LINKED
    # siblings file under. Evidence from SEC ids, which a matcher cannot fake.
    sib = (resolved.join(units.select("fund_unit", "mgmt_name"),
                         on="fund_unit", how="inner")
                   .filter(pl.col("mgmt_name").is_not_null())
                   .group_by(["institutionname_modal", "mgmt_name"])
                   .agg(pl.len().alias("n")))
    tot = sib.group_by("institutionname_modal").agg(pl.col("n").sum().alias("tot"))
    sib = (sib.join(tot, on="institutionname_modal")
              .with_columns((pl.col("n") / pl.col("tot")).alias("scope_support"))
              .select(pl.col("institutionname_modal").alias("inst"),
                      pl.col("mgmt_name").alias("t_mgmt"), "scope_support"))
    cand = cand.join(sib, on=["inst", "t_mgmt"], how="left").with_columns(
        pl.col("scope_support").fill_null(0.0))

    # Lifespan guard: a CRSP fund whose life ended before this fund first voted
    # cannot be the same fund. Independent of the name score, and it bites
    # exactly where the fuzzy tiers work (dead early-panel funds).
    cand = cand.join(units.select("fund_unit", "last_end_dt"),
                     on="fund_unit", how="left")
    slack = cfg.L3_LIFESPAN_SLACK_YEARS
    cand = cand.with_columns(
        (pl.col("last_end_dt").is_null()
         | (pl.col("last_end_dt").dt.year() + slack >= pl.col("first_vote_year"))
         ).alias("lifespan_ok")
    ).filter(pl.col("lifespan_ok"))

    # The cross-family veto, applied to CANDIDATES before top-1 is chosen — a
    # cross-family candidate must not crowd out a correct in-family one.
    fam = (cand.select("inst").unique()
               .with_columns(family_tokens("inst").alias("fam_toks")))
    cand = cand.join(fam, on="inst", how="left")

    rows = cand.to_dicts()
    keep, gates = [], {}
    for r in rows:
        toks = list(r.get("fam_toks") or [])
        if overlay:
            ov = overlay.get((r.get("inst") or "").strip().upper())
            if ov:
                toks = [ov]        # curated family label wins over the derived one
        v = cross_family_verdict(toks, r.get("t_name"), r.get("t_mgmt"),
                                 r.get("bare_score") or 0.0,
                                 r.get("scope_support") or 0.0)
        gates[v.gate] = gates.get(v.gate, 0) + 1
        if v.ok:
            keep.append(r)
    print(f"  cross-family gates: {gates}")
    if not keep:
        return empty
    cand = pl.DataFrame(keep)

    # Top-1 and runner-up per fundid, for the ambiguity margin.
    # DETERMINISM: rank("ordinal") assigns tied scores in frame order, which is
    # not stable across runs. Sort on (score desc, fund_unit asc) so the tie-break
    # is TOTAL, then take positional row numbers within each fundid.
    cand = cand.sort(["fundid", "score", "fund_unit"], descending=[False, True, False])
    ranked = cand.with_columns(pl.int_range(pl.len()).over("fundid").alias("rk"))
    second = (ranked.filter(pl.col("rk") == 1)
                    .select("fundid", pl.col("score").alias("s2")))
    top = (ranked.filter(pl.col("rk") == 0)
                 .join(second, on="fundid", how="left")
                 .with_columns(pl.col("s2").fill_null(0.0)))

    scoped_ok = (pl.col("scope_support") > 0) & (pl.col("score") >= cfg.L2_CRSP_SCOPED_THRESH)
    # Unscoped never accepts on score alone: it needs the bar, an independent
    # signal (family agreement, i.e. it survived the veto by the `direct` gate,
    # or a normalised-name identity), and an unambiguous margin.
    global_ok = (
        (pl.col("score") >= cfg.L3_GLOBAL_THRESH)
        & ((pl.col("score") - pl.col("s2")) >= cfg.L3_GLOBAL_MARGIN)
        & ((pl.col("score") >= cfg.L3_GLOBAL_EXACTISH) | (pl.col("scope_support") > 0))
    )
    out = (top.with_columns(
               pl.when(scoped_ok).then(pl.lit("crsp_name_scoped"))
                 .when(global_ok).then(pl.lit("crsp_name_global"))
                 .otherwise(pl.lit(None)).alias("match_tier"))
              .filter(pl.col("match_tier").is_not_null())
              .select("fundid", "fund_unit", "match_tier"))
    return out


# ---------------------------------------------------------------------------
# Blocks and weights
# ---------------------------------------------------------------------------
def assign_blocks(link: pl.DataFrame) -> pl.DataFrame:
    """block + block_source.

    For a CRSP-LINKED fund the flag is authoritative and a NULL flag is
    informative (CRSP says not index-linked -> active), NOT missing. The name
    regex is a lower-confidence fallback used ONLY for funds that never reached
    a crsp_fundno — `block_source` keeps the two distinguishable forever.
    """
    idx_re = f"(?i)({cfg.L3_INDEX_NAME_BASE}|{cfg.L3_INDEX_NAME_EXT})"
    name = (pl.col("fundname_modal").fill_null("") + " " +
            pl.col("institutionname_modal").fill_null(""))
    flag = pl.col("index_fund_flag")
    return link.with_columns(
        pl.when(pl.col("iss_nonregistrant"))
          .then(pl.lit("asset_owner"))
          .when(flag == "D").then(pl.lit("index"))
          .when(flag.is_in(["B", "E"])).then(pl.lit("passive"))
          .when(pl.col("crsp_fundno").is_not_null()).then(pl.lit("active"))
          .when(name.str.contains(idx_re)).then(pl.lit("index"))
          .otherwise(pl.lit("active")).alias("block"),
        pl.when(pl.col("iss_nonregistrant")).then(pl.lit("nonregistrant"))
          .when(flag.is_in(["D", "B", "E"])).then(pl.lit("crsp_flag"))
          .when(pl.col("crsp_fundno").is_not_null()).then(pl.lit("crsp_active"))
          .when(name.str.contains(idx_re)).then(pl.lit("name_regex"))
          .otherwise(pl.lit("name_default")).alias("block_source"),
    )


def split_tna(link: pl.DataFrame) -> pl.DataFrame:
    """Split a fund unit's TNA across the ISS fundids that share it.

    `fundid -> crsp_fundno` is MANY-TO-ONE. Assigning each fundid the unit's
    full TNA and then summing at fundid grain gives $64.43T against a true
    $32.38T — exactly 2x, and entirely plausible-looking. Split so the fundid
    total reconciles to the CRSP total.
    """
    n = pl.len().over("fund_unit")
    return link.with_columns(
        pl.when(pl.col("fund_unit").is_not_null())
          .then(pl.col("tna_unit").cast(pl.Float64) / n)
          .otherwise(None).alias("tna_latest"),
        pl.when(pl.col("fund_unit").is_not_null()).then(n)
          .otherwise(None).alias("n_fundids_sharing_unit"),
    )


def load_overlay(path: str | None) -> dict[str, str]:
    """OPTIONAL hand-curated family labels. Absent -> no-op, ladder still runs.

    Schema (CSV, header required):
        institutionname_modal   exact ISS institution name (matched upper/stripped)
        family_token            the family token to use for the cross-family rule

    Rows with an empty family_token are ignored. This is the ONLY project-
    specific input in the ladder, and it is never required — running without it
    costs coverage in the fuzzy tiers only, and the report says so.
    """
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        print(f"  family overlay {p} not found — continuing without it")
        return {}
    df = pl.read_csv(p)
    need = {"institutionname_modal", "family_token"}
    if not need <= set(df.columns):
        sys.exit(f"family overlay must have columns {sorted(need)}; got {df.columns}")
    d = {str(r["institutionname_modal"]).strip().upper(): str(r["family_token"]).strip().upper()
         for r in df.to_dicts()
         if r["family_token"] and str(r["family_token"]).strip()}
    print(f"  family overlay: {len(d):,} curated institution label(s)")
    return d


# ---------------------------------------------------------------------------
def coverage_report(link: pl.DataFrame, overlay_used: bool) -> None:
    """First-class output: can a new user tell whether their link is healthy?"""
    total_funds = link.height
    total_rows = int(link["n_vote_rows"].sum())

    hdr("COVERAGE — by tier")
    tier = (link.group_by("match_tier")
                .agg(pl.len().alias("fundids"),
                     pl.col("n_vote_rows").sum().alias("vote_rows"))
                .with_columns(
                    (100 * pl.col("fundids") / total_funds).round(2).alias("pct_fundids"),
                    (100 * pl.col("vote_rows") / total_rows).round(2).alias("pct_vote_rows"))
                .sort("vote_rows", descending=True))
    print(tier.to_pandas().to_string(index=False))

    linked = link.filter(pl.col("crsp_fundno").is_not_null())
    lr = int(linked["n_vote_rows"].sum())
    print(f"\nLINKED: {linked.height:,}/{total_funds:,} fundids "
          f"({100*linked.height/total_funds:.1f}%)")
    print(f"LINKED SHARE OF VOTE ROWS: {lr:,}/{total_rows:,} "
          f"({100*lr/total_rows:.1f}%)   <- the number that matters")

    # ISS non-registrants (public pension plans, non-US managers) have NO SEC
    # seriesId BY CONSTRUCTION, so they can never link and are not failures.
    # They still get a block (asset_owner). Report the linkable denominator too,
    # or the headline understates the ladder by the size of that population.
    nonreg = link.filter(pl.col("iss_nonregistrant"))
    nr_rows = int(nonreg["n_vote_rows"].sum())
    linkable = total_rows - nr_rows
    if nr_rows:
        print(f"  excluding {nonreg.height:,} ISS non-registrants "
              f"({nr_rows:,} rows, cannot link by construction): "
              f"{100*lr/max(linkable,1):.1f}% of linkable vote rows")

    hdr("COVERAGE — by block")
    blk = (link.group_by("block")
               .agg(pl.len().alias("fundids"),
                    pl.col("n_vote_rows").sum().alias("vote_rows"))
               .with_columns((100 * pl.col("vote_rows") / total_rows).round(2)
                             .alias("pct_vote_rows"))
               .sort("vote_rows", descending=True))
    print(blk.to_pandas().to_string(index=False))
    # Shares MUST reconcile to 100 — the assertion that catches the uint32 trap.
    # Sum the RAW counts, not the rounded percentages: rounding alone lands at
    # 99.99% and would either mask a real gap or raise a false alarm.
    s = 100.0 * int(blk["vote_rows"].sum()) / total_rows
    assert abs(s - 100.0) < 1e-6, f"block shares sum to {s}, not 100 — check int64 casts"
    print(f"  shares reconcile: {s:.4f}%")

    print("\nby block_source (crsp_flag/crsp_active are authoritative; "
          "name_* are lower-confidence fallbacks):")
    print(link.group_by("block_source").agg(pl.len().alias("fundids"))
              .sort("fundids", descending=True).to_pandas().to_string(index=False))

    hdr("WEIGHT COVERAGE")
    no_tna = link.filter(pl.col("tna_latest").is_null() | (pl.col("tna_latest") <= 0))
    nr = int(no_tna["n_vote_rows"].sum())
    print(f"vote rows with NO tna weight: {nr:,} ({100*nr/total_rows:.1f}%)")
    print("Publish this alongside ANY tna-weighted statistic — build_npx.sas "
          "emits n_no_tna per cell for the same reason.")
    # CRSP tna_latest is in $ MILLIONS. Because split_tna divides each unit's
    # TNA across the fundids sharing it, this total reconciles to the CRSP
    # total — it does not double-count. An unsplit version of this same line
    # read $64.43T against a true $32.38T.
    tna_t = float(link["tna_latest"].sum() or 0) / 1e6
    print(f"total tna at fundid grain (split): ${tna_t:,.2f}T")

    if not overlay_used:
        print("\nNOTE: no family overlay supplied. The fuzzy tiers run with "
              "derived family tokens only; a curated overlay typically recovers "
              "a small number of additional cross-family successions.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--npx-funds", required=True)
    ap.add_argument("--crsp-funds", required=True)
    ap.add_argument("--sec-series-master", default=None,
                    help="OPTIONAL, enables the via_sec_ticker tier")
    ap.add_argument("--sec-series-names-long", default=None,
                    help="OPTIONAL, enables the sec_name tier — the tier that "
                         "reaches pre-2023 funds, which ISS never gave an id")
    ap.add_argument("--family-overlay", default=None,
                    help="OPTIONAL curated family labels; ladder runs without it")
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-fuzzy", action="store_true",
                    help="exact tiers only (fast smoke test)")
    args = ap.parse_args()

    npx = pl.read_parquet(args.npx_funds)
    crsp = pl.read_parquet(args.crsp_funds)
    sec = pl.read_parquet(args.sec_series_master) if args.sec_series_master else None
    sec_long = (pl.read_parquet(args.sec_series_names_long)
                if args.sec_series_names_long else None)

    hdr("INPUTS")
    print(f"ISS fundids      : {npx.height:,}  "
          f"({int(npx['n_vote_rows'].sum()):,} vote rows)")
    print(f"CRSP fundnos     : {crsp.height:,}")
    print(f"SEC series master: {'-' if sec is None else f'{sec.height:,} rows'}")
    print(f"SEC names (long) : {'-' if sec_long is None else f'{sec_long.height:,} rows'}")
    overlay = load_overlay(args.family_overlay)

    units = build_fund_units(crsp)
    print(f"CRSP fund units  : {units.height:,} (classes collapsed on crsp_portno)")

    hdr("LADDER")
    resolved = tier_seriesid(npx, crsp, units)
    print(f"seriesid tiers   : {resolved.height:,} fundids")

    got = set(resolved["fundid"].to_list())
    t3 = tier_sec_ticker(npx.filter(~pl.col("fundid").is_in(list(got))), units, sec)
    print(f"via_sec_ticker   : {t3.height:,} fundids")
    resolved = pl.concat([resolved, t3], how="vertical")

    got = set(resolved["fundid"].to_list())
    t4 = tier_sec_name(npx.filter(~pl.col("fundid").is_in(list(got))),
                       series_to_unit(crsp, units), sec_long, overlay)
    print(f"sec_name         : {t4.height:,} fundids")
    resolved = pl.concat([resolved, t4], how="vertical")

    # Sibling scope for the fuzzy tiers is built from EXACT tiers only.
    exact = resolved.join(npx.select("fundid", "institutionname_modal"),
                          on="fundid", how="left")

    if args.no_fuzzy:
        print("--no-fuzzy: skipping crsp_name_* tiers")
        fz = pl.DataFrame(schema={"fundid": pl.Float64, "fund_unit": pl.Float64,
                                  "match_tier": pl.String})
    else:
        got = set(resolved["fundid"].to_list())
        rem = npx.filter(~pl.col("fundid").is_in(list(got)))
        print(f"fuzzy input      : {rem.height:,} unresolved fundids")
        fz = fuzzy_link(rem, units, exact, overlay)
        print(f"crsp_name tiers  : {fz.height:,} fundids")
    resolved = pl.concat([resolved, fz], how="vertical")

    # One row per fundid, best tier wins.
    rank = {t: i for i, t in enumerate(TIER_ORDER)}
    resolved = (resolved.with_columns(
                    pl.col("match_tier").replace_strict(rank, default=99).alias("_r"))
                # DETERMINISM: fund_unit makes the tie-break total when one
                # fundid resolves twice within the same tier.
                .sort(["fundid", "_r", "fund_unit"])
                .unique(subset=["fundid"], keep="first")
                .drop("_r"))

    link = (npx.join(resolved, on="fundid", how="left")
               .with_columns(pl.col("match_tier").fill_null("unlinked"))
               .join(units.select("fund_unit", "crsp_fundno", "crsp_portno",
                                  "index_fund_flag", "tna_unit",
                                  pl.col("fund_name").alias("crsp_fund_name"),
                                  pl.col("mgmt_name").alias("crsp_mgmt_name")),
                     on="fund_unit", how="left"))
    link = split_tna(link)
    link = assign_blocks(link)

    cols = ["fundid", "institutionid", "fundname_modal", "institutionname_modal",
            "fundcik", "seriesid", "n_seriesid_variants", "iss_nonregistrant",
            "first_vote_year", "last_vote_year", "n_vote_rows",
            "match_tier", "crsp_fundno", "crsp_portno", "crsp_fund_name",
            "crsp_mgmt_name", "index_fund_flag", "tna_latest",
            "n_fundids_sharing_unit", "block", "block_source"]
    link = link.select([c for c in cols if c in link.columns]).sort("fundid")

    out = Path(args.out)
    link.write_parquet(out, compression="zstd")
    coverage_report(link, bool(overlay))
    print(f"\nWrote {out} ({link.height:,} rows, {out.stat().st_size/1e3:.0f} KB)")
    print("Next: ../npx_link_to_csv.py --in "
          f"{out} --out npx_link.csv --key fundid --group block --weight tna_latest")


if __name__ == "__main__":
    main()
