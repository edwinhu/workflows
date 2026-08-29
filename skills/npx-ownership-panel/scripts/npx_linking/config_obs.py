"""Central parameter config for the observed-vote mirror counterfactual layer.

Companion to `scripts/cit/config.py` (CIT roster analysis). Every filter,
threshold and mapping used by the observed-vote / NPX-CRSP-linking tasks lives
here; no task script may carry an inline literal.

Rationale for each constant is inline, keyed to `.planning/PLAN.md`
("Filters & Parameters") and `.planning/SPEC.md`.
"""
from pathlib import Path

# VENDORED COPY. Upstream is mirror scripts/cit/config_obs.py; sync it together
# with the npx_linking package, never separately.
# Root is overridable so the linking chain can run outside mirror's tree. In
# mirror this resolves to parents[2] exactly as before, so behaviour there is
# unchanged; NPX_LINK_ROOT only takes effect when it is set.
import os as _os
PROJ = Path(_os.environ["NPX_LINK_ROOT"]).resolve() if _os.environ.get(
    "NPX_LINK_ROOT") else Path(__file__).resolve().parents[2]
PROC = PROJ / "data" / "processed"
OUT = PROJ / "data" / "output"

# --- sample window ---------------------------------------------------------
# (P) Span of the cached N-PX pull (risk.voteanalysis_npx).
SAMPLE_START = 2005
SAMPLE_END = 2025

# ---------------------------------------------------------------------------
# T1 — clean N-PX (DATA-04)
# ---------------------------------------------------------------------------

NPX_RAW = PROC / "npx.parquet"
CLEAN_NPX = PROC / "clean_npx.parquet"

# (P) Declared PK of the N-PX fund-vote table: one fund's vote on one item.
NPX_KEY = ["fundid", "itemonagendaid"]

# (P) The columns that DEFINE a distinct N-PX vote record. T1's exact-duplicate
# step and its RESTATE_RULE tie-breaks key on exactly these, never on "whatever
# columns npx.parquet happens to carry".
#
# Why pinned: T1 used to dedup on the full raw schema (`df.unique()` +
# `.sort(src_cols)`), so ADDING A COLUMN TO THE PULL SILENTLY CHANGES THE
# CLEANED PANEL. Two rows that were exact duplicates stop being duplicates the
# moment they differ in a new identity column, and the sort tie-break order
# shifts underneath the restatement rule. Folding the SEC identity columns
# (`seriesid`, `fundcik`, ...) into `pull_npx_v2.py` -- the consolidation this
# list exists to make safe -- would otherwise resurrect the 31,264
# (fundid, itemonagendaid) keys whose duplicate rows differ ONLY in `seriesid`,
# turning collapsed duplicates back into two "votes" for one fund on one item.
#
# That is a double-count, not two real votes: on the sampled conflict keys both
# rows report an IDENTICAL `totalsharesvoted`. ISS conflates a handful of fund
# identities under one `fundid` (16 fundids panel-wide; 13 are clean fund
# reorganisations/platform migrations, 2 are single-year blips, 1 -- JHVIT
# fundid 6008319 -- is a genuine ISS conflation of two permanently-distinct
# series and alone contributes 19,185 of the 31,264 conflict keys). ALL 16
# classify `block=='active'` in `npx_crsp_link.parquet`; NONE is `block=='index'`,
# so no index-block statistic can move however their identity is resolved.
# Identity resolution belongs in `fundid_seriesid.parquet` (one row per fundid),
# NOT in the 143.8M-row vote panel. See LEARNINGS "fundid identity collisions".
#
# Columns present in `npx.parquet` but absent here are carried through
# untouched and deliberately ignored by the dedup; T1 prints them so a new
# column can never be added silently.
NPX_DEDUP_COLS = [
    "fundid", "institutionid", "fundvote", "mgtrec", "itemonagendaid",
    "issagendaitemid", "meetingid", "meetingdate", "cusip", "sponsor",
    "voteresult", "agenda_mgmtrec", "sharesvoted", "institutionname", "fundname",
]

# (P) N-PX is partitioned on the meeting year for processing so peak memory is
# ~1 year (<=9.8M rows) rather than the full 144.3M. 88 itemonagendaids straddle
# a year boundary across restated filings (768 rows, always adjacent years), so
# the partition is keyed on each ITEM's earliest meeting year, not the row's --
# otherwise a duplicate key could be split across two partitions and survive.
NPX_PARTITION_COL = "meetingdate"

# (P) ISS ships `agenda_mgmtrec` as an exact copy of `mgtrec` (verified: 0
# mismatching rows out of 144.3M). Dropped as redundant; the guard below
# re-verifies at runtime and keeps both columns if it ever stops holding.
NPX_REDUNDANT_COLS = ["agenda_mgmtrec"]

# (C) Amended N-PX filings restate votes, but the ISS extract carries NO
# filing-date or amendment-number column, so a conflicting (fundid,
# itemonagendaid) pair cannot be resolved by recency. Precedence:
#   "max_shares" -- keep the row(s) with the largest `sharesvoted` (a restated
#                   filing reports the fund's full position; also the only
#                   quantitative signal available, 2024+ only);
#   "modal_vote" -- else keep the `fundvote` held by the most rows;
#   "drop"       -- else drop the key entirely and count it.
# Immaterial either way: the ambiguous tail is ~0.1% of duplicate keys.
RESTATE_RULE = ("max_shares", "modal_vote", "drop")

# (P) Direction normalisation. "Withhold" is the director-election analogue of
# "Against" (a plurality ballot offers For/Withhold instead of For/Against), so
# the two collapse. Everything else -- frequency ballots (One/Two/Three Years),
# non-votes, splits and unknowns -- is not a usable direction and goes to
# "Other"; the original `fundvote` is retained alongside.
VOTE_DIR_MAP = {
    "For": "For",
    "Against": "Against",
    "Withhold": "Against",
    "Abstain": "Abstain",
}
VOTE_DIR_OTHER = "Other"
# (P) Directions that carry a For/Against signal for the flip engine.
VOTE_DIR_USABLE = ["For", "Against"]

# (P) Deterministic output ordering. The file is written in itemonagendaid,
# fundid order in `NPX_SORT_BUCKETS` bounded-memory passes over the partitions.
NPX_SORT_KEY = ["itemonagendaid", "fundid"]
NPX_SORT_BUCKETS = 16

PARQUET_COMPRESSION = "zstd"

# ---------------------------------------------------------------------------
# L2 -- fundid -> SEC seriesId resolution (LINK-02)
# ---------------------------------------------------------------------------
# Both ISS `fundid` and SEC `seriesId` are time-invariant fund identities, so
# this is a per-fund resolution applied across all years, NOT a per-year match.

NPX_SERIESID = PROC / "npx_seriesid.parquet"
SEC_SERIES_NAMES_LONG = PROC / "sec_series_names_long.parquet"
SEC_SERIES_MASTER = PROC / "sec_series_master.parquet"
SEC_SERIES_MASTER_SERIES = PROC / "sec_series_master_series.parquet"
FUNDID_SERIESID = PROC / "fundid_seriesid.parquet"

# (P) ISS began populating `seriesid`/`fundcik` in the 2023 filing season; the
# columns are 100% null before it. A fundid observed with a seriesid in this
# era is resolved for ALL its years (fundid is time-invariant).
L2_ISS_SERIESID_ERA = 2023

# (P) Precision-descending tier order. `iss_seriesid` and `propagated` are the
# same exact-ID resolution; the label records whether the fundid's votes are
# confined to the 2023+ evidence era (`iss_seriesid`) or extend back before it
# (`propagated`, i.e. the 2023+ id is carried back over the stable fundid).
L2_MATCH_TIERS = (
    "iss_seriesid",      # exact: ISS-reported seriesid, fundid only votes 2023+
    "propagated",        # exact: same id carried back to the fundid's pre-2023 votes
    "cik_scoped_name",   # fuzzy, scoped to the fundid's own ISS `fundcik`
    "inst_scoped_name",  # fuzzy, scoped to the CIKs of the institution's resolved siblings
    "global_name",       # fuzzy, unscoped -- adjudicated, never accepted on score alone
    "unresolved",
)

# (P) ING char-ngram TF-IDF recipe, as used by `scripts/cit/t6_tfidf_candidates.py`.
L2_TFIDF_ANALYZER = "char_wb"
L2_TFIDF_NGRAM = (2, 4)
L2_TFIDF_NGRAM_ALT = (3, 3)          # sensitivity check
# (P) Candidate generation is deliberately wide: one global top-k matmul feeds
# every fuzzy tier, and each tier then filters by its own scope + threshold.
L2_TFIDF_TOP_K = 100
L2_CAND_THRESHOLD = 0.30

# (C) Tier thresholds. Scoped regimes compare like-to-like full fund names
# against a few dozen candidates, so they can hold a strict bar; the CIK-scoped
# regime is the strictest because the CIK is an exact ISS-reported identifier.
L2_CIK_SCOPED_THRESH = 0.90
L2_INST_SCOPED_THRESH = 0.80
# (C) The unscoped regime never auto-accepts on score alone: a global match must
# clear the score bar AND carry a second, independent signal -- either the ISS
# institution's family token appears in the SEC entity/series name, or the score
# is high enough to be a normalised-name identity. It must also be unambiguous
# (top-1 beats top-2 by the margin) to survive the many-to-one name hazard.
L2_GLOBAL_THRESH = 0.85
L2_GLOBAL_EXACTISH = 0.97
L2_GLOBAL_MARGIN = 0.02

# (P) Legal-form suffixes carry no discriminating information and differ
# systematically between the ISS and SEC name conventions.
L2_LEGAL_SUFFIX_RE = (
    r"\b(INC|INCORPORATED|LLC|L L C|LP|L P|PLC|CORP|CORPORATION|"
    r"LTD|LIMITED|N V|NV|S A|CO|COMPANY|THE)\b"
)
# (P) SEC vintages sometimes embed the rename history in the name itself
# ("PF Small-Cap Growth Fund (formerly named PF Developing Growth Fund)").
# Both the pre- and post-rename forms are emitted as separate corpus entries.
L2_FORMERLY_RE = r"\((FORMERLY|FORMALLY|F/K/A|FKA|PREVIOUSLY|NEE)[^)]*\)"

# --- two ISS-side noise patterns, measured 2026-08-28 -----------------------
# OPT-IN: `normalize_name` applies neither by default. Every variant there
# reproduces a shipped builder verbatim and the chain asserts byte-identity
# fingerprints over their outputs (npx_crsp_link 4fdf9818...), so enabling
# either changes the corpus and invalidates the frozen hash. Turn them on in a
# stage of their own and re-freeze deliberately.
#
# NO LOOK-AROUND IN EITHER PATTERN. polars `str.replace_all` runs the Rust
# `regex` crate, which does not support (?=...). A lookahead version compiles
# and then silently never matches -- it cost a full test cycle to notice.

# ISS prefixes an internal id on some families: "3364 JHVIT International Small
# Company Trust", "6721 500 Index B", "2Y61 JHF Hedged Equity & Income Fund",
# "ZW4X GEI Total Return Blackrock", "2DCN JHF II Emerging Makets Fund" (the
# typo is ISS's own). The code never appears in the SEC name and on char
# n-grams it drags the vector toward the wrong fund.
#
# A PURE-DIGIT code needs 4+ digits so "3364 JHVIT" strips while "500 Index
# Fund" keeps its 500. A MIXED code needs a digit and a letter, spelled out as
# alternatives because the requirement cannot be asserted without lookahead.
L2_CODE_PREFIX_RE = (
    r"^\s*(?:"
    r"[0-9]{4,6}"
    r"|[0-9]{1,4}[A-Za-z]{1,4}[0-9A-Za-z]{0,3}"
    r"|[A-Za-z]{1,4}[0-9]{1,4}[0-9A-Za-z]{0,3}"
    r")\s+"
)

# The sub-adviser appended after a dash, which the SEC series name never
# carries. Worth +0.28 points of coverage on its own, the largest single
# normalisation rule measured.
#
# Two shapes, because the manager is often named WITHOUT the word "adviser":
#   " - SUB-ADVISER: JENNISON"         the label is present
#   " - Segall Bryant and Hamill LLC"  only a corporate suffix marks it
# The second alternative REQUIRES that suffix, so a real name like
# "Templeton Growth Fund - Series II" is not truncated.
L2_SUBADVISER_TAIL_RE = (
    r"\s[-\u2013]\s*(?:"
    r"(?:SUB[- ]?)?ADVIS\w*\b.*"
    r"|[A-Za-z][\w&.,' ]*\b(?:LLC|L\.L\.C|INC|LP|L\.P|LTD|MANAGEMENT|MANAGERS"
    r"|CAPITAL|ASSOCIATES|PARTNERS|ADVISORS|ADVISERS)\b\.?"
    r")\s*$"
)
L2_PAREN_RE = r"\(([^)]*)\)"

# (P) A share-class label ("Class A", "Institutional Shares") identifies a share
# class, not a fund, and would match indiscriminately. Only class names that
# look like a full fund name are admitted to the corpus.
L2_CLASSNAME_MIN_CHARS = 15
L2_CLASSNAME_MIN_TOKENS = 3
L2_GENERIC_CLASS_RE = (
    r"^(CLASS|INSTITUTIONAL|INVESTOR|ADVISOR|ADVISER|SERVICE|RETAIL|SELECT|"
    r"ADMIRAL|INITIAL|PREMIER|PRIMARY|RESERVE|DAILY|SHARES|R\d|[A-Z])\b"
)

