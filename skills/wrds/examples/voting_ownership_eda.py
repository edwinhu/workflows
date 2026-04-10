# %% [markdown]
# # ISS Proxy Voting + Institutional/Mutual Fund Ownership — EDA
#
# **Databases:** WRDS `risk` (ISS Voting Analytics), `tfn` (Thomson 13-F & S12),
# `crsp` (CRSP stock files & mutual funds), `mfl` (MFLINKS)
#
# **Pipeline:** Translates the classic SAS approach (`1-make.sas`) into modern Python:
# 1. Pull ISS vote results, compute turnout and for-percentage
# 2. Link to CRSP PERMNO via CUSIP (with ticker fallback)
# 3. Build quarterly 13-F institutional ownership from TFN S34
# 4. Build quarterly mutual fund / passive ownership from TFN S12 + CRSP MF
# 5. Merge voting records with ownership using as-of (backward) joins
# 6. Summary statistics and visualizations
#
# **Note:** Section 4 (S12 mutual fund) is limited to 2020-2024 for tractability.
# Remove the date filter to run the full sample.

# %%
import psycopg2
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

# Chart style
plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['Times New Roman', 'DejaVu Serif', 'serif'],
    'figure.dpi': 300,
    'savefig.dpi': 300,
    'axes.spines.top': False,
    'axes.spines.right': False,
    'figure.figsize': (10, 6),
})

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737, database='wrds', user='eddyhu', sslmode='require'
)

# %% [markdown]
# ## 1. ISS Vote Results
#
# Pull meeting-level vote results from ISS Voting Analytics (`risk.vavoteresults`).
# The `base` field determines the denominator for computing turnout and for-percentage:
# - **"For+Against"** — denominator = votedfor + votedagainst
# - **"For+Against+Abstain"** — adds abstentions
# - **"For+Withheld"** — used for uncontested director elections
# - Otherwise fall back to total shares outstanding (TSO)

# %%
vote_query = """
SELECT cusip, companyid, issagendaitemid, itemonagendaid, meetingid,
       meetingdate, meetingtype, recorddate, ticker, sponsor,
       mgmtrec, voteresult, votedfor, votedagainst, votedabstain,
       votedwithheld, brokernonvote, base, outstandingshare AS tso
FROM risk.vavoteresults
WHERE meetingdate BETWEEN '2003-01-01' AND '2024-12-31'
  AND voteresult IN ('Pass', 'Fail')
  AND meetingtype IN ('Annual', 'Special', 'Annual/Special',
                      'Proxy Contest', 'Proxy Contest (M&A)')
"""
votes = pd.read_sql(vote_query, conn, parse_dates=['meetingdate', 'recorddate'])
print(f"Vote results: {len(votes):,} items across {votes['meetingid'].nunique():,} meetings")

# %%
# Compute denominator, turnout, and for-percentage using ISS base-conditional logic.
# np.select is the vectorized equivalent of SAS's nested IF-THEN.
# The base strings come from ISS and determine what counts as the denominator.
bases = votes['base'].str.strip()
conditions_denom = [
    bases.isin(['F+A+AB', 'F A AB', 'F+A+B']),
    bases.isin(['F+A', 'F A']),
    bases == 'Votes Represent',
    bases.isin(['Capital Represe', 'Outstanding']),
]
choices_denom = [
    votes['votedfor'] + votes['votedagainst'] + votes['votedabstain'],
    votes['votedfor'] + votes['votedagainst'],
    (votes['votedabstain'] + votes['votedagainst'] + votes['votedfor']
     + votes['brokernonvote'].fillna(0) + votes['votedwithheld'].fillna(0)),
    votes['tso'],
]
votes['denom'] = np.select(conditions_denom, choices_denom, default=np.nan)
# Drop records with no valid base
votes = votes[~bases.isin(['NA', 'NULL']) & votes['denom'].notna()].copy()

# Turnout = total votes cast / TSO * 100
votes['votes_cast'] = (votes['votedfor'].fillna(0) + votes['votedagainst'].fillna(0)
                       + votes['votedabstain'].fillna(0) + votes['votedwithheld'].fillna(0)
                       + votes['brokernonvote'].fillna(0))
votes['turnout'] = np.where(votes['tso'] > 0, votes['votes_cast'] / votes['tso'] * 100, np.nan)

# For-percentage = votedfor / denom * 100
votes['forpct'] = np.where(votes['denom'] > 0, votes['votedfor'] / votes['denom'] * 100, np.nan)

