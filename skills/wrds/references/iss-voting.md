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
| `outstandingshare` | Total shares outstanding |
| `voterequirement` | Vote threshold required to pass |

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