# (P) Words that describe the *business* of an asset manager rather than name
# it; stripped when reducing an ISS `institutionname` to a family token for the
# global tier's independent-signal check.
L2_FAMILY_STOPWORDS = (
    "ASSET", "ASSETS", "MANAGEMENT", "MANAGEMENT'S", "MANAGERS", "MANAGER",
    "INVESTMENT", "INVESTMENTS", "INVESTOR", "INVESTORS", "ADVISORS",
    "ADVISERS", "ADVISOR", "ADVISER", "FUND", "FUNDS", "GROUP", "CAPITAL",
    "TRUST", "TRUSTS", "HOLDINGS", "PARTNERS", "GLOBAL", "INTERNATIONAL",
    "SERVICES", "FINANCIAL", "AND", "OF", "US", "USA", "NA", "AMERICA",
)

# (P) ISS marks non-registrant voters (public pension plans, non-US managers
# whose records ISS collects outside N-PX) with a trailing asterisk on
# `institutionname`. These have no SEC seriesId by construction and are
# reported separately rather than counted as link failures.
L2_NONREGISTRANT_RE = r"\*+\s*$"

L2_ADJUDICATION_CANDIDATES = OUT / "l2_adjudication_candidates.csv"
L2_ADJUDICATION_TIES = OUT / "l2_adjudication_ties.csv"
L2_ADJUDICATION_MULTISID = OUT / "l2_adjudication_multi_seriesid.csv"
L2_ADJUDICATION_UNRESOLVED = OUT / "l2_adjudication_unresolved.csv"

# ---------------------------------------------------------------------------
# L3 -- fundid -> crsp_fundno / block master (LINK-03, DATA-01)
# ---------------------------------------------------------------------------
# What the analysis actually needs per ISS fund is `crsp_fundno`, because that
# is what carries `index_fund_flag` (the index/passive block split) and
# `tna_latest` (the pre-2024 vote weight). The SEC `seriesId` resolved by L2 is
# a BRIDGE to it, not the goal -- so where L2 resolved a seriesId we join
# through it, and where it did not we match the ISS `fundname` straight against
# CRSP `fund_summary2.fund_name`. That second path is what closes the early
# panel: CRSP retains defunct funds, whereas the SEC Series/Class masters start
# in 2010 and list only then-active registrants.

CRSP_CIK_MAP = PROC / "crsp_cik_map.parquet"
FUND_SUMMARY2 = PROC / "fund_summary2.parquet"
MFLINK1 = PROC / "mflink1_cache.parquet"
NPX_CRSP_LINK = PROC / "npx_crsp_link.parquet"

# (P) Precision-descending order of the tiers that reach a `crsp_fundno`.
L3_MATCH_TIERS = (
    "via_seriesid",       # exact: L2 seriesId -> crsp_cik_map.series_cik
    "via_ticker",         # exact: L2 seriesId -> SEC class ticker -> CRSP ticker
    "via_l2_crsp_name",   # L2 round 2's own CRSP name tier, consumed not re-derived
    "crsp_name_scoped",   # fuzzy, scoped to the mgmt companies of linked siblings
    "crsp_name_global",   # fuzzy, unscoped -- adjudicated, never on score alone
    "unlinked",
)

# (P) `fund_summary2` is CLASS-grained (one row per `crsp_fundno` = one share
# class). The analysis unit is the FUND, so classes are collapsed on
# `crsp_portno` (CRSP's portfolio identifier, shared by a fund's classes;
# 88.7% populated among named funds) and, where that is null, on the class's
# own fundno as a singleton unit.
L3_FUND_UNIT_KEY = "crsp_portno"

# (P) CRSP `fund_name` is "<Trust>: <Fund>; <Class> Shares". The class suffix
# identifies a share class, not a fund, and must be stripped before matching;
# both the trust-qualified form and the bare fund name enter the corpus.
L3_CLASS_SUFFIX_RE = r";[^;]*$"

# (P) TF-IDF recipe and thresholds mirror L2 exactly -- same ING char-ngram
# recipe, same accept discipline. Only the right-hand corpus changes (CRSP
# fund names instead of SEC series names).
L3_TFIDF_TOP_K = 100
L3_CAND_THRESHOLD = 0.30
L3_SCOPED_THRESH = 0.80
L3_GLOBAL_THRESH = 0.85
L3_GLOBAL_EXACTISH = 0.97
L3_GLOBAL_MARGIN = 0.02
L3_SCOPE_PASSES = 2

# (C) Lifespan plausibility guard for the fuzzy tiers. A CRSP fund whose last
# summary predates the ISS fund's first vote cannot be the same fund; this is a
# second signal independent of the name score, and it is exactly the regime
# (dead early-panel funds) where the name tiers do their work. One year of
# slack absorbs the caldt-vs-meetingdate offset.
L3_LIFESPAN_SLACK_YEARS = 1

# (P) CRSP `index_fund_flag`: D = pure index, B = index-based, E = index-based
# enhanced. Null means CRSP does not classify the fund as index-linked at all,
# which for a CRSP-covered fund is informative (-> active), NOT missing.
L3_INDEX_FLAG_MAP = {"D": "index", "B": "passive", "E": "passive"}
L3_BLOCKS = ("index", "passive", "active", "asset_owner")

# (P) Name regex for the family/regex fallback, reused verbatim from
# `scripts/cit/t9_classify_index.py` (BASE + EXT). It is applied ONLY to funds
# that never reached a `crsp_fundno`; for a linked fund the CRSP flag is
# authoritative and a null flag means active.
L3_INDEX_NAME_BASE = (
    r"index|idx|indx|s\s*&?\s*p\s*\d{3,4}|russell\s*\d{3,4}|nasdaq\s*\d{2,4}|"
    r"dow(?:\s*jones)?\s*\d{2,4}|wilshire\s*\d{3,4}|ftse|msci|stoxx|"
    r"total\s+(?:stock|market|bond)"
)
L3_INDEX_NAME_EXT = (
    r"acwi|eafe|\bagg\b|aggregate\s+bond|equity\s+index|\bsp\s*\d{3}\b|barclays\s+agg"
)

# (P) Provenance of the `block` assignment, so the lower-confidence fallback is
# never confused with a CRSP-flag classification.
L3_BLOCK_SOURCES = (
    "crsp_flag",       # linked to CRSP; index_fund_flag D/B/E
    "crsp_active",     # linked to CRSP; flag null -> CRSP says not index-linked
    "name_regex",      # NOT linked; index name pattern (lower confidence)
    "name_default",    # NOT linked; no index pattern -> active by default
    "nonregistrant",   # ISS non-registrant (public pension / non-US manager)
)

# (P) Every N-PX filer is a registered fund and therefore part of the
# registered subset of the 13F "institutional" block. Institutional is NOT a
# fund-level type, so it is carried as a flag rather than a `block` value: the
# block's observed DIRECTION comes from this registered subset while its SIZE
# comes from the full 13F (`pass.parquet`) -- a population mismatch T3 must flag.
L3_IN_INSTITUTIONAL = True

L3_ADJUDICATION_CANDIDATES = OUT / "l3_adjudication_candidates.csv"
L3_ADJUDICATION_UNLINKED = OUT / "l3_adjudication_unlinked.csv"
L3_COVERAGE_BY_YEAR = OUT / "l3_coverage_by_year.csv"
L3_COVERAGE_BY_TIER = OUT / "l3_coverage_by_tier.csv"
L3_FLAG_DISAGREEMENTS = OUT / "l3_flag_disagreements.csv"

# ---------------------------------------------------------------------------
# L2 (round 2) -- CRSP-side tier, token guard, power-weighted coverage
# ---------------------------------------------------------------------------

# NOTE: CRSP_CIK_MAP / FUND_SUMMARY2 are defined once above (L3 block, ~L185).
# They were re-declared here by an append-only edit; the duplicate has been
# removed. Values were identical, so no behaviour change.

# (P) CRSP `fund_name` is a compound "Trust: Fund Name; Class X Shares" string.
# The trust prefix and share-class suffix are stripped to expose the fund-level
# name, and BOTH the full and the stripped form enter the corpus.
L2_CRSP_TRUST_PREFIX_RE = r"^[^:]*:\s*"
L2_CRSP_CLASS_SUFFIX_RE = r";.*$"

# (C) CRSP retains defunct funds, so `fund_summary2` reaches the pre-2010 cohort
# that the SEC annual masters (point-in-time snapshots of then-active
# registrants, 2010+) never list. Scoped by `mgmt_name`, which plays the same
# role for CRSP that `institutionid` plays for ISS. Held at 0.90 rather than the
# 0.80 used for the SEC institution scope: CRSP `fund_name` bundles the trust,
# the fund and the share class into one string, so a family-scoped match at 0.85
# was resolving to the wrong sub-fund of the right family ("Oppenheimer
# Portfolio Series: Active Allocation" -> "...Fixed Income Active Allocation").
L2_CRSP_SCOPED_THRESH = 0.90
# (C) Unscoped fallback inside the CRSP tier: accept only a normalised-name
# identity on a name that maps to a single crsp_fundno.
L2_CRSP_EXACTISH = 0.97

# (C) The unscoped SEC tier accepts a family-agreeing match at the scoped bar --
# an institution family token appearing in the SEC entity name IS a scope, just
# a fuzzy one (per team-lead: use `entity_name` for scoping where an institution
# has few resolved siblings).
L2_GLOBAL_FAMILY_THRESH = 0.80

# (P) Digit-bearing tokens ("500", "2000", "2X", "1.5X" -> "1","5X") carry most
# of a fund name's discriminating information but almost none of its character
# mass, so char-ngram TF-IDF underweights them: "Russell 2000" scores ~0.97
# against "Russell 1000" and "S&P 500 2X Strategy" against "S&P 500 3X
# Strategy". A match is rejected unless the multiset of digit-bearing tokens is
# identical on both sides. The same logic applies to an explicit series/portfolio
# designator ("SBL Fund Series N" vs "SBL Fund Series H").
L2_DIGIT_TOKEN_RE = r"[0-9]"
L2_DESIGNATOR_RE = r"\b(?:SERIES|PORTFOLIO|FUND)\s+([A-Z0-9]{1,2})\b\s*$"

# (P) ISS spells the ampersand out inside a token ("SandP 500"); every other
# source writes "S&P", which normalises to "S P". Folded before tokenising so
# the digit guard and the vectoriser see the same string.
L2_AMPERSAND_FOLD = ((r"\bSANDP\b", "S P"), (r"\bS AND P\b", "S P"))

# (P) `totalsharesvoted` is populated 2024+ only (2023 is 12% populated and on a
# different scale; 2005-2022 are entirely null), so shares-weighted coverage is
# measurable only for the two years where row-weighted coverage is already
# 97-99%. `tna_latest` is a single per-fund snapshot and is the only power proxy
# available for the whole panel -- but it is reachable only through a CRSP link,
# so the share of vote rows that CANNOT be weighted must be reported alongside.
L2_SHARES_WEIGHT_FIRST_YEAR = 2024

# ---------------------------------------------------------------------------
# L3 (round 2) -- consume L2's own CRSP resolution; precision guards
# ---------------------------------------------------------------------------
# L2 round 2 added a `crsp_name` tier of its own and now emits `crsp_fundno`
# directly. L3 CONSUMES that column as an additional exact input rather than
# re-deriving it; its own fuzzy tiers then run only on what L2 still leaves.
# The name is the tier label L3 records for a link that arrived this way.
L3_L2_CRSP_TIER = "via_l2_crsp_name"

# (C) Both guards are L2 round 2's, reused verbatim on the same corpus because
# L3 hits the same failure mode: char-ngram TF-IDF underweights the digit tokens
# and series designators that carry a fund name's discriminating information
# ("Russell 2000" ~0.97 against "Russell 1000"; "SBL Fund Series 0" against
# "SBL Fund Series H"). Measured on this corpus: in the 0.80-0.85 band the
# top-1 candidate is systematically the wrong sibling fund of the RIGHT family,
# because CRSP `fund_name` is trust-qualified ("Trust: Fund; Class X") and the
# shared trust prefix dominates the character mass. `family_agree` is therefore
# NOT an independent second signal down there, and the digit guard is what
# separates the real matches from the siblings.
L3_APPLY_DIGIT_GUARD = True

# (P) Near-unanimity band for VERIFY 4c. The plan's design decision -- direction
# is near-unanimous within a block, so the block For/Against split is
# insensitive to each fund's exact weight -- is MEASURED here rather than
# asserted, by recomputing every (item, block) For-fraction on the funds that
# carry a `tna_latest` and comparing it to the all-funds figure.
L3_UNANIMITY_HI = 0.95
L3_UNANIMITY_LO = 0.05

L3_TNA_MATERIALITY = OUT / "l3_tna_materiality.csv"

# ---------------------------------------------------------------------------
# L3b -- feeder_master_name tier (closes the seriesId-but-no-CRSP gap)
# ---------------------------------------------------------------------------
# MEASURED gap this tier attacks: 995 fundids / 4,439,333 vote rows (3.08% of
# the panel) carry an L2 `seriesid` but no `crsp_fundno`, because every one of
# those seriesIds is absent from `crsp_cik_map` -- the series genuinely is not
# in CRSP's series map. The largest are master portfolios in master-feeder
# structures and insurance separate accounts: the MASTER files its own N-PX
# (it holds the securities) while CRSP tracks only the FEEDER, whose name is
# near-identical once the structural words are removed.
#
# NOTE for whoever reads L3's docstring: L3's fuzzy tiers DID already see these
# fundids (`todo` there is an anti-join on the exact tiers, not a filter on
# `match_tier == 'unresolved'`). What they could not do is bridge the
# master/feeder name distance, because the normalisation kept MASTER / SERIES /
# PORTFOLIO and the leading sub-account code. This tier is a NORMALISATION
# change, not a population change.
L3B_TIER = "feeder_master_name"