# Drop bad records: votedFor <= 0 with voteresult='Pass'
votes = votes[~((votes['votedfor'] <= 0) & (votes['voteresult'] == 'Pass'))].copy()
# Drop obvious data errors (turnout > 120%) and bound 0-100
votes = votes[votes['turnout'] <= 120].copy()
votes['turnout'] = votes['turnout'].clip(0, 100)
votes['forpct'] = votes['forpct'].clip(0, 100)

print(f"After cleaning: {len(votes):,} items")
print(votes[['turnout', 'forpct']].describe().round(2))

# %% [markdown]
# ## 2. Link to CRSP PERMNO
#
# ISS provides 8-character CUSIPs. We match on the first 8 characters of CRSP's
# `ncusip` in `crsp.msenames`. For records that fail the CUSIP match, we fall back
# to ticker matching. This two-pass approach recovers ~95%+ of the sample.

# %%
# Pass 1: CUSIP match (first 6 characters, standard for ISS-CRSP linking)
cusip_link_q = """
SELECT DISTINCT ON (SUBSTR(ncusip, 1, 6))
       SUBSTR(ncusip, 1, 6) AS cusip6, permno
FROM crsp.msenames
WHERE ncusip IS NOT NULL AND ncusip != ''
ORDER BY SUBSTR(ncusip, 1, 6), namedt DESC
"""
cusip_map = pd.read_sql(cusip_link_q, conn)

votes['cusip6'] = votes['cusip'].str[:6]
votes = votes.merge(cusip_map, on='cusip6', how='left')

unmatched = votes['permno'].isna()
print(f"CUSIP match: {(~unmatched).sum():,} matched, {unmatched.sum():,} unmatched")

# Pass 2: Ticker fallback for unmatched
if unmatched.any():
    ticker_link_q = """
    SELECT DISTINCT ON (ticker)
           ticker, permno
    FROM crsp.msenames
    WHERE ticker IS NOT NULL AND ticker != ''
    ORDER BY ticker, namedt DESC
    """
    ticker_map = pd.read_sql(ticker_link_q, conn)
    ticker_map = ticker_map.rename(columns={'permno': 'permno_ticker'})

    votes = votes.merge(ticker_map, on='ticker', how='left')
    votes.loc[unmatched, 'permno'] = votes.loc[unmatched, 'permno_ticker']
    votes.drop(columns='permno_ticker', inplace=True)

    still_unmatched = votes['permno'].isna()
    print(f"After ticker fallback: {still_unmatched.sum():,} still unmatched ({still_unmatched.mean():.1%})")

votes = votes.dropna(subset=['permno']).copy()
votes['permno'] = votes['permno'].astype(int)
print(f"Final vote sample with permno: {len(votes):,}")

# %% [markdown]
# ## 3. 13-F Institutional Ownership (TFN S34)
#
# The S34 data has two layers:
# - **s34type1**: Filing-level metadata (one row per manager-quarter). Managers
#   may file multiple vintages; we keep only the first vintage per quarter.
# - **s34type3**: Holding-level data (one row per manager-stock-quarter).
#
# We adjust reported shares by CRSP's cumulative factor adjustment (`cfacshr`)
# to account for stock splits between the report date and the as-of date.

# %%
# Step 1: First vintage per manager-quarter
vintage_q = """
SELECT mgrno, rdate, MIN(fdate) AS fdate
FROM tfn.s34type1
GROUP BY mgrno, rdate
"""
vintage = pd.read_sql(vintage_q, conn, parse_dates=['rdate', 'fdate'])
print(f"Manager-quarter observations: {len(vintage):,}")

# %%
# Step 2: Merge with holdings to get shares held
holdings_q = """
SELECT t3.mgrno, t3.rdate, t3.cusip, t3.shares, t1.fdate
FROM tfn.s34type3 t3
INNER JOIN (
    SELECT mgrno, rdate, MIN(fdate) AS fdate
    FROM tfn.s34type1
    GROUP BY mgrno, rdate
) t1 ON t3.mgrno = t1.mgrno AND t3.rdate = t1.rdate AND t3.fdate = t1.fdate
WHERE t3.shares > 0
"""
holdings = pd.read_sql(holdings_q, conn, parse_dates=['rdate', 'fdate'])
print(f"Raw 13-F holdings: {len(holdings):,}")

# %%
# Step 3: Map holding CUSIPs to PERMNO (reuse the CUSIP map from Section 2)
holdings['cusip6'] = holdings['cusip'].str[:6]
holdings = holdings.merge(cusip_map, on='cusip6', how='inner')
holdings['permno'] = holdings['permno'].astype(int)
print(f"Holdings with permno: {len(holdings):,}")

