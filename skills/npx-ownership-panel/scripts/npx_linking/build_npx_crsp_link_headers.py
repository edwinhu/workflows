#!/usr/bin/env python3
"""L3e — the header-vocabulary tier (UPDATES npx_crsp_link in place).

WHAT THIS ADDS THAT L2 CANNOT SEE

L2 matches ISS fund names against the SEC Series and Class Report, which begins
in 2010 and lists only THEN-ACTIVE registrants. A fund that liquidated or merged
before the first vintage is in no snapshot at all, so no amount of matcher tuning
reaches it -- the name it should match to is simply not in the corpus.

Series IDs were mandatory for 40-Act registrants from 2006-02-06, and every such
filing carries a `<SERIES-AND-CLASSES-CONTRACTS-DATA>` block in its SGML header.
Scanning 224,103 filings 2006-2009 recovers 16,603 series, of which 2,889 appear
in NO SEC vintage (2,754 of them open-end N-1A). Measured 2026-08-28, that
vocabulary contributes 6,780 names the SEC vintages do not carry, and the scan
was validated at 100.00% class->series agreement against the 2010 and 2011
vintages before being trusted here.

AND ONE RULE CHANGE, measured on the 8,641-fund negative control

L2 generates candidates INSIDE an institution scope. That is precise (85-93% in
the fuzzy bands) but reaches only 64.3%, because when the institution->CIK bridge
fails the true series is not merely unranked, it is absent from the pool. This
tier matches UNSCOPED and uses family agreement only to ADMIT A WEAK SCORE:

    >= 0.85                      accept
    >= 0.70 with family agreement accept
    otherwise                     decline
    winner must beat the best DIFFERENT series by >= 0.02

The margin comparison skips runner-ups sharing the winner's seriesId; without
that, a fund carrying two name variants in the vocabulary vetoes itself.

MEASURED CONTRIBUTION (2026-08-28, on the 229,787,146-row mutual-fund universe):
2,603 fundids accepted, of which 2,257 survive LLM adjudication (88.8% -- lower
than the 94.9% L2's tiers score, because this is the residue L2 gave up on).
1,698 of those reach a crsp_fundno, but only 1,333 GAIN one: the residue is
selected on `seriesid IS NULL`, and the chain's crsp_name_scoped / crsp_name_global
/ feeder_master_name / digit_split_name tiers link 1,279 fundids WITHOUT a
seriesId, so 365 were already linked. Net +3,750,580 vote rows, +1.63pp:
92.81% -> 94.44%.

That 365-fund overlap is why this runs as an in-place stage rather than emitting
a rival crosswalk. A standalone script that added its own total to the chain's
reported +2.10pp / 94.91% -- it had no way to see the double count. The
`eligible` mask here fills only a NULL crsp_fundno, and the preserved-links
assertion proves it.

The 559 links that never reach CRSP are the tier working correctly, not failing:
they are pre-2010 funds, genuinely SEC-registered, that CRSP's mutual-fund
database never carried.

JUDGING IS PART OF THE TIER, NOT A REVIEW STEP. Accepting all 2,604 would put
719,784 vote rows of known-wrong links into the crosswalk. Run judge_matches.py
over ACCEPTED_CSV and pass the kept set back via --kept before the in-place
update; without --kept this stage refuses to write.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import polars as pl
from sklearn.feature_extraction.text import TfidfVectorizer

from config_obs import (
    CRSP_CIK_MAP,
    FUND_SUMMARY2,
    L2_FAMILY_STOPWORDS,
    L3B_STRATEGY_STOPWORDS,
    MFLINK1,
    NPX_CRSP_LINK,
    PARQUET_COMPRESSION,
)

#: `matching.py`'s helpers take POLARS EXPRESSIONS; this tier scores plain
#: Python strings against a dict vocabulary, so it needs string equivalents.
#: The stoplists are imported rather than restated -- a second hardcoded copy
#: drifts from the one L2 and L3b actually use.
# The config stoplists are UPPERCASE and `norm_basic` lowercases, so these
# must be folded or every family check silently fails to match.
FAMILY_STOP = {w.lower() for w in L2_FAMILY_STOPWORDS} | {
    w.lower() for w in L3B_STRATEGY_STOPWORDS}

_WS = re.compile(r"\s+")
_NONAL = re.compile(r"[^a-z0-9 ]+")


def norm_basic(s: str) -> str:
    return _WS.sub(" ", _NONAL.sub(" ", (s or "").lower())).strip()

csv.field_size_limit(10_000_000)

#: (P) The accept rule. A bare 0.70 band measures 68.9% correct on the negative
#: control and ~47% on the real untagged population -- the control is
#: systematically easier (modern, well-formed, 69% exact) and flatters it. So a
#: weak score is admitted only with a second signal.
STRONG = 0.85
WEAK = 0.70
MARGIN = 0.02
TOPK = 5

CODE_PREFIX = re.compile(
    r"^\s*(?=[0-9A-Za-z]{3,6}\s)(?=[^\s]*[0-9])[0-9A-Za-z]{3,6}\s+(?=\S)")
SUBADV_TAIL = re.compile(r"\s[-–]\s*(?:sub[- ]?advis\w*|advis\w*)\b.*$",
                         re.IGNORECASE)
SLEEVE_TAIL = re.compile(r"\s+(?:equity\s+)?sleeve\b.*$", re.IGNORECASE)
FORMERLY = re.compile(r"\(\s*(?:formerly|f/?k/?a|formerly known as)\b[^)]*\)",
                      re.IGNORECASE)
FORMERLY_INNER = re.compile(
    r"\(\s*(?:formerly(?:\s+known\s+as)?|f/?k/?a)\s*:?\s*([^)]+)\)", re.IGNORECASE)


def family(s: str) -> frozenset[str]:
    return frozenset(t for t in norm_basic(s).split()
                     if t not in FAMILY_STOP and len(t) > 2)


def variants(name: str) -> list[str]:
    """Every spelling of one ISS name worth scoring. A fund whose ISS name
    carries an internal code, a sub-adviser tail or a `(formerly X)` clause is
    invisible to a matcher that only ever sees the raw string."""
    out = [norm_basic(name)]
    s = name or ""
    t = CODE_PREFIX.sub("", s)
    if t != s:
        out.append(norm_basic(t))
    m = FORMERLY_INNER.search(s)
    if m:
        out.append(norm_basic(FORMERLY.sub("", s)))
        out.append(norm_basic(m.group(1)))
    for rx in (SUBADV_TAIL, SLEEVE_TAIL):
        t = rx.sub("", s)
        if t != s:
            out.append(norm_basic(t))
    out.append(norm_basic(re.sub(
        r"\b(cl|class)\s+[a-z0-9]{1,3}\b|\binc\b|\bltd\b", " ", s,
        flags=re.IGNORECASE)))
    return [v for v in dict.fromkeys(out) if v]


def load_vocabulary(sec_tsv: Path, header_tsvs: list[Path]):
    """SEC vintages plus the 40-Act header scan, as name -> {seriesId}.

    Read with polars, not `csv.DictReader`. The header scan is 6.9M rows across
    ~1.2GB of TSV and is the only slow step in this tier -- the matching itself
    is sklearn/C++ and the per-string normalisation is ~108K strings, both
    unaffected by how the vocabulary was parsed.
    """
    vocab: dict[str, set[str]] = defaultdict(set)
    fam: dict[str, set[str]] = defaultdict(set)

    def ingest(sids, nms):
        for sid, nm in zip(sids, nms):
            if not sid or not nm:
                continue
            n = norm_basic(nm)
            if n:
                vocab[n].add(sid)
                fam[n].update(family(nm))

    # quote_char=None disables quote processing. These TSVs never quote a
    # field, and SEC fund names contain bare double quotes -- there is a series
    # called `"Dogs" of Wall Street Portfolio` -- which CSV quoting rules read
    # as an unterminated field and refuse.
    sec = pl.read_csv(sec_tsv, separator="\t", has_header=False, quote_char=None,
                      new_columns=["cik", "series_id", "series_name"],
                      truncate_ragged_lines=True, ignore_errors=True)
    ingest(sec["series_id"].to_list(), sec["series_name"].to_list())
    n_sec = len(vocab)

    for src in header_tsvs:
        # Only two columns are needed out of ten; projecting them is most of
        # the win on a 792MB file.
        h = pl.read_csv(src, separator="\t", quote_char=None,
                        columns=["series_id", "series_name"],
                        truncate_ragged_lines=True, ignore_errors=True)
        ingest(h["series_id"].to_list(), h["series_name"].to_list())

    print(f"SEC vintages          : {n_sec:,} distinct names")
    print(f"40-Act header scan    : +{len(vocab) - n_sec:,} names no vintage carries")
    print(f"combined vocabulary   : {len(vocab):,} distinct names")
    return vocab, fam


def match_residue(residue: pl.DataFrame, vocab, fam) -> list[dict]:
    """Score every residue fundid against the whole vocabulary, unscoped."""
    keys = list(vocab)
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 3), min_df=1)
    VT = vec.fit_transform(keys).T.tocsr()

    rows = residue.to_dicts()
    qs, owner = [], []
    for i, r in enumerate(rows):
        for v in variants(r["fundname_modal"]):
            qs.append(v)
            owner.append(i)
    Q = vec.transform(qs)
    owner = np.array(owner)
    print(f"scoring {Q.shape[0]:,} name variants for {len(rows):,} fundids")

    # sparse_dot_topn renamed its entry point; support both so this runs on
    # whichever build the environment pinned.
    try:
        from sparse_dot_topn import sp_matmul_topn

        def topn(a):
            return sp_matmul_topn(a, VT, top_n=TOPK, threshold=0.0, sort=True)
    except ImportError:
        from sparse_dot_topn import awesome_cossim_topn

        def topn(a):
            return awesome_cossim_topn(a, VT, TOPK, 0.0)

    best = [(0.0, -1, 0.0)] * len(rows)
    for i in range(0, Q.shape[0], 4000):
        blk = Q[i:i + 4000].tocsr()
        sim = topn(blk).tocsr()
        for j in range(blk.shape[0]):
            lo, hi = sim.indptr[j], sim.indptr[j + 1]
            if lo == hi:
                continue
            d, idx = sim.data[lo:hi], sim.indices[lo:hi]
            o = int(owner[i + j])
            if float(d[0]) <= best[o][0]:
                continue
            win = vocab[keys[idx[0]]]
            runner = 0.0
            for dd, ii in zip(d[1:], idx[1:]):
                if not (vocab[keys[ii]] & win):   # a DIFFERENT series
                    runner = float(dd)
                    break
            best[o] = (float(d[0]), int(idx[0]), runner)

    accepted, n_weak, n_margin, n_ambig = [], 0, 0, 0
    for i, r in enumerate(rows):
        sc, ki, runner = best[i]
        if ki < 0:
            continue
        key = keys[ki]
        sids = sorted(vocab[key])
        if len(sids) != 1:
            n_ambig += 1
            continue
        agree = bool(family(r["institutionname_modal"] or "") & fam[key])
        if sc >= STRONG:
            tier = "header_name"
        elif sc >= WEAK and agree:
            tier = "header_name_confirmed"
            n_weak += 1
        else:
            continue
        if sc - runner < MARGIN:
            n_margin += 1
            continue
        accepted.append({
            "fundid": str(r["fundid"]),
            "iss_fundname": r["fundname_modal"],
            "iss_institution": r["institutionname_modal"] or "",
            "sec_name": key,
            "series_ids": sids[0],
            "score": f"{sc:.4f}",
            "vote_rows": str(r["n_vote_rows"]),
            "match_tier": tier,
        })
    print(f"accepted {len(accepted):,}  (weak+family {n_weak:,}; "
          f"declined: margin {n_margin:,}, ambiguous name {n_ambig:,})")
    return accepted


def update_in_place(kept_csv: Path) -> None:
    """Fold the judged-correct links into npx_crsp_link.parquet.

    Same contract as L3b/L3c/L3d: same rows, same columns, no pre-existing link
    altered, no non-registrant gains a link. Asserted, not asserted-to.
    """
    base = pl.read_parquet(NPX_CRSP_LINK)
    BASE_COLS, N = base.columns, base.height

    kept = pl.read_csv(kept_csv).with_columns(
        fundid=pl.col("fundid").cast(pl.Float64),
        series_ids=pl.col("series_ids").cast(pl.Utf8),
    )
    cikmap = pl.read_parquet(CRSP_CIK_MAP)
    sid2fno = (cikmap.filter(pl.col("series_cik").is_not_null()
                             & pl.col("crsp_fundno").is_not_null())
               .select(series_ids=pl.col("series_cik").cast(pl.Utf8),
                       new_fundno=pl.col("crsp_fundno"))
               .unique(subset=["series_ids"]))
    fs = (pl.read_parquet(FUND_SUMMARY2)
          .select(new_fundno="crsp_fundno", new_flag="index_fund_flag",
                  new_tna="tna_latest")
          .unique(subset=["new_fundno"]))
    # A fundno filled here must carry its wficn too -- wficn is how S12 holdings
    # reach a fund, so a link without one is invisible downstream. Same declared
    # tie-break as the main builder: 341 fundnos map to >1 wficn, and sorting
    # before `unique` states the pick (lowest wficn) instead of inheriting row order.
    mf = (pl.read_parquet(MFLINK1)
          .sort(["crsp_fundno", "wficn"])
          .unique(subset=["crsp_fundno"], keep="first", maintain_order=True)
          .select(new_fundno="crsp_fundno", new_wficn="wficn"))
    add = (kept.join(sid2fno, on="series_ids", how="inner")
               .join(fs, on="new_fundno", how="left")
               .join(mf, on="new_fundno", how="left")
               .unique(subset=["fundid"])
               .select("fundid", "series_ids", "new_fundno", "new_flag",
                       "new_tna", "new_wficn", new_tier=pl.col("match_tier")))
    print(f"judged-correct links      : {kept.height:,}")
    print(f"of which reach a CRSP fund: {add.height:,}")

    out = base.join(add, on="fundid", how="left").with_columns(
        # only ever fills a NULL -- an existing link is never overwritten
        eligible=pl.col("crsp_fundno").is_null()
        & pl.col("new_fundno").is_not_null()
        & ~pl.col("iss_nonregistrant"),
    )
    out = out.with_columns(
        seriesid=pl.when(pl.col("eligible") & pl.col("seriesid").is_null())
        .then(pl.col("series_ids")).otherwise(pl.col("seriesid")),
        crsp_fundno=pl.when(pl.col("eligible")).then(pl.col("new_fundno"))
        .otherwise(pl.col("crsp_fundno")),
        crsp_match_tier=pl.when(pl.col("eligible")).then(pl.col("new_tier"))
        .otherwise(pl.col("crsp_match_tier")),
        index_fund_flag=pl.when(pl.col("eligible")
                                & pl.col("index_fund_flag").is_null())
        .then(pl.col("new_flag")).otherwise(pl.col("index_fund_flag")),
        tna_latest=pl.when(pl.col("eligible") & pl.col("tna_latest").is_null())
        .then(pl.col("new_tna")).otherwise(pl.col("tna_latest")),
        # coalesce, never assign: a stored wficn from a sibling class of the same
        # seriesid unit is the modal working as designed and must survive.
        wficn=pl.coalesce(
            pl.col("wficn"),
            pl.when(pl.col("eligible")).then(pl.col("new_wficn")),
        ),
    )
    n_new = int(out["eligible"].sum())
    n_wficn = int(out.filter(pl.col("eligible") & pl.col("wficn").is_not_null()
                             & pl.col("new_wficn").is_not_null()).height)
    print(f"wficn filled on new links : {n_wficn:,}")
    gained = int(out.filter(pl.col("eligible"))["n_vote_rows"].sum())
    out = out.select(BASE_COLS).sort("fundid")

    assert out.height == N, f"row count changed: {out.height} != {N}"
    assert out["fundid"].n_unique() == out.height, "fundid not unique"
    assert out.columns == BASE_COLS, "column set or order changed"
    assert out.filter(pl.col("iss_nonregistrant"))["crsp_fundno"].null_count() == \
        out.filter(pl.col("iss_nonregistrant")).height, \
        "a non-registrant gained a link"
    chk = (base.filter(pl.col("crsp_fundno").is_not_null())
           .select("fundid", "crsp_fundno", "crsp_match_tier")
           .join(out.select("fundid", n_fno="crsp_fundno", n_tier="crsp_match_tier"),
                 on="fundid", how="inner"))
    assert chk.filter((pl.col("crsp_fundno") != pl.col("n_fno"))
                      | (pl.col("crsp_match_tier") != pl.col("n_tier"))).height == 0, \
        "an existing link was modified"
    print(f"pre-existing links preserved: {chk.height:,} / {chk.height:,}")

    MF = int(out.filter(~pl.col("iss_nonregistrant"))["n_vote_rows"].sum())
    before = int(base.filter(~pl.col("iss_nonregistrant")
                             & pl.col("crsp_fundno").is_not_null())["n_vote_rows"].sum())
    after = int(out.filter(~pl.col("iss_nonregistrant")
                           & pl.col("crsp_fundno").is_not_null())["n_vote_rows"].sum())
    print(f"\nCRSP reach on the mutual-fund universe ({MF:,} vote rows):")
    print(f"  before L3e : {before:,}  ({before / MF:.2%})")
    print(f"  after  L3e : {after:,}  ({after / MF:.2%})   "
          f"+{n_new:,} fundids, +{gained:,} rows (+{gained / MF:.2%})")

    out.write_parquet(NPX_CRSP_LINK, compression=PARQUET_COMPRESSION)
    print(f"wrote {NPX_CRSP_LINK} — {out.height:,} rows x {out.width} cols")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sec-names", type=Path, required=False,
                    help="TSV: cik, series_id, series_name (SEC vintages)")
    ap.add_argument("--header-names", type=Path, nargs="*", default=[],
                    help="TSVs from scan_headers -emit series")
    ap.add_argument("--accepted-csv", type=Path,
                    help="where to write accepted pairs for adjudication")
    ap.add_argument("--kept", type=Path,
                    help="judged-correct pairs; performs the in-place update")
    args = ap.parse_args()

    if args.kept:
        update_in_place(args.kept)
        return

    if not (args.sec_names and args.accepted_csv):
        sys.exit("need --sec-names and --accepted-csv to propose, "
                 "or --kept to apply")

    base = pl.read_parquet(NPX_CRSP_LINK)
    MF = int(base.filter(~pl.col("iss_nonregistrant"))["n_vote_rows"].sum())
    residue = base.filter(~pl.col("iss_nonregistrant")
                          & pl.col("seriesid").is_null()
                          & pl.col("fundname_modal").is_not_null())
    print(f"mutual-fund universe : {MF:,} vote rows")
    print(f"registrant residue   : {residue.height:,} fundids, "
          f"{int(residue['n_vote_rows'].sum()):,} rows "
          f"({residue['n_vote_rows'].sum() / MF:.2%})\n")

    vocab, fam = load_vocabulary(args.sec_names, list(args.header_names))
    accepted = match_residue(residue, vocab, fam)
    if not accepted:
        print("nothing accepted")
        return
    with args.accepted_csv.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(accepted[0].keys()))
        w.writeheader()
        w.writerows(accepted)
    vr = sum(int(a["vote_rows"]) for a in accepted)
    print(f"\nwrote {args.accepted_csv}: {len(accepted):,} pairs, {vr:,} rows "
          f"({vr / MF:.2%})")
    print("ADJUDICATE THESE, then re-run with --kept. 11.1% of them are wrong.")


if __name__ == "__main__":
    main()