# (P) Structural words that differ between a master and its feeder, or between
# an ISS and a CRSP rendering of the same fund, and carry no fund identity.
# Removed to form the "core" name space; the "full" space keeps them. Both
# spaces are matched, and a candidate may come from either.
L3B_STRUCTURAL_WORDS = (
    "MASTER", "SERIES", "PORTFOLIO", "PORTFOLIOS", "FUND", "FUNDS", "TRUST",
    "TRUSTS", "ACCOUNT", "ACCOUNTS", "SEPARATE", "VIP", "POOL", "POOLED",
    "SHARES", "CLASS",
)

# (P) ISS writes VA / separate-account sub-account names with a LEADING
# internal code that is not part of the fund's identity: "6721 500 Index B",
# "ZWJ4 GEI Total Return", "GEI S&P 500 INDEX". Three shapes are recognised:
#   pure digits (2-6 chars)              6721
#   mixed letters+digits (<=6 chars)     ZWJ4
#   a short all-caps alpha code (2-4)    GEI, PD, RS, SA   (sponsor shorthand)
# NOT stripped in place -- "500 Index Fund" and "TAX MANAGED ..." both begin
# with a token this pattern matches, and destroying them would be worse than
# the code it removes. Instead the stripped string is emitted as an EXTRA query
# form (`lead_drop`), so the full name still competes and the truncated variant
# has to win on score AND clear the 0.90 bar, the scope, and the margin.
# EACH successive strip is its own form (`lead_drop` = 1 token, `lead_drop2` =
# 2), never a single greedy strip. MEASURED reason: "6721 500 Index B" -- the
# lead's own flagship VA example -- has TWO leading tokens this pattern matches,
# and a greedy strip eats the "500" that IS the fund's identity, leaving
# "INDEX B". Emitting both levels keeps "500 Index B" in play and lets the score
# decide.
L3B_LEAD_CODE_RE = r"^(?:[0-9]{2,6}|[A-Z]{1,3}[0-9]{1,3}[A-Z]{0,2}|[0-9]{1,3}[A-Z]{1,3}|[A-Z]{2,4})\s+"
L3B_LEAD_CODE_MAX = 2

# (P) The digit-token guard (L2_DIGIT_TOKEN_RE) is kept at FULL strength -- it
# is what stops "Russell 2000" matching "Russell 1000" at ~0.97 -- but it is
# evaluated against the query form actually used, not the raw ISS name. A
# candidate that won through `lead_drop` therefore never has to find "6721" in
# the CRSP name, while a candidate that won through the full name still has to
# match every digit token in it. That is the whole exemption: it is positional,
# not a weakening of the rule.
L3B_EXEMPT_LEAD_CODE_FROM_DIGIT_GUARD = True

# (P) Precision is the binding constraint, not coverage (team-lead directive):
# a mis-link imports another fund's `index_fund_flag` AND its `tna_latest`
# vote weight, and the downstream flip counterfactual is sensitive to block
# misassignment and TNA, not to coverage. L3 measured that on the CRSP corpus
# `family_agree` is NOT an independent signal at 0.80-0.85 because CRSP
# `fund_name` is trust-qualified, so the top-1 is systematically the wrong
# sibling. Both bars are therefore 0.90, above L3's own 0.80 / 0.85.
L3B_CAND_THRESHOLD = 0.30
L3B_TFIDF_TOP_K = 100
# MEASURED, second 20-match hand audit: at 0.90 the tier ran ~60% correct and
# EVERY error was the same shape -- the right family, the wrong sibling fund
# ("Mid Cap Value Equity" -> "Value Equity", "Preferred Income II" -> "Preferred
# Income ETF", "Small Company Value" -> "Small Cap Value", "Franklin Real
# Estate" -> "Franklin Global Real Estate") -- and every one of them scored
# 0.907-0.923, while essentially every correct match scored >= 0.97. That is not
# a coincidence: this tier's PREMISE is that a master's name IS its feeder's
# name once the structural words and the sponsor prefix are removed. That is an
# IDENTITY claim, not a similarity claim, so the bar is set where identity lives
# and the remaining fuzziness buys only spelling slack ("S &P" vs "S&P",
# "Multi-Disciplinary" vs "MultiDisciplinary"). Cost of 0.97 over 0.90: 36
# fundids / 120K vote rows, ~0.08pp of panel coverage. Worth it -- a wrong link
# imports another fund's block AND its TNA weight.
L3B_SCOPED_THRESH = 0.97
L3B_GLOBAL_THRESH = 0.97
# (P) Even inside the management-company scope the top-1 must beat the runner-up
# CRSP fund by this much. L3 measured that within a family the top-1 is
# systematically the WRONG sibling; a near-tie at 0.90 between two funds of the
# same family is precisely that case, and the core name space (which removes
# FUND/PORTFOLIO/SERIES) manufactures such ties on purpose. Small enough not to
# reject a genuine master/feeder pair, large enough to reject an exact tie.
L3B_SCOPED_MARGIN = 0.005
L3B_GLOBAL_MARGIN = 0.02

# (P) MEASURED on a 20-match hand audit of the first build: only 6 of 20 were
# correct, and both causes were structural, so both are now constants.
#
# (a) The `core` space deletes FUND/PORTFOLIO/TRUST/SERIES on purpose, which
# collapses short generic names ("Growth Fund", "Mid Cap Portfolio", "Small
# Company Fund" -> "SMALL FUND"). L2's unscoped second signal -- "this name maps
# to exactly ONE corpus unit" -- INVERTS in that space: a real fund name like
# "US LARGE CAP VALUE" is shared by many units and is rejected, while a
# degenerate name that happens to be unique is accepted. The score-identity
# path is therefore REMOVED from this tier (there is no L3B_GLOBAL_EXACTISH),
# and a matched name must carry a minimum number of tokens.
L3B_MIN_MATCH_TOKENS = 3          # scoped
L3B_MIN_MATCH_TOKENS_GLOBAL = 4   # unscoped, no scope to lean on
# A 2-token name is admitted only when everything else agrees: inside the
# management scope, with a family bridge, at an essentially exact score. That is
# the genuine master-feeder shape ("Diversified Equity Master Portfolio" ->
# "BlackRock Funds III: BlackRock Diversified Equity Fund" -> "DIVERSIFIED
# EQUITY" on both sides), and three independent agreements is a higher bar than
# the 3-token rule it replaces.
L3B_MIN_MATCH_TOKENS_STRICT = 2
L3B_STRICT_TOKEN_SCORE = 0.97
#
# (b) L2/L3 built the family signal from the FIRST institution token after the
# stopwords. That is "JOHN" for "John Hancock Funds, LLC" (appears in nothing)
# and "RS" for "RS Investment Management Co. LLC" (too short to mean anything).
# Every remaining token of at least this length now counts, which recovers
# HANCOCK, DIMENSIONAL, BLACKROCK, TRANSAMERICA, NORTHWESTERN.
L3B_FAMILY_MIN_CHARS = 4
# ...and the token must match on WORD BOUNDARIES, not as a substring. MEASURED:
# "Strategic Partners Mutual Funds" contributed the token MUTUAL, which is a
# substring of "MASSMUTUAL", so a Prudential Strategic Partners fund got a
# family bridge to "MassMutual Premier Small Capitalization Value Fund" and was
# accepted unscoped at 1.00. L2/L3 used `literal=True` containment throughout;
# on this tier that is not safe enough.
L3B_FAMILY_WORD_BOUNDARY = True

# (P) Minimum length of a normalised query/corpus name. Below this a name is
# not a fund identity ("MASTER TRUST" -> "" once structural words are removed).
L3B_MIN_NAME_CHARS = 8
L3B_MIN_NAME_TOKENS = 2

# (P) Query-name variants generated per ISS `fundname_modal`. Recorded on every
# accepted match as `gap_form` so a hand audit can separate them and the tier
# can be re-run without the aggressive ones.
L3B_QUERY_FORMS = ("name", "lead_drop", "lead_drop2", "sponsor_drop",
                   "tail_segment", "paren_underlying")

# (P) The sponsor prefix. CRSP repeats the sponsor INSIDE the fund name
# ("BlackRock Index Funds, Inc: BlackRock S&P 500 Index Fund") while the ISS
# master name does not ("S&P 500 Index Master Portfolio"); measured, that prefix
# took the pair from 1.00 to 0.66 -- about a third of the character mass. It is
# stripped from the head of BOTH sides, and the tokens are never guessed: on the
# CRSP side they must already appear in that fund's own trust prefix, on the ISS
# side in that fund's own institution name. Never strips below 2 tokens.
L3B_SPONSOR_KEEP_MIN_TOKENS = 2

# (P) ISS writes "U.S." where CRSP writes "US" ("TAX-MANAGED U.S. TARGETED
# VALUE PORTFOLIO" vs "Tax-Managed US Marketwide Value Portfolio"). The L2/L3
# normaliser turns the first into two tokens "U S" and the second into one
# token "US", which costs the pair real char-ngram mass. Dotted single letters
# are folded into the acronym on BOTH sides before punctuation is stripped, so
# the two corpora stay comparable.
L3B_ACRONYM_DOT_RE = r"\b([A-Z])\."

# (P) ISS trust-qualifies some names with a dash ("GLOBAL ATLANTIC PORTFOLIOS -
# Global Atlantic BlackRock Disciplined Value"); the segment after the last
# separator is the fund. Mirrors the ":" split already applied to the CRSP side.
# Greedy head, so the split is on the LAST separator. Group 1 = the tail.
L3B_TAIL_SEP_RE = r"^.+\s+[-–—:]\s+(.+)$"

# (P) A separate-account wrapper puts the fund it actually holds in parentheses
# ("TIAA Separate Account VA-1 (TIAA Stock Index Account)"). L2_PAREN_RE throws
# that away, which is exactly backwards for a VA entry: the wrapper is never in
# CRSP (measured: 553 N-4/N-6 series, ZERO CRSP hits) but the underlying fund
# may be. The parenthetical is emitted as an extra query form only for names
# carrying a wrapper marker.
L3B_WRAPPER_RE = r"(?i)\b(SEPARATE\s+ACCOUNT|SUB[\s-]?ACCOUNT|VA[\s-]?\d|VARIABLE\s+ACCOUNT)\b"

# (P) Number of scope-bootstrap passes. The institution -> CRSP mgmt_cd scope is
# seeded from EXACT-tier siblings only (`via_seriesid`/`via_ticker`/
# `via_l2_crsp_name`) -- seeding it from fuzzy links would make the scope
# circular with the thing it is gating. It then grows only from the UNSCOPED
# pass's own accepts (L2's finding: a scoped match is inside the scope by
# construction and reveals no new management company).
L3B_SCOPE_PASSES = 2
L3B_EXACT_TIERS = ("via_seriesid", "via_ticker", "via_l2_crsp_name")

# (P) A management company enters an institution's scope only if it accounts for
# at least this share of that institution's exactly-linked siblings. MEASURED
# defect it fixes: ISS institution "BlackRock Advisors, Inc." has 823 exactly
# linked siblings, of which 712 sit under CRSP mgmt_cd AHB (BlackRock), 58 BLK,
# 45 BZW -- and THREE under WEA (Allspring, ex-Wells Fargo), legacy
# Nicholas-Applegate/BGI funds CRSP files under their acquirer. Those three
# admitted the whole Allspring fund family into BlackRock's scope, and "MASTER
# LARGE CAP CORE PORTFOLIO" (BlackRock) duly matched "Allspring Large Cap Core
# Fund" at 1.00. A raw count floor cannot fix this (3 > 2); a SHARE floor can --
# WEA is 0.36% of BlackRock's siblings. Institutions with one or two linked
# siblings are unaffected, since their one mgmt_cd is 100% of the evidence and
# is the best available.
L3B_SCOPE_MIN_SHARE = 0.02

# (P) A CRSP fund whose last summary predates the ISS fund's first vote cannot
# be that fund. Same guard and slack as L3.
L3B_LIFESPAN_SLACK_YEARS = 1

L3B_ACCEPTED = OUT / "l3b_accepted_matches.csv"
L3B_AUDIT_SAMPLE = OUT / "l3b_audit_sample.csv"
L3B_CANDIDATES = OUT / "l3b_candidates.csv"
L3B_UNMATCHED = OUT / "l3b_unmatched.csv"
L3B_COVERAGE_BY_YEAR = OUT / "l3b_coverage_by_year.csv"
L3B_BLOCK_CHANGES = OUT / "l3b_block_changes.csv"
L3B_TNA_HAZARD = OUT / "l3b_tna_hazard.csv"

# (P) Random seed for the 20-match hand-audit sample, so the audit reported in
# LEARNINGS is reproducible.
L3B_AUDIT_SEED = 20260724
L3B_AUDIT_N = 20