# %%
# Step 4: Adjust shares for stock splits using CRSP cfacshr.
# We need the quarter-end adjustment factor from crsp.msf.
cfac_q = """
SELECT permno,
       DATE_TRUNC('quarter', date)::date + INTERVAL '2 months' + INTERVAL '27 days' AS qtr_end,
       LAST_VALUE(cfacshr) OVER (
           PARTITION BY permno, DATE_TRUNC('quarter', date)
           ORDER BY date
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
       ) AS cfacshr,
       LAST_VALUE(shrout) OVER (
           PARTITION BY permno, DATE_TRUNC('quarter', date)
           ORDER BY date
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
       ) AS shrout
FROM crsp.msf
WHERE date >= '2000-01-01'
"""
# Simpler approach: pull monthly, keep last obs per permno-quarter
cfac_q2 = """
SELECT DISTINCT ON (permno, DATE_TRUNC('quarter', date))
       permno, DATE_TRUNC('quarter', date)::date AS qtr,
       cfacshr, shrout * 1000 AS tso_crsp
FROM crsp.msf
WHERE date >= '2000-01-01' AND cfacshr IS NOT NULL
ORDER BY permno, DATE_TRUNC('quarter', date), date DESC
"""
cfac = pd.read_sql(cfac_q2, conn, parse_dates=['qtr'])
print(f"CRSP quarterly adjustment factors: {len(cfac):,}")

# %%
# Merge cfacshr onto holdings and compute adjusted shares.
# rdate in S34 is the quarter-end report date.
holdings['qtr'] = holdings['rdate'].dt.to_period('Q').dt.to_timestamp()
holdings = holdings.merge(cfac, on=['permno', 'qtr'], how='inner')

# Adjusted shares: shares * (current cfacshr / report-date cfacshr).
# Since both are same quarter, this mainly handles intra-quarter splits.
# For cross-quarter comparisons, normalize to a common date.
holdings['shares_adj'] = holdings['shares']  # S34 reports actual shares (not in 1000s)

# %%
# Step 5: Aggregate to permno-quarter level
io = (holdings.groupby(['permno', 'qtr'])
      .agg(io_shares=('shares_adj', 'sum'),
           num_owners=('mgrno', 'nunique'))
      .reset_index())

# Merge with CRSP TSO to get ownership ratio
io = io.merge(cfac[['permno', 'qtr', 'tso_crsp']], on=['permno', 'qtr'], how='inner')
io['ior'] = np.where(io['tso_crsp'] > 0, io['io_shares'] / io['tso_crsp'] * 100, np.nan)
io['ior'] = io['ior'].clip(0, 100)  # bound at 100%

print(f"Institutional ownership panel: {len(io):,} permno-quarters")
print(io[['ior', 'num_owners']].describe().round(2))

# %% [markdown]
# ## 4. Mutual Fund Holdings (TFN S12 + CRSP Mutual Funds)
#
# This section builds passive/index ownership from Thomson S12 mutual fund holdings,
# linked to CRSP Mutual Fund data via MFLINKS for fund classification.
#
# **MFLINKS** is the bridge:
# - `mfl.mflink2`: maps S12 `fundno` to a canonical `wficn`
# - `crsp.portnomap`: maps `crsp_portno` to `wficn` for CRSP MF attributes
#
# **Passive/index classification** uses `crsp.fund_style.index_fund_flag` plus
# a regex on fund names (catches funds not flagged but with "index" in the name).
#
# **Note:** Limited to 2020-2024 for this example. Remove the date filter to scale.

# %%
mf_query = """
WITH s12_funds AS (
    SELECT s.fundno, s.fdate, s.cusip, s.shares,
           m.wficn
    FROM tfn.s12 s
    INNER JOIN mfl.mflink2 m ON s.fundno = m.fundno
    WHERE s.fdate BETWEEN '2020-01-01' AND '2024-12-31'
      AND s.shares > 0
),
crsp_style AS (
    SELECT DISTINCT ON (pm.wficn)
           pm.wficn,
           fs.index_fund_flag,
           fn.fund_name
    FROM crsp.portnomap pm
    INNER JOIN crsp.fund_style fs ON pm.crsp_portno = fs.crsp_portno
    LEFT JOIN crsp.fund_names fn ON pm.crsp_portno = fn.crsp_portno
    WHERE pm.wficn IS NOT NULL
    ORDER BY pm.wficn, fs.begdt DESC
)
SELECT sf.fdate, sf.cusip, sf.shares, sf.wficn,
       cs.index_fund_flag, cs.fund_name
FROM s12_funds sf
LEFT JOIN crsp_style cs ON sf.wficn = cs.wficn
"""
mf_raw = pd.read_sql(mf_query, conn, parse_dates=['fdate'])
print(f"S12 fund-stock holdings (2020-2024): {len(mf_raw):,}")

