# ISS Proxy Voting Data

Agenda-level vote outcomes and fund-level N-PX disclosed votes from ISS (formerly RiskMetrics).

## Tables

| Table | Library | Years | Grain | Description |
|-------|---------|-------|-------|-------------|
| `risk.vavoteresults` | risk | 2003-present | agenda item per meeting | Aggregate vote outcomes for each ballot item |
| `risk.voteanalysis_npx` | risk | 2003-present | fund per agenda item | Fund-level N-PX disclosed votes |

### `risk.vavoteresults` -- Agenda-Level Vote Outcomes

One row per agenda item per meeting.

| Field | Description |
|-------|-------------|
| `cusip` | Historical CUSIP |
| `companyid` | ISS company identifier |
| `meetingid` | Meeting identifier |
| `meetingdate` | Date of shareholder meeting |
| `meetingtype` | 'Annual', 'Special', 'Annual/Special', etc. |
| `recorddate` | Record date for ownership eligibility |
| `ticker` | Company ticker |
| `issagendaitemid` | ISS agenda item identifier |
| `itemonagendaid` | Agenda item identifier (use for joins to NPX) |
| `seqnumber` | Sequence number on ballot |
| `sponsor` | Proposal sponsor ('Management' or 'Shareholder') |
| `mgmtrec` | Management recommendation |
| `voteresult` | Outcome ('Pass', 'Fail') |
| `votedfor` | Votes cast for |
| `votedagainst` | Votes cast against |
| `votedabstain` | Abstentions |
| `votedwithheld` | Votes withheld |
| `brokernonvote` | Broker non-votes |
| `base` | Denominator basis for vote calculation |
| `outstandingshare` | Total shares outstanding — **company-wide (aggregates share classes), AS-REPORTED at meeting date (NOT retroactively split-adjusted). See gotchas.** |
| `voterequirement` | Pass threshold (NOT quorum — quorum is not recorded by ISS; see note below) |

> **Gotchas with `outstandingshare`:**
>
> - **Company-wide, not per-class.** Unlike CRSP `shrout` (per-permno = per-class), ISS `outstandingshare` aggregates across share classes. For dual-class firms (STZ, BRK.B, GOOGL, BF.B) it matches the sum of CRSP `shrout` across the company's permnos. This is the correct denominator for company-wide ownership ratios.
> - **AS-REPORTED, not cfacshr-adjusted.** ISS records the share count at the meeting date, NOT the cumulatively-split-adjusted value. For pre-split-era meetings of firms that later split (e.g., AAPL 2006-2013 pre-2014 7:1 split), `outstandingshare` is ~892M while post-split CRSP-cfacshr-adjusted is ~25B. If you mix it with cfacshr-adjusted numerators, you get impossible ratios. See `tfn-ownership.md` gotcha #4.
> - **Rare catastrophic data-entry errors.** ~0.02% of meeting-rows have `outstandingshare` reported in completely wrong units (CRBP 2022-12-20 = 62.6 trillion shares). Detect with an absolute-cap sanity filter (`> 50e9` shares).
>
> **Quorum threshold is NOT in ISS.** `voterequirement` is the PASS threshold (0.01 = plurality, 0.50 = majority, 0.66/0.75/0.80 = supermajority). The quorum threshold (usually 1/3 or 1/2 per DGCL §216) lives in company bylaws, not ISS Voting Analytics. See any bylaw-quorum extraction pipeline for how to recover it from DEF 14A proxy text.

### `risk.voteanalysis_npx` -- Fund-Level N-PX Votes

One row per fund per agenda item. Links to `vavoteresults` via `itemonagendaid`.

| Field | Description |
|-------|-------------|
| `fundid` | Fund identifier |
| `institutionid` | Institution identifier |
| `fundvote` | How the fund voted |
| `mgtrec` | Management recommendation |
| `issagendaitemid` | ISS agenda item identifier |
| `itemonagendaid` | Agenda item identifier (join key) |
| `meetingdate` | Meeting date |

`fundvote` values: `'For'`, `'Against'`, `'Withhold'`, `'Abstain'`, `'One Year'`, `'Two Years'`, `'Three Years'`

## Query Patterns

### Basic Vote Results Pull
```python
sql = """
    SELECT cusip, meetingid, meetingdate, meetingtype,
           issagendaitemid, itemonagendaid, seqnumber,
           sponsor, mgmtrec, voteresult,
           votedfor, votedagainst, votedabstain,
           votedwithheld, brokernonvote,
           base, outstandingshare, voterequirement
    FROM risk.vavoteresults
    WHERE meetingtype IN ('Annual', 'Special', 'Annual/Special',
                          'Proxy Contest', 'Proxy Contest (M&A)')
"""
votes = pd.read_sql(sql, conn)
```

### Fund-Level Votes with ISS Recommendations
```python
sql = """
    SELECT n.fundid, n.institutionid, n.fundvote, n.mgtrec,
           v.voteresult, v.mgmtrec AS iss_mgmtrec,
           v.meetingdate, v.cusip
    FROM risk.voteanalysis_npx n
    INNER JOIN risk.vavoteresults v
        ON n.itemonagendaid = v.itemonagendaid
    WHERE v.meetingtype IN ('Annual', 'Special', 'Annual/Special',
                            'Proxy Contest', 'Proxy Contest (M&A)')
"""
npx = pd.read_sql(sql, conn)
```

## Derived Variables

### Turnout and For-Percentage from `vavoteresults`

The `base` field determines the denominator for vote calculations. Use conditional logic:

```python
def compute_vote_pcts(df):
    total_votes = (df["votedabstain"] + df["votedagainst"] +
                   df["votedfor"] + df["brokernonvote"] + df["votedwithheld"])

    # Denominator depends on base
    conditions = [
        df["base"].isin(["F+A+AB", "F A AB", "F+A+B"]),
        df["base"].isin(["F+A", "F A"]),
        df["base"] == "Votes Represent",
        df["base"].isin(["Capital Represe", "Outstanding"]),
    ]
    denominators = [
        df["votedfor"] + df["votedagainst"] + df["votedabstain"],
        df["votedfor"] + df["votedagainst"],
        total_votes,
        df["outstandingshare"],
    ]
    denom = np.select(conditions, denominators, default=np.nan)

    df["forpct"] = (df["votedfor"] / denom * 100).clip(0, 100)
    df["turnout"] = (total_votes / df["outstandingshare"] * 100).clip(0, 100)

    # Drop records with bad base values
    df = df[~df["base"].isin(["NA", "NULL"])]
    # Drop nonsensical turnout (raw > 120% before clipping)
    raw_turnout = total_votes / df["outstandingshare"] * 100
    df = df[raw_turnout <= 120]
    # Drop bad records: votedFor <= 0 with Pass
    df = df[~((df["votedfor"] <= 0) & (df["voteresult"] == "Pass"))]
    return df
```

### Fund-Level Agreement Rates from `voteanalysis_npx`

```python
df["agree_iss"] = df["fundvote"] == df["iss_recommendation"]
df["agree_mgmt"] = df["fundvote"] == df["mgtrec"]
df["contested"] = df["iss_recommendation"] != df["mgtrec"]
df["agree_iss_contested"] = df["contested"] & df["agree_iss"]
```

## Linking to CRSP

Link via `cusip` (first 6 characters) to `ncusip` in `crsp.msenames`, with ticker fallback for unmatched meetings:

```sql
-- Primary: CUSIP match
SELECT b.permno, a.*
FROM meetings a
INNER JOIN crsp.msenames b
    ON SUBSTR(a.cusip, 1, 6) = SUBSTR(b.ncusip, 1, 6)
    AND a.meetingdate BETWEEN b.namedt AND b.nameendt;

-- Fallback: ticker match for unmatched meetings
SELECT b.permno, a.*
FROM meetings a
INNER JOIN crsp.msenames b
    ON a.ticker = COALESCE(b.ticker, b.tsymbol)
    AND a.meetingdate BETWEEN b.namedt AND b.nameendt
WHERE a.meetingid NOT IN (SELECT meetingid FROM cusip_matched);
```

## Director Election Agenda Codes

Director elections use these ISS agenda item codes:

`M0201`, `M0208`, `M0214`, `M0220`, `M0221`, `M0224`, `M0225`, `M0226`, `M0228`, `M0233`, `M0249`, `M0250`, `M0271`, `M0275`, `M0276`, `M0296`, `M0297`, `M0299`

## ETL Performance Notes

**Recommended approach:** PostgreSQL with server-side filtering. The full `vavoteresults` table for 2003–2024 is ~834K rows and downloads in ~13.5 seconds with a simple `WHERE meetingdate BETWEEN ...` filter. No chunking or SAS needed.

**Use `uv run python3 -u`** when running via `qsub` on WRDS — Python stdout is fully buffered when redirected to a log file, hiding all progress output until the script finishes.

## Common Gotchas

1. **`base` field determines denominator** -- there are multiple base types; use conditional logic, not a single formula
2. **Nonsensical turnout** -- a handful of ballots per year have turnout > 120%; filter these out before capping at 100
3. **`votedFor` <= 0 with `voteresult='Pass'`** -- bad records; delete these rows
4. **`base` in `('NA', 'NULL')`** -- skip these records entirely (no valid denominator)
5. **Bound `forpct`** -- cap between 0 and 100 after computing
6. **Bound `turnout`** -- cap between 0 and 100 after filtering > 120
7. **Duplicate permnos** -- CUSIP match + ticker fallback can create duplicates; deduplicate by `itemonagendaid`
8. **`recorddate` vs `meetingdate`** -- use `recorddate` for ownership lookups (who was eligible to vote), `meetingdate` for event timing
9. **`meetingtype` filter** -- always filter to standard types (`Annual`, `Special`, `Annual/Special`, `Proxy Contest`, `Proxy Contest (M&A)`) unless you specifically need others
10. **`sharesvoted` is only populated post-2023** -- the `risk.voteanalysis_npx.sharesvoted` field (SEC Rule 14Ad-1 disclosure requirement) is 0% populated for meetings pre-2023, 15% in 2023, and 96% in 2024+. Before 2023 you must estimate shares via 13-F/S12 holdings (see `tfn-ownership.md`). Don't try to rely on `sharesvoted` for historical panels.
11. **`voteanalysis_npx` has fund/institution names inline** -- the full N-PX table includes `fundname`, `institutionname`, `institutionid`, and `fundid` directly. You do NOT need to bridge through MFLinks just to classify institutions (Big Three etc.) for institution-level voting analysis. Bridge only when you need share-weighting from holdings data.
12. **ISS and Glass Lewis recommendations are NOT in WRDS** -- ISS deliberately removed their agenda-level recommendations from the WRDS subscription. The `iss.*` schema on WRDS has compensation / director data but NOT `rec_iss` / `rec_gl` for specific vote items. Options: (a) impute via ML classifier on vote features, (b) use an external feed, or (c) scrape ISS/Glass Lewis annual report filings. Budget for this — it is NOT a quick WRDS query.
13. **ISS agenda codes beyond directors** -- the director election code list is documented above (18 M02XX codes). For say-on-pay use `M0517`, for 14a-8 shareholder proposals use `S****` codes. `sponsor = 'Shareholder'` is a reliable filter for 14a-8 without knowing the specific codes.