# ---------------------------------------------------------------------------
# L3b round 2 -- the cross-family veto (team-lead directive)
# ---------------------------------------------------------------------------
# Directive: make family agreement a HARD GATE, not a soft signal. A master
# portfolio's feeder is in the same family by definition, so a cross-family
# match is structurally impossible, not merely unlikely. The motivating case:
# `BLACKROCK MASTER SMALL CAP GROWTH PORTFOLIO` -> `Allspring Funds Trust:
# Allspring Small Company Growth Fund` at 0.911.
#
# MEASURED before implementing, and it changes the design: a LITERAL hard gate
# ("the ISS family token must appear in the CRSP fund_name or mgmt_name, else
# reject regardless of score") rejects 37 of the 223 accepted matches / 197,074
# vote rows -- and the top of that rejection list is the lead's OWN
# "these are right, don't lose them" set:
#   Tax-Managed Value Portfolio (Boston Management and Research) -> Eaton Vance
#   U.S. Large Cap Value Series (Dimensional)  -> DFA Investment Dimensions
#   CIT S&P 500 INDEX FUND (Reich & Tang)      -> Shelton Funds
# plus Gartmore->Nationwide, Wells Fargo->Allspring, Phoenix->Virtus,
# GE RSP->State Street, Julius Baer->Artio, Claymore->Invesco, Rydex->Guggenheim.
# These are CORPORATE SUCCESSIONS: the ISS name records the family as it was
# when the fund voted, CRSP records the acquirer's name today. Cross-family on
# the page, same fund in fact. A name-only gate cannot tell them from an error.
#
# So the veto is hard, and the exception is ID-BASED, not name-based: the match
# survives a family mismatch only if the target's CRSP management company is
# attested for this ISS institution by its EXACT-tier (seriesId/ticker) siblings
# at >= L3B_SUCCESSION_MIN_SHARE. That evidence comes from SEC series IDs, so
# the name matcher cannot manufacture it. The measured separation is clean:
#   every genuine succession above scores 0.28-1.00 on that share
#   (Eaton Vance 1.00, SEI 0.92, DFA 0.91, Shelton 0.88, Allspring 0.79,
#    Guggenheim 0.72, Virtus 0.61, State Street 0.50, Artio 0.31, Aston 0.29)
#   the three doubtful survivors score 0.05-0.11 (1 sibling each)
#   BlackRock -> Allspring, the case that prompted this, scores 0.0036 (3 of 823)
# The threshold sits in the empty band between 0.11 and 0.275.
L3B_FAMILY_GATE = True
L3B_SUCCESSION_MIN_SHARE = 0.20

# (P) The ISS family-token set the gate tests. Two sources, because neither
# alone is enough:
#   institution name  -- tokens >= L3B_FAMILY_MIN_CHARS, minus the stopwords
#   fund name         -- its FIRST NON-STOPWORD token, >= 3 chars, alphabetic
# The fund-name source is what catches the motivating case directly ("BLACKROCK
# MASTER SMALL CAP GROWTH PORTFOLIO" declares its family in the fund name) and
# what rescues two correct matches the institution source misses: "MFS VARIABLE
# INSURANCE TRUST II - MFS STRATEGIC VALUE" (institution "Massachusetts
# Financial Services Company" yields only MASSACHUSETTS) and "THE BOSTON COMPANY
# LARGE CAP CORE PORTFOLIO" -> "Dreyfus/Boston Company Large Cap Core"
# (institution "Mellon Capital Management" yields only MELLON). Taking the first
# NON-stopword token rather than the literal first is what makes "THE BOSTON
# COMPANY ..." yield BOSTON instead of THE.
L3B_FAMILY_NAME_TOKEN_MIN_CHARS = 3

# ...but a fund-name token is only a FAMILY claim if it actually names a FIRM,
# and a stoplist cannot be trusted to be complete. MEASURED escape with the
# stoplist alone: BlackRock's "Master Large Cap Focus Growth Portfolio" matched
# "Deutsche DWS Investment Trust: DWS Large Cap Focus Growth Fund" at 1.00,
# because FOCUS was not in the strategy stoplist, was taken as BlackRock's
# family token, and then trivially "agreed" -- the target is a Focus Growth fund
# too. A strategy word ALWAYS agrees, which is exactly why it must not count.
#
# The test is therefore EVIDENCE-BASED, not list-based: a fund-name token counts
# as a family token only if it appears in the ISS institution name or in the
# CRSP `mgmt_name` -- only if some firm on one side of the match is actually
# called that. FOCUS is in neither (BlackRock Advisors / DWS), so the match
# falls back to the institution token BLACKROCK, finds it absent from the DWS
# record, and is vetoed. MFS IS the CRSP mgmt_name, so "MFS VARIABLE INSURANCE
# TRUST II - MFS STRATEGIC VALUE" still bridges. The strategy stoplist stays as
# a cheap first filter; the firm-name corroboration is what makes the gate sound.
L3B_FAMILY_NAME_TOKEN_NEEDS_FIRM = True

# (P) Words that describe a fund's STRATEGY or legal form rather than its
# family. Without these, the fund-name token source would emit "SMALL", "TAX",
# "GLOBAL" as family tokens and the gate would pass on anything.
L3B_STRATEGY_STOPWORDS = (
    "SMALL", "LARGE", "MID", "MIDCAP", "SMALLCAP", "MICROCAP", "MICRO", "CAP",
    "GROWTH", "VALUE", "INDEX", "EQUITY", "EQUITIES", "INCOME", "BOND", "BONDS",
    "CORE", "SELECT", "BLEND", "MASTER", "SERIES", "PORTFOLIO", "PORTFOLIOS",
    "FUND", "FUNDS", "TRUST", "ACCOUNT", "VARIABLE", "INSURANCE",
    "INSTITUTIONAL", "TAX", "MANAGED", "MULTI", "ALL", "US", "USA", "GLOBAL",
    "INTERNATIONAL", "EMERGING", "MARKETS", "MARKET", "REAL", "ESTATE", "TOTAL",
    "STOCK", "BALANCED", "STRATEGIC", "OPPORTUNITIES", "OPPORTUNITY", "THE",
    "NEW", "AGGRESSIVE", "MODERATE", "CONSERVATIVE", "HIGH", "YIELD", "SHORT",
    "LONG", "TERM", "DIVERSIFIED", "ACTIVE", "PASSIVE", "DYNAMIC", "FOCUSED",
    "PREMIER", "ADVANTAGE", "RETIREMENT", "TARGET", "LIFEPATH", "FOCUS",
    "SPECIAL", "PRIME", "PLUS", "ULTRA", "ENHANCED", "DISCIPLINED",
    "SYSTEMATIC", "QUALITY", "DIVIDEND", "APPRECIATION",
    # Place words. MEASURED: "United States Trust Co. of New York" contributed
    # the token YORK, which matched "New York Life Investments Funds Trust: NYLI
    # CBRE Real Estate Fund" and passed the family gate as `direct` on a match
    # with ZERO ID-based scope support. A place is not a family.
    "YORK", "UNITED", "STATES",
)
# (P) Applied to BOTH family-token sources. A strategy or place word is not a
# family name whether it comes from the institution name or the fund name, and
# L2/L3 only ever stripped L2_FAMILY_STOPWORDS from the institution side.
L3B_FAMILY_STOP_BOTH_SOURCES = True

# (P) A matched name made ENTIRELY of strategy/structural words ("REAL ESTATE",
# "LARGE CAP VALUE FUND", "SMALL CAP INDEX") carries no identity of its own, so
# the identity has to come from somewhere else: such a match is accepted only
# with real ID-based management-scope support. MEASURED both ways in one audit
# sample -- "2DBE Small Cap Index Fund" -> John Hancock Funds II: Small Cap
# Index Fund is CORRECT and has 97% scope support, while "REAL ESTATE FUND" ->
# NYLI CBRE Real Estate Fund is WRONG and has 0%. The name cannot tell them
# apart; the seriesId-based evidence can.
L3B_REQUIRE_DISTINCTIVE_TOKEN = True

# (P) Recorded on every accepted match so the succession class stays separable
# and can be stripped without a re-run.
L3B_FAMILY_GATE_PATHS = ("direct", "succession", "no_family_token")


# ---------------------------------------------------------------------------
# L3b round 3 -- append the institution; stop stripping the sponsor
# ---------------------------------------------------------------------------
# Reviewer's final design, and it supersedes both the sponsor-strip instruction
# and the hard family gate.
#
# 1. STOP STRIPPING THE SPONSOR. That was the round-1 instruction and it caused
#    the only cross-family error the audit found. With the family token intact,
#    plain name matching already picks correctly: "BLACKROCK MASTER SMALL CAP
#    GROWTH PORTFOLIO" scores 0.455 against BlackRock Advantage Small Cap Growth
#    and 0.136 against Allspring Small Company Growth -- +0.319 for the right
#    answer. Stripping "BLACKROCK" deleted the only disambiguating signal and
#    handed the match to Allspring at 0.911. Structural words and leading
#    internal codes are still stripped; the family never is.
# 2. APPEND `institutionname_modal` TO THE ISS QUERY. CRSP `fund_name` already
#    carries the family, so this makes the two sides comparable and folds family
#    agreement into the SIMILARITY rather than bolting it on as a filter.
#    Measured cross-family margin +0.319 -> +0.439; within-family compression is
#    +0.238 -> +0.143, still far above the margin bar.
# 3. Because of (2), the lexicographic (family_agree, score) ranking is NOT
#    needed and is not implemented. `family_agree` stays as a diagnostic.
L3B_APPEND_INSTITUTION = True
L3B_STRIP_SPONSOR = False

# (P) The exact-identity escape. A family-DISAGREEING winner is accepted only at
# a normalised-name IDENTITY, and that identity is judged on the BARE FUND NAME
# -- never on the appended string, which contains the very institution name that
# disagrees. Rationale: for a genuine master-feeder the feeder is in the same
# family, so a sub-identity fuzzy match across families has no structural
# justification; an exact name identity across nominally different advisers
# usually IS a real relationship -- an adviser subsidiary (Boston Management and
# Research -> Eaton Vance Mutual Funds Trust) or a succession (Reich & Tang's
# California Investment Trust -> Shelton Capital Management). Every such match
# is flagged `family_mismatch_exact` and listed for review.
L3B_EXACT_NAME_IDENTITY = 0.9995
L3B_FAMILY_MISMATCH_FLAG = "family_mismatch_exact"


# ---------------------------------------------------------------------------
# T3 -- block_direction master (METH-01, DATA-02, DATA-03)
# ---------------------------------------------------------------------------
# Grain: one (itemonagendaid, block). The OBSERVED For/Against/Abstain split of
# each block on each item, from how the funds in that block actually voted --
# the quantity the whole observed-vote counterfactual consumes. Direction only;
# block SIZE continues to come from `pass.parquet` holdings, never from N-PX.

BLOCK_DIRECTION = PROC / "block_direction.parquet"

# (P) The flip grain (645,020 items). T3 aggregates the FULL N-PX item universe
# (702,097 items) and carries an `in_pass` flag rather than pre-filtering, so
# the frequency-vs-contest diagnostic can be reported on both populations and
# T5 can join whichever it needs.
PASS_PANEL = PROC / "pass.parquet"

# (P) The denominator of the three reported fractions. Abstain is IN the
# denominator so `for_frac + against_frac + abstain_frac == 1` exactly and T5
# can renormalise to either `base` string ("For+Against" or
# "For+Against+Abstain") without going back to the 143.8M-row source.
T3_DIRECTION_DENOM = ("For", "Against", "Abstain")

# (P) `usable_share` is defined on the T1 direction-usable set (For/Against
# only) over ALL of the item's N-PX rows, so it reproduces T1's 97.28% figure
# and is comparable to it. It is a DIAGNOSTIC, never a filter -- see below.
T3_USABLE_DIRS = ("For", "Against")

# (C) LOW-USABLE GUARD: classify by COMPOSITION, never by size.
# A low `usable_share` has two causes with OPPOSITE handling, and the `Other`
# bucket's own composition separates them cleanly (measured on 2011):
#   (i)  say-on-frequency -- `One Year`/`Two Years`/`Three Years`. There is no
#        For/Against on a frequency ballot, so block direction is undefined.
#        Flagged `is_frequency_item`; T5 excludes them from the observed-vote
#        arm and reports them on their own line, never as 0%-For.
#   (ii) proxy-contest cards -- `Do Not Vote`/`None`. In a contest a fund votes
#        EITHER the management card OR the dissident card and records
#        `Do Not Vote` on the other. These are LEGITIMATE: the For-fraction is
#        computed over the funds that actually voted that card, because the
#        non-voting funds are not part of its electorate. Measured inside
#        `pass.parquet` (2011): `Do Not Vote` 6,789 vs `One Year` 635 -- i.e.
#        low-usable items in the FLIP universe are contests, not frequency
#        ballots. A blanket `usable_share < threshold -> exclude` rule would
#        silently delete the PSX/Elliott items the analysis exists to measure.
T3_FREQUENCY_VOTES = ("One Year", "Two Years", "Three Years")
T3_CONTEST_VOTES = ("Do Not Vote", "None")

# (C) An item is a say-on-frequency BALLOT (not merely an item that collected a
# few stray frequency votes) when frequency choices are the modal answer on the
# item as a whole. A share test on the item's own rows is composition-based and
# scale-free; a threshold on `usable_share` would not be.
T3_FREQ_ITEM_MIN_SHARE = 0.50

# (P) `sharesvoted` is 0% populated 2005-2022, 12.1% in 2023 and 100% in
# 2024-25, so a 2023 cell would be weighted on an eighth of its funds. The
# shares weight is therefore used only from L2_SHARES_WEIGHT_FIRST_YEAR (2024),
# matching the pinned WEIGHT_SCHEME; everything earlier falls back to TNA.
T3_SHARES_FIRST_YEAR = L2_SHARES_WEIGHT_FIRST_YEAR

# (P) Per-cell weight cascade. A cell takes the first scheme that has positive
# weight; funds with NO weight under the chosen scheme still count in the
# unweighted direction and are reported as `n_funds_no_weight` (L3 measured the
# residual as immaterial: dropping every TNA-less fund moves the index-block
# For-fraction by a median of exactly 0.00000 and flips the majority side on
# 0.355% of cells -- reported, not assumed).
T3_WEIGHT_METHODS = ("sharesvoted", "tna", "unweighted")

# (C) TNA HAZARD 1 -- `fundid` -> `crsp_fundno` is MANY-TO-ONE (21,013 fundids
# -> 12,786 CRSP funds), so summing `tna_latest` over `fundid` double-counts
# ($63.96T vs the correct $32.37T). Each CRSP fund's TNA is therefore split
# evenly across the ISS fundids that share it, which makes the fundid-grain
# total reconcile to the distinct-fund total by construction.
T3_TNA_DEDUP_KEY = "crsp_fundno"

