# %% [markdown]
# # LPC / DealScan — Exploratory Data Analysis
#
# **Database:** WRDS `dealscan` schema (LPC/Refinitiv DealScan)
#
# **Coverage:** Global syndicated loan market, 1981–present
# - `facility` table (normalized): ~396K facilities, reliable 1990–2020
# - `dealscan` table (flat, lender-level): ~3.1M rows, coverage through 2025
#
# **Key finding:** The normalized tables (`facility`, `package`, `lendershares`) stop
# being populated ~2021. The flat `dealscan` table has full recent coverage but requires
# deduplication (one row per lender-tranche pair). Use `facility` for historical analysis,
# `dealscan` flat for recent years.

# %%
import psycopg2
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from pathlib import Path

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

OUTPUT_DIR = Path('/Users/vwh7mb/areas/secreg/output/regd-plots')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737, database='wrds', user='eddyhu', sslmode='require'
)

# %% [markdown]
# ## 1. Annual Loan Origination — Count and Dollar Volume
#
# Uses the `facility` table (amounts in raw currency units).
# Filter to USD facilities only for clean volume calculations.

# %%
annual_q = """
SELECT
    EXTRACT(YEAR FROM f.facilitystartdate)::int AS year,
    COUNT(*) AS n_facilities,
    SUM(f.facilityamt) / 1e9 AS volume_bn,
    AVG(f.facilityamt) / 1e6 AS avg_size_mm,
    AVG(f.maturity) AS avg_maturity_months
FROM dealscan.facility f
WHERE f.facilitystartdate BETWEEN '1990-01-01' AND '2020-12-31'
  AND f.facilityamt IS NOT NULL AND f.facilityamt > 0
  AND f.currency = 'United States Dollars'
GROUP BY year
ORDER BY year
"""
df_annual = pd.read_sql(annual_q, conn)
print(df_annual.to_string())

# %%
fig, ax1 = plt.subplots(figsize=(12, 6))
ax2 = ax1.twinx()

ax1.bar(df_annual['year'], df_annual['n_facilities'], color='#4472C4', alpha=0.7, label='Facility Count')
ax2.plot(df_annual['year'], df_annual['volume_bn'], color='#C00000', linewidth=2.5,
         marker='o', markersize=4, label='Dollar Volume ($Bn)')

ax1.set_xlabel('Year')
ax1.set_ylabel('Number of Facilities', color='#4472C4')
ax2.set_ylabel('Dollar Volume ($Bn)', color='#C00000')
ax1.set_title('DealScan: Annual US Syndicated Loan Origination (1990–2020)', fontweight='bold', fontsize=13)
ax2.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'${x:,.0f}'))
ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'{x:,.0f}'))

lines1, labels1 = ax1.get_legend_handles_labels()
lines2, labels2 = ax2.get_legend_handles_labels()
ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper left', frameon=False, fontsize=10)

fig.tight_layout()
fig.savefig(OUTPUT_DIR / 'dealscan_annual_origination.png', bbox_inches='tight')
plt.close()
print(f"Saved: {OUTPUT_DIR / 'dealscan_annual_origination.png'}")

# %% [markdown]
# ## 2. Breakdown by Loan Type

# %%
loantype_q = """
SELECT
    EXTRACT(YEAR FROM f.facilitystartdate)::int AS year,
    CASE
        WHEN f.loantype IN ('Term Loan', 'Term Loan A', 'Term Loan B', 'Term Loan C',
                            'Delay Draw Term Loan') THEN 'Term Loan'
        WHEN f.loantype IN ('Revolver/Line >= 1 Yr.', 'Revolver/Line < 1 Yr.',
                            '364-Day Facility', 'Revolver/Term Loan') THEN 'Revolver/Line'
        WHEN f.loantype = 'Bridge Loan' THEN 'Bridge Loan'
        ELSE 'Other'
    END AS loan_category,
    COUNT(*) AS n,
    SUM(f.facilityamt) / 1e9 AS volume_bn
FROM dealscan.facility f
WHERE f.facilitystartdate BETWEEN '1990-01-01' AND '2020-12-31'
  AND f.facilityamt > 0
  AND f.currency = 'United States Dollars'
GROUP BY year, loan_category
ORDER BY year, loan_category
"""
df_lt = pd.read_sql(loantype_q, conn)
df_lt_piv = df_lt.pivot_table(index='year', columns='loan_category', values='volume_bn', aggfunc='sum').fillna(0)

