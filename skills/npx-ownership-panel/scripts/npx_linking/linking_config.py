"""linking_config.py — every constant the ISS -> SEC -> CRSP crosswalk depends on.

Self-contained: this module has no project dependencies, so the matcher and the
builders can be lifted into any project. Values marked (M) were MEASURED against
the 2005-2025 N-PX panel; changing one changes the accepted match set, so change
it deliberately and re-run the coverage report.

Read `references/npx-crsp-linking.md` before tuning anything here.
"""

from types import SimpleNamespace

cfg = SimpleNamespace(

    # ======================================================================
    # Name normalisation
    # ======================================================================
    # SEC name vintages embed rename history in the name itself
    # ("PF Small-Cap Growth Fund (formerly named PF Developing Growth Fund)").
    # Emit BOTH the pre- and post-rename forms as separate corpus entries.
    L2_FORMERLY_RE=r"\((FORMERLY|FORMALLY|F/K/A|FKA|PREVIOUSLY|NEE)[^)]*\)",
    L2_PAREN_RE=r"\(([^)]*)\)",

    # Legal-form suffixes carry no discriminating information and differ
    # systematically between the ISS and SEC naming conventions.
    L2_LEGAL_SUFFIX_RE=(
        r"\b(INC|INCORPORATED|LLC|L L C|LP|L P|PLC|CORP|CORPORATION|"
        r"LTD|LIMITED|N V|NV|S A|CO|COMPANY|THE)\b"
    ),

    # ISS spells the ampersand out INSIDE a token ("SandP 500"); every other
    # source writes "S&P", which normalises to "S P". Fold before tokenising, or
    # the digit guard and the vectoriser see different strings for one fund.
    L2_AMPERSAND_FOLD=((r"\bSANDP\b", "S P"), (r"\bS AND P\b", "S P")),

    # "U.S." -> "US" BEFORE the punctuation strip. ISS writes the dots and CRSP
    # does not; stripping punctuation first leaves a two-token "U S" against
    # CRSP's one-token "US", which costs the pair real char-ngram mass. Dotted
    # single letters are folded into the acronym on BOTH sides.
    # Deliberately simple: polars' regex engine has NO look-around, so a
    # lookahead-based "only inside an acronym" version does not compile.
    L3B_ACRONYM_DOT_RE=r"\b([A-Z])\.",

    # ======================================================================
    # The digit-token guard  — the single most important precision rule
    # ======================================================================
    # Digit-bearing tokens carry most of a fund name's discriminating
    # information and almost none of its CHARACTER mass, so char-ngram TF-IDF
    # underweights them: "Russell 2000" scores ~0.97 against "Russell 1000",
    # and "S&P 500 2X Strategy" against "S&P 500 3X Strategy". Index funds
    # differ ONLY by the number. Reject unless the MULTISET of digit tokens is
    # identical on both sides. (M) Drops ~12% of candidate pairs.
    L2_DIGIT_TOKEN_RE=r"[0-9]",
    # Same logic for an explicit designator: "SBL Fund Series N" != "Series H".
    L2_DESIGNATOR_RE=r"\b(?:SERIES|PORTFOLIO|FUND)\s+([A-Z0-9]{1,2})\b\s*$",

    # ======================================================================
    # TF-IDF candidate generation (the "ING" char-ngram recipe)
    # ======================================================================
    # Candidate generation is deliberately WIDE: one global top-k matmul feeds
    # every fuzzy tier, and each tier then filters by its own scope + threshold.
    # Precision is bought in the accept rules, not here.
    L2_TFIDF_ANALYZER="char_wb",
    L2_TFIDF_NGRAM=(2, 4),
    L2_TFIDF_NGRAM_ALT=(3, 3),        # sensitivity check only
    L2_TFIDF_TOP_K=100,
    L2_CAND_THRESHOLD=0.30,

    # ======================================================================
    # L2 tiers: ISS fundid -> SEC seriesId
    # ======================================================================
    # ISS began reporting seriesid on N-PX in this year. Before it, the id is
    # carried BACK over the stable fundid ("propagated").
    L2_ISS_SERIESID_ERA=2023,

    # Precision-descending. EXACT-ID TIERS COME FIRST AND DO MOST OF THE WORK:
    # (M) via_seriesid alone is 19,327 of 21,191 links. The fuzzy tiers are the
    # tail, not the strategy. Any redesign that starts with the matcher has the
    # architecture backwards.
    L2_MATCH_TIERS=(
        "iss_seriesid",      # exact: ISS-reported seriesid, fundid votes 2023+ only
        "propagated",        # exact: same id carried back over the stable fundid
        "cik_scoped_name",   # fuzzy, scoped to the fundid's own ISS `fundcik`
        "inst_scoped_name",  # fuzzy, scoped to CIKs of the institution's resolved siblings
        "global_name",       # fuzzy, unscoped — adjudicated, never on score alone
        "unresolved",
    ),

    # Scoped regimes compare like-to-like against a few dozen candidates and can
    # hold a strict bar. CIK-scoped is strictest: the CIK is an exact
    # ISS-reported identifier.
    L2_CIK_SCOPED_THRESH=0.90,
    L2_INST_SCOPED_THRESH=0.80,
    # The unscoped regime NEVER auto-accepts on score alone. A global match must
    # clear the bar AND carry a second independent signal (family token attested
    # on the target, or a normalised-name identity), AND be unambiguous —
    # top-1 must beat top-2 by the margin, because fund names are many-to-one.
    L2_GLOBAL_THRESH=0.85,
    L2_GLOBAL_EXACTISH=0.97,
    L2_GLOBAL_MARGIN=0.02,
    # An institution family token appearing in the SEC entity name IS a scope,
    # just a fuzzy one; that earns the scoped bar.
    L2_GLOBAL_FAMILY_THRESH=0.80,

    # A share-class label ("Class A", "Institutional Shares") identifies a share
    # class, not a fund, and would match indiscriminately. Only class names that
    # look like a full fund name are admitted to the corpus.
    L2_CLASSNAME_MIN_CHARS=15,
    L2_CLASSNAME_MIN_TOKENS=3,
    L2_GENERIC_CLASS_RE=(
        r"^(CLASS|INSTITUTIONAL|INVESTOR|ADVISOR|ADVISER|SERVICE|RETAIL|SELECT|"
        r"ADMIRAL|INITIAL|PREMIER|PRIMARY|RESERVE|DAILY|SHARES|R\d|[A-Z])\b"
    ),

    # ISS marks non-registrant voters (public pension plans, non-US managers)
    # with a trailing asterisk. They have NO SEC seriesId by construction —
    # report them separately rather than counting them as link failures.
    L2_NONREGISTRANT_RE=r"\*+\s*$",

    # ======================================================================
    # L3 tiers: SEC seriesId / name -> CRSP MFDB
    # ======================================================================
    L3_MATCH_TIERS=(
        "via_seriesid",       # exact: L2 seriesId -> crsp series_cik
        "via_ticker",         # exact: L2 seriesId -> SEC class ticker -> CRSP ticker
        "via_l2_crsp_name",   # L2's own CRSP name tier, consumed not re-derived
        "crsp_name_scoped",   # fuzzy, scoped to mgmt companies of linked siblings
        "crsp_name_global",   # fuzzy, unscoped — adjudicated, never on score alone
        "unlinked",
    ),

    # CRSP `fund_summary2` is CLASS-grained (one row per crsp_fundno). The
    # analysis unit is the FUND, so collapse classes on crsp_portno (shared by a
    # fund's classes; (M) 88.7% populated among named funds); where null, treat
    # the class's own fundno as a singleton unit.
    L3_FUND_UNIT_KEY="crsp_portno",

    # CRSP fund_name is "<Trust>: <Fund>; <Class> Shares".
    L3_CLASS_SUFFIX_RE=r";[^;]*$",
    L2_CRSP_TRUST_PREFIX_RE=r"^[^:]*:\s*",
    L2_CRSP_CLASS_SUFFIX_RE=r";.*$",

    L3_TFIDF_TOP_K=100,
    L3_CAND_THRESHOLD=0.30,
    L3_SCOPED_THRESH=0.80,
    L3_GLOBAL_THRESH=0.85,
    L3_GLOBAL_EXACTISH=0.97,
    L3_GLOBAL_MARGIN=0.02,
    L3_SCOPE_PASSES=2,

    # TRUST-PREFIX DOMINANCE. Because CRSP bundles trust + fund + class into one
    # string, within-family char-ngram similarity is dominated by the shared
    # prefix, and family agreement is NOT an independent signal in the 0.80-0.85
    # band — the top-1 is systematically the WRONG SIBLING. (M) A family-scoped
    # match at 0.85 resolved "Oppenheimer Portfolio Series: Active Allocation"
    # to "...Fixed Income Active Allocation". Hence 0.90, not 0.80, here.
    L2_CRSP_SCOPED_THRESH=0.90,
    # An identity claim (a master's name IS its feeder's, once structural words
    # are gone) needs 0.97: the 0.90-0.97 band is almost entirely sibling
    # confusion.
    L2_CRSP_EXACTISH=0.97,

    # A CRSP fund whose last summary predates the ISS fund's first vote cannot
    # be the same fund. A second signal independent of the name score, and
    # exactly the regime (dead early-panel funds) where the name tiers work.
    # One year of slack absorbs the caldt-vs-meetingdate offset.
    L3_LIFESPAN_SLACK_YEARS=1,

    # ======================================================================
    # Cross-family rule
    # ======================================================================
    # A master portfolio's feeder is in the same family BY CONSTRUCTION, so a
    # cross-family match is structurally impossible — which argues for a hard
    # veto. But a name-only veto deletes the genuine CORPORATE SUCCESSIONS,
    # where ISS records the family as it was at vote time and CRSP records the
    # acquirer today (Boston Management & Research -> Eaton Vance; Reich & Tang
    # -> Shelton; Gartmore -> Nationwide; Wells Fargo -> Allspring; GE RSP ->
    # State Street). (M) ~15% of the master-feeder tier's accepts.
    #
    # So: hard veto, ID-BASED exception. `scope_support` is the share of this
    # ISS institution's EXACT-tier siblings that CRSP files under the target's
    # management company — evidence from SEC series ids, which a name matcher
    # cannot manufacture. (M) Genuine successions sit at 0.28-1.00, known-wrong
    # at 0.05-0.11, and the band 0.111-0.275 is EMPTY. BlackRock -> Allspring,
    # the false match that prompted this rule, scores 0.0036.
    L3B_SUCCESSION_MIN_SHARE=0.20,

    # Words that describe the BUSINESS of an asset manager rather than name it.
    L2_FAMILY_STOPWORDS=(
        "ASSET", "ASSETS", "MANAGEMENT", "MANAGEMENT'S", "MANAGERS", "MANAGER",
        "INVESTMENT", "INVESTMENTS", "INVESTOR", "INVESTORS", "ADVISORS",
        "ADVISERS", "ADVISOR", "ADVISER", "FUND", "FUNDS", "GROUP", "CAPITAL",
        "TRUST", "TRUSTS", "HOLDINGS", "PARTNERS", "GLOBAL", "INTERNATIONAL",
        "SERVICES", "FINANCIAL", "AND", "OF", "US", "USA", "NA", "AMERICA",
    ),
    # A STRATEGY word always agrees — FOCUS bridged BlackRock to DWS at 1.00 —
    # which is why it must never count as family evidence.
    L3B_STRATEGY_STOPWORDS=(
        "FOCUS", "FOCUSED", "CORE", "GROWTH", "VALUE", "INCOME", "EQUITY",
        "BOND", "BALANCED", "SELECT", "STRATEGIC", "OPPORTUNITY",
        "OPPORTUNITIES", "DIVERSIFIED", "DYNAMIC", "ADVANTAGE",
    ),
    # The family stoplist must apply to BOTH token sources, not just the
    # institution side: "Strategic Partners Mutual Funds" otherwise emits
    # STRATEGIC, and MUTUAL is a SUBSTRING of MASSMUTUAL. Containment tests
    # against family tokens must be word-boundary anchored, never substring.
    L3B_FAMILY_STOP_BOTH_SOURCES=True,
    L3B_FAMILY_MIN_CHARS=3,

    # ======================================================================
    # Block assignment
    # ======================================================================
    # CRSP index_fund_flag: D = pure index, B = index-based, E = index-based
    # enhanced. NULL means CRSP does not classify the fund as index-linked at
    # all, which for a CRSP-COVERED fund is informative (-> active), NOT missing.
    L3_INDEX_FLAG_MAP={"D": "index", "B": "passive", "E": "passive"},
    L3_BLOCKS=("index", "passive", "active", "asset_owner"),

    # Name fallback, applied ONLY to funds that never reached a crsp_fundno.
    # For a linked fund the CRSP flag is authoritative and a null flag = active.
    L3_INDEX_NAME_BASE=(
        r"index|idx|indx|s\s*&?\s*p\s*\d{3,4}|russell\s*\d{3,4}|nasdaq\s*\d{2,4}|"
        r"dow(?:\s*jones)?\s*\d{2,4}|wilshire\s*\d{3,4}|ftse|msci|stoxx|"
        r"total\s+(?:stock|market|bond)"
    ),
    L3_INDEX_NAME_EXT=(
        r"acwi|eafe|\bagg\b|aggregate\s+bond|equity\s+index|\bsp\s*\d{3}\b|barclays\s+agg"
    ),

    # Provenance, so the lower-confidence fallback is never confused with a
    # CRSP-flag classification.
    L3_BLOCK_SOURCES=(
        "crsp_flag",       # linked; index_fund_flag D/B/E
        "crsp_active",     # linked; flag null -> CRSP says not index-linked
        "name_regex",      # NOT linked; index name pattern (lower confidence)
        "name_default",    # NOT linked; no index pattern -> active by default
        "nonregistrant",   # ISS non-registrant (public pension / non-US manager)
    ),

    # ======================================================================
    # Weighting
    # ======================================================================
    # `sharesvoted` / `totalsharesvoted` are populated 2024+ only (2023 is
    # ~12-15% and on a different scale; 2005-2022 entirely null). `tna_latest`
    # is a single per-fund snapshot and the only power proxy for the whole
    # panel — but it is reachable ONLY through a CRSP link, so the share of vote
    # rows that CANNOT be weighted must be reported alongside any weighted
    # statistic. build_npx.sas emits n_no_sv / n_no_tna for exactly this.
    L2_SHARES_WEIGHT_FIRST_YEAR=2024,
)