# (P) CRSP reports a NEGATIVE `tna_latest` on 2 fundnos (min -$95M). A negative
# weight is not a weight: it drags the weighted For-fraction outside [0,1]
# (observed range before the clamp: [-0.0033, 1.0093]). Non-positive TNA is
# therefore treated as NO weight -- the fund still counts in `n_funds` and in
# the unweighted direction, and is counted in `n_funds_no_weight`.
T3_TNA_MIN = 0.0

# (C) TNA HAZARD 2 -- 9,376 fundids reach CRSP through a FUZZY name tier and
# hold 42.9% of fundid-grain TNA. L3's VERIFY 4b caught two 13-vote-row fundids
# that had inherited Vanguard Total Stock Market's $2.0T through a name match.
# A mis-linked tiny fund would then dominate its block's weighted direction, so
# fuzzy-tier TNA is winsorised at the T3_FUZZY_TNA_WINSOR_PCTL quantile of the
# TNA-per-vote-row ratio observed on the EXACT-ID tiers: an unaudited fuzzy
# match may not carry more assets per vote row than the 99th percentile of a
# fund whose identity is established by an exact ID. Exact-tier weights are
# never touched -- Vanguard's own $2.0T is real.
#
# BOTH LEGS, and this is not optional. A fundid's identity is exact only if its
# `fundid -> seriesId` resolution (L2 `match_tier`) AND its `seriesId ->
# crsp_fundno` attachment (L3 `crsp_match_tier`) are exact-ID. MEASURED: every
# one of L3's VERIFY-4b defect cases carries `crsp_match_tier='via_seriesid'`
# -- an exact CRSP leg -- and is wrong only because the seriesId ITSELF came
# from an L2 NAME tier: "VANGUARD TOTAL BOND MARKET (II) INDEX FUND" fundids
# 23589/23617 (`inst_scoped_name`, 13 vote rows each, sharing Vanguard Total
# STOCK Market's $2.0T) and "VANGUARD INFORMATION TECHNOLOGY INDEX FUND" filed
# under Aberdeen, fundid 12521 (`global_name`, 1 vote row, $121B). Keying the
# winsorisation on the CRSP tier alone leaves exactly the funds the check
# exists to catch uncapped.
T3_EXACT_SERIESID_TIERS = ("iss_seriesid", "propagated")
T3_EXACT_CRSP_TIERS = ("via_seriesid", "via_ticker")
# (P) Listed for auditability, but the code takes the COMPLEMENT of the exact
# pair above -- a tier added upstream is fuzzy until proved exact, never the
# other way round.
T3_FUZZY_CRSP_TIERS = (
    "crsp_name_scoped",
    "crsp_name_global",
    "via_l2_crsp_name",
    "feeder_master_name",
)

# (C) WHERE TO PUT THE CAP -- measured, and the obvious choice is wrong.
# The natural first guess (a P99 of the exact-ID TNA-per-vote-row distribution)
# is far too blunt: it caps 107 fundids and deletes $2.39T, 7.4% of all deduped
# TNA, because "assets per vote row" is high for any genuinely large fund that
# happens to appear in few N-PX items (Vanguard Tax-Managed International, $94B
# over 32 vote rows) as well as for a mis-link. The metric cannot tell those
# apart, so a quantile cap taxes the honest ones hardest.
#
# The rule shipped instead is the SUPPORT of the exact-ID distribution: a link
# that is NOT exact-ID on both legs may not carry more assets per vote row than
# the LARGEST exact-ID fund does. Non-arbitrary (no tuned constant), and it is
# an argument rather than a threshold -- the exact-ID links define the entire
# observed range of legitimate assets-per-vote-row, so a value outside that
# range cannot be attributed to a real fund's size and voting pattern.
# MEASURED: exact-ID max = $16.84B per vote row (2nd = $15.29B, so the bound is
# not one point); it caps exactly 5 fundids for $0.955T (2.95%), and 4 of the 5
# are L3's own known-bad cases. Both alternatives are computed and the
# comparison is reported (`t3_winsor_sensitivity.csv`), never assumed.
T3_FUZZY_TNA_WINSOR_RULE = "exact_max"
# (P) The aggressive alternative, retained as the reported sensitivity arm.
T3_FUZZY_TNA_WINSOR_PCTL = 0.99

# (C) TNA HAZARD 3 -- weights are normalised WITHIN a (item, block) cell, so a
# weighting error can only move mass between funds of the same block and can
# NEVER move mass across blocks. Block size comes from `pass.parquet`.
T3_WEIGHT_WITHIN_BLOCK = True

# (C) INSTITUTIONAL CAVEAT. The registered (RIC) funds that file N-PX are a
# strict SUBSET of the population whose block SIZE comes from `pass.parquet`
# for these blocks: `active` direction is measured on registered active funds
# while its size is the full 13F `ior`; `asset_owner` (CalPERS/Norges/APG --
# public pensions and non-US managers, no SEC or CRSP identifier by
# construction) has no size column in `pass` at all. `index`/`passive` sizes
# come from CRSP mutual-fund holdings, the same registered population that
# votes, so they are not flagged. (The CIT/SMA book missing from the index
# block is T4's hidden layer, not a population mismatch here.)
T3_REGISTERED_SUBSET_BLOCKS = ("active", "asset_owner")

# (P) Peak-memory control. The table is aggregated in T3_BUCKETS contiguous
# `itemonagendaid` ranges. Bucketing on the KEY ITSELF is strictly stronger
# than the year partition T1 needed: an item cannot straddle two buckets by
# construction, so the 88 itemonagendaids that straddle a YEAR boundary are a
# non-issue here, and each item's partition year is still computed exactly
# (from the minimum meeting date over the whole item, all of it in-bucket).
T3_BUCKETS = 16
T3_MAX_PARTITION_ROWS = 10_000_000

# (P) Output diagnostics.
T3_COVERAGE_BY_YEAR = OUT / "t3_coverage_by_year.csv"
T3_BLOCK_SHARES = OUT / "t3_block_shares.csv"
T3_FOR_FRAC_DIST = OUT / "t3_for_frac_distribution.csv"
T3_TNA_HAZARD = OUT / "t3_tna_hazard_top20.csv"
T3_WINSOR_EFFECT = OUT / "t3_winsor_effect.csv"
T3_WINSOR_SENSITIVITY = OUT / "t3_winsor_sensitivity.csv"
T3_LOW_USABLE = OUT / "t3_low_usable_items.csv"
T3_WEIGHT_METHOD = OUT / "t3_weight_method.csv"
T3_PSX_2025 = OUT / "t3_psx_2025.csv"

# (P) Phillips 66, the VALID-03 case study. CUSIP8 of the 9-char ISS `cusip`.
T3_PSX_CUSIP8 = "71854610"
T3_PSX_YEAR = 2025


# ---------------------------------------------------------------------------
# T4/T5 — observed-vote flip engine (METH-01, METH-02, METH-03)
# ---------------------------------------------------------------------------
# Grain: one (itemonagendaid, block, method, hidden_layer). The counterfactual
# is the SAME validated flip engine in both arms -- base-string denominator,
# `voterequirement` threshold, `inv <= 0.95` saturation guard -- and the two
# arms differ in exactly one place: WHICH direction the removed block is
# assumed to have voted.
#   instruction_neutral : the block voted at the item's OVERALL rate (what the
#                         existing pipeline does; outcome-neutral on plain
#                         For/Against ballots, bites only through abstention).
#   observed_vote       : the block voted the way its funds ACTUALLY voted
#                         (T3 `block_direction`), then mirrors the remainder.

FLIPS_PANEL = PROC / "flips_panel.parquet"
INDEX_HIDDEN_ADDITION = PROC / "index_hidden_addition.parquet"
PROPOSALS = PROC / "proposals.parquet"

T5_METHODS = ("instruction_neutral", "observed_vote")

# (P) BLOCK SIZE ALWAYS COMES FROM `pass.parquet` -- percent of ISS
# outstandingshare, /100 -- and NEVER from N-PX (fund counts, summed
# `sharesvoted` or summed TNA). L3 measured why: a master portfolio and its
# feeder are two ISS fundids voting the same underlying shares, so any
# N-PX-derived size double-counts them, while a For-FRACTION is scale-free and
# cannot be moved by the duplication.
T5_BLOCK_SIZE_COL = {
    "index": "index_pct",
    "passive": "passive_pct",
    "institutional": "ior",
    "institutional_reg": "ior",
    "institutional_cnt": "ior",
}

# (P) THE SIZE COLUMNS ARE NESTED; THE T3 BLOCKS ARE A PARTITION. This is the
# single most important pairing rule in T5 and getting it wrong silently
# corrupts every arm except `index`.
#   MEASURED on all 645,020 items: `index_pct <= passive_pct` on 100.000%,
#   `passive_pct <= mf_pct` on 100.000%, `mf_pct <= ior` on 94.62%; medians
#   index 5.54% / passive 6.04% / mutual fund 18.99% / institutional 65.85% of
#   shares outstanding; a naive sum of the four has a median of 100% and a p95
#   of 185% -- they double-count by construction.
# T3, by contrast, assigns each `fundid` to EXACTLY ONE of
# {index, passive, active, asset_owner}. So `passive_pct` (a size that INCLUDES
# index funds) must NOT be paired with the For-fraction of the funds labelled
# `block='passive'` (a direction that EXCLUDES them) -- that is a size from one
# population against a direction from a different one.
#
# Each arm's direction is therefore taken over the NESTED fund set that matches
# its size column:
#   index             index_pct     <- {index}
#   passive           passive_pct   <- {index, passive}
#   institutional     ior           <- {index, passive, active, asset_owner}
#   institutional_reg ior           <- {index, passive, active}   [sensitivity]
# `asset_owner` (CalPERS/CalSTRS/Norges/APG) is INCLUDED in the primary
# institutional arm: those managers file 13F and are therefore inside `ior`,
# so excluding them would repeat the same size-vs-direction mismatch in the
# other direction. They are a distinct population all the same -- ISS collects
# their votes outside N-PX and they are the most dissenting block T3 measured
# (mean for_frac 0.799) -- so the registered-only arm ships alongside as a
# one-line sensitivity rather than the choice being made silently.
T5_BLOCK_DIRECTION_SOURCE = {
    "index": ("index",),
    "passive": ("index", "passive"),
    "institutional": ("index", "passive", "active", "asset_owner"),
    "institutional_reg": ("index", "passive", "active"),
    "institutional_cnt": ("index", "passive", "active", "asset_owner"),
}

# (P) WEIGHTING BASIS per arm. `asset_owner` cells are 100% `unweighted` --
# public pensions have no CRSP `tna_latest` by construction, not by failure --
# so on the weighted basis they enter an item's combined direction with ZERO
# weight whenever any registered cell carries TNA. Including them therefore
# does almost nothing on the weighted basis, which is itself the finding, and
# the only way to let them count is to weight every fund equally. The three
# institutional arms separate the two questions cleanly:
#   institutional      4 blocks, weighted  -- population question, primary
#   institutional_reg  3 blocks, weighted  -- what the asset owners add (~0)
#   institutional_cnt  4 blocks, counts    -- what they add when they CAN count
# `count` = SUM n_for / SUM(n_for+n_against+n_abstain) over the same cells,
# i.e. one fund one vote. It is the basis on which section 4b's exactness check
# is run end-to-end against `clean_npx`.
T5_BLOCK_DIRECTION_BASIS = {"institutional_cnt": "count"}
T5_DIRECTION_BASIS_DEFAULT = "weight"

# (P) The nested direction is RECOMBINED from T3's partition cells rather than
# re-aggregated from the 143.8M-row N-PX: T3's `weight_total` is a RAW per-cell
# sum in the cell's own unit (`tna_w` is a per-fundid weight computed once,
# deduped and winsorised, then summed -- there is no per-block renormalisation;
# `T3_WEIGHT_WITHIN_BLOCK` governs the FRACTION, not the weight), so
#     for_frac(union) = SUM_b for_frac_b * weight_total_b / SUM_b weight_total_b
# is an identity, not an approximation. VERIFIED end-to-end on the unweighted
# basis, where the same recombination can be checked against `clean_npx`
# directly: max |delta| = 0.000e+00 over a seeded sample of items and every
# nested set. The check runs every time (see T5_UNION_CHECK_*).
T5_UNION_CHECK_N = 3000
T5_UNION_CHECK_SEED = 20260724
T5_UNION_CHECK_TOL = 1e-12
T5_BLOCKS = tuple(T5_BLOCK_SIZE_COL)

# (P) Blocks whose SIZE population is wider than the population whose
# DIRECTION is observed. Both institutional arms take a full-13F size (`ior`)
# while only the registered funds that file N-PX (plus, in the primary arm, the
# ISS-collected asset owners) are ever observed voting -- so this is the most
# assumption-laden arm of the three and is labelled as such on every output row.
T5_REGISTERED_SUBSET_BLOCKS = ("institutional", "institutional_reg",
                               "institutional_cnt")

# (P) Cells are combined (across a card pair, and across the blocks of a nested
# set) on the cell's own `weight_total`, which is in TNA dollars under `tna`, in
# shares under `sharesvoted` and in fund counts under `unweighted` -- so cells
# are comparable only within a `weight_method`. The DOMINANT method in the group
# (the one carrying the most weight) wins and non-conforming cells contribute
# ZERO; only a group with no weighted cell at all falls back to `n_funds`.
# MEASURED, and this is why the rule is not "fall back to counts whenever the
# methods disagree": across the registered blocks only 3,584 of 609,313 items
# (0.59%) are mixed, but once `asset_owner` joins the set 302,560 items (49.5%)
# are -- every one of them a TNA-weighted item with an unweightable pension
# cell. A group-level fallback would have silently moved half the institutional
# panel off TNA weighting.
T5_COMBINE_WEIGHT = "weight_total"
T5_COMBINE_WEIGHT_FALLBACK = "n_funds"