colors = {'Term Loan': '#4472C4', 'Revolver/Line': '#ED7D31', 'Bridge Loan': '#A5A5A5', 'Other': '#70AD47'}
order = ['Term Loan', 'Revolver/Line', 'Bridge Loan', 'Other']
cols_present = [c for c in order if c in df_lt_piv.columns]

fig, ax = plt.subplots(figsize=(12, 6))
bottom = np.zeros(len(df_lt_piv))
for col in cols_present:
    ax.bar(df_lt_piv.index, df_lt_piv[col], bottom=bottom, label=col, color=colors[col], width=0.8)
    bottom += df_lt_piv[col].values

ax.set_xlabel('Year')
ax.set_ylabel('Dollar Volume ($Bn)')
ax.set_title('DealScan: US Loan Origination by Type (1990–2020)', fontweight='bold', fontsize=13)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'${x:,.0f}'))
ax.legend(frameon=False, loc='upper left', fontsize=10)

fig.tight_layout()
fig.savefig(OUTPUT_DIR / 'dealscan_by_loan_type.png', bbox_inches='tight')
plt.close()
print(f"Saved: {OUTPUT_DIR / 'dealscan_by_loan_type.png'}")

# %% [markdown]
# ## 3. Breakdown by Loan Purpose

# %%
purpose_q = """
SELECT
    EXTRACT(YEAR FROM f.facilitystartdate)::int AS year,
    CASE
        WHEN f.primarypurpose IN ('Corp. purposes', 'Work. cap.', 'CP backup') THEN 'General Corporate'
        WHEN f.primarypurpose IN ('LBO', 'SBO', 'MBO', 'Dividend Recap', 'Recap.') THEN 'LBO/Recap'
        WHEN f.primarypurpose IN ('Acquis. line', 'Takeover', 'Merger') THEN 'M&A'
        WHEN f.primarypurpose = 'Debt Repay.' THEN 'Debt Repayment'
        WHEN f.primarypurpose IN ('Proj. finance', 'Real estate', 'Capital expend.',
                                   'Ship finance', 'Aircraft finance') THEN 'Project/CapEx'
        ELSE 'Other'
    END AS purpose_cat,
    COUNT(*) AS n,
    SUM(f.facilityamt) / 1e9 AS volume_bn
FROM dealscan.facility f
WHERE f.facilitystartdate BETWEEN '1990-01-01' AND '2020-12-31'
  AND f.facilityamt > 0
  AND f.currency = 'United States Dollars'
GROUP BY year, purpose_cat
ORDER BY year, purpose_cat
"""
df_pp = pd.read_sql(purpose_q, conn)
df_pp_piv = df_pp.pivot_table(index='year', columns='purpose_cat', values='volume_bn', aggfunc='sum').fillna(0)

purp_colors = {'General Corporate': '#4472C4', 'LBO/Recap': '#C00000', 'M&A': '#ED7D31',
               'Debt Repayment': '#70AD47', 'Project/CapEx': '#FFC000', 'Other': '#A5A5A5'}
purp_order = [c for c in ['General Corporate', 'M&A', 'LBO/Recap', 'Debt Repayment', 'Project/CapEx', 'Other']
              if c in df_pp_piv.columns]

fig, ax = plt.subplots(figsize=(12, 6))
bottom = np.zeros(len(df_pp_piv))
for col in purp_order:
    ax.bar(df_pp_piv.index, df_pp_piv[col], bottom=bottom, label=col, color=purp_colors[col], width=0.8)
    bottom += df_pp_piv[col].values