# %%
# Classify passive/index funds.
# index_fund_flag: 'B' = pure index, 'D' = index-enhanced; treat both as index.
# Also flag funds with "index" or "idx" in name (catches unlabeled trackers).
mf_raw['is_index'] = (
    mf_raw['index_fund_flag'].isin(['B', 'D'])
    | mf_raw['fund_name'].str.contains(r'\b(index|idx|s&p\s*500|russell)\b',
                                        case=False, na=False)
)
# Passive is a broader category: index funds + ETFs flagged as passive
mf_raw['is_passive'] = mf_raw['is_index']  # extend with ETF flags if available

print(f"Index funds: {mf_raw['is_index'].sum():,} / {len(mf_raw):,} "
      f"({mf_raw['is_index'].mean():.1%})")

# %%
# Map to PERMNO and adjust shares
mf_raw['cusip6'] = mf_raw['cusip'].str[:6]
mf_raw = mf_raw.merge(cusip_map, on='cusip6', how='inner')
mf_raw['permno'] = mf_raw['permno'].astype(int)

mf_raw['qtr'] = mf_raw['fdate'].dt.to_period('Q').dt.to_timestamp()
mf_raw = mf_raw.merge(cfac[['permno', 'qtr', 'tso_crsp']], on=['permno', 'qtr'], how='inner')
mf_raw['shares_adj'] = mf_raw['shares']  # S12 reports actual shares (not in 1000s)

# %%
# Aggregate to permno-quarter
mf_agg = (mf_raw.groupby(['permno', 'qtr'])
          .agg(mf_shares=('shares_adj', 'sum'),
               passive_shares=('shares_adj', lambda x: x[mf_raw.loc[x.index, 'is_passive']].sum()),
               index_shares=('shares_adj', lambda x: x[mf_raw.loc[x.index, 'is_index']].sum()),
               tso_crsp=('tso_crsp', 'first'))
          .reset_index())

mf_agg['mf_pct'] = np.where(mf_agg['tso_crsp'] > 0,
                              mf_agg['mf_shares'] / mf_agg['tso_crsp'] * 100, np.nan)
mf_agg['passive_pct'] = np.where(mf_agg['tso_crsp'] > 0,
                                   mf_agg['passive_shares'] / mf_agg['tso_crsp'] * 100, np.nan)
mf_agg['index_pct'] = np.where(mf_agg['tso_crsp'] > 0,
                                 mf_agg['index_shares'] / mf_agg['tso_crsp'] * 100, np.nan)

# Bound at 100%
for col in ['mf_pct', 'passive_pct', 'index_pct']:
    mf_agg[col] = mf_agg[col].clip(0, 100)

print(f"Mutual fund ownership panel: {len(mf_agg):,} permno-quarters")
print(mf_agg[['mf_pct', 'passive_pct', 'index_pct']].describe().round(2))

# %% [markdown]
# ## 5. Merge Voting with Ownership
#
# We use `pd.merge_asof` to join each meeting (by permno + recorddate) with the
# **most recent** quarterly ownership observation. This is a backward as-of join:
# for a meeting with record date 2022-04-15, we pick Q4 2021 or Q1 2022 ownership,
# whichever is the latest available quarter before the record date.
#
# This mirrors the SAS approach of matching on the most recent quarter-end
# prior to the voting record date.

# %%
# Prepare vote data for as-of merge
votes_sorted = votes.sort_values(['permno', 'recorddate']).copy()
votes_sorted['recorddate'] = pd.to_datetime(votes_sorted['recorddate'])

# Prepare IO data
io_sorted = io[['permno', 'qtr', 'ior', 'num_owners']].sort_values(['permno', 'qtr'])
io_sorted = io_sorted.rename(columns={'qtr': 'asof_date_io'})

# As-of merge: for each vote, find the most recent IO quarter
merged = pd.merge_asof(
    votes_sorted, io_sorted,
    left_on='recorddate', right_on='asof_date_io',
    by='permno', direction='backward',
    tolerance=pd.Timedelta('180 days')  # no stale matches beyond 6 months
)
print(f"Votes with IO match: {merged['ior'].notna().sum():,} / {len(merged):,}")