# --- the hidden CIT/SMA layer (T4, METH-03) ---------------------------------
# (P) `index_hidden_addition` is percent-of-shares-outstanding by
# (cusip8, quarter), joined to each item on the CUSIP8 of the ISS `cusip` and
# the calendar quarter of the RECORD DATE -- the same key the validated
# reassignment scripts (t14d) use, so the hidden layer is measured on the
# holdings quarter that actually determined who could vote.
T5_HIDDEN_KEY = ("cusip8", "qtr")
T5_HIDDEN_COL = "hidden_idx_pct"
# (C) A block cannot exceed the whole company. The clip binds on the tail of
# `hidden_idx_pct` (max 202.8pp, i.e. a CIT book recorded above the stock's own
# shares outstanding); an item clipped to 1.0 then fails the inherited
# saturation guard (inv <= 0.95) and is reported invalid rather than flipped.
T5_SIZE_CLIP_MAX = 1.0
# (C) HIDDEN_DIRECTION: the hidden CIT/SMA book votes at the observed
# REGISTERED-INDEX direction -- same stewardship team, same voting policy
# (BlackRock/SSGA/Vanguard all state this). It is the single assumption in the
# hidden arm, which is why index flips are reported WITH and WITHOUT it.
T5_HIDDEN_DIRECTION_BLOCK = "index"

# --- the instruction-neutral control (METH-02, VALID-01) --------------------
# (P) The control must reproduce the canonical result exactly, on the FULL item
# grain (no card dedup, which is a reporting-side collapse). If this assert
# ever fails, something upstream of T5 changed and no observed-vote number from
# the same run can be trusted.
T5_CONTROL_BLOCK = "index"
T5_CONTROL_FLIPS = 12

# --- universal-proxy card dedup (DATA-03) ----------------------------------
# (P) Under universal proxy BOTH cards list EVERY nominee, and ISS records the
# nominee's single final tally against BOTH card items -- so one nominee
# appears as two `itemonagendaid`s with identical tallies, one under the
# management card (M0299) and one under the dissident card (S0299). Counting
# both would double-count the contest flips the analysis exists to measure.
# The N-PX side is NOT duplicated: a fund's vote is recorded against whichever
# card it actually returned, so the two rows carry DIFFERENT observed
# directions over DIFFERENT fund populations (PSX 2025: the management-card row
# holds ~91% of the index block's weight). The pair's direction is therefore
# COMBINED, not picked -- picking the management card alone would discard the
# dissident card's electorate.
T5_CARD_DEDUP_MEETINGTYPE = "Proxy Contest"
T5_CARD_DEDUP_KEY = (
    "meetingid", "issagendaitemid", "sponsor", "votedfor", "votedagainst",
    "votedabstain", "votedwithheld", "base", "voterequirement", "tso",
)
# (C) Only a group of EXACTLY TWO items with a real (non-zero) tally is treated
# as a card pair. MEASURED on the 484 contest meetings: 1,062 groups of 2
# against 91 groups of 3-9, and the large groups are degenerate zero-vote
# stubs or genuine ties between several nominees with identical tallies. With
# no nominee name in `pass.parquet`, a >2 group cannot be attributed to card
# duplication rather than a tie, so those are LEFT INTACT and logged. The
# opposite error (collapsing a tie) would delete real items.
T5_CARD_PAIR_SIZE = 2
# (P) Deterministic survivor: the lower `itemonagendaid`. In every inspected
# contest the two cards occupy separate id blocks, so the low id is the first
# card; the choice is immaterial to the numbers because the pair's direction is
# combined and its tallies are identical by construction.
T5_CARD_KEEP = "min_itemonagendaid"

# --- item categories --------------------------------------------------------
# (P) Director codes are the list already used by `build_counterfactuals_v12`,
# extended with S0299 -- the dissident card of a universal-proxy contest, which
# is a director election by any reading and is exactly what PSX 2025 turns on.
T5_DIRECTOR_CODES = (
    "M0201", "M0208", "M0214", "M0220", "M0221", "M0224", "M0225", "M0226",
    "M0228", "M0233", "M0249", "M0250", "M0271", "M0275", "M0276", "M0296",
    "M0297", "M0299", "S0299",
)
# (P) M0550 is the Dodd-Frank advisory vote on NEO compensation (45,038 items,
# the third-largest code in `pass`). Say-on-FREQUENCY is a different ballot
# with no For/Against direction and is handled by T3's `is_frequency_item`.
T5_SAYONPAY_CODES = ("M0550",)
# (P) 14a-8 shareholder proposals split GOV vs SRI on ISS's own
# `resolution_type` from `proposals.parquet`, which covers 99.8% of the
# shareholder items in `pass`; the uncovered tail gets its own bucket rather
# than being folded into either.
T5_RESOLUTION_TYPE_MAP = {"GOV": "gov_14a8", "SRI": "sri"}
T5_SHAREHOLDER_SPONSOR = "Shareholder"
T5_CATEGORY_ORDER = (
    "director", "say_on_pay", "gov_14a8", "sri", "shareholder_other", "routine",
)

# (P) Management's own recommendation, used to sign a flip as pro- or
# anti-management. `None`/missing is reported as `unknown`, never assumed.
T5_MGMTREC_FOR = ("For",)
T5_MGMTREC_AGAINST = ("Against", "Withhold")

# (P) Output diagnostics.
T5_FLIP_COUNTS = OUT / "t5_flip_counts.csv"
T5_FLIPS_BY_YEAR = OUT / "t5_flips_by_year.csv"
T5_FLIPS_BY_CATEGORY = OUT / "t5_flips_by_category.csv"
T5_HIDDEN_LAYER = OUT / "t5_hidden_layer.csv"
T5_NEWLY_FLIPPED = OUT / "t5_newly_flipped.csv"
T5_PSX_2025 = OUT / "t5_psx_2025.csv"
T5_FLIP_SIGN = OUT / "t5_flip_sign.csv"
T5_CARD_GROUPS = OUT / "t5_card_groups.csv"
T5_EFFECT_DIRECTION = OUT / "t5_effect_direction.csv"

# (P) Diagnostic for the one place the observed arm can manufacture an extreme
# counterfactual: the mandated `max(0, votedfor - block_for)` clip BINDS when
# the block's holdings-implied vote count at its observed direction exceeds the
# item's own recorded tally, leaving the ex-block electorate with zero votes on
# that side and a mirrored rate of exactly 0% (or 100%). Structurally
# impossible in the instruction-neutral arm, which removes proportionally. The
# flip counts are therefore reported split on whether the clip bound.
T5_CLIP_INCIDENCE = OUT / "t5_clip_incidence.csv"

# (P) SELF-DESCRIBING ARM DEFINITIONS. The arm names alone do not say which
# population supplies the SIZE and which supplies the DIRECTION, and the two
# differ on every institutional arm. This table is printed in the report and
# written to `t5_block_definitions.csv` (with the measured clip rate and flip
# count attached) so no downstream reader has to infer it from a name.
#
# RETIRED: an `institutional_active_dir` arm (13F size against the `active`
# cell's direction alone) shipped in T5 round 1 and produced 25,551 flips. It
# is NOT a variant, it is the same nesting defect the passive arm had -- an
# `ior` size spans index+passive+active+asset_owner funds while the `active`
# cell excludes three of the four -- so it was removed rather than relabelled.
# The 25,551-vs-32,152 gap is the measured cost of that defect, not a result.
T5_BLOCK_DEFINITIONS = {
    "index": dict(
        size="index_pct (broad index funds, % of shares outstanding)",
        direction="{index}", basis="weighted (TNA / sharesvoted)",
        role="HEADLINE -- size and direction are the same population",
        caveat="none: `index_pct` is a CRSP mutual-fund holdings share and the "
               "voting funds are that same registered population"),
    "passive": dict(
        size="passive_pct (index + other passive, % of shares outstanding)",
        direction="{index, passive}", basis="weighted (TNA / sharesvoted)",
        role="secondary -- nested set, matches its size column",
        caveat="none beyond `index`; `passive_pct` INCLUDES index funds, hence "
               "the two-block direction"),
    "institutional": dict(
        size="ior (ALL 13F institutions, median 65.9% of shares outstanding)",
        direction="{index, passive, active, asset_owner}",
        basis="weighted (TNA / sharesvoted; asset owners carry no TNA and so "
              "enter at zero weight wherever a registered cell is weighted)",
        role="primary institutional arm",
        caveat="REGISTERED-SUBSET MISMATCH: the size is the full 13F block but "
               "only N-PX filers are ever observed voting. Applying that "
               "direction to a 65.9%-of-shares block implies more votes than "
               "were cast on a third of items -- see the clip rate. NOT a "
               "headline number."),
    "institutional_reg": dict(
        size="ior (ALL 13F institutions)",
        direction="{index, passive, active} -- registered N-PX filers only",
        basis="weighted (TNA / sharesvoted)",
        role="sensitivity: what the ISS-collected asset owners add (~0)",
        caveat="same registered-subset mismatch and clip rate as "
               "`institutional`"),
    "institutional_cnt": dict(
        size="ior (ALL 13F institutions)",
        direction="{index, passive, active, asset_owner}",
        basis="fund COUNT (one fund one vote) -- the only basis on which an "
              "asset owner can carry any weight at all",
        role="sensitivity: isolates the WEIGHTING basis from the population",
        caveat="same registered-subset mismatch; the 2.6x gap to "
               "`institutional` is weighting, not population"),
}
T5_BLOCK_DEFS_CSV = OUT / "t5_block_definitions.csv"


# ===========================================================================
# T6 -- validations and adversarial checks
# ===========================================================================
# VALID-01 control targets. The instruction-neutral index arm must reproduce
# the canonical 12 on the FULL item grain (the card-dedup is a reporting
# collapse, so the control is asserted before it), and 22 with the hidden
# CIT/SMA layer added.
T6_CONTROL_INDEX = 12
T6_CONTROL_INDEX_HIDDEN = 22

# VALID-02 targets (2024+ overlap, TNA- vs sharesvoted-weighted direction).
T6_VALID02_FIRST_YEAR = 2024
T6_VALID02_MIN_CORR = 0.90
T6_VALID02_MIN_FLIP_AGREE = 0.90

# Adversarial check 2 -- minimum-evidence floors on the number of funds whose
# votes define a block's direction on an item.
T6_MIN_EVIDENCE_FLOORS = (1, 2, 5, 20, 100)

# Adversarial check 5 -- "near threshold" band, percentage points of For.
T6_NEAR_THRESHOLD_PP = 5.0

# Adversarial check 6 -- the placebo. Each fund is given a RANDOM block and the
# whole observed-vote arm is recomputed; a real effect must collapse toward the
# instruction-neutral figure. TWO null models are run because they hold
# different things fixed and neither alone is the right comparison:
#   `perm_funds`  -- permute the block LABEL across fundids, so the pseudo-index
#                    block has the same NUMBER of funds (3,850) as the real one.
#                    It does NOT have the same vote volume, because index funds
#                    are individually larger N-PX filers.
#   `mass_matched`-- draw fundids in random order until cumulative N-PX vote
#                    rows reach the real index block's 52.1M, so the pseudo
#                    block has the same VOTE MASS and a larger fund count.
# Both are reported; `mass_matched` is the fairer null and is quoted as THE
# placebo.
# 20 seeds on the mass-matched null (the fair one, quoted as THE placebo) and 5
# on the fund-count null; each extra assignment costs one more group-by pass over
# the 143.8M-row N-PX, so the count is a runtime/precision trade, not a taste.
T6_PLACEBO_SEEDS = {
    "mass_matched": (20260724, 11, 202, 3003, 40004, 5, 60006, 707, 88, 9009,
                     101010, 11011, 120012, 13, 140014, 1515, 16016, 170017,
                     18018, 19),
    "perm_funds": (20260724, 11, 202, 3003, 40004),
}
T6_PLACEBO_MODES = ("perm_funds", "mass_matched")
T6_PLACEBO_PRIMARY_MODE = "mass_matched"

T6_VALIDATION_SUMMARY = OUT / "t6_validation_summary.csv"
T6_SAME_DENOM = OUT / "t6_same_denominator.csv"
T6_MIN_EVIDENCE = OUT / "t6_min_evidence.csv"
T6_WEIGHTING = OUT / "t6_weighting_sensitivity.csv"
T6_CLIPPING = OUT / "t6_clipping.csv"
T6_NEAR_THRESHOLD = OUT / "t6_near_threshold.csv"
T6_PLACEBO = OUT / "t6_placebo.csv"
T6_FLIP_SIGN = OUT / "t6_flip_sign.csv"
T6_PSX_ITEMS = OUT / "t6_psx_2025_items.csv"
T6_VALID02 = OUT / "t6_valid02_weighting.csv"

# VALID-04 is NOT recomputed here -- L4 already produced it, row-weighted and
# labelled a conservative floor. T6 cites these files.
T6_L4_COVERAGE = OUT / "l4_coverage.csv"
T6_L4_COVERAGE_BY_YEAR = OUT / "l4_coverage_by_year.csv"
T6_L4_COVERAGE_BY_TIER = OUT / "l4_coverage_by_tier.csv"

# ===========================================================================
# T7 -- exhibits
# ===========================================================================
T7_TABLE1 = OUT / "table1_flips_by_block_method"
T7_TABLE2 = OUT / "table2_flips_by_era_category"
T7_TABLE3 = OUT / "table3_hidden_layer"
T7_TABLE4 = OUT / "table4_link_coverage_by_year"
T7_TABLE5 = OUT / "table5_psx_case_study"
T7_FIGURE1 = OUT / "figure1_annual_flips_index"
T7_ERA_SPLIT = 2023          # pre-2023 vs 2023+ (SPEC Table 2)
T7_FIG_DPI = 300