ax.set_xlabel('Year')
ax.set_ylabel('Dollar Volume ($Bn)')
ax.set_title('DealScan: US Loan Origination by Purpose (1990–2020)', fontweight='bold', fontsize=13)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'${x:,.0f}'))
ax.legend(frameon=False, loc='upper left', fontsize=10)

fig.tight_layout()
fig.savefig(OUTPUT_DIR / 'dealscan_by_purpose.png', bbox_inches='tight')
plt.close()
print(f"Saved: {OUTPUT_DIR / 'dealscan_by_purpose.png'}")

# %% [markdown]
# ## 4. Market Segments: Leveraged vs Investment Grade vs Institutional

# %%
seg_q = """
SELECT
    EXTRACT(YEAR FROM f.facilitystartdate)::int AS year,
    ms.marketsegment,
    COUNT(DISTINCT f.facilityid) AS n,
    SUM(f.facilityamt) / 1e9 AS volume_bn
FROM dealscan.facility f
JOIN dealscan.marketsegment ms ON f.facilityid = ms.facilityid
WHERE f.facilitystartdate BETWEEN '1990-01-01' AND '2020-12-31'
  AND f.facilityamt > 0
  AND f.currency = 'United States Dollars'
  AND ms.marketsegment IN ('Leveraged', 'Highly Leveraged', 'Investment Grade',
                           'Institutional', 'Covenant Lite', 'Second Lien')
GROUP BY year, ms.marketsegment
ORDER BY year, ms.marketsegment
"""
df_seg = pd.read_sql(seg_q, conn)
df_seg_piv = df_seg.pivot_table(index='year', columns='marketsegment', values='volume_bn', aggfunc='sum').fillna(0)

seg_colors = {'Investment Grade': '#4472C4', 'Leveraged': '#C00000', 'Highly Leveraged': '#FF6B6B',
              'Institutional': '#70AD47', 'Covenant Lite': '#FFC000', 'Second Lien': '#7030A0'}
seg_order = [c for c in ['Investment Grade', 'Leveraged', 'Highly Leveraged', 'Institutional',
                          'Covenant Lite', 'Second Lien']
             if c in df_seg_piv.columns]

fig, ax = plt.subplots(figsize=(12, 6))
for seg in seg_order:
    ax.plot(df_seg_piv.index, df_seg_piv[seg], label=seg, color=seg_colors[seg],
            linewidth=2.5, marker='o', markersize=3)

ax.set_xlabel('Year')
ax.set_ylabel('Dollar Volume ($Bn)')
ax.set_title('DealScan: US Loan Volume by Market Segment (1990–2020)', fontweight='bold', fontsize=13)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'${x:,.0f}'))
ax.legend(frameon=False, loc='upper left', fontsize=10)

fig.tight_layout()
fig.savefig(OUTPUT_DIR / 'dealscan_market_segments.png', bbox_inches='tight')
plt.close()
print(f"Saved: {OUTPUT_DIR / 'dealscan_market_segments.png'}")

# %% [markdown]
# ## 5. Distribution Method: Syndicated vs Club vs 144A

# %%
dist_q = """
SELECT
    EXTRACT(YEAR FROM f.facilitystartdate)::int AS year,
    CASE
        WHEN f.distributionmethod = 'Syndication' THEN 'Syndication'
        WHEN f.distributionmethod = 'Club Deal' THEN 'Club Deal'
        WHEN f.distributionmethod IN ('Rule 144A Private Placement',
                                       'Non-Rule 144A Private Placement',
                                       'Private Placement') THEN 'Private Placement'
        WHEN f.distributionmethod IN ('Sole Lender', 'Bilateral') THEN 'Bilateral/Sole'
        WHEN f.distributionmethod = 'Public Underwriting' THEN 'Public Underwriting'
        ELSE 'Other'
    END AS dist_cat,
    COUNT(*) AS n,
    SUM(f.facilityamt) / 1e9 AS volume_bn
FROM dealscan.facility f
WHERE f.facilitystartdate BETWEEN '1990-01-01' AND '2020-12-31'
  AND f.facilityamt > 0
  AND f.currency = 'United States Dollars'
GROUP BY year, dist_cat
ORDER BY year, dist_cat
"""
df_dist = pd.read_sql(dist_q, conn)
df_dist_piv = df_dist.pivot_table(index='year', columns='dist_cat', values='volume_bn', aggfunc='sum').fillna(0)

