"""NPX <-> CRSP fund linking — a reusable, importable pipeline.

Resolves every ISS N-PX `fundid` to a SEC `seriesId` and then to a CRSP
`crsp_fundno`, carrying `index_fund_flag` (the index/passive block split) and
`tna_latest` (the pre-2024 vote weight). Panel 2005-2025, 26,686 ISS funds,
144.3M vote rows. Reference doc — read this before reusing any of it:

    docs/investigations/2026-07-24_npx-crsp-linking.md

The chain, in dependency order
------------------------------
==========================  ====================================================
`sec_series_master`   (L2a) SEC Series/Class annual CSVs 2010-2025 -> 3 parquets
`fundid_seriesid`     (L2)  ISS fundid -> SEC seriesId, six-tier ladder
`npx_crsp_link`       (L3)  seriesId -> crsp_fundno + flag + TNA + block
`npx_crsp_link_gap`   (L3b) the feeder_master_name tier, updates L3 in place
`npx_crsp_link_gap2`  (L3c) the digit_split_name tier, updates L3 in place
`npx_crsp_link_ticker`(L3d) the via_sec_ticker tier, updates L3 in place
==========================  ====================================================

Headline: **91.8% of vote rows resolve to a seriesId, 90.47% to a crsp_fundno**
(89.40% at L3, 89.97% after L3b, 90.20% after L3c, 90.47% after L3d).
The gap between the two is a population boundary, not a matcher failure — a
large part of the N-PX filer universe (master portfolios, insurance separate
accounts, variable insurance trusts) is SEC-registered but is not in CRSP's
mutual-fund database at all.

Usage
-----
    python -m scripts.linking run              # rebuild everything
    python -m scripts.linking run --from npx_crsp_link
    python -m scripts.linking coverage         # data/output/l4_coverage*.csv
    python -m scripts.linking verify           # sandboxed rebuild + diff
    python -m scripts.linking parity           # matching.py == the builders
    python -m scripts.linking stages           # what runs, in what order

    from scripts.linking import run_all, load_link, build_coverage
    run_all()
    link = load_link()          # data/processed/npx_crsp_link.parquet

Three gotchas that silently corrupt results downstream
------------------------------------------------------
* `n_vote_rows` is **uint32** — cast to Float64 before ANY aggregation and
  assert the group sums reconcile. A naive sum once reported the index block at
  6.3% when the truth is 36.1%.
* `fundid` is **Float64** in every ISS table — join on that dtype, never on an
  int cast.
* `fundid` -> `crsp_fundno` is **many-to-one** (20,738 -> 12,710), so summing
  `tna_latest` over `fundid` double-counts ($63.51T against the correct
  $32.20T). Any TNA aggregate must be over distinct `crsp_fundno`.
"""
import polars as pl

from ._config import PROJ, cfg
from .coverage import (COVERAGE_BY_TIER, COVERAGE_BY_YEAR, COVERAGE_LONG,
                       build_coverage)
from .matching import parity_report
from .pipeline import (STAGES, Stage, fingerprint, fingerprints, run_all,
                       run_stage, stage, verify)

__all__ = [
    "PROJ", "cfg",
    "STAGES", "Stage", "stage", "run_stage", "run_all",
    "fingerprint", "fingerprints", "verify",
    "build_coverage", "COVERAGE_LONG", "COVERAGE_BY_YEAR", "COVERAGE_BY_TIER",
    "parity_report",
    "load_link", "load_fundid_seriesid", "load_sec_series_master",
]


def load_link(columns=None):
    """`data/processed/npx_crsp_link.parquet` — one row per ISS `fundid`.

    Columns: `fundid, seriesid, crsp_fundno, wficn, index_fund_flag,
    tna_latest, block, block_source, in_institutional, match_tier,
    crsp_match_tier, crsp_match_score, iss_nonregistrant, n_vote_rows,
    n_crsp_classes, fundname_modal, institutionname_modal`.
    """
    return pl.read_parquet(cfg.NPX_CRSP_LINK, columns=columns)


def load_fundid_seriesid(columns=None):
    """`data/processed/fundid_seriesid.parquet` — the L2 seriesId resolution."""
    return pl.read_parquet(cfg.FUNDID_SERIESID, columns=columns)


def load_sec_series_master(grain="series", columns=None):
    """The consolidated SEC Series/Class master. `grain` in {series, class, names}."""
    path = {"series": cfg.SEC_SERIES_MASTER_SERIES,
            "class": cfg.SEC_SERIES_MASTER,
            "names": cfg.SEC_SERIES_NAMES_LONG}[grain]
    return pl.read_parquet(path, columns=columns)