# ===========================================================================
# L3c -- the `digit_split_name` tier (build_npx_crsp_link_gap2.py)
# ===========================================================================
# L3c is L3b's engine with ONE change: a measured tokenisation bug in the
# digit-token guard is fixed. Everything else -- the 0.97 identity bar, the
# max(bare, institution-appended) scoring, the cross-family veto with its
# ID-based succession exception, the mgmt_cd scope with its share floor, the
# lifespan guard, the token minimums -- is reused VERBATIM from the L3B_*
# constants, because each of those clauses is the residue of a hand audit.
#
# THE BUG. ISS separates digits from words; CRSP FUSES them:
#     ISS  `PROSHARES ULTRA RUSSELL 2000 GROWTH`
#     CRSP `ProShares Trust: ProShares Ultra Russell2000 Growth`
# The guard compares the multiset of digit-BEARING tokens exactly. ISS yields
# {"2000"}; CRSP yields {"RUSSELL2000"}. The multisets differ, so the guard
# VETOES a correct match. The whole ProShares Ultra Russell family is unlinked
# today despite existing in CRSP.
#
# THE FIX. Insert a boundary at every alpha<->digit transition, on BOTH sides,
# before tokenising: `RUSSELL2000` -> `RUSSELL 2000`, `S P500` -> `S P 500`.
# MEASURED, and this is why the fix is NOT confined to the guard: the fusion
# costs real char-ngram mass too. `PROSHARES ULTRA RUSSELL 2000 GROWTH` vs the
# CRSP fund form scores 0.833 unsplit and 1.000 split; `... RUSSELL 3000` scores
# 0.620 unsplit and 1.000 split. At L3b's 0.97 identity bar a guard-only fix
# would still have rejected every one of them. So the split is applied to the
# SCORING strings as well as to the guard -- symmetrically, to both corpora, so
# the two stay comparable.
L3C_TIER = "digit_split_name"
L3C_DIGIT_SPLIT_RULES = ((r"([A-Z])([0-9])", "${1} ${2}"),
                         (r"([0-9])([A-Z])", "${1} ${2}"))

# (P) THE GUARD'S REAL PURPOSE MUST SURVIVE. "Russell 2000" must still not match
# "Russell 1000". It does survive by construction: the split is applied to both
# sides, so the comparison becomes {"2000"} vs {"1000"} -- still unequal, still
# vetoed. VERIFY R in the builder asserts this on the live corpus rather than
# taking it on trust, over the synthetic pair AND over every real ProShares
# Ultra Russell cross-pair.
L3C_REGRESSION_PAIRS = (
    ("PROSHARES ULTRA RUSSELL 2000", "ProShares Trust: ProShares Ultra Russell1000"),
    ("PROSHARES ULTRA RUSSELL 2000 GROWTH",
     "ProShares Trust: ProShares Ultra Russell1000 Growth"),
    ("PROSHARES ULTRA RUSSELL 1000 VALUE",
     "ProShares Trust: ProShares Ultra Russell2000 Value"),
)

# (P) The SERIES-DESIGNATOR guard is evaluated on the UNSPLIT string, unlike the
# digit guard. Deliberate: L2_DESIGNATOR_RE anchors on a trailing 1-2 character
# code ("SBL Fund - Series N", "Portfolio 2A"), and splitting "2A" into "2 A"
# would break the anchor and let "Series 2A" match "Series 2B". The digit guard
# needs the split; the designator guard needs the raw token. Both are required.
L3C_DESIGNATOR_ON_UNSPLIT = True

# (P) The leading internal-code strip (L3B_LEAD_CODE_RE) also runs on the RAW
# leading token, BEFORE the split. "2DBE" and "ZWJ4" are sub-account codes and
# must still be recognised as such; splitting them first ("2 DBE", "ZWJ 4")
# would defeat the pattern and lose the whole VA sub-account population that
# L3b's `lead_drop`/`lead_drop2` forms exist to reach. Order is therefore:
# normalise -> strip lead codes -> digit-split.
L3C_SPLIT_AFTER_LEAD_STRIP = True

# (P) Population: everything still without a `crsp_fundno` after L3b that is not
# an ISS non-registrant (`block != 'asset_owner'`). L3b's own `todo` used the
# same predicate, so this tier sees exactly the funds L3b could not place, and
# any accept it produces is attributable to the normalisation change.
L3C_EXCLUDE_BLOCK = "asset_owner"

L3C_ACCEPTED = OUT / "l3c_accepted_matches.csv"
L3C_AUDIT_SAMPLE = OUT / "l3c_audit_sample.csv"
L3C_CANDIDATES = OUT / "l3c_candidates.csv"
L3C_UNMATCHED = OUT / "l3c_unmatched.csv"
L3C_COVERAGE_BY_YEAR = OUT / "l3c_coverage_by_year.csv"
L3C_BLOCK_CHANGES = OUT / "l3c_block_changes.csv"
L3C_TNA_HAZARD = OUT / "l3c_tna_hazard.csv"
L3C_REGRESSION = OUT / "l3c_digit_guard_regression.csv"
L3C_DIGIT_FUSION = OUT / "l3c_digit_fusion_pairs.csv"

# (P) Same seed family as L3b so the two hand audits are drawn the same way.
L3C_AUDIT_SEED = 20260724
L3C_AUDIT_N = 20


# ---------------------------------------------------------------------------
# L3c round 2 -- the family test must survive a plural
# ---------------------------------------------------------------------------
# (P) MEASURED while verifying the digit fix: with the digit guard repaired, the
# ProShares Ultra Russell funds STILL did not link, and the digit guard was no
# longer the reason. The cross-family veto was.
#
#   ISS  institution `ProShare Advisors LLC`      -> family token PROSHARE
#   CRSP `ProShares Trust: ProShares Ultra Russell2000 Growth`, mgmt `ProFunds
#        Group`                                   -> haystack has PROSHARES
#
# L3B_FAMILY_WORD_BOUNDARY matches `\bPROSHARE\b`, which does NOT match
# "PROSHARES" -- the trailing S is a word character, so the boundary fails. The
# firm's own name is written singular by ISS and plural by CRSP, and the veto
# read that as two different families. It then fell through to the ID-based
# succession escape and failed there too: ProShare's exact-tier siblings sit
# 64/71 under CRSP mgmt_cd BNN and only 7/71 (9.9%) under PFS, which is where
# CRSP files the dead Ultra Russell share classes -- below L3B_SUCCESSION_MIN_SHARE
# (0.20), and correctly so, since 9.9% is inside the band where the measured
# false positives live. The succession escape is not the right instrument here;
# these are not a succession, they are one firm spelled two ways.
#
# The fix is the narrowest one that states that: a family token matches a
# haystack token that differs from it only by a trailing plural S. The pattern
# becomes `\b<stem>S?\b`, where <stem> is the token with a trailing S removed
# when doing so leaves it at least as long as the relevant minimum. Still word
# boundary anchored at BOTH ends, so the substring failure this rule was written
# to prevent is untouched: `\bMUTUALS?\b` still does not match "MASSMUTUAL",
# because there is no word boundary before its MUTUAL. The builder asserts that
# regression rather than claiming it.
L3C_FAMILY_PLURAL_FOLD = True


# ===========================================================================
# L3d -- the `via_sec_ticker` tier (build_npx_crsp_link_ticker.py)
# ===========================================================================
# THE ROUTE. Until L3d, an ISS fundid carrying a SEC `seriesid` could reach
# CRSP only through `crsp_cik_map.series_cik`. MEASURED (L3c, VERIFY): 930
# fundids / 4,056,760 vote rows (2.81% of the panel) carry a seriesid whose
# series is absent from `crsp_cik_map`, and ZERO of those 930 are recoverable
# by repairing that join. `crsp_cik_map` is a dead end for them.
#
# There is a second, previously unused path between the same two exact-ID
# systems:
#
#     ISS fundid -> SEC seriesid -> sec_series_names_long.class_ticker
#                -> fund_summary2.ticker -> crsp_fundno
#
# Both endpoints are exact identifiers; no fuzzy matching decides the match.
# MEASURED yield on the 930: 359 seriesIds carry at least one SEC class ticker,
# 137 of those have a ticker present in CRSP -> 216 candidate fundids /
# 522,043 vote rows (0.36% of the panel).
L3D_TIER = "via_sec_ticker"
L3D_EXCLUDE_BLOCK = "asset_owner"

# (P) Ticker normalisation, applied identically to `sec_series_names_long.
# class_ticker` and `fund_summary2.ticker`: strip, upper-case, and keep only
# pure-alphabetic codes of 3-6 characters. The length floor drops CUSIP
# fragments and 1-2 character junk; requiring alphabetic drops the numeric
# placeholders both sources carry. A US open-end fund/ETF ticker is always
# alphabetic and almost always 5 characters (4 for an ETF).
L3D_TICKER_RE = r"^[A-Z]{3,6}$"

# ---------------------------------------------------------------------------
# THE HAZARD, AND WHY THE BRIEF'S PROPOSED ESCAPE DOES NOT WORK
# ---------------------------------------------------------------------------
# Tickers are recycled: a fund dies, and years later an unrelated family is
# assigned the same five letters. The brief proposed accepting a match when
# EITHER the families agree OR **the ticker is unique in `fund_summary2`**.
#
# MEASURED: the uniqueness escape is worthless, and worse, it is worthless in
# exactly the cases that matter. `fund_summary2` is a LATEST-SNAPSHOT pull --
# one row per `crsp_fundno` carrying that class's LAST observed ticker -- so a
# ticker that was reused SEQUENTIALLY appears on only the surviving fund and is
# therefore "unique" by construction. Uniqueness in this table can only ever
# detect a CONCURRENT collision, and sequential reuse is the failure mode.
# All three of the brief's own headline funds prove it (VERIFY C asserts them):
#
#   SSPSX  BlackRock Small/Mid Cap Growth (dead) -> State Street Institutional
#          Premier Growth Equity           n_crsp_fundno = 1  "unique"
#   MNCCX  Federated Mini-Cap Index (dead) -> Manning & Napier Pro-Blend
#          Conservative Term Series        n_crsp_fundno = 1  "unique"
#   SPIAX  Morgan Stanley S&P 500 Index -> Invesco S&P 500 Index
#          (this one is a genuine SUCCESSION, not a reuse)
#
# The uniqueness path would have accepted the first two -- importing another
# fund's block and its TNA weight -- so it is NOT implemented. Every accept
# must carry a positive second signal.
L3D_UNIQUENESS_IS_NOT_A_SIGNAL = True

# ---------------------------------------------------------------------------
# THE ACCEPT LADDER -- three independent second signals, any one suffices
# ---------------------------------------------------------------------------
# (P) SIGNAL 1, `multi_ticker`: at least this many DISTINCT SEC class tickers of
# the same series land on the SAME CRSP fund unit (`crsp_portno`, falling back
# to the fundno). Two independent exact identifiers agreeing on one fund cannot
# plausibly be coincidence, so this path needs no name corroboration at all --
# and MEASURED, it must not have one: it is what recovers genuine RENAMES whose
# names no longer resemble each other (Phoenix -> Virtus at name score 0.030,
# Evergreen Omega -> Allspring Discovery All Cap Growth at 0.054, RS Global
# Natural Resources -> Victory Global Energy Transition at 0.160, Morgan
# Stanley S&P 500 Index -> Invesco S&P 500 Index at 0.437, all four tickers
# landing on one portno). Structurally unavailable for ETFs, which have one
# share class and therefore one ticker -- hence signals 2 and 3.
L3D_MULTI_TICKER_MIN = 2

# (P) SIGNAL 2, `family`: a family token shared between the ISS/SEC side and the
# CRSP side, word-boundary anchored with L3c's plural fold (`\b<stem>S?\b`).
# Sources are the union of the ISS `institutionname_modal` and EVERY vintage of
# the SEC `entity_name` for that series; targets are the CRSP `fund_name` and
# `mgmt_name`. Including the SEC entity across all 15 annual vintages is what
# makes this work through a rebrand: the Claymore/Guggenheim ETFs file under
# "Invesco Exchange-Traded Fund Trust" in the later masters, so the SEC side
# already carries the acquirer's name and bridges Claymore -> Guggenheim ->
# Invesco without any succession table.
L3D_FAMILY_SOURCES = ("iss_institution", "sec_entity_all_vintages")
L3D_FAMILY_TARGETS = ("crsp_fund_name", "crsp_mgmt_name")