dist_colors = {'Syndication': '#4472C4', 'Club Deal': '#ED7D31', 'Private Placement': '#C00000',
               'Bilateral/Sole': '#70AD47', 'Public Underwriting': '#FFC000', 'Other': '#A5A5A5'}
dist_order = [c for c in ['Syndication', 'Club Deal', 'Private Placement', 'Bilateral/Sole',
                           'Public Underwriting', 'Other'] if c in df_dist_piv.columns]

fig, ax = plt.subplots(figsize=(12, 6))
bottom = np.zeros(len(df_dist_piv))
for col in dist_order:
    ax.bar(df_dist_piv.index, df_dist_piv[col], bottom=bottom, label=col, color=dist_colors[col], width=0.8)
    bottom += df_dist_piv[col].values

ax.set_xlabel('Year')
ax.set_ylabel('Dollar Volume ($Bn)')
ax.set_title('DealScan: US Loan Origination by Distribution Method (1990–2020)', fontweight='bold', fontsize=13)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'${x:,.0f}'))
ax.legend(frameon=False, loc='upper left', fontsize=10)

fig.tight_layout()
fig.savefig(OUTPUT_DIR / 'dealscan_distribution_method.png', bbox_inches='tight')
plt.close()
print(f"Saved: {OUTPUT_DIR / 'dealscan_distribution_method.png'}")

# %% [markdown]
# ## 6. Top Lead Arrangers (US, 2000–2020)

# %%
arranger_q = """
SELECT
    ls.lender AS arranger,
    COUNT(DISTINCT f.facilityid) AS n_facilities,
    SUM(f.facilityamt) / 1e9 AS volume_bn
FROM dealscan.lendershares ls
JOIN dealscan.facility f ON ls.facilityid = f.facilityid
WHERE ls.leadarrangercredit = 'Yes'
  AND f.facilitystartdate BETWEEN '2000-01-01' AND '2020-12-31'
  AND f.facilityamt > 0
  AND f.currency = 'United States Dollars'
  AND f.countryofsyndication = 'USA'
GROUP BY ls.lender
ORDER BY volume_bn DESC
LIMIT 20
"""
df_arr = pd.read_sql(arranger_q, conn)

fig, ax = plt.subplots(figsize=(12, 7))
bars = ax.barh(range(len(df_arr)), df_arr['volume_bn'], color='#4472C4', alpha=0.85)
ax.set_yticks(range(len(df_arr)))
ax.set_yticklabels(df_arr['arranger'], fontsize=9)
ax.invert_yaxis()
ax.set_xlabel('Total Arranged Volume ($Bn)')
ax.set_title('DealScan: Top 20 US Lead Arrangers by Volume (2000–2020)', fontweight='bold', fontsize=13)
ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'${x:,.0f}'))

# Add value labels
for bar, val in zip(bars, df_arr['volume_bn']):
    ax.text(bar.get_width() + max(df_arr['volume_bn']) * 0.01,
            bar.get_y() + bar.get_height()/2,
            f'${val:,.0f}B', va='center', fontsize=8)

fig.tight_layout()
fig.savefig(OUTPUT_DIR / 'dealscan_top_arrangers.png', bbox_inches='tight')
plt.close()
print(f"Saved: {OUTPUT_DIR / 'dealscan_top_arrangers.png'}")

# %%
conn.close()
print("\nDone! All 5 charts saved to", OUTPUT_DIR)