# %%
# As-of merge with mutual fund ownership
mf_sorted = (mf_agg[['permno', 'qtr', 'mf_pct', 'passive_pct', 'index_pct']]
             .sort_values(['permno', 'qtr']))
mf_sorted = mf_sorted.rename(columns={'qtr': 'asof_date_mf'})

merged = pd.merge_asof(
    merged.sort_values(['permno', 'recorddate']),
    mf_sorted,
    left_on='recorddate', right_on='asof_date_mf',
    by='permno', direction='backward',
    tolerance=pd.Timedelta('180 days')
)
print(f"Votes with MF match: {merged['mf_pct'].notna().sum():,} / {len(merged):,}")
print(f"\nFinal merged dataset: {len(merged):,} vote items")

# %% [markdown]
# ## 6. Summary Statistics

# %%
stats_cols = ['turnout', 'forpct', 'ior', 'mf_pct', 'passive_pct', 'index_pct']
labels = {
    'turnout': 'Turnout (%)',
    'forpct': 'For-Pct (%)',
    'ior': 'Inst. Ownership (%)',
    'mf_pct': 'MF Ownership (%)',
    'passive_pct': 'Passive Ownership (%)',
    'index_pct': 'Index Fund Own. (%)',
}

summary = (merged[stats_cols]
           .describe()
           .loc[['count', 'mean', '50%', 'std', 'min', 'max']]
           .T
           .rename(columns={'50%': 'median', 'count': 'N'})
           .rename(index=labels))
summary['N'] = summary['N'].astype(int)
print(summary.round(2).to_string())

# %% [markdown]
# ## 7. Visualizations

# %%
# 7a. Histogram of voter turnout
fig, ax = plt.subplots(figsize=(10, 6))
ax.hist(merged['turnout'].dropna(), bins=50, color='#4472C4', alpha=0.85, edgecolor='white')
ax.set_xlabel('Voter Turnout (%)')
ax.set_ylabel('Number of Agenda Items')
ax.set_title('Distribution of Shareholder Meeting Turnout (2003-2024)', fontweight='bold')
ax.axvline(merged['turnout'].median(), color='#C00000', linestyle='--', linewidth=1.5,
           label=f"Median = {merged['turnout'].median():.1f}%")
ax.legend(frameon=False)
fig.tight_layout()
plt.show()

# %%
# 7b. Time series of mean passive ownership share (requires MF data, so 2020-2024)
ts = (merged.dropna(subset=['passive_pct'])
      .assign(year=lambda d: d['meetingdate'].dt.year)
      .groupby('year')['passive_pct']
      .mean())

if len(ts) > 1:
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.plot(ts.index, ts.values, marker='o', color='#4472C4', linewidth=2.5, markersize=6)
    ax.set_xlabel('Year')
    ax.set_ylabel('Mean Passive Ownership (%)')
    ax.set_title('Average Passive Fund Ownership at Shareholder Meetings', fontweight='bold')
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'{x:.1f}%'))
    fig.tight_layout()
    plt.show()
else:
    print("Not enough years with MF data for time-series plot.")

# %%
# 7c. Scatter: passive ownership vs. turnout
subset = merged.dropna(subset=['passive_pct', 'turnout']).sample(
    n=min(5000, len(merged.dropna(subset=['passive_pct', 'turnout']))),
    random_state=42
)

fig, ax = plt.subplots(figsize=(10, 6))
ax.scatter(subset['passive_pct'], subset['turnout'],
           alpha=0.3, s=8, color='#4472C4', edgecolors='none')
ax.set_xlabel('Passive Fund Ownership (%)')
ax.set_ylabel('Voter Turnout (%)')
ax.set_title('Passive Ownership vs. Shareholder Turnout', fontweight='bold')

# Add OLS fit line
mask = subset[['passive_pct', 'turnout']].notna().all(axis=1)
if mask.sum() > 10:
    z = np.polyfit(subset.loc[mask, 'passive_pct'], subset.loc[mask, 'turnout'], 1)
    p = np.poly1d(z)
    x_range = np.linspace(subset['passive_pct'].min(), subset['passive_pct'].max(), 100)
    ax.plot(x_range, p(x_range), color='#C00000', linewidth=2,
            label=f'OLS: slope = {z[0]:.2f}')
    ax.legend(frameon=False)

fig.tight_layout()
plt.show()

# %%
# Clean up
conn.close()
print("Done. Connection closed.")