# (P) SIGNAL 3, `name`: TF-IDF cosine between the SEC `series_name` (best over
# vintages) and the CRSP fund name (both the trust-qualified and the
# trust-stripped forms), with the L2/L3 normaliser, the L3c digit split, and the
# digit-token guard. This is CORROBORATION on an exact-ID claim, not a matcher:
# the ticker has already made the identity claim and the name only has to fail
# to contradict it. That is why the bar is far below L3b's 0.97 identity bar --
# a rename legitimately destroys most of the character mass.
#
# CALIBRATION, hand-verified over the 90 candidate fundids carrying NEITHER of
# the other two signals (`l3d_name_only_band.csv` ships the full list):
#   >= 0.45  every one checked is a documented succession -- Rydex/Guggenheim
#            -> Invesco (the S&P Pure Growth/Value, Equal Weight and Top 50
#            ETFs), Oppenheimer Russell 2000 -> Invesco, Salt truBeta -> Pacer,
#            Recon/Horizons NASDAQ 100 Covered Call -> Global X, Reality Shares
#            DIVCON -> Siren, Yorkville MLP -> VanEck, USAA -> VictoryShares,
#            Change Finance -> AXS, Bridgeway -> American Beacon Man.
#   0.28-0.45 ~9 of 11 still correct (USAA Value Momentum -> VictoryShares 0.407,
#            Delaware DPT -> Jackson Square 0.396, Stratton -> Sterling Capital
#            0.344, Wasatch -> Seven Canyons 0.322, ICM -> William Blair 0.292,
#            MTB Small Cap -> Madison 0.281) but two are only economic twins
#            (Epoch US All Cap -> MainStay Epoch Global Choice 0.432, Nomura
#            High Yield -> High Income 0.335). ~82% precision.
#   < 0.28   almost uniformly WRONG, and this is where every reused-ticker false
#            positive sits: Federated Mini-Cap -> Manning & Napier 0.065,
#            BlackRock Master Small Cap Growth -> State Street 0.118, MTB Large
#            Cap -> Ave Maria 0.066, Fifth Third Micro Cap -> BlackRock EM
#            ex-China 0.038, CCM Focused Growth -> Alger 0.011, FMA Small ->
#            AMCAP 0.005.
# The bar is 0.45, not 0.28: the project's standing trade is that a wrong link
# imports another fund's `index_fund_flag` AND its `tna_latest` weight while a
# missed link loses only the weight. The declined 0.28-0.45 band is shipped
# verbatim with per-fund verdicts so the bar can be revisited on evidence.
L3D_NAME_SOLO_THRESH = 0.45
L3D_NAME_CAND_FLOOR = 0.28        # reported, not accepted

# (P) The digit-token guard, carried over from L2/L3b with L3c's alpha<->digit
# split. Applies to the NAME signal only -- the ticker itself is exact, and the
# other two signals do not consult the name. Stops a corroboration score being
# earned by "S&P MidCap 400" against "S&P 500".
L3D_APPLY_DIGIT_GUARD = True

# (P) When a series' tickers land on MORE THAN ONE CRSP fund unit, the unit
# backed by the most distinct tickers wins, and it must win STRICTLY -- a tie is
# rejected as `ambiguous_unit` rather than broken arbitrarily. MEASURED: 6 of
# the 137 matched series are multi-unit and 3 of those are ties.
L3D_REQUIRE_STRICT_PLURALITY = True

# (P) Class -> fund aggregation is L3's, verbatim: `tna_latest` SUMMED over the
# unit's classes, `index_fund_flag` the MODAL non-null flag with disagreements
# logged, representative `crsp_fundno` = the largest class by TNA. Never
# aggregate TNA over `fundid` -- L3 measured $63.51T that way against the
# correct $32.20T over distinct `crsp_fundno`.
L3D_AGG_TNA = "sum_over_unit_classes"
L3D_AGG_FLAG = "modal_non_null"

L3D_AUDIT_N = 20
L3D_AUDIT_SEED = 20260724

L3D_ACCEPTED = OUT / "l3d_accepted_matches.csv"
L3D_CANDIDATES = OUT / "l3d_candidates.csv"
L3D_REJECTED = OUT / "l3d_rejected.csv"
L3D_COLLISIONS = OUT / "l3d_ticker_collisions.csv"
L3D_NAME_ONLY_BAND = OUT / "l3d_name_only_band.csv"
L3D_AUDIT_SAMPLE = OUT / "l3d_audit_sample.csv"
L3D_COVERAGE_BY_YEAR = OUT / "l3d_coverage_by_year.csv"
L3D_BLOCK_CHANGES = OUT / "l3d_block_changes.csv"
L3D_FLAG_DISAGREEMENTS = OUT / "l3d_flag_disagreements.csv"
L3D_TNA_HAZARD = OUT / "l3d_tna_hazard.csv"
L3D_RESIDUAL = OUT / "l3d_residual_gap_a.csv"


# ===========================================================================
# T6b -- corrections to the T6 validation battery (ds-accept F1-F8, 2026-07-25)
# ===========================================================================
# Appended, never edited in place: the T6_* block above records what SHIPPED
# and what was retracted, and the constants below record what replaced it.

# ---------------------------------------------------------------------------
# F0 (found while implementing F1) -- the link on disk is NEWER than the panel
# ---------------------------------------------------------------------------
# `data/processed/npx_crsp_link.parquet` was rebuilt by L3c (23:05) and L3d
# (23:22) AFTER `block_direction.parquet` (20:42) and `flips_panel.parquet`
# (21:31) were built from it, so the link no longer describes the fund -> block
# map the shipped panel used: index is 3,892 fundids on disk against the 3,850
# the panel was built on. A placebo drawn against the on-disk link would be
# scored against a treatment set that does not exist in the panel.
#
# T6 therefore RECONSTRUCTS the as-shipped link by reverting the two tiers that
# landed after the panel, and PROVES the reconstruction rather than asserting
# it: re-aggregating the real index block from the 143.8M-row N-PX through the
# reconstructed link must reproduce `block_direction.parquet`'s index cells
# EXACTLY (n_for / n_against / n_abstain identical, weight_total to 1e-6).
# If the current link ever passes that test unchanged (i.e. T3/T5 are re-run on
# it), the reversion is skipped automatically.
T6_LINK_POST_PANEL_TIERS = ("digit_split_name", "via_sec_ticker")
T6_LINK_REVERT_CHANGES = {"digit_split_name": OUT / "l3c_block_changes.csv",
                          "via_sec_ticker": OUT / "l3d_block_changes.csv"}
T6_LINK_AS_SHIPPED = OUT / "t6_link_as_shipped.parquet"
T6_LINK_VERIFY_TOL = 1e-6

# ---------------------------------------------------------------------------
# F1 -- the placebo pool must EXCLUDE the treated population
# ---------------------------------------------------------------------------
# RETRACTED DESIGN: `mass_matched` drew fundids from the WHOLE population, so a
# "random" block of the index block's vote mass was ~54% real index funds by
# TNA -- and TNA is the basis the direction is computed on. The null contained
# the treatment, which is why it read 1,346 flips against the real 1,814 and
# supported a "nothing specific to index funds" conclusion that is now withdrawn.
#
# STANDING RULE: a null must exclude the treated population, and every placebo
# must REPORT ITS OWN TREATED SHARE (by vote rows and by TNA weight) as a
# shipped column. The absence of that column is what hid the defect.
#
# Two clean pools are run because the reviewer's own decomposition shows the
# passive (B/E) block scores HIGHER than index, so "non-index" and "non-index
# and non-passive" are different nulls and neither alone is the answer:
#   `nonindex`  -- draw from {passive, active, asset_owner}
#   `active_ao` -- draw from {active, asset_owner}  (the stricter null)
# `contaminated_legacy` reproduces the retracted design on its original seeds so
# the correction is auditable against the number it replaces.
T6_PLACEBO_POOLS = {
    "nonindex": ("passive", "active", "asset_owner"),
    "active_ao": ("active", "asset_owner"),
    "contaminated_legacy": ("index", "passive", "active", "asset_owner"),
}
T6_PLACEBO_PRIMARY_POOL = "nonindex"
# Draw rules: `mass` matches the real index block's N-PX vote-row mass (the
# fair null -- index funds are individually large filers); `count` matches its
# fund COUNT. Both are reported.
T6_PLACEBO_DRAWS = ("mass", "count")

# ---------------------------------------------------------------------------
# F2 -- seed count, and why 20 was not a p-value
# ---------------------------------------------------------------------------
# 20 seeds floor the permutation p at 1/21 = 0.0476, which is EXACTLY the
# figure that shipped -- the design could not have produced anything smaller, so
# it could not evidence 5% significance. 199 seeds put the floor at 1/200 =
# 0.005. Runtime is no longer the binding constraint: the re-aggregation was
# rewritten from a per-assignment polars group-by over 16 buckets of the
# 143.8M-row N-PX to a single cached pass plus one `np.bincount` per assignment
# (~2.5s each), verified to reproduce the shipped index cells exactly.
T6_PLACEBO_N_SEEDS = {("nonindex", "mass"): 199,
                      ("active_ao", "mass"): 199,
                      ("nonindex", "count"): 99,
                      ("contaminated_legacy", "mass"): 20}
# Seeds are GENERATED from one base through `np.random.SeedSequence` rather than
# listed, so the count can move without hand-editing a 199-tuple; the legacy
# pool keeps its original literal seeds so it reproduces the retracted number.
T6_PLACEBO_SEED_BASE = 20260725
T6_PLACEBO_LEGACY_SEEDS = T6_PLACEBO_SEEDS["mass_matched"]

# ---------------------------------------------------------------------------
# F1b -- the deterministic benchmark: direction by NAMED population
# ---------------------------------------------------------------------------
# The decisive comparison is not random at all: pair a named fund population's
# observed direction with the SAME `index_pct` size and run the identical arm.
# Reported at the raw item grain AND card-deduped, with the flip-set overlap
# against the real index flip set.
T6_BENCHMARK_POPULATIONS = {
    "index (SHIPPED)": ("index",),
    "active": ("active",),
    "active + asset_owner": ("active", "asset_owner"),
    "passive only (B/E)": ("passive",),
    "index + passive": ("index", "passive"),
    "all N-PX funds": ("index", "passive", "active", "asset_owner"),
}
T6_BENCHMARK_REFERENCE = "index (SHIPPED)"

# ---------------------------------------------------------------------------
# F3 -- the sign statistic must use the pinned mgmtrec vocabularies
# ---------------------------------------------------------------------------
# `t6_validate.py` hard-coded `mrec == "For"` / `mrec == "Against"` instead of
# T5_MGMTREC_FOR / T5_MGMTREC_AGAINST = ("Against", "Withhold"). The 12 index
# flips carrying mgmtrec="Withhold" -- management recommending WITHHOLD, which
# is management-opposed by definition -- fell into `no_mgmtrec` and were dropped
# from the numerator. T5 had it right at 78.1%; T6 reported 77.5%.
T6_SIGN_USE_PINNED_MGMTREC = True

# ---------------------------------------------------------------------------
# F7 -- take `mgmtrec` from the MANAGEMENT card of a universal-proxy pair
# ---------------------------------------------------------------------------
# The card dedup keeps the lower `itemonagendaid` (T5_CARD_KEEP), which is a
# deterministic survivor rule chosen because the pair's TALLIES are identical by
# construction. `mgmtrec` is NOT identical: 65.7% of index card pairs carry
# discordant recommendations, because ISS records the recommendation OF THE CARD
# -- on the dissident's card a management nominee reads "Withhold" and a
# dissident nominee reads "For". Since `mgmtrec` is the sole input to the sign,
# it must come from the management card.
#
# The management card is identified at the MEETING level, never per item (a
# per-item "take the For one" rule would be circular with the statistic it
# feeds): each item in a pair is labelled by whether it is the min-id or the
# max-id member, and the side on which MANAGEMENT-SPONSORED items are
# recommended For more often is the management card for that whole meeting.
T6_CARD_MGMTREC_FROM_MANAGEMENT_CARD = True

# ---------------------------------------------------------------------------
# F4 -- plurality vs majority-threshold items
# ---------------------------------------------------------------------------
# `voterequirement == 0.01` marks a PLURALITY item: the nominee with the most
# votes wins the seat regardless of the For percentage, so "the item's For%
# crosses 50%" is not the decision rule and a "flip" on such an item is a
# statement about the vote, not about the outcome. `fliplib.flip_engine` maps
# vr <= 0.01 to a 0.5 threshold precisely because there is no threshold to use.
# Proxy-contest plurality items are decided by RANK among nominees, which the
# PSX case study (VALID-03) handles explicitly and the panel-wide count cannot.
# Every arm is therefore split, and the majority-only figure is reported as the
# conservative headline.
T6_PLURALITY_VOTEREQ = 0.01
T6_PLURALITY_MEETINGTYPE_CONTEST = T5_CARD_DEDUP_MEETINGTYPE

# ---------------------------------------------------------------------------
# F5 -- 2025 is not comparable, and the flip rate has two denominators
# ---------------------------------------------------------------------------
# (a) `mf_own_broad_index.parquet` ends 2024-12-31, so every 2025 item takes a
#     STALE backward-asof `index_pct`; and 2025 loses far more items to "no
#     observed direction" than any other year. It is flagged on Figure 1 and in
#     every by-year table rather than silently averaged in.
# (b) The observed arm's valid set is a strict SUBSET of the control's
#     (595,381 vs 643,079), so a flip RATE has two defensible denominators. Both
#     ship: the own-arm rate (the estimate) and the control-denominator rate
#     (the conservative floor, which is what a reader comparing to the 12
#     implicitly has in mind).
T6_STALE_INDEX_PCT_FIRST_YEAR = 2025
T6_STALE_INDEX_PCT_SOURCE_END = "2024-12-31"
T6_REPORT_BOTH_DENOMINATORS = True

# --- T6b outputs -----------------------------------------------------------
T6_PLACEBO_V2 = OUT / "t6_placebo_v2.csv"
T6_PLACEBO_SUMMARY = OUT / "t6_placebo_summary.csv"
T6_BENCHMARK = OUT / "t6_benchmark_populations.csv"
T6_PLURALITY = OUT / "t6_plurality_split.csv"
T6_DENOMINATORS = OUT / "t6_denominators.csv"
T6_YEAR_QUALITY = OUT / "t6_year_quality.csv"
T6_CARD_MGMTREC = OUT / "t6_card_mgmtrec.csv"

# --- T7 (exhibits) ---------------------------------------------------------
# Figure 1 shades the stale-`index_pct` year rather than dropping it: dropping a
# year silently is the same class of error as averaging it in silently.
T7_FIG1_FLAG_YEARS = (2025,)
T7_TABLE6 = OUT / "table6_plurality_split"
